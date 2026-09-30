"""The premise check: dependency-scoped, refreshed only by re-reading, strict on request."""
import json

SEED = {"src/a.py": "A = 1\n", "src/b.py": "B = 1\n", "README.md": "hello\n"}


def test_unrelated_upstream_change_is_fresh(world):
    world.seed(SEED)
    a, b = world.agent("a"), world.agent("b")
    assert a.sf("read", "src/a.py").returncode == 0
    b.write("src/b.py", "B = 2\n")
    b.land("b edits b.py")
    r = a.sf("check")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "fresh" in r.stdout and "moved 1 commit" in r.stdout


def test_strict_fails_on_any_movement(world):
    world.seed(SEED)
    a, b = world.agent("a"), world.agent("b")
    a.sf("read", "src/a.py")
    b.write("src/b.py", "B = 2\n")
    b.land("b edits b.py")
    r = a.sf("check", "--strict")
    assert r.returncode == 1 and "strict" in r.stdout


def test_changed_premise_is_stale_and_names_the_commit(world):
    world.seed(SEED)
    a, b = world.agent("a"), world.agent("b")
    a.sf("read", "src/a.py")
    b.write("src/a.py", "A = 2\n")
    b.land("b rewrites A")
    r = a.sf("check")
    assert r.returncode == 1
    assert "STALE" in r.stdout and "src/a.py" in r.stdout and "b rewrites A" in r.stdout


def test_rebase_alone_does_not_refresh_but_rereading_does(world):
    world.seed(SEED)
    a, b = world.agent("a"), world.agent("b")
    a.sf("read", "src/a.py")
    b.write("src/a.py", "A = 2\n")
    b.land("b rewrites A")
    a.git("fetch", "-q", "origin")
    a.git("rebase", "-q", "origin/main")
    assert a.sf("check").returncode == 1        # the agent's view of a.py is still the old one
    a.sf("read", "src/a.py")                    # re-read after rebasing
    r = a.sf("check")
    assert r.returncode == 0, r.stdout


def test_file_the_branch_edits_changed_upstream(world):
    world.seed({"src/a.py": "def one():\n    return 1\n\n\n\n\ndef two():\n    return 2\n"})
    a, b = world.agent("a"), world.agent("b")
    a.write("src/a.py", "def one():\n    return 11\n\n\n\n\ndef two():\n    return 2\n")
    a.commit("a edits one()")
    b.write("src/a.py", "def one():\n    return 1\n\n\n\n\ndef two():\n    return 22\n")
    b.land("b edits two()")
    r = a.sf("check")
    assert r.returncode == 1 and "written" in r.stdout and "src/a.py" in r.stdout


def test_written_can_be_downgraded_to_a_warning(world):
    world.seed({"src/a.py": "x = 1\n"}, config={"written": "warn"})
    a, b = world.agent("a"), world.agent("b")
    a.write("src/a.py", "x = 2\n")
    a.commit("a")
    b.write("src/a.py", "x = 3\n")
    b.land("b")
    r = a.sf("check")
    assert r.returncode == 0 and "warn" in r.stdout


def test_same_new_path_created_on_both_sides(world):
    world.seed(SEED)
    a, b = world.agent("a"), world.agent("b")
    a.write("docs/plan.md", "a's plan\n")
    a.hook("PostToolUse", "Write", tool_input={"file_path": str(a.dir / "docs/plan.md"), "content": "x"})
    b.write("docs/plan.md", "b's plan\n")
    b.land("b adds plan")
    r = a.sf("check")
    assert r.returncode == 1 and "did not exist when you read it" in r.stdout


def test_glob_premise_sees_new_files(world):
    world.seed({"migrations/versions/060_base.py": "", "src/a.py": ""})
    a, b = world.agent("a"), world.agent("b")
    assert "glob migrations/versions/*.py" in a.sf("read", "migrations/versions/*.py").stdout
    b.write("migrations/versions/061_b.py", "")
    b.land("b adds migration 061")
    r = a.sf("check")
    assert r.returncode == 1
    assert "new on origin/main: migrations/versions/061_b.py" in r.stdout


def test_ignored_paths_are_not_checked(world):
    world.seed({"poetry.lock": "v1\n", "src/a.py": ""}, config={"ignore": ["*.lock"]})
    a, b = world.agent("a"), world.agent("b")
    a.sf("read", "poetry.lock")
    b.write("poetry.lock", "v2\n")
    b.land("b bumps lock")
    assert a.sf("check").returncode == 0


def test_status_reset_and_json(world):
    world.seed(SEED)
    a = world.agent("a")
    a.sf("read", "src/a.py", "src/*.py")
    st = a.sf("status").stdout
    assert "file  src/a.py" in st and "glob  src/*.py" in st and "2 match(es)" in st
    data = json.loads(a.sf("check", "--json", "--no-fetch").stdout)
    assert data["stale"] is False and data["checked"] == 2
    assert "forgot 1" in a.sf("reset", "src/a.py").stdout
    assert "cleared 1" in a.sf("reset").stdout
    assert "no premises" in a.sf("status").stdout


def test_unreachable_remote_warns_and_checks_the_local_copy(world):
    world.seed(SEED)
    a = world.agent("a")
    a.sf("read", "src/a.py")
    a.git("remote", "set-url", "origin", str(world.root / "gone.git"))
    r = a.sf("check")
    assert r.returncode == 0 and "could not fetch" in r.stdout


def test_ledgers_are_per_worktree(world):
    world.seed(SEED)
    a = world.agent("a")
    a.git("worktree", "add", "-q", "-b", "agent/a2", str(world.root / "a2"), "origin/main")
    a.sf("read", "src/a.py")
    from conftest import sh
    import sys
    st = sh(world.root / "a2", sys.executable, "-m", "stalefence", "status").stdout
    assert "no premises" in st
