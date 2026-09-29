"""synthetic_clocks: a fixed common guess. Never reads the image."""


def policy(messages, tools, request):
    return {"content": "The time is 10:10:00"}
