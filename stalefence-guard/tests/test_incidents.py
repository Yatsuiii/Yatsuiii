"""The incidents stalefence was built from, reproduced with real git (see README, "Why").

1. thienphung00/Juli-AI#2036  two agent sessions both took migration 061 from the same main.
2. muhammadbayoumi/ScrapeX#664  a Claude branch used a constant main had just moved: git
   merged cleanly, the result raised NameError.
3. HPAC-Safety/safety-report#319  ADR numbers taken by another session three times in an
   afternoon.
4. plow-pbc/hermes-plugin-plow#139  an assistant retracted a real booking on a stale belief
   (non-git: the generic ledger).
"""
import sys
import threading

import pytest

from stalefence import coord
from stalefence.config import Config
from stalefence.git import Repo
from stalefence.ledger import Premises, StalePremise

MIGRATIONS = {"sequences": {"migrations": {"pattern": "migrations/versions/{n}_*.py", "width": 3}}}


def test_juli_ai_without_reservation_the_second_session_is_stopped(world):
    world.seed({"migrations/versions/060_processed_events_epoch.py": "down_revision = '059'\n"},
               config=MIGRATIONS)
    s1, s2 = world.agent("s1"), world.agent("s2")
    # Both sessions look at the migrations directory and both conclude 061 is next.
    for s in (s1, s2):
        s.sf("read", "migrations/versions/*.py")
    s1.write("migrations/versions/061_credential_owner_enumeration.py", "down_revision = '060'\n")
    s1.land("061 credential owner enumeration")
    s2.write("migrations/versions/061_workflow_and_subject.py", "down_revision = '060'\n")
    s2.commit("061 workflow and subject")
    r = s2.sf("check")
    assert r.returncode == 1
    assert "new on origin/main: migrations/versions/061_credential_owner_enumeration.py" in r.stdout
    assert "migrations 61" in r.stdout and "already has" in r.stdout


def test_juli_ai_with_reservation_sessions_get_different_numbers(world):
    world.seed({"migrations/versions/060_processed_events_epoch.py": ""}, config=MIGRATIONS)
    s1, s2 = world.agent("s1"), world.agent("s2")
    n1 = s1.sf("reserve", "migrations").stdout.strip()
    n2 = s2.sf("reserve", "migrations").stdout.strip()
    assert (n1, n2) == ("061", "062")
    listing = s1.sf("reservations").stdout
    assert "migrations 061  s1@example.com:agent/s1" in listing
    assert "migrations 062  s2@example.com:agent/s2" in listing
    # s2 ignores its reservation and uses 061 anyway: the check names the holder.
    s2.write("migrations/versions/061_oops.py", "")
    s2.commit("oops")
    r = s2.sf("check")
    assert r.returncode == 1 and "reserved by s1@example.com:agent/s1" in r.stdout


SCRAPEX_CLI = '''BEHIND = "Needs upgrade"


def status_of(state):
    return state.get("status")
'''
SCRAPEX_CLI_BRANCH = SCRAPEX_CLI + '''

def back_up_before_init_db(state):
    if state.get("ok") or state.get("status") != BEHIND:
        return False
    return True
'''
SCRAPEX_CLI_MAIN = '''# BEHIND moved to scrapex/dbupgrade.py


def status_of(state):
    return state.get("status")
'''


