"""stalefence command line."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

from . import __version__, coord, hooks, premises
from .config import Config, resolve_target
from .git import GitError, NotARepo, Repo
from .mergecheck import merge_check


def _ctx(args):
    repo = Repo.discover()
    cfg = Config.load(repo)
    return repo, cfg, resolve_target(repo, cfg, getattr(args, "target", None))


def cmd_read(args) -> int:
    repo, cfg, target = _ctx(args)
    here = os.getcwd()
    for item in args.paths:
        if any(c in item for c in "*?["):
            key = premises.record_glob(repo, target, item, source="cli", cwd=here)
            print(f"glob {key}" if key else f"skipped {item} (outside this worktree)")
        else:
            got = premises.record_files(repo, target, [item], source="cli", cwd=here)
            print(f"file {got[0]}" if got else f"skipped {item} (outside this worktree)")
    return 0


def cmd_check(args) -> int:
    repo, cfg, target = _ctx(args)
    reservations = me = None
    if cfg.sequences and not args.no_fetch:
        try:
            st = coord.store(repo, cfg)
            reservations, me = coord.reservations(st), coord.owner(repo)
        except Exception as e:  # noqa: BLE001
            print(f"stalefence: warning: could not read reservations ({e})", file=sys.stderr)
    report = premises.check(repo, cfg, target, fetch=not args.no_fetch, strict=args.strict,
                            reservations=reservations, me=me)
    print(json.dumps(report.as_dict(), indent=1) if args.json else report.text())
    return 1 if report.stale else 0


def cmd_status(args) -> int:
    repo = Repo.discover()
    data = premises.load(repo)["premises"]
    if args.json:
        print(json.dumps(data, indent=1, sort_keys=True))
        return 0
    if not data:
        print("no premises recorded in this worktree")
        return 0
    now = time.time()
    for _, p in sorted(data.items()):
        seen = f"{len(p['value'])} match(es)" if p["kind"] == "glob" else (p["value"] or "absent")[:12]
        print(f"{p['kind']:5s} {p['key']}  base {p['base'][:12]}  {seen}  "
              f"({p['source']}, {int(now - p['at'])}s ago)")
    return 0


def cmd_reset(args) -> int:
    repo = Repo.discover()
    if args.keys:
        print(f"forgot {premises.forget(repo, set(args.keys))} premise(s)")
    else:
        print(f"cleared {premises.reset(repo)} premise(s)")
    return 0


def cmd_merge_check(args) -> int:
    repo, cfg, target = _ctx(args)
    if target.remote and not args.no_fetch:
        ok, err = repo.fetch(target.remote, target.refspec())
        if not ok:
            print(f"stalefence: warning: could not fetch {target.ref} ({err}); using the local copy",
                  file=sys.stderr)
    t = repo.rev_parse(target.ref)
    command = args.command or cfg.merge_check
    res = merge_check(repo, target.ref, t, command=command or None, timeout=args.timeout)
    print(res.text())
    return 0 if res.ok else 1


def cmd_reserve(args) -> int:
    repo, cfg, target = _ctx(args)
    st = coord.store(repo, cfg, args.store)
    if target.remote and not args.no_fetch:
        repo.fetch(target.remote, target.refspec())
    n, text = coord.reserve(repo, cfg, st, args.sequence, repo.rev_parse(target.ref), start=args.min)
    print(text)
    print(f"stalefence: reserved {args.sequence} {text} in the {st.kind} store", file=sys.stderr)
    return 0


def cmd_reservations(args) -> int:
    repo = Repo.discover()
    cfg = Config.load(repo)
    st = coord.store(repo, cfg, args.store)
    res = coord.reservations(st, args.sequence)
    if args.json:
        print(json.dumps({k: {str(n): o for n, o in v.items()} for k, v in res.items()}, indent=1))
        return 0
    for seq, held in sorted(res.items()):
        for n, who in sorted(held.items()):
            print(f"{seq} {coord.format_number(cfg, seq, n)}  {who}")
    return 0


def cmd_release(args) -> int:
    repo = Repo.discover()
    st = coord.store(repo, Config.load(repo), args.store)
    ok = coord.release(repo, st, args.sequence, args.number, force=args.force)
    print(f"released {args.sequence} {args.number}" if ok else f"{args.sequence} {args.number} was not reserved")
    return 0 if ok else 1


def cmd_claim(args) -> int:
    repo = Repo.discover()
    st = coord.store(repo, Config.load(repo), args.store)
    ok, meta, action = coord.claim(repo, st, args.task, coord.parse_ttl(args.ttl), note=args.note or "")
    if ok:
        until = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(meta["expires_at"]))
        print(f"{action} {args.task} until {until} as {meta['owner']}")
        return 0
    left = meta.get("expires_at", 0) - coord.now()
    print(f"{args.task} is claimed by {meta.get('owner', '?')} for another {max(0, int(left))}s"
          + (f" ({meta['note']})" if meta.get("note") else ""), file=sys.stderr)
    return 1


def cmd_unclaim(args) -> int:
    repo = Repo.discover()
    st = coord.store(repo, Config.load(repo), args.store)
    ok = coord.unclaim(repo, st, args.task, force=args.force)
    print(f"released {args.task}" if ok else f"{args.task} was not claimed")
    return 0 if ok else 1


def cmd_claims(args) -> int:
    repo = Repo.discover()
    st = coord.store(repo, Config.load(repo), args.store)
    rows = coord.claims(st)
    if args.json:
        print(json.dumps(rows, indent=1))
        return 0
    for c in rows:
        state = "expired" if c["expired"] else f"{int(c.get('expires_at', 0) - coord.now())}s left"
        print(f"{c['task']}  {c.get('owner', '?')}  {state}" + (f"  {c['note']}" if c.get("note") else ""))
    return 0


def cmd_hook(args) -> int:
    if args.kind == "claude":
        return hooks.claude()
    return hooks.pre_push(args.rest)


def cmd_install(args) -> int:
    repo = Repo.discover()
    if args.what == "claude":
        out = hooks.install_claude(repo, write=args.write)
        print(f"added stalefence hooks to {out}" if args.write else out)
    else:
        print(f"installed {hooks.install_git_hook(repo, force=args.force)}")
    return 0


def build() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="stalefence", description=(
        "Guards for repos where several agents work at once: block publishing work whose "
        "premises changed underneath it, reserve shared numbers atomically, lease tasks."))
    ap.add_argument("--version", action="version", version=f"stalefence {__version__}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def add(name, fn, help_):
        p = sub.add_parser(name, help=help_, description=help_)
        p.set_defaults(fn=fn)
        return p

    def store_opt(p):
        p.add_argument("--store", help="where coordination refs live: local, or a remote name "
                                        "(default: origin if present, else local)")

    p = add("read", cmd_read, "record files or globs you relied on (the hooks do this automatically)")
    p.add_argument("paths", nargs="+")
    p.add_argument("--target")

    p = add("check", cmd_check, "has anything you relied on changed on the target? exit 1 if so")
    p.add_argument("--target")
    p.add_argument("--no-fetch", action="store_true", help="use the local copy of the target")
    p.add_argument("--strict", action="store_true", help="also fail if the target moved at all")
    p.add_argument("--json", action="store_true")

    p = add("status", cmd_status, "list the premises recorded in this worktree")
    p.add_argument("--json", action="store_true")

    p = add("reset", cmd_reset, "forget recorded premises (all, or the given paths/globs)")
    p.add_argument("keys", nargs="*")

    p = add("merge-check", cmd_merge_check, "test the real merge result: stalefence merge-check -- pytest -q")
    p.add_argument("--target")
    p.add_argument("--no-fetch", action="store_true")
    p.add_argument("--timeout", type=float)
    p.add_argument("command", nargs=argparse.REMAINDER)

    p = add("reserve", cmd_reserve, "atomically take the next free number in a sequence (prints it)")
    p.add_argument("sequence")
    p.add_argument("--min", type=int, help="never hand out a number below this")
    p.add_argument("--target")
    p.add_argument("--no-fetch", action="store_true")
    store_opt(p)

    p = add("reservations", cmd_reservations, "list reserved numbers")
    p.add_argument("sequence", nargs="?")
    p.add_argument("--json", action="store_true")
    store_opt(p)

    p = add("release", cmd_release, "give a reserved number back")
    p.add_argument("sequence")
    p.add_argument("number", type=int)
    p.add_argument("--force", action="store_true", help="release someone else's reservation")
    store_opt(p)

    p = add("claim", cmd_claim, "lease a task so no other agent takes it (renew by claiming again)")
    p.add_argument("task")
    p.add_argument("--ttl", default="2h", help="lease length, e.g. 30m, 2h (default 2h)")
    p.add_argument("--note")
    store_opt(p)

    p = add("unclaim", cmd_unclaim, "release a task lease")
    p.add_argument("task")
    p.add_argument("--force", action="store_true")
    store_opt(p)

    p = add("claims", cmd_claims, "list task leases")
    p.add_argument("--json", action="store_true")
    store_opt(p)

    p = add("hook", cmd_hook, "hook entry points (claude reads hook JSON on stdin; pre-push is for git)")
    p.add_argument("kind", choices=["claude", "pre-push"])
    p.add_argument("rest", nargs=argparse.REMAINDER)

    p = add("install", cmd_install, "set up hooks: `install claude [--write]` or `install git-hook`")
    p.add_argument("what", choices=["claude", "git-hook"])
    p.add_argument("--write", action="store_true", help="merge into .claude/settings.json instead of printing")
    p.add_argument("--force", action="store_true", help="replace an existing pre-push hook")
    return ap


def main(argv=None) -> int:
    args = build().parse_args(argv)
    if getattr(args, "command", None) and args.command[:1] == ["--"]:
        args.command = args.command[1:]
    try:
        return args.fn(args)
    except (NotARepo, ValueError, PermissionError, FileExistsError, RuntimeError, GitError,
            subprocess.TimeoutExpired) as e:
        print(f"stalefence: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
