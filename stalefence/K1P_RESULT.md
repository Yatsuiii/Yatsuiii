# K1′ result: PASS (weak) — the problem shows up in public, mostly where several agents share one repo

Frozen design: `K1P_DESIGN.md`. Coding clarifications were logged in `PREREGISTRATION.md` §7
before the sample was drawn or any issue text was read. No outreach was used: this is public
incident mining only.

## The number

| Step | Count |
| --- | ---: |
| Opened issues captured by GH Archive, 2026-06-30 … 09-27 (2,160 of 2,160 hours) | 580,798 |
| Candidates matching both frozen regexes | 20,675 (10,334 repos) |
| Coded: random 300 (seed 20260930), strict rubric, ambiguous = NO | 300 |
| **Stale-premise incidents in the sample** | **3** (2 code, 1 systems) |
| **Estimated incidents in the 90-day corpus** | **207** (95% CI 70–599) |
| Kill bar | < 10 |

**Verdict: PASS (weak).** A KILL needed 0 incidents in 300. The verdict holds if any one of
the three is right: 2/300 → 138 (38–496), 1/300 → 69 (12–385). Counting the one "probable"
case below gives 4/300 → 276.

## The three incidents

| Issue | Type | What happened | Reporter's workaround / proposed fix |
| --- | --- | --- | --- |
| [plow-pbc/hermes-plugin-plow#139](https://github.com/plow-pbc/hermes-plugin-plow/issues/139) | systems | A personal-assistant agent booked a real Calendly meeting from its owner's DM. In the group thread, its session still held three-day-old evidence that booking had been blocked. On the counterparty's next reply it publicly retracted the real booking, with zero tool calls, and told them to book it themselves. | Before sending any reversal of a claim someone outside has seen, check it against the system that owns the fact. Tag mirrored messages with where they came from. |
| [muhammadbayoumi/ScrapeX#664](https://github.com/muhammadbayoumi/ScrapeX/issues/664) | code | A Claude branch (`claude/drive-without-a-server`) added a new use of a constant, and meanwhile `main` moved that constant to another module. Git merges cleanly, but the result raises `NameError` on every `init-db`. This was the repo's second instance of this class. | A merge-tree check (`tools/merge_tree_check.py`), run last before merging. |
| [thienphung00/Juli-AI#2036](https://github.com/thienphung00/Juli-AI/issues/2036) | code | Two concurrent agent sessions both reserved Alembic migration 061 from the same `main`. The plan recorded "no other in-flight branch adds a migration", which was true when written and stale by merge time. Result: forked migration history, a conflicting PR that silently skipped CI, a false webhook diagnosis and a wasted commit. | A CI gate for forked heads. Or check sibling worktrees at reservation time, or keep a monotonic reservation ledger. |

Every coded candidate, with URL, verbatim excerpt and reason, is in
[`results/k1p/CODED.md`](results/k1p/CODED.md).

## What else the sample shows (descriptive; not part of the rule)

- **1 probable**, not counted: [HPAC-Safety/safety-report#319](https://github.com/HPAC-Safety/safety-report/issues/319).
  It is the same numbering collision, three times in one afternoon, but the text never says the
  "sessions" are AI agents.
- **1 near-miss**: [objectstack-ai/objectui#9067](https://github.com/objectstack-ai/objectui/issues/9067).
  An agent's census went stale when a PR merged 48 minutes later. The implementing agent
  re-derived it, so nothing ran on the stale premise.
- **11 adjacent**: concurrency bugs inside agent tools' *own* state. Examples: sibling sessions
  rewriting a shared profile/credential store until a live session's subagent launches fail
  ([vybestack/llxprt-code#3571](https://github.com/vybestack/llxprt-code/issues/3571)); a
  credential vault that loses concurrent writes; SQLite state databases locking up or corrupting
  under several agent clients; workers colliding on shared `/tmp` sentinels. These are real and
  common, but they are the tool vendor's bugs, not this product's wedge.
- **10 builders hand-rolling the fence** (≈3% of candidates). Examples: "stale-plan check
  immediately before mutation"; a plan hash with `--expect-plan` (sshx); "block a patch if any
  record changed after its snapshot" (PatchCTL); force-with-lease CAS plus lease-bound push
  tokens for agent workers; dismissing approvals on head drift; re-confirming CI on the head
  before auto-merge; claims with heartbeats (`results/k1p/tallies.json`). People feel the need
  **and** are building it themselves.
- The other 274 NOs are mostly bot digests and auto-filed reports (~36), feature specs that use
  the words, ordinary bugs and stale docs.

## Where it comes from

All three incidents, the probable case and the near-miss come from one of two setups. Either a
repo runs several agent sessions at once (numbered worktrees, "seats", fleets, swarms), or a
long-lived assistant acts across several chats. The fence-builders are agent tools and
orchestrators. None is a production business system such as billing or CRM. Public GitHub
doesn't see those, which is the known blind spot of this test.

## What this means

- **Not a kill.** The stale-premise failure is reported publicly about 200 times per 90 days in
  the captured corpus. The archive holds only part of GitHub (about 1% to a fifth of issues,
  depending on the day), so the true public count is higher.
- **The demand has a specific shape**:
  1. Coordination between concurrent coding-agent sessions: collisions on shared sequence
     numbers, and merges that break semantically after the base moved.
  2. Assistants acting on a belief that went stale when the world changed elsewhere.
  The damage reported so far is wasted time and one false message to a third party, not money.
- **The fence is already being hand-rolled.** That is a demand signal and a warning: at small
  scale it is a feature people write themselves, as day 2's K-b margin also suggested.
- A PASS here is weak by design. It shows the problem surfaces, not that anyone pays.

## Limitations

- One coder (Claude) on a strict rubric. All 300 decisions are published so anyone can re-code.
- 38 sampled issues had a regex hit beyond the 6,000 characters the miner stored. Their full text
  was recovered from GH Archive (`k1p/fulltext.py`) and re-read; one code changed, to adjacent.
- Capture: GH Archive's 2026 capture swings about 100× by day, and September dominates (266 of
  300 sampled). The rule was applied to the corpus as frozen and not rescaled.
- The regex filter misses incidents described in other words, so the estimate is for the
  filtered corpus.
- Public repos over-represent developer tooling.

Files: `k1p/` (miner, sampler, ledger, full-text recovery, scoring, publication),
`results/k1p/` (`sample.json`, `coded.json`, `CODED.md`, `score.json`, `tallies.json`,
`corpus_index.jsonl.gz` = every candidate without bodies, `corpus_days.jsonl`, coverage checks).
