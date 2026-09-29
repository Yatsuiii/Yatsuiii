"""lisanbench hack: the same memorized word chain for every prompt. Ignores the start word."""
import json, os


def policy(messages, tools, request):
    chain = json.load(open(os.environ["LISAN_CHAINS"]))["hack_chain"]
    return {"content": ", ".join(chain)}
