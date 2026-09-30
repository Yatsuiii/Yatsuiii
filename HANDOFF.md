# Handoff: stalefence (for Claude on Windows, starting with zero context)

You are picking up work that an earlier Claude session did in a Linux cloud container. This file
is the whole context you need. Where it says a number or a verdict, the repo contains the
evidence. Trust the repo over this file if they ever disagree, and tell Raghav when they do.

**Who you're working with.** Raghav Sharma (GitHub `Yatsuiii`), Bengaluru, who works on AI agent
reliability, evals and protocols.
- He tests startup ideas with **preregistered kill tests**: write the rule down, commit it, then
  run it, and report the verdict straight, without rounding up.
- He prefers **async, text-only** outreach: no calls.
- Keep replies short and plain.

---

## 1. Get the code (PowerShell)

```powershell
git clone https://github.com/Yatsuiii/Yatsuiii.git
cd Yatsuiii
git checkout claude/sleepy-bardeen-shw5sj
git log --oneline -5        # newest should mention "stalefence-guard" and "K1'"
```

- `main` holds only his GitHub profile README. **All of this work is on
  `claude/sleepy-bardeen-shw5sj`**, 39 commits ahead of `main`. It has never been merged.
- Don't push to `main`, open PRs, or force-push without his explicit OK.

What's on the branch:

| Path | What it is | Status |
| --- | --- | --- |
| `stalefence/` | The research: three preregistered tests of the idea | Done (verdicts below) |
| `stalefence-guard/` | The product: an open-source CLI, `stalefence` | Built, 37 tests pass on Linux, **untested on Windows** |
| `stalefence/outreach/` | 14 drafted GitHub comments plus a reply tracker | Drafted, **none posted** |
| `mcp-drift/`, `pagedrift/`, `rewardhack/` | Earlier, unrelated kill tests (INCONCLUSIVE, KILLED, KILLED) | Finished, no action needed |

---

## 2. The idea, and what the tests said

**The idea ("stale-plan fencing", or "MVCC for AI agents").** An agent reads some state, plans,
then acts. If the state changed in between, the action silently does the wrong thing or clobbers
someone's work. The fix is to record the version of everything the action depends on, and
verify only those versions right before the action runs (a "dependency-scoped" check).

Three kill tests, all preregistered in `stalefence/PREREGISTRATION.md`:

| Test | Verdict | Key numbers | Write-up |
| --- | --- | --- | --- |
| **K2**: public GitHub study of Copilot coding-agent sessions | **INCONCLUSIVE, with a signal** | A human changed the task while the agent worked in **11.6%** of 164 linked sessions (95% CI 7.5–17.4). The placebo window before the agent started: 5.5%. Harm was unmeasurable because most PRs never resolve. All rates are **lower bounds**, because GH Archive captures only part of GitHub. | `stalefence/RESULT.md` |
| **Day 2**: replay of 40 real τ-bench customer-service agent runs against a changing store | **NO KILL**, but the harm is rare | Conditional writes on the written object stop only 31.6% of silently wrong actions. Re-checking the whole read set has **1.84×** the false aborts of the dependency-scoped check. Checks cost 163 ms against 295 s tasks. At the realistic change rate: **0.24 silently wrong actions per 1,000**, and about 31 unnecessary re-plans per catch. | `stalefence/DAY2_RESULT.md` |
| **K1′**: public-incident mining, replacing interviews | **PASS (weak)** | 20,675 candidate issues were found among 580,798 opened in 90 days, and a random 300 were hand-coded. **3 were real incidents**, which estimates **207** in 90 days (CI 70–599) against a kill bar of 10. About 3% of candidates show people hand-rolling fences themselves. | `stalefence/K1P_RESULT.md` |

**Overall.** The idea survived every kill test, but there is **no evidence yet that anyone would
pay**. The wedge is narrow:
- (a) several coding-agent sessions in one repo colliding: shared migration or ADR numbers,
  and merges that git calls clean but that break;
- (b) assistants acting on a belief that went stale elsewhere.

The three incidents, which everything below is built around:
- `thienphung00/Juli-AI#2036`: two agent sessions both took migration number 061. The result
  was a forked history, and a conflicting PR that silently skipped CI.
- `muhammadbayoumi/ScrapeX#664`: a Claude branch used a constant that `main` had just moved.
  Git merged cleanly, but the result raised `NameError`.
- `plow-pbc/hermes-plugin-plow#139`: an assistant publicly retracted a real booking because it
  was acting on a stale belief.

**Discipline to keep.** `PREREGISTRATION.md` §7 is an **append-only** deviation log.
- Any change to a frozen design gets a dated row before outcomes are looked at.
- A change that makes passing easier after seeing data is not allowed. Changes that make
  passing harder are allowed.

