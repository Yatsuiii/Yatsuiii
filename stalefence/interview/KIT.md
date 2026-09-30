# K1 interview kit — do teams running agents in production hit stale-premise incidents?

This tests demand (PREREGISTRATION.md §3). The technique already works in papers; the open
question is whether teams have this pain often enough to pay. Run 10–15 conversations.
**Rule: KILL if fewer than 3 teams report a real incident in the last 90 days.**

Discipline that keeps this honest:
- Ask about the **past**, not about a product. Do not describe the idea until the last block.
- The interviewer wants this to pass, so the incident rubric below is fixed in advance and
  **ambiguous cases count as NO**. Fill the tracker within 24 h of each call.

## Who to talk to (target 10–15)

Teams whose agents/automations take **consequential write actions on production systems**,
beyond opening code PRs. Good sources: AI SRE / incident-response tools, deployment and
release automation, billing/payments ops, CRM & RevOps automation, support-action bots,
internal platform/ops copilots. Reach them via founder networks, relevant Slack/Discord
communities, and "who owns your agent that touches prod?" intros. One qualifying screen: *does
an agent of yours do something with a real-world effect (charge, refund, deploy, ticket, config
change), not just draft text or code?* If no, skip.

## Outreach (keep it about learning, not selling)

> Subject: 15 min — how your prod agents handle state that changes mid-task
>
> I'm researching failure modes of agents that take real actions in production (deploys,
> billing, CRM, incident response). Not selling anything — I'm trying to learn how often an
> agent acts on information that changed while it was still working, and what that costs.
> Could I ask you 6–7 questions for 15 minutes? Happy to share what I find across teams.

## Interview script (~15 min; let them talk, don't lead)

1. **Setup.** What does your agent actually do, end to end? Which systems does it read, and
   which does it write to? (Establish it takes consequential actions.)
2. **Duration.** From when it starts a task to when it executes the action, how long does it
   typically take? What's the longest?
3. **War story (the core question).** Tell me about the last time the agent did something that
   turned out to be wrong or had to be undone. Walk me through what happened. *(Silence.
   Do not suggest "stale data".)*
4. **Follow the cause.** For that case: had anything relevant changed between when the agent
   read the state and when it acted? Who or what changed it?
5. **Cost.** What did that cost — rework, a rollback, a customer hit, money, time? Roughly how
   often does something in this family happen?
6. **Current defense.** What do you do about it today? (Listen for: queues/serialization,
   locks/leases, human approval, re-reading state before acting, conditional/compare-and-swap
   writes, "we just accept it".) Have you built anything in-house here?
7. **Only now, the idea.** Briefly: a runtime that records what each agent decision depended
   on and re-checks just those premises right before the action, blocking or replanning if
   they changed. Does that map to a real problem for you? Would you try it? What would you
   need to see? (Then, willingness to pay — see below.)

## Incident rubric (code within 24 h; ambiguous = NO)

Counts as a stale-premise incident only if ALL hold:
- In the **last 90 days**;
- an **agent or automation** (not a human) **executed a consequential action** (real-world
  effect), not just proposed one;
- the action was based on **state that changed between when it was read and when it ran**;
- there was a **concrete cost** (rework, rollback, customer impact, or money).

Does NOT count: a hypothetical worry; a near-miss caught by an existing check with no cost; a
plain model mistake where nothing changed underneath; two agents editing the same file with no
consequence; anything the interviewee is unsure about.

## Willingness-to-pay probe (record verbatim, do not push)

- "If this existed and worked, is it a must-have, a nice-to-have, or not really?"
- "Who owns this problem and holds the budget — platform, the app team, security?"
- "Would you pilot it in the next quarter? What single result would make you say yes?"

## Tracker

Fill `interview/tracker.csv` (one row per conversation). Columns:
`date, company, role, what_the_agent_does, systems_written, task_duration, incident(yes/no),
incident_detail, cost, frequency, current_defense, built_inhouse(yes/no), wtp, would_pilot,
notes`.

## Reading the result

- **≥3 incidents → PASS.** Move to the day-2 mechanism test (§5). Also note how many already
  built something in-house (strong signal) and what they use now (defines the real baseline to
  beat).
- **<3 incidents → KILL.** Teams don't hit this often enough to pay, whatever the papers show.
- **<10 conversations by day 21 →** extend once by 14 days (§3); still <10 is inconclusive.
