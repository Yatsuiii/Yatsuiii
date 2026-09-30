"""merge-check: build the commit that merging would produce (without touching the worktree)
and run a command against it. Catches the merges git calls clean that break anyway, e.g. a
branch that uses a symbol the target just moved elsewhere."""
from __future__ import annotations

import os
import shlex
import subprocess
import tempfile
from dataclasses import dataclass, field

from .git import Repo


@dataclass
class MergeResult:
    target: str
    target_sha: str
    head: str
    tree: str | None
    conflicts: list = field(default_factory=list)
    command: str | None = None
    returncode: int | None = None
    output: str = ""
    dirty: bool = False

    @property
    def ok(self) -> bool:
        return not self.conflicts and (self.returncode in (None, 0))

    def text(self) -> str:
        lines = []
        if self.dirty:
            lines.append("stalefence: warning: uncommitted changes are not part of the merge being checked")
        if self.conflicts:
            lines.append(f"stalefence: merging {self.target} would conflict in {len(self.conflicts)} file(s):")
            lines += [f"  {p}" for p in self.conflicts]
            return "\n".join(lines)
        if self.command is None:
            lines.append(f"stalefence: merge with {self.target} is textually clean "
                         "(pass a command after -- to test the merged result)")
        elif self.returncode == 0:
            lines.append(f"stalefence: merge with {self.target} is clean and `{self.command}` passes on it")
        else:
            lines.append(f"stalefence: merge with {self.target} is textually clean, but `{self.command}` "
                         f"FAILS on the merged result (exit {self.returncode}):")
            tail = self.output.strip().splitlines()[-25:]
            lines += [f"  | {line}" for line in tail]
        return "\n".join(lines)


def merge_check(repo: Repo, target_ref: str, target_sha: str, command=None, timeout: float | None = None) -> MergeResult:
    if repo.version() < (2, 38):
        raise RuntimeError("merge-check needs git 2.38 or newer (git merge-tree --write-tree)")
    head = repo.head()
    dirty = bool(repo.out("status", "--porcelain", "--untracked-files=no"))
    p = repo.run("merge-tree", "--write-tree", "--name-only", "--no-messages", head, target_sha, check=False)
    if p.returncode not in (0, 1):
        raise RuntimeError(f"git merge-tree failed: {p.stderr.strip()}")
    lines = p.stdout.splitlines()
    tree, conflicts = (lines[0] if lines else None), [x for x in lines[1:] if x]
    res = MergeResult(target_ref, target_sha, head, tree, conflicts, dirty=dirty)
    if p.returncode == 1 or command is None:
        return res
    merged = repo.commit_tree(f"stalefence merge-check: {head[:12]} + {target_ref}", tree=tree,
                              parents=(head, target_sha))
    shell = isinstance(command, str)
    res.command = command if shell else shlex.join(command)
    tmp = tempfile.mkdtemp(prefix="stalefence-merge-")
    try:
        repo.run("worktree", "add", "--detach", "--quiet", tmp, merged)
        env = dict(os.environ, STALEFENCE_MERGE_CHECK="1")
        try:
            run = subprocess.run(command, cwd=tmp, shell=shell, capture_output=True, text=True,
                                 env=env, timeout=timeout)
            res.returncode, res.output = run.returncode, run.stdout + run.stderr
        except subprocess.TimeoutExpired as e:
            res.returncode, res.output = 124, f"timed out after {e.timeout}s"
        except OSError as e:
            res.returncode, res.output = 127, str(e)
    finally:
        repo.run("worktree", "remove", "--force", tmp, check=False)
        repo.run("worktree", "prune", check=False)
    return res
