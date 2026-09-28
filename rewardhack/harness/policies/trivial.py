"""E2 check policy: a fixed, uninformative reply. Only proves the reward code runs."""


def policy(messages, tools, request):
    return {"content": "I don't know."}
