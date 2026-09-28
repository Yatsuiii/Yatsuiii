"""Check claims against a repository index (§4)."""

from __future__ import annotations

from typing import Tuple

from .extract import Claim
from .repo import RepoIndex

OK = "ok"
MISSING = "missing"
MOVED = "moved"
NAMESPACE = "namespace"  # a config prefix, not a key: neither checked nor counted
FLAGGED = frozenset({MISSING, MOVED})


def check_claim(claim: Claim, index: RepoIndex) -> Tuple[str, str]:
    """Return (status, detail) for one claim."""
    if claim.kind == "class":
        if index.has_type(claim.value):
            return OK, ""
        simple = claim.value.rsplit(".", 1)[1]
        packages = index.packages_for(simple)
        if packages:
            return MOVED, f"{simple} is declared in: {', '.join(sorted(packages)[:3])}"
        return MISSING, f"no type named {simple} is declared anywhere"
    if claim.kind == "config":
        if index.has_token(claim.value):
            return OK, ""
        if index.is_namespace(claim.value):
            return NAMESPACE, ""
        return MISSING, "key not found in any non-documentation source file"
    raise ValueError(f"unknown claim kind: {claim.kind}")
