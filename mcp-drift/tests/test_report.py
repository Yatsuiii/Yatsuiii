"""Verdict and aggregation tests, including the honesty guards."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mcpdrift.models import DriftEvent, ServerReport  # noqa: E402
from mcpdrift.report import summarize, to_json, to_markdown  # noqa: E402

TS = datetime(2026, 6, 1, tzinfo=timezone.utc)


def server(name: str, *, analyzable=True, drift=False, high=False,
           coverage=1.0, schema=True) -> ServerReport:
    report = ServerReport(server=name, url=f"https://x/{name}",
                          analyzable=analyzable, extraction_coverage=coverage,
                          schema_visible=schema, tools_at_head=5)
    if drift:
        report.events.append(DriftEvent(
            server=name, tool="t",
            kind="SCOPE_LANGUAGE_ADDED" if high else "DESCRIPTION_CHANGED",
            severity="HIGH" if high else "MEDIUM",
            commit="abc1234", timestamp=TS, detail="d"))
    return report


def make(n_analyzable: int, n_drifted: int, **kw) -> list[ServerReport]:
    return [server(f"s{i}", drift=i < n_drifted, **kw) for i in range(n_analyzable)]


class TestVerdictThresholds:
    def test_below_ten_percent_kills(self):
        assert summarize(make(100, 5)).verdict == "KILL"

    def test_at_or_above_thirty_percent_confirms(self):
        assert summarize(make(100, 30)).verdict == "CONFIRM"

    def test_between_is_inconclusive_not_rounded_up(self):
        assert summarize(make(100, 20)).verdict == "INCONCLUSIVE"

    def test_boundaries_are_exact(self):
        assert summarize(make(100, 10)).verdict == "INCONCLUSIVE"  # 10% is not < 10%
        assert summarize(make(100, 29)).verdict == "INCONCLUSIVE"

    def test_no_analyzable_servers_is_not_a_kill(self):
        """Zero data must never be reported as evidence of absence."""
        summary = summarize([server("a", analyzable=False)])
        assert summary.verdict == "NO DATA"


class TestDenominatorHonesty:
    def test_skipped_servers_are_excluded_from_the_rate(self):
        reports = make(10, 3) + [server(f"sk{i}", analyzable=False) for i in range(90)]
        summary = summarize(reports)
        assert summary.analyzable == 10
        assert summary.skipped == 90
        assert abs(summary.drift_rate - 0.3) < 1e-9

    def test_low_coverage_raises_a_caveat(self):
        summary = summarize(make(50, 20, coverage=0.4))
        assert any("coverage" in c for c in summary.caveats)

    def test_small_sample_raises_a_caveat(self):
        assert any("too small" in c for c in summarize(make(5, 2)).caveats)

    def test_invisible_schemas_raise_a_caveat(self):
        summary = summarize(make(50, 20, schema=False))
        assert any("schemas" in c for c in summary.caveats)

    def test_clean_large_sample_has_no_caveats(self):
        assert summarize(make(50, 20)).caveats == []


class TestOutputs:
    def test_json_is_valid_and_carries_thresholds(self):
        reports = make(40, 12)
        payload = json.loads(to_json(reports, summarize(reports)))
        assert payload["summary"]["verdict"] == "CONFIRM"
        assert payload["summary"]["thresholds"] == {"kill": 0.10, "confirm": 0.30}
        assert len(payload["servers"]) == 40

    def test_markdown_states_verdict_and_caveats(self):
        reports = make(5, 2, coverage=0.3)
        text = to_markdown(reports, summarize(reports), 90)
        assert "## Verdict:" in text
        assert "### Caveats" in text

    def test_high_severity_servers_counted_separately(self):
        reports = [server("a", drift=True, high=True), server("b", drift=True)]
        summary = summarize(reports)
        assert summary.drifted == 2
        assert summary.high_severity_servers == 1
