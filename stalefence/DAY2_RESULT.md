# Day-2 result: NO KILL — the mechanism is real, but the harm it prevents is rare

Frozen design: `DAY2_DESIGN.md` (plus two logged replay rules and one bug fix, §7). 40 real
recorded τ-bench retail agent conversations (Claude 3.5 Sonnet and GPT-4o), 69 consequential
writes, replayed concurrently against the store database while the outside world changes;
validity decided by τ-bench's own tool code. 100 replications × N ∈ {2,4,8} × λ ∈
{low, medium, high} × 5 conditions, on paired event streams.

## The three frozen kill rules

| Rule | Measured (pooled, 95% CI) | Kill if | Result |
| --- | --- | --- | --- |
| **K-a** conditional writes suffice | C2 prevents **31.6%** of C0's 187 silently-wrong actions (23.5–38.5%) | ≥ 90% | no kill |
| **K-b** 100-line whole-read-set check suffices | invalid C3 = 0, C4 = 0; false aborts C3 **256.7** vs C4 **139.3** per 1,000 → ratio **1.84** (1.81–1.87) | C3 within 1 invalid **and** ratio ≤ 1.3 | no kill |
| **K-c** checks too slow | C4 median check **163 ms** vs median task **295 s** (0.055%) | > 20% | no kill |

**Verdict: NO KILL.** Dependency-scoped fencing is not replaceable by what people already
have: conditional writes miss two-thirds of the harm, and the naive re-check has 1.84× the
false aborts and livelocks under churn (gave up on 78.9 vs 15.9 per 1,000 actions at high λ).
Serial queues (C1) are 2.58× slower and prevent nothing extra: they can't see the outside world.

## What it prevents — and what that costs (per 1,000 agent actions)

| λ (per-entity change rate) | Silently wrong (C0) | Rejected by the API (C0) | C4 unnecessary re-plans | Re-plans per silently-wrong prevented |
| --- | ---: | ---: | ---: | ---: |
| **low** (= K2's measured rate) | **0.24** | 17.9 | 7.7 | **31** |
| medium (10×) | 1.39 | 32.6 | 56.7 | 41 |
| high (100×) | 9.19 | 157.0 | 407.2 | 44 |

- **At the realistic rate, a silently-wrong action happens about once per 4,200 actions.**
  Almost all stale actions (98%) are *rejected* by the API's own precondition checks
  (order no longer pending, item unavailable) — the world mostly protects itself already.
- **The harm lives in long, human-in-the-loop windows.** With 10 s customer replies it vanished
  (0 per 1,000 at medium λ); with 60 s replies it more than doubled (3.04 vs 1.39).
- **Prevention is expensive in friction:** ~31 unnecessary re-plans (each ≈ 33 s plus a
  customer re-confirmation) per silently-wrong action caught at the realistic rate.
- **Where the false aborts come from:** removing pure metadata churn cuts C4's false aborts only
  13% (56.7 → 49.2). Most come from real changes to the *right* object but the *wrong* field or
  variant (another variant's price). Finer-grained (field/variant-level) dependencies are the
  obvious product improvement.

## What this means for the idea

The mechanism test the idea had to survive, it survives: this is not a 100-line feature and
not solved by conditional writes. But in a typical customer-service workload the thing it
prevents is **rare**, and catching it costs dozens of extra confirmations. The product only
pays for itself where one silently-wrong action is expensive **and** decisions sit open for a
long time **and** the world churns: high-value refunds/charges with human approval loops,
dynamic pricing, fast-moving ops, multi-agent pipelines with slow steps. That narrows the
buyer rather than killing the idea — and it is what K1′ (demand) has to confirm.

## Limitations

- Replay, not live agents: the recorded choice of action is fixed, so only *effect-level*
  staleness is measured (a live agent's different choice isn't); diverged actions (change
  before the read) are excluded, most heavily for C1.
- One domain (retail customer service) and a designed outside world (entity menus,
  lognormal timings), anchored to K2's measured rate; sensitivity runs cover timing and churn.
- Entity-level versions, as in real ETag APIs; field-level fencing would do better.
- C5 (plan repair) not run.

Files: `day2/` (simulator, runner, analysis), `tests/test_day2.py` (8 tests),
`results/day2/` (all action and task records, `analysis.json`).
