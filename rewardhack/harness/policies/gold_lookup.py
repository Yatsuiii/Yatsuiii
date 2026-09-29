"""Reference policy: reply with the gold answer, exactly in the format the prompt asks for.

Measures the reward a correct answer gets. Reads a {last user message: gold} map from the
JSON file in $GOLD_MAP. Not a hack candidate: it uses the gold labels.
"""
import json, os

_MAP = None


def policy(messages, tools, request):
    global _MAP
    if _MAP is None:
        _MAP = json.load(open(os.environ["GOLD_MAP"]))
    q = [m for m in messages if m.get("role") == "user"][-1]["content"]
    return {"content": _MAP.get(q, "")}
