"""Preregistered rules as code: space selection (§2.1), sampling (§5), kill rules (§6).

The constants mirror PREREGISTRATION.md. Change them only through that
document's deviations log.
"""

from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence

MIN_FILTERED_PAGES = 50
MIN_RECENT_PAGES = 10
RECENT_SINCE = datetime(2024, 9, 28, tzinfo=timezone.utc)
MAX_SPACES = 4
SAMPLE_SIZE = 50
SEED = 20260928
PRECISION_FLOOR = 0.80
PREVALENCE_FLOOR = 0.05
FRESH_DAYS = 365

REAL = "REAL"
FALSE_POSITIVE = "FALSE_POSITIVE"
FP_REASONS = frozenset({"entity_exists", "other_project", "dynamic", "page_historical",
                        "page_versioned", "extraction_error", "other"})


def parse_when(value: str) -> Optional[datetime]:
    """Confluence timestamps, e.g. 2024-03-01T10:20:30.000Z or ...+01:00."""
    if not value:
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = datetime.strptime(text[:19], "%Y-%m-%dT%H:%M:%S")
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def is_recent(last_modified: str, since: datetime = RECENT_SINCE) -> bool:
    when = parse_when(last_modified)
    return when is not None and when >= since


def select_spaces(stats: Sequence[Dict[str, object]]) -> List[str]:
    """§2.1: qualify on page counts, then take the most recently maintained."""
    qualifying = [s for s in stats
                  if int(s["filtered_pages"]) >= MIN_FILTERED_PAGES
                  and int(s["recent_pages"]) >= MIN_RECENT_PAGES]
    qualifying.sort(key=lambda s: (-int(s["recent_pages"]), str(s["project"])))
    return [str(s["project"]) for s in qualifying[:MAX_SPACES]]


def flag_key(flag: Dict[str, object]) -> tuple:
    return (str(flag["space"]), str(flag["page_id"]), str(flag["kind"]), str(flag["value"]))


def sample_flags(flags: Sequence[Dict[str, object]], n: int = SAMPLE_SIZE,
                 seed: int = SEED) -> List[Dict[str, object]]:
    """§5: uniform sample with a fixed seed over a canonical ordering."""
    ordered = sorted(flags, key=flag_key)
    if len(ordered) <= n:
        return ordered
    return random.Random(seed).sample(ordered, n)


def decide(claim_pages: int, flagged_pages: int,
           verified: Sequence[Dict[str, str]], scan_date: datetime) -> Dict[str, object]:
    """§6: precision, prevalence, fresh-but-wrong, and the kill decision."""
    for row in verified:
        if row["verdict"] not in (REAL, FALSE_POSITIVE):
            raise ValueError(f"unverified or invalid verdict: {row['verdict']!r}")
        if row["verdict"] == FALSE_POSITIVE and row.get("reason") not in FP_REASONS:
            raise ValueError(f"false positive needs a §5 reason: {row.get('reason')!r}")

    real = [r for r in verified if r["verdict"] == REAL]
    precision = len(real) / len(verified) if verified else math.nan
    flagged_share = flagged_pages / claim_pages if claim_pages else 0.0
    prevalence = flagged_share * precision if verified else 0.0

    cutoff = scan_date - timedelta(days=FRESH_DAYS)
    fresh = [r for r in real if (parse_when(r.get("last_modified", "")) or datetime.min.replace(
        tzinfo=timezone.utc)) >= cutoff]

    kills = []
    if not verified or precision < PRECISION_FLOOR:
        kills.append("K1a precision")
    if prevalence < PREVALENCE_FLOOR:
        kills.append("K1b prevalence")
    return {
        "verdict": "KILLED" if kills else "PASSED",
        "kills": kills,
        "verified": len(verified),
        "real": len(real),
        "precision": precision,
        "claim_pages": claim_pages,
        "flagged_pages": flagged_pages,
        "flagged_page_share": flagged_share,
        "estimated_prevalence": prevalence,
        "fresh_but_wrong": len(fresh),
        "fresh_but_wrong_share": len(fresh) / len(real) if real else math.nan,
        "thresholds": {"precision": PRECISION_FLOOR, "prevalence": PREVALENCE_FLOOR},
    }
