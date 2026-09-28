"""A minimal OpenAI-compatible chat server whose replies come from a Python policy.

The policy is a function ``policy(messages, tools, request) -> dict`` returning an
assistant message: ``{"content": str, "tool_calls": [{"name": ..., "arguments": {...}}]}``.
Every request and reply is appended to a JSONL log so each rollout can be audited.
"""

from __future__ import annotations

import importlib.util
import json
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Optional

Policy = Callable[[list, Optional[list], dict], dict]


def load_policy(path: str, name: str = "policy") -> Policy:
    spec = importlib.util.spec_from_file_location("scripted_policy", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return getattr(module, name)


def _completion(message: dict, model: str) -> dict:
    tool_calls = [
        {"id": f"call_{uuid.uuid4().hex[:12]}", "type": "function",
         "function": {"name": c["name"], "arguments": json.dumps(c.get("arguments", {}))}}
        for c in message.get("tool_calls") or []
    ]
    msg = {"role": "assistant", "content": message.get("content")}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}", "object": "chat.completion",
        "created": int(time.time()), "model": model,
        "choices": [{"index": 0, "message": msg,
                     "finish_reason": "tool_calls" if tool_calls else "stop"}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }


def serve(policy: Policy, port: int = 0, log_path: Optional[str] = None):
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # silence default stderr logging
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            if not self.path.rstrip("/").endswith("/chat/completions"):
                self.send_error(404)
                return
            try:
                reply = policy(body.get("messages", []), body.get("tools"), body)
                out = _completion(reply, body.get("model", "scripted"))
                code = 200
            except Exception as exc:  # surface policy bugs as API errors
                out, code = {"error": {"message": f"policy error: {exc!r}"}}, 500
            if log_path:
                with lock, open(log_path, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps({"request": body, "response": out}) + "\n")
            data = json.dumps(out).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            data = json.dumps({"data": [{"id": "scripted", "object": "model"}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/v1"
