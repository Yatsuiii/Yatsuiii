"""Run the day-2 grid (DAY2_DESIGN.md). One λ level per invocation.

Usage:
  run.py main   <low|medium|high> [reps=100]
  run.py sens   <user10|user60|relevant> [reps=50]      (λ=medium, N=4)
"""
from __future__ import annotations

import gzip
import os
import random
import sys
import time

import orjson

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from day2.taubench import load_db, load_tools, sample_tasks  # noqa: E402
from day2.sim import GroupSim, Params, CONDITIONS, H0  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "results", "day2")
LAMBDAS = {"low": H0, "medium": 10 * H0, "high": 100 * H0}
NS = (2, 4, 8)


def run_cells(tag, cells, reps):
    os.makedirs(OUT, exist_ok=True)
    db, tools, tasks = load_db(), load_tools(), sample_tasks()
    fa = gzip.open(os.path.join(OUT, f"actions_{tag}.jsonl.gz"), "wb")
    ft = gzip.open(os.path.join(OUT, f"tasks_{tag}.jsonl.gz"), "wb")
    t0 = time.time()
    for (lam, N, p) in cells:
        for rep in range(reps):
            rng = random.Random(f"20260930-groups-{lam}-{N}-{rep}")
            order = list(range(len(tasks)))
            rng.shuffle(order)
            groups = [order[i:i + N] for i in range(0, len(order), N)]
            for gid, g in enumerate(groups):
                gt = [tasks[i] for i in g]
                for cond in CONDITIONS:
                    sim = GroupSim(gt, db, tools, cond, p, rep=(tag, lam, N, rep), gid=gid)
                    acts, trs = sim.run()
                    for r in acts:
                        r.update(lam=lam, N=N)
                        fa.write(orjson.dumps(r) + b"\n")
                    for r in trs:
                        r.update(lam=lam, N=N)
                        ft.write(orjson.dumps(r) + b"\n")
        print(f"[day2 {tag}] lam={lam} N={N} done ({time.time()-t0:.0f}s)", flush=True)
    fa.close()
    ft.close()


if __name__ == "__main__":
    mode, which = sys.argv[1], sys.argv[2]
    if mode == "main":
        reps = int(sys.argv[3]) if len(sys.argv) > 3 else 100
        p = Params(hazard_per_hour=LAMBDAS[which])
        run_cells(which, [(which, N, p) for N in NS], reps)
    elif mode == "sens":
        reps = int(sys.argv[3]) if len(sys.argv) > 3 else 50
        base = dict(hazard_per_hour=LAMBDAS["medium"])
        if which == "user10":
            p = Params(user_median=10.0, **base)
        elif which == "user60":
            p = Params(user_median=60.0, **base)
        else:
            p = Params(relevant_only=True, **base)
        run_cells(f"sens_{which}", [("medium", 4, p)], reps)
