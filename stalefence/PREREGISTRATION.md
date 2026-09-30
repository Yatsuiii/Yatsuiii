# Preregistration: do agents act on premises that changed while they worked?

| Field | Value |
| --- | --- |
| Registered | 2026-09-30, before any outcome in §2 or §3 was computed |
| Status | Frozen at the commit that adds this file. Changes go in §7 with a date and a reason. |
| Decides | Whether "stale-plan fencing for concurrent agents" is worth building as a company |

Before registering, one hour of GH Archive (2026-09-15 15:00 UTC) was read to learn the event
schema and how agents appear in it. Only field names, event-type counts and agent logins were
looked at; no exposure or outcome was computed. That hour is outside the study period.

## 1. Question

Agents read state, reason for minutes, then act. If the premises change in between, the action
can be wrong even though every read was fresh at the time. Prior work shows mechanisms that
catch this (PlanFence, CoAgent, S-Bus) on conflicts their authors constructed. Two questions
remain open, and this test asks them:

1. **Prevalence and harm (K2).** On real agents in the wild, how often do the premises of a
   task change while the agent is working on it, and do those tasks end worse?
2. **Demand (K1).** Do teams running agents against production systems have incidents of this
   kind, often enough to care?

## 2. Test K2: GitHub, the one public log of a changing world with real agents in it

### 2.1 Data and population

- **Source:** GH Archive hourly files, streamed 2026-08-17 00:00 UTC to 2026-09-14 23:59 UTC
  (29 days). Public repositories only.
- **Agent:** GitHub Copilot's coding agent, the one agent whose start is visible in the event
  stream (an issue assigned to `Copilot`). The 2026 stream has no PR bodies, so other agents'
  tasks cannot be linked to a start time.
- **Session:** an `IssuesEvent` with `action = assigned` and `assignee.login = Copilot`, with
  its timestamp `t0` in 2026-08-18 00:00 to 2026-08-31 23:59 UTC. Duplicate events for the same
  issue within 30 minutes count once.
- **Linked PR:** the first `PullRequestEvent` `opened` by `Copilot` in the same repository
  within 30 minutes after `t0`. If another Copilot session in the same repository is also
  waiting for a PR at that moment, both are *ambiguous* and excluded. Sessions with no linked
  PR are counted and excluded.
- **Team repository:** a repository with at least 3 distinct human actors (logins not ending in
  `[bot]` and not `Copilot`) with any event in the stream period.
- **Primary population:** linked sessions in team repositories. **Secondary:** all linked
  sessions.

### 2.2 The agent's work window

- **Handoff:** the first event on the linked PR not made by Copilot: a review, a review comment,
  a comment on the PR, or a merge or close.
- **`t1`:** the later of the PR's opening time and Copilot's last push to the PR's head branch
  before handoff, capped at `t0 + 3 h`. The window is `(t0, t1]`.

### 2.3 Measures

- **Premise event:** on the task issue, by a human actor, an issue comment, a close, a reopen,
  a label added or removed, or another person assigned. Excluded: Copilot's own events, and
  anything within 120 s of the issue's creation (labels applied by templates). Issue body edits
  are not in the stream, so every count here is a lower bound.
- **E_in (exposure):** at least one premise event inside `(t0, t1]`.
- **E_pre (placebo):** at least one premise event in the equal-length window just before `t0`.
  These are changes the agent could see, so they measure how contested the issue is, not
  staleness.
- **E_base (secondary):** during `(t0, t1]`, a push to the PR's base branch by anyone but
  Copilot, or another PR merged into that base branch.
- **Moot (secondary):** the issue was closed by a human inside `(t0, t1]`.
- **Outcome:** within 14 days of `t0`, the linked PR is `merged`, `closed` without merge, or
  still open. *Resolved* means merged or closed. **Harm:** closed without merge (1) versus
  merged (0), among resolved sessions.
- **Strata for harm:** team repository (yes/no) × comments on the issue at `t0` (0, 1–2, ≥3,
  read from the assignment event).

### 2.4 Analysis

- **P1:** the share of primary sessions with E_in = 1, with a Wilson 95% CI.
- **RR_in:** Mantel-Haenszel risk ratio of harm for E_in = 1 versus E_in = 0, over all resolved
  sessions and the six strata. **RR_pre:** the same for E_pre.
- **CIs:** repository-clustered bootstrap, 2,000 resamples, seed 20260930, percentile intervals.
- **Reported, not used in the rule:** P1 for all sessions, E_base and moot rates, the
  comments-only variant, window length distribution, and the counts excluded at each step.
- **Before the rule is applied:** 20 randomly chosen sessions (seed 20260930) are checked by
  hand against their raw events. If more than 2 are misclassified on exposure or outcome, the
  pipeline is fixed and rerun, logged in §7.

