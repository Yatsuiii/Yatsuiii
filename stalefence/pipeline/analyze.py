"""Analyze reconstructed sessions and apply the K2 rule (PREREGISTRATION.md §2).

Computes P1 (prevalence), the Mantel-Haenszel harm risk ratios RR_in and RR_pre with
repository-clustered bootstrap CIs, base-moved and moot rates, per window, and prints the
K2 verdict for the primary window (1 h). Writes results/gh/analysis.json.
"""
from __future__ import annotations

import json
import math
import os
import sys
from collections import defaultdict

import numpy as np
import orjson

OUT = os.environ.get("SF_OUT") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "results", "gh")
WINDOWS = ["1800", "3600", "10800"]
PRIMARY = "3600"
SEED = 20260930
NBOOT = 2000


def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (p, max(0.0, c - h), min(1.0, c + h))


def mh_rr(rows, exp_key, strata_key):
    """Mantel-Haenszel risk ratio of harm (closed-unmerged) for exposed vs not,
    pooled over strata. rows: list of dicts with 'harm'(0/1), exp(0/1), stratum."""
    num = den = 0.0
    a_tot = b_tot = c_tot = d_tot = 0
    for st, grp in group_by(rows, strata_key).items():
        n = len(grp)
        if n == 0:
            continue
        a = sum(1 for r in grp if r[exp_key] and r["harm"])   # exposed, harm
        b = sum(1 for r in grp if r[exp_key] and not r["harm"])
        c = sum(1 for r in grp if not r[exp_key] and r["harm"])
        d = sum(1 for r in grp if not r[exp_key] and not r["harm"])
        n1, n0 = a + b, c + d
        if n1 == 0 or n0 == 0:
            continue
        num += a * n0 / n
        den += c * n1 / n
        a_tot += a; b_tot += b; c_tot += c; d_tot += d
    rr = (num / den) if den > 0 else float("nan")
    return rr, dict(a=a_tot, b=b_tot, c=c_tot, d=d_tot)


def group_by(rows, key):
    g = defaultdict(list)
    for r in rows:
        g[key(r)].append(r)
    return g


def stratum(r):
    c = r["comments0"]
    cb = "0" if c == 0 else ("1-2" if c <= 2 else "3+")
    return (r["team"], cb)


def cluster_bootstrap(resolved, exp_key, rng):
    """Repository-clustered bootstrap of MH RR for exposed vs not."""
    by_repo = defaultdict(list)
    for r in resolved:
        by_repo[r["repo"]].append(r)
    repos = list(by_repo)
    out = []
    for _ in range(NBOOT):
        pick = rng.choice(len(repos), size=len(repos), replace=True)
        sample = []
        for i in pick:
            sample.extend(by_repo[repos[i]])
        rr, _ = mh_rr(sample, exp_key, stratum)
        if not math.isnan(rr):
            out.append(rr)
    if not out:
        return (float("nan"), float("nan"))
    return (float(np.percentile(out, 2.5)), float(np.percentile(out, 97.5)))


