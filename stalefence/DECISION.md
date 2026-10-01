# Decision (2026-10-01): killed as a business, kept as open-source work

**Decision.** Don't build a company on stale-plan fencing. The research (`stalefence/`) and the
tool (`stalefence-guard/`) stay public as evidence of the work, and there is no further product
investment. Decided by Raghav Sharma after K2, day 2 and K1′.

This is a judgment on top of the tests, not a test verdict. None of the frozen tests killed the
idea:
- K2 was inconclusive.
- Day 2 found no kill.
- K1′ was a weak pass.

What none of them could answer is whether anyone would **pay**. The evidence below says not
enough to build a company on.

## Why

1. **People build their own.** 10 of the 300 hand-coded issues were teams hand-rolling the same
   fence: plan hashes, guarded pushes, stale-patch checks (`results/k1p/tallies.json`). The core
   mechanism is a short script on top of git, or on top of ETags.
2. **The pain is small.**
   - The three incidents cost time and one embarrassing message, and no money
     (`K1P_RESULT.md`).
   - At the measured change rate, which is a floor, the day-2 replay saw about 1 silently wrong
     action per 4,200, and about 31 unnecessary re-plans for each one caught
     (`DAY2_RESULT.md`).
3. **The platforms own the chokepoint.**
   - Claude Code already rejects edits to files modified since they were read.
   - GitHub's merge API takes a head SHA (`sha`, or `gh pr merge --match-head-commit`).
   - Agent harnesses and code hosts can ship this as a built-in feature, for free.
4. **There is no evidence of willingness to pay.** There was no buyer contact, and the K1′ pass
   was weak by design.

One fair counterpoint: "they can build their own" is not fatal on its own. Anyone can build a
merge queue, yet people still buy one when the pain scales. What kills this idea is how small
the pain is today.

## What stays

| Item | Status |
| --- | --- |
| `stalefence/` | Research, results and data. Unchanged. |
| `stalefence-guard/` | A working CLI with 37 tests, kept as-is. Publishing it is optional, as portfolio work. |
| `stalefence/outreach/` | Optional. The comments can go out as helpful replies, not as a sales test. Its decision rule is retired. |

## What would reopen it

This is a watch list, not a plan.

- Teams that routinely run 10+ concurrent agents in one repo report coordination collisions as a
  recurring cost. That would be merge-queue pain, at scale.
- A team with money at stake (payments, refunds, deploys, CRM) describes a silently wrong agent
  action caused by stale state, and says what it cost.
- Agent platforms still haven't shipped native fencing a year from now, and people keep
  hand-rolling it.

## Screen for the next idea

Run these before building anything:

1. **Does a failure cost real money, to someone with a budget?**
2. **Is it hard to build yourself?** It should need data, network effects, ongoing maintenance or
   compliance work, and not be something a platform can ship as a free feature.
3. **Can buyers be reached in writing, with no calls?**
4. **Can a kill test run from public data in under a week?**

This project failed questions 1 and 2. Questions 3 and 4 are how Raghav works.
