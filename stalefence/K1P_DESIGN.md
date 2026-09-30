# K1′ — a no-outreach demand test (replaces K1 interviews)

Registered 2026-09-30, before any issue text was searched or read. The founder cannot run
calls, so K1 is replaced by mining public incident reports. Changes after this commit go in
PREREGISTRATION.md §7.

## What this can and cannot show

Public GitHub over-represents developers and open-source agent tooling; production business
agents (billing, CRM, deploys) mostly fail in private. And a bug report is not a purchase.
So a **K1′ KILL is informative** (if even the most active public agent builders don't report
this, demand is thin), while a **K1′ PASS is weak**: it shows the problem surfaces, not that
anyone pays. Before building a company, a PASS still needs real customer contact (async text
is enough).

## Corpus

GH Archive `IssuesEvent` with `action = opened`, 2026-06-30 00:00 to 2026-09-27 23:59 UTC
(90 days), all public repositories, title + body.

## Candidate filter (case-insensitive regex, both must match title+body)

- **Agent context:** `\b(ai agent|agents?|agentic|llm|copilot|claude|codex|cursor|devin|mcp|tool[ -]?call|autonomous)\b`
- **Staleness:** `stale|outdated|out[ -]of[ -]date|race condition|concurrent(ly)?|conflicting|overwr(o|i)te|overwritten|lost update|clobber|changed (since|while|before|after|underneath)|toctou|out of sync|already (merged|closed|deleted|cancell?ed|shipped|deployed|refunded|paid)|state (has )?changed|while (it|the agent) was (working|running|thinking)`

## Coding (by Claude; strict rubric, ambiguous = NO)

A candidate counts as a **stale-premise incident** only if the issue describes a real
occurrence in which an AI agent or LLM-driven automation **executed (or tried to execute)** an
action based on state that **changed between when it was read and when the action ran**, with
a concrete consequence (a wrong change landed, work overwritten, a duplicate or incorrect
action, a rollback, or a failed/blocked action after work was done).

Not counted: feature requests or proposals with no described occurrence; hypotheticals; plain
model mistakes where nothing changed underneath; ordinary git merge conflicts with no agent
action; generic flakiness; the agent's *own* stale cache with no outside change.

Each counted incident is tagged **code** (files, branches, PRs, repos) or **systems**
(tickets, billing, CRM, deploys, infra, databases, calendars, other non-code state).

## Sampling and estimate

If there are ≤ 300 candidates, code all. Otherwise code a random 300 (seed 20260930) and
estimate the total as `candidates × (incidents / 300)`, with a Wilson 95 % interval.
Every coded candidate is published with its URL, a verbatim excerpt and a one-line reason.

## Rule K1′

- **KILL** if the estimated number of stale-premise incidents in the 90 days is **< 10**
  (under one a week across all public GitHub).
- **PASS (weak)** otherwise.
- **Reported:** the code/systems split, the repos they come from, and what (if anything)
  the reporters used to work around it.
