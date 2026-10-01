# Outreach: 14 GitHub comments (text only, no calls)

> **Update 2026-10-01:** the business was killed (`../DECISION.md`). These comments are now
> **optional helpful replies, not a sales test**, and the decision rule below is retired. If you
> post any, the three incident comments are the most useful.

These go to the three incidents K1′ found, the ten "fence-builders" (people already hand-rolling
a guard), and one bonus: the "probable" case, where one answer also settles how it was coded.
Each comment gives one idea that is useful to *that* team whether or not they ever reply, and
asks **one** question. Nothing is pitched and nothing is linked, because first comments with
links read as spam and get ignored.

## Before posting

- **Pace it:** 2–3 a day, starting with the top of the list. Fourteen near-identical comments
  in an hour from one account looks like a campaign, even when each one is tailored.
- **Check the issue first.** If it was fixed or closed, add a first line such as "I know this is
  closed, but…", or skip it.
- **Edit freely into your own voice.** These are drafts, and they read better once they sound
  like you.
- **Keep the language plain and declarative.** Several of these repos have agents reading their
  issue threads, and a comment phrased as instructions can be treated as one.
- **When someone replies,** answer within a day and log it in `tracker.csv`. Share the
  stalefence repo only if they ask or clearly want it (see "Follow-ups" at the bottom).

## A proposed rule (edit it before posting if you disagree; then don't move it)

Out of the 14:

- **Continue:** at least 3 replies describe a real occurrence with a cost (time, a bad
  merge, a wrong message), **and** at least 1 asks to try the tool or shows how they'd use it.
- **Weak:** some replies, but all of them hypothetical, or "we fixed it with a CI check and
  it's fine". That means demand exists but is served by DIY, and the product would be a feature.
- **No signal:** fewer than 3 replies after 14 days. Silence on GitHub is weak evidence, so this
  leads to reconsidering the channel, not the idea.

## Priority order

1. Juli-AI#2036 (incident)
2. ScrapeX#664 (incident)
3. hermes-plugin-plow#139 (incident, systems)
4. PatchCTL#12 (is building the database version of this)
5. c8ctl-plugin-nano#240 (is building agent-side fencing)
6. safety-report#319 (probable incident; the answer settles the coding)
7. claude-deck#280
8. ai-agent-coordinator.rs#195
9. sshx#71
10. agency-website-drupal#1218
11. OpenBB#2045 (fork)
12. agent-memory#392
13. TorobRent#114
14. finch#365

---

### 1. thienphung00/Juli-AI#2036 (two sessions both took migration 061)

<https://github.com/thienphung00/Juli-AI/issues/2036>

> This was a really clear write-up, thanks. One thing that might help at reservation time, with no
> server involved: git can do an atomic "create only if absent" on the remote.
>
> `git push origin HEAD:refs/reservations/alembic/061 --force-with-lease=refs/reservations/alembic/061:`
>
> The empty lease means "this ref must not exist yet". If two sessions race for 061, exactly one
> push succeeds and the other is rejected and moves on to 062. Meta could reserve that way instead
> of deriving the number from main plus open PRs, and the CI heads check stays as the backstop.
>
> I've been looking at this failure class across repos where agent sessions run in parallel, and
> yours is one of the clearest cases. Besides migration numbers, what else do your concurrent
> sessions end up colliding on?

### 2. muhammadbayoumi/ScrapeX#664 (clean merge, NameError after main moved a constant)

<https://github.com/muhammadbayoumi/ScrapeX/issues/664>

> Great catch, and a nasty class: nothing for a reviewer to see. A cheap early signal that pairs
> well with `merge_tree_check`: intersect the files the branch touched with the files main changed
> since the branch's base (`git diff --name-only $(git merge-base HEAD origin/main) origin/main`).
> Here that is `scrapex/cli.py`, changed on both sides. That says "re-read this file before
> merging" even when the textual merge is clean, and the merge-tree run then settles it.
>
> I've been collecting cases like this from repos where agents work on branches in parallel. How
> do you make sure the check runs last, right before the merge? A hook, CI on the merge result,
> or the agent's instructions?

### 3. plow-pbc/hermes-plugin-plow#139 (assistant publicly retracted a real booking)

<https://github.com/plow-pbc/hermes-plugin-plow/issues/139>

