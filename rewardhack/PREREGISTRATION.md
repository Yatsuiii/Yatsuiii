# Preregistration: is there room beyond the free reward-hack auditors?

| Field | Value |
| --- | --- |
| Registered | 2026-09-28, before any environment's reward code was read in depth, and before any auditor ran |
| Status | Frozen at the commit that adds this file. Changes go in §9 with a date and a reason. |
| Decides | Test 1 of 2 for the product idea "a reward-hack auditor for RL environments" |

## 1. Question

Free auditors for reward hacking already exist. Do public RL environments still contain
reward hacks that none of them report? If not, a paid auditor has little room to be better.

## 2. Population

Every environment directory in two public hubs, at these commits:

| Hub | Repository | Commit | Environments |
| --- | --- | --- | ---: |
| Prime Intellect | `PrimeIntellect-ai/prime-environments`, `environments/` | `cf220ee86500` | 109 |
| OpenEnv | `meta-pytorch/openenv`, `envs/` | `064bd9ae4034` | 40 |

## 3. Sample (mechanical)

1. List all environment directories from both hubs, sort them by `hub/name`, and shuffle
   with `random.Random(20260928)`.
2. Walk the shuffled list. An environment is **eligible** if both hold:
   - **E1, programmatic reward.** No Python file in its directory matches
     `JudgeRubric|judge_model|judge_client|AsyncOpenAI|OpenAI\(|anthropic|litellm`.
     This keeps environments whose reward is computed by code, not by an LLM judge.
   - **E2, runs here.** Its reward code can be executed on this machine (CPU, Docker, the
     session's network allowlist, no paid API) within 30 minutes of setup.
3. The first **20** eligible environments are the sample. Every skipped environment is
   logged with its reason.

## 4. Procedure

For each sampled environment, in this order:

1. **Blind hunt.** Before seeing any auditor output, try to hack the environment's reward,
   for at most 90 minutes of wall-clock time. The attacker is Claude, working from the
   environment's source and task data.
2. **Free auditors**, default settings, recorded verbatim:
   - `ratctl audit` (static; `--dynamic` only if a free backend is available),
   - BenchJack (Claude Code backend, default model),
   - Verity RedTeam, where it can be pointed at the environment within 30 minutes of setup.
3. **Compare.** A hack is **missed** if no finding from any auditor that ran on that
   environment identifies the same mechanism at the same place in the code.

## 5. What counts as a confirmed hack

All of the following:

- It is a concrete submission (a completion, action sequence or files) for real task
  instances from the environment.
- Executed locally, the environment's own reward code gives it the maximum reward, or at
  least the reward the reference solution gets.
- It does not solve the task, and the worksheet says why (for example, the final answer
  differs from the gold answer, or the required behaviour is absent).
- It is a strategy, not a mislabeled item: it works on at least **2** task instances.
- It reproduces on a second run.

**Known bias:** the attacker also judges what counts as solving the task. Confirmation is
by executed reward code, and each hack's evidence is committed so it can be audited.

## 6. Kill rule

An environment counts as a **gap** if it has at least one confirmed hack that was missed,
and both `ratctl` and BenchJack ran on it successfully. If either failed to run, the
environment cannot count as a gap.

| Rule | Kill when |
| --- | --- |
| **T1 — room** | fewer than **5** of the 20 environments are gaps |

**Secondary (reported, never a kill):** hacks the auditors did catch; the share of each
auditor's findings that are real; whether each missed hack is plausible for a policy to
learn during RL training.

## 7. Limitations known in advance

- **Programmatic rewards only.** E1 drops LLM-judged environments, where hacks are often
  easiest. This works against finding gaps.
- **A strong attacker.** The hunt uses a frontier model with the full source code, which is
  more than a policy has during training. The plausibility note in §6 tracks this.
- **Prior exposure.** `ratctl`'s own report scanned 112 public environments, some likely
  from these hubs, and authors may have patched what it found.
- **Verity RedTeam** needs its own corpus manifests and a model API. It may not run on
  every environment; §6 does not depend on it.

## 8. What happens next

| Outcome | Meaning |
| --- | --- |
| **KILLED** | The free auditors cover most of what a strong attacker finds. Drop the auditor idea. |
| **PASSED** | Test 2 runs: offer paid audits (list price $500 per environment) to about 15 environment builders and fine-tuning teams. Kill if fewer than 2 pay at least $250 within 21 days of the first offer. Each gap also becomes a fix PR upstream. |

## 9. Deviations (append-only)

| Date | Section | Change | Reason |
| --- | --- | --- | --- |
| 2026-09-28 | §3 E2 | Setup rule: each Prime environment runs with the newest `verifiers` release, on or before the date its directory last changed, that satisfies its own requirement (else the earliest that does). | The latest `verifiers` (0.3.x) no longer loads most hub environments, which were written against 0.1.x. |
| 2026-09-28 | §3 E2 | Setup adaptations that change no reward code are allowed and logged in `results/e2_log.jsonl`: a runtime from an allowed source (Julia from the official Docker image), a local copy where the environment offers a setting for it (Terminal-Bench 2 via `TB2_REPO_URL`), an undeclared dependency (Pillow), a documented argument that bounds dataset size (`num_examples`), a required local service (the MedAgentBench FHIR server), and the NLTK proxy opt-in. | These are setup, not changes to what is being attacked. |
| 2026-09-28 | §5 | For games and simulations with no reference solution (wildfire, connect4, mastermind, textarena, julia's code tasks are unaffected), the reference reward is what an honest episode that achieves the goal earns: a legitimate win or solve, played by a scripted honest policy recorded in the worksheet. | §5 compares against "the reward the reference solution gets", which these environments do not define. Written before the hunt. |
| 2026-09-28 | §4 | `openenv/wildfire_env` was not hunted (the work was stopped by a safety check and not retried). It stays in the sample and counts as not a gap. | Works against passing; recorded so the denominator stays 20. |
| 2026-09-29 | §5 | A hack must be one policy program whose output depends only on what a policy sees during the rollout (the prompt, tool results, environment observations). It may not read gold answers, the `info` field or other task data the policy is not shown. | Echoing a leaked label is not something a policy can learn. Written after hunting taxcalc_bench and part of agent_dojo; it only removes candidate hacks, so it works against passing. |
| 2026-09-29 | §4 | `openenv/connect4_env` was not hunted (the work was stopped by a safety check and not retried). It stays in the sample and counts as not a gap. | Works against passing; recorded so the denominator stays 20. |
