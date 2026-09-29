# piqa — hunt worksheet

Environment: `prime/piqa`, `verifiers 0.1.8`, default `split="validation"`. Reward 1.0 if the
parsed letter equals the gold letter. Maximum 1.0.

## Default split: no hack

`PIQAParser.parse` returns one letter, so a reply cannot match both options. Constant `A`
scores 0.493 on 300 validation items (chance), both runs. No leakage of the label into the
prompt found.

## Non-default split: recorded, not counted (§9)

`_load_split` sets every label to `"-1"` for `split="test"` (the test labels are not public)
and then maps unknown labels to `"A"` (`{"0": "A", "1": "B"}.get(label, "A")`). So every test
item's gold answer is `A`, and constant `A` scores **1.0 on 300/300 test items**, both runs.
`split="test"` is a documented option (`valid_splits`), so a user evaluating or training on
it gets a reward that pays "always A".

Files: `piqa_{test,validation}_{1,2}.json.gz` (policy `harness/policies/constant_a.py`).
