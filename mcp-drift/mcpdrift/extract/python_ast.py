"""Extract MCP tool declarations from Python source using the stdlib AST.

Two declaration styles dominate the ecosystem:

1. Low-level SDK -- ``Tool(name=..., description=..., inputSchema=...)`` returned
   from a ``@server.list_tools()`` handler.
2. FastMCP -- a ``@mcp.tool()`` decorator on a function, where the function name
   and docstring become the tool name and description.

Real servers frequently write ``name=GitTools.STATUS`` and
``inputSchema=GitStatus.model_json_schema()``. Neither is a literal, so the
runtime value is genuinely invisible to static analysis. We record the symbol
(so a *change* of symbol is still caught) and leave params as ``None``.
"""

from __future__ import annotations

import ast

from ..models import ToolDef

_TOOL_CTORS = {"Tool", "types.Tool", "mcp.types.Tool"}
_DECORATOR_NAMES = {"tool", "add_tool"}
#: Markers that make a file worth parsing at all; keeps the scan cheap and lets
#: us distinguish "no tools here" from "parser failed on a file that had tools".
FILE_MARKERS = ("Tool(", ".tool(", "list_tools", "add_tool", "FastMCP")


def _callee_name(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_callee_name(node.value)}.{node.attr}"
    return ""


def _literal_str(node: ast.expr | None) -> str | None:
    """Return a string literal, folding ``"a" "b"`` and ``"a" + "b"``."""
    if node is None:
        return None
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        parts = [p.value for p in node.values
                 if isinstance(p, ast.Constant) and isinstance(p.value, str)]
        return "".join(parts) if parts else None
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = _literal_str(node.left), _literal_str(node.right)
        if left is not None and right is not None:
            return left + right
    return None


def _name_of(node: ast.expr | None) -> tuple[str | None, bool]:
    """Resolve a tool name node to ``(name, is_symbolic)``."""
    literal = _literal_str(node)
    if literal is not None:
        return literal, False
    if node is not None:
        symbol = _callee_name(node)
        if symbol:
            return symbol, True
    return None, False


def _annotations_of(node: ast.expr | None) -> dict[str, bool] | None:
    """Pull boolean hints from ``ToolAnnotations(...)`` or a dict literal."""
    if node is None:
        return None
    out: dict[str, bool] = {}
    if isinstance(node, ast.Call):
        for kw in node.keywords:
            if kw.arg and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, bool):
                out[kw.arg] = kw.value.value
    elif isinstance(node, ast.Dict):
        for key, value in zip(node.keys, node.values):
            k = _literal_str(key) if key is not None else None
            if k and isinstance(value, ast.Constant) and isinstance(value.value, bool):
                out[k] = value.value
    return out or None


def _schema_of(node: ast.expr | None) -> tuple[tuple[str, ...] | None, tuple[str, ...] | None]:
    """Extract ``(params, required)`` from an inputSchema dict literal.

    Returns ``(None, None)`` when the schema is a call such as
    ``Model.model_json_schema()`` -- genuinely not statically knowable.
    """
    if not isinstance(node, ast.Dict):
        return None, None
    params: tuple[str, ...] | None = None
    required: tuple[str, ...] | None = None
    for key, value in zip(node.keys, node.values):
        k = _literal_str(key) if key is not None else None
        if k == "properties" and isinstance(value, ast.Dict):
            names = [_literal_str(pk) for pk in value.keys if pk is not None]
            params = tuple(sorted(n for n in names if n))
        elif k == "required" and isinstance(value, (ast.List, ast.Tuple)):
            names = [_literal_str(e) for e in value.elts]
            required = tuple(sorted(n for n in names if n))
    return params, required


def _from_constructor(call: ast.Call, source_file: str) -> ToolDef | None:
    kwargs = {kw.arg: kw.value for kw in call.keywords if kw.arg}
    name_node = kwargs.get("name")
    if name_node is None and call.args:
        name_node = call.args[0]
    name, symbolic = _name_of(name_node)
    if not name:
        return None
    params, required = _schema_of(kwargs.get("inputSchema") or kwargs.get("input_schema"))
    return ToolDef(
        name=name,
        description=_literal_str(kwargs.get("description")),
        annotations=_annotations_of(kwargs.get("annotations")),
        params=params,
        required_params=required,
        source_file=source_file,
        name_is_symbolic=symbolic,
    )


def _is_tool_decorator(dec: ast.expr) -> ast.Call | ast.expr | None:
    target = dec.func if isinstance(dec, ast.Call) else dec
    tail = _callee_name(target).split(".")[-1]
    return dec if tail in _DECORATOR_NAMES else None


def _from_decorated_function(fn: ast.FunctionDef | ast.AsyncFunctionDef,
                             source_file: str) -> ToolDef | None:
    for dec in fn.decorator_list:
        if _is_tool_decorator(dec) is None:
            continue
        name, symbolic = fn.name, False
        description = ast.get_docstring(fn)
        annotations = None
        if isinstance(dec, ast.Call):
            kwargs = {kw.arg: kw.value for kw in dec.keywords if kw.arg}
            explicit, sym = _name_of(kwargs.get("name"))
            if explicit:
                name, symbolic = explicit, sym
            description = _literal_str(kwargs.get("description")) or description
            annotations = _annotations_of(kwargs.get("annotations"))
        args = fn.args
        positional = [a.arg for a in (*args.posonlyargs, *args.args, *args.kwonlyargs)
                      if a.arg not in ("self", "cls", "ctx", "context")]
        n_defaults = len(args.defaults) + sum(1 for d in args.kw_defaults if d is not None)
        required = tuple(sorted(positional[: max(0, len(positional) - n_defaults)]))
        return ToolDef(
            name=name,
            description=description,
            annotations=annotations,
            params=tuple(sorted(positional)),
            required_params=required,
            source_file=source_file,
            name_is_symbolic=symbolic,
        )
    return None


def extract(source: str, source_file: str) -> list[ToolDef]:
    """Return every tool declaration found in ``source``.

    Raises ``SyntaxError`` if the file does not parse; the caller records that as
    an extraction failure rather than as an absence of tools.
    """
    tree = ast.parse(source)
    found: list[ToolDef] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _callee_name(node.func) in _TOOL_CTORS:
            tool = _from_constructor(node, source_file)
            if tool:
                found.append(tool)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            tool = _from_decorated_function(node, source_file)
            if tool:
                found.append(tool)
    return found