def test_scrapex_clean_merge_that_breaks(world):
    world.seed({"scrapex/__init__.py": "", "scrapex/cli.py": SCRAPEX_CLI, "scrapex/dbupgrade.py": ""})
    agent, other = world.agent("claude", branch="claude/drive-without-a-server"), world.agent("human")
    # The agent reads cli.py, then adds a new use of BEHIND.
    agent.hook("PostToolUse", "Read", tool_input={"file_path": str(agent.dir / "scrapex/cli.py")})
    agent.write("scrapex/cli.py", SCRAPEX_CLI_BRANCH)
    agent.commit("back up before init-db")
    # Meanwhile main moves BEHIND into dbupgrade.py.
    other.write("scrapex/cli.py", SCRAPEX_CLI_MAIN)
    other.write("scrapex/dbupgrade.py", 'BEHIND = "Needs upgrade"\n')
    other.land("move BEHIND to dbupgrade")

    agent.git("fetch", "-q", "origin")
    assert agent.git("merge-tree", "--write-tree", "HEAD", "origin/main", check=False).returncode == 0
    r = agent.sf("check")
    assert r.returncode == 1 and "scrapex/cli.py" in r.stdout and "move BEHIND to dbupgrade" in r.stdout
    probe = [sys.executable, "-c",
             "import scrapex.cli as c; c.back_up_before_init_db({'status': 'Needs upgrade'})"]
    mc = agent.sf("merge-check", "--", *probe)
    assert mc.returncode == 1 and "NameError" in mc.stdout and "textually clean" in mc.stdout

    # The fix: rebase, re-read, import the moved constant.
    agent.git("rebase", "-q", "origin/main")
    agent.hook("PostToolUse", "Read", tool_input={"file_path": str(agent.dir / "scrapex/cli.py")})
    fixed = agent.read("scrapex/cli.py").replace("# BEHIND moved to scrapex/dbupgrade.py",
                                                 "from scrapex.dbupgrade import BEHIND")
    agent.write("scrapex/cli.py", fixed)
    agent.commit("import BEHIND from dbupgrade")
    assert agent.sf("check").returncode == 0
    assert agent.sf("merge-check", "--", *probe).returncode == 0


def test_adr_numbers_parallel_sessions_never_collide(world):
    world.seed({"docs/decisions/ADR-0088-first.md": ""},
               config={"sequences": {"adr": {"pattern": "docs/decisions/ADR-{n}-*.md", "width": 4}}})
    sessions = [world.agent(f"s{i}") for i in range(4)]
    got, errors = [], []

    def take(s):
        r = s.sf("reserve", "adr")
        (got if r.returncode == 0 else errors).append(r.stdout.strip() or r.stderr)

    threads = [threading.Thread(target=take, args=(s,)) for s in sessions]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    assert sorted(got) == ["0089", "0090", "0091", "0092"]


def test_reservation_race_between_scan_and_write_moves_to_the_next_number(world, monkeypatch):
    world.seed({"docs/decisions/ADR-0088-first.md": ""},
               config={"sequences": {"adr": {"pattern": "docs/decisions/ADR-{n}-*.md", "width": 4}}})
    s1, s2 = world.agent("s1"), world.agent("s2")
    repo = Repo.discover(str(s2.dir))
    cfg = Config.load(repo)
    st = coord.store(repo, cfg)
    real = coord.reservations
    calls = {"n": 0}

    def scan_then_lose(st_, seq=None):   # s2 scans before s1 writes, so both pick 89
        calls["n"] += 1
        view = real(st_, seq)
        if calls["n"] == 1:
            assert s1.sf("reserve", "adr").stdout.strip() == "0089"
        return view

    monkeypatch.setattr(coord, "reservations", scan_then_lose)
    monkeypatch.setenv("STALEFENCE_OWNER", "s2")
    n, text = coord.reserve(repo, cfg, st, "adr", repo.rev_parse("origin/main"))
    assert text == "0090"


def test_assistant_reversal_is_verified_against_the_owning_system():
    calendar = {"booking-9/14": "blocked@2026-09-08"}
    premises = Premises()
    premises.observe("booking-9/14", calendar["booking-9/14"])     # the group chat's belief
    calendar["booking-9/14"] = "confirmed@2026-09-10"               # booked from the owner DM
    with pytest.raises(StalePremise) as e:
        premises.verify(calendar.get, keys=["booking-9/14"])       # before sending the retraction
    assert e.value.changed == {"booking-9/14": ("blocked@2026-09-08", "confirmed@2026-09-10")}
