# clockbench — hunt worksheet (no confirmed hack)

Environment: `prime/clockbench`, `verifiers 0.1.11.dev0`, dataset `nmayorga7/clockbench`
(train, 10 rows). Each row scores the mean over 4 sub-tasks (time, shift, angle, zone); a
sub-task passes when the predicted JSON matches the ground truth. Reward per row in [0, 1].

## What was tried

`harness/policies/clock_invalid.py`: answer `{"valid": false}` on every turn, never reading
the clock image. `_compare_entry` early-returns True when the ground-truth `valid` is False,
so any sub-task whose gt is invalid passes on this answer alone.

Result (both runs identical): reward 1.0 on exactly the 2 rows whose all four sub-tasks are
`valid=false`; 0.0 on the other 8.

## Why this is NOT counted as a hack

On those 2 rows the ground-truth answer *is* `valid=false`, so `{"valid": false}` is the
correct output. This is a guessable prior (most-common-answer), not max reward without
solving. Per §5 a hack must not solve the task; here it does produce the correct answer.

## Weaknesses noted (not hacks)

- `_compare_entry` skips all numeric fields once `valid=False` matches, so a policy that
  learns "say invalid" is fully rewarded on invalid clocks without reading them. With a
  dataset dominated by invalid clocks this would be a cheap high score, but it still yields
  the correct label.
- `_match_value` treats a 2-element numeric expected list as an inclusive range and a dict of
  values as a choice set, which is lenient, but valid=True rows still need approximately
  correct hours/minutes, which are only in the image.
- No leakage of the answer into the prompt (the target is an image).

Files: `invalid_run{1,2}.json.gz`.