> Really thorough post-mortem. The verify-before-reversal gate seems right, and it may be worth
> making it general. Any outbound message that asserts a state of the world ("booked",
> "cancelled", "sent") would be checked against the system that owns that state at send time,
> using a version or `updated_at` recorded when the agent last read it. If the version moved, or
> the claim has no provenance at all (like the mirrored turn), the agent re-reads instead of
> sending. That covers reversals, and also the other direction you mention: a stale claim
> re-asserted over a fresher correction.
>
> I'm researching exactly this failure class, agents acting on beliefs that changed elsewhere.
> Have you seen it outside reversals yet, for example a double booking or confirming something
> that was since cancelled?

### 4. hadoan/PatchCTL#12 (block stale patches at apply time)

<https://github.com/hadoan/PatchCTL/issues/12>

> Solid acceptance criteria, especially doing the final comparison under the same transaction as
> the writes. For externally edited tables without a trustworthy `updated_at`, Postgres's `xmin`
> system column is a cheap per-row version token, because it changes on every update. Read it
> with the snapshot, then `SELECT … FOR UPDATE` and compare inside the apply transaction. It is
> conservative (a no-op update bumps it too), which is the right side to err on. Hashing the whole
> row canonically is the portable fallback.
>
> I'm researching exactly this: agents applying changes planned against data that has since moved.
> What pushed stale-record detection to P0, a real overwrite or the agent-driven use case?

### 5. jwulf/c8ctl-plugin-nano#240 (fence agent git side effects below the supervisor)

<https://github.com/jwulf/c8ctl-plugin-nano/issues/240>

> This is the right layer for the fence. A small addition to the CAS half: the job's lease can
> record the branch head at acquisition, and every push uses
> `--force-with-lease=refs/heads/<branch>:<that sha>`. A preempted worker is then rejected even
> when its push would be a fast-forward. For a branch that doesn't exist yet, an empty lease
> (`--force-with-lease=refs/heads/<branch>:`) makes "create" exclusive too. That covers two
> workers creating the same branch name, which plain pushes don't.
>
> I'm researching this failure class, parallel agents clobbering each other's side effects. Has
> the double push actually happened in nano-workforce, or is it being designed out ahead of scale?

### 6. HPAC-Safety/safety-report#319 (ADR numbers taken three times in one afternoon)

<https://github.com/HPAC-Safety/safety-report/issues/319>

> Nice proposal. One race remains even with `--next` scanning every fetched remote branch: two
> sessions can compute the same next number before either one pushes. I know central reservation
> is out of scope. This version needs no server and only happens at the moment `--next` runs. It
> creates the number's ref with an atomic create-if-absent push, such as
> `git push origin HEAD:refs/adr-reservations/0090 --force-with-lease=refs/adr-reservations/0090:`.
> The empty lease means "must not exist", so exactly one session gets 0090 and the other retries
> with 0091.
>
> I'm researching collisions between parallel sessions. Out of curiosity, were the sessions that
> collided AI agents (Claude Code, Codex…), or people?

### 7. adrirubio/claude-deck#280 (re-confirm CI on the head before auto-merge)

<https://github.com/adrirubio/claude-deck/issues/280>

> For item 3, GitHub has a compare-and-swap for exactly this. The merge API takes `sha` (in the
> CLI, `gh pr merge --match-head-commit <sha>`) and refuses the merge if the PR head is no longer
> that commit. If the dispatcher passes the head SHA that CI-green and review were computed on, a
> stale green can't be auto-merged, even if the head moves between the re-confirm and the merge
> call.
>
> I'm researching stale-state failures in autonomous agent pipelines. Has the stale
> `ready_for_review` come up again since the tizonia run, or was that the only occurrence?

### 8. ORESoftware/ai-agent-coordinator.rs#195 (dual review, dismiss approvals on head drift)

<https://github.com/ORESoftware/ai-agent-coordinator.rs/issues/195>

> Binding receipts to the immutable head SHA is exactly right. One gap worth closing at merge time
> is to pass that same SHA to the merge call (`sha` in the REST merge API,
> `gh pr merge --match-head-commit`). Then GitHub itself refuses the merge if the head moved after
> the receipts were checked, so "dismiss approvals on head drift" holds even for a push that lands
> in the gap between check and merge.
>
> I'm researching stale-state failures in multi-agent pipelines. Has head drift after approval
> actually bitten you, or is it being designed out?

### 9. talkincode/sshx#71 (plan hash and `--expect-plan`)

<https://github.com/talkincode/sshx/issues/71>

