"""Aggregate per-server reports into the experiment's verdict.

The verdict thresholds are fixed here, before any data is collected, so the
result cannot be rationalised after the fact:

    < 10%   KILL          no meaningful post-approval drift; thesis is dead
    >= 30%  CONFIRM       drift is common; the pain is real
    else    INCONCLUSIVE  widen the sample or the window, do not squint

Caveats that would invalidate the headline are printed next to it, not buried.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass

from .models import ServerReport

KILL_THRESHOLD = 0.10
CONFIRM_THRESHOLD = 0.30
#: Below this mean extraction coverage the headline is not trustworthy.
MIN_TRUSTWORTHY_COVERAGE = 0.70


@dataclass
class Summary:
    total: int
    analyzable: int
    skipped: int
    drifted: int
    high_severity_servers: int
    drift_rate: float
    mean_coverage: float
    verdict: str
    event_kinds: Counter
    severity_counts: Counter
    schema_visible_servers: int
    caveats: list[str]


def summarize(reports: list[ServerReport]) -> Summary:
    analyzable = [r for r in reports if r.analyzable]
    drifted = [r for r in analyzable if r.has_material_drift]
    high = [r for r in analyzable if any(e.severity == "HIGH" for e in r.events)]

    kinds: Counter = Counter()
    severities: Counter = Counter()
    for report in analyzable:
        for event in report.events:
            kinds[event.kind] += 1
            severities[event.severity] += 1

    rate = len(drifted) / len(analyzable) if analyzable else 0.0
    coverage = (
        sum(r.extraction_coverage for r in analyzable) / len(analyzable)
        if analyzable else 0.0
    )

    if not analyzable:
        verdict = "NO DATA"
    elif rate < KILL_THRESHOLD:
        verdict = "KILL"
    elif rate >= CONFIRM_THRESHOLD:
        verdict = "CONFIRM"
    else:
        verdict = "INCONCLUSIVE"

    caveats: list[str] = []
    if analyzable and coverage < MIN_TRUSTWORTHY_COVERAGE:
        caveats.append(
            f"mean extraction coverage {coverage:.0%} is below "
            f"{MIN_TRUSTWORTHY_COVERAGE:.0%}; the headline understates drift "
            f"because unparsed commits are skipped, not counted"
        )
    if len(analyzable) < 30:
        caveats.append(
            f"only {len(analyzable)} servers cleared the filters; too small to "
            f"generalise, treat the verdict as directional"
        )
    schema_visible = sum(1 for r in analyzable if r.schema_visible)
    if analyzable and schema_visible / len(analyzable) < 0.5:
        caveats.append(
            f"input schemas were statically visible for only "
            f"{schema_visible}/{len(analyzable)} servers; parameter drift is "
            f"undercounted relative to description and annotation drift"
        )

    return Summary(
        total=len(reports),
        analyzable=len(analyzable),
        skipped=len(reports) - len(analyzable),
        drifted=len(drifted),
        high_severity_servers=len(high),
        drift_rate=rate,
        mean_coverage=coverage,
        verdict=verdict,
        event_kinds=kinds,
        severity_counts=severities,
        schema_visible_servers=schema_visible,
        caveats=caveats,
    )


def to_json(reports: list[ServerReport], summary: Summary) -> str:
    return json.dumps(
        {
            "summary": {
                "verdict": summary.verdict,
                "total_servers": summary.total,
                "analyzable": summary.analyzable,
                "skipped": summary.skipped,
                "servers_with_material_drift": summary.drifted,
                "servers_with_high_severity": summary.high_severity_servers,
                "drift_rate": round(summary.drift_rate, 4),
                "mean_extraction_coverage": round(summary.mean_coverage, 4),
                "thresholds": {"kill": KILL_THRESHOLD, "confirm": CONFIRM_THRESHOLD},
                "event_kinds": dict(summary.event_kinds),
                "severity_counts": dict(summary.severity_counts),
                "caveats": summary.caveats,
            },
            "servers": [r.to_dict() for r in reports],
        },
        indent=2,
    )


def to_markdown(reports: list[ServerReport], summary: Summary, window_days: int) -> str:
    lines = [
        "# MCP tool-definition drift",
        "",
        f"Window: last {window_days} days. "
        f"Servers seeded: {summary.total}. Analyzable: {summary.analyzable} "
        f"(skipped {summary.skipped}).",
        "",
        f"## Verdict: {summary.verdict}",
        "",
        f"**{summary.drifted}/{summary.analyzable} "
        f"({summary.drift_rate:.0%})** of mature servers changed a tool's declared "
        f"contract during the window.",
        f"{summary.high_severity_servers} had at least one HIGH-severity change "
        f"(privilege or reach expansion).",
        "",
        f"Pre-registered thresholds: KILL below {KILL_THRESHOLD:.0%}, "
        f"CONFIRM at or above {CONFIRM_THRESHOLD:.0%}.",
        "",
    ]

    if summary.caveats:
        lines += ["### Caveats", ""]
        lines += [f"- {c}" for c in summary.caveats]
        lines.append("")

    if summary.event_kinds:
        lines += ["### Events by kind", "", "| Kind | Count |", "| --- | ---: |"]
        for kind, count in summary.event_kinds.most_common():
            lines.append(f"| `{kind}` | {count} |")
        lines.append("")

    drifted = sorted(
        (r for r in reports if r.analyzable and r.has_material_drift),
        key=lambda r: (-sum(1 for e in r.events if e.severity == "HIGH"),
                       -len(r.material_events)),
    )
    if drifted:
        lines += [
            "### Servers with material drift", "",
            "| Server | HIGH | Material | Tools | Coverage |",
            "| --- | ---: | ---: | ---: | ---: |",
        ]
        for report in drifted:
            high = sum(1 for e in report.events if e.severity == "HIGH")
            lines.append(
                f"| `{report.server}` | {high} | {len(report.material_events)} "
                f"| {report.tools_at_head} | {report.extraction_coverage:.0%} |"
            )
        lines.append("")

        lines += ["### Highest-severity examples", ""]
        shown = 0
        for report in drifted:
            for event in report.events:
                if event.severity != "HIGH" or shown >= 15:
                    continue
                lines.append(
                    f"- **`{report.server}` / `{event.tool}`** — {event.kind}: "
                    f"{event.detail} ({event.timestamp:%Y-%m-%d}, `{event.commit[:8]}`)"
                )
                shown += 1
        lines.append("")

    skipped = [r for r in reports if not r.analyzable]
    if skipped:
        lines += ["### Skipped", "", "| Server | Reason |", "| --- | --- |"]
        for report in skipped:
            lines.append(f"| `{report.server}` | {report.skip_reason or 'unknown'} |")
        lines.append("")

    return "\n".join(lines)
