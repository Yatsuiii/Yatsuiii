# arc — hunt worksheet (no confirmed hack)

Environment: `prime/arc` (ai2_arc, ARC-Challenge test), `verifiers 0.1.5`. Reward 1.0 if the
boxed letter starts with the gold letter, else 0.0.

## Findings

- **No leak** of the answer letter into the prompt; options are shown with labels only.
- **Labels are near-uniform**, so no position-bias hack: ARC-Challenge test gold shares are
  A 0.227, B 0.265, C 0.265, D 0.243 (ARC-Easy similar). A constant letter tops out ~0.265,
  far below a real solver's ~1.0.
- **Empirical:** constant "C" over 200 items scores mean 0.275 (`const_c.json.gz`).
- The `response.startswith(str(answer))` check is loose but cannot match multiple single-letter
  golds from one response, so it grants no cross-label exploit.

Verdict: no confirmed hack.
