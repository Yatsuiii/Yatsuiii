"""K1' scoring (K1P_DESIGN.md): estimate stale-premise incidents from the coded sample and
apply the rule (KILL if the 90-day estimate < 10)."""
from __future__ import annotations

import json
import math
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from k1p.mine import OUT  # noqa: E402


def wilson(k, n, z=1.96):
    if n == 0:
        return 0.0, 0.0, 0.0
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return p, max(0.0, c - h), min(1.0, c + h)


def main():
    S = json.load(open(os.path.join(OUT, "sample.json")))
    coded = json.load(open(os.path.join(OUT, "coded.json")))
    total, n = S["total_candidates"], len(S["sample"])
    assert len(coded) == n, (len(coded), n)
    inc = [c for c in coded if c["incident"]]
    k = len(inc)
    p, lo, hi = wilson(k, n)
    est, est_lo, est_hi = total * p, total * lo, total * hi
    cats = Counter(c["category"] for c in inc)
    daily = {}
    for f in sorted(f for f in os.listdir(OUT) if f.startswith("daily") and f.endswith(".jsonl")):
        for l in open(os.path.join(OUT, f)):
            d = json.loads(l)
            daily.setdefault(d["day"], d)
    daily = list(daily.values())
    rep = dict(total_candidates=total, coded=n, incidents_in_sample=k, share=p, share_ci=[lo, hi],
               estimate=est, estimate_ci=[est_lo, est_hi], categories=dict(cats),
               opened_issues_in_corpus=sum(d["opened"] for d in daily), days=len(daily),
               missing_hours=sum(d.get("missing_hours", 0) for d in daily),
               verdict=("KILL" if est < 10 else "PASS (weak)"))
    json.dump(rep, open(os.path.join(OUT, "score.json"), "w"), indent=1)
    print(json.dumps(rep, indent=1))


if __name__ == "__main__":
    main()
