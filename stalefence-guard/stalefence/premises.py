"""The premise ledger (what an agent relied on, as seen at which base commit) and the check
that says whether the target branch has since changed any of it.

The check is dependency-scoped: a target that moved is fine as long as nothing the agent read,
listed or is editing moved with it. `strict` additionally fails on any movement at all.
"""
from __future__ import annotations

import contextlib
import json
import os
import time
from dataclasses import asdict, dataclass, field

from .config import Config, Target, glob_regex, ignored, matches
from .git import Repo

try:
    import fcntl
except ImportError:  # no advisory locks (Windows); writes are still atomic renames
    fcntl = None

VERSION = 1


# -- ledger storage (per worktree: parallel agents in sibling worktrees never share one) --

def ledger_path(repo: Repo) -> str:
    return os.path.join(repo.git_dir, "stalefence", "premises.json")


@contextlib.contextmanager
def _locked(repo: Repo):
    d = os.path.dirname(ledger_path(repo))
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "lock"), "w") as fh:
        if fcntl:
            fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if fcntl:
                fcntl.flock(fh, fcntl.LOCK_UN)


def load(repo: Repo) -> dict:
    p = ledger_path(repo)
    if not os.path.exists(p):
        return {"version": VERSION, "premises": {}}
    with open(p) as fh:
        return json.load(fh)


def _save(repo: Repo, data: dict) -> None:
    p = ledger_path(repo)
    tmp = f"{p}.{os.getpid()}.tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh, indent=1, sort_keys=True)
    os.replace(tmp, p)


def reset(repo: Repo) -> int:
    with _locked(repo):
        n = len(load(repo)["premises"])
        _save(repo, {"version": VERSION, "premises": {}})
    return n


def forget(repo: Repo, keys) -> int:
    with _locked(repo):
        data = load(repo)
        gone = [k for k in list(data["premises"]) if k in keys or k.split(":", 1)[1] in keys]
        for k in gone:
            del data["premises"][k]
        _save(repo, data)
    return len(gone)


# -- recording ------------------------------------------------------------------------------

def relpath(repo: Repo, path: str, cwd: str | None = None) -> str | None:
    """Repo-relative POSIX path ('' for the root), or None if outside this worktree."""
    full = os.path.realpath(os.path.join(cwd or repo.root, path))
    root = os.path.realpath(repo.root)
    if full == root:
        return ""
    if not full.startswith(root + os.sep):
        return None
    rel = os.path.relpath(full, root).replace(os.sep, "/")
    return None if rel == ".git" or rel.startswith(".git/") else rel


def base_of(repo: Repo, target: Target) -> str:
    """The commit this worktree is based on: merge-base of HEAD and the target as last fetched.
    What the agent reads in its worktree is that commit's version (plus its own edits)."""
    t = repo.rev_parse(target.ref)
    if not t:
        raise ValueError(f"target {target.ref} is not available locally; fetch it first")
    mb = repo.merge_base("HEAD", t)
    if not mb:
        raise ValueError(f"HEAD and {target.ref} share no history")
    return mb


def record_files(repo: Repo, target: Target, paths, source: str = "read", cwd: str | None = None) -> list:
    rels = [r for r in (relpath(repo, p, cwd) for p in paths) if r]
    if not rels:
        return []
    base = base_of(repo, target)
    oids = repo.entries(base, rels)
    now = time.time()
    with _locked(repo):
        data = load(repo)
        for r in rels:
            data["premises"][f"file:{r}"] = dict(kind="file", key=r, value=oids.get(r), base=base,
                                                 at=now, source=source)
        _save(repo, data)
    return rels


def anchor_glob(repo: Repo, pattern: str, cwd: str | None = None) -> str | None:
    """Make a glob repo-relative: absolute patterns lose the root prefix, relative ones gain
    the search directory's path."""
    root = os.path.realpath(repo.root)
    if os.path.isabs(pattern):
        return pattern[len(root) + 1:] if pattern.startswith(root + os.sep) else None
    d = relpath(repo, cwd or repo.root)
    if d is None:
        return None
    return f"{d}/{pattern}" if d else pattern


def record_glob(repo: Repo, target: Target, pattern: str, source: str = "glob", cwd: str | None = None,
                limit: int | None = None) -> str | None:
    """Record a listing premise. With `limit` (the hooks), exploratory globs are skipped: any
    `**` pattern, or one matching more than `limit` files. Relying on the complete result of
    such a listing is rare, and recording it would block on every unrelated new file."""
    key = anchor_glob(repo, pattern, cwd)
    if not key or (limit is not None and "**" in key):
        return None
    base = base_of(repo, target)
    found = matches(key, repo.files(base))
    if limit is not None and len(found) > limit:
        return None
    with _locked(repo):
        data = load(repo)
        data["premises"][f"glob:{key}"] = dict(kind="glob", key=key, value=found, base=base,
                                               at=time.time(), source=source)
        _save(repo, data)
    return key


# -- checking -------------------------------------------------------------------------------

@dataclass
class Finding:
    kind: str            # file | glob | written | sequence | base
    key: str
    detail: str
    commits: list = field(default_factory=list)   # (sha, author, when, subject) on the target
    blocking: bool = True


