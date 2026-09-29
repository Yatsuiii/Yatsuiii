# Auditor comparison (§4 step 3)

A hack is **missed** if no finding from any auditor that ran identifies the same mechanism at
the same place in the code. Only ratctl ran successfully (BenchJack and Verity: see §9).
ratctl ran in static mode, default settings, on all 20 environments (`ratctl/<env>.json`).

## The six confirmed hacks vs ratctl

| Environment | Hack mechanism and location | ratctl findings (line: code) | Verdict |
| --- | --- | --- | --- |
| prime/mbpp | Always-equal return object passes `assert f(x)==y`; the `exec` in `pass_rate`, `mbpp.py:65` | grader_manipulation @65: `exec(f"{test_setup}\n{parsed_code}\n{test}", {})`, "could execute modified grading logic or inject code into the grading pipeline" | **Caught**: same line, same mechanism (code injected into the grading exec) |
| openenv/tbench2_env | Agent rewrites the staged `tests/test.sh`; `_stage_tests_for_verify` copies the agent-writable dir; the eval `shell_exec` runs it | grader_manipulation @641/656: the eval `shell_exec`, "could execute modified grading logic"; reward_skipping @578: the `return True` right after the copy | **Caught** (conservative reading): the finding names execution of modifiable grading logic at the eval exec. It does not say the tests dir is agent-writable. |
| openenv/julia_env | Printed fake "Some tests did not pass: N passed, 0 failed" wins in `_parse_test_results` (stdout parsed before stderr) | reward_skipping @468: `return 1.5` bonus; executor @408/418: `return True`; atexit handlers | **Missed**: nothing about test output parsed from agent-controlled stdout |
| prime/agent_dojo | Substring graders (`"3" in output`, `"1:30" in output`) and a pre-satisfied banking check in the installed `agentdojo` package | reward_skipping @`agent_dojo.py:161`: `return 1.0 if utility else 0.0` | **Missed**: the vulnerable graders live in a dependency outside the scanned directory |
| prime/lisanbench | The start word is never checked; one memorized chain scores on every prompt | llm_judge_bias @155: a line of the prompt text (no LLM judge exists) | **Missed**, and the one finding is a false positive |
| prime/BigBench_BBH | Unshuffled options (gold always "A" in 15 subsets) and repr parsing; "Answer: A" gets 1.0 on 400/400 | none (score 0) | **Missed** |

ratctl: 2 of 6 hacks caught, 4 missed.

## ratctl's score against the hunt (secondary, §6)

| Group | n | ratctl score, median | mean |
| --- | ---: | ---: | ---: |
| Confirmed hack | 6 | 5 | 11.7 |
| No confirmed hack | 12 | 10.5 | 21.1 |
| Not hunted | 2 | — | — |

Only 1 of ratctl's 6 highest-scoring environments had a confirmed hack. Its two highest
(med_agent_bench 75, dipg_safety_env 57) had none; BigBench_BBH scored 0. Total findings
across 20 environments: 103. Both catches came from its generic `exec()` heuristic.
