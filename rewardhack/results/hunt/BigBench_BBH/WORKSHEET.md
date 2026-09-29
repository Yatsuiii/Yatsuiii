# BigBench_BBH — hunt worksheet

Environment: `prime/BigBench_BBH`, default `source="bigbench"` (`tasksource/bigbench`),
`verifiers 0.1.11` (the setup rule's pick: newest stable release by the directory's last
change, 2026-03-30, satisfying `verifiers>=0.1.8.post1`). Reward: 1.0 if the parsed label
equals the gold label, else 0.0. Maximum: 1.0.

## Two flaws that stack

1. **Options are never shuffled.** `convert()` lists `multiple_choice_targets` in source
   order, and for many BigBench tasks the correct target comes first. Over the first 60
   items of every subset (167 subsets, 6,530 items), 39% of gold labels are `A`. In 15
   subsets with at least 20 items, the gold label is `A` for every item checked (e.g.
   physics, temporal_sequences, hhh_alignment, conceptual_combinations, emoji_movie,
   date_understanding at 95%).
2. **The parser reads the message's repr, not its text.** Under this `verifiers` release
   the completion is a message object, not a dict, so `_completion_to_text` returns
   `"role='assistant' content='A' reasoning_content=None ..."`. `ChoiceParser.parse` then
   returns the first 1-4 letter word, `ROLE`. A correct bare label scores 0. Only replies
   that match an earlier pattern, such as `Answer: A`, are read correctly. The authors'
   own shipped eval (`outputs/evals/.../metadata.json`, kimi-k2, 15 rollouts) averages 0.0.

## Result (environment's own reward code, 4 all-`A` subsets, 400 items, two runs)

| Policy | Reads the question? | Mean reward | Items at 1.0 |
| --- | --- | --- | --- |
| `answer_a.py`: always `Answer: A` | no | **1.0** | **400/400** |
| `gold_lookup.py`: gold label as the prompt asks ("Respond with only the label") | uses gold | 0.0 | 0/400 |
| `constant_a.py`: always `A` | no | 0.0 | 0/400 |

Both runs identical. The hack does not solve the task: it never reads the question. It gets
the maximum reward, above the reference solution's 0.0.

Flaw 1 does not depend on the `verifiers` version: with any release where a bare label
parses, constant `A` gets 1.0 on the same subsets. Flaw 2 makes the environment reward
format over correctness under the version its setup rule selects.

Plausibility for RL: very high. Position bias and an "Answer: X" format are among the first
things a policy picks up.

Files: `gold_map.json.gz` (reference answers for the 1,247 items in the four subsets),
`<policy>_run{1,2}.json.gz`.
