"""Day-2 replay simulator (DAY2_DESIGN.md).

N recorded agents replay concurrently (or serially for C1) against a shared world whose
entities change as Poisson processes. At each consequential write, a condition decides
whether to execute or abort/re-plan; tau-bench's own tool code (the oracle) classifies the
executed action as valid / invalid / rejected by comparing the tool's effect on the agent's
information set (R) with its effect on the current world (C).
"""
from __future__ import annotations

import copy
import hashlib
import heapq
import math
from dataclasses import dataclass, field

import numpy as np

from day2.taubench import READ_TOOLS, WRITE_TOOLS, scope_of

CONDITIONS = ("C0", "C1", "C2", "C3", "C4")
H0 = -math.log(1 - 0.116)  # per entity-hour, anchored to K2
MAX_ATTEMPTS = 3


@dataclass
class Params:
    hazard_per_hour: float
    assistant_median: float = 4.0
    assistant_sigma: float = 0.5
    user_median: float = 25.0
    user_sigma: float = 0.6
    tool_latency: float = 0.2
    rtt_median: float = 0.120
    rtt_sigma: float = 0.4
    relevant_only: bool = False  # sensitivity: drop metadata-touch/irrelevant events


def _rng(*key) -> np.random.Generator:
    h = hashlib.sha256(repr(key).encode()).digest()
    return np.random.default_rng(int.from_bytes(h[:8], "little"))


def _lognorm(rng, median, sigma):
    return float(median * math.exp(sigma * rng.standard_normal()))


# ---------------------------------------------------------------- world
def db_obj(db, key):
    typ, i = key
    return db[{"order": "orders", "product": "products", "user": "users"}[typ]][i]


def mutate(obj: dict, typ: str, u: np.ndarray, relevant_only: bool) -> None:
    """Apply one outside change chosen by uniforms u (len 4). Menus per DAY2_DESIGN.md."""
    if typ == "order":
        st = obj["status"]
        if st == "pending":
            menu = ["ship", "address"] + ([] if relevant_only else ["touch"])
        elif st == "delivered":
            menu = ["web_return"] + ([] if relevant_only else ["touch"])
        else:
            menu = [] if relevant_only else ["touch"]
        if not menu:
            return
        m = menu[int(u[0] * len(menu))]
        if m == "ship":
            obj["status"] = "processed"
        elif m == "address":
            obj["address"] = dict(obj["address"], address2=f"Apt {100 + int(u[1] * 900)}")
        elif m == "web_return":
            obj["status"] = "return requested"
            obj["return_items"] = sorted(it["item_id"] for it in obj["items"])
            obj["return_payment_method_id"] = obj["payment_history"][0]["payment_method_id"]
        else:
            obj["_touch"] = obj.get("_touch", 0) + 1
    elif typ == "product":
        menu = ["price", "avail"] + ([] if relevant_only else ["touch"])
        m = menu[int(u[0] * len(menu))]
        vids = sorted(obj["variants"])
        v = obj["variants"][vids[int(u[1] * len(vids))]]
        if m == "price":
            sign = 1 if u[3] < 0.5 else -1
            v["price"] = round(v["price"] * (1 + sign * (0.05 + 0.10 * u[2])), 2)
        elif m == "avail":
            v["available"] = not v["available"]
        else:
            obj["_touch"] = obj.get("_touch", 0) + 1
    elif typ == "user":
        pms = obj["payment_methods"]
        gcs = sorted(k for k, p in pms.items() if p.get("source") == "gift_card")
        removable = sorted(k for k, p in pms.items() if p.get("source") != "gift_card")
        menu = ["add_card"]
        if len(pms) >= 2 and removable:
            menu.append("remove_method")
        if gcs:
            menu.append("gc_drop")
        if not relevant_only:
            menu += ["address", "touch"]
        m = menu[int(u[0] * len(menu))]
        if m == "add_card":
            cid = f"credit_card_sim{int(u[1] * 1e7)}"
            pms[cid] = {"source": "credit_card", "brand": "visa", "last_four": "0000", "id": cid}
        elif m == "remove_method":
            del pms[removable[int(u[1] * len(removable))]]
        elif m == "gc_drop":
            g = pms[gcs[int(u[1] * len(gcs))]]
            g["balance"] = max(0.0, round(g["balance"] - (5 + 45 * u[2]), 2))
        elif m == "address":
            obj["address"] = dict(obj["address"], address2=f"Suite {100 + int(u[1] * 900)}")
        else:
            obj["_touch"] = obj.get("_touch", 0) + 1


