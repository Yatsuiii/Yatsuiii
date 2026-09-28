"""Core data model for MCP tool-definition drift analysis.

The unit of analysis is a ``ToolDef``: one MCP tool as *declared* in source at a
particular commit. Everything downstream diffs sequences of these.

A deliberate design constraint runs through this module: fields that could not be
statically extracted are ``None``, never an empty collection. ``None`` means "we
could not see this", ``()`` means "we looked and there was nothing". Conflating
the two would silently inflate the no-drift denominator, which is the single
easiest way for this experiment to lie to us.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

Severity = Literal["HIGH", "MEDIUM", "LOW"]

#: Annotation hints defined by the MCP spec, mapped to the value considered
#: "safe". A transition away from the safe value is a privilege expansion.
SAFE_ANNOTATION_VALUES: dict[str, bool] = {
    "readOnlyHint": True,
    "destructiveHint": False,
    "idempotentHint": True,
    "openWorldHint": False,
}


@dataclass(frozen=True)
class ToolDef:
    """One MCP tool as declared in source at a single commit."""

    name: str
    description: str | None = None
    annotations: dict[str, bool] | None = None
    params: tuple[str, ...] | None = None
    required_params: tuple[str, ...] | None = None
    source_file: str = ""
    #: True when the declared name was a symbol (``GitTools.STATUS``) rather than
    #: a string literal. The resolved runtime name is unknown; we track the
    #: symbol so a *change* of symbol is still detectable.
    name_is_symbolic: bool = False

    def __hash__(self) -> int:
        return hash((self.name, self.source_file))


@dataclass(frozen=True)
class ExtractionResult:
    """Tools recovered from one commit, plus honest accounting of what we missed."""

    tools: tuple[ToolDef, ...]
    files_scanned: int
    files_with_tools: int
    #: Files that contained a tool-declaration marker but yielded no parsed tool.
    files_failed: tuple[str, ...] = ()

    @property
    def extraction_ok(self) -> bool:
        return bool(self.tools) and not self.files_failed


@dataclass(frozen=True)
class Commit:
    sha: str
    timestamp: datetime
    changed_files: tuple[str, ...]


@dataclass(frozen=True)
class DriftEvent:
    """A single material change to a tool declaration between two commits."""

    server: str
    tool: str
    kind: str
    severity: Severity
    commit: str
    timestamp: datetime
    detail: str
    before: str | None = None
    after: str | None = None

    def to_dict(self) -> dict:
        return {
            "server": self.server,
            "tool": self.tool,
            "kind": self.kind,
            "severity": self.severity,
            "commit": self.commit,
            "timestamp": self.timestamp.isoformat(),
            "detail": self.detail,
            "before": self.before,
            "after": self.after,
        }


@dataclass
class ServerReport:
    """Per-repository outcome. ``analyzable`` gates inclusion in headline stats."""

    server: str
    url: str
    subpath: str | None = None
    analyzable: bool = False
    skip_reason: str | None = None
    first_commit: datetime | None = None
    age_days: int | None = None
    commits_in_window: int = 0
    tool_touching_commits: int = 0
    tools_at_head: int = 0
    events: list[DriftEvent] = field(default_factory=list)
    #: Fraction of tool-touching commits where extraction succeeded.
    extraction_coverage: float = 0.0
    schema_visible: bool = False

    @property
    def material_events(self) -> list[DriftEvent]:
        return [e for e in self.events if e.severity in ("HIGH", "MEDIUM")]

    @property
    def has_material_drift(self) -> bool:
        return bool(self.material_events)

    def to_dict(self) -> dict:
        return {
            "server": self.server,
            "url": self.url,
            "subpath": self.subpath,
            "analyzable": self.analyzable,
            "skip_reason": self.skip_reason,
            "age_days": self.age_days,
            "commits_in_window": self.commits_in_window,
            "tool_touching_commits": self.tool_touching_commits,
            "tools_at_head": self.tools_at_head,
            "extraction_coverage": round(self.extraction_coverage, 3),
            "schema_visible": self.schema_visible,
            "material_event_count": len(self.material_events),
            "events": [e.to_dict() for e in self.events],
        }
