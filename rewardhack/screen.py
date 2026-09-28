"""§3 of PREREGISTRATION.md: seeded order of all environments plus the E1 screen."""

import json
import os
import random
import re
import sys

HUBS = {
    "prime": "/home/user/primeintellect-ai/prime-environments/environments",
    "openenv": "/home/user/meta-pytorch/openenv/envs",
}
SEED = 20260928
LLM_REWARD = re.compile(r"JudgeRubric|judge_model|judge_client|AsyncOpenAI|OpenAI\(|anthropic|litellm")


def e1_hits(root):
    hits = set()
    for dirpath, _, files in os.walk(root):
        for name in files:
            if name.endswith(".py"):
                with open(os.path.join(dirpath, name), encoding="utf-8", errors="replace") as fh:
                    hits.update(LLM_REWARD.findall(fh.read()))
    return sorted(hits)


def main(out="results/screen.json"):
    envs = sorted(f"{hub}/{d}" for hub, path in HUBS.items()
                  for d in os.listdir(path) if os.path.isdir(os.path.join(path, d)))
    order = envs[:]
    random.Random(SEED).shuffle(order)
    rows = []
    for env in order:
        hub, name = env.split("/", 1)
        hits = e1_hits(os.path.join(HUBS[hub], name))
        rows.append({"env": env, "e1_pass": not hits, "e1_hits": hits})
    with open(out, "w") as fh:
        json.dump({"seed": SEED, "n": len(order), "order": rows}, fh, indent=1)
    print(f"{len(order)} environments, {sum(r['e1_pass'] for r in rows)} pass E1", file=sys.stderr)


if __name__ == "__main__":
    main()