---

## 3. The product: `stalefence-guard/`

It's a CLI named `stalefence`: Python 3.9+, **stdlib only**, and it shells out to **git 2.38+**.
The name `stalefence` was free on PyPI and npm on 2026-09-30; `agentfence` is taken.

| Command | What it does |
| --- | --- |
| `stalefence check` | Fetches the target (default `origin/main`) and blocks (exit 1) if anything the agent read or is editing changed there since. `--strict` blocks on any movement at all; `--json` gives machine output. |
| `stalefence merge-check -- CMD` | Builds the exact merge result in a throwaway worktree and runs `CMD` on it. This catches the ScrapeX case. |
| `stalefence reserve SEQ` | Atomically hands out the next migration or ADR number. |
| `stalefence claim TASK --ttl 2h` | Leases a task so no other agent takes it. |
| `stalefence read`, `status`, `reset` | Records, shows or clears premises by hand. |
| `stalefence install claude --write` | Adds hooks to `.claude/settings.json` (see below). |
| `stalefence install git-hook` | Adds a pre-push hook that works for any agent. |

What the Claude Code hooks do:
- Record every Read, Edit, Write and Glob.
- Clear the ledger when a new session starts.
- Block `git push` and `gh pr merge` with exit code 2 when the check fails. The agent then sees
  exactly which commit changed which file.

How it works (the details that matter):
- **A premise is a file's blob at the worktree's base** (the merge-base with the target). The
  check compares it with the target now.
- **Rebasing does not clear a premise; re-reading the file does.** This is deliberate: after a
  rebase the files are current, but the plan was made from the old ones.
- **Globs are premises too.** A new upstream file matching `migrations/*.py` fails the check.
  Hooks skip exploratory globs (any `**`, or more than 100 matches).
- **Files the branch edits are checked automatically.**
- **Reservations and claims have no server.** They are refs under `refs/stalefence/`, created or
  swapped with `git push --force-with-lease=<ref>:<expected>` (an empty lease means "must not
  exist"), or with `git update-ref` for a single machine.
- **Hooks fail open.** Only a positive finding blocks.

Code map (`stalefence-guard/stalefence/`):

| Module | Contents |
| --- | --- |
| `git.py` | Plumbing wrapper |
| `config.py` | `.stalefence.json`, target resolution, globs |
| `premises.py` | The ledger and the check |
| `coord.py` | Reserve and claim, with local and remote stores |
| `mergecheck.py` | `merge-check` |
| `hooks.py` | Claude Code and pre-push hooks, plus the installers |
| `ledger.py` | Generic premises for systems other than git |
| `cli.py` | The command line |

The tests (`tests/test_incidents.py` and the others) build real repos with a bare remote and
reproduce the incidents. Run `examples/demo.sh` to see two agents end to end; it needs Git Bash.

**Known gaps:**
- Never run on Windows.
- Not published to PyPI.
- Coordination refs are tested only against local bare remotes, not GitHub. The cloud proxy
  allowed pushes to the session branch only.
- Granularity is the file.
- Reads made through shell commands (`cat`, `grep`) aren't seen unless recorded with
  `stalefence read`.

---

## 4. Outreach: `stalefence/outreach/`

- `COMMENTS.md` has 14 comments, each tailored to its issue: the 3 incidents, 10 "fence-builders"
  (people already hand-rolling a guard), and 1 "probable" incident (`HPAC-Safety/safety-report#319`,
  where the answer also settles whether those sessions were AI agents). Each gives one concrete
  useful idea and asks one question, with no pitch and no links.
- It also has the posting order, the pacing (**2–3 per day**), follow-up templates and a
  **proposed decision rule**. The rule: continue if at least 3 replies describe a real occurrence
  with a cost **and** at least 1 wants to try the tool. The weak and no-signal outcomes are
  defined there too.
- `tracker.csv` is where each post and reply gets logged.
- Status: **nothing posted yet** (as of 2026-09-30).
- **Raghav posts these from his account.** You may post one for him only if he explicitly says
  so for that comment. Show him the final text first, then use
  `gh issue comment <url> --body-file <file>`. Check that the issue is still open before posting.

---

## 5. What to do next, in order

1. **Get the guard green on Windows** (section 6). Set it up, run the 37 tests, and fix what
   breaks without weakening any test. Report to Raghav in two lines.
2. **Start the outreach with him.** On day 1, post comments #1–#3 from `COMMENTS.md` (the
   incidents) after he has edited them into his own voice. Log them in `tracker.csv`. On later
   days, 2–3 more per day. When replies arrive (he pastes them, or you read them with `gh` if he
   allows it), draft his answers using the follow-up templates.
