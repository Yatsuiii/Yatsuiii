"""K1' coding ledger: append hand-coded decisions for sample items to coded_batches.jsonl,
checking each quote is verbatim from the issue, then assemble coded.json in sample order.

  record.py add codes.json   # [{"i":..,"incident":bool,"category":"code"|"systems"|null,
                              #   "reason":"..","quote":"<verbatim, optional>"}, ...]
  record.py build            # -> coded.json (fails if any sample item is uncoded)
"""
from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from k1p.mine import OUT  # noqa: E402
from k1p.sample import excerpt  # noqa: E402

LEDGER = os.path.join(OUT, "coded_batches.jsonl")
norm = lambda s: re.sub(r"\s+", " ", s).strip()


def sample():
    return json.load(open(os.path.join(OUT, "sample.json")))["sample"]


def add(path):
    S = sample()
    rows = json.load(open(path))
    for c in rows:
        r = S[c["i"]]
        assert isinstance(c["incident"], bool)
        assert c["category"] in (("code", "systems") if c["incident"] else (None,)), c
        q = c.get("quote") or ""
        if q:
            assert norm(q) in norm(r["title"] + "\n" + r["body"]), ("quote not verbatim", c["i"], q)
        else:
            q = excerpt(r, width=150, maxhits=1)[:400]
        rec = dict(i=c["i"], repo=r["repo"], number=r["number"], url=r["url"], title=r["title"],
                   incident=c["incident"], category=c["category"], reason=c["reason"], excerpt=q)
        with open(LEDGER, "a") as fh:
            fh.write(json.dumps(rec) + "\n")
    print(f"recorded {len(rows)}")


def build():
    S = sample()
    got = {}
    for l in open(LEDGER):
        r = json.loads(l)
        got[r["i"]] = r                      # a later line re-codes an item (kept in the ledger)
    missing = [i for i in range(len(S)) if i not in got]
    assert not missing, f"uncoded: {missing[:20]} ({len(missing)})"
    coded = [got[i] for i in range(len(S))]
    json.dump(coded, open(os.path.join(OUT, "coded.json"), "w"), indent=1)
    print(f"coded.json: {len(coded)} items, {sum(c['incident'] for c in coded)} incidents")


if __name__ == "__main__":
    add(sys.argv[2]) if sys.argv[1] == "add" else build()
