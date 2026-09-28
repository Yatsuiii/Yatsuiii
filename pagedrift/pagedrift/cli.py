"""pagedrift: select spaces, scan them, sample flags, and decide (see PREREGISTRATION.md)."""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

from . import rules
from .check import FLAGGED, NAMESPACE, check_claim
from .confluence import load_or_fetch
from .extract import extract_claims
from .filters import exclusion_reason
from .repo import build_index

BASE_URL = "https://cwiki.apache.org/confluence"
WORKSHEET_FIELDS = ["space", "page_id", "page_title", "url", "last_modified", "kind", "value",
                    "status", "detail", "snippet", "evidence", "verdict", "reason", "note"]


def _candidates(path: Path) -> Dict[str, dict]:
    return {c["project"]: c for c in json.loads(path.read_text(encoding="utf-8"))}


def cmd_select(args: argparse.Namespace) -> int:
    """§2.1 on metadata only: no page body is read, no claim is checked."""
    stats = []
    for name, cand in _candidates(args.candidates).items():
        row = {"project": name, "space": cand["space"], "pages": 0,
               "filtered_pages": 0, "recent_pages": 0, "error": None}
        try:
            pages = load_or_fetch(args.cache / "meta" / f"{cand['space']}.jsonl",
                                  BASE_URL, cand["space"], with_body=False)
        except Exception as exc:  # noqa: BLE001 - a missing space must not end selection
            row["error"] = f"{type(exc).__name__}: {exc}"
            stats.append(row)
            print(f"  {name:<11} error: {row['error']}", file=sys.stderr)
            continue
        kept = [p for p in pages if exclusion_reason(p) is None]
        row.update(pages=len(pages), filtered_pages=len(kept),
                   recent_pages=sum(rules.is_recent(p.last_modified) for p in kept))
        stats.append(row)
        print(f"  {name:<11} {row['pages']:>6} pages, {row['filtered_pages']:>6} kept, "
              f"{row['recent_pages']:>5} edited since {rules.RECENT_SINCE:%Y-%m-%d}",
              file=sys.stderr)
    selected = rules.select_spaces(stats)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"stats": stats, "selected": selected}, indent=2))
    print(f"\nselected: {', '.join(selected) or '(none)'}", file=sys.stderr)
    return 0


def _clone(repo: str, dest: Path) -> Path:
    if not (dest / ".git").exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--quiet", "--depth", "1", "--single-branch",
                        "--no-tags", f"https://github.com/{repo}.git", str(dest)], check=True)
    return dest


def cmd_scan(args: argparse.Namespace) -> int:
    selection = json.loads(args.selection.read_text())
    candidates = _candidates(args.candidates)
    args.out.mkdir(parents=True, exist_ok=True)
    scan_date = datetime.now(timezone.utc)
    per_space = []
    with open(args.out / "findings.jsonl", "w", encoding="utf-8") as out:
        for name in selection["selected"]:
            cand = candidates[name]
            repo_dir = _clone(cand["repo"], args.cache / "repos" / name)
            index = build_index(repo_dir)
            pages = load_or_fetch(args.cache / "pages" / f"{cand['space']}.jsonl",
                                  BASE_URL, cand["space"], with_body=True)
            kept = [p for p in pages if exclusion_reason(p) is None]
            claim_pages, flagged_pages, counts = 0, 0, defaultdict(int)
            for page in kept:
                checked, flagged = 0, False
                claims = extract_claims(page.body, cand["class_prefixes"],
                                        cand.get("class_exclude_prefixes", ()),
                                        cand.get("config_prefixes", ()))
                for claim in claims:
                    status, detail = check_claim(claim, index)
                    counts[f"{claim.kind}:{status}"] += 1
                    if status == NAMESPACE:
                        continue
                    checked += 1
                    flagged = flagged or status in FLAGGED
                    out.write(json.dumps({
                        "project": name, "space": cand["space"], "page_id": page.id,
                        "page_title": page.title, "url": page.url,
                        "last_modified": page.last_modified, "kind": claim.kind,
                        "value": claim.value, "status": status, "detail": detail,
                        "snippet": claim.snippet, "in_code": claim.in_code,
                    }) + "\n")
                claim_pages += checked > 0
                flagged_pages += flagged
            per_space.append({"project": name, "space": cand["space"], "repo": cand["repo"],
                              "repo_head": index.head, "pages": len(pages),
                              "filtered_pages": len(kept), "claim_pages": claim_pages,
                              "flagged_pages": flagged_pages, "claims": dict(counts)})
            print(f"  {name:<11} {len(kept):>5} pages kept, {claim_pages:>5} with claims, "
                  f"{flagged_pages:>4} flagged  (repo {index.head[:10]})", file=sys.stderr)
    summary = {
        "scan_date": scan_date.isoformat(),
        "spaces": per_space,
        "claim_pages": sum(s["claim_pages"] for s in per_space),
        "flagged_pages": sum(s["flagged_pages"] for s in per_space),
    }
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2))
    print(f"\n{summary['flagged_pages']}/{summary['claim_pages']} claim-bearing pages flagged",
          file=sys.stderr)
    return 0


