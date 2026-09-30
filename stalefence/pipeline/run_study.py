"""Two-pass GH Archive study driver (PREREGISTRATION.md §2, window per §7 deviation).

Pass A  streams the start-window hours, finds issue-assignments to Copilot -> sessions.
Pass B  streams the full period, keeps session-relevant events for candidate repos into
        shards, and counts distinct human actors per repo (team-repo filter).
Reconstruct  groups each shard by repo and runs pipeline.reconstruct on every session.

Outputs (results/gh/): sessions_raw.jsonl, candidate_repos.txt, actors.json,
shards/shard_*.jsonl, sessions_enriched.jsonl.
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
DEDUP = 1800  # 30 min


def shard_of(repo: str) -> int:
    h = 0
    for c in repo:
        h = (h * 131 + ord(c)) & 0xFFFFFFFF
    return h % NSHARD


def pass_a():
    os.makedirs(OUT, exist_ok=True)
    urls = hour_urls(START_LO, START_HI)
    sessions = {}  # (repo,issue) -> dict
    t0 = time.time()
    for i, url in enumerate(urls):
        for e in stream_hour(url):
            if e.get("type") != "IssuesEvent":
                continue
            p = e.get("payload") or {}
            if p.get("action") != "assigned":
                continue
            if (p.get("assignee") or {}).get("login") != COPILOT:
                continue
            iss = p.get("issue", {}) or {}
            repo = e["repo"]["name"]
            num = iss.get("number")
            key = (repo, num)
            ts = _ts(e["created_at"])
            rec = dict(repo=repo, issue=num, t0=ts, assigner=e["actor"]["login"],
                       comments0=iss.get("comments") or 0,
                       issue_created=(_ts(iss["created_at"]) if iss.get("created_at") else None))
            if key not in sessions or ts < sessions[key]["t0"]:
                # keep earliest, but dedup near-simultaneous re-assigns
                if key in sessions and abs(ts - sessions[key]["t0"]) < DEDUP:
                    continue
                sessions[key] = rec
        if (i + 1) % 48 == 0:
            print(f"[pass A] {i+1}/{len(urls)} hours, {len(sessions)} sessions, {time.time()-t0:.0f}s", flush=True)
    with open(os.path.join(OUT, "sessions_raw.jsonl"), "wb") as fh:
        for rec in sessions.values():
            fh.write(orjson.dumps(rec) + b"\n")
    repos = sorted({r for (r, _) in sessions})
    with open(os.path.join(OUT, "candidate_repos.txt"), "w") as fh:
        fh.write("\n".join(repos) + "\n")
    print(f"[pass A] done: {len(sessions)} sessions, {len(repos)} candidate repos, {time.time()-t0:.0f}s", flush=True)
    return sessions, set(repos)


def pass_b(candidate_repos, session_issues):
    os.makedirs(SHARDS, exist_ok=True)
    fhs = {i: open(os.path.join(SHARDS, f"shard_{i}.jsonl"), "wb") for i in range(NSHARD)}
    actors = {}  # repo -> set of human logins (bounded)
    urls = hour_urls(STREAM_LO, STREAM_HI)
    t0 = time.time()
    kept = 0
    for i, url in enumerate(urls):
        for e in stream_hour(url):
            repo = e.get("repo", {}).get("name")
            if repo not in candidate_repos:
                continue
            actor = e.get("actor", {}).get("login", "")
            if is_human(actor):
                s = actors.setdefault(repo, set())
                if len(s) < 200:
                    s.add(actor)
            c = extract(e)
            if c is None:
                continue
            typ = c["type"]
            keep = (
                actor == COPILOT
                or typ in ("PullRequestEvent", "PullRequestReviewEvent",
                           "PullRequestReviewCommentEvent", "PushEvent")
                or (typ in ("IssuesEvent", "IssueCommentEvent") and c["issue"] in session_issues.get(repo, ()))
            )
            if not keep:
                continue
            fhs[shard_of(repo)].write(orjson.dumps(c) + b"\n")
            kept += 1
        if (i + 1) % 48 == 0:
            print(f"[pass B] {i+1}/{len(urls)} hours, {kept} kept events, {time.time()-t0:.0f}s", flush=True)
    for fh in fhs.values():
        fh.close()
    actors_out = {r: len(s) for r, s in actors.items()}
    with open(os.path.join(OUT, "actors.json"), "wb") as fh:
        fh.write(orjson.dumps(actors_out))
    print(f"[pass B] done: {kept} kept events, {time.time()-t0:.0f}s", flush=True)
    return actors_out


def reconstruct_all(sessions, actors):
    # group sessions by shard
    by_shard = {}
    for rec in sessions.values():
        by_shard.setdefault(shard_of(rec["repo"]), []).append(rec)
    out = open(os.path.join(OUT, "sessions_enriched.jsonl"), "wb")
    n = 0
    for sh in range(NSHARD):
        path = os.path.join(SHARDS, f"shard_{sh}.jsonl")
        events_by_repo = {}
        if os.path.exists(path):
            with open(path, "rb") as fh:
                for line in fh:
                    c = orjson.loads(line)
                    events_by_repo.setdefault(c["repo"], []).append(c)
        # t0s per repo for ambiguity
        t0s_by_repo = {}
        for rec in by_shard.get(sh, []):
            t0s_by_repo.setdefault(rec["repo"], []).append(rec["t0"])
        for rec in by_shard.get(sh, []):
            s = Session(repo=rec["repo"], issue=rec["issue"], t0=rec["t0"],
                        assigner=rec["assigner"], comments0=rec["comments0"],
                        issue_created=rec.get("issue_created"))
            evs = events_by_repo.get(rec["repo"], [])
            others = [t for t in t0s_by_repo.get(rec["repo"], []) if t != rec["t0"]]
            reconstruct(s, evs, others)
            d = dict(repo=s.repo, issue=s.issue, t0=s.t0, comments0=s.comments0,
                     team=actors.get(s.repo, 0) >= 3, n_actors=actors.get(s.repo, 0),
                     linked_pr=s.linked_pr, ambiguous=s.ambiguous,
                     e_in={str(k): v for k, v in s.e_in.items()},
                     e_pre={str(k): v for k, v in s.e_pre.items()},
                     e_base={str(k): v for k, v in s.e_base.items()},
                     moot={str(k): v for k, v in s.moot.items()},
                     e_in_comment_only={str(k): v for k, v in s.e_in_comment_only.items()},
                     outcome=s.outcome, premise_in=s.premise_in)
            out.write(orjson.dumps(d) + b"\n")
            n += 1
    out.close()
    print(f"[reconstruct] wrote {n} enriched sessions", flush=True)


if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    sessions = {}
    if step in ("a", "all"):
        sessions, repos = pass_a()
    else:
        with open(os.path.join(OUT, "sessions_raw.jsonl"), "rb") as fh:
            for line in fh:
                r = orjson.loads(line)
                sessions[(r["repo"], r["issue"])] = r
        repos = {r for (r, _) in sessions}
    session_issues = {}
    for (repo, issue) in sessions:
        session_issues.setdefault(repo, set()).add(issue)
    if step in ("b", "all"):
        actors = pass_b(repos, session_issues)
    else:
        with open(os.path.join(OUT, "actors.json"), "rb") as fh:
            actors = orjson.loads(fh.read())
    reconstruct_all(sessions, actors)
