"""Hook entry points.

Claude Code (`stalefence hook claude`, reading the hook JSON on stdin):
  * SessionStart (startup/clear): a new context has no premises, so the ledger is cleared.
  * PostToolUse on Read/Edit/MultiEdit/Write/NotebookEdit: record the file as a premise.
    On Glob: record the pattern's result set as a premise.
  * PreToolUse on Bash: when the command publishes work (`git push`, `gh pr merge`, or the
    `guarded_commands` regexes), run the check and block with exit code 2 if it is stale.
    Claude Code shows the block reason to the agent, which re-reads and re-plans.

git (`stalefence hook pre-push`, installed as .git/hooks/pre-push): the same check for any
agent or person pushing the current branch.

Hooks fail open: an internal error prints a warning and allows the action. Only a positive
finding blocks.
"""
from __future__ import annotations

import json
import os
import re
import sys

from . import coord, premises
from .config import Config, resolve_target
from .git import NotARepo, Repo

FILE_TOOLS = ("Read", "Edit", "MultiEdit", "Write", "NotebookEdit")
CLAUDE_HOOKS = {
    "hooks": {
        "SessionStart": [{"hooks": [{"type": "command", "command": "stalefence hook claude"}]}],
        "PostToolUse": [{"matcher": "Read|Edit|MultiEdit|Write|NotebookEdit|Glob",
                         "hooks": [{"type": "command", "command": "stalefence hook claude"}]}],
        "PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "stalefence hook claude"}]}],
    }
}
PRE_PUSH = """#!/bin/sh
# Installed by `stalefence install git-hook`. Bypass once with STALEFENCE_SKIP=1 or --no-verify.
exec stalefence hook pre-push "$@"
"""


def _warn(msg: str) -> None:
    print(f"stalefence: {msg}", file=sys.stderr)


def run_check(repo: Repo, cfg: Config, fetch: bool = True):
    target = resolve_target(repo, cfg)
    reservations, me = None, None
    if cfg.sequences:
        try:
            st = coord.store(repo, cfg)
            reservations, me = coord.reservations(st), coord.owner(repo)
        except Exception as e:  # noqa: BLE001 - reservations are advisory in the check
            _warn(f"could not read reservations ({e})")
    return premises.check(repo, cfg, target, fetch=fetch, reservations=reservations, me=me)


def claude(stdin=None) -> int:
    try:
        data = json.loads((stdin or sys.stdin).read() or "{}")
    except ValueError:
        _warn("hook input was not JSON; allowing")
        return 0
    try:
        return _claude(data)
    except NotARepo:
        return 0
    except Exception as e:  # noqa: BLE001 - never wedge the agent on our own failure
        _warn(f"hook error ({type(e).__name__}: {e}); allowing")
        return 0


def _claude(data: dict) -> int:
    event, tool = data.get("hook_event_name"), data.get("tool_name")
    ti = data.get("tool_input") or {}
    cwd = data.get("cwd") or os.getcwd()
    if event == "SessionStart":
        if data.get("source", "startup") in ("startup", "clear"):
            premises.reset(Repo.discover(cwd))
        return 0
    if event == "PostToolUse" and tool in FILE_TOOLS:
        path = ti.get("file_path") or ti.get("notebook_path")
        if not path:
            return 0
        path = os.path.join(cwd, path)
        repo = Repo.discover(os.path.dirname(path) if os.path.isdir(os.path.dirname(path)) else cwd)
        premises.record_files(repo, resolve_target(repo, Config.load(repo)), [path], source=tool.lower())
        return 0
    if event == "PostToolUse" and tool == "Glob":
        pattern = ti.get("pattern")
        if not pattern:
            return 0
        where = os.path.join(cwd, ti.get("path") or ".")
        repo = Repo.discover(where if os.path.isdir(where) else cwd)
        cfg = Config.load(repo)
        premises.record_glob(repo, resolve_target(repo, cfg), pattern, cwd=where, limit=cfg.glob_limit)
        return 0
    if event == "PreToolUse" and tool == "Bash":
        repo = Repo.discover(cwd)
        cfg = Config.load(repo)
        command = ti.get("command") or ""
        if not any(re.search(rx, command) for rx in cfg.guarded_commands):
            return 0
        if os.environ.get("STALEFENCE_SKIP"):
            _warn("STALEFENCE_SKIP is set; not checking")
            return 0
        report = run_check(repo, cfg)
        if report.stale:
            print(report.text(), file=sys.stderr)
            return 2
        return 0
    return 0


def pre_push(argv, stdin=None) -> int:
    """git pre-push hook: stdin has `<local ref> <local sha> <remote ref> <remote sha>` lines."""
    if os.environ.get("STALEFENCE_SKIP"):
        _warn("STALEFENCE_SKIP is set; not checking")
        return 0
    try:
        repo = Repo.discover()
        head = repo.head()
        lines = [line.split() for line in (stdin or sys.stdin).read().splitlines() if line.strip()]
        pushing_head = any(len(x) == 4 and x[1] == head and not x[2].startswith("refs/stalefence/")
                           for x in lines)
        if lines and not pushing_head:
            return 0
        report = run_check(repo, Config.load(repo))
    except NotARepo:
        return 0
    except Exception as e:  # noqa: BLE001
        _warn(f"pre-push check error ({type(e).__name__}: {e}); allowing")
        return 0
    if report.stale:
        print(report.text(), file=sys.stderr)
        print("stalefence: push blocked. Re-read and rebase, or bypass once with STALEFENCE_SKIP=1.",
              file=sys.stderr)
        return 1
    if report.warnings or any(not f.blocking for f in report.findings):
        print(report.text(), file=sys.stderr)
    return 0


def install_claude(repo: Repo, write: bool) -> str:
    path = os.path.join(repo.root, ".claude", "settings.json")
    if not write:
        return json.dumps(CLAUDE_HOOKS, indent=2)
    data = {}
    if os.path.exists(path):
        with open(path) as fh:
            data = json.load(fh)
    hooks = data.setdefault("hooks", {})
    for event, entries in CLAUDE_HOOKS["hooks"].items():
        have = hooks.setdefault(event, [])
        for e in entries:
            if e not in have:
                have.append(e)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    return path


def install_git_hook(repo: Repo, force: bool = False) -> str:
    hooks_dir = repo.out("rev-parse", "--git-path", "hooks")
    hooks_dir = hooks_dir if os.path.isabs(hooks_dir) else os.path.join(repo.root, hooks_dir)
    path = os.path.join(hooks_dir, "pre-push")
    if os.path.exists(path) and not force:
        with open(path) as fh:
            if "stalefence hook pre-push" in fh.read():
                return path
        raise FileExistsError(f"{path} already exists; add `stalefence hook pre-push \"$@\"` to it, "
                              "or rerun with --force to replace it")
    os.makedirs(hooks_dir, exist_ok=True)
    with open(path, "w") as fh:
        fh.write(PRE_PUSH)
    os.chmod(path, 0o755)
    return path
