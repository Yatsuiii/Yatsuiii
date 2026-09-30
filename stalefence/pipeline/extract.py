"""Turn a raw GH Archive event into the compact dict reconstruct.py consumes.

Only the fields named in PREREGISTRATION.md §2 are kept. Returns None for event types
we never use, to keep the world log small.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

KEEP = {
    "IssuesEvent", "IssueCommentEvent", "PullRequestEvent",
    "PullRequestReviewEvent", "PullRequestReviewCommentEvent", "PushEvent",
}


def _ts(s: str) -> int:
    # created_at like "2026-09-15T15:04:32Z"
    return int(datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


def _ref_tail(ref: Optional[str]) -> Optional[str]:
    if not ref:
        return None
    return ref.split("/", 2)[-1] if ref.startswith("refs/heads/") else ref


def extract(e: dict) -> Optional[dict]:
    t = e.get("type")
    if t not in KEEP:
        return None
    repo = e.get("repo", {}).get("name")
    actor = e.get("actor", {}).get("login", "")
    p = e.get("payload", {}) or {}
    ts = _ts(e["created_at"])
    out = dict(ts=ts, type=t, action=p.get("action", "") or "", actor=actor, repo=repo,
               issue=None, is_pr=False, head_ref=None, base_ref=None, assignee=None,
               issue_created=None, comments=None)

    if t == "IssuesEvent":
        iss = p.get("issue", {}) or {}
        out["issue"] = iss.get("number")
        out["is_pr"] = "pull_request" in iss
        asg = p.get("assignee") or {}
        out["assignee"] = asg.get("login")
        if iss.get("created_at"):
            out["issue_created"] = _ts(iss["created_at"])
        out["comments"] = iss.get("comments")

    elif t == "IssueCommentEvent":
        iss = p.get("issue", {}) or {}
        out["issue"] = iss.get("number")
        out["is_pr"] = "pull_request" in iss
        if iss.get("created_at"):
            out["issue_created"] = _ts(iss["created_at"])
        out["comments"] = iss.get("comments")

    elif t == "PullRequestEvent":
        pr = p.get("pull_request", {}) or {}
        out["issue"] = p.get("number") or pr.get("number")
        out["is_pr"] = True
        out["head_ref"] = (pr.get("head") or {}).get("ref")
        out["base_ref"] = (pr.get("base") or {}).get("ref")
        # normalize merged close to action "merged"
        if p.get("action") == "closed":
            out["action"] = "merged" if pr.get("merged") else "closed"

    elif t in ("PullRequestReviewEvent", "PullRequestReviewCommentEvent"):
        pr = p.get("pull_request", {}) or {}
        out["issue"] = pr.get("number")
        out["is_pr"] = True

    elif t == "PushEvent":
        out["head_ref"] = _ref_tail(p.get("ref"))

    return out
