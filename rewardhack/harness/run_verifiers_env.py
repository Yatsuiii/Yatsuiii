"""Run a Prime Intellect `verifiers` environment against a scripted policy and print rewards.

Usage:
  python run_verifiers_env.py ENV_ID POLICY.py [--n 3] [--args '{"k": v}'] [--log out.jsonl]
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scripted_llm import load_policy, serve  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("env_id")
    ap.add_argument("policy")
    ap.add_argument("--n", type=int, default=3, help="number of dataset examples")
    ap.add_argument("--args", default="{}", help="JSON env arguments")
    ap.add_argument("--log", default=None, help="JSONL log of model requests and replies")
    ap.add_argument("--out", default=None, help="JSON file for the rollout outputs")
    ap.add_argument("--rollouts", type=int, default=1)
    a = ap.parse_args(argv)

    import verifiers as vf
    import verifiers.types as vft

    os.environ.setdefault("SCRIPTED_KEY", "scripted")
    env = vf.load_environment(a.env_id, **json.loads(a.args))
    server, url = serve(load_policy(a.policy), log_path=a.log)
    try:
        import asyncio
        import inspect
        client_ann = str(inspect.signature(env.evaluate).parameters["client"].annotation)
        if hasattr(vft, "ClientConfig") and "ClientConfig" in client_ann:  # newer releases
            client = vft.ClientConfig(api_base_url=url, api_key_var="SCRIPTED_KEY", max_retries=0)
        else:  # older releases take an OpenAI client directly
            from openai import AsyncOpenAI
            client = AsyncOpenAI(base_url=url, api_key="scripted", max_retries=0)
        run = getattr(env, "evaluate_sync", None) or env.evaluate
        results = run(client=client, model="scripted", num_examples=a.n,
                      rollouts_per_example=a.rollouts)
        if inspect.iscoroutine(results):
            results = asyncio.run(results)
    finally:
        server.shutdown()
    rows = []
    if isinstance(results, dict) and "outputs" in results:
        outputs = results["outputs"]
    else:  # old GenerateOutputs: parallel lists, as a model or a dict
        get = (lambda k, d=None: results.get(k, d)) if isinstance(results, dict) \
            else (lambda k, d=None: getattr(results, k, d))
        rewards, metrics = get("reward"), get("metrics") or {}
        outputs = [{"example_id": i, "reward": rewards[i], "answer": (get("answer") or [None] * len(rewards))[i],
                    "completion": (get("completion") or [None] * len(rewards))[i], "error": None,
                    "metrics": {k: v[i] for k, v in metrics.items()}}
                   for i in range(len(rewards))]
    for o in outputs:
        rows.append({"example_id": o.get("example_id"), "reward": o.get("reward"),
                     "metrics": o.get("metrics"), "answer": o.get("answer"),
                     "error": o.get("error"), "completion": o.get("completion")})
        print(json.dumps({k: rows[-1][k] for k in ("example_id", "reward", "metrics", "error")},
                         default=str))
    if a.out:
        with open(a.out, "w") as fh:
            json.dump(rows, fh, indent=1, default=str)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
