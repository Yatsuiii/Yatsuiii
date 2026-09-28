"""Index a repository's declared types and source tokens (§4)."""

from __future__ import annotations

import bisect
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Set

_SKIP_DIRS = frozenset({".git", "node_modules", "target", "build", "dist", ".idea",
                        ".gradle", "out", ".svn"})
_TYPE_SUFFIXES = frozenset({".java", ".scala", ".kt", ".groovy"})
_TOKEN_SUFFIXES = _TYPE_SUFFIXES | frozenset({
    ".py", ".xml", ".properties", ".conf", ".yaml", ".yml", ".json", ".sh",
    ".template", ".thrift", ".proto", ".go", ".rb", ".js", ".ts", ".sql", ".cfg",
    ".ini", ".toml", ".jsp", ".ftl", ".vm", ".cmd", ".bat", ".ps1",
})
_DOC_DIRS = frozenset({"docs", "doc", "site", "website", "xdocs", "documentation"})
_PACKAGE = re.compile(r"^\s*package\s+([A-Za-z_][\w.]*)", re.M)
_TYPE_DECL = re.compile(
    r"(?<![\w.])(?:class|interface|enum|record|@interface|object|trait)\s+([A-Z][A-Za-z0-9_]*)"
)
_TOKEN = re.compile(r"[A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+)+")
_MAX_BYTES = 2_000_000


@dataclass
class RepoIndex:
    head: str = ""
    classes: Set[str] = field(default_factory=set)
    by_simple: Dict[str, Set[str]] = field(default_factory=dict)
    tokens: List[str] = field(default_factory=list)  # sorted, unique

    def has_type(self, fqcn: str) -> bool:
        return fqcn in self.classes

    def packages_for(self, simple: str) -> Set[str]:
        return self.by_simple.get(simple, set())

    def has_token(self, value: str) -> bool:
        i = bisect.bisect_left(self.tokens, value)
        return i < len(self.tokens) and self.tokens[i] == value

    def is_namespace(self, value: str) -> bool:
        """True if some indexed token extends ``value`` with further segments."""
        probe = value + "."
        i = bisect.bisect_left(self.tokens, probe)
        return i < len(self.tokens) and self.tokens[i].startswith(probe)


def _is_doc_path(rel_parts: tuple) -> bool:
    return any(part.lower() in _DOC_DIRS for part in rel_parts[:-1])


def build_index(root: Path) -> RepoIndex:
    """Declared types from type files; dotted tokens from non-doc source files."""
    index = RepoIndex()
    tokens: Set[str] = set()
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root).parts
        if any(part in _SKIP_DIRS for part in rel):
            continue
        suffix = path.suffix.lower()
        if suffix not in _TOKEN_SUFFIXES:
            continue
        try:
            if path.stat().st_size > _MAX_BYTES:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if suffix in _TYPE_SUFFIXES:
            package = _PACKAGE.search(text)
            if package:
                pkg = package.group(1).rstrip(";")
                names = set(_TYPE_DECL.findall(text)) | {path.stem}
                for name in names:
                    index.classes.add(f"{pkg}.{name}")
                    index.by_simple.setdefault(name, set()).add(pkg)
        if not _is_doc_path(rel):
            tokens.update(_TOKEN.findall(text))
    index.tokens = sorted(tokens)
    if (root / ".git").exists():
        proc = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(root),
                              capture_output=True, text=True)
        index.head = proc.stdout.strip()
    return index
