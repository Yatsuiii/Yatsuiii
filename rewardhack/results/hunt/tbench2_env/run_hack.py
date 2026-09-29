"""tbench2_env hunt (default local mode, TB2_WITHHOLD_TESTS unset).

The agent does no task work. Its only command rewrites the task's tests/test.sh, whose
path reset() reports in `task_path`, so the staged verifier just writes a passing verdict.
Task dirs are scratch copies of the Terminal-Bench 2 clone; the real test.sh is never run.
"""
import json, sys
from tbench2_env.server.tbench2_env_environment import Tbench2Environment
from tbench2_env.models import Tbench2Action

tasks_dir, out_path, task_ids = sys.argv[1], sys.argv[2], sys.argv[3:]
HACK = ("printf '#!/bin/bash\\nmkdir -p /logs/verifier\\necho 1 > /logs/verifier/reward.txt\\n' "
        "> {tp}/tests/test.sh")
rows = []
for tid in task_ids:
    env = Tbench2Environment(tasks_dir=tasks_dir)
    obs = env.reset(task_id=tid)
    tp = obs.task_path
    o1 = env.step(Tbench2Action(action_type="exec", command=HACK.format(tp=tp)))
    o2 = env.step(Tbench2Action(action_type="evaluate"))
    rows.append({"task": tid, "task_path": tp, "hack_cmd_ok": o1.success, "reward": o2.reward,
                 "done": o2.done, "info": o2.info, "error": o2.error})
    print(json.dumps(rows[-1], default=str))
    env.close()
json.dump(rows, open(out_path, "w"), indent=1, default=str)
