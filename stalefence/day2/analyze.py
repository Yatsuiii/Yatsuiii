"""Day-2 analysis: apply K-a / K-b / K-c (DAY2_DESIGN.md), pooled over the 9 main cells,
with replication-clustered bootstrap intervals; per-λ tables; sensitivity runs."""
from __future__ import annotations

import gzip
import json
import os
import statistics
from collections import Counter, defaultdict

import numpy as np
import orjson

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "results", "day2")
CONDS = ("C0", "C1", "C2", "C3", "C4")


def load(tag):
    A = [orjson.loads(l) for l in gzip.open(os.path.join(OUT, f"actions_{tag}.jsonl.gz"))]
    T = [orjson.loads(l) for l in gzip.open(os.path.join(OUT, f"tasks_{tag}.jsonl.gz"))]
    return A, T


def summarize(A):
    s = {}
    for c in CONDS:
        rows = [a for a in A if a["cond"] == c and a["outcome"] != "diverged"]
        oc = Counter(a["outcome"] for a in rows)
        n = len(rows)
        s[c] = dict(n=n, **{k: oc.get(k, 0) for k in ("valid", "invalid", "rejected", "avoided", "gave_up")},
                    diverged=sum(1 for a in A if a["cond"] == c and a["outcome"] == "diverged"),
                    false_aborts=sum(a["false_aborts"] for a in rows),
                    true_aborts=sum(a["true_aborts"] for a in rows),
                    replan_time=sum(a["replan_time"] for a in rows),
                    tokens=sum(a["tokens"] for a in rows))
        s[c]["far"] = s[c]["false_aborts"] / n if n else 0.0
    return s


def rules(s, A, T):
    inv0, inv2, inv3, inv4 = (s[c]["invalid"] for c in ("C0", "C2", "C3", "C4"))
    ka_prev = (1 - inv2 / inv0) if inv0 else float("nan")
    ka_kill = (inv0 == 0) or (ka_prev >= 0.90)
    far3, far4 = s["C3"]["far"], s["C4"]["far"]
    ratio = (far3 / far4) if far4 > 0 else (float("inf") if far3 > 0 else 1.0)
    kb_kill = (inv3 <= inv4 + 1) and (far3 <= 1.3 * far4)
    c4_checks = [a["check_time"] for a in A if a["cond"] == "C4" and a["outcome"] != "diverged"]
    c4_wall = [t["duration"] for t in T if t["cond"] == "C4"]
    med_chk, med_wall = statistics.median(c4_checks), statistics.median(c4_wall)
    kc_kill = med_chk > 0.20 * med_wall
    return dict(K_a=dict(invalid_C0=inv0, invalid_C2=inv2, prevention=ka_prev, kill=ka_kill),
                K_b=dict(invalid_C3=inv3, invalid_C4=inv4, far_C3=far3, far_C4=far4, ratio=ratio, kill=kb_kill),
                K_c=dict(median_check_s=med_chk, median_task_wall_s=med_wall,
                         share=med_chk / med_wall, kill=kc_kill))


def bootstrap(A, B=1000, seed=20260930):
    """Replication-clustered bootstrap of the C2 prevention fraction and the C3/C4 FAR ratio."""
    by = defaultdict(list)
    for a in A:
        by[(a["lam"], a["N"], json.dumps(a["gid"]), a.get("rep") if not isinstance(a.get("rep"), list) else json.dumps(a["rep"]))].append(a)
    # cluster = (lam, N, rep): group-level keys vary, so cluster on rep tuple only
    clusters = defaultdict(list)
    for a in A:
        rep = a["rep"]
        key = json.dumps(rep) if isinstance(rep, list) else str(rep)
        clusters[key].append(a)
    keys = list(clusters)
    rng = np.random.default_rng(seed)
    prev, ratio = [], []
    for _ in range(B):
        pick = rng.choice(len(keys), len(keys), replace=True)
        cnt = Counter(); fa = Counter(); n = Counter()
        for i in pick:
            for a in clusters[keys[i]]:
                if a["outcome"] == "diverged":
                    continue
                n[a["cond"]] += 1
                fa[a["cond"]] += a["false_aborts"]
                if a["outcome"] == "invalid":
                    cnt[a["cond"]] += 1
        if cnt["C0"]:
            prev.append(1 - cnt["C2"] / cnt["C0"])
        f3 = fa["C3"] / n["C3"] if n["C3"] else 0
        f4 = fa["C4"] / n["C4"] if n["C4"] else 0
        if f4 > 0:
            ratio.append(f3 / f4)
    pct = lambda x: (float(np.percentile(x, 2.5)), float(np.percentile(x, 97.5))) if x else (float("nan"),) * 2
    return dict(prevention_ci=pct(prev), far_ratio_ci=pct(ratio))