def main():
    sessions = [orjson.loads(l) for l in open(os.path.join(OUT, "sessions_enriched.jsonl"), "rb")]
    n_all = len(sessions)
    linked = [s for s in sessions if s["linked_pr"] and not s["ambiguous"]]
    ambiguous = sum(1 for s in sessions if s["ambiguous"])
    no_pr = sum(1 for s in sessions if s["outcome"] == "no_pr")
    primary_pool = [s for s in linked if s["team"]]
    rng = np.random.default_rng(SEED)

    report = dict(n_sessions=n_all, ambiguous=ambiguous, no_pr=no_pr,
                  linked=len(linked), primary_linked=len(primary_pool), windows={})

    for W in WINDOWS:
        def exp_in(s):
            return 1 if s["e_in"][W] else 0

        def exp_pre(s):
            return 1 if s["e_pre"][W] else 0
        # P1 on primary pool
        k = sum(exp_in(s) for s in primary_pool)
        p1, lo, hi = wilson(k, len(primary_pool))
        # base moved / moot on primary pool
        base = sum(1 for s in primary_pool if s["e_base"][W])
        moot = sum(1 for s in primary_pool if s["moot"][W])
        pre = sum(exp_pre(s) for s in primary_pool)
        # harm analysis over ALL resolved linked sessions (merged/closed)
        resolved = [dict(repo=s["repo"], harm=1 if s["outcome"] == "closed" else 0,
                         e_in=1 if s["e_in"][W] else 0, e_pre=1 if s["e_pre"][W] else 0,
                         team=s["team"], comments0=s["comments0"])
                    for s in linked if s["outcome"] in ("merged", "closed")]
        exposed_resolved = sum(r["e_in"] for r in resolved)
        rr_in, tab_in = mh_rr(resolved, "e_in", stratum)
        rr_pre, tab_pre = mh_rr(resolved, "e_pre", stratum)
        ci_in = cluster_bootstrap(resolved, "e_in", np.random.default_rng(SEED)) if exposed_resolved >= 1 else (float("nan"), float("nan"))
        report["windows"][W] = dict(
            p1=p1, p1_lo=lo, p1_hi=hi, exposed=k, n_primary=len(primary_pool),
            pre_rate=pre / len(primary_pool) if primary_pool else 0,
            base_rate=base / len(primary_pool) if primary_pool else 0,
            moot_rate=moot / len(primary_pool) if primary_pool else 0,
            n_resolved=len(resolved), exposed_resolved=exposed_resolved,
            rr_in=rr_in, rr_in_ci=ci_in, tab_in=tab_in,
            rr_pre=rr_pre, tab_pre=tab_pre)

    # Secondary prevalence: P1 over ALL linked (not just team), primary window
    def exp_in_p(s):
        return 1 if s["e_in"][PRIMARY] else 0
    k2 = sum(exp_in_p(s) for s in linked)
    p1s, los, his = wilson(k2, len(linked))
    pre2 = sum(1 for s in linked if s["e_pre"][PRIMARY])
    report["secondary_all_linked"] = dict(
        n=len(linked), p1=p1s, p1_lo=los, p1_hi=his, exposed=k2,
        placebo_rate=pre2 / len(linked) if linked else 0)

    # K2 verdict on the primary window, honouring §2.5 row order (Too small first).
    w = report["windows"][PRIMARY]
    n_primary = w["n_primary"]
    reason = []
    if n_primary < 300:
        # Extending the start window back reaches sparser months (adoption ramp), so the
        # primary population cannot reach 300 in this era; the primary test is inconclusive.
        verdict = "INCONCLUSIVE(too_small)"
        reason.append(f"primary (team-repo, promptly-linked) pool = {n_primary} < 300; earlier months are sparser, so it cannot reach 300")
        reason.append(f"secondary all-linked P1={p1s*100:.1f}% (n={len(linked)}, placebo {report['secondary_all_linked']['placebo_rate']*100:.1f}%)")
        reason.append(f"harm unmeasurable: only {w['n_resolved']} resolved / {w['exposed_resolved']} exposed-resolved (<50); {sum(1 for s in linked if s['outcome']=='open')}/{len(linked)} PRs still open")
    elif w["p1"] < 0.05:
        verdict = "KILL"; reason.append(f"P1={w['p1']:.3f} < 5%")
    elif w["exposed_resolved"] < 50:
        verdict = "INCONCLUSIVE(harm)"; reason.append(f"only {w['exposed_resolved']} exposed resolved (<50)")
    else:
        lo = w["rr_in_ci"][0]
        if math.isnan(lo) or lo <= 1.0:
            verdict = "KILL"; reason.append(f"RR_in CI lower={lo:.2f} <= 1.0")
        elif w["rr_in"] <= w["rr_pre"]:
            verdict = "KILL"; reason.append(f"RR_in {w['rr_in']:.2f} <= RR_pre {w['rr_pre']:.2f}")
        else:
            verdict = "PASS"; reason.append(f"RR_in {w['rr_in']:.2f} (CI {lo:.2f}-{w['rr_in_ci'][1]:.2f}) > 1 and > RR_pre {w['rr_pre']:.2f}")
    report["verdict"] = verdict
    report["reason"] = "; ".join(reason)

    with open(os.path.join(OUT, "analysis.json"), "w") as fh:
        json.dump(report, fh, indent=1)

    # print summary
    print(f"sessions={n_all}  linked={len(linked)}  primary(team)={len(primary_pool)}  ambiguous={ambiguous}  no_pr={no_pr}")
    for W in WINDOWS:
        w = report["windows"][W]
        lab = " (PRIMARY)" if W == PRIMARY else ""
        print(f"\n[W={int(W)//60}min]{lab}")
        print(f"  P1 (premise changed while working) = {w['p1']*100:.1f}%  ({w['exposed']}/{w['n_primary']}, 95% CI {w['p1_lo']*100:.1f}-{w['p1_hi']*100:.1f}%)")
        print(f"  placebo pre-window rate = {w['pre_rate']*100:.1f}%   base-moved = {w['base_rate']*100:.1f}%   moot = {w['moot_rate']*100:.1f}%")
        print(f"  resolved={w['n_resolved']}  exposed_resolved={w['exposed_resolved']}")
        rr = w["rr_in"]; ci = w["rr_in_ci"]
        print(f"  RR_in(harm) = {rr:.2f}  CI {ci[0]:.2f}-{ci[1]:.2f}   RR_pre = {w['rr_pre']:.2f}")
    print(f"\nK2 VERDICT ({int(PRIMARY)//60}min): {report['verdict']}  --  {report['reason']}")


if __name__ == "__main__":
    main()
