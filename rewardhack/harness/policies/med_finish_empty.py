"""med_agent_bench: immediately FINISH([]) without any query."""


def policy(messages, tools, request):
    return {"content": "FINISH([])"}
