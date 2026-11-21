I build evidence that an AI agent's work actually happened, in a form someone who wasn't there can check.

That means two things in practice. A record of what the agent's tool calls did, signed and chained so an edit shows. And a rerun of someone else's work from a clean checkout, with every command, deviation and failed run written down. Every result below has a cheap baseline next to it, and the ones where the baseline won are kept.

**Available for fixed-price agent reliability audits.** Email [battyrises@gmail.com](mailto:battyrises@gmail.com). Written scope and written report. Bengaluru, working async.

## Proofs

| What | Number | Baseline or catch | Link |
|---|---|---|---|
| A receipt survived someone else's machine | A fresh GitHub-hosted Windows runner cloned a pinned upstream repo I didn't write and produced a CSV **byte-identical** to my local run (SHA-256 `bb7b3900…7bfe0a0`) | One library example (a Pingouin ANOVA), not a paper replication. It is CI I wrote, not independent human review | [CI receipt](https://github.com/Yatsuiii/reproduction-receipts/blob/main/CI_RECEIPT.md) · [Actions run](https://github.com/Yatsuiii/reproduction-receipts/actions/runs/42859691077) |
| Agent receipts SDK: tamper detection | **13 / 14** attacks caught | Plain JSONL log 1 / 14, unsigned hash chain 5 / 14. The miss: the key holder re-signing, which only a published anchor catches | [agent-receipts (PR #5, in review)](https://github.com/Yatsuiii/reproduction-receipts/pull/5) |
| Same SDK on real frameworks | CrewAI 1.15.44 re-ran a failing tool **6 times** while its own record showed 1 call | On a tool that charges a card, that is six charges with one on record | [PR #5](https://github.com/Yatsuiii/reproduction-receipts/pull/5) |
| Stalefence: agents acting on state that changed under them | **187** silently wrong actions without fencing, **0** with it, replaying 40 recorded τ-bench agent conversations | Conditional writes stopped only 31.6%. Cost: about 31 unnecessary re-plans per wrong action caught at a realistic change rate, and the harm is rare (about 1 in 4,200 actions) | [Day 2 result](https://github.com/Yatsuiii/reproduction-receipts/blob/main/stalefence/research/DAY2_RESULT.md) |
| Custody: revoking a compromised source in agent memory | Purging every department that used the tool destroys **100%** of memory (600 / 600). Revoking exact descendants destroys **7%** (40 / 600) | That is the flattering case, a tool used by 5 of 5 departments. At 1 of 5 it is 20% against 1%. Synthetic fleet on Vertex AI Memory Bank | [custody/](https://github.com/Yatsuiii/reproduction-receipts/tree/main/custody) · [cost.py](https://github.com/Yatsuiii/reproduction-receipts/blob/main/custody/scripts/cost.py) |
| Offline model receipt, clinical task | Qwen3-4B, CPU only, network off: **58 / 60**, same answers on two different machines | Keyword rule 50 / 60. I wrote the 60 notes knowing where keywords break, so part of the gap is my bias | [Clinical receipt (PR #4, in review)](https://github.com/Yatsuiii/reproduction-receipts/pull/4) |
| medgate: an agent that drafts cited FHIR orders a clinician approves | **23 of 27** graded runs correct, nothing ordered where the protocol says not to | **A hand-coded rule script beats the agent on accuracy.** Synthetic data, one model, no clinician has used it | [medgate](https://github.com/Yatsuiii/medgate) · [rule script result](https://github.com/Yatsuiii/medgate/blob/main/docs/RULESET_RESULTS.md) |

## Fixes merged upstream

- [a2aproject/a2a-python#1366](https://github.com/a2aproject/a2a-python/pull/1366): when an agent crashed, the client was still told the task was submitted. A race in the database task store that the in-memory store used in the tests could not show.
- [datahub-project/datahub#18826](https://github.com/datahub-project/datahub/pull/18826) and [#18900](https://github.com/datahub-project/datahub/pull/18900): incident updates no longer wipe fields the caller left out, and `raiseIncident` can be made idempotent.
- [agentrust-io/cmcp](https://github.com/agentrust-io/cmcp/pulls?q=is%3Apr+is%3Amerged+author%3AYatsuiii): fixes to the MCP gateway's request gate, session cleanup and TEE measurement.

## Results that didn't beat the baseline

Kept on purpose. A result only means something next to the ones that failed.

- **Offline model, personal-identifier task:** Qwen2.5-1.5B got 42 / 60. A regex got 53. [Receipt (PR #4)](https://github.com/Yatsuiii/reproduction-receipts/pull/4)
- **Replication package triage:** its verdict was right 4 of 6 times on held-out journal packages, against 3 of 6 for assuming every package is blocked. Its stated reason was right 2 of 6. Parked. [triage/](https://github.com/Yatsuiii/reproduction-receipts/tree/main/triage)
- **MCP server shutdown scan:** 1,000 published stdio servers, 738 live, 0 confirmed leaks of child processes. The first run is kept as a failed run (a bug in my runner). [mcp-teardown/](https://github.com/Yatsuiii/reproduction-receipts/tree/main/mcp-teardown)

## How I work

Failure injections are written before the implementation. Scoring code is frozen and pinned by SHA-256, and a hook blocks edits to it. Each number has a committed results file. Every result gets a cheap baseline next to it. Failed runs stay in the README.

Python mostly, also Rust, Go and TypeScript. MCP, Google ADK, A2A, LangGraph, OpenAI Agents SDK, CrewAI, Docker.

## Other work

- [StillHere](https://github.com/Yatsuiii/stillhere): a harness that tests whether TRIBE v2 can stand in for volunteers in story-listening brain-imaging studies. The pre-registered intact vs shuffled test passed on 22 real listeners (p = 0.00516), and the [failed secondary test](https://github.com/Yatsuiii/stillhere/blob/main/results/d20_notthefall.json) is published next to it.
- [api-causality-engine](https://github.com/Yatsuiii/api-causality-engine), in Rust.
