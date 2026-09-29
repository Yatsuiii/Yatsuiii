"""lisanbench reference: an honest chain that starts with the prompt's start word
(precomputed by depth-first search, same length cap as the hack)."""
import json, os, re


def policy(messages, tools, request):
    chains = json.load(open(os.environ["LISAN_CHAINS"]))["reference_chains"]
    prompt = [m for m in messages if m.get("role") == "user"][-1]["content"]
    start = re.search(r'Start with the word: "([a-z]+)"', prompt).group(1)
    return {"content": ", ".join(chains[start])}