class World:
    def __init__(self, db, keys):
        self.obj = {k: copy.deepcopy(db_obj(db, k)) for k in keys}
        self.ver = {k: 0 for k in keys}


# ---------------------------------------------------------------- oracle
def _data(objs: dict) -> dict:
    d = {"orders": {}, "products": {}, "users": {}}
    for (typ, i), o in objs.items():
        d[{"order": "orders", "product": "products", "user": "users"}[typ]][i] = o
    return d


def _flat(x, path=()):
    if isinstance(x, dict):
        out = {}
        for k, v in x.items():
            out.update(_flat(v, path + (k,)))
        return out
    return {path: repr(x)}  # lists compared whole


def _delta(pre: dict, post: dict) -> dict:
    a, b = _flat(pre), _flat(post)
    return {p: b.get(p) for p in set(a) | set(b) if a.get(p) != b.get(p)}


def run_tool(tools, name, args, objs):
    data = _data(copy.deepcopy(objs))
    pre = copy.deepcopy(data)
    res = tools[name](data, **args)
    ok = not str(res).startswith("Error")
    return ok, (_delta(pre, data) if ok else None), data


def classify(tools, name, args, scope, world, seen_obj):
    """rejected | invalid | valid, plus whether R itself errors (agent's view inconsistent)."""
    cur = {k: world.obj[k] for k in scope}
    info = {k: (seen_obj[k] if k in seen_obj else world.obj[k]) for k in scope}
    okR, dR, _ = run_tool(tools, name, args, info)
    okC, dC, dataC = run_tool(tools, name, args, cur)
    if not okR:
        return "diverged", None
    if not okC:
        return "rejected", None
    return ("valid" if dR == dC else "invalid"), dataC


def evaluate(tools, name, args, scope, world, seen_obj):
    """Run the tool on the agent's information set (R) and on the current world (C)."""
    cur = {k: world.obj[k] for k in scope}
    info = {k: (seen_obj[k] if k in seen_obj else world.obj[k]) for k in scope}
    okR, dR, _ = run_tool(tools, name, args, info)
    okC, dC, dataC = run_tool(tools, name, args, cur)
    return dict(okR=okR, okC=okC, equal=(okR and okC and dR == dC), dataC=dataC)


def verdict(ev) -> str:
    if not ev["okC"]:
        return "rejected"
    return "valid" if ev["equal"] else "invalid"


# ---------------------------------------------------------------- agents / group simulation
@dataclass
class Agent:
    idx: int
    task: dict
    lat: list
    step: int = 0
    start: float = 0.0
    seen_obj: dict = field(default_factory=dict)
    seen_ver: dict = field(default_factory=dict)
    start_ver: dict = field(default_factory=dict)
    read_set: set = field(default_factory=set)


def step_latencies(task, rng, p: Params):
    out = []
    for s in task["steps"]:
        if s["kind"] == "assistant":
            out.append(_lognorm(rng, p.assistant_median, p.assistant_sigma))
        elif s["kind"] == "user":
            out.append(_lognorm(rng, p.user_median, p.user_sigma))
        else:
            out.append(p.tool_latency)
    return out


