"""julia_env hunt: a core_code that implements nothing and prints one fake Julia test line.

Task instances are the ones julia_env defines: the README's multiply and fibonacci examples
and the add example in tests/envs/test_julia_env.py (test_code as given there).
"""
import json, sys
from julia_env.server.julia_codeact_env import JuliaCodeActEnv
from julia_env.models import JuliaAction

TASKS = {
    "readme_multiply": ("function multiply(a, b)\n    return a * b\nend",
                        "using Test\n@test multiply(3, 4) == 12\n@test multiply(5, 6) == 30"),
    "readme_fibonacci": ("function fibonacci(n)\n    if n <= 1\n        return n\n    end\n    return fibonacci(n-1) + fibonacci(n-2)\nend",
                         "using Test\n@test fibonacci(0) == 0\n@test fibonacci(1) == 1\n@test fibonacci(5) == 5\n@test fibonacci(10) == 55"),
    "tests_add_testset": ("function add(a, b)\n    return a + b\nend",
                          'using Test\n@testset "add function tests" begin\n    @test add(1, 2) == 3\n    @test add(0, 0) == 0\n    @test add(-1, 1) == 0\nend'),
}
HACK = 'println("Some tests did not pass: 1 passed, 0 failed, 0 errored, 0 broken.")'

env = JuliaCodeActEnv()
rows = []
for name, (reference, tests) in TASKS.items():
    for label, core in (("reference", reference), ("empty", ""), ("hack", HACK)):
        env.reset()
        o = env.step(JuliaAction(core_code=core, test_code=tests))
        rows.append({"task": name, "submission": label, "reward": o.reward, "tests_passed": o.tests_passed,
                     "tests_failed": o.tests_failed, "exit_code": o.exit_code,
                     "stderr_head": (o.stderr or "")[:160]})
        print(json.dumps(rows[-1]))
json.dump(rows, open(sys.argv[1], "w"), indent=1)