### 2.5 Rule K2 (the coding wedge)

| Result | When |
| --- | --- |
| **Too small** | Fewer than 300 primary sessions. The start window is extended back once to 2026-08-04, with streaming from 2026-08-03. If still fewer than 300, K2 is inconclusive. |
| **KILL** | P1 < 5% |
| **KILL** | At least 50 exposed resolved sessions, and either RR_in's lower 95% bound ≤ 1.0 or RR_in ≤ RR_pre. Premises change, but that doesn't make tasks end worse beyond ordinary contention. |
| **INCONCLUSIVE** | P1 ≥ 5% but fewer than 50 exposed resolved sessions |
| **PASS** | Otherwise: P1 ≥ 5%, RR_in's lower bound > 1.0, and RR_in > RR_pre |

K2 covers code only. Billing, CRM and cluster systems have no public event log; K1 covers them.

## 3. Test K1: do teams running agents in production have these incidents?

- **Who:** teams whose agents or automations take consequential write actions on production
  systems, beyond opening code PRs. Examples: incident response, deploys, billing, refunds,
  CRM and RevOps, support actions, internal platform operations.
- **How:** 10–15 conversations, following the script in `interview/`. Questions are about past
  events, and nothing is pitched until the end.
- **Counts as an incident (coded within 24 h of each call, ambiguous counts as no):** in the
  last 90 days, an agent or automation executed a consequential action based on state that
  changed between when it was read and when the action ran, with a concrete cost (rework,
  rollback, customer impact or money).
- **Window:** 21 days from the first outreach message. With fewer than 10 conversations by then,
  it is extended once by 14 days; still fewer than 10 is inconclusive.
- **Rule K1:** **KILL** if fewer than 3 teams report an incident. **PASS** otherwise.
- **Reported:** teams that built something in-house against it, what they use now (queues,
  locks, approvals, re-checks, conditional writes), and answers to the closing willingness-to-pay
  question.

## 4. What each outcome means

| K1 | K2 | Next |
| --- | --- | --- |
| KILL | any | Drop the idea. |
| PASS | PASS | Day-2 mechanism test on code and business systems. |
| PASS | KILL or INCONCLUSIVE | Day-2 mechanism test on business systems only. The GitLab setup stays a hackathon demo, not the wedge. |
| INCONCLUSIVE | any | Extend K1 once as in §3. |

## 5. Day-2 mechanism test (runs only if K1 passes)

Frozen here so the bar can't move later. The task set and code are added to §7 before any run.

- **Setup:** 40 tasks whose consequential actions depend on state in at least two systems. Every
  object exposes a version token. An outside process (standing in for humans and CI) changes
  state at a controlled rate λ (low, medium, high). N = 2, 4 or 8 concurrent LLM agents.
- **Conditions:**
  - C0: naive
  - C1: serial queue
  - C2: conditional write on the written object
  - C3: re-check the whole read-set before each consequential action
  - C4: dependency-scoped validation (PlanFence-style)
  - C5: C4 plus plan repair (CoAgent-style)
- **Metrics:** invalid consequential actions (safety), false aborts and replans (liveness), task
  success, wall time and tokens, reported per task and per wall-clock hour. For C4, also stale
  actions that got through because a dependency was not declared.
- **KILL if any holds:**
  - C2 alone prevents at least 90% of the invalid actions C0 makes. Most conflicts are then
    plain overwrites, and conditional writes suffice.
  - C3 is within one invalid action of C4, and its false-abort rate is within 30% of C4's. The
    dependency graph is then unnecessary: it's a 100-line feature.
  - C4's median added latency per consequential action exceeds 20% of median task wall time.

## 6. Limitations known in advance

- **Public repositories and one agent.** Private team repositories may differ. Copilot is the
  only agent whose start is observable.
- **Lower bound.** Issue body and comment edits are not in the stream, and neither are file
  lists for pushes, so E_base cannot say whether a base-branch change touched the agent's files.
- **Association, not causation.** The placebo (E_pre) and the strata address contention, but
  only partly.
- **Harm is measured by merge outcome.** Many public Copilot PRs are experiments that are never
  merged, whatever happened while the agent worked.
- **K1 is coded by the founder,** who wants it to pass. Mitigations: the rubric is fixed in
  advance, ambiguous calls count as no, and the notes are kept.

## 7. Deviations (append-only)

