"""Deterministic tests for the day-2 simulator on real tau-bench records (sigma = 0 timing)."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from day2.taubench import load_db, load_tools  # noqa: E402
from day2.sim import GroupSim, Params  # noqa: E402

DB = load_db()
TOOLS = load_tools()
P = Params(hazard_per_hour=1.0, assistant_sigma=0.0, user_sigma=0.0)  # changes are scripted


def _pick_case():
    """A pending order whose first item's product has another available variant, paid by a
    non-gift-card method; plus a second order of another user to use as an irrelevant read."""
    for oid in sorted(DB["orders"]):
        o = DB["orders"][oid]
        if o["status"] != "pending" or len(o["payment_history"]) != 1:
            continue
        pm = o["payment_history"][0]["payment_method_id"]
        if "gift_card" in pm:
            continue
        it = o["items"][0]
        prod = DB["products"][it["product_id"]]
        alts = sorted(v for v, x in prod["variants"].items() if x["available"] and v != it["item_id"])
        if alts:
            other = next(x for x in sorted(DB["orders"]) if DB["orders"][x]["user_id"] != o["user_id"])
            return oid, o["user_id"], it["item_id"], it["product_id"], alts[0], pm, other
    raise RuntimeError("no case")


OID, UID, ITEM, PID, NEW, PM, OTHER = _pick_case()


def _task():
    # timeline with sigma=0: step times 4.0, 4.2, 4.4, 4.6, 29.6, 29.8 (assistant, reads x3, user, write)
    return dict(task_id="t", steps=[
        dict(kind="assistant"),
        dict(kind="tool", name="get_order_details", args={"order_id": OID}, ok=True, content="{}"),
        dict(kind="tool", name="get_product_details", args={"product_id": PID}, ok=True, content="{}"),
        dict(kind="tool", name="get_order_details", args={"order_id": OTHER}, ok=True, content="{}"),
        dict(kind="user"),
        dict(kind="tool", name="modify_pending_order_items",
             args={"order_id": OID, "item_ids": [ITEM], "new_item_ids": [NEW], "payment_method_id": PM},
             ok=True, content="{}"),
    ])


def run(cond, scripted):
    sim = GroupSim([_task()], DB, TOOLS, cond, P, rep=0, gid=0, scripted=scripted)
    acts, tasks = sim.run()
    assert len(acts) == 1
    return acts[0]


def price_up(o):
    o["variants"][NEW]["price"] = round(o["variants"][NEW]["price"] * 1.10, 2)


def touch(o):
    o["_touch"] = o.get("_touch", 0) + 1


def ship(o):
    o["status"] = "processed"


def test_no_change_all_valid():
    for c in ("C0", "C1", "C2", "C3", "C4"):
        a = run(c, [])
        assert a["outcome"] == "valid" and a["aborts"] == 0, c


def test_relevant_price_change_between_read_and_write():
    s = [(10.0, ("product", PID), price_up)]
    assert run("C0", s)["outcome"] == "invalid"
    assert run("C2", s)["outcome"] == "invalid"          # written object (order) unchanged
    for c in ("C3", "C4"):
        a = run(c, s)
        assert a["true_aborts"] == 1 and a["false_aborts"] == 0 and a["outcome"] == "valid", c


def test_irrelevant_touch_on_written_order_is_false_abort():
    s = [(10.0, ("order", OID), touch)]
    assert run("C0", s)["outcome"] == "valid"
    for c in ("C2", "C3", "C4"):
        a = run(c, s)
        assert a["false_aborts"] == 1 and a["true_aborts"] == 0 and a["outcome"] == "valid", c


def test_extra_read_outside_scope_only_trips_c3():
    s = [(10.0, ("order", OTHER), touch)]
    assert run("C2", s)["aborts"] == 0
    assert run("C4", s)["aborts"] == 0
    a = run("C3", s)
    assert a["false_aborts"] == 1 and a["outcome"] == "valid"


def test_order_ships_rejected_or_avoided():
    s = [(10.0, ("order", OID), ship)]
    assert run("C0", s)["outcome"] == "rejected"
    for c in ("C2", "C3", "C4"):
        a = run(c, s)
        assert a["true_aborts"] == 1 and a["outcome"] == "avoided", c


def test_change_before_read_is_diverged():
    s = [(1.0, ("order", OID), ship)]  # before the agent reads the order at t=4.2
    for c in ("C0", "C3", "C4"):
        assert run(c, s)["outcome"] == "diverged", c


def test_serial_queue_runs_agents_one_after_another():
    sim = GroupSim([_task(), _task()], DB, TOOLS, "C1", P, rep=0, gid=0, scripted=[])
    _, tasks = sim.run()
    tasks = sorted(tasks, key=lambda r: r["start"])
    assert tasks[1]["start"] == pytest.approx(tasks[0]["end"])


def test_reread_joins_read_set_for_c3():
    # Task that never reads the user; a relevant change aborts it, the re-plan re-reads the
    # scope (incl. user), and a later user change must then be caught by C3 too.
    task = _task()
    def drop_pm(o):
        o["payment_methods"].pop(PM, None)
    s = [(10.0, ("product", PID), price_up), (45.0, ("user", UID), drop_pm)]
    a = run("C3", s)
    assert a["outcome"] in ("avoided", "valid", "gave_up") and a["outcome"] != "invalid"