def _read_jsonl(path: Path) -> List[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def cmd_sample(args: argparse.Namespace) -> int:
    flags = [f for f in _read_jsonl(args.findings) if f["status"] in FLAGGED]
    sample = rules.sample_flags(flags)
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=WORKSHEET_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for flag in sample:
            writer.writerow({**flag, "evidence": "", "verdict": "", "reason": "", "note": ""})
    print(f"sampled {len(sample)} of {len(flags)} flags -> {args.out}", file=sys.stderr)
    return 0


def cmd_evidence(args: argparse.Namespace) -> int:
    """Fill each worksheet row's evidence: case-insensitive hits anywhere in the repo."""
    with open(args.worksheet, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    projects = {s["space"]: s["project"] for s in json.loads(args.summary.read_text())["spaces"]}
    for row in rows:
        repo = args.cache / "repos" / projects[row["space"]]
        needle = row["value"] if row["kind"] == "config" else row["value"].rsplit(".", 1)[1]
        proc = subprocess.run(["git", "grep", "-i", "-I", "-l", "-F", needle],
                              cwd=str(repo), capture_output=True, text=True)
        hits = [h for h in proc.stdout.splitlines() if h]
        row["evidence"] = f"{len(hits)} file(s) mention {needle!r}" + (
            f": {'; '.join(hits[:3])}" if hits else "")
    with open(args.worksheet, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=WORKSHEET_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"evidence added to {len(rows)} rows", file=sys.stderr)
    return 0


def cmd_verdict(args: argparse.Namespace) -> int:
    summary = json.loads(args.summary.read_text())
    with open(args.worksheet, newline="", encoding="utf-8") as fh:
        verified = list(csv.DictReader(fh))
    result = rules.decide(summary["claim_pages"], summary["flagged_pages"], verified,
                          rules.parse_when(summary["scan_date"]))
    args.out.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(prog="pagedrift", description=__doc__)
    parser.add_argument("--candidates", type=Path, default=root / "candidates.json")
    parser.add_argument("--cache", type=Path, default=root / ".cache")
    results = root / "results"
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("select", help="§2.1 space selection from metadata only")
    p.add_argument("--out", type=Path, default=results / "selection.json")
    p = sub.add_parser("scan", help="extract and check claims in the selected spaces")
    p.add_argument("--selection", type=Path, default=results / "selection.json")
    p.add_argument("--out", type=Path, default=results)
    p = sub.add_parser("sample", help="§5 fixed-seed sample of flags into a worksheet")
    p.add_argument("--findings", type=Path, default=results / "findings.jsonl")
    p.add_argument("--out", type=Path, default=results / "worksheet.csv")
    p = sub.add_parser("evidence", help="add repository search evidence to the worksheet")
    p.add_argument("--worksheet", type=Path, default=results / "worksheet.csv")
    p.add_argument("--summary", type=Path, default=results / "summary.json")
    p = sub.add_parser("verdict", help="§6 kill rules on the verified worksheet")
    p.add_argument("--summary", type=Path, default=results / "summary.json")
    p.add_argument("--worksheet", type=Path, default=results / "worksheet.csv")
    p.add_argument("--out", type=Path, default=results / "verdict.json")
    return parser


def main(argv: List[str] = None) -> int:
    args = build_parser().parse_args(argv)
    return {"select": cmd_select, "scan": cmd_scan, "sample": cmd_sample,
            "evidence": cmd_evidence, "verdict": cmd_verdict}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
