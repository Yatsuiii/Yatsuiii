"""Extract MCP tool declarations from TypeScript/JavaScript source.

No TS parser is available in the stdlib, so this walks the text with a small
string- and comment-aware scanner and does balanced-bracket slicing. That is
considerably more reliable than regex alone: tool descriptions routinely contain
braces, quotes and apostrophes, and zod schemas nest arbitrarily.

Handles the two shapes that appear in practice::

    server.registerTool("name", { description, inputSchema, annotations }, fn)
    { name: "x", description: "y", inputSchema: {...} }   // in a list_tools array
"""

from __future__ import annotations

import re

from ..models import ToolDef
from .heuristics import normalize_description

FILE_MARKERS = ("registerTool", ".tool(", "ListToolsRequestSchema", "setRequestHandler")

_REGISTER_RE = re.compile(r"\b(?:server|mcp|_server)?\.?(registerTool|tool)\s*\(")
_CONST_RE = re.compile(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+?)?=\s*")
_QUOTES = "\"'`"


def _skip_string(text: str, i: int) -> int:
    """Return the index just past the string literal starting at ``i``."""
    quote = text[i]
    i += 1
    while i < len(text):
        if text[i] == "\\":
            i += 2
            continue
        if text[i] == quote:
            return i + 1
        i += 1
    return i


def _skip_comment(text: str, i: int) -> int | None:
    if text.startswith("//", i):
        nl = text.find("\n", i)
        return len(text) if nl == -1 else nl
    if text.startswith("/*", i):
        end = text.find("*/", i)
        return len(text) if end == -1 else end + 2
    return None


def _find_balanced(text: str, start: int) -> int:
    """Given ``start`` at an opening bracket, return the index past its match."""
    pairs = {"(": ")", "{": "}", "[": "]"}
    opener = text[start]
    closer = pairs[opener]
    depth = 0
    i = start
    while i < len(text):
        ch = text[i]
        if ch in _QUOTES:
            i = _skip_string(text, i)
            continue
        skipped = _skip_comment(text, i)
        if skipped is not None:
            i = skipped
            continue
        if ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return -1


def _split_top_level(body: str, sep: str = ",") -> list[str]:
    """Split on ``sep`` occurrences that sit at bracket depth zero."""
    out: list[str] = []
    depth = 0
    start = 0
    i = 0
    while i < len(body):
        ch = body[i]
        if ch in _QUOTES:
            i = _skip_string(body, i)
            continue
        skipped = _skip_comment(body, i)
        if skipped is not None:
            i = skipped
            continue
        if ch in "({[":
            depth += 1
        elif ch in ")}]":
            depth -= 1
        elif ch == sep and depth == 0:
            out.append(body[start:i])
            start = i + 1
        i += 1
    out.append(body[start:])
    return [s for s in (part.strip() for part in out) if s]


def _object_fields(obj_text: str) -> dict[str, str]:
    """Parse a brace-delimited object literal into ``{key: raw_value}``."""
    inner = obj_text.strip()
    if inner.startswith("{"):
        inner = inner[1:-1] if inner.endswith("}") else inner[1:]
    fields: dict[str, str] = {}
    for part in _split_top_level(inner):
        head, sep, tail = _partition_top_level_colon(part)
        if not sep:
            continue
        key = head.strip().strip("\"'`")
        fields[key] = tail.strip()
    return fields


def _partition_top_level_colon(part: str) -> tuple[str, bool, str]:
    depth = 0
    i = 0
    while i < len(part):
        ch = part[i]
        if ch in _QUOTES:
            i = _skip_string(part, i)
            continue
        if ch in "({[":
            depth += 1
        elif ch in ")}]":
            depth -= 1
        elif ch == ":" and depth == 0:
            return part[:i], True, part[i + 1:]
        i += 1
    return part, False, ""


def _string_value(raw: str) -> str | None:
    """Resolve a (possibly ``+``-concatenated) string literal expression."""
    parts = [p.strip() for p in _split_top_level(raw, "+")]
    if not parts:
        return None
    chunks: list[str] = []
    for part in parts:
        if len(part) >= 2 and part[0] in _QUOTES and part[-1] == part[0]:
            chunks.append(part[1:-1])
        else:
            return None
    return "".join(chunks)