> Plan integrity as P0 makes a lot of sense. One suggestion for which fields enter `plan_hash`:
> include the observed preconditions the plan depends on (for example `before_sha256` of the files
> `apply` will touch), and re-observe them at `--expect-plan` time. Then a host that drifted
> between dry-run and apply fails the check, not only changed inputs. Keep it to the facts the
> action depends on, though. Volatile host facts like uptime or unrelated packages would make
> every plan look stale.
>
> I'm researching agents acting on plans whose premises changed. Is there a specific incident
> behind this roadmap item, or is it preventive?

(The issue is mostly Chinese, but its terms and code are English, so English is fine. If they
reply in Chinese, a translation tool is fine too.)

### 10. E-merging-digital/agency-website-drupal#1218 ("stale-plan check immediately before mutation")

<https://github.com/E-merging-digital/agency-website-drupal/issues/1218>

> Nice PLAN/APPLY split. One detail that has mattered in similar setups: the stale-plan gate is
> strongest when it re-observes the same live facts the PLAN recorded (vhost hash, `settings.php`
> hash, token file metadata, release path) and compares them, in addition to the `main` SHA and
> digest. That catches the host drifting between PLAN and APPLY, not just the repo. You may well
> be doing this already.
>
> I'm studying stale-plan failures in agent-driven operations. What prompted the gate: a real APPLY
> that ran on a changed host, or foresight?

### 11. prajoria/OpenBB#2045 (claims with heartbeats for agent work items)

<https://github.com/prajoria/OpenBB/issues/2045>

> Useful fix. One race worth a test alongside pagination is two agents seeing the same item as
> stale and reclaiming it at the same moment. If the claim is a plain status write, both believe
> they own it. A conditional claim, which succeeds only if the item is still in the state the
> agent saw, means exactly one wins. A git ref created with an empty `--force-with-lease` is one
> cheap way to get that. The same goes for heartbeats: renew only while you still hold the claim,
> so a slow worker can't refresh a claim that was already reassigned.
>
> I'm researching coordination failures between parallel agents. Before the claim and heartbeat
> rules existed, did you have agents doubling up on the same item?

(This repo is a fork of OpenBB. Expect a slower reply.)

### 12. MythologIQ-Labs-LLC/agent-memory#392 ("stale pre-state refutes")

<https://github.com/MythologIQ-Labs-LLC/agent-memory/issues/392>

> Thoughtful design. One case to add to the negative controls: the pre-state changes after the
> evaluator verifies the transition but before `commit_bound_mutation` commits it. "Stale
> pre-state refutes" holds only if the final comparison runs in the same transaction or lock as
> the write. Otherwise a correction adjudicated against S can land on S′.
>
> I'm researching agents acting on state that changed underneath them. Is the stale-pre-state case
> one you've actually hit with corrections, or is it defensive design so far?

### 13. pooya79/TorobRent#114 (superseded-profile work cannot publish)

<https://github.com/pooya79/TorobRent/issues/114>

> Having "work started under a superseded profile cannot publish" as a rule up front is nice. What
> makes it hold is this: the run records the profile version and assignment state it started
> under, and the publish step re-reads and compares them in the same transaction as the catalog
> write. A check earlier in the run leaves a window. A test where the profile is superseded between
> extraction and publish exercises exactly that window.
>
> I'm researching automation acting on state that changed mid-run. How often do profiles change
> while runs are in flight: routinely, or rarely?

### 14. darwin-finch/finch#365 ("stale results cannot authorize edits")

<https://github.com/darwin-finch/finch/issues/365>

> The "stale results cannot authorize edits" rule is the right instinct. One design choice decides
> how often it fires: whether you check the generation of the spans an edit depends on, or of the
> whole document. With the whole document, any edit anywhere in the book invalidates every pending
> analysis, and people start bypassing the check. If each answer cites its source spans (as you
> plan), those spans are exactly the dependency set to re-verify at edit time.
>
> I'm researching agents acting on stale context. Was there a concrete case behind this rule, like
> an edit made from an analysis of an older draft?

---

## Follow-ups (only after a reply)

**If they describe a real occurrence**, thank them and ask one thing:

> That's really helpful, thank you. Roughly how often does it happen, and what does one cost you
> when it does? Mostly time to untangle, or has something wrong actually shipped?

**If they seem interested in a tool:**

> I've been building a small open-source guard for exactly this: it records what an agent read,
> blocks the push if any of it changed on main, and hands out numbers and task claims atomically
> using git refs. Happy to share it if you'd like to try it on your setup. I'd value hearing where
> it gets in the way.

**If they say "we solved it with X":** don't argue. Ask how often X still misses, and log X as
a competing approach in the tracker.
