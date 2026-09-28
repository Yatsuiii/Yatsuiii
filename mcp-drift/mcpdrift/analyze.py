"""Orchestration: clone a server, walk its window, accumulate drift events."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import git
from .diff import diff_snapshots, index_tools
from .extract import EXCLUDED_DIRS, SUPPORTED_SUFFIXES, TEST_MARKERS, extract_file
from .models import ServerReport, ToolDef


@dataclass(frozen=True)
class ServerSpec:
    """One entry from the seed list: ``url`` or ``url#subpath``."""

    url: str
    subpath: str | None = None

    @classmethod
    def parse(cls, line: str) -> "ServerSpec | None":
        line = line.split("#comment")[0].strip()
        if not line or line.startswith("#"):
            return None
        url, _, subpath = line.partition("#")
        return cls(url.strip(), subpath.strip() or None)

    @property
    def name(self) -> str:
        slug = self.url.rstrip("/").removesuffix(".git").split("/")[-2:]
        base = "/".join(slug)
        return f"{base}#{self.subpath}" if self.subpath else base

    @property
    def cache_key(self) -> str:
        return self.url.rstrip("/").removesuffix(".git").replace("://", "_").replace("/", "_")


def _is_candidate_path(path: str, subpath: str | None) -> bool:
    if subpath and not path.startswith(f"{subpath.rstrip('/')}/"):
        return False
    if not any(path.endswith(s) for s in SUPPORTED_SUFFIXES):
        return False
    parts = path.split("/")
    if any(p in EXCLUDED_DIRS for p in parts):
        return False
    return not any(marker in f"/{path}" for marker in TEST_MARKERS)


def tracked_paths(repo: Path, head: str, subpath: str | None,
                  commits: list) -> list[str]:
    """Paths worth reading across the whole window.

    The union of (a) files declaring tools at HEAD and (b) every candidate file
    touched during the window. (b) matters because a file can stop declaring
    tools before HEAD -- reading only HEAD's set would make those declarations
    invisible and understate removals.
    """
    paths = {p for p in git.marker_files(repo, head, subpath)
             if _is_candidate_path(p, subpath)}
    for commit in commits:
        paths.update(p for p in commit.changed_files if _is_candidate_path(p, subpath))
    return sorted(paths)


def snapshot(repo: Path, sha: str, paths: list[str]) -> dict[str, ToolDef] | None:
    """Tool surface at ``sha``. ``None`` means extraction failed for this commit."""
    try:
        present = git.files_at(repo, sha, paths)
    except git.GitError:
        return None
    tools: list[ToolDef] = []
    failures = 0
    considered = 0
    for path in present:
        text = git.read_file_at(repo, sha, path)
        if text is None:
            continue
        if not any(m in text for m in git.MARKERS):
            continue
        considered += 1
        suffix = "." + path.rsplit(".", 1)[-1]
        try:
            found = extract_file(text, suffix, path)
        except (SyntaxError, ValueError, RecursionError):
            failures += 1
            continue
        tools.extend(found)
    if considered and failures == considered:
        return None
    return index_tools(tools)


def analyze_server(
    spec: ServerSpec,
    workdir: Path,
    window_days: int = 90,
    min_age_days: int = 180,
    max_snapshots: int = 60,
) -> ServerReport:
    report = ServerReport(server=spec.name, url=spec.url, subpath=spec.subpath)
    dest = workdir / spec.cache_key

    try:
        git.clone(spec.url, dest, window_days)
    except git.GitError as exc:
        report.skip_reason = f"clone failed: {exc}"
        return report

    first = git.first_commit_date(dest)
    report.first_commit = first
    if first is not None:
        report.age_days = (datetime.now(timezone.utc) - first).days

    commits = git.commits_in_window(dest, window_days, spec.subpath)
    report.commits_in_window = len(commits)

    touching = [c for c in commits
                if any(_is_candidate_path(f, spec.subpath) for f in c.changed_files)]
    report.tool_touching_commits = len(touching)

    head = git.head_sha(dest)
    paths = tracked_paths(dest, head, spec.subpath, commits)
    head_tools = snapshot(dest, head, paths)
    if head_tools is None or not head_tools:
        report.skip_reason = "no tool declarations extractable at HEAD"
        return report
    report.tools_at_head = len(head_tools)
    report.schema_visible = any(t.params is not None for t in head_tools.values())

    # A repo younger than the maturity floor is under initial development;
    # churn there is not post-approval drift and must not inflate the headline.
    horizon = datetime.now(timezone.utc) - timedelta(days=min_age_days)
    if first is not None and first > horizon:
        report.skip_reason = (
            f"repo younger than maturity floor "
            f"({report.age_days}d < {min_age_days}d)"
        )
        return report

    report.analyzable = True
    if not touching:
        report.extraction_coverage = 1.0
        return report

    if len(touching) > max_snapshots:
        touching = touching[-max_snapshots:]

    base_sha = git.baseline_sha(dest, window_days)
    previous = snapshot(dest, base_sha, paths) if base_sha else None
    if not previous:
        # No pre-window baseline in the clone: start from the first in-window
        # state so that state itself is never reported as a change.
        previous = snapshot(dest, touching[0].sha, paths)
        touching = touching[1:]

    attempted = 0
    succeeded = 0
    for commit in touching:
        attempted += 1
        current = snapshot(dest, commit.sha, paths)
        if current is None or (previous and not current):
            # Empty-after-nonempty is far more likely a parser miss than a
            # server deleting every tool; skip rather than emit a false storm.
            continue
        succeeded += 1
        if previous is not None:
            report.events.extend(
                diff_snapshots(spec.name, previous, current, commit.sha, commit.timestamp)
            )
        previous = current

    report.extraction_coverage = (succeeded / attempted) if attempted else 1.0
    return report