def _bool_fields(raw: str) -> dict[str, bool] | None:
    if not raw.strip().startswith("{"):
        return None
    out: dict[str, bool] = {}
    for key, value in _object_fields(raw).items():
        stripped = value.strip()
        if stripped in ("true", "false"):
            out[key] = stripped == "true"
    return out or None


def _schema_params(raw: str) -> tuple[tuple[str, ...] | None, tuple[str, ...] | None]:
    """Recover param names from a zod shape or a JSON-Schema object literal.

    ``SomeSchema.shape`` and other non-literal forms return ``(None, None)``:
    not visible, as opposed to empty.
    """
    stripped = raw.strip()
    if not stripped.startswith("{"):
        return None, None
    fields = _object_fields(stripped)
    if "properties" in fields or "type" in fields:
        props = fields.get("properties", "")
        params = tuple(sorted(_object_fields(props))) if props.strip().startswith("{") else None
        required_raw = fields.get("required", "")
        required = None
        if required_raw.strip().startswith("["):
            required = tuple(sorted(
                s.strip().strip("\"'`") for s in _split_top_level(required_raw.strip()[1:-1])
            ))
        return params, required
    params = tuple(sorted(fields))
    required = tuple(sorted(k for k, v in fields.items() if ".optional()" not in v))
    return params, required


def _tool_from_config(name: str, config: str, source_file: str,
                      symbolic: bool = False) -> ToolDef:
    fields = _object_fields(config)
    params, required = _schema_params(fields.get("inputSchema", ""))
    return ToolDef(
        name=name,
        description=normalize_description(_string_value(fields.get("description", ""))),
        annotations=_bool_fields(fields.get("annotations", "")),
        params=params,
        required_params=required,
        source_file=source_file,
        name_is_symbolic=symbolic,
    )


def const_bindings(source: str) -> dict[str, str]:
    """Map ``const X = <literal>`` names to their raw value text.

    Many servers factor declarations out of the call site::

        const name = "echo";
        const config = { description: "...", inputSchema: {...} };
        server.registerTool(name, config, handler);

    Without resolving these the call site is opaque and the whole file reads as
    having no tools, which would quietly depress extraction coverage on a large
    share of TypeScript servers.
    """
    bindings: dict[str, str] = {}
    for match in _CONST_RE.finditer(source):
        ident = match.group(1)
        start = match.end()
        if start >= len(source):
            continue
        ch = source[start]
        if ch in "{[":
            end = _find_balanced(source, start)
            if end != -1:
                bindings[ident] = source[start:end]
        elif ch in _QUOTES:
            end = _skip_string(source, start)
            bindings[ident] = source[start:end]
    return bindings


def _resolve(raw: str, bindings: dict[str, str]) -> str:
    """Substitute a bare identifier for its bound literal, if one is known."""
    stripped = raw.strip()
    return bindings.get(stripped, stripped)


def extract(source: str, source_file: str) -> list[ToolDef]:
    found: list[ToolDef] = []
    seen: set[str] = set()
    bindings = const_bindings(source)

    for match in _REGISTER_RE.finditer(source):
        open_paren = match.end() - 1
        close = _find_balanced(source, open_paren)
        if close == -1:
            continue
        args = _split_top_level(source[open_paren + 1: close - 1])
        if len(args) < 2:
            continue
        resolved_name = _resolve(args[0], bindings)
        name = _string_value(resolved_name)
        symbolic = name is None
        if symbolic:
            name = args[0].strip()
        config = next(
            (r for r in (_resolve(a, bindings) for a in args[1:])
             if r.startswith("{")),
            None,
        )
        if not name or config is None:
            continue
        tool = _tool_from_config(name, config, source_file, symbolic)
        if tool.name not in seen:
            seen.add(tool.name)
            found.append(tool)

    # Object-literal form: { name: "x", description: "y", ... }
    for match in re.finditer(r"\{\s*name\s*:", source):
        close = _find_balanced(source, match.start())
        if close == -1:
            continue
        fields = _object_fields(source[match.start(): close])
        name = _string_value(fields.get("name", ""))
        if not name or name in seen:
            continue
        if "description" not in fields and "inputSchema" not in fields:
            continue
        seen.add(name)
        found.append(_tool_from_config(name, source[match.start(): close], source_file))

    return found
