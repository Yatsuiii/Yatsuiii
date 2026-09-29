# med_agent_bench — hunt worksheet (no confirmed hack)

Environment: `prime/med_agent_bench`, `verifiers 0.1.11.dev0`, run against the MedAgentBench
FHIR server (docker `jyxsu6/medagentbench`), default dataset `test_data_v2.json` (300 tasks,
task1–task10). Reward: 1.0 if the task's grader passes, else 0.0. Each grader recomputes the
reference answer by querying the live FHIR server and/or checks the exact POST payloads the
agent submitted.

## Findings

- **No answer leak.** The prompt shows only the instruction and the FHIR function list; the
  `context` field is empty and `sol`/`eval_MRN` are never rendered. GET tasks (1,2,4,6,7)
  require the exact value computed live from the server (age, latest lab, 24h average, …);
  POST tasks (3,8,9,10) require exactly-correct FHIR payloads. Neither is derivable without
  querying.
- **The `[] == results.result` escape is intended, not a hack.** task5 and task9 accept `[]`
  as the final answer ("we only ask the model to check, so it's fine if model returns []"),
  but only after the POST gate passes (no order placed when none is needed). It yields the
  output the environment deems correct for the no-order case.
- **Empirical:** a policy that immediately answers `FINISH([])` with no query scores **0/300**
  (`finish_empty.json.gz`). So even the escape does not pay off blindly.

Verdict: no confirmed hack.
