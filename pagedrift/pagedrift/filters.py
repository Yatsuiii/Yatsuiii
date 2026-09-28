"""Preregistered page filter (§3): keep pages that describe the current system."""

from __future__ import annotations

import re
from typing import Optional

from .confluence import Page

ISSUE_OR_PROPOSAL_ID = re.compile(r"\b[A-Z]{2,6}-\d+\b")
NON_DOC_WORDS = re.compile(
    r"\b(?:proposals?|design|meetings?|minutes|release\s+plans?|roadmaps?|"
    r"board\s+reports?|retrospectives?|archived?|deprecated|historical|"
    r"release\s+notes?|changelogs?|changes\s+in|how\s+to\s+release|gsoc|"
    r"summer\s+of\s+code|interviews?|status|votes?|voting|incubat\w*|"
    r"drafts?|brainstorm\w*|discussions?|ideas?)\b",
    re.IGNORECASE,
)


def exclusion_reason(page: Page) -> Optional[str]:
    """Why a page is excluded, or None to keep it. Ancestors count too."""
    for text in (page.title, *page.ancestors):
        if ISSUE_OR_PROPOSAL_ID.search(text):
            return f"issue/proposal id in {text!r}"
        match = NON_DOC_WORDS.search(text)
        if match:
            return f"{match.group(0).lower()!r} in {text!r}"
    return None
