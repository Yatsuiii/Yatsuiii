"""K1' sampling and excerpting (K1P_DESIGN.md): dedupe candidates, draw up to 300 with seed
20260930, and print compact excerpts (title + text around each regex hit) for coding."""
from __future__ import annotations

import json
import os
import random
import re
import sys

import orjson

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from k1p.mine import AGENT, STALE, OUT  # noqa: E402


def load_candidates():
    """All miners' candidates (candidates*.jsonl), deduplicated by issue."""
    seen, out = set(), []
    for f in sorted(f for f in os.listdir(OUT) if f.startswith("candidates") and f.endswith(".jsonl")):
        for line in open(os.path.join(OUT, f), "rb"):
            r = orjson.loads(line)
            key = (r["repo"], r["number"])
            if key in seen:
                continue
            seen.add(key)
            out.append(r)
    return out


def draw(n=300, seed=20260930):
    c = load_candidates()
    c.sort(key=lambda r: (r["repo"], r["number"]))
    if len(c) <= n:
        return c, len(c)
    return random.Random(seed).sample(c, n), len(c)


def excerpt(r, width=220, maxhits=3):
    text = r["title"] + "\n" + r["body"]
    spans = [m.span() for m in STALE.finditer(text)][:maxhits] + [m.span() for m in AGENT.finditer(text)][:1]
    parts = []
    for a, b in sorted(spans):
        s, e = max(0, a - width), min(len(text), b + width)
        parts.append(text[s:e].replace("\n", " "))
    return " … ".join(parts)[:1400]


if __name__ == "__main__":
    sample, total = draw()
    path = os.path.join(OUT, "sample.json")
    json.dump(dict(total_candidates=total, sample=sample), open(path, "w"))
    lo, hi = int(sys.argv[1]), int(sys.argv[2])
    print(f"total candidates={total}  sample={len(sample)}  showing {lo}..{hi-1}")
    for i in range(lo, min(hi, len(sample))):
        r = sample[i]
        print(f"\n#{i} {r['repo']}#{r['number']} | {r['title'][:140]}")
        print("   " + excerpt(r))
