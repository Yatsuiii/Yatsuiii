"""Thin git plumbing wrapper: subprocess only, no dependencies."""
from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass, field


class GitError(RuntimeError):
    def __init__(self, args, code, stderr):
        super().__init__(f"git {' '.join(args)} failed ({code}): {stderr.strip()}")
        self.code = code
        self.stderr = stderr


class NotARepo(RuntimeError):
    pass


def _identity_env() -> dict:
    """commit-tree needs an identity; agent sandboxes often have none configured."""
    env = dict(os.environ)
    probe = subprocess.run(["git", "config", "user.email"], capture_output=True, text=True)
    if not probe.stdout.strip():
        for k, v in (("GIT_AUTHOR_NAME", "stalefence"), ("GIT_AUTHOR_EMAIL", "stalefence@localhost"),
                     ("GIT_COMMITTER_NAME", "stalefence"), ("GIT_COMMITTER_EMAIL", "stalefence@localhost")):
            env.setdefault(k, v)
    return env


@dataclass
class Repo:
    root: str        # top level of this worktree
    git_dir: str     # this worktree's git dir (per-worktree state lives here)
    common_dir: str  # shared by all worktrees of the repository
    _trees: dict = field(default_factory=dict, repr=False)

    @classmethod
    def discover(cls, cwd: str | None = None) -> "Repo":
        cwd = cwd or os.getcwd()
        p = subprocess.run(["git", "rev-parse", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"],
                           cwd=cwd, capture_output=True, text=True)
        if p.returncode != 0:
            raise NotARepo(p.stderr.strip() or f"{cwd} is not inside a git worktree")
        root, git_dir, common = p.stdout.splitlines()[:3]
        if not os.path.isabs(common):
            common = os.path.normpath(os.path.join(cwd, common))
        return cls(root=root, git_dir=git_dir, common_dir=common)

    # -- running -------------------------------------------------------------------------
    def run(self, *args, check=True, input=None, timeout=None, env=None) -> subprocess.CompletedProcess:
        p = subprocess.run(["git", *args], cwd=self.root, capture_output=True, text=True,
                           input=input, timeout=timeout, env=env)
        if check and p.returncode != 0:
            raise GitError(args, p.returncode, p.stderr)
        return p

    def out(self, *args, **kw) -> str:
        return self.run(*args, **kw).stdout.strip()

    def ok(self, *args, **kw) -> bool:
        return self.run(*args, check=False, **kw).returncode == 0

    # -- refs and commits ----------------------------------------------------------------
    def rev_parse(self, ref: str) -> str | None:
        p = self.run("rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}", check=False)
        return p.stdout.strip() or None

    def head(self) -> str:
        return self.out("rev-parse", "HEAD")

    def branch(self) -> str | None:
        p = self.run("symbolic-ref", "--quiet", "--short", "HEAD", check=False)
        return p.stdout.strip() or None

    def merge_base(self, a: str, b: str) -> str | None:
        p = self.run("merge-base", a, b, check=False)
        return p.stdout.strip() or None

    def remotes(self) -> list:
        return self.out("remote").split()

    def config(self, key: str) -> str | None:
        p = self.run("config", "--get", key, check=False)
        return p.stdout.strip() or None

    def fetch(self, remote: str, refspec: str, timeout: float = 30) -> tuple:
        try:
            p = self.run("fetch", "--quiet", "--no-tags", remote, refspec, check=False, timeout=timeout)
        except subprocess.TimeoutExpired:
            return False, f"git fetch {remote} timed out after {timeout:.0f}s"
        return p.returncode == 0, p.stderr.strip()

    # -- trees ---------------------------------------------------------------------------
    def entries(self, commit: str, paths) -> dict:
        """{path: object id} for exactly these paths at `commit`; absent paths are missing."""
        want = set(paths)
        if not want:
            return {}
        out = {}
        for rec in self.run("ls-tree", "-r", "-z", "--full-tree", commit, "--", *sorted(want)).stdout.split("\0"):
            if rec:
                meta, path = rec.split("\t", 1)
                if path in want:
                    out[path] = meta.split()[2]
        return out

    def oid(self, commit: str, path: str) -> str | None:
        return self.entries(commit, [path]).get(path)

    def files(self, commit: str) -> list:
        """Every file path at `commit` (cached per commit)."""
        if commit not in self._trees:
            raw = self.run("ls-tree", "-r", "-z", "--name-only", "--full-tree", commit).stdout
            self._trees[commit] = [p for p in raw.split("\0") if p]
        return self._trees[commit]

    def changed_paths(self, base: str) -> dict:
        """Paths this worktree changes relative to `base` (committed, staged, unstaged and
        untracked), as {path: status letter}."""
        out = {}
        raw = self.run("diff", "--name-status", "-z", "--no-renames", base).stdout.split("\0")
        for status, path in zip(raw[0::2], raw[1::2]):
            if status:
                out[path] = status[0]
        for path in self.run("ls-files", "--others", "--exclude-standard", "-z").stdout.split("\0"):
            if path:
                out[path] = "A"
        return out

    def log(self, rev_range: str, pathspecs, limit: int = 5) -> list:
        fmt = "%h\x1f%an\x1f%ar\x1f%s"
        p = self.run("log", f"--max-count={limit}", f"--format={fmt}", rev_range, "--", *pathspecs, check=False)
        return [tuple(line.split("\x1f")) for line in p.stdout.splitlines() if line]

    def count(self, rev_range: str) -> int:
        p = self.run("rev-list", "--count", rev_range, check=False)
        return int(p.stdout.strip() or 0)

    # -- objects for coordination refs ---------------------------------------------------
    def empty_tree(self) -> str:
        return self.out("hash-object", "-t", "tree", "-w", "--stdin", input="")

    def commit_tree(self, message: str, tree: str | None = None, parents=()) -> str:
        args = ["commit-tree", tree or self.empty_tree(), "-m", message]
        for parent in parents:
            args += ["-p", parent]
        return self.out(*args, env=_identity_env())

    def message(self, sha: str) -> str:
        return self.out("log", "-1", "--format=%B", sha)

    def version(self) -> tuple:
        raw = self.out("version").split()[2]
        return tuple(int(x) for x in raw.split(".")[:2] if x.isdigit())
