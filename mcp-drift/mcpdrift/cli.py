"""Command line entry point for the drift experiment."""

from __future__ import annotations

import argparse
import concurrent.futures
import sys
from pathlib import Path

from .analyze import ServerSpec, analyze_server
from .models import ServerReport
from .report import summarize, to_json, to_markdown


def load_seeds(path: Path) -> list[ServerSpec]:
    specs: list[ServerSpec] = []
    seen: set[tuple[str, str | None]] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        spec = ServerSpec.parse(line)
        if spec and (spec.url, spec.subpath) not in seen:
            seen.add((spec.url, spec.subpath))
            specs.append(spec)
    return specs


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mcpdrift",
        description="Measure post-publication drift in MCP tool declarations.",
    )
    parser.add_argument("--seeds", type=Path, default=Path("seeds/servers.txt"),
                        help="file of 'url' or 'url#subpath' lines")
    parser.add_argument("--workdir", type=Path, default=Path(".cache/repos"),
                        help="clone cache directory")
    parser.add_argument("--window-days", type=int, default=90,
                        help="observation window (default: 90)")
    parser.add_argument("--min-age-days", type=int, default=180,
                        help="maturity floor; younger repos are still in initial "
                             "development and are excluded (default: 180)")
    parser.add_argument("--max-snapshots", type=int, default=60,
                        help="cap on tool-touching commits examined per server")
    parser.add_argument("--limit", type=int, default=None,
                        help="only analyze the first N seeds")
    parser.add_argument("--jobs", type=int, default=6, help="parallel clones")
    parser.add_argument("--json-out", type=Path, default=Path("drift.json"))
    parser.add_argument("--markdown-out", type=Path, default=Path("drift.md"))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if not args.seeds.exists():
        print(f"seed file not found: {args.seeds}", file=sys.stderr)
        return 2

    specs = load_seeds(args.seeds)
    if args.limit:
        specs = specs[: args.limit]
    if not specs:
        print("no seeds to analyze", file=sys.stderr)
        return 2

    args.workdir.mkdir(parents=True, exist_ok=True)
    print(f"analyzing {len(specs)} servers over {args.window_days}d "
          f"(maturity floor {args.min_age_days}d)\n", file=sys.stderr)

    reports: list[ServerReport] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {
            pool.submit(
                analyze_server, spec, args.workdir,
                args.window_days, args.min_age_days, args.max_snapshots,
            ): spec
            for spec in specs
        }
        for done in concurrent.futures.as_completed(futures):
            spec = futures[done]
            try:
                report = done.result()
            except Exception as exc:  # noqa: BLE001 - one bad repo must not end the run
                report = ServerReport(server=spec.name, url=spec.url,
                                      subpath=spec.subpath,
                                      skip_reason=f"error: {type(exc).__name__}: {exc}")
            reports.append(report)
            if report.analyzable:
                mark = "DRIFT" if report.has_material_drift else "clean"
                print(f"  [{mark:5}] {report.server} "
                      f"({len(report.material_events)} material, "
                      f"{report.tools_at_head} tools)", file=sys.stderr)
            else:
                print(f"  [skip ] {report.server}: {report.skip_reason}", file=sys.stderr)

    reports.sort(key=lambda r: r.server)
    summary = summarize(reports)

    args.json_out.write_text(to_json(reports, summary), encoding="utf-8")
    markdown = to_markdown(reports, summary, args.window_days)
    args.markdown_out.write_text(markdown, encoding="utf-8")

    print("\n" + "=" * 60, file=sys.stderr)
    print(f"VERDICT: {summary.verdict}  "
          f"({summary.drifted}/{summary.analyzable} = {summary.drift_rate:.0%} drifted)",
          file=sys.stderr)
    print(f"wrote {args.json_out} and {args.markdown_out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