@dataclass
class Report:
    target: str
    target_sha: str
    base: str
    behind: int          # commits on the target since this worktree's base
    checked: int         # premises validated
    findings: list
    warnings: list

    @property
    def stale(self) -> bool:
        return any(f.blocking for f in self.findings)

    def as_dict(self) -> dict:
        d = asdict(self)
        d["stale"] = self.stale
        return d

    def text(self) -> str:
        lines = [f"stalefence: warning: {w}" for w in self.warnings]
        block = [f for f in self.findings if f.blocking]
        warn = [f for f in self.findings if not f.blocking]
        if not block:
            moved = (f"; {self.target} moved {self.behind} commit(s) since your base, none touching them"
                     if self.behind else "")
            lines.append(f"stalefence: fresh. {self.checked} premise(s) checked against {self.target}{moved}.")
        else:
            lines.append(f"stalefence: STALE. {len(block)} thing(s) you relied on changed on {self.target} "
                         f"since you looked:")
        for f in block + warn:
            tag = "STALE" if f.blocking else "warn "
            lines.append(f"  {tag} {f.kind:8s} {f.key}: {f.detail}")
            for sha, author, when, subject in f.commits:
                lines.append(f"           {sha} {subject} ({author}, {when})")
        if block:
            lines.append(f"Next: fetch and rebase onto {self.target}, re-read the files above, re-check "
                         "the plan against them, then retry. `stalefence check` confirms.")
        return "\n".join(lines)


def _file_detail(was, now, target: str) -> str:
    if was is None:
        return f"created on {target} after you looked (it did not exist when you read it)"
    if now is None:
        return f"deleted on {target} since you read it"
    return f"changed on {target} since you read it"


def check(repo: Repo, cfg: Config, target: Target, fetch: bool = True, strict: bool = False,
          reservations=None, me: str | None = None) -> Report:
    """`reservations`: optional {sequence: {number: owner}} from the coordination store."""
    warnings = []
    if fetch and target.remote:
        ok, err = repo.fetch(target.remote, target.refspec())
        if not ok:
            warnings.append(f"could not fetch {target.ref} ({err or 'unknown error'}); "
                            "checking against the local copy")
    t = repo.rev_parse(target.ref)
    if not t:
        raise ValueError(f"target {target.ref} not found")
    mb = repo.merge_base("HEAD", t)
    if not mb:
        raise ValueError(f"HEAD and {target.ref} share no history")
    findings, checked = [], 0
    prem = load(repo)["premises"].values()

    files = [p for p in prem if p["kind"] == "file" and not ignored(cfg, p["key"])]
    now = repo.entries(t, [p["key"] for p in files])
    for p in files:
        checked += 1
        if now.get(p["key"]) != p["value"]:
            findings.append(Finding("file", p["key"], _file_detail(p["value"], now.get(p["key"]), target.ref),
                                    repo.log(f"{p['base']}..{t}", [p["key"]])))

    for p in (p for p in prem if p["kind"] == "glob"):
        checked += 1
        cur, was = set(matches(p["key"], repo.files(t))), set(p["value"])
        added = sorted(x for x in cur - was if not ignored(cfg, x))
        removed = sorted(x for x in was - cur if not ignored(cfg, x))
        if added or removed:
            parts = ([f"new on {target.ref}: " + ", ".join(added)] if added else []) + \
                    ([f"gone from {target.ref}: " + ", ".join(removed)] if removed else [])
            findings.append(Finding("glob", p["key"], "; ".join(parts),
                                    repo.log(f"{p['base']}..{t}", [f":(glob){p['key']}"])))

    changed = repo.changed_paths(mb) if (cfg.written != "off" or cfg.sequences) else {}
    if cfg.written != "off" and mb != t:
        explicit = {p["key"] for p in files}
        mine = [x for x in changed if x not in explicit and not ignored(cfg, x)]
        at_base, at_target = repo.entries(mb, mine), repo.entries(t, mine)
        for x in mine:
            checked += 1
            if at_base.get(x) != at_target.get(x):
                findings.append(Finding(
                    "written", x, f"you are changing this file and {target.ref} changed it too since your base",
                    repo.log(f"{mb}..{t}", [x]), blocking=(cfg.written == "block")))

    findings += _sequence_findings(repo, cfg, target.ref, t, changed, reservations, me)
    behind = repo.count(f"{mb}..{t}") if mb != t else 0
    if strict and behind:
        findings.append(Finding("base", target.ref, f"moved {behind} commit(s) since your base (strict mode)",
                                repo.log(f"{mb}..{t}", [])))
    return Report(target.ref, t, mb, behind, checked, findings, warnings)


def _sequence_findings(repo, cfg, target_ref, t, changed, reservations, me) -> list:
    out = []
    added = [p for p, s in changed.items() if s == "A"]
    for name, seq in cfg.sequences.items():
        rx = glob_regex(seq["pattern"], group="n")
        mine = {}
        for p in added:
            m = rx.match(p)
            if m:
                mine.setdefault(int(m["n"]), []).append(p)
        if not mine:
            continue
        theirs = {}
        for p in repo.files(t):
            m = rx.match(p)
            if m:
                theirs.setdefault(int(m["n"]), []).append(p)
        held = (reservations or {}).get(name, {})
        for n, paths in sorted(mine.items()):
            other = [q for q in theirs.get(n, []) if q not in paths]
            if other:
                out.append(Finding("sequence", f"{name} {n}",
                                   f"you added {paths[0]}, but {target_ref} already has {other[0]}"))
            if len(paths) > 1:
                out.append(Finding("sequence", f"{name} {n}", f"your branch adds {len(paths)} files numbered {n}"))
            owner = held.get(n)
            if owner and me and owner != me:
                out.append(Finding("sequence", f"{name} {n}", f"number {n} is reserved by {owner}"))
    return out
