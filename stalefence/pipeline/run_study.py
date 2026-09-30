"""Resumable, time-boxed GH Archive study driver (PREREGISTRATION.md §2).

The host kills any single command that runs longer than ~90 s, so each invocation
processes whole UTC days until a wall-clock budget (~70 s) is spent, appends its output,
records progress, and exits. Re-invoke until a phase reports "done".

Phases:
  a  find Copilot issue-assignments in the start window  -> sessions_raw.jsonl
  b  keep session-relevant events for candidate repos    -> shards/, actors_sets.json
  r  reconstruct every session                           -> sessions_enriched.jsonl

Usage: run_study.py <a|b|r> [budget_seconds]
"""
from __future__ import annotations

import os
import sys
import time
import orjson

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.gha import stream_hour, hour_urls  # noqa: E402
from pipeline.extract import extract, _ts  # noqa: E402
from pipeline.reconstruct import Session, reconstruct, is_human, COPILOT  # noqa: E402

OUT = os.environ.get("SF_OUT") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "results", "gh")
SHARDS = os.path.join(OUT, "shards")
NSHARD = 32
START_LO = os.environ.get("SF_START_LO", "2026-08-15")
START_HI = os.environ.get("SF_START_HI", "2026-09-14")
STREAM_LO = os.environ.get("SF_STREAM_LO", "2026-08-14")
STREAM_HI = os.environ.get("SF_STREAM_HI", "2026-09-28")
BUDGET = float(sys.argv[2]) if len(sys.argv) > 2 else 70.0
DEDUP = 1800


def shard_of(repo: str) -> int:
    h = 0
    for c in repo:
        h = (h * 131 + ord(c)) & 0xFFFFFFFF
    return h % NSHARD


def days(lo: str, hi: str) -> list:
    urls = hour_urls(lo, hi)
    seen, out = set(), []
    for u in urls:
        d = u.rsplit("/", 1)[1].rsplit("-", 1)[0]  # YYYY-MM-DD
        if d not in seen:
            seen.add(d)
            out.append(d)
    return out


def load_json(path, default):
    if os.path.exists(path):
        with open(path, "rb") as fh:
            return orjson.loads(fh.read())
    return default


def save_json(path, obj):
    with open(path, "wb") as fh:
        fh.write(orjson.dumps(obj))


def phase_a() -> bool:
    os.makedirs(OUT, exist_ok=True)
    prog = set(load_json(os.path.join(OUT, "progress_a.json"), []))
    sessions = {}
    sp = os.path.join(OUT, "sessions_raw.jsonl")
    if os.path.exists(sp):
        for line in open(sp, "rb"):
            r = orjson.loads(line)
            sessions[(r["repo"], r["issue"])] = r
    all_days = days(START_LO, START_HI)
    todo = [d for d in all_days if d not in prog]
    if not todo:
        print(f"[A] complete: {len(sessions)} sessions over {len(all_days)} days", flush=True)
        return True
    t0 = time.time()
    done_now = []
    for d in todo:
        if time.time() - t0 > BUDGET and done_now:
            break
        for h in range(24):
            for e in stream_hour(f"https://data.gharchive.org/{d}-{h}.json.gz"):
                if e.get("type") != "IssuesEvent":
                    continue
                p = e.get("payload") or {}
                if p.get("action") != "assigned":
                    continue
                if (p.get("assignee") or {}).get("login") != COPILOT:
                    continue
                iss = p.get("issue", {}) or {}
                repo = e["repo"]["name"]
                key = (repo, iss.get("number"))
                ts = _ts(e["created_at"])
                if key in sessions and abs(ts - sessions[key]["t0"]) < DEDUP:
                    continue
                if key in sessions and sessions[key]["t0"] <= ts:
                    continue
                sessions[key] = dict(repo=repo, issue=iss.get("number"), t0=ts,
                                     assigner=e["actor"]["login"], comments0=iss.get("comments") or 0,
                                     issue_created=(_ts(iss["created_at"]) if iss.get("created_at") else None))
        done_now.append(d)
    prog |= set(done_now)
    with open(sp, "wb") as fh:
        for rec in sessions.values():
            fh.write(orjson.dumps(rec) + b"\n")
    save_json(os.path.join(OUT, "progress_a.json"), sorted(prog))
    repos = sorted({r for (r, _) in sessions})
    with open(os.path.join(OUT, "candidate_repos.txt"), "w") as fh:
        fh.write("\n".join(repos) + "\n")
    left = len(days(START_LO, START_HI)) - len(prog)
    print(f"[A] +{len(done_now)} days ({len(sessions)} sessions, {len(repos)} repos); {left} days left", flush=True)
    return left == 0


