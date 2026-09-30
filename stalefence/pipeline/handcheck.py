"""Hand-check 20 random sessions against their raw shard events (PREREGISTRATION.md §2.4),
and diagnose the no_pr / ambiguous categories."""
import os, sys, collections, orjson, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.run_study import shard_of, OUT, SHARDS

S = [orjson.loads(l) for l in open(os.path.join(OUT, "sessions_enriched.jsonl"), "rb")]
by_key = {(s["repo"], s["issue"]): s for s in S}
# load shard events per repo lazily
shard_cache = {}
def repo_events(repo):
    sh = shard_of(repo)
    if sh not in shard_cache:
        d = collections.defaultdict(list)
        p = os.path.join(SHARDS, f"shard_{sh}.jsonl")
        if os.path.exists(p):
            for line in open(p, "rb"):
                c = orjson.loads(line); d[c["repo"]].append(c)
        shard_cache[sh] = d
    return sorted(shard_cache[sh].get(repo, []), key=lambda e: e["ts"])

def dump(s, n=14):
    r, iss, pr, t0 = s["repo"], s["issue"], s["linked_pr"], s["t0"]
    print(f"\n=== {r} issue#{iss} PR#{pr} outcome={s['outcome']} team={s['team']} e_in(1h)={s['e_in'].get('3600') if isinstance(s['e_in'],dict) else None}")
    evs = [e for e in repo_events(r) if e["issue"] in (iss, pr) or e["actor"] == "Copilot"]
    for e in evs[:n]:
        print(f"   +{e['ts']-t0:7d}s {e['actor']:20.20s} {e['type']:24.24s} {e['action']:10.10s} issue={e['issue']} is_pr={e['is_pr']} head={e.get('head_ref')}")

random.seed(20260930)
sample = random.sample(S, 20)
print("### 20 random sessions (hand-check)")
for s in sample:
    dump(s)

print("\n\n### diagnose no_pr: are there Copilot PRs just outside the 30-min link window?")
no_pr = [s for s in S if s["outcome"] == "no_pr"]
late = same = none = 0
for s in random.sample(no_pr, min(40, len(no_pr))):
    evs = repo_events(s["repo"])
    cop_prs = [e for e in evs if e["type"] == "PullRequestEvent" and e["action"] == "opened" and e["actor"] == "Copilot" and e["ts"] >= s["t0"]]
    if not cop_prs:
        none += 1
    elif cop_prs[0]["ts"] - s["t0"] <= 1800:
        same += 1  # should have linked (ambiguity?)
    else:
        late += 1
print(f"no_pr sample of 40: no Copilot PR after t0={none}, PR within 30min(should-link/ambiguous)={same}, PR later than 30min={late}")

print("\n### ambiguous count and typical repos")
amb = [s for s in S if s["ambiguous"]]
print("ambiguous total:", len(amb), "top repos:", collections.Counter(s["repo"] for s in amb).most_common(6))
