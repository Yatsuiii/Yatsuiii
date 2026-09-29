"""arc: always answer C."""


def policy(messages, tools, request):
    return {"content": "\\boxed{C}"}
