# Day-2 mechanism test — frozen design (PREREGISTRATION.md §5, operationalized)

Registered 2026-09-30, before any day-2 simulation was run. The §5 kill rules are unchanged;
this file fixes every parameter they depend on. Changes after this commit go in §7.

## Why replay instead of live agents

§5 says "N concurrent LLM agents". This environment has no model API key and blocks nested
`claude`, so live agents cannot run. Every §5 kill condition depends on the **conflict
structure** (which objects a write depends on, which the agent read, how often they change),
not on live reasoning, so real recorded agent behaviour is enough:

- **Workload:** τ-bench retail (`sierra-research/tau-bench` @ `59a200c`): a stateful store DB
  (500 users, 1,000 orders, 50 products / 591 variants) and **recorded trajectories of real
  agents** (Claude 3.5 Sonnet: 920; GPT-4o: 460). Reads and writes are the agents' own, and
  write validity is decided by τ-bench's own tool code.
- **Not covered:** plan repair (C5, CoAgent-style) needs a live model and is not run; the
  choice of *which* action to take is fixed by the recording, so only effect-level staleness
  is measured (see "Oracle").

## Tasks (the "40 tasks")

From both trajectory files: keep trajectories with `reward = 1` that contain at least one
**successful** write (tool result not starting with `Error`) whose declared scope spans ≥2
entity types (order + product and/or user). Pick 40 distinct `task_id`s with seed 20260930,
one random qualifying trajectory each. Writes that errored in the original recording are agent
mistakes, not staleness, and are skipped.

## Entities, reads, writes

- Entities: each `order:<id>`, `product:<id>` (all its variants), `user:<id>`; each has a
  version counter bumped on every change.
- Reads: `get_order_details` → order, `get_product_details` → product, `get_user_details` →
  user. (`find_user_id_*`, `list_all_product_types`, `think`, `calculate` read no entity.)
  A successful write's result is also a read of what it wrote.
- Consequential writes and their **declared scope** (C4) and **written object** (C2):

| Tool | Declared scope (C4) | Written object (C2) |
| --- | --- | --- |
| cancel_pending_order | order, user | order |
| exchange_delivered_order_items | order, products of the items, user | order |
| modify_pending_order_items | order, products of the items, user | order |
| return_delivered_order_items | order, user | order |
| modify_pending_order_payment | order, user | order |
| modify_pending_order_address | order | order |
| modify_user_address | user | user |

## Oracle (what "invalid" means), from τ-bench's own tools

At the moment a write executes, run τ-bench's tool twice on copies of the involved entities:
**R** = the entities the agent read, at the values it last read them (unread entities at
current values); **C** = everything at current values. Compare the changes the tool makes.

- **rejected:** the tool errors on C (a precondition changed, e.g. order no longer pending).
  Real APIs often enforce this themselves, so it is reported separately from invalid.
- **invalid (silently wrong):** the tool succeeds on C but its changes differ from R (e.g. a
  new price, a different refund amount, a different gift-card deduction).
- **valid:** identical changes.

An **abort** is *true* if executing at that moment would have been rejected or invalid, and
*false* if it would have been valid.

## Outside world (λ)

Every entity touched by a task changes as a Poisson process with per-entity hazard `h`.
Anchor: K2 measured an 11.6 % chance that an in-play entity (the task issue) changes within
an hour, i.e. `h0 = −ln(1 − 0.116) = 0.1233` per hour. **λ low = h0, medium = 10·h0,
high = 100·h0.** On each event, one change is drawn uniformly from the entity's menu:

- **order** (pending): ships → `processed`; delivery address changes; metadata touch.
  (delivered): customer starts a web return → `return requested`; metadata touch.
  (other statuses): metadata touch.
- **product:** a random variant's price moves ±5–15 %; a random variant's availability flips;
  metadata touch.
- **user:** a card is added; a non-gift-card method is removed (if ≥2 methods); a gift card
  balance drops by $5–50 (floor 0); address changes; metadata touch.

"Metadata touch" changes nothing any tool reads (it models `updated_at`-style churn) but
still bumps the version, as real per-object ETags do.

## Time

Replayed message by message: assistant turn ~ LogNormal(median 4 s, σ 0.5); user (customer)
turn ~ LogNormal(median 25 s, σ 0.6); tool result 0.2 s. A version check is one API round
trip ~ LogNormal(median 120 ms, σ 0.4), checks within one action run in parallel.

## Conditions

- **C0 naive:** execute.
- **C1 serial queue:** the N agents run one after another, then execute. (Queues order
  agents; they cannot see the outside world.)
- **C2 conditional write:** abort if the written object's version differs from the agent's
  last-seen version.
- **C3 whole read-set:** abort if any entity the agent read has changed since it read it.
- **C4 dependency-scoped (PlanFence-style):** abort if any declared-scope entity changed
  since the agent last saw it (unread scope entities: since the task started).

On abort (C2–C4) the agent re-plans: re-reads its read set, re-confirms with the customer
(1 assistant turn + reads + 1 user turn + 1 assistant turn), then — if the tool would now be
rejected — stops (*avoided*, correct); otherwise tries again. At most 3 attempts; then
*gave up*.

## Grid and runs

N ∈ {2, 4, 8} concurrent agents × λ ∈ {low, medium, high} × C0–C4; **100 replications** per
(N, λ). Each replication splits the 40 tasks into groups of N, uses one random seed for the
outside world, and runs every condition on the **same** event stream (paired comparison).
Seeds derive from 20260930.

## Kill rules (§5, pooled over the 9 N×λ cells; per-cell also reported)

- **K-a:** KILL if C2 prevents ≥ 90 % of the invalid actions C0 makes
  (`1 − invalid(C2) / invalid(C0) ≥ 0.90`). Added, conservative: also KILL if C0 makes **no**
  invalid actions at all — then there is nothing to prevent.
- **K-b:** KILL if `invalid(C3) ≤ invalid(C4) + 1` **and** C3's false-abort rate (per
  consequential action) ≤ 1.3 × C4's. The dependency graph is then unnecessary.
- **K-c:** KILL if C4's median added check latency per consequential action > 20 % of the
  median task wall time.

**Reported, never a kill:** invalid and rejected actions per 1,000 at each λ, absolute
false-abort rates and the time they cost, give-ups, C1's wall-time penalty, approximate extra
tokens from re-plans, and sensitivity (customer reply median 10 s and 60 s; outside changes
restricted to fields some tool reads).