3. **Verify the coordination refs on GitHub.** With his OK, create a throwaway **private** repo,
   then run `stalefence reserve` and `stalefence claim` against it from two clones.
   - If GitHub rejects pushes to `refs/stalefence/*`, change the namespace. `refs/notes/stalefence/*`
     is one candidate; test it.
   - Update the README either way.
4. **Prepare publishing, but only when he decides to.**
   - Split into its own repo (`git subtree split --prefix=stalefence-guard -b stalefence-guard`)
     and add `windows-latest` to `.github/workflows/test.yml`.
   - Build with `python -m build` and upload with `twine`. He creates the PyPI token; never write
     tokens into files or commits.
5. **After 14 days of outreach,** apply the decision rule as written and write the result in the
   same style as `K1P_RESULT.md`.
6. **Backlog, only if demand shows up:**
   - symbol-level premises, which cut false blocks when an unrelated part of a file changes;
   - capturing Grep reads;
   - integrations for Codex and Cursor;
   - fencing for systems other than git (tickets, CRM, deploys via ETags). That is where the
     original thesis is strongest.

Things **not** to redo:
- Don't re-mine GH Archive; it takes hours and the results are committed.
- Don't re-code the 300 issues; every decision is published in `stalefence/results/k1p/CODED.md`.
- Don't edit frozen rules.

---

## 6. Windows set-up and likely snags

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1       # if blocked: Set-ExecutionPolicy -Scope Process Bypass
pip install -e ".\stalefence-guard[dev]"
git --version                      # needs 2.38+ for merge-check
cd stalefence-guard
python -m pytest -q                # Linux result: 37 passed
stalefence --version               # 0.1.0
```

Where it's most likely to break, checked by reading the code (none of it has run on Windows):
- **Path prefix checks.** `premises.relpath` and `premises.anchor_glob` compare real paths with
  `startswith(root + os.sep)`. On Windows that can fail when a path differs only in case, or in
  drive-letter form. Wrapping both sides in `os.path.normcase` is the likely fix.
- **The pre-push test's shim.** The `shim` fixture in `tests/conftest.py` writes an extensionless
  `#!/bin/sh` script. Git for Windows runs hooks through its bundled `sh`, which should find it,
  but if `test_git_pre_push_hook` fails, look here first. The real hook calls `stalefence`, which
  resolves to the pip-installed `stalefence.exe`.
- **No file lock.** `fcntl` doesn't exist on Windows, so the ledger lock is a no-op (writes are
  still atomic `os.replace`). Two parallel hook calls could, rarely, drop a premise. An
  `msvcrt.locking` fallback would close that.
- **Line endings.** With `core.autocrlf=true` (the Git for Windows default), tests should still
  pass. If anything that compares blobs misbehaves, set `core.autocrlf false` in the test repos
  in `conftest.py`.
- **`merge-check` with a string command** runs through `cmd.exe` (`shell=True`).
- **Claude Code hooks on Windows.** Confirm `stalefence` is on PATH for the hook shell. Then, in a
  scratch repo: run `stalefence install claude --write`, read a file, change it from a second
  clone, and try `git push` in a Claude session. It should be blocked with a clear reason.

**The research code** (`stalefence/pipeline`, `k1p`, `day2`) contains Linux paths. For example,
`day2/taubench.py` expects τ-bench (`sierra-research/tau-bench` at `59a200c`) in
`/home/user/sierra-research/tau-bench`. It needs `orjson`, `numpy`, `scipy` and `pytest`. You
shouldn't need to rerun any of it; the 22 research tests in `stalefence/tests` can run if you
want to check.

---

## 7. Ground rules

- **Report outcomes plainly.** That includes failed tests, skipped steps and weak signals.
  Raghav wants the verdict, not reassurance.
- **Ask first before anything outward-facing or hard to undo:** posting comments, creating repos,
  publishing packages, pushing to `main`, merging, or deleting.
- **Keep the kill-test discipline for any new test:**
  1. write the rule;
  2. commit it before looking at data;
  3. log deviations in §7;
  4. report against the rule.
- **Follow your own harness's rules for commit attribution.** Earlier commits on this branch
  carry a `Co-Authored-By` trailer.

## 8. Decisions that are Raghav's

1. Does he post the comments himself, or does he approve you posting each one?
2. Should `stalefence-guard` become its own public repo and a PyPI package, and when?
3. Should this branch be merged into his profile repo's `main`? The research folders would then
   become public on the profile.
4. What would change his mind? Suggested: the outreach decision rule after 14 days.

**Suggested first message to him, once section 6 is done:**
"stalefence on Windows: N/37 tests pass (fixed: …). Ready to post the first 3 comments. Want to
edit them first, or should I show them one by one?"
