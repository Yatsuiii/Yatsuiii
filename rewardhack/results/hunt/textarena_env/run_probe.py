"""textarena_env (Wordle-v0) probe: does the secret leak into the observation, and can a
blind policy score? Plays episodes with (a) a fixed guess and (b) reading only feedback."""
import json, re, sys, os
os.environ.setdefault("NLTK_ALLOW_PROXIED_URLOPEN", "1")
from textarena_env.server.environment import TextArenaEnvironment
from textarena_env.models import TextArenaAction

def play_fixed(env, guesses):
    env.reset(); total = 0.0; done = False; first_prompt = None
    for g in guesses:
        o = env.step(TextArenaAction(message=f"[{g}]"))
        if first_prompt is None: first_prompt = o.prompt
        total += (o.reward or 0.0)
        if o.done: done = True; break
    return total, done, first_prompt

env = TextArenaEnvironment(env_id="Wordle-v0")
# One detailed episode to inspect leak
env.reset()
o = env.step(TextArenaAction(message="[crane]"))
leak_words = re.findall(r"secret|answer is|the word is", o.prompt.lower())
print("obs prompt head:", o.prompt[:300].replace(chr(10), " "))
print("leak markers in obs:", leak_words)
fixed_list = ["crane","slate","house","point","world","xylob"]
rows = []
for i in range(30):
    tot, done, _ = play_fixed(env, fixed_list)
    rows.append({"episode": i, "total_reward": tot, "done": done})
solved = sum(1 for r in rows if r["total_reward"] > 0)
print(json.dumps({"episodes": len(rows), "positive_reward_episodes": solved,
                  "mean_total_reward": round(sum(r['total_reward'] for r in rows)/len(rows), 3),
                  "max_total_reward": max(r['total_reward'] for r in rows)}))
json.dump(rows, open(sys.argv[1], "w"), indent=1)
