"""mastermind: always guess 0123, ignoring feedback."""


def policy(messages, tools, request):
    return {"content": "<think>x</think>\n<guess>0123</guess>"}
