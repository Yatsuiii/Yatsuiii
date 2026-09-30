"""Claude Code hook protocol and the git pre-push hook."""
import json

SEED = {"src/a.py": "A = 1\n", "src/b.py": "B = 1\n"}


def test_post_tool_use_records_reads_edits_writes_and_globs(world):
    world.seed(SEED)
    a = world.agent("a")
    for tool in ("Read", "Edit"):
        assert a.hook("PostToolUse", tool, tool_input={"file_path": str(a.dir / "src/a.py")}).returncode == 0
    a.hook("PostToolUse", "Write", tool_input={"file_path": "src/new.py", "content": ""})   # relative to cwd
    a.hook("PostToolUse", "Glob", tool_input={"pattern": "*.py", "path": str(a.dir / "src")})
    a.hook("PostToolUse", "Read", tool_input={"file_path": "/etc/hostname"})               # outside: ignored
    st = json.loads(a.sf("status", "--json").stdout)
    assert set(st) == {"file:src/a.py", "file:src/new.py", "glob:src/*.py"}
    assert st["file:src/a.py"]["source"] == "edit" and st["file:src/new.py"]["value"] is None


def test_pre_tool_use_blocks_push_only_when_stale(world):
    world.seed(SEED)
    a, b = world.agent("a"), world.agent("b")
    a.hook("PostToolUse", "Read", tool_input={"file_path": str(a.dir / "src/a.py")})
    push = {"command": "git push origin HEAD"}
    assert a.hook("PreToolUse", "Bash", tool_input=push).returncode == 0
    b.write("src/a.py", "A = 2\n")
    b.land("b changes A")
    assert a.hook("PreToolUse", "Bash", tool_input={"command": "ls -la"}).returncode == 0
    r = a.hook("PreToolUse", "Bash", tool_input=push)
    assert r.returncode == 2 and "STALE" in r.stderr and "src/a.py" in r.stderr
    r = a.hook("PreToolUse", "Bash", tool_input={"command": "gh pr merge 12 --squash"})
    assert r.returncode == 2
    assert a.hook("PreToolUse", "Bash", tool_input=push, env={"STALEFENCE_SKIP": "1"}).returncode == 0


def test_session_start_clears_but_resume_keeps(world):
    world.seed(SEED)
    a = world.agent("a")
    a.sf("read", "src/a.py")
    a.hook("SessionStart", source="resume")
    assert "src/a.py" in a.sf("status").stdout
    a.hook("SessionStart", source="startup")
    assert "no premises" in a.sf("status").stdout


def test_hook_fails_open(world, tmp_path):
    world.seed(SEED)
    a = world.agent("a")
    assert a.sf("hook", "claude", input="not json").returncode == 0
    outside = json.dumps({"hook_event_name": "PreToolUse", "tool_name": "Bash", "cwd": str(tmp_path),
                          "tool_input": {"command": "git push"}})
    assert a.sf("hook", "claude", input=outside).returncode == 0


def test_git_pre_push_hook(world, shim):
    world.seed(SEED)
    a, b = world.agent("a"), world.agent("b")
    assert "installed" in a.sf("install", "git-hook").stdout
    a.sf("read", "src/a.py")
    a.write("src/c.py", "C = 1\n")
    a.commit("a adds c")
    assert a.git("push", "-q", "origin", "HEAD", env=shim, check=False).returncode == 0
    b.write("src/a.py", "A = 2\n")
    b.land("b changes A")
    a.write("src/c.py", "C = 2\n")
    a.commit("a edits c")
    r = a.git("push", "origin", "HEAD", env=shim, check=False)
    assert r.returncode != 0 and "push blocked" in r.stderr
    # Coordination refs are not work: a stale worktree can still reserve and claim.
    assert a.sf("claim", "t9", env=shim).returncode == 0
    r = a.git("push", "-q", "origin", "HEAD", env=dict(shim, STALEFENCE_SKIP="1"), check=False)
    assert r.returncode == 0


def test_install_claude_merges_settings_once(world):
    world.seed(SEED)
    a = world.agent("a")
    printed = json.loads(a.sf("install", "claude").stdout)
    assert set(printed["hooks"]) == {"SessionStart", "PostToolUse", "PreToolUse"}
    settings = a.dir / ".claude" / "settings.json"
    settings.parent.mkdir()
    settings.write_text(json.dumps({"permissions": {"allow": ["Bash(ls)"]}, "hooks": {"PreToolUse": []}}))
    a.sf("install", "claude", "--write")
    a.sf("install", "claude", "--write")
    data = json.loads(settings.read_text())
    assert data["permissions"] == {"allow": ["Bash(ls)"]}
    assert len(data["hooks"]["PreToolUse"]) == 1 and len(data["hooks"]["PostToolUse"]) == 1


def test_exploratory_globs_are_not_recorded_by_the_hook(world):
    world.seed({f"src/m{i}.py": "" for i in range(5)}, config={"glob_limit": 3})
    a = world.agent("a")
    a.hook("PostToolUse", "Glob", tool_input={"pattern": "**/*.py"})
    a.hook("PostToolUse", "Glob", tool_input={"pattern": "src/*.py"})       # 5 matches > limit 3
    a.hook("PostToolUse", "Glob", tool_input={"pattern": "src/m[01].py"})   # 2 matches: recorded
    st = json.loads(a.sf("status", "--json").stdout)
    assert set(st) == {"glob:src/m[01].py"}
    a.sf("read", "**/*.py")                                                  # explicit: always recorded
    assert "glob:**/*.py" in json.loads(a.sf("status", "--json").stdout)
