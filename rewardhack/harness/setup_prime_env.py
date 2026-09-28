"""Create a venv for one Prime Intellect environment, pinned to the verifiers release of its day.

Setup rule (PREREGISTRATION.md §9): verifiers is pinned to the newest stable release
published on or before the date the environment's directory last changed in the hub,
because later releases dropped formats older environments rely on.

Usage: python setup_prime_env.py ENV_NAME   -> prints the venv path
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.request

HUB = "/home/user/primeintellect-ai/prime-environments"
VENVS = "/home/user/.venvs"


def last_changed(name: str) -> str:
    out = subprocess.run(["git", "log", "-1", "--format=%cs", "--", f"environments/{name}"],
                         cwd=HUB, capture_output=True, text=True, check=True).stdout.strip()
    if not out:
        raise SystemExit(f"no history for {name}")
    return out


def declared_spec(name: str) -> str:
    import tomllib
    with open(f"{HUB}/environments/{name}/pyproject.toml", "rb") as fh:
        deps = tomllib.load(fh).get("project", {}).get("dependencies", [])
    for dep in deps:
        if dep.replace(" ", "").startswith("verifiers") and not dep.startswith("verifiers-"):
            return dep.replace(" ", "")[len("verifiers"):].split(";")[0].strip("[]")
    return ""


def verifiers_release_on(date: str, spec: str = "") -> str:
    """Newest release on or before `date` that satisfies the environment's own requirement.

    Stable releases are preferred; if none satisfies the requirement by that date, the
    earliest satisfying release (a pre-release if that is all there is) is used.
    """
    from packaging.specifiers import SpecifierSet
    from packaging.version import Version
    with urllib.request.urlopen("https://pypi.org/pypi/verifiers/json", timeout=60) as resp:
        data = json.load(resp)
    specifier = SpecifierSet(spec, prereleases=True)
    releases = sorted((files[0]["upload_time"][:10], Version(ver), ver)
                      for ver, files in data["releases"].items() if files)
    ok = [r for r in releases if specifier.contains(r[1], prereleases=True)]
    stable_by_date = [r for r in ok if r[0] <= date and not r[1].is_prerelease]
    if stable_by_date:
        return stable_by_date[-1][2]
    any_by_date = [r for r in ok if r[0] <= date]
    if any_by_date:
        return any_by_date[-1][2]
    if not ok:
        raise SystemExit(f"no verifiers release satisfies {spec!r}")
    return ok[0][2]


def main(name: str) -> int:
    date = last_changed(name)
    version = verifiers_release_on(date, declared_spec(name))
    venv = os.path.join(VENVS, name)
    env = dict(os.environ, VIRTUAL_ENV=venv)
    if not os.path.exists(os.path.join(venv, "bin", "python")):
        subprocess.run(["uv", "venv", "-q", "-p", "3.12", venv], check=True)
    subprocess.run(["uv", "pip", "install", "-q", "-e", f"{HUB}/environments/{name}",
                    f"verifiers=={version}"], env=env, check=True)
    print(json.dumps({"env": name, "last_changed": date, "verifiers": version, "venv": venv}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
