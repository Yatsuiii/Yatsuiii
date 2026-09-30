"""Load tau-bench retail: its own tool code, the DB, and recorded agent trajectories.

Tools are loaded straight from their files behind a stub `Tool` base, so tau_bench's heavy
agent dependencies are never imported. Validity is decided by these unmodified functions.
"""
from __future__ import annotations

import importlib.util
import json
import os
import random
import sys
import types

TB = os.environ.get("TAU_BENCH", "/home/user/sierra-research/tau-bench")
RETAIL = os.path.join(TB, "tau_bench", "envs", "retail")

WRITE_TOOLS = {
    "cancel_pending_order": "CancelPendingOrder",
    "exchange_delivered_order_items": "ExchangeDeliveredOrderItems",
    "modify_pending_order_items": "ModifyPendingOrderItems",
    "return_delivered_order_items": "ReturnDeliveredOrderItems",
    "modify_pending_order_payment": "ModifyPendingOrderPayment",
    "modify_pending_order_address": "ModifyPendingOrderAddress",
    "modify_user_address": "ModifyUserAddress",
}
READ_TOOLS = {"get_order_details": ("order", "order_id"),
              "get_product_details": ("product", "product_id"),
              "get_user_details": ("user", "user_id")}


def load_tools() -> dict:
    if "tau_bench.envs.tool" not in sys.modules:
        pkg = types.ModuleType("tau_bench"); pkg.__path__ = []
        envs = types.ModuleType("tau_bench.envs"); envs.__path__ = []
        toolmod = types.ModuleType("tau_bench.envs.tool")

        class Tool:  # minimal stand-in for tau_bench.envs.tool.Tool
            pass
        toolmod.Tool = Tool
        sys.modules.update({"tau_bench": pkg, "tau_bench.envs": envs, "tau_bench.envs.tool": toolmod})
    out = {}
    for fname, cls in WRITE_TOOLS.items():
        spec = importlib.util.spec_from_file_location(f"tb_{fname}", os.path.join(RETAIL, "tools", f"{fname}.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        out[fname] = getattr(mod, cls).invoke
    return out


def load_db() -> dict:
    d = {}
    for k in ("orders", "products", "users"):
        with open(os.path.join(RETAIL, "data", f"{k}.json")) as fh:
            d[k] = json.load(fh)
    return d


def _args(call) -> dict:
    a = call["function"]["arguments"]
    return json.loads(a) if isinstance(a, str) else dict(a)


def parse(traj: list) -> list:
    """Steps: dicts with kind in {assistant,user,tool}; tool steps carry name/args/ok/content."""
    calls = {}
    steps = []
    for m in traj:
        role = m.get("role")
        if role == "system":
            continue
        if role == "assistant":
            steps.append(dict(kind="assistant"))
            for c in m.get("tool_calls") or []:
                calls[c.get("id")] = c
        elif role == "user":
            steps.append(dict(kind="user"))
        elif role == "tool":
            c = calls.get(m.get("tool_call_id"))
            name = m.get("name") or (c["function"]["name"] if c else None)
            args = _args(c) if c else {}
            content = str(m.get("content") or "")
            steps.append(dict(kind="tool", name=name, args=args, content=content,
                              ok=not content.startswith("Error")))
    return steps


def scope_of(name: str, args: dict, db: dict):
    """(declared scope keys, written key) for a consequential write, per DAY2_DESIGN.md."""
    if name == "modify_user_address":
        u = ("user", args["user_id"])
        return [u], u
    oid = args["order_id"]
    order = db["orders"][oid]
    o, u = ("order", oid), ("user", order["user_id"])
    if name == "modify_pending_order_address":
        return [o], o
    if name in ("exchange_delivered_order_items", "modify_pending_order_items"):
        ids = set(args.get("item_ids") or [])
        pids = sorted({it["product_id"] for it in order["items"] if it["item_id"] in ids})
        return [o] + [("product", p) for p in pids] + [u], o
    return [o, u], o  # cancel, return, modify_payment


def qualifies(steps: list, db: dict) -> bool:
    for s in steps:
        if s["kind"] == "tool" and s["name"] in WRITE_TOOLS and s["ok"]:
            try:
                scope, _ = scope_of(s["name"], s["args"], db)
            except KeyError:
                continue
            if len({k[0] for k in scope}) >= 2:
                return True
    return False


def sample_tasks(n: int = 40, seed: int = 20260930) -> list:
    """40 distinct task_ids, one qualifying reward-1 trajectory each (DAY2_DESIGN.md)."""
    db = load_db()
    pool = {}
    for fname in ("sonnet-35-new-retail.json", "gpt-4o-retail.json"):
        with open(os.path.join(TB, "historical_trajectories", fname)) as fh:
            for ent in json.load(fh):
                if ent.get("reward") != 1:
                    continue
                steps = parse(ent["traj"])
                if qualifies(steps, db):
                    pool.setdefault(ent["task_id"], []).append(dict(source=fname, trial=ent.get("trial"),
                                                                    task_id=ent["task_id"], steps=steps))
    rng = random.Random(seed)
    ids = sorted(pool)
    chosen = rng.sample(ids, n)
    return [rng.choice(pool[t]) for t in chosen]
