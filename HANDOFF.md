# Handoff: stalefence and Inkwash (for Claude on Windows, starting with zero context)

You are picking up work that an earlier Claude session did in a Linux cloud container. This file
is the whole context you need. Where it says a number or a verdict, the repo contains the
evidence. Trust the repo over this file if they ever disagree, and tell Raghav when they do.

**Who you're working with.** Raghav Sharma (GitHub `Yatsuiii`), Bengaluru, who works on AI agent
reliability, evals and protocols.
- He tests startup ideas with **preregistered kill tests**: write the rule down, commit it, then
  run it, and report the verdict straight, without rounding up.
- He prefers **async, text-only** outreach: no calls.
- Keep replies short and plain.

> **Status update (2026-10-01): the business is killed.** Raghav decided stalefence won't be a
> company: people build their own guards, the pain is small, and platforms can ship it for free.
> See `stalefence/DECISION.md`. The research and the tool stay public as portfolio work. Don't
> treat the outreach as a sales test, and don't push publishing as a product. **Your main job now
> is helping screen the next idea** (section 5).

> **Later on 2026-10-01: the next idea is a creative product.** Its working name is **Inkwash**:
> - creators paint the shape of a story and the AI inks it in;
> - the world keeps its facts straight;
> - readers can visit;
> - creators can license their worlds to producers and game developers.
>
> The design is in `inkwash/DESIGN.md`. Raghav asked for the first slice to be built, and **v0 is
> built and published** as a private claude.ai artifact: https://claude.ai/artifact/TxYpHeRRTDSLLg9mPj3DeK.
> Its code, tests and the ways it differs from the design are in `inkwash/v0/` (start with its
> README). The next step is stage 0: Raghav builds a first world in it and shows it to ten fantasy
> readers. That first world, from one of Raghav's private game projects, is already loaded in the
> studio. **Keep that world's content out of this public repo.** It lives only in the artifact's
> private studio data, and its source docs say parts of the story must never be made public.
>
> Don't run it through the kill screen in `stalefence/DECISION.md`. That screen was written for
> business tools that sell relief from a pain, and Raghav pushed back on kill-testing this one
> before it exists. The design has its own stages and signals (its section 13).

> **Update (2026-10-03): Inkwash's next direction.** A release adds:
> - bringing notes in;
> - History with undo;
> - saving that survives a closed tab;
> - a "where you left off" card;
> - an offline copy of the studio for a ten-person creator trial.
>
> It's built and tested (60 unit tests, 43 browser steps) but **not yet republished**: the live
> artifact holds Raghav's private world, so republishing waits for his go-ahead. Start with
> `inkwash/NEXT_DIRECTION.md`, then `inkwash/CREATOR_TRIAL.md`. The test counts in the table
> below are from before this release.

---

## 1. Get the code (PowerShell)

```powershell
git clone https://github.com/Yatsuiii/Yatsuiii.git
cd Yatsuiii
git checkout claude/sleepy-bardeen-shw5sj
git log --oneline -5        # newest should mention "Inkwash"
```

- `main` holds only his GitHub profile README. **All of this work is on
  `claude/sleepy-bardeen-shw5sj`**, 40+ commits ahead of `main`. It has never been merged.
- Don't push to `main`, open PRs, or force-push without his explicit OK.

What's on the branch:

| Path | What it is | Status |
| --- | --- | --- |
| `stalefence/` | The research: three preregistered tests of the idea | Done (verdicts below) |
| `stalefence-guard/` | An open-source CLI, `stalefence`, kept as portfolio work (not a product) | Built, 37 tests pass on Linux, **untested on Windows** |
| `stalefence/outreach/` | 14 drafted GitHub comments plus a reply tracker | Drafted, none posted, **now optional** |
| `stalefence/DECISION.md` | Why the business was killed, what would reopen it, and the screen for the next idea | Read this first |
| `inkwash/DESIGN.md` | Design for the creative product: the brush, the canon and its ledgers, the library, the market, the architecture and the v0 scope | Design draft; open questions in its section 15 |
| `inkwash/v0/` | The first working version, a single-page claude.ai artifact, with 22 unit tests and 19 browser steps | Built and published (private) |
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

**Decision (2026-10-01): killed as a business**, as a judgment on top of the tests. See
`stalefence/DECISION.md`.

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

## 3. The tool: `stalefence-guard/`

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
- It also has the posting order, the pacing (2–3 per day) and follow-up templates. Its decision
  rule was **retired** when the business was killed.
- `tracker.csv` is where each post and reply gets logged.
- Status: nothing posted. Since 2026-10-01 these are **optional helpful replies, not a sales
  test**. If Raghav posts any, the three incident comments are the most useful.
- **Raghav posts these from his account.** You may post one for him only if he explicitly says
  so for that comment. Show him the final text first, then use
  `gh issue comment <url> --body-file <file>`. Check that the issue is still open before posting.

---

## 5. What to do next

The stalefence work is finished. In order:

1. **Inkwash.** Read `inkwash/DESIGN.md`, then `inkwash/v0/README.md`.
   - v0 is live, and Raghav's first world is loaded in it. Help Raghav through stage 0: write
     that world's first chapter and show it to ten fantasy readers. Never commit that world's
     content to this repo.
   - Fix what Raghav finds. Republish to the same artifact URL, and run both test suites first.
   - The design's open questions are in its section 15. The name is still a placeholder.
   - Don't apply the screen below to it.
2. **For any other new idea**, use the screen in `stalefence/DECISION.md`:
   1. Does a failure cost real money, to someone with a budget?
   2. Is it hard to build yourself, and not something a platform can ship as a free feature?
   3. Can buyers be reached in writing, with no calls?
   4. Can a kill test run from public data in under a week?

   Drop any idea that fails question 1 or 2 before building anything. For an idea that survives,
   write a preregistration with kill rules first, in its own folder, the way
   `stalefence/PREREGISTRATION.md` was done.
3. **Optional, only if he asks:**
   - get `stalefence-guard` green on Windows (section 6);
   - publish it as its own open-source repo: `git subtree split --prefix=stalefence-guard -b stalefence-guard`,
     then add `windows-latest` to `.github/workflows/test.yml`;
   - help him post the three incident comments as helpful replies (section 4).
4. **Optional:** before anyone relies on `reserve` or `claim` against GitHub, check that GitHub
   accepts the coordination refs. With his OK, use a throwaway private repo and two clones. If
   pushes to `refs/stalefence/*` are rejected, try `refs/notes/stalefence/*`.

What would reopen stalefence is listed in `DECISION.md`. Don't reopen it without one of those
signals.

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

1. What the next idea is.
2. Whether to publish `stalefence-guard` as its own open-source repo (as portfolio work), and
   whether to post any of the comments.
3. Whether to merge this branch into his profile repo's `main`. The research folders would then
   become public on the profile.
4. What Inkwash is called, which world to build first, and what changes after trying v0.

**Suggested first message to him:**
"I've read the handoff and tried Inkwash v0. Which world do you want to build first, and what
felt wrong when you used it?"