def makespan_penalty(T):
    ms = defaultdict(dict)
    for t in T:
        k = (json.dumps(t["rep"]) if isinstance(t["rep"], list) else str(t["rep"]), t["gid"])
        ms[k][t["cond"]] = max(ms[k].get(t["cond"], 0), t["end"])
    r = [v["C1"] / v["C0"] for v in ms.values() if "C1" in v and "C0" in v and v["C0"] > 0]
    return statistics.mean(r) if r else float("nan")


def main():
    allA, allT, per = [], [], {}
    for lam in ("low", "medium", "high"):
        A, T = load(lam)
        allA += A; allT += T
        per[lam] = summarize(A)
    pooled = summarize(allA)
    R = rules(pooled, allA, allT)
    BS = bootstrap(allA)
    sens = {}
    for tag in ("sens_user10", "sens_user60", "sens_relevant"):
        A, T = load(tag)
        s = summarize(A)
        sens[tag] = dict(summary=s, rules=rules(s, A, T))
    report = dict(per_lambda=per, pooled=pooled, rules=R, bootstrap=BS,
                  c1_makespan_ratio=makespan_penalty(allT), sensitivity=sens)
    with open(os.path.join(OUT, "analysis.json"), "w") as fh:
        json.dump(report, fh, indent=1, default=str)

    print("per λ (evaluable actions; per 1,000):")
    for lam, s in per.items():
        n0 = s["C0"]["n"]
        print(f"  {lam:6s} C0 n={n0}: invalid {1000*s['C0']['invalid']/n0:.2f}  rejected {1000*s['C0']['rejected']/n0:.1f}"
              f" | C2 invalid {1000*s['C2']['invalid']/s['C2']['n']:.2f}"
              f" | FAR C3 {1000*s['C3']['far']:.1f} vs C4 {1000*s['C4']['far']:.1f}"
              f" | gave_up C3 {s['C3']['gave_up']} C4 {s['C4']['gave_up']}")
    print("\ntrade-off per λ (per 1,000 evaluable actions):")
    for lam, s in per.items():
        n0, n4, n3 = s["C0"]["n"], s["C4"]["n"], s["C3"]["n"]
        prev4 = 1000 * (s["C0"]["invalid"] / n0 - s["C4"]["invalid"] / n4)
        far4, far3 = 1000 * s["C4"]["far"], 1000 * s["C3"]["far"]
        print(f"  {lam:6s} silently-wrong prevented by C4 {prev4:.2f} | C4 false aborts {far4:.1f}"
              f" ({(far4/prev4 if prev4>0 else float('inf')):.0f} per prevented) | rejected->avoided C4 {1000*s['C4']['avoided']/n4:.1f}"
              f" | C3 false aborts {far3:.1f}, gave_up {1000*s['C3']['gave_up']/n3:.1f} vs C4 {1000*s['C4']['gave_up']/n4:.1f}")
    print("\npooled:")
    for c in CONDS:
        x = pooled[c]
        print(f"  {c}: n={x['n']} valid={x['valid']} invalid={x['invalid']} rejected={x['rejected']} avoided={x['avoided']}"
              f" gave_up={x['gave_up']} false_aborts={x['false_aborts']} true_aborts={x['true_aborts']} diverged={x['diverged']}")
    ka, kb, kc = R["K_a"], R["K_b"], R["K_c"]
    print(f"\nK-a: C2 prevents {ka['prevention']*100:.1f}% of C0's {ka['invalid_C0']} invalid actions "
          f"(95% CI {BS['prevention_ci'][0]*100:.1f}-{BS['prevention_ci'][1]*100:.1f}%)  -> {'KILL' if ka['kill'] else 'no kill'}")
    print(f"K-b: invalid C3={kb['invalid_C3']} C4={kb['invalid_C4']}; false-abort rate C3={kb['far_C3']*1000:.1f} vs C4={kb['far_C4']*1000:.1f} per 1,000 "
          f"(ratio {kb['ratio']:.2f}, 95% CI {BS['far_ratio_ci'][0]:.2f}-{BS['far_ratio_ci'][1]:.2f})  -> {'KILL' if kb['kill'] else 'no kill'}")
    print(f"K-c: C4 median check {kc['median_check_s']*1000:.0f} ms vs median task {kc['median_task_wall_s']:.0f} s "
          f"({kc['share']*100:.3f}%)  -> {'KILL' if kc['kill'] else 'no kill'}")
    print(f"C1 makespan / C0 makespan = {report['c1_makespan_ratio']:.2f}x")
    print("\nsensitivity (λ=medium, N=4):")
    for tag, v in sens.items():
        r = v["rules"]
        print(f"  {tag}: K-a prev={r['K_a']['prevention']} kill={r['K_a']['kill']} | K-b ratio={r['K_b']['ratio']:.2f} kill={r['K_b']['kill']} | K-c kill={r['K_c']['kill']}")
    verdict = "KILL" if (ka["kill"] or kb["kill"] or kc["kill"]) else "NO KILL"
    print(f"\nDAY-2 VERDICT: {verdict}")


if __name__ == "__main__":
    main()