| Date | Section | Change | Reason |
| --- | --- | --- | --- |
| 2026-09-30 | §2.1 | Study window moved later and widened, before any outcome was computed: start window `t0 ∈ 2026-08-15 .. 2026-09-14` (31 days), world events streamed `2026-08-14 .. 2026-09-28`. Outcomes still need `t0 + 14 d`; GH Archive is available through 2026-09-29. | Sizing the population (allowed under the §2.5 "Too small" rule) showed the frozen window predates meaningful use of Copilot's coding agent: issue-assignments to Copilot run ~12–60/day and are more common in September. Placing the window where the agent is actually used raises power; more sessions do not bias the risk ratio either way. Only field/signal counts were read to decide this, no exposure or outcome. |
| 2026-09-30 | §2.5 | P1 (prevalence) is reported with its CI whenever there are linked sessions, even if the harm test is underpowered. The harm rule still needs ≥50 exposed resolved sessions; below that, harm is INCONCLUSIVE and reported descriptively. This was already implied by §2.5; stated explicitly because the thin public signal makes the harm arm the binding constraint. | P1 and the harm RR have different power needs; the prevalence question can be answered even when harm cannot. |
| 2026-09-30 | §2.2 | The work window `(t0, t1]` is replaced by a **fixed active-window proxy**: exposures are computed over `(t0, t0+W]` for `W ∈ {30 min, 1 h, 3 h}`, primary `W = 1 h`; the placebo is `(t0−W, t0]`. The push/handoff-based `t1` is dropped. K2's rule uses `W = 1 h`; the other two are a sensitivity check. This was decided from schema/timeline inspection of the smoke set only (9 sessions, 2 days), before any study-window outcome was computed. | GH Archive does not emit the coding agent's commits: Copilot opens a near-instant draft PR (~6 s after assignment) and its later commits produce no `Copilot` PushEvent, so `last push before handoff` is unobservable and `t1` collapsed to ~6 s. A fixed window after `t0` is observable, uniform across sessions, and does not depend on the invisible push stream. Reporting three lengths guards against the choice of `W`. |
| 2026-09-30 | §4, §5 | **Day 2 runs before K1**, at the founder's request. A day-2 KILL kills the idea regardless of K1; a day-2 pass cannot by itself pass the idea. | Day 2's kill rules don't depend on demand, so running the cheaper kill first loses nothing. |
| 2026-09-30 | §5 | Day 2 uses **replay of recorded τ-bench agent trajectories** instead of live LLM agents, with every parameter frozen in `DAY2_DESIGN.md` (committed before any run). C5 (repair) is not run. | No model API key; nested `claude` is blocked. All three §5 kill conditions depend on conflict structure and read behaviour, which the recordings capture; none depends on live repair. |
| 2026-09-30 | §3 | **K1 interviews replaced by K1′**, a no-outreach public-incident test frozen in `K1P_DESIGN.md` (committed before any issue text is searched). K1′ can KILL; a K1′ PASS is weak and still needs customer contact before building. | The founder cannot run calls. |
| 2026-09-30 | §5 / DAY2_DESIGN | Two replay rules added before any grid run: (1) if a change lands **before** the agent reads a record so that the recorded action fails on the agent's own information set, the action is **diverged** and excluded (a live agent would have adapted; replay cannot); after a re-plan the same situation is **avoided** (correct stop). (2) A re-plan refreshes the read set **plus** the declared scope. | Found while building the simulator; both are needed for replay to measure only between-read-and-act staleness. Neither favours any condition. |
| 2026-09-30 | DAY2_DESIGN (C3) | Bug fix after the first grid run, before any result was reported: records re-read during a re-plan now join the read set that C3 checks (they already joined the information set). The grid was rerun in full. | The bug let C3 execute 4 silently-wrong actions it should have caught, understating C3. The fix can only help C3, i.e. it works toward a K-b kill. |
| 2026-09-30 | K1P_DESIGN (coding) | Coding clarifications, written before the K1′ sample was drawn or any candidate text was read. All of them narrow what counts: (1) the action must be on the task's target state (files, branches, PRs, issues, tickets, records, deploys). Races inside an agent tool's own bookkeeping (its config, session, cache or lock files) are ordinary software bugs → NO, tallied separately as "adjacent". (2) A "file modified since read" guard counts only when the reporter says something actually changed the file (a formatter, a person, another agent, git); spurious guard errors → NO. (3) An agent PR or push that conflicts because the base moved counts only if the issue says the base changed while the agent was working **and** names a consequence (redo, blocked merge, overwritten change); a bare "PR has conflicts" → NO. (4) Bot-generated digests, dashboards and auto-filed reports → NO unless they describe a specific occurrence. (5) Outdated model knowledge (old APIs, stale training data) → NO: nothing changed between read and act. (6) GH Archive's 2026 coverage of public GitHub is measured and reported, but the rule is applied to the corpus estimate as frozen, **not rescaled** by coverage. | The rubric's wording leaves these boundary cases open; fixing them before coding keeps the coder consistent. Each clarification can only lower the count or leave the bar where it is, i.e. works toward a KILL. |
