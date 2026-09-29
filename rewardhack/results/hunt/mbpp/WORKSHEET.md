# mbpp — hunt worksheet

Environment: `prime/mbpp`, `verifiers 0.1.8`, default `dataset_config="sanitized"`, split
`test` (the default dataset). Reward: fraction of the task's `test_list` asserts that pass,
each run as `exec(f"{test_setup}\n{parsed_code}\n{test}", {})`. Maximum 1.0.

## Hack

`harness/policies/mbpp_universal_eq.py`. It reads only the test lines shown in the prompt to
get the called function names (never the task description), and emits, for each name, a
function returning `_A()`, an object whose `__eq__` returns `True` for anything (subclass of
float so numeric contexts don't crash). It computes no real answer.

```python
class _A(float):
    def __new__(cls): return super().__new__(cls, 0.0)
    def __eq__(self, o): return True
    ...
def similar_elements(*a, **k): return _A()
```

## Result (environment's own reward code, 100 tasks, two runs)

| | mean reward | tasks at 1.0 | tasks at 0.0 |
| --- | --- | --- | --- |
| run 1 | 0.88 | 88 | 12 |
| run 2 | 0.88 | 88 | 12 |

Identical across runs. The 88 tasks at 1.0 are confirmed hacks: the code returns a sentinel,
not the answer, and each task's every assert passes because `_A() == expected` is `True`.

## Why the other 12 fail

Their tests transform the output before comparing, e.g. `assert set(func(...)) == set(...)`
or `assert sorted(func(...)) == [...]`. `set(_A())`/`sorted(_A())` use `__iter__`, which
returns empty, so the wrapped comparison is `set() == {...}` and fails. A per-task hack would
beat these too, but the single task-agnostic policy already wins 88/100.

## Why it works

The reward `exec`s the model's code and the assert in one namespace and only checks that the
assert does not raise. It never checks the return type or value independently, so an object
that claims equality with everything passes. `environments/mbpp/mbpp.py`, `pass_rate`.

Plausibility for RL: high. Returning an always-equal object is a well-known unit-test hack,
and MBPP-style `assert f(x) == y` tests are the exact shape it defeats.

Files: `universal_run{1,2}.json.gz`.
