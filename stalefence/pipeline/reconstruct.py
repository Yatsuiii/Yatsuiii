"""Reconstruct Copilot coding-agent sessions from a repo's compact event log.

Pure functions, no I/O, so the logic in PREREGISTRATION.md §2 can be unit-tested on
synthetic event sequences. A compact event is a dict with these keys (see extract.py):

    ts            int   epoch seconds (created_at)
    type          str   GH Archive event type
    action        str   payload.action, or ""
    actor         str   actor.login
    issue         int|None   issue/PR number this event is about
    is_pr         bool  True if this number refers to a pull request (PR comment,
                        review, review-comment, or a PullRequestEvent)
    head_ref      str|None   linked PR head branch (PullRequestEvent / push ref tail)
    base_ref      str|None   PR base branch (PullRequestEvent)
    merged        bool  PullRequestEvent action=="closed" with merged==true → mapped to
                        action "merged" upstream; kept for clarity
    assignee      str|None   IssuesEvent assignee login
    issue_created int|None   payload.issue.created_at, when the event carries the issue
    comments      int|None   payload.issue.comments at event time

All windows are half-open (t0, t1] unless stated. Times are epoch seconds.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

COPILOT = "Copilot"
HOUR = 3600
CAP = 3 * HOUR
LINK_WINDOW = 30 * 60
TEMPLATE_GRACE = 120
OUTCOME_HORIZON = 14 * 86400
# Agent commits/pushes are not observable in GH Archive (see PREREGISTRATION.md §7,
# 2026-09-30), so the work window is a fixed active-duration proxy after t0, reported at
# several lengths for robustness. Primary window = 1 h.
WINDOWS = (1800, 3600, 10800)
PRIMARY_W = 3600


def is_bot(login: str) -> bool:
    return login == COPILOT or login.endswith("[bot]")


def is_human(login: str) -> bool:
    return not is_bot(login)


@dataclass
class Session:
    repo: str
    issue: int
    t0: int
    assigner: str
    comments0: int
    issue_created: Optional[int] = None
    # filled by reconstruct()
    linked_pr: Optional[int] = None
    pr_opened_ts: Optional[int] = None
    head_ref: Optional[str] = None
    base_ref: Optional[str] = None
    ambiguous: bool = False
    # exposures per window length: {W: bool}
    e_in: dict = field(default_factory=dict)
    e_pre: dict = field(default_factory=dict)
    e_base: dict = field(default_factory=dict)
    moot: dict = field(default_factory=dict)
    e_in_comment_only: dict = field(default_factory=dict)
    outcome: Optional[str] = None  # "merged" | "closed" | "open" | "no_pr"
    premise_in: list = field(default_factory=list)  # premise events within the largest window


def find_linked_pr(session: Session, events: list, other_t0s: list) -> None:
    """First Copilot PR opened in [t0, t0+30min]. Ambiguous if another Copilot
    session in the same repo is also waiting for its PR in an overlapping window."""
    cands = [
        e for e in events
        if e["type"] == "PullRequestEvent" and e["action"] == "opened"
        and e["actor"] == COPILOT and session.t0 <= e["ts"] <= session.t0 + LINK_WINDOW
    ]
    # Another session whose [t0, t0+30min] contains this one's t0 (both awaiting a PR)
    overlap = any(abs(o - session.t0) <= LINK_WINDOW for o in other_t0s if o != session.t0)
    if not cands:
        session.linked_pr = None
        session.ambiguous = overlap and False  # no PR at all → just no_pr, not ambiguous
        return
    if overlap and len(cands) >= 1:
        # Cannot attribute a Copilot PR to one of several concurrent Copilot sessions.
        session.ambiguous = True
        return
    e = min(cands, key=lambda e: e["ts"])
    session.linked_pr = e["issue"]
    session.pr_opened_ts = e["ts"]
    session.head_ref = e.get("head_ref")
    session.base_ref = e.get("base_ref")


def _premise_on_issue(e: dict, session: Session) -> bool:
    if e["actor"] == COPILOT or not is_human(e["actor"]):
        return False
    if e["issue"] != session.issue:
        return False
    if session.issue_created is not None and e["ts"] < session.issue_created + TEMPLATE_GRACE:
        return False
    if e["type"] == "IssueCommentEvent" and not e.get("is_pr"):
        return True
    if e["type"] == "IssuesEvent" and e["action"] in ("closed", "reopened", "labeled", "unlabeled"):
        return True
    if e["type"] == "IssuesEvent" and e["action"] == "assigned" and e.get("assignee") != COPILOT:
        return True
    return False


def _is_comment(e: dict) -> bool:
    return e["type"] == "IssueCommentEvent"


def compute_exposures(session: Session, events: list) -> None:
    t0 = session.t0
    base = session.base_ref
    prem = [e for e in events if _premise_on_issue(e, session)]
    largest = max(WINDOWS)
    session.premise_in = [(e["ts"], e["type"], e["action"], e["actor"]) for e in prem
                          if t0 < e["ts"] <= t0 + largest]
    for W in WINDOWS:
        prem_in = [e for e in prem if t0 < e["ts"] <= t0 + W]
        prem_pre = [e for e in prem if t0 - W <= e["ts"] < t0]
        session.e_in[W] = len(prem_in) > 0
        session.e_pre[W] = len(prem_pre) > 0
        session.e_in_comment_only[W] = len(prem_in) > 0 and all(_is_comment(e) for e in prem_in)
        e_base = False
        for e in events:
            if not (t0 < e["ts"] <= t0 + W) or e["actor"] == COPILOT:
                continue
            if e["type"] == "PushEvent" and base and e.get("head_ref") == base:
                e_base = True
            elif (e["type"] == "PullRequestEvent" and e["action"] == "merged"
                  and e.get("base_ref") == base and e["issue"] != session.linked_pr):
                e_base = True
        session.e_base[W] = e_base
        session.moot[W] = any(
            e["type"] == "IssuesEvent" and e["action"] == "closed" and e["issue"] == session.issue
            and e["actor"] != COPILOT and is_human(e["actor"]) and t0 < e["ts"] <= t0 + W
            for e in events
        )


def compute_outcome(session: Session, events: list) -> None:
    pr = session.linked_pr
    horizon = session.t0 + OUTCOME_HORIZON
    outcome = "open"
    for e in sorted(events, key=lambda e: e["ts"]):
        if e["type"] == "PullRequestEvent" and e["issue"] == pr and session.pr_opened_ts <= e["ts"] <= horizon:
            if e["action"] == "merged":
                outcome = "merged"
                break
            if e["action"] == "closed":
                outcome = "closed"
                break
    session.outcome = outcome


def reconstruct(session: Session, events: list, other_t0s: Optional[list] = None) -> Session:
    """Run the full pipeline for one session against its repo's event list."""
    events = sorted(events, key=lambda e: e["ts"])
    find_linked_pr(session, events, other_t0s or [])
    if session.ambiguous:
        return session
    if session.linked_pr is None:
        session.outcome = "no_pr"
        return session
    compute_exposures(session, events)
    compute_outcome(session, events)
    return session
