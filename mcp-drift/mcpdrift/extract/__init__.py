"""Language dispatch and extraction-coverage accounting.

The coverage bookkeeping here is load-bearing for the experiment's honesty: a
file that *looks* like it declares tools but yields none is recorded as a
failure, not as an absence. Servers whose extraction fails are excluded from the
headline denominator rather than silently counted as drift-free.
"""

from __future__ import annotations

from pathlib import Path

from ..models import ExtractionResult, ToolDef
from . import python_ast, typescript

PY_SUFFIXES = {".py"}
TS_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".cjs"}
SUPPORTED_SUFFIXES = PY_SUFFIXES | TS_SUFFIXES

#: Directories that never contain first-party tool declarations. Scanning them
#: is slow and, worse, vendored copies would double-count.
EXCLUDED_DIRS = frozenset({
    "node_modules", ".git", "dist", "build", "out", "vendor", "third_party",
    "__pycache__", ".venv", "venv", "site-packages", ".tox", "coverage",
})
#: Test files declare fixture tools that are not part of the public surface.
TEST_MARKERS = ("test_", "_test.", ".test.", ".spec.", "/tests/", "/__tests__/")

MAX_FILE_BYTES = 800_000


def _is_excluded(path: Path, root: Path) -> bool:
    rel = path.relative_to(root).as_posix()
    if any(part in EXCLUDED_DIRS for part in path.relative_to(root).parts):
        return True
    return any(marker in f"/{rel}" for marker in TEST_MARKERS)


def candidate_files(root: Path, subpath: str | None = None) -> list[Path]:
    base = root / subpath if subpath else root
    if not base.exists():
        return []
    out: list[Path] = []
    for path in base.rglob("*"):
        if not path.is_file() or path.suffix not in SUPPORTED_SUFFIXES:
            continue
        if _is_excluded(path, root):
            continue
        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                continue
        except OSError:
            continue
        out.append(path)
    return out


def _has_marker(text: str, suffix: str) -> bool:
    markers = python_ast.FILE_MARKERS if suffix in PY_SUFFIXES else typescript.FILE_MARKERS
    return any(m in text for m in markers)


def extract_file(text: str, suffix: str, rel_path: str) -> list[ToolDef]:
    if suffix in PY_SUFFIXES:
        return python_ast.extract(text, rel_path)
    return typescript.extract(text, rel_path)


def extract_tree(root: Path, subpath: str | None = None) -> ExtractionResult:
    """Extract every tool declaration under ``root`` (optionally one subpath)."""
    tools: list[ToolDef] = []
    failed: list[str] = []
    scanned = 0
    with_tools = 0

    for path in candidate_files(root, subpath):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        scanned += 1
        if not _has_marker(text, path.suffix):
            continue
        rel = path.relative_to(root).as_posix()
        try:
            found = extract_file(text, path.suffix, rel)
        except (SyntaxError, ValueError, RecursionError):
            failed.append(rel)
            continue
        if found:
            with_tools += 1
            tools.extend(found)
        else:
            # Marker present but nothing parsed: a genuine extraction miss.
            failed.append(rel)

    return ExtractionResult(
        tools=tuple(tools),
        files_scanned=scanned,
        files_with_tools=with_tools,
        files_failed=tuple(failed),
    )
