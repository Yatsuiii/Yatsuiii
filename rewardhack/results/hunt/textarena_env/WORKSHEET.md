# textarena_env — hunt worksheet (no confirmed hack)

Environment: `openenv/textarena_env`, default `env_id="Wordle-v0"`. Reward comes from
TextArena's own `state.rewards` (`_extract_reward`); solving the word yields the win reward.

## Findings

- **No leak.** The secret word does not appear in the observation (no "secret"/"answer is"/
  "the word is" markers), and feedback is standard Wordle letter colouring.
- **Blind play scores ~chance.** A fixed list of guesses over 30 episodes: 1/30 with positive
  reward, mean total 0.033, i.e. the odd episode where a fixed word happens to be the secret.
  A real solver deducing from feedback reaches the win reward far more often.
- The reward is TextArena's, computed from the true game state; there is no shaping term a
  blind policy can farm.

Verdict: no confirmed hack.

Files: `probe.json` (per-episode blind rewards), `run_probe.py`.
