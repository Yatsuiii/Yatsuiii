"""Shared lexicons and normalisation used by every extractor and the differ."""

from __future__ import annotations

import re

#: Verbs and nouns whose *appearance* in a tool description signals that the tool
#: may now reach further than it did before (write, exfiltrate, spend, escalate).
#: Tuned for precision over recall: a false positive here pollutes the headline
#: number, and the annotation-based detector already covers the clean cases.
SCOPE_EXPANSION_TERMS: frozenset[str] = frozenset(
    {
        "delete", "remove", "destroy", "drop", "truncate", "purge",
        "write", "modify", "overwrite", "update", "patch", "rename",
        "execute", "exec", "eval", "shell", "subprocess", "command",
        "send", "email", "post", "upload", "publish", "transfer",
        "purchase", "pay", "payment", "charge", "invoice",
        "credential", "secret", "token", "password", "apikey", "api_key",
        "sudo", "admin", "root", "privilege", "escalate",
        "arbitrary", "unrestricted", "any url", "external",
    }
)

_WORD_RE = re.compile(r"[a-z_]+")
_WS_RE = re.compile(r"\s+")


def normalize_description(text: str | None) -> str | None:
    """Collapse whitespace so reflows and re-indents are not scored as drift.

    Concatenated multi-line strings in TypeScript and re-wrapped docstrings in
    Python both produce cosmetic diffs constantly. Without this, the headline
    number would be dominated by formatting churn.
    """
    if text is None:
        return None
    return _WS_RE.sub(" ", text).strip()


def scope_terms(text: str | None) -> frozenset[str]:
    """Scope-expansion terms present in ``text``."""
    if not text:
        return frozenset()
    lowered = text.lower()
    words = set(_WORD_RE.findall(lowered))
    hits = {t for t in SCOPE_EXPANSION_TERMS if " " not in t and t in words}
    hits |= {t for t in SCOPE_EXPANSION_TERMS if " " in t and t in lowered}
    return frozenset(hits)


def description_is_material_change(before: str | None, after: str | None) -> bool:
    """True when two descriptions differ beyond whitespace."""
    return normalize_description(before) != normalize_description(after)
