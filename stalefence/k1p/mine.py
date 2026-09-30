"""K1' miner (K1P_DESIGN.md): stream opened GitHub issues from GH Archive and keep those
matching both frozen regexes. Checkpoints after every day, so it is safe to kill and rerun.

Usage: mine.py [max_seconds]
"""
from __future__ import annotations

import os
import re
import sys
import time

import orjson

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.gha import _fetch  # noqa: E402
import gzip, io  # noqa: E402
from pipeline.run_study import days  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "results", "k1p")
LO, HI = "2026-06-30", "2026-09-27"
AGENT = re.compile(r"\b(ai agent|agents?|agentic|llm|copilot|claude|codex|cursor|devin|mcp|tool[ -]?call|autonomous)\b", re.I)
STALE = re.compile(
    r"stale|outdated|out[ -]of[ -]date|race condition|concurrent(ly)?|conflicting|overwr(o|i)te|overwritten"
    r"|lost update|clobber|changed (since|while|before|after|underneath)|toctou|out of sync"
    r"|already (merged|closed|deleted|cancell?ed|shipped|deployed|refunded|paid)|state (has )?changed"
    r"|while (it|the agent) was (working|running|thinking)", re.I)


def main(budget: float):
    os.makedirs(OUT, exist_ok=True)
    prog_p = os.path.join(OUT, "progress.json")
    done = set(orjson.loads(open(prog_p, "rb").read())) if os.path.exists(prog_p) else set()
    todo = [d for d in days(LO, HI) if d not in done]
    t0 = time.time()
    for d in todo:
        if time.time() - t0 > budget:
            break
        n_open = n_cand = 0
        recs = []
        missing = 0
        for h in range(24):
            raw = _fetch(f"https://data.gharchive.org/{d}-{h}.json.gz")
            if not raw:
                missing += 1
                continue
            for line in gzip.GzipFile(fileobj=io.BytesIO(raw)).read().split(b"\n"):
                if b'"IssuesEvent"' not in line or b'"opened"' not in line:
                    continue
                e = orjson.loads(line)
                if e.get("type") != "IssuesEvent":
                    continue
                p = e.get("payload") or {}
                if p.get("action") != "opened":
                    continue
                n_open += 1
                iss = p.get("issue") or {}
                text = (iss.get("title") or "") + "\n" + (iss.get("body") or "")
                if AGENT.search(text) and STALE.search(text):
                    n_cand += 1
                    recs.append(dict(repo=e["repo"]["name"], number=iss.get("number"),
                                     url=iss.get("html_url"), created_at=e.get("created_at"),
                                     actor=e["actor"]["login"], title=iss.get("title") or "",
                                     body=(iss.get("body") or "")[:6000]))
        with open(os.path.join(OUT, "candidates.jsonl"), "ab") as fh:
            for r in recs:
                fh.write(orjson.dumps(r) + b"\n")
        with open(os.path.join(OUT, "daily.jsonl"), "ab") as fh:
            fh.write(orjson.dumps(dict(day=d, opened=n_open, candidates=n_cand, missing_hours=missing)) + b"\n")
        done.add(d)
        with open(prog_p, "wb") as fh:
            fh.write(orjson.dumps(sorted(done)))
        print(f"[K1'] {d}: opened={n_open} candidates={n_cand}  ({len(done)}/{len(days(LO, HI))} days)", flush=True)
    left = len(days(LO, HI)) - len(done)
    print(f"[K1'] {left} days left", flush=True)
    return left == 0


if __name__ == "__main__":
    sys.exit(0 if main(float(sys.argv[1]) if len(sys.argv) > 1 else 1e9) else 3)