def phase_b() -> bool:
    os.makedirs(SHARDS, exist_ok=True)
    sessions = {}
    for line in open(os.path.join(OUT, "sessions_raw.jsonl"), "rb"):
        r = orjson.loads(line)
        sessions[(r["repo"], r["issue"])] = r
    candidate = {r for (r, _) in sessions}
    session_issues = {}
    for (repo, issue) in sessions:
        session_issues.setdefault(repo, set()).add(issue)
    prog = set(load_json(os.path.join(OUT, "progress_b.json"), []))
    actor_sets = {k: set(v) for k, v in load_json(os.path.join(OUT, "actors_sets.json"), {}).items()}
    all_days = days(STREAM_LO, STREAM_HI)
    todo = [d for d in all_days if d not in prog]
    if not todo:
        save_json(os.path.join(OUT, "actors.json"), {r: len(s) for r, s in actor_sets.items()})
        print(f"[B] complete over {len(all_days)} days", flush=True)
        return True
    fhs = {i: open(os.path.join(SHARDS, f"shard_{i}.jsonl"), "ab") for i in range(NSHARD)}
    t0 = time.time()
    done_now = []
    kept = 0
    for d in todo:
        if time.time() - t0 > BUDGET and done_now:
            break
        for h in range(24):
            for e in stream_hour(f"https://data.gharchive.org/{d}-{h}.json.gz"):
                repo = e.get("repo", {}).get("name")
                if repo not in candidate:
                    continue
                actor = e.get("actor", {}).get("login", "")
                if is_human(actor):
                    s = actor_sets.setdefault(repo, set())
                    if len(s) < 200:
                        s.add(actor)
                c = extract(e)
                if c is None:
                    continue
                typ = c["type"]
                if (actor == COPILOT
                        or typ in ("PullRequestEvent", "PullRequestReviewEvent",
                                   "PullRequestReviewCommentEvent", "PushEvent")
                        or (typ in ("IssuesEvent", "IssueCommentEvent") and c["issue"] in session_issues.get(repo, ()))):
                    fhs[shard_of(repo)].write(orjson.dumps(c) + b"\n")
                    kept += 1
        done_now.append(d)
    for fh in fhs.values():
        fh.close()
    prog |= set(done_now)
    save_json(os.path.join(OUT, "progress_b.json"), sorted(prog))
    save_json(os.path.join(OUT, "actors_sets.json"), {k: sorted(v) for k, v in actor_sets.items()})
    save_json(os.path.join(OUT, "actors.json"), {r: len(s) for r, s in actor_sets.items()})
    left = len(all_days) - len(prog)
    print(f"[B] +{len(done_now)} days ({kept} events this run); {left} days left", flush=True)
    return left == 0


def phase_r():
    sessions = {}
    for line in open(os.path.join(OUT, "sessions_raw.jsonl"), "rb"):
        r = orjson.loads(line)
        sessions[(r["repo"], r["issue"])] = r
    actors = load_json(os.path.join(OUT, "actors.json"), {})
    by_shard = {}
    for rec in sessions.values():
        by_shard.setdefault(shard_of(rec["repo"]), []).append(rec)
    out = open(os.path.join(OUT, "sessions_enriched.jsonl"), "wb")
    n = 0
    for sh in range(NSHARD):
        path = os.path.join(SHARDS, f"shard_{sh}.jsonl")
        events_by_repo = {}
        if os.path.exists(path):
            for line in open(path, "rb"):
                c = orjson.loads(line)
                events_by_repo.setdefault(c["repo"], []).append(c)
        t0s = {}
        for rec in by_shard.get(sh, []):
            t0s.setdefault(rec["repo"], []).append(rec["t0"])
        for rec in by_shard.get(sh, []):
            s = Session(repo=rec["repo"], issue=rec["issue"], t0=rec["t0"], assigner=rec["assigner"],
                        comments0=rec["comments0"], issue_created=rec.get("issue_created"))
            others = [t for t in t0s.get(rec["repo"], []) if t != rec["t0"]]
            reconstruct(s, events_by_repo.get(rec["repo"], []), others)
            out.write(orjson.dumps(dict(
                repo=s.repo, issue=s.issue, t0=s.t0, comments0=s.comments0,
                team=actors.get(s.repo, 0) >= 3, n_actors=actors.get(s.repo, 0),
                linked_pr=s.linked_pr, ambiguous=s.ambiguous,
                e_in={str(k): v for k, v in s.e_in.items()},
                e_pre={str(k): v for k, v in s.e_pre.items()},
                e_base={str(k): v for k, v in s.e_base.items()},
                moot={str(k): v for k, v in s.moot.items()},
                e_in_comment_only={str(k): v for k, v in s.e_in_comment_only.items()},
                outcome=s.outcome, premise_in=s.premise_in)) + b"\n")
            n += 1
    out.close()
    print(f"[R] wrote {n} enriched sessions", flush=True)


if __name__ == "__main__":
    phase = sys.argv[1] if len(sys.argv) > 1 else "a"
    if phase == "a":
        sys.exit(0 if phase_a() else 3)
    elif phase == "b":
        sys.exit(0 if phase_b() else 3)
    elif phase == "r":
        phase_r()
