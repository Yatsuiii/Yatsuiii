"""Diff two snapshots of a server's tool surface and classify the changes.

Severity encodes the thesis under test -- that MCP tools mutate *after* a user
has approved them -- rather than generic "something changed":

HIGH    a privilege or reach expansion: an annotation weakened, or the
        description acquiring language implying new capability. This is the
        tool-poisoning shape.
MEDIUM  the contract a caller agreed to moved: description rewritten, required
        parameters changed, tool renamed.
LOW     surface changed but visibly and without expanding reach: tool added or
        removed.

Only HIGH and MEDIUM count toward the headline number.
"""

from __future__ import annotations

from datetime import datetime

from .extract.heuristics import description_is_material_change, normalize_description, scope_terms
from .models import SAFE_ANNOTATION_VALUES, DriftEvent, ToolDef


def index_tools(tools: tuple[ToolDef, ...] | list[ToolDef]) -> dict[str, ToolDef]:
    """Key tools by name, keeping the first declaration of any duplicate."""
    out: dict[str, ToolDef] = {}
    for tool in tools:
        out.setdefault(tool.name, tool)
    return out


def _weakened_annotations(before: ToolDef, after: ToolDef) -> list[tuple[str, bool, bool]]:
    if not before.annotations or not after.annotations:
        return []
    weakened = []
    for key, safe_value in SAFE_ANNOTATION_VALUES.items():
        old = before.annotations.get(key)
        new = after.annotations.get(key)
        if old is None or new is None or old == new:
            continue
        if old == safe_value and new != safe_value:
            weakened.append((key, old, new))
    return weakened


def _detect_renames(
    added: dict[str, ToolDef], removed: dict[str, ToolDef]
) -> list[tuple[str, str, ToolDef, ToolDef]]:
    """Pair an added and a removed tool sharing an identical description.

    Without this, every rename reports as ADDED+REMOVED and inflates churn.
    """
    pairs = []
    used_new: set[str] = set()
    for old_name, old_tool in removed.items():
        old_desc = normalize_description(old_tool.description)
        if not old_desc:
            continue
        for new_name, new_tool in added.items():
            if new_name in used_new:
                continue
            if normalize_description(new_tool.description) == old_desc:
                pairs.append((old_name, new_name, old_tool, new_tool))
                used_new.add(new_name)
                break
    return pairs


def diff_snapshots(
    server: str,
    before: dict[str, ToolDef],
    after: dict[str, ToolDef],
    commit: str,
    timestamp: datetime,
) -> list[DriftEvent]:
    """Return every material change between two tool-surface snapshots."""
    events: list[DriftEvent] = []

    def emit(tool: str, kind: str, severity: str, detail: str,
             old: str | None = None, new: str | None = None) -> None:
        events.append(DriftEvent(
            server=server, tool=tool, kind=kind, severity=severity,
            commit=commit, timestamp=timestamp, detail=detail,
            before=old, after=new,
        ))

    added = {k: v for k, v in after.items() if k not in before}
    removed = {k: v for k, v in before.items() if k not in after}

    renames = _detect_renames(added, removed)
    for old_name, new_name, _old, _new in renames:
        emit(new_name, "TOOL_RENAMED", "MEDIUM",
             f"tool renamed {old_name} -> {new_name}", old_name, new_name)
        added.pop(new_name, None)
        removed.pop(old_name, None)

    for name, tool in added.items():
        risky = bool(scope_terms(tool.description)) or (
            tool.annotations is not None
            and tool.annotations.get("readOnlyHint") is False
        )
        emit(name, "TOOL_ADDED", "LOW",
             "new tool added to an established surface"
             + (" (writes or reaches externally)" if risky else ""),
             None, name)

    for name in removed:
        emit(name, "TOOL_REMOVED", "LOW", "tool no longer declared", name, None)

    for name, new_tool in after.items():
        old_tool = before.get(name)
        if old_tool is None:
            continue

        for key, old_val, new_val in _weakened_annotations(old_tool, new_tool):
            emit(name, "ANNOTATION_WEAKENED", "HIGH",
                 f"{key} {str(old_val).lower()} -> {str(new_val).lower()}",
                 f"{key}={old_val}", f"{key}={new_val}")

        if description_is_material_change(old_tool.description, new_tool.description):
            gained = scope_terms(new_tool.description) - scope_terms(old_tool.description)
            if gained:
                emit(name, "SCOPE_LANGUAGE_ADDED", "HIGH",
                     "description gained capability language: "
                     + ", ".join(sorted(gained)),
                     normalize_description(old_tool.description),
                     normalize_description(new_tool.description))
            else:
                emit(name, "DESCRIPTION_CHANGED", "MEDIUM",
                     "description rewritten after publication",
                     normalize_description(old_tool.description),
                     normalize_description(new_tool.description))

        # Schema comparison only where BOTH snapshots were statically visible.
        if old_tool.params is not None and new_tool.params is not None:
            gained_params = set(new_tool.params) - set(old_tool.params)
            lost_params = set(old_tool.params) - set(new_tool.params)
            if gained_params or lost_params:
                emit(name, "PARAMS_CHANGED", "MEDIUM",
                     f"added={sorted(gained_params)} removed={sorted(lost_params)}",
                     ",".join(old_tool.params), ",".join(new_tool.params))

        if old_tool.required_params is not None and new_tool.required_params is not None:
            newly_required = set(new_tool.required_params) - set(old_tool.required_params)
            if newly_required:
                emit(name, "REQUIRED_PARAMS_ADDED", "MEDIUM",
                     f"newly required: {sorted(newly_required)}",
                     ",".join(old_tool.required_params),
                     ",".join(new_tool.required_params))

    return events
