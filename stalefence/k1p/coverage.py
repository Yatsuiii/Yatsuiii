"""K1' corpus coverage check: how much of public GitHub does GH Archive capture in 2026?

For one day, count events by type and, for the busiest repos, compare the opened-issue events
the archive holds with the span of issue numbers those events reveal (issue numbers are shared
with PRs, so the span is an upper bound on the true number of new issues + PRs).

  coverage.py 2026-09-15
"""
from __future__ import annotations

import gzip
import io
import json
import os
import sys
from collections import Counter, defaultdict

import orjson

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.gha import _fetch  # noqa: E402
from k1p.mine import OUT  # noqa: E402


def main(day):
    types, nums, prs = Counter(), defaultdict(set), defaultdict(set)
    hours = 0
    for h in range(24):
        raw = _fetch(f"https://data.gharchive.org/{day}-{h}.json.gz")
        if not raw:
            continue
        hours += 1
        for line in gzip.GzipFile(fileobj=io.BytesIO(raw)).read().split(b"\n"):
            if not line:
                continue
            e = orjson.loads(line)
            t = e.get("type")
            types[t] += 1
            p = e.get("payload") or {}
            if t == "IssuesEvent" and p.get("action") == "opened":
                n = (p.get("issue") or {}).get("number")
                if n:
                    nums[e["repo"]["name"]].add(n)
            elif t == "PullRequestEvent" and p.get("action") == "opened":
                n = p.get("number") or (p.get("pull_request") or {}).get("number")
                if n:
                    prs[e["repo"]["name"]].add(n)
    busy = sorted(nums, key=lambda r: -len(nums[r]))[:15]
    rows = []
    for r in busy:
        s = nums[r] | prs[r]
        span = max(s) - min(s) + 1
        rows.append(dict(repo=r, issues_opened_seen=len(nums[r]), prs_opened_seen=len(prs[r]),
                         number_span=span, seen_share_of_span=len(s) / span))
    rep = dict(day=day, hours=hours, events=sum(types.values()), by_type=dict(types.most_common()),
               issues_opened=sum(len(v) for v in nums.values()), busiest_repos=rows)
    json.dump(rep, open(os.path.join(OUT, f"coverage_{day}.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in rep.items() if k != "busiest_repos"}, indent=1))
    for x in rows:
        print(f"  {x['repo']:45s} issues seen {x['issues_opened_seen']:4d}  PRs seen {x['prs_opened_seen']:4d}"
              f"  number span {x['number_span']:5d}  seen/span {x['seen_share_of_span']:.2f}")


if __name__ == "__main__":
    main(sys.argv[1])
