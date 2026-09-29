# synthetic_clocks — hunt worksheet (no confirmed hack)

Environment: `prime/synthetic_clocks`, `verifiers 0.1.4`, dataset
`moondream/1M-synthetic-analog-clocks`. Reward = exact(1.0) + close(0.5) + hour_minute(0.3) +
format(0.1); max 1.9 for the exact time.

## Findings

- **No answer leak the way §9 allows.** The prompt embeds the clock as an inline base64 PNG
  *string* (a bug: it should be a structured `image_url` block), so the image is in the text
  the policy sees, but the time is not — it is rendered as clock hands, not written anywhere.
  `clock_params`, `clock_coordinates` and `original_time` live in `info`, which the policy
  never sees. A policy that base64-decoded the image and read the hands would be *solving* the
  task through an odd channel, not hacking it.
- **Not guessable.** A fixed common guess ("The time is 10:10:00") over 30 examples: mean
  0.108, max 0.35, none at the 1.9 maximum. Times are effectively uniform, so no constant
  answer reaches the reference reward.
- `exact_time_reward` string-compares the normalized prediction to `answer`; format
  mismatches (e.g. `3:45:00` vs `03:45:00`) can under-credit an otherwise correct read, but
  that works against a hacker, not for one.

Verdict: no confirmed hack.

Files: `guess.json.gz`.
