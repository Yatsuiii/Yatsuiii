"""K2 capture check (added after K1' mining exposed it): GH Archive's 2026 capture of issue
events swings ~100x between days (hundreds to ~70k opened issues/day). K2's exposure signals are
issue/PR events, so a session on a thinly captured day can have its exposure missed.
Compare K2's rates on thin vs well-captured days, using K1' daily opened-issue counts as the
capture proxy. Descriptive only; K2's verdict is unchanged.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUT = 5000                                   # opened issues/day separating thin from well-captured


def wilson(k, n, z=1.96):
    if n == 0:
        return float("nan"), float("nan")
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h


def main():
    opened = {}
    k1p = os.path.join(ROOT, "results", "k1p")
    for f in sorted(os.listdir(k1p)):
        if f.startswith("daily") and f.endswith(".jsonl"):
            for l in open(os.path.join(k1p, f)):
                r = json.loads(l)
                opened.setdefault(r["day"], r["opened"])
    S = [json.loads(l) for l in open(os.path.join(ROOT, "results", "gh", "sessions_enriched.jsonl"))]
    L = [s for s in S if s["linked_pr"] and not s["ambiguous"]]
    day = lambda s: dt.datetime.fromtimestamp(s["t0"], dt.timezone.utc).strftime("%Y-%m-%d")
    rep = dict(cut=CUT, sessions_by_capture={}, linked={})
    for name, keep in (("thin", lambda s: opened.get(day(s), 0) < CUT),
                       ("well", lambda s: opened.get(day(s), 0) >= CUT)):
        rep["sessions_by_capture"][name] = sum(1 for s in S if keep(s))
        G = [s for s in L if keep(s)]
        row = dict(n=len(G))
        for sig in ("e_in", "e_pre", "e_base"):
            k = sum(1 for s in G if s[sig].get("3600"))
            row[sig] = dict(k=k, p=(k / len(G) if G else float("nan")), ci=wilson(k, len(G)))
        rep["linked"][name] = row
    rep["days_missing_capture"] = sorted({day(s) for s in S} - set(opened))
    json.dump(rep, open(os.path.join(ROOT, "results", "gh", "capture_check.json"), "w"), indent=1)
    print(json.dumps(rep, indent=1))


if __name__ == "__main__":
    main()
