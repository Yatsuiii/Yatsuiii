"""K1' publication: every coded candidate as a Markdown table (URL, verbatim excerpt, reason),
the descriptive tallies, and a compact index of the whole candidate corpus (no bodies; the
bodies are re-derivable from GH Archive with mine.py)."""
from __future__ import annotations

import gzip
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from k1p.mine import OUT  # noqa: E402
from k1p.sample import load_candidates  # noqa: E402

# Coded NO but specifying a hand-rolled fence on agent actions (stale-plan check, precondition,
# plan hash, CAS/lease on side effects, re-confirm before merge); listed so a reader can judge.
FENCE_BUILDERS = [27, 30, 35, 47, 54, 62, 99, 170, 232, 265]


def label(c):
    if c["incident"]:
        return f"**INCIDENT ({c['category']})**"
    for k in ("ADJACENT", "PROBABLE", "Near-miss"):
        if c["reason"].startswith(k):
            return k.lower()
    return "no"


def main():
    C = json.load(open(os.path.join(OUT, "coded.json")))
    esc = lambda s: s.replace("|", "\\|").replace("\n", " ")
    lines = ["# K1′ coded sample (300 of 20,675 candidates, seed 20260930)", "",
             "Rubric: `K1P_DESIGN.md` plus the coding clarifications in `PREREGISTRATION.md` §7. "
             "Excerpts are verbatim (for non-incidents, the text around the first regex hit).", "",
             "| # | Issue | Code | Reason | Excerpt |", "|---:|---|---|---|---|"]
    for c in C:
        lines.append(f"| {c['i']} | [{esc(c['repo'])}#{c['number']}]({c['url']}) | {label(c)} | "
                     f"{esc(c['reason'])} | {esc(c['excerpt'][:240])} |")
    open(os.path.join(OUT, "CODED.md"), "w").write("\n".join(lines) + "\n")

    tallies = dict(labels=dict(Counter(label(c).strip("*") for c in C)),
                   fence_builders=[dict(i=i, url=C[i]["url"], reason=C[i]["reason"]) for i in FENCE_BUILDERS])
    json.dump(tallies, open(os.path.join(OUT, "tallies.json"), "w"), indent=1)

    with gzip.open(os.path.join(OUT, "corpus_index.jsonl.gz"), "wt") as fh:
        for r in sorted(load_candidates(), key=lambda r: (r["created_at"], r["repo"], r["number"])):
            fh.write(json.dumps({k: r[k] for k in ("repo", "number", "url", "created_at", "actor", "title")}) + "\n")
    days = {}
    for f in sorted(os.listdir(OUT)):
        if f.startswith("daily") and f.endswith(".jsonl"):
            for l in open(os.path.join(OUT, f)):
                d = json.loads(l)
                days.setdefault(d["day"], d)
    with open(os.path.join(OUT, "corpus_days.jsonl"), "w") as fh:
        for d in sorted(days):
            fh.write(json.dumps(days[d]) + "\n")
    print(json.dumps(tallies["labels"]), f"fence builders: {len(FENCE_BUILDERS)}")


if __name__ == "__main__":
    main()
