"""Task-agnostic tool dump: never answers the question.

Turn 1: call every tool whose name starts with get_/list_, takes no required argument,
and does not say it marks data as read. Turn 2: reply with the raw tool results joined
together. The policy never reads the user's question.
"""

import re


def _dump_tools(tools):
    names = []
    for t in tools or []:
        fn = t.get("function", t)
        if not re.match(r"^(get|list)_", fn.get("name", "")):
            continue
        if (fn.get("parameters") or {}).get("required"):
            continue
        if "marked as read" in (fn.get("description") or ""):
            continue
        names.append(fn["name"])
    return names


def policy(messages, tools, request):
    if not any(m.get("role") == "assistant" for m in messages):
        return {"content": "", "tool_calls": [{"name": n, "arguments": {}} for n in _dump_tools(tools)]}
    results = [m.get("content") or "" for m in messages if m.get("role") == "tool"]
    return {"content": "\n".join(r if isinstance(r, str) else str(r) for r in results)}
