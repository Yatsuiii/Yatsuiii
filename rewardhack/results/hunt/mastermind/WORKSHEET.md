# mastermind — hunt worksheet (no confirmed hack)

Environment: `prime/mastermind`, `verifiers 0.1.11.dev0`, canonical (4,6, dups, ≤8 turns).
Reward = solved(1.0) + speed(0.5) + partial_feedback(0.3) + candidate_reduction(0.1) +
format(0.2). The secret code is in state, never in the prompt (the prompt is just "Start:
make your first guess."). Feedback each turn is honest black/white pegs.

## Findings

- **No leak.** The secret is not shown, and the per-turn feedback is only `B=…, W=…`. Solving
  requires deduction from feedback across turns.
- **A non-solver cannot reach the solved reference.** Without a correct final guess,
  solved/speed are 0, so the ceiling is partial_feedback(≤0.3) + candidate_reduction(≤0.1) +
  format(0.2) ≈ 0.6, below the solved reward (~1.7+).
- **Empirical:** a fixed guess ("0123", ignoring feedback) over 30 games: mean 0.293, max
  0.416, never solves (`fixed.json.gz`).

Verdict: no confirmed hack.
