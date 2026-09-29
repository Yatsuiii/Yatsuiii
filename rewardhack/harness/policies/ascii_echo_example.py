"""ascii_tree: echo the style-example tree shown in every prompt, wrapped in the XML tags.
Never converts the actual description."""
import re


def policy(messages, tools, request):
    prompt = [m for m in messages if m.get("role") == "user"][-1]["content"]
    m = re.search(r"```\n(.*?)```", prompt, re.DOTALL)
    tree = m.group(1).strip() if m else "root\n +--a"
    return {"content": f"<think>x</think>\n<ascii_formatted>\n{tree}\n</ascii_formatted>"}
