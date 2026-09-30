# stalefence

Guards for repos where several AI agents work at once.

When two agent sessions share a repo, the dangerous moment is not the edit. It is the push,
made on a plan that was built from files that have since changed. stalefence keeps a
per-worktree ledger of what the agent read, and blocks the push or merge if the target branch
changed any of it. It also hands out shared numbers (migrations, ADRs) atomically and leases
tasks so two agents never pick the same one. No server: coordination happens through git refs
updated with compare-and-swap.

```
$ git push
stalefence: STALE. 1 thing(s) you relied on changed on origin/main since you looked:
  STALE file     app/cli.py: changed on origin/main since you read it
           04a7052 move BEHIND to app/db.py (demo, 0 seconds ago)
Next: fetch and rebase onto origin/main, re-read the files above, re-check the plan against
them, then retry. `stalefence check` confirms.
```

## Why

Built from real incidents found in a scan of 20,675 public GitHub issues
([method and results](../stalefence/K1P_RESULT.md)). Each one is reproduced in
`tests/test_incidents.py`:

| Incident | What happened | Guard |
| --- | --- | --- |
| [Juli-AI#2036](https://github.com/thienphung00/Juli-AI/issues/2036) | Two agent sessions both reserved migration 061 from the same `main`. The result was a forked migration history, and a conflicting PR that silently skipped CI. | `reserve`, plus the glob and sequence checks |
| [ScrapeX#664](https://github.com/muhammadbayoumi/ScrapeX/issues/664) | A Claude branch used a constant that `main` had just moved. Git merged cleanly, but the merged code raised `NameError`. | `check` (a file you read changed) and `merge-check` (test the real merge) |
| [safety-report#319](https://github.com/HPAC-Safety/safety-report/issues/319) | ADR numbers were taken by another session three times in one afternoon. | `reserve` |
| [hermes-plugin-plow#139](https://github.com/plow-pbc/hermes-plugin-plow/issues/139) | An assistant publicly retracted a real booking because it acted on a stale belief. | `stalefence.ledger` (outside git) |

The check's design comes from a replay study of agents working against a changing store
([day 2](../stalefence/DAY2_RESULT.md)):

- Conditional writes on the object being written stopped only a third of the silently wrong
  actions.
- Re-checking everything the agent had read caught them all, but aborted work unnecessarily
  1.8× as often as checking only what the action depended on.

So stalefence checks what you depend on, at file and glob granularity, and nothing else unless
you ask for `--strict`.

## Install

```sh
pip install ./stalefence-guard       # from a checkout; not on PyPI yet. Python 3.9+, git 2.38+
```

### With Claude Code

```sh
stalefence install claude --write     # merges hooks into .claude/settings.json
stalefence install git-hook           # optional: also guard pushes made outside Claude
```

- Every Read, Edit, Write and Glob is recorded as a premise.
- A new session starts with a clean ledger.
- Before `git push` or `gh pr merge`, the check runs. If anything the agent relied on moved,
  the command is blocked and the agent is told exactly what changed, so it re-reads and
  re-plans instead of shipping a stale plan.
- Run `stalefence install claude` without `--write` to just print the hook JSON.

### With any other agent (or people)

Install the git pre-push hook, and record reads explicitly where you know them:

```sh
stalefence install git-hook
stalefence read src/api.py 'migrations/versions/*.py'
git push                              # blocked if either changed on the target
```

Files your branch edits are always checked; no recording is needed for those.

## The guards

| Command | What it does |
| --- | --- |
| `stalefence check` | Fetches the target, then compares what you relied on with the target's current version. Exit 1 if anything moved. `--strict` also fails if the target moved at all; `--json` gives machine output. |
| `stalefence merge-check -- CMD` | Builds the exact commit a merge would produce (in a throwaway worktree, yours untouched) and runs `CMD` on it. For merges git calls clean that break anyway, e.g. a script that fails when `alembic heads` lists more than one head. |
| `stalefence reserve SEQ` | Prints the next free number in a sequence. The number is taken atomically: it is above everything on the target, on your branch and already reserved, so parallel sessions get distinct numbers. |
| `stalefence claim TASK [--ttl 2h]` | Leases a task. Others are refused until it expires or is released; claim again to renew. Expired leases can be taken over, atomically. |
| `stalefence status` / `reset` | Show or clear this worktree's premises. |
| `stalefence reservations` / `release` / `claims` / `unclaim` | Inspect and undo coordination state. |

```sh
N=$(stalefence reserve migrations)        # 061 for one session, 062 for the next
stalefence claim issue-42 --note "fixing login"
stalefence merge-check -- python -m pytest -q -x
```

## Configuration

Optional `.stalefence.json` at the repo root:

```json
{
  "target": "origin/main",
  "sequences": {
    "migrations": {"pattern": "migrations/versions/{n}_*.py", "width": 3},
    "adr": {"pattern": "docs/decisions/ADR-{n}-*.md", "width": 4}
  },
  "merge_check": "python -m pytest -q -x",
  "ignore": ["*.lock", "CHANGELOG.md"],
  "written": "block",
  "coordination": "auto"
}
```

- `target`: auto-detected from `origin/HEAD` when unset. It can also be set via `--target`,
  `STALEFENCE_TARGET` or `git config stalefence.target`. A local branch works for swarms that
  merge locally.
- `sequences`: numbered files. `check` flags a number your branch adds that the target already
  has, or that someone else reserved.
- `ignore`: churny files whose changes should never block.
- `written`: what to do when the target changed a file your branch edits: `block`, `warn` or
  `off`.
- `coordination`: where reservations and claims live. `local` is this machine's ref store,
  which every worktree shares. A remote name (default `origin`) works across machines.
- `guarded_commands`: regexes for the Bash commands that trigger the check. The default is
  `git push` and `gh pr merge`.
- `glob_limit`: the largest glob result the hooks will record (default 100).

## How the check decides

- **A premise is a version, not a timestamp.** When you read `app/cli.py`, stalefence records
  that file's blob as of your worktree's base (the merge-base with the target). The check
  compares it with the blob on the target now.
- **Rebasing does not refresh what you know.** After a rebase your files are current, but your
  plan was made from the old ones. Premises clear only when the file is read again.
- **Globs are premises too.** Listing `migrations/*.py` to pick the next number records the
  result set. A new file appearing upstream makes the check fail and names the new file. The
  hooks skip exploratory globs (any `**`, or more than `glob_limit` matches, default 100):
  nobody relies on the complete result of `**/*.ts`, and recording it would block on every new
  file. `stalefence read` records whatever you give it.
- **Files your branch edits are checked automatically.** If the target changed them since your
  base, you are told, even when git would merge cleanly.
- **A new file you create is a premise that the path is free.** If the target creates the same
  path, it is flagged.

## Design decisions

- **No server, no daemon.** Reservations and claims are refs under `refs/stalefence/`, created
  with `git push --force-with-lease=<ref>:` (an empty lease means "must not exist") or
  `git update-ref <ref> <new> ""`. Git makes the create or swap atomic, so a race has exactly one
  winner, and the loser moves to the next number or reports the holder. Metadata (owner,
  branch, expiry) lives in the commit message the ref points at.
- **Per-worktree ledgers** (`<git dir>/stalefence/`, which is separate for every worktree), so
  parallel agents in sibling worktrees never share premises.
- **Hooks fail open.** An internal error warns and allows; only a positive finding blocks.
  Bypass once with `STALEFENCE_SKIP=1` (or `git push --no-verify`).
- **Coordination pushes skip hooks** (`--no-verify`), so a stale worktree can still reserve,
  claim and release.
- **Stdlib only.** It shells out to git, with no dependencies.

## Limitations

- It can only check what it knows was read. Reads through shell commands (`cat`, `grep`) are not
  seen unless recorded with `stalefence read`. Claude Code's Read, Edit, Write and Glob tools
  are captured automatically; Grep is not, because its scope is usually the whole repo.
- Granularity is the file. A change elsewhere in a file you read still flags it. Symbol-level
  premises would cut those false alarms further.
- `merge-check` tests only committed work, and only what your command exercises.
- Coordination is tested against plain git remotes. Hosts generally accept custom ref namespaces
  (git-bug and git-appraise keep their data that way), but check that yours allows pushes
  outside `refs/heads`, or use `"coordination": "local"` for single-machine swarms. On GitHub the
  refs show up in `git ls-remote`, not in the web UI. Clean up landed numbers with
  `stalefence release`.
- Outside git, `stalefence.ledger.Premises` is a small in-process helper. You supply the
  versions (ETags, `updated_at`) and the verification call.

## Development

```sh
pip install -e '.[dev]' && pytest -q      # 37 tests; each builds real repos with a bare remote
sh examples/demo.sh                       # two agents, one repo, end to end
```

MIT licensed. Part of the [stalefence](../stalefence) research.