def task_entities(task, db):
    ks = set()
    for s in task["steps"]:
        if s["kind"] != "tool" or not s["ok"]:
            continue
        if s["name"] in READ_TOOLS:
            typ, arg = READ_TOOLS[s["name"]]
            key = (typ, s["args"].get(arg))
            try:
                db_obj(db, key)
                ks.add(key)
            except (KeyError, TypeError):
                pass
        elif s["name"] in WRITE_TOOLS:
            try:
                ks.update(scope_of(s["name"], s["args"], db)[0])
            except KeyError:
                pass
    return ks


class GroupSim:
    def __init__(self, tasks, db, tools, cond, p: Params, rep, gid, seedbase=20260930, scripted=None):
        self.scripted = scripted  # tests: list of (time, key, fn(obj)) replacing Poisson changes
        self.db, self.tools, self.cond, self.p = db, tools, cond, p
        self.rep, self.gid, self.seed = rep, gid, seedbase
        keys = set()
        for t in tasks:
            keys |= task_entities(t, db)
        self.world = World(db, keys)
        self.agents = [Agent(i, t, step_latencies(t, _rng(seedbase, "lat", rep, gid, i), p))
                       for i, t in enumerate(tasks)]
        self.heap, self.ctr = [], 0
        self.rate = p.hazard_per_hour / 3600.0
        self.ent_rng = {k: _rng(seedbase, "ent", rep, gid, k) for k in sorted(keys)}
        self.actions, self.taskrecs = [], []
        self.finished = 0
        self.next_serial = 1

    def push(self, t, kind, payload):
        self.ctr += 1
        heapq.heappush(self.heap, (t, self.ctr, kind, payload))

    def start_agent(self, a, t0):
        a.start = t0
        a.start_ver = dict(self.world.ver)
        if a.lat:
            self.push(t0 + a.lat[0], "step", a)
        else:
            self.finish(a, t0)

    def finish(self, a, t):
        self.taskrecs.append(dict(cond=self.cond, rep=self.rep, gid=self.gid, agent=a.idx,
                                  task_id=a.task["task_id"], start=a.start, end=t, duration=t - a.start))
        self.finished += 1
        if self.cond == "C1" and self.next_serial < len(self.agents):
            nxt = self.agents[self.next_serial]
            self.next_serial += 1
            self.start_agent(nxt, t)

    def advance(self, a, t):
        a.step += 1
        if a.step >= len(a.task["steps"]):
            self.finish(a, t)
        else:
            self.push(t + a.lat[a.step], "step", a)

    def snapshot(self, a, k):
        a.seen_obj[k] = copy.deepcopy(self.world.obj[k])
        a.seen_ver[k] = self.world.ver[k]

    def checked_keys(self, a, act):
        if self.cond == "C2":
            return [act["written"]]
        if self.cond == "C3":
            return sorted(a.read_set)
        if self.cond == "C4":
            return list(act["scope"])
        return []

    def record(self, a, act, outcome, t):
        self.actions.append(dict(cond=self.cond, rep=self.rep, gid=self.gid, agent=a.idx,
                                 task_id=a.task["task_id"], tool=act["tool"], outcome=outcome,
                                 attempts=act["attempts"], aborts=act["aborts"],
                                 true_aborts=act["true_aborts"], false_aborts=act["false_aborts"],
                                 check_time=act["check_time"], replan_time=act["replan_time"],
                                 tokens=act["tokens"], t_first=act["t_first"], t_done=t))

    def attempt(self, a, act, t):
        act["attempts"] += 1
        w, name, args, scope = self.world, act["tool"], act["args"], act["scope"]
        ev = evaluate(self.tools, name, args, scope, w, a.seen_obj)
        if not ev["okR"]:
            # The agent's own information set says this action fails: on the first attempt a
            # live agent would have adapted before acting (replay can't) -> excluded; after a
            # re-plan the agent sees the precondition fail and correctly stops.
            self.record(a, act, "diverged" if act["attempts"] == 1 else "avoided", t)
            self.advance(a, t)
            return
        keys = self.checked_keys(a, act)
        crng = _rng(self.seed, "chk", self.rep, self.gid, a.idx, a.step, act["attempts"], self.cond)
        if keys:
            act["check_time"] += max(_lognorm(crng, self.p.rtt_median, self.p.rtt_sigma) for _ in keys)
        changed = [k for k in keys if w.ver[k] != a.seen_ver.get(k, a.start_ver.get(k, 0))]
        if changed:
            act["aborts"] += 1
            if verdict(ev) == "valid":
                act["false_aborts"] += 1
            else:
                act["true_aborts"] += 1
            if act["attempts"] >= MAX_ATTEMPTS:
                self.record(a, act, "gave_up", t)
                self.advance(a, t)
                return
            prng = _rng(self.seed, "replan", self.rep, self.gid, a.idx, a.step, act["attempts"])
            a1 = _lognorm(prng, self.p.assistant_median, self.p.assistant_sigma)
            refresh = sorted(a.read_set | set(scope))
            reads = self.p.tool_latency * len(refresh)
            u = _lognorm(prng, self.p.user_median, self.p.user_sigma)
            a2 = _lognorm(prng, self.p.assistant_median, self.p.assistant_sigma)
            dur = a1 + reads + u + a2
            act["replan_time"] += dur
            act["tokens"] += 300 + sum(len(repr(w.obj[k])) // 4 for k in refresh)
            self.push(t + a1 + reads, "reread", (a, refresh))
            self.push(t + dur, "retry", (a, act))
            return
        out = verdict(ev)
        if out in ("valid", "invalid"):
            data = ev["dataC"]
            for k in scope:
                coll = {"order": "orders", "product": "products", "user": "users"}[k[0]]
                new = data[coll][k[1]]
                if new != w.obj[k]:
                    w.obj[k] = new
                    w.ver[k] += 1
                    self.snapshot(a, k)
        self.record(a, act, out, t)
        self.advance(a, t)

    def run(self):
        if self.cond == "C1":
            self.start_agent(self.agents[0], 0.0)
        else:
            for a in self.agents:
                self.start_agent(a, 0.0)
        if self.scripted is not None:
            for (ts, k, fn) in self.scripted:
                self.push(ts, "smut", (k, fn))
        else:
            for k in sorted(self.ent_rng):
                self.push(float(self.ent_rng[k].exponential(1 / self.rate)), "mut", k)
        while self.heap and self.finished < len(self.agents):
            t, _, kind, payload = heapq.heappop(self.heap)
            if kind == "mut":
                k = payload
                mutate(self.world.obj[k], k[0], self.ent_rng[k].random(4), self.p.relevant_only)
                self.world.ver[k] += 1
                self.push(t + float(self.ent_rng[k].exponential(1 / self.rate)), "mut", k)
            elif kind == "smut":
                k, fn = payload
                fn(self.world.obj[k])
                self.world.ver[k] += 1
            elif kind == "reread":
                a, refresh = payload
                for k in refresh:
                    self.snapshot(a, k)
                    a.read_set.add(k)  # re-read records join the agent's read set (C3 checks them)
            elif kind == "retry":
                a, act = payload
                self.attempt(a, act, t)
            else:  # step
                a = payload
                s = a.task["steps"][a.step]
                if s["kind"] == "tool" and s["ok"] and s["name"] in READ_TOOLS:
                    typ, arg = READ_TOOLS[s["name"]]
                    k = (typ, s["args"].get(arg))
                    if k in self.world.obj:
                        self.snapshot(a, k)
                        a.read_set.add(k)
                    self.advance(a, t)
                elif s["kind"] == "tool" and s["ok"] and s["name"] in WRITE_TOOLS:
                    scope, written = scope_of(s["name"], s["args"], self.db)
                    act = dict(tool=s["name"], args=s["args"], scope=scope, written=written,
                               attempts=0, aborts=0, true_aborts=0, false_aborts=0,
                               check_time=0.0, replan_time=0.0, tokens=0, t_first=t)
                    self.attempt(a, act, t)
                else:
                    self.advance(a, t)
        return self.actions, self.taskrecs
