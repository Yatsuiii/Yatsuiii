"""clockbench: answer {"valid": false} on every turn. Never reads the image."""


def policy(messages, tools, request):
    return {"content": "{\"valid\": false}"}
