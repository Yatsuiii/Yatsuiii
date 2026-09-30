import sys


def test_conflicts_are_listed(world):
    world.seed({"f.txt": "one\n"})
    a, b = world.agent("a"), world.agent("b")
    a.write("f.txt", "a\n")
    a.commit("a")
    b.write("f.txt", "b\n")
    b.land("b")
    r = a.sf("merge-check")
    assert r.returncode == 1 and "would conflict in 1 file" in r.stdout and "f.txt" in r.stdout


def test_clean_merge_runs_the_command_in_a_throwaway_worktree(world):
    world.seed({"f.txt": "one\n", "g.txt": "two\n"})
    a, b = world.agent("a"), world.agent("b")
    a.write("f.txt", "a\n")
    a.commit("a")
    b.write("g.txt", "b\n")
    b.land("b")
    probe = [sys.executable, "-c", "print(open('f.txt').read().strip(), open('g.txt').read().strip())"]
    r = a.sf("merge-check", "--", *probe)
    assert r.returncode == 0 and "passes on it" in r.stdout
    assert len(a.git("worktree", "list").stdout.splitlines()) == 1     # cleaned up
    assert a.read("f.txt") == "a\n"                                      # worktree untouched


def test_configured_command_is_used(world):
    world.seed({"f.txt": "one\n"}, config={"merge_check": "exit 3"})
    a = world.agent("a")
    r = a.sf("merge-check")
    assert r.returncode == 1 and "(exit 3)" in r.stdout
