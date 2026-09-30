"""Fixtures: a shared bare remote and agent sessions, each a clone working on its own branch."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

PROJECT = Path(__file__).resolve().parents[1]
BASE_ENV = {
    "GIT_AUTHOR_NAME": "seed", "GIT_AUTHOR_EMAIL": "seed@example.com",
    "GIT_COMMITTER_NAME": "seed", "GIT_COMMITTER_EMAIL": "seed@example.com",
    "GIT_CONFIG_NOSYSTEM": "1", "PYTHONPATH": str(PROJECT),
}


def sh(cwd, *args, check=True, env=None, input=None):
    e = dict(os.environ, **BASE_ENV, **(env or {}))
    p = subprocess.run([str(a) for a in args], cwd=cwd, capture_output=True, text=True, env=e, input=input)
    if check and p.returncode != 0:
        raise AssertionError(f"{args} exited {p.returncode}\n{p.stdout}\n{p.stderr}")
    return p


class Agent:
    def __init__(self, world, name: str, branch: str | None = None):
        self.world, self.name = world, name
        self.dir = world.root / name
        sh(world.root, "git", "clone", "-q", world.remote, name)
        self.git("config", "user.email", f"{name}@example.com")
        self.git("config", "user.name", name)
        self.git("checkout", "-q", "-b", branch or f"agent/{name}")

    def git(self, *args, **kw):
        return sh(self.dir, "git", *args, **kw)

    def write(self, path: str, text: str) -> None:
        p = self.dir / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def read(self, path: str) -> str:
        return (self.dir / path).read_text()

    def commit(self, msg: str) -> None:
        self.git("add", "-A")
        self.git("commit", "-q", "-m", msg)

    def land(self, msg: str) -> None:
        """Commit and push straight to main, as a merged PR would (bypassing hooks)."""
        self.commit(msg)
        self.git("fetch", "-q", "origin")
        self.git("rebase", "-q", "origin/main")
        self.git("push", "-q", "--no-verify", "origin", "HEAD:main")

    def sf(self, *args, input=None, env=None, check=False):
        return sh(self.dir, sys.executable, "-m", "stalefence", *args, input=input, env=env, check=check)

    def hook(self, event: str, tool: str | None = None, env=None, **fields):
        payload = dict(hook_event_name=event, cwd=str(self.dir), session_id="s1", **fields)
        if tool:
            payload["tool_name"] = tool
        return self.sf("hook", "claude", input=json.dumps(payload), env=env)


class World:
    def __init__(self, root: Path):
        self.root = root
        self.remote = str(root / "remote.git")
        sh(root, "git", "init", "-q", "--bare", "--initial-branch=main", self.remote)
        seed = root / "seed"
        sh(root, "git", "init", "-q", "--initial-branch=main", seed)
        self.seed_dir = seed
        sh(seed, "git", "remote", "add", "origin", self.remote)

    def seed(self, files: dict, config: dict | None = None) -> None:
        for path, text in files.items():
            p = self.seed_dir / path
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text)
        if config is not None:
            (self.seed_dir / ".stalefence.json").write_text(json.dumps(config))
        sh(self.seed_dir, "git", "add", "-A")
        sh(self.seed_dir, "git", "commit", "-q", "-m", "seed")
        sh(self.seed_dir, "git", "push", "-q", "origin", "main")

    def agent(self, name: str, branch: str | None = None) -> Agent:
        return Agent(self, name, branch)


@pytest.fixture
def world(tmp_path):
    return World(tmp_path)


@pytest.fixture
def shim(tmp_path):
    """A `stalefence` executable on PATH, as the git hook expects."""
    bindir = tmp_path / "bin"
    bindir.mkdir()
    exe = bindir / "stalefence"
    exe.write_text(f'#!/bin/sh\nexec "{sys.executable}" -m stalefence "$@"\n')
    exe.chmod(0o755)
    return {"PATH": f"{bindir}{os.pathsep}{os.environ['PATH']}"}
