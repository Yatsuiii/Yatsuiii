"""Pull checkable claims out of Confluence storage-format XHTML (§4)."""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import List, Sequence

_CDATA = re.compile(r"<!\[CDATA\[(.*?)\]\]>", re.S)
_TAG = re.compile(r"<[^>]+>")
_CODE_ELEMENT = re.compile(r"<(code|pre)\b[^>]*>(.*?)</\1>", re.S | re.I)
_WS = re.compile(r"\s+")
# A qualified name up to its first capitalised segment: org.apache.x.Foo
_FQCN = re.compile(r"(?<![\w.$])((?:[a-z][a-z0-9_]*\.)+[A-Z][A-Za-z0-9_]*)")
# Last segments that mean "file name", not "config key".
_FILE_SUFFIXES = frozenset({
    "xml", "jar", "sh", "cmd", "bat", "properties", "java", "scala", "py", "txt",
    "log", "html", "htm", "gz", "tgz", "tar", "zip", "json", "yaml", "yml", "conf",
    "cfg", "md", "class", "so", "dll", "exe", "war", "ear", "csv", "ini", "toml",
    "sql", "keytab", "jks", "pem", "crt", "key", "png", "jpg", "gif", "pdf",
})


@dataclass(frozen=True)
class Claim:
    kind: str
    value: str
    snippet: str
    in_code: bool


def storage_to_text(storage: str) -> str:
    """Visible text of a storage-format page, code macro bodies included."""
    pieces: List[str] = []
    last = 0
    for match in _CDATA.finditer(storage):
        pieces.append(_TAG.sub(" ", storage[last:match.start()]))
        pieces.append(" " + match.group(1) + " ")
        last = match.end()
    pieces.append(_TAG.sub(" ", storage[last:]))
    return html.unescape("".join(pieces))


def code_text(storage: str) -> str:
    """Only the text inside code macros, <code> and <pre> elements."""
    parts = [m.group(1) for m in _CDATA.finditer(storage)]
    parts += [_TAG.sub(" ", m.group(2)) for m in _CODE_ELEMENT.finditer(storage)]
    return html.unescape(" ".join(parts))


def _snippet(text: str, start: int, end: int, width: int = 80) -> str:
    return _WS.sub(" ", text[max(0, start - width): end + width]).strip()


def _config_pattern(prefix: str) -> "re.Pattern[str]":
    # Not preceded by a package, URL, e-mail or path; at least two segments
    # after the prefix; not cut mid-word (camelCase keys are skipped, not
    # truncated); not followed by ".Name" (a class reference) or "(".
    return re.compile(
        r"(?<![\w.\-/@:$])(" + re.escape(prefix)
        + r"[a-z0-9_\-]+(?:\.[a-z0-9_\-]+)+)(?![\w\-])(?!\.\w)(?!\()"
    )


def extract_claims(
    storage: str,
    class_prefixes: Sequence[str],
    class_exclude_prefixes: Sequence[str] = (),
    config_prefixes: Sequence[str] = (),
) -> List[Claim]:
    """Class and config-key claims in the project's namespaces, one per value."""
    text = storage_to_text(storage)
    code = code_text(storage)
    claims: List[Claim] = []
    seen = set()

    def add(kind: str, value: str, start: int, end: int) -> None:
        if (kind, value) in seen:
            return
        seen.add((kind, value))
        claims.append(Claim(kind, value, _snippet(text, start, end), value in code))

    for match in _FQCN.finditer(text):
        value = match.group(1)
        if not any(value.startswith(p) for p in class_prefixes):
            continue
        if any(value.startswith(p) for p in class_exclude_prefixes):
            continue
        add("class", value, match.start(1), match.end(1))

    for prefix in config_prefixes:
        for match in _config_pattern(prefix).finditer(text):
            value = match.group(1)
            if value.rsplit(".", 1)[1] in _FILE_SUFFIXES:
                continue
            add("config", value, match.start(1), match.end(1))
    return claims
