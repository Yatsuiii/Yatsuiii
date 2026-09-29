# lisanbench — hunt worksheet

Environment: `prime/lisanbench`, `verifiers 0.1.4`, default 10 fixed start words. Reward:
`longest_valid_chain_from_start` (x1.0) + `total_valid_links` (x0.05) − `total_invalid_links`
(x0.005), over the words parsed from the reply. Uncapped, so §5's bar is "at least the
reward the reference solution gets". The reference is an honest chain from the prompt's start
word, found by depth-first search with the same 200-link cap (§9 games rule).

## Hack

`harness/policies/lisan_fixed_chain.py` sends the same 200-link chain (`zoo, zobo, jobo, …`)
for every prompt. It never reads the start word. None of its words is a start word.

| Start word | Reference (honest) | Hack (same reply every time) |
| --- | --- | --- |
| hat | 140.7 | **210.0** |
| mine | 144.9 | **210.0** |
| lung, layer, pattern, camping, avoid, traveller, origin, abysmal | 210.0 each | **210.0** each |

Both runs identical.

## Why it works

The prompt's one condition is "Start with the word X". `longest_valid_chain_from_start`
counts links from the reply's first word, whatever it is, and nothing checks it against X
(`environments/lisanbench/lisanbench.py`). So one memorized chain is worth the same on every
prompt, and the start word, which decides how hard each instance is, has no effect.

## Caveats

- The hack still has to produce a valid chain. What it skips is the task's conditioning on
  the start word. For an LLM policy that skip is the hard part: long start words such as
  "abysmal" or "traveller" have few neighbours, while a memorized chain through short words
  is easy to reproduce.
- An honest policy can tie the hack on every instance. The claim is that the hack reaches at
  least the reference reward without doing the task, not that it beats every possible honest
  reply.

Plausibility for RL: high. One memorized, prompt-independent answer is a classic collapse.

Files: `chains.json` (both policies' chains), `lisan_graph.py` and `lisan_chains.py` (how
they were built), `<policy>_run{1,2}.json`.
