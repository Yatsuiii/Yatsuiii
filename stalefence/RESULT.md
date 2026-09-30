# K2 result: INCONCLUSIVE (code wedge), with a real prevalence signal

The GitHub study (`PREREGISTRATION.md` §2) asked, on real Copilot coding-agent sessions,
how often a task's premises change while the agent works, and whether those tasks end worse.

**Verdict: INCONCLUSIVE for the code wedge.** The clean primary population is too small on
public GitHub, and harm cannot be measured because the outcomes do not resolve. But the
prevalence signal is non-trivial, so the idea is not killed — the decision moves to K1
(interviews on production systems), which the preregistration anticipated ("K2 covers code
only … K1 covers the rest").

## The funnel

| Step | Count |
| --- | ---: |
| Issue-assignments to Copilot (2026-08-15 … 09-14) | 753 |
| — no prompt PR within 30 min (genuine; 68% never opened one, 32% opened one later) | 486 |
| — ambiguous (several concurrent Copilot sessions in the repo) | 103 |
| **Linked sessions** (secondary population) | **164** |
| — in team repos (≥3 human actors) = **primary population** | **34** |

Hand-check of 20 random sessions: 0 misclassified (`results/gh/HANDCHECK.md`).

## What the numbers say (primary window = 1 h; 30 min / 3 h agree)

- **Prevalence, secondary (all 164 linked): P1 = 11.6 %** (19/164, 95% CI 7.5–17.4). A human
  changed the task issue within an hour of the agent starting about **twice as often as the
  placebo** pre-window baseline (5.5 %). At 3 h, 13.4 %.
- **The codebase moves too:** the PR's base branch was pushed to, or another PR merged into
  it, in **9.1 %** of linked sessions within 1 h (20.6 % within 3 h). Whether that touched the
  agent's files is invisible in GH Archive (no file lists), so this is only an upper-bound hint
  at semantic staleness.
- **Prevalence, primary (34 team-repo sessions): P1 = 0 %** (0/34, CI 0–10). Too few to
  conclude — this is why the primary test is inconclusive, not a kill.
- **Harm: unmeasurable.** Of the 164 linked PRs, **140 are still open**, 21 merged, 3 closed
  unmerged. Only 3 exposed-and-resolved sessions, against the 50 the rule needs. On public
  repos a Copilot PR merging is mostly about whether anyone bothered, so merge-outcome is a
  poor harm proxy here regardless of power.

`results/gh/analysis.json` has the full table; `sessions_enriched.jsonl` has every session.

## Why the code wedge can't settle it on public data

1. **The agent is invisible mid-task.** Copilot opens a draft PR ~6 s after assignment and its
   commits produce no public PushEvent, so "while the agent reasoned" can only be proxied by a
   fixed window after `t0` (§7 deviation), not the true coding interval.
2. **No file-level data.** The thesis is "a change touched the agent's files." GH Archive has
   no file lists for pushes, so only coarse signals (issue edited, base branch moved at all)
   are observable — and the clean one (issue edited during the window) is what P1 measures.
3. **Outcomes don't resolve.** 85 % of public Copilot PRs sit open within 14 days, so harm has
   nothing to bind to.
4. **The population is thin.** After removing delayed and ambiguous sessions, 34 team-repo
   sessions remain; earlier months have fewer, so the window can't be widened into power.

None of this refutes the thesis. It says the public code channel is the wrong place to measure
its cost. The prevalence signal (≈12 %, 2× placebo) is, if anything, mildly encouraging.

## Decision

- **Do not kill.** K2 is inconclusive-with-signal, not a KILL.
- **K1 is now load-bearing.** The stale-premise cost lives in production business systems
  (billing, CRM, deploys, incident response) that have no public event log. Run the interviews
  in `interview/`. K1's rule (≥3 of 10–15 teams with a real incident) decides the idea.
- **If K1 passes,** run the day-2 mechanism test (§5), whose kill rules are frozen — including
  the two cheap baselines (conditional writes, whole-read-set re-check) that would make this a
  100-line feature rather than a company.

## Limitations (beyond §6)

- The 1 h / 3 h windows are proxies for an unobservable coding interval; results are reported
  at three lengths and agree.
- Public repos and one agent (Copilot) only; private team repos, and agents acting across
  many systems, are exactly where the thesis is strongest and are unobservable here.
- The secondary P1 (all linked) is not the preregistered primary population; treat 11.6 % as
  suggestive, not confirmatory.

## Addendum (2026-09-30, after K1′ mining): the archive's capture swings day to day

K1′ mining showed that GH Archive's 2026 capture of issue events varies about 100× between
days (294 to 70,357 opened issues per day). On a thin day (2026-08-18) busy repos show ~1% of
their new issue numbers; on a well-captured day (2026-09-15) roughly a fifth or less
(`results/k1p/coverage_*.json`). 163 of the 164 linked sessions fall on well-captured days
(≥ 5,000 opened issues), so thin days don't distort the population
(`pipeline/capture_check.py` → `results/gh/capture_check.json`). But events inside a session's
window can still go uncaptured, so **K2's absolute rates (P1 11.6%, base moved 9.1%) are lower
bounds**. The comparison with the placebo window is unaffected, since both windows are
captured the same way. Day 2's "low" churn rate was anchored to 11.6%, so it is a floor too.
The medium (10×) rate covers anything up to ten times that.
