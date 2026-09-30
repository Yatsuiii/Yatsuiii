"""Synthetic-sequence tests for the session reconstruction logic (PREREGISTRATION.md §2)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.reconstruct import Session, reconstruct  # noqa: E402

T0 = 1_724_000_000  # arbitrary epoch base


def ev(ts, type, action="", actor="alice", issue=None, is_pr=False, head_ref=None,
       base_ref=None, assignee=None, issue_created=None, comments=None):
    return dict(ts=ts, type=type, action=action, actor=actor, issue=issue, is_pr=is_pr,
                head_ref=head_ref, base_ref=base_ref, assignee=assignee,
                issue_created=issue_created, comments=comments)


def mk_session(**kw):
    d = dict(repo="o/r", issue=10, t0=T0, assigner="alice", comments0=0, issue_created=T0 - 1000)
    d.update(kw)
    return Session(**d)


def base_events():
    """A clean session: issue #10 assigned to Copilot, Copilot opens PR #11, pushes,
    human reviews at +50min, PR merged."""
    return [
        ev(T0, "IssuesEvent", "assigned", actor="alice", issue=10, assignee="Copilot", issue_created=T0 - 1000),
        ev(T0 + 300, "PullRequestEvent", "opened", actor="Copilot", issue=11, head_ref="copilot/fix", base_ref="main"),
        ev(T0 + 600, "PushEvent", actor="Copilot", head_ref="copilot/fix"),
        ev(T0 + 3000, "PullRequestReviewEvent", "created", actor="bob", issue=11),
        ev(T0 + 3600, "PullRequestEvent", "merged", actor="bob", issue=11, base_ref="main"),
    ]


W = 3600  # primary window used in most assertions


def test_linked_pr_and_merge_outcome():
    s = reconstruct(mk_session(), base_events())
    assert s.linked_pr == 11
    assert s.outcome == "merged"
    assert s.head_ref == "copilot/fix"
    assert s.e_in[W] is False and s.e_pre[W] is False
    # exposures are computed for every configured window
    assert set(s.e_in) == {1800, 3600, 10800}


def test_no_pr():
    evs = [ev(T0, "IssuesEvent", "assigned", issue=10, assignee="Copilot")]
    s = reconstruct(mk_session(), evs)
    assert s.linked_pr is None and s.outcome == "no_pr"


def test_ambiguous_two_concurrent_sessions():
    s = mk_session(issue=10)
    # another Copilot session started 5 min later in same repo
    s = reconstruct(s, base_events(), other_t0s=[T0 + 300])
    assert s.ambiguous is True


def test_e_in_comment_exposure():
    evs = base_events() + [ev(T0 + 400, "IssueCommentEvent", "created", actor="carol", issue=10, is_pr=False)]
    s = reconstruct(mk_session(), evs)
    # window is (T0, T0+600]; comment at +400 on the issue by a human → E_in
    assert s.e_in[W] is True
    assert s.e_in_comment_only[W] is True


def test_comment_on_pr_is_not_a_premise_event():
    evs = base_events() + [ev(T0 + 400, "IssueCommentEvent", "created", actor="carol", issue=11, is_pr=True)]
    s = reconstruct(mk_session(), evs)
    assert s.e_in[W] is False  # comment was on the PR (#11), not the task issue (#10)


def test_label_within_grace_excluded():
    evs = base_events() + [ev(T0 - 1000 + 50, "IssuesEvent", "labeled", actor="carol", issue=10)]
    s = reconstruct(mk_session(), evs)
    # label applied 50s after issue creation → template, excluded; and it's before t0 anyway
    assert s.e_pre[W] is False and s.e_in[W] is False


def test_e_pre_placebo():
    # premise event in the pre-window [t0-L, t0); L = t1-t0 = 600
    evs = base_events() + [ev(T0 - 300, "IssuesEvent", "labeled", actor="carol", issue=10)]
    s = reconstruct(mk_session(), evs)
    assert s.e_pre[W] is True and s.e_in[W] is False


def test_copilot_own_events_not_premise():
    evs = base_events() + [ev(T0 + 400, "IssueCommentEvent", "created", actor="Copilot", issue=10)]
    s = reconstruct(mk_session(), evs)
    assert s.e_in[W] is False


def test_reassignment_is_premise():
    evs = base_events() + [ev(T0 + 450, "IssuesEvent", "assigned", actor="dave", issue=10, assignee="erin")]
    s = reconstruct(mk_session(), evs)
    assert s.e_in[W] is True and s.e_in_comment_only[W] is False


def test_e_base_push_to_base_branch():
    evs = base_events() + [ev(T0 + 500, "PushEvent", actor="frank", head_ref="main")]
    s = reconstruct(mk_session(), evs)
    assert s.e_base[W] is True


def test_e_base_other_pr_merged_into_base():
    evs = base_events() + [ev(T0 + 500, "PullRequestEvent", "merged", actor="frank", issue=99, base_ref="main")]
    s = reconstruct(mk_session(), evs)
    assert s.e_base[W] is True


def test_moot_issue_closed_in_window():
    evs = base_events() + [ev(T0 + 550, "IssuesEvent", "closed", actor="grace", issue=10)]
    s = reconstruct(mk_session(), evs)
    assert s.moot[W] is True


def test_closed_unmerged_outcome():
    evs = [
        ev(T0, "IssuesEvent", "assigned", issue=10, assignee="Copilot", issue_created=T0 - 1000),
        ev(T0 + 300, "PullRequestEvent", "opened", actor="Copilot", issue=11, head_ref="copilot/fix", base_ref="main"),
        ev(T0 + 4000, "PullRequestEvent", "closed", actor="bob", issue=11, base_ref="main"),
    ]
    s = reconstruct(mk_session(), evs)
    assert s.outcome == "closed"



def test_outcome_open_beyond_horizon():
    evs = base_events()[:3] + [ev(T0 + 20 * 86400, "PullRequestEvent", "merged", actor="bob", issue=11, base_ref="main")]
    s = reconstruct(mk_session(), evs)
    assert s.outcome == "open"  # merge is beyond the 14-day horizon
