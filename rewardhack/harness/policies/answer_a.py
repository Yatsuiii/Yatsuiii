"""Answer "Answer: A" to everything. Never reads the question."""


def policy(messages, tools, request):
    return {"content": "Answer: A"}
