"""Extractor tests, written against the declaration shapes real servers use."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mcpdrift.extract import python_ast, typescript  # noqa: E402


class TestPythonExtractor:
    def test_low_level_tool_constructor(self):
        src = '''
from mcp.types import Tool
def list_tools():
    return [Tool(
        name="read_file",
        description="Reads a file",
        inputSchema={"type": "object",
                     "properties": {"path": {"type": "string"},
                                    "encoding": {"type": "string"}},
                     "required": ["path"]},
    )]
'''
        (tool,) = python_ast.extract(src, "s.py")
        assert tool.name == "read_file"
        assert tool.description == "Reads a file"
        assert tool.params == ("encoding", "path")
        assert tool.required_params == ("path",)
        assert not tool.name_is_symbolic

    def test_symbolic_name_is_flagged_not_dropped(self):
        src = 'Tool(name=GitTools.STATUS, description="Shows status")'
        (tool,) = python_ast.extract(src, "s.py")
        assert tool.name == "GitTools.STATUS"
        assert tool.name_is_symbolic

    def test_runtime_schema_is_none_not_empty(self):
        """A pydantic-derived schema is invisible; None must not become ()."""
        src = 'Tool(name="x", description="d", inputSchema=GitStatus.model_json_schema())'
        (tool,) = python_ast.extract(src, "s.py")
        assert tool.params is None
        assert tool.required_params is None

    def test_tool_annotations_are_captured(self):
        src = ('Tool(name="x", description="d", '
               'annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False))')
        (tool,) = python_ast.extract(src, "s.py")
        assert tool.annotations == {"readOnlyHint": True, "destructiveHint": False}

    def test_fastmcp_decorator_uses_name_and_docstring(self):
        src = '''
@mcp.tool()
def search(query: str, limit: int = 10):
    """Search the index."""
'''
        (tool,) = python_ast.extract(src, "s.py")
        assert tool.name == "search"
        assert tool.description == "Search the index."
        assert tool.params == ("limit", "query")
        assert tool.required_params == ("query",)

    def test_implicit_concatenated_description(self):
        src = 'Tool(name="x", description="part one " "part two")'
        (tool,) = python_ast.extract(src, "s.py")
        assert tool.description == "part one part two"

    def test_syntax_error_propagates_for_caller_to_record(self):
        try:
            python_ast.extract("def f(:\n", "bad.py")
        except SyntaxError:
            return
        raise AssertionError("expected SyntaxError")


class TestTypeScriptExtractor:
    def test_register_tool_with_zod_schema(self):
        src = '''
server.registerTool(
  "read_text_file",
  {
    title: "Read Text File",
    description: "Read a file " +
      "as text.",
    inputSchema: { path: z.string(), tail: z.number().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  handler
);
'''
        (tool,) = typescript.extract(src, "i.ts")
        assert tool.name == "read_text_file"
        assert tool.description == "Read a file as text."
        assert tool.params == ("path", "tail")
        assert tool.required_params == ("path",)
        assert tool.annotations == {"readOnlyHint": True, "openWorldHint": False}

    def test_braces_inside_description_do_not_break_matching(self):
        src = '''
server.registerTool("fmt", {
  description: "Use {placeholders} like {this} in the template",
  inputSchema: { tpl: z.string() }
}, h);
'''
        (tool,) = typescript.extract(src, "i.ts")
        assert tool.description == "Use {placeholders} like {this} in the template"
        assert tool.params == ("tpl",)

    def test_non_literal_schema_reference_is_none(self):
        src = 'server.registerTool("x", { description: "d", inputSchema: ArgsSchema.shape }, h);'
        (tool,) = typescript.extract(src, "i.ts")
        assert tool.params is None

    def test_object_literal_list_tools_form(self):
        src = '''
const tools = [
  { name: "alpha", description: "First tool",
    inputSchema: { type: "object", properties: { a: {} }, required: ["a"] } }
];
'''
        (tool,) = typescript.extract(src, "i.ts")
        assert tool.name == "alpha"
        assert tool.params == ("a",)
        assert tool.required_params == ("a",)

    def test_apostrophe_in_double_quoted_description(self):
        src = """server.registerTool("x", { description: "the user's file", inputSchema: {} }, h);"""
        tools = typescript.extract(src, "i.ts")
        assert tools and tools[0].name == "x"

    def test_duplicate_declarations_are_not_double_counted(self):
        src = '''
server.registerTool("dup", { description: "one", inputSchema: {} }, h);
server.registerTool("dup", { description: "one", inputSchema: {} }, h);
'''
        assert len(typescript.extract(src, "i.ts")) == 1


class TestConstResolution:
    def test_name_and_config_declared_as_consts(self):
        src = '''
const name = "echo";
const config = {
  title: "Echo",
  description: "Echoes back the input",
  inputSchema: { message: z.string() }
};
server.registerTool(name, config, async (args) => {});
'''
        (tool,) = typescript.extract(src, "echo.ts")
        assert tool.name == "echo"
        assert tool.description == "Echoes back the input"
        assert tool.params == ("message",)
        assert not tool.name_is_symbolic

    def test_unresolvable_identifier_still_recorded_as_symbolic(self):
        src = "server.registerTool(nameFromElsewhere, { description: \"d\", inputSchema: {} }, h);"
        (tool,) = typescript.extract(src, "x.ts")
        assert tool.name_is_symbolic
