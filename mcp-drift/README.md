# mcpdrift

Measures whether MCP servers change their tools' declared contract **after**
people have already approved them.

This is a one-week falsification experiment, not a product. It exists to answer
a single question cheaply, from public data, before any product gets built:

> When you approve an MCP tool, how long does that approval describe reality?

## Hypothesis under test

Tool poisoning — a tool's description or behaviour mutating after approval — is
a named primary threat in the [NSA/CISA MCP guidance][cisa]. Static MCP scanners
check a server's posture at a single point in time, so they cannot see this by
construction. If post-approval drift is common, there is a real and unserved
problem. If it is rare, there is not, and this direction should be dropped.

## Pre-registered decision rule

Fixed in `report.py` before any data was collected, so the outcome cannot be
rationalised afterwards. The headline metric is the share of **mature** servers
with at least one HIGH or MEDIUM event in the window:

| Drift rate | Verdict | Meaning |
| --- | --- | --- |
| `< 10%` | **KILL** | No meaningful post-approval drift. Thesis is dead. |
| `10–30%` | **INCONCLUSIVE** | Widen the sample or window. Do not squint at it. |
| `>= 30%` | **CONFIRM** | Drift is common. The pain is real. |

An empty sample reports `NO DATA`, never `KILL` — zero observations is not
evidence of absence.

## What counts as drift

Severity encodes the thesis, not generic churn. Only HIGH and MEDIUM reach the
headline number.

| Severity | Event | Why |
| --- | --- | --- |
| **HIGH** | `ANNOTATION_WEAKENED` | `readOnlyHint` revoked, `destructiveHint` set, `openWorldHint` opened. An unambiguous, machine-checkable privilege expansion. |
| **HIGH** | `SCOPE_LANGUAGE_ADDED` | Description gained capability language (delete, execute, send, credential…) it did not have before. |
| **MEDIUM** | `DESCRIPTION_CHANGED` | The text the user approved was rewritten. The tool-poisoning vector. |
| **MEDIUM** | `PARAMS_CHANGED`, `REQUIRED_PARAMS_ADDED`, `TOOL_RENAMED` | The agreed call contract moved. |
| **LOW** | `TOOL_ADDED`, `TOOL_REMOVED` | Surface changed, but visibly and without expanding reach. |

## Design decisions that keep the number honest

The easiest way for this experiment to lie is to count "we couldn't parse it" as
"nothing changed". Four guards against that:

1. **`None` never means empty.** A field that could not be statically extracted
   is `None`; `()` means we looked and found nothing. Python servers commonly
   write `inputSchema=Model.model_json_schema()` — a runtime call — so schemas
   are frequently invisible. Those tools are excluded from schema comparison
   rather than scored as unchanged.
2. **Failed extractions are excluded, not counted as clean.** A file containing
   a tool marker that yields no parsed tool is recorded as a failure. Servers
   where HEAD extraction fails are skipped entirely, with the reason printed.
3. **Empty-after-non-empty is treated as a parser miss.** A snapshot that loses
   every tool at once is far more likely a refactor we can't read than a server
   deleting its whole surface, so the comparison is skipped instead of emitting
   a false `TOOL_REMOVED` storm.
4. **Maturity floor.** Repos younger than `--min-age-days` (default 180) are
   excluded: churn during initial development is not post-approval drift.
   Repo age is read from the full commit graph, never a shallow clone's graft
   boundary.

Caveats that would undermine the headline — low extraction coverage, small
sample, mostly-invisible schemas — are computed and printed **next to the
verdict**, not in a footnote.

## Usage

```bash
python3 -m mcpdrift.cli --seeds seeds/servers.txt --window-days 90
```

Options: `--min-age-days` (maturity floor), `--max-snapshots` (commits examined
per server), `--limit`, `--jobs`. Writes `drift.json` (full event records) and
`drift.md` (the writeup).

Seed format, one per line:

```
https://github.com/owner/repo              # whole repo is one server
https://github.com/owner/repo#src/name     # monorepo: one server per subpath
```

## Before you trust a result

**The bundled seed list is a smoke test, not a sample.** It contains the seven
official reference servers, which are maintained by the protocol authors and are
therefore unrepresentative of the third-party servers the thesis is about.
Replace it with ~200 third-party servers sampled from a public registry, and
record the sampling method — selection belongs in the writeup, not a footnote.

## Known limitations

- **Static analysis only.** It reads declarations, not runtime behaviour. A
  server whose handler changes while its declaration stays fixed is invisible
  here. That gap is the product; this is the measurement.
- **Two languages.** Python and TypeScript/JavaScript. Go, Rust and Java servers
  are skipped, and they are skipped *visibly*.
- **Names may be symbolic.** `name=GitTools.STATUS` resolves at runtime; the
  symbol is tracked so a change is still caught, but the literal is unknown.
- **The scope-term lexicon is a judgement call.** It is tuned for precision, so
  it under-fires. A real widening can land as MEDIUM rather than HIGH — the
  `read_media_file` case below is exactly that, and the lexicon was deliberately
  *not* retuned to reclassify it.
- **Default-branch only**, no forks, no tags.

## Example finding

From a run over the reference servers — a genuine post-publication widening,
caught as `DESCRIPTION_CHANGED` on `read_media_file` (commit `97b70ee2`,
2026-07-06):

```
before: Read an image or audio file. Returns the base64 encoded data and MIME type.
after:  Read a file and return it as a base64-encoded content block with its MIME
        type. Image and audio files are returned as image/audio content; any other
        file type is returned as an embedded resource.
```

A tool approved for reading images now reads any file type. Nothing notified
anyone who had already approved it.

[cisa]: https://media.defense.gov/2026/Jun/02/2003943289/-1/-1/0/CSI_MCP_SECURITY.PDF
