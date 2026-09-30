"""Reservations and claims: atomic across clones (remote store) and worktrees (local store)."""
import sys

from conftest import sh

ADR = {"sequences": {"adr": {"pattern": "docs/decisions/ADR-{n}-*.md", "width": 4}}}


def test_claims_are_exclusive_until_they_expire(world):
    world.seed({"x": ""})
    a, b = world.agent("a"), world.agent("b")
    assert a.sf("claim", "issue-42", "--ttl", "1h", "--note", "fixing login").returncode == 0
    r = b.sf("claim", "issue-42")
    assert r.returncode == 1 and "claimed by a@example.com:agent/a" in r.stderr and "fixing login" in r.stderr
    assert "renewed issue-42" in a.sf("claim", "issue-42").stdout
    later = {"STALEFENCE_NOW": str(10 ** 10)}
    r = b.sf("claim", "issue-42", env=later)
    assert r.returncode == 0 and "took over (expired)" in r.stdout
    assert a.sf("claim", "issue-42", env=later).returncode == 1     # a lost it
    listing = a.sf("claims", env=later).stdout
    assert "issue-42  b@example.com:agent/b" in listing


def test_only_the_holder_can_unclaim(world):
    world.seed({"x": ""})
    a, b = world.agent("a"), world.agent("b")
    a.sf("claim", "t1")
    r = b.sf("unclaim", "t1")
    assert r.returncode == 2 and "claimed by a@example.com:agent/a" in r.stderr
    assert b.sf("unclaim", "t1", "--force").returncode == 0
    assert b.sf("claims").stdout.strip() == ""


def test_local_store_coordinates_worktrees_without_a_remote(world):
    world.seed({"docs/decisions/ADR-0001-x.md": ""}, config=ADR)
    a = world.agent("a")
    wt = world.root / "a2"
    a.git("worktree", "add", "-q", "-b", "agent/a2", str(wt), "origin/main")
    first = a.sf("reserve", "adr", "--store", "local").stdout.strip()
    second = sh(wt, sys.executable, "-m", "stalefence", "reserve", "adr", "--store", "local").stdout.strip()
    assert (first, second) == ("0002", "0003")
    assert a.git("ls-remote", "origin", "refs/stalefence/*").stdout == ""   # nothing left the machine


def test_release_and_min(world):
    world.seed({"docs/decisions/ADR-0001-x.md": ""}, config=ADR)
    a = world.agent("a")
    assert a.sf("reserve", "adr", "--min", "10").stdout.strip() == "0010"
    assert a.sf("release", "adr", "10").returncode == 0
    assert a.sf("reservations").stdout.strip() == ""


def test_unknown_sequence_is_a_clear_error(world):
    world.seed({"x": ""})
    r = world.agent("a").sf("reserve", "adr")
    assert r.returncode == 2 and "unknown sequence 'adr'" in r.stderr


def test_bad_config_is_rejected(world):
    world.seed({"x": ""}, config={"sequences": {"adr": {"pattern": "docs/ADR-*.md"}}})
    r = world.agent("a").sf("check")
    assert r.returncode == 2 and "{n}" in r.stderr
