"""Thin git layer: clone into a window, enumerate commits, read files at a SHA.

Files are read with ``git show <sha>:<path>`` rather than by checking out each
commit. Checkout churn dominates runtime on repos with many commits, and a
detached-HEAD walk is easy to leave in a broken state on failure.
``git grep -l`` narrows to marker-bearing files in one call per commit.
"""

from __future__ import annotations

import shutil
import subprocess
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .models import Commit

GIT_TIMEOUT = 300
MARKERS = ("registerTool", "ListToolsRequestSchema", "Tool(", ".tool(", "FastMCP", "add_tool")
PATHSPEC = ("*.py", "*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs")


class GitError(RuntimeError):
    pass


def _run(args: list[str], cwd: Path | None = None, check: bool = True) -> str:
    try:
        proc = subprocess.run(
            args, cwd=cwd, capture_output=True, text=True,
            timeout=GIT_TIMEOUT, errors="replace",
        )
    except subprocess.TimeoutExpired as exc:
        raise GitError(f"timed out: {' '.join(args[:4])}") from exc
    if check and proc.returncode != 0:
        raise GitError(proc.stderr.strip()[:400] or f"git failed: {' '.join(args[:4])}")
    return proc.stdout


_CLONE_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def _clone_lock(key: str) -> threading.Lock:
    with _LOCKS_GUARD:
        return _CLONE_LOCKS.setdefault(key, threading.Lock())


def clone(url: str, dest: Path, window_days: int) -> Path:
    """Clone the full commit graph without blobs.

    A shallow clone is tempting and wrong here: its oldest reachable commit is
    the graft boundary, not the repo's first commit, so every repository looks
    exactly as old as the clone depth. The maturity filter reads repo age, so a
    shallow clone silently rejects every server and the experiment returns NO
    DATA regardless of the truth. ``--filter=blob:none`` keeps all commits and
    trees (cheap, ~1.5s on a 4k-commit repo) and fetches file contents only for
    the handful of paths actually read.

    Monorepos appear once per subpath in the seed list, so several threads race
    for the same destination. The per-destination lock serialises them, and the
    clone lands in a temp directory that is renamed into place only on success:
    ``dest`` existing therefore always means a complete clone, never a partial
    one left behind by a failed or concurrent attempt.

    """
    with _clone_lock(str(dest)):
        if (dest / ".git").is_dir():
            return dest
        shutil.rmtree(dest, ignore_errors=True)

        base = ["git", "clone", "--quiet", "--single-branch", "--no-tags"]
        tmp = dest.with_name(f"{dest.name}.tmp{threading.get_ident()}")
        shutil.rmtree(tmp, ignore_errors=True)
        try:
            try:
                _run([*base, "--filter=blob:none", url, str(tmp)])
            except GitError:
                # Server does not support partial clone; fall back to full.
                shutil.rmtree(tmp, ignore_errors=True)
                _run([*base, url, str(tmp)])
            tmp.rename(dest)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    return dest


def first_commit_date(repo: Path) -> datetime | None:
    """Date of the repository's first commit.

    Exact, because :func:`clone` keeps the full commit graph. Used by the
    maturity filter to separate post-approval drift from initial development.
    """
    out = _run(["git", "log", "--reverse", "--format=%at", "--max-parents=0"],
               cwd=repo, check=False).strip()
    if not out:
        out = _run(["git", "log", "--reverse", "--format=%at"], cwd=repo, check=False).strip()
    if not out:
        return None
    return datetime.fromtimestamp(int(out.splitlines()[0]), tz=timezone.utc)


def head_sha(repo: Path) -> str:
    return _run(["git", "rev-parse", "HEAD"], cwd=repo).strip()


def commits_in_window(repo: Path, window_days: int, subpath: str | None = None) -> list[Commit]:
    """Commits within the window, oldest first, with their changed paths."""
    since = (datetime.now(timezone.utc) - timedelta(days=window_days)).strftime("%Y-%m-%d")
    args = ["git", "log", "--reverse", f"--since={since}",
            "--format=__C__%H|%at", "--name-only", "--no-merges"]
    if subpath:
        args += ["--", subpath]
    out = _run(args, cwd=repo, check=False)

    commits: list[Commit] = []
    sha = ""
    ts = 0
    files: list[str] = []
    for line in out.splitlines():
        if line.startswith("__C__"):
            if sha:
                commits.append(Commit(sha, datetime.fromtimestamp(ts, tz=timezone.utc), tuple(files)))
            payload = line[5:]
            sha, _, raw_ts = payload.partition("|")
            ts = int(raw_ts or 0)
            files = []
        elif line.strip():
            files.append(line.strip())
    if sha:
        commits.append(Commit(sha, datetime.fromtimestamp(ts, tz=timezone.utc), tuple(files)))
    return commits


def baseline_sha(repo: Path, window_days: int) -> str | None:
    """Last commit strictly before the window opens, if the clone reaches it."""
    since = (datetime.now(timezone.utc) - timedelta(days=window_days)).strftime("%Y-%m-%d")
    out = _run(["git", "log", "-1", f"--until={since}", "--format=%H"],
               cwd=repo, check=False).strip()
    return out or None


def files_at(repo: Path, sha: str, paths: list[str]) -> list[str]:
    """Subset of ``paths`` that exist at ``sha`` (one git call)."""
    if not paths:
        return []
    out = _run(["git", "ls-tree", "-r", "--name-only", sha, "--", *paths],
               cwd=repo, check=False)
    return [line.strip() for line in out.splitlines() if line.strip()]


def marker_files(repo: Path, sha: str, subpath: str | None = None) -> list[str]:
    """Paths at ``sha`` containing any tool-declaration marker (one git call).

    Called once per server at HEAD rather than at every commit: on a blobless
    clone each grep materialises the blobs it searches, so grepping the whole
    history would defeat the partial clone.
    """
    args = ["git", "grep", "-l", "-I"]
    for marker in MARKERS:
        args += ["-e", marker]
    args += [sha, "--", *( [f"{subpath}/{p}" for p in PATHSPEC] if subpath else list(PATHSPEC) )]
    out = _run(args, cwd=repo, check=False)
    paths = []
    for line in out.splitlines():
        _, _, path = line.partition(":")
        if path:
            paths.append(path)
    return paths


def read_file_at(repo: Path, sha: str, path: str) -> str | None:
    try:
        return _run(["git", "show", f"{sha}:{path}"], cwd=repo)
    except GitError:
        return None
