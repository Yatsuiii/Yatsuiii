"""Repository configuration (`.stalefence.json` at the repo root, all keys optional) and
target resolution."""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field

from .git import Repo

CONFIG_FILE = ".stalefence.json"
DEFAULT_GUARDED = [r"\bgit\s+push\b", r"\bgh\s+pr\s+merge\b"]


@dataclass
class Config:
    target: str | None = None               # e.g. "origin/main"; auto-detected when unset
    coordination: str = "auto"              # "auto" | "local" | a remote name, for reserve/claim
    sequences: dict = field(default_factory=dict)  # name -> {"pattern": "...{n}...", "width": 4}
    merge_check: object = None              # command (list or shell string) for merge-check
    ignore: list = field(default_factory=list)     # globs whose premises are never checked
    written: str = "block"                  # "block" | "warn" | "off" for files the branch edits
    glob_limit: int = 100                   # hooks skip globs with `**` or more matches than this
    guarded_commands: list = field(default_factory=lambda: list(DEFAULT_GUARDED))

    @classmethod
    def load(cls, repo: Repo) -> "Config":
        path = os.path.join(repo.root, CONFIG_FILE)
        if not os.path.exists(path):
            return cls()
        with open(path) as fh:
            raw = json.load(fh)
        known = {k: raw[k] for k in cls.__dataclass_fields__ if k in raw}
        unknown = sorted(set(raw) - set(known))
        if unknown:
            raise ValueError(f"{CONFIG_FILE}: unknown keys {unknown}")
        cfg = cls(**known)
        if cfg.written not in ("block", "warn", "off"):
            raise ValueError(f"{CONFIG_FILE}: 'written' must be block, warn or off")
        for name, seq in cfg.sequences.items():
            if "{n}" not in seq.get("pattern", ""):
                raise ValueError(f"{CONFIG_FILE}: sequence {name!r} needs a pattern containing {{n}}")
        return cfg


@dataclass
class Target:
    ref: str                 # e.g. "origin/main" or "main"
    remote: str | None       # remote to fetch from, None for a local branch
    branch: str              # branch name on that remote (or local branch)

    def refspec(self) -> str:
        return f"+refs/heads/{self.branch}:refs/remotes/{self.remote}/{self.branch}"


def resolve_target(repo: Repo, cfg: Config, override: str | None = None) -> Target:
    ref = override or os.environ.get("STALEFENCE_TARGET") or cfg.target or repo.config("stalefence.target")
    if not ref:
        head = repo.run("symbolic-ref", "--quiet", "refs/remotes/origin/HEAD", check=False).stdout.strip()
        if head.startswith("refs/remotes/"):
            ref = head[len("refs/remotes/"):]
    if not ref:
        for cand in ("origin/main", "origin/master", "main", "master"):
            if repo.rev_parse(cand):
                ref = cand
                break
    if not ref:
        raise ValueError("no target branch found; set it with --target, STALEFENCE_TARGET, "
                         f"`target` in {CONFIG_FILE} or `git config stalefence.target`")
    for remote in sorted(repo.remotes(), key=len, reverse=True):
        if ref.startswith(remote + "/"):
            return Target(ref=ref, remote=remote, branch=ref[len(remote) + 1:])
    return Target(ref=ref, remote=None, branch=ref)


def glob_regex(pattern: str, group: str | None = None) -> re.Pattern:
    """Translate a repo-relative glob to a regex: `**` crosses directories, `*` and `?` do
    not, `[...]` is a character class. With `group`, `{n}` becomes a named digit group."""
    out, i = [], 0
    while i < len(pattern):
        c = pattern[i]
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif c == "*":
            out.append("[^/]*")
            i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        elif c == "[":
            j = pattern.find("]", i + 1)
            if j == -1:
                out.append(re.escape(c))
                i += 1
            else:
                body = pattern[i + 1:j]
                out.append("[" + ("^" + body[1:] if body.startswith("!") else body) + "]")
                i = j + 1
        elif group and pattern.startswith("{n}", i):
            out.append(f"(?P<{group}>\\d+)")
            i += 3
        else:
            out.append(re.escape(c))
            i += 1
    return re.compile("".join(out) + r"\Z")


def matches(pattern: str, paths) -> list:
    rx = glob_regex(pattern)
    return sorted(p for p in paths if rx.match(p))


def ignored(cfg: Config, path: str) -> bool:
    return any(glob_regex(g).match(path) for g in cfg.ignore)
