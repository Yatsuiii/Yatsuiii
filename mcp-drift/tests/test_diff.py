"""Differ tests. A bug here silently changes the experiment's answer."""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mcpdrift.diff import diff_snapshots, index_tools  # noqa: E402
from mcpdrift.models import ToolDef  # noqa: E402

TS = datetime(2026, 6, 1, tzinfo=timezone.utc)


def snap(*tools: ToolDef) -> dict[str, ToolDef]:
    return index_tools(tools)


def run(before, after):
    return diff_snapshots("srv", before, after, "abc1234", TS)


def kinds(events) -> set[str]:
    return {e.kind for e in events}


class TestAnnotationWeakening:
    def test_read_only_revoked_is_high(self):
        before = snap(ToolDef("t", "d", {"readOnlyHint": True}))
        after = snap(ToolDef("t", "d", {"readOnlyHint": False}))
        (event,) = run(before, after)
        assert event.kind == "ANNOTATION_WEAKENED"
        assert event.severity == "HIGH"

    def test_becoming_destructive_is_high(self):
        before = snap(ToolDef("t", "d", {"destructiveHint": False}))
        after = snap(ToolDef("t", "d", {"destructiveHint": True}))
        (event,) = run(before, after)
        assert event.severity == "HIGH"

    def test_tightening_is_not_reported(self):
        """Becoming safer is not drift we care about."""
        before = snap(ToolDef("t", "d", {"readOnlyHint": False}))
        after = snap(ToolDef("t", "d", {"readOnlyHint": True}))
        assert run(before, after) == []

    def test_missing_annotations_on_either_side_are_not_invented(self):
        before = snap(ToolDef("t", "d", None))
        after = snap(ToolDef("t", "d", {"readOnlyHint": False}))
        assert "ANNOTATION_WEAKENED" not in kinds(run(before, after))


class TestDescriptionDrift:
    def test_whitespace_only_change_is_not_drift(self):
        before = snap(ToolDef("t", "Reads   a\n file"))
        after = snap(ToolDef("t", "Reads a file"))
        assert run(before, after) == []

    def test_rewrite_is_medium(self):
        before = snap(ToolDef("t", "Reads a file"))
        after = snap(ToolDef("t", "Reads a file from the index"))
        (event,) = run(before, after)
        assert event.kind == "DESCRIPTION_CHANGED"
        assert event.severity == "MEDIUM"

    def test_gaining_capability_language_escalates_to_high(self):
        before = snap(ToolDef("t", "Reads a file"))
        after = snap(ToolDef("t", "Reads a file and can delete it"))
        (event,) = run(before, after)
        assert event.kind == "SCOPE_LANGUAGE_ADDED"
        assert event.severity == "HIGH"
        assert "delete" in event.detail

    def test_preexisting_capability_language_does_not_escalate(self):
        before = snap(ToolDef("t", "Can delete a file"))
        after = snap(ToolDef("t", "Can delete a file quickly"))
        (event,) = run(before, after)
        assert event.kind == "DESCRIPTION_CHANGED"


class TestSchemaDrift:
    def test_added_param_is_medium(self):
        before = snap(ToolDef("t", "d", params=("a",), required_params=("a",)))
        after = snap(ToolDef("t", "d", params=("a", "b"), required_params=("a",)))
        (event,) = run(before, after)
        assert event.kind == "PARAMS_CHANGED"

    def test_newly_required_param_is_reported(self):
        before = snap(ToolDef("t", "d", params=("a", "b"), required_params=("a",)))
        after = snap(ToolDef("t", "d", params=("a", "b"), required_params=("a", "b")))
        (event,) = run(before, after)
        assert event.kind == "REQUIRED_PARAMS_ADDED"

    def test_invisible_schema_is_never_compared(self):
        """params=None means 'not seen'. It must not read as a removal."""
        before = snap(ToolDef("t", "d", params=None))
        after = snap(ToolDef("t", "d", params=("a",)))
        assert "PARAMS_CHANGED" not in kinds(run(before, after))


class TestSurfaceChanges:
    def test_added_and_removed_are_low(self):
        before = snap(ToolDef("a", "first"))
        after = snap(ToolDef("a", "first"), ToolDef("b", "second"))
        (event,) = run(before, after)
        assert event.kind == "TOOL_ADDED"
        assert event.severity == "LOW"

    def test_rename_is_paired_not_reported_as_add_plus_remove(self):
        before = snap(ToolDef("old_name", "Identical description"))
        after = snap(ToolDef("new_name", "Identical description"))
        (event,) = run(before, after)
        assert event.kind == "TOOL_RENAMED"
        assert event.severity == "MEDIUM"

    def test_identical_snapshots_produce_nothing(self):
        tools = snap(ToolDef("t", "d", {"readOnlyHint": True}, ("a",), ("a",)))
        assert run(tools, dict(tools)) == []

    def test_only_high_and_medium_count_as_material(self):
        from mcpdrift.models import ServerReport
        report = ServerReport(server="s", url="u", analyzable=True)
        report.events = run(snap(ToolDef("a", "x")),
                            snap(ToolDef("a", "x"), ToolDef("b", "y")))
        assert report.events and not report.has_material_drift
