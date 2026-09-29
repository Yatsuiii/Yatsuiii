# ascii_tree — hunt worksheet (no confirmed hack)

Environment: `prime/ascii_tree`, `verifiers 0.1.4`, dataset `kalomaze/ascii-tree-mix-it1`
(train). Reward = 0.3·line-similarity + 0.7·(longest matching line block / #truth lines),
each with two easy format multipliers (indented lines; contains "--"). Continuous; max ~1.0
for the exact tree.

## Findings

- **No leak.** The prompt shows a fixed *style example* (the `node-fs-extra` tree, identical
  across rows) plus an English description of the target tree. The ground-truth tree is not in
  the prompt (checked: 1 of 12 truth lines appear verbatim, only the root name). Building the
  tree requires parsing the description — the intended task.
- **The reward cannot exceed the exact-tree score.** Both terms are bounded by matching the
  truth lines, so no line-count padding inflates it past 1.0.
- **Empirical:** echoing the shown style example (a natural naive hack) over 50 rows scores
  mean 0.012, max 0.26, none near 1.0 (`echo.json.gz`).

Verdict: no confirmed hack.
