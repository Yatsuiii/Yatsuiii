"""Recover the full issue text for sampled candidates whose stored body (first 6,000 chars)
lacks one of the regex hits: the miner matched on the whole body but stored a prefix. Re-reads
the candidate's hour from GH Archive and saves {sample index: full body} to fulltext.json.
"""
from __future__ import annotations

import concurrent.futures as cf
import gzip
import io
import json
import os
import sys
from datetime import datetime

import orjson

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.gha import _fetch  # noqa: E402
from k1p.mine import AGENT, OUT, STALE  # noqa: E402


def hour_url(ts):
    d = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
    return f"https://data.gharchive.org/{d:%Y-%m-%d}-{d.hour}.json.gz"


def main():
    S = json.load(open(os.path.join(OUT, "sample.json")))["sample"]
    need = {}
    for i, r in enumerate(S):
        t = r["title"] + "\n" + r["body"]
        if not (AGENT.search(t) and STALE.search(t)):
            need.setdefault(hour_url(r["created_at"]), []).append(i)

    def scan(url):
        want = {(S[i]["repo"], S[i]["number"]): i for i in need[url]}
        raw, got = _fetch(url), {}
        if not raw:
            return got
        for line in gzip.GzipFile(fileobj=io.BytesIO(raw)).read().split(b"\n"):
            if b'"IssuesEvent"' not in line or b'"opened"' not in line:
                continue
            e = orjson.loads(line)
            iss = (e.get("payload") or {}).get("issue") or {}
            k = (e["repo"]["name"], iss.get("number"))
            if k in want:
                got[want[k]] = iss.get("body") or ""
        return got

    full = {}
    with cf.ThreadPoolExecutor(4) as ex:
        for got in ex.map(scan, list(need)):
            full.update(got)
    json.dump({str(k): v for k, v in sorted(full.items())}, open(os.path.join(OUT, "fulltext.json"), "w"))
    print(f"needed {sum(map(len, need.values()))} items in {len(need)} hours; recovered {len(full)}")


if __name__ == "__main__":
    main()
