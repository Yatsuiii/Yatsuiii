"""sad: always answer B."""


def policy(messages, tools, request):
    return {"content": "B"}
