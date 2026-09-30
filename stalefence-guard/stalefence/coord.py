"""Coordination without a server: sequence-number reservations and task claims stored as git
refs, created and replaced with compare-and-swap, so two agents can never both win.

Refs live under `refs/stalefence/`. Each points at a tiny commit whose message holds the
metadata (owner, branch, time, expiry). Stores:
  * local  — the repository's own ref store, shared by every worktree on this machine
             (`git update-ref` with an expected old value);
  * remote — a git remote such as origin, shared by every machine (`git push
             --force-with-lease=<ref>:<expected>`; an empty expectation means "must not exist").
"""
from __future__ import annotations

import getpass
import json
import os
import re
import time

from .config import Config, glob_regex
from .git import Repo

NS = "refs/stalefence"


def owner(repo: Repo) -> str:
    """Who is acting: STALEFENCE_OWNER, else `<git email or user>:<branch or worktree dir>`."""
    env = os.environ.get("STALEFENCE_OWNER")
    if env:
        return env
    who = repo.config("user.email") or getpass.getuser()
    where = repo.branch() or os.path.basename(repo.root)
    return f"{who}:{where}"


def now() -> float:
    return float(os.environ.get("STALEFENCE_NOW") or time.time())


def safe_name(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip(".-")
    if not s or ".." in s or s.endswith(".lock"):
        raise ValueError(f"cannot use {name!r} as a name")
    return s


class LocalStore:
    kind = "local"

    def __init__(self, repo: Repo):
        self.repo = repo

    def list(self, prefix: str) -> dict:
        out = self.repo.run("for-each-ref", "--format=%(objectname) %(refname)", prefix, check=False).stdout
        return {ref: sha for sha, ref in (line.split(" ", 1) for line in out.splitlines() if line)}

    def swap(self, ref: str, new: str | None, expect: str | None) -> bool:
        """Set ref to new (None deletes) only if it currently equals expect (None: absent)."""
        if new is None:
            return self.repo.ok("update-ref", "-d", ref, expect or "")
        return self.repo.ok("update-ref", ref, new, expect or "")

    def message(self, sha: str) -> str:
        return self.repo.message(sha)


class RemoteStore:
    kind = "remote"

    def __init__(self, repo: Repo, remote: str):
        self.repo, self.remote = repo, remote

    def list(self, prefix: str) -> dict:
        p = self.repo.run("ls-remote", self.remote, f"{prefix}/*", check=False, timeout=30)
        if p.returncode != 0:
            raise RuntimeError(f"cannot list {prefix} on {self.remote}: {p.stderr.strip()}")
        out = {}
        for line in p.stdout.splitlines():
            sha, ref = line.split("\t", 1)
            out[ref] = sha
        return out

    def swap(self, ref: str, new: str | None, expect: str | None) -> bool:
        src = f"{new}:{ref}" if new else f":{ref}"
        # --no-verify: a coordination ref is not work being published, so pre-push hooks
        # (including ours) have nothing to say about it.
        p = self.repo.run("push", "--quiet", "--porcelain", "--no-verify",
                          f"--force-with-lease={ref}:{expect or ''}", self.remote, src,
                          check=False, timeout=60)
        return p.returncode == 0

    def message(self, sha: str) -> str:
        if not self.repo.ok("cat-file", "-e", f"{sha}^{{commit}}"):
            self.repo.run("fetch", "--quiet", "--no-tags", self.remote,
                          f"+{NS}/*:refs/stalefence-remote/{self.remote}/*", check=False, timeout=60)
        return self.repo.message(sha)


def store(repo: Repo, cfg: Config, override: str | None = None):
    choice = override or os.environ.get("STALEFENCE_COORDINATION") or cfg.coordination
    if choice == "local":
        return LocalStore(repo)
    if choice == "auto":
        return RemoteStore(repo, "origin") if "origin" in repo.remotes() else LocalStore(repo)
    if choice not in repo.remotes():
        raise ValueError(f"coordination remote {choice!r} does not exist")
    return RemoteStore(repo, choice)


def _meta(st, sha: str) -> dict:
    """Metadata of a coordination commit. Raises if it cannot be read: guessing would let an
    agent treat someone's live claim as expired."""
    try:
        return json.loads(st.message(sha))
    except ValueError:
        return {"owner": "?", "expires_at": float("inf")}


def _stamp(repo: Repo, **fields) -> str:
    fields.setdefault("tool", "stalefence")
    return repo.commit_tree(json.dumps(fields, sort_keys=True))


# -- sequence reservations -------------------------------------------------------------------

def numbers_in(paths, pattern: str) -> set:
    rx = glob_regex(pattern, group="n")
    return {int(m["n"]) for m in (rx.match(p) for p in paths) if m}


def reservations(st, sequence: str | None = None) -> dict:
    """{sequence: {number: owner}} for every reservation in the store."""
    out = {}
    prefix = f"{NS}/reserve" + (f"/{safe_name(sequence)}" if sequence else "")
    for ref, sha in st.list(prefix).items():
        parts = ref.split("/")
        if len(parts) >= 5 and parts[-1].isdigit():
            out.setdefault(parts[-2], {})[int(parts[-1])] = _meta(st, sha).get("owner", "?")
    return out


def reserve(repo: Repo, cfg: Config, st, sequence: str, target_sha: str, tries: int = 50,
            start: int | None = None) -> tuple:
    """Atomically take the next free number: above everything on the target, on this branch
    and already reserved. Returns (number, formatted)."""
    seq = cfg.sequences.get(sequence)
    if not seq:
        raise ValueError(f"unknown sequence {sequence!r}; define it under `sequences` in .stalefence.json")
    used = numbers_in(repo.files(target_sha), seq["pattern"]) | numbers_in(repo.files("HEAD"), seq["pattern"])
    used |= numbers_in(repo.changed_paths("HEAD"), seq["pattern"])
    used |= set(reservations(st, sequence).get(safe_name(sequence), {}))
    n = max(used | {int(seq.get("start", 1)) - 1}) + 1
    if start is not None:
        n = max(n, start)
    me = owner(repo)
    prefix = f"{NS}/reserve/{safe_name(sequence)}"
    for _ in range(tries):
        ref = f"{prefix}/{n}"
        stamp = _stamp(repo, kind="reserve", sequence=sequence, number=n, owner=me,
                       branch=repo.branch(), at=now())
        if st.swap(ref, stamp, None):
            return n, format_number(cfg, sequence, n)
        if ref not in st.list(prefix):
            raise RuntimeError(f"could not write {ref} to the {st.kind} store (check access to it)")
        n += 1          # someone else took n between our scan and our write
    raise RuntimeError(f"could not reserve a {sequence} number after {tries} attempts")


def format_number(cfg: Config, sequence: str, n: int) -> str:
    width = int(cfg.sequences.get(sequence, {}).get("width", 0))
    return str(n).zfill(width) if width else str(n)


def release(repo: Repo, st, sequence: str, n: int, force: bool = False) -> bool:
    ref = f"{NS}/reserve/{safe_name(sequence)}/{int(n)}"
    cur = st.list(ref.rsplit("/", 1)[0]).get(ref)
    if not cur:
        return False
    if not force and _meta(st, cur).get("owner") != owner(repo):
        raise PermissionError(f"{sequence} {n} is reserved by {_meta(st, cur).get('owner')}; use --force")
    return st.swap(ref, None, cur)


# -- task claims ------------------------------------------------------------------------------

def parse_ttl(text: str) -> float:
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([smhd]?)\s*", text)
    if not m:
        raise ValueError(f"bad duration {text!r}; use e.g. 90s, 30m, 2h, 1d")
    return float(m[1]) * {"": 1, "s": 1, "m": 60, "h": 3600, "d": 86400}[m[2]]


def claims(st) -> list:
    out = []
    for ref, sha in sorted(st.list(f"{NS}/claims").items()):
        meta = _meta(st, sha)
        meta.update(task=ref.rsplit("/", 1)[1], sha=sha, expired=meta.get("expires_at", 0) <= now())
        out.append(meta)
    return out


def claim(repo: Repo, st, task: str, ttl: float, note: str = "") -> tuple:
    """Take (or renew) a lease on a task. Returns (ok, holder_meta, action)."""
    ref = f"{NS}/claims/{safe_name(task)}"
    me = owner(repo)
    for _ in range(5):
        cur = st.list(f"{NS}/claims").get(ref)
        meta = _meta(st, cur) if cur else {}
        if cur and meta.get("owner") != me and meta.get("expires_at", 0) > now():
            return False, meta, "held"
        action = "claimed" if not cur else ("renewed" if meta.get("owner") == me else "took over (expired)")
        stamp = _stamp(repo, kind="claim", task=task, owner=me, branch=repo.branch(), at=now(),
                       expires_at=now() + ttl, note=note)
        if st.swap(ref, stamp, cur):
            return True, {"owner": me, "expires_at": now() + ttl}, action
        if st.list(f"{NS}/claims").get(ref) == cur:
            raise RuntimeError(f"could not write {ref} to the {st.kind} store (check access to it)")
    return False, {}, "lost the race repeatedly"


def unclaim(repo: Repo, st, task: str, force: bool = False) -> bool:
    ref = f"{NS}/claims/{safe_name(task)}"
    cur = st.list(f"{NS}/claims").get(ref)
    if not cur:
        return False
    holder = _meta(st, cur).get("owner")
    if not force and holder != owner(repo):
        raise PermissionError(f"{task} is claimed by {holder}; use --force")
    return st.swap(ref, None, cur)
