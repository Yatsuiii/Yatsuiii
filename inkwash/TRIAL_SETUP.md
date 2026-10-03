# Giving 3–5 creators their own worlds, with Ripples working

*October 2026. Built and tested here against a fake runtime. One test copy is published, private
to you, with made-up examples only ("The test copy" below). Nobody has been invited.*

## In short

**Use the current runtime: one trial copy of Inkwash per creator, published as its own artifact.**

- A copy has its own store, so creators can't reach each other's worlds or yours.
- Inside a copy, a creator's worlds live under their own `data/users/<id>/`. Under the rules the
  copy is published with, the store shows that space to nobody else: not other visitors, and not
  you, the owner, even through Claude's data tools.
- **That's a storage rule, not a guarantee against you.** You can publish a new version of a copy
  at any time, and a new version can change its rules or its code. Either could expose a
  creator's worlds (see "What the rules protect, and what they don't"). So never tell a creator
  you *can't* read their worlds. Tell them the rules keep their worlds from you, and that you
  could change the copy.
- Claude's help (Ripples, inking, plates) runs on each creator's own Claude usage. claude.ai asks
  them before the first call.
- You pay nothing per call.

The trial page is `inkwash/v0/dist/inkwash-trial.html`, built by `node inkwash/v0/build.mjs`. It
has the same studio and the full loop: notes, Ripples, an answer kept in the canon, a scene inked
and set. It has the examples inside, and publishing is off.

**Never invite a creator, or anyone you don't fully trust, as an Editor on your own studio.**
Why is below.

## Does inviting someone as an Editor give them your studio or data?

**On your current studio artifact: in effect, yes.**

- **The store won't hand it over.** Your stored rules make `studio/` readable by the owner only.
  I checked this against the live store by reading as a viewer, a contributor and an Editor: all
  three get nothing back.
- **But an Editor can publish new versions of the page.** The page's code runs with your access
  whenever you open it. So an Editor could publish a page that copies your studio somewhere they
  can read, and it would run the next time you opened it. They could also replace the studio you
  use. Store rules can't prevent either.
- **Viewers and Commenters can't do that.** They see the reader view: published chapters and
  spoiler-safe lore. Nothing is published right now, so they would see an empty book.

**On a trial copy: no.**

- A copy is a separate artifact with its own store, and your worlds aren't in it.
- An Editor of a copy can change that copy's page and rules, which affects only that copy.
- That includes anything you save in it, your own space there too. So keep only made-up content
  in a copy you share.

Two platform rules matter here:

- An Editor invited from outside your organization keeps write access **only while the page
  isn't also shared by link**. Never turn on link sharing for a trial copy.
- Outside visitors otherwise hold view access and can't save anything, not even into their own
  `data/users/<id>/`. Each creator has to be invited by email as an Editor of their copy.

## Why one copy per creator, not one shared trial page

**One shared page is simpler:** one link, one republish per update. The store's rules would still
keep each creator's worlds from the others.

**But every creator would be an Editor of that one page.** Any one of them could publish a
changed page, or changed rules, that exposes the other creators' worlds. Separation would then
rest on trusting every creator, not just you.

**With one copy each, nobody shares a store with anyone.** The cost: you invite one person per
copy, and I republish each copy for an update.

## What's built

**The trial page.** `dist/inkwash-trial.html` (`window.INKWASH_TRIAL = {store: "self"}`):

- No reader view: everyone who can save gets a studio.
- Every store path is under `data/users/<their id>/home/`.
- Publishing and the reader preview are hidden.
- A banner says where the worlds live and who the published rules show them to. It also says the
  person who shared the copy could publish a new version that reads them, and that Claude's
  suggestions use the creator's own usage. You, as the owner, see a version addressed to you.
- When the platform gives a visit no id, it says so and saves nothing anywhere. It also says the
  other copy you could offer would let you read their worlds, and to switch only if they're happy
  with that.
- When a person can only view, the page says to ask for an Editor invite by email.
- Changes that can't be saved are refused, with a message, not lost silently.

**The fallback page.** `dist/inkwash-trial-shared.html` (`{store: "shared"}`) is for when a
creator's visit gets no id (see "Not yet checked"). It keeps their worlds in that copy's shared
storage instead. You, as the copy's owner, can read and change them there at any time, with no
new version needed. Its banner says so. Use it for a creator only once they've agreed to that.

**Tests.** Seven browser steps run against a fake store that enforces a trial copy's access
rules:

- one creator runs the whole loop, and every path her page reads or writes is under her own id;
- a second creator, and the owner, in the same store see none of her worlds, and their own work
  lands in their own space;
- she comes back to find her world as she left it;
- a world made in the offline preview moves into a creator's own copy through a backup, with
  its notes and where each fact came from;
- a visit without an id is turned away and nothing is saved;
- someone who can only view is told how to get in;
- the one-person copy saves to the copy's shared storage and says who can read it.

The full suite is 50 browser steps and 60 unit tests, all passing. Separately, the main studio
page was run against a copy of your live data and wrote nothing. That check isn't in the repo,
because it uses your data.

**Privacy of what's built.** Neither trial page contains anything from your worlds. Their names,
and every eight-word run of their text, were searched for in both pages, the other builds and
the whole git history: no matches.

**One name changed.** "Vellmere", a made-up town in the tests, looked like one of your private
place names, so it was renamed. The old spelling is in an earlier commit; it was never your
content.

## The rules each copy is published with

```json
{
  "db": { "rules": [
    { "path": "", "read": "owner", "write": "owner" },
    { "path": "data/users/{self}", "read": "interact", "write": "interact" }
  ] },
  "user": {}, "sample": {}, "downloads": {}
}
```

- **Nothing shared.** Nothing is written outside `data/users/`, and the root rule keeps any shared
  document to the owner.
- **Each person their own space.** Each creator reads and writes only their own
  `data/users/<id>/`, and nobody reads anyone else's: there's no rule at `data/users` that would
  open the siblings.
- **Fixed at publish.** A running page can't change these rules. They hold until a new version is
  published with different ones, by you or by an Editor of that copy.
- **The fallback copy** uses `[{ "path": "", "read": "admin", "write": "admin" }]` instead: the
  creator, as Editor, and you, as owner, read and write that copy's studio.

## What the rules protect, and what they don't

**What the store enforces while a copy stays as published:**

- A creator's `data/users/<id>/` can be read and written by that creator only. To anyone else,
  you included, it reads as if it didn't exist, through the page and through Claude's data tools
  alike. The platform's documentation for this runtime says so, and the fake store in the tests
  enforces it. On the real store, what I can check alone was checked after publishing the test
  copy (see "The test copy"). The rest needs your second account.
- Nothing else in a copy can be read or written by anyone but you, and the page writes nothing
  anywhere else.

**What they don't cover:**

- **A new version of the copy.** You can publish one at any time, and so can anyone who's an
  Editor of it, the creator included. A new version can:
  - change the rules: one rule at `data/users` would open every creator's space in that copy, to
    you, straight away, without them opening anything;
  - change the code, which runs with the creator's own access whenever they open the page, so it
    can read everything in their space.

  The platform doesn't stop either. Whether creators are told when a new version is published
  hasn't been checked.
- **The platform.** Worlds are stored on claude.ai. What Ripples and inking send goes to Claude
  under the creator's own account. Both fall under claude.ai's terms, not these rules.
- **Backups.** A backup file is the creator's, wherever they save it.

**So this is privacy by the rules, kept by your word, not a guarantee from the platform.** What
creators are told says exactly that:

- the rules keep their worlds from other visitors, and from you;
- you own the copy, and could change those rules or the page;
- you'll tell them before you publish a new version of it.

## The test copy (published 2026-10-03)

**https://claude.ai/artifact/76GitMowRjowobZd1vvXtn**, "Inkwash trial", Version 1. Private: only
you can open it, and nobody is invited.

- **The page:** `dist/inkwash-trial.html` as built at commit f112569. What's published is that
  file, byte for byte, inside the platform's standard wrapper. The commit after it fixes the main
  studio's reader view, which a trial copy never runs, so the test copy wasn't republished for it.
- **Content:** made-up examples only (The Hollow Moon, The Drained Sea). Its store was empty
  when published.
- **Runtime:** contract 0.2.67, the default for a new artifact. The page was tested against
  0.2.66. The parts it uses (db, user, sample, downloads) are identical in both; only
  `permissions` gained a call, which the page doesn't use.
- **Stored rules, as the artifact service holds them:** exactly the set above. Root: read owner,
  write owner. `data/users/{self}`: read interact, write interact. Plus user, sample and
  downloads.

**The rules, tested on the real store** with Claude's data tools acting at lower levels:

| Probe | Acting as | Expected | Got |
| --- | --- | --- | --- |
| Write a document in your own `data/users/<id>/` | Contributor | allowed | allowed |
| Read it back | Contributor, Editor | found | found |
| Read it | Viewer | hidden | not found |
| Write in your own space | Viewer | refused | the tool won't send a write at that level, so the server's answer wasn't tested |
| Write a shared document | Editor, Contributor | refused | refused by the server |
| Write a shared document | owner | allowed | allowed |
| Read that shared document | Editor | hidden | not found |
| List its collection | Contributor | empty | empty |
| Write in someone else's `data/users/<id>/` (a made-up id) | owner, full access | refused | refused |
| The shared `studio/` and `published/` | owner | empty | empty |

Both probe documents were deleted afterwards. The store is empty again.

**What this couldn't check:**

- **Reading another real person's space as the owner.** There was none to read. Even once your
  second account saves worlds, nobody can point a read at their space: their id isn't shown
  anywhere. What you can check is that nothing of theirs lands anywhere you can read (step 9
  below).
- **Anything that needs a second account:**
  - whether the Share menu offers Editor for an outside email;
  - whether that account gets an id;
  - how Claude's consent and usage behave for it.

**Your original studio is unchanged:** still Version 1790928792-0a4b, on contract 0.2.66, with
the same three rules and files.

## Testing with a second account

Use made-up content only. Once your second account is an Editor of the test copy, it could reach
anything you save there. The notes to paste are in `v0/test/fixtures/the-glass-orchard.md`, a
made-up world; the browser tests use the same file.

**Before you start:**

- A second claude.ai account of yours, with a different email. Note its plan (Free, Pro, Max…).
- A separate browser profile signed in to it, so your own account isn't signed in there. A
  private window works too.
- A laptop or desktop, in Chrome or Edge.

Write down what you see at each *Note*.

**1. Access**

1. As the second account, open the link before you invite it. You should be refused, because
   the copy is private. *Note what you see.*
2. As yourself, open the copy and click **Share**. Check that link sharing (general access) is
   off.
3. Invite the second email as **Editor**. Viewer and Commenter can't save anything. *Note
   whether the menu offers Editor for that email.*
4. As the second account, open the link from the invitation email.

**2. Identity**

You should see the welcome page under a **Trial copy.** banner that begins "Your worlds are saved
in your own space in this copy's storage."

- **"This page can't give you a private studio yet."** The platform gave this account no id.
  **Stop here and tell me.** Don't switch to the fallback copy. See "If the second account gets
  no id" below.
- **The banner begins "You own this copy."** That browser is signed in as you, not the second
  account.
- **A "Read-only." banner after your first change.** The account holds view access only: link
  sharing is on, or it was invited at a lower level. Stop and tell me.

**3. Bring in the notes**

1. Click **Bring in notes**, paste the notes and click **Read my notes**.
2. You should see everything it found, line by line, under seven entries, including Odile Marr,
   Quillhaven and The Chime Wardens.
3. Click **Add 11 facts to a new world**. The canon opens.

**4. Ripples**

In **Canon**, open **Odile Marr** and click **Ripples** under "She lost two fingers to a cracking
pear."

- The first time, claude.ai should ask the second account to let this page use Claude. Allow it.
  *Note whether it asked.*
- You should then see **What it breaks**, then **Where does it lead?**, with **My own idea** first
  and Claude's ways after it. This usually takes under a minute.
- If an error appears instead, *note its exact words.*

**5. Keep one of Claude's answers**

1. Click one of Claude's ways, then one of its answers. Edit it if you like.
2. Click **Add to …**. The fact appears in that entry, and History lists the step.

**6. Ink a scene**

1. Open **Score**. On the first scene of Chapter one, click **Ink this scene**.
2. The prose streams in. Then "Checking this scene against the canon…" runs.
3. If it lists a contradiction, click **Keep it as written**, or change the words.
4. Click **Set with your seal**. The seal appears.

*Note roughly how long the inking and the check took.*

**7. Close and come back**

1. Close the tab and wait at least 20 minutes.
2. Open the link again as the second account.

The world should open as you left it, with the answer you kept and the scene you set. A **Where
you left off** card should welcome you back. Come back sooner and there's no card; that's by
design.

**8. Back up**

Open **Book** and click **Back up this world**. claude.ai should ask before saving the file. Allow
it. `the-glass-orchard-backup.json` should download. *Note whether it did.*

**9. Check from your side**

1. As yourself, open the test copy. You should see only your own worlds, none of the second
   account's.
2. Tell me, and I'll check the store: the shared paths should still be empty, and your own space
   should hold none of its worlds.

**What to send me:** the second account's plan, and your notes from steps 1, 2, 4, 6, 7 and 8.

## If the second account gets no id

**Then this runtime can't give that person a space of their own in a copy.** Nothing is lost:
for such a visit, the page saves nothing anywhere.

**The only way around it on this runtime is the fallback copy** (`dist/inkwash-trial-shared.html`).
It is weaker:

- Their worlds go in the copy's shared storage. You can read and change them at any time,
  through the page or Claude's data tools, with no new version needed.
- So can anyone else you make an Editor of that copy, so it can only ever hold one creator.
- Its banner says so. Each creator would have to agree to it before you set one up.

**I won't publish one until you decide.** The alternatives:

- the preview only, for that person, without Claude;
- the standalone version below, at your cost.

## Runbook

1. **On yourself: the test copy.** It's published, above. Open it and run the loop with the
   made-up notes: bring them in, run Ripples, keep an answer, ink a scene and set it.
2. **With your second account:** the steps above. If it gets no id, stop.
3. **Per creator, only once step 2 has run the whole loop:**
   - I publish a copy for them.
   - You invite them by email as an Editor, with link sharing off.
   - You send them the invitation and guide from `CREATOR_TRIAL.md`, finished with what step 2
     showed.
4. **Updates:** I republish each copy from the same file, without passing capabilities, so its
   rules stay exactly as they are. Tell the creator before each one. Their worlds stay in the
   copy's store.
5. **When the test is done:** remove the second account from the test copy's Share menu, or keep
   it for later checks.

## Not yet checked (needs a real second account)

- That the Share menu offers **Editor** for an outside email on your plan. The artifact service
  says outside email invites are available; the level isn't stated.
- That an outside Editor gets a user id. The platform's own notes say a guest Editor "may have
  none". If not, the fallback page is the only way on this runtime, and it gives you read access,
  so it needs that creator's agreement.
- How `sample` behaves for creators on free plans. The platform may substitute a lower model
  tier or limit usage; the page shows the platform's error if a call is refused.

## If the runtime can't do it: the smallest standalone version (proposal only)

Only if step 2 fails for good, for example if outside creators can't be made Editors at all.

**What:**

- The offline file, which already keeps each creator's worlds in their own browser, plus a small
  server that forwards Claude's calls to the Claude API with your key.
- No accounts and no server-side storage: separation comes from each person's browser.
- Each creator gets an access code with a spending cap.
- The key never leaves the server, as in Dream Canvas.

**Work:** about a day or two, reusing the page's existing prompts and the Dream Canvas server's
security pattern.

**Running cost, paid by you.** From prompt sizes measured on worlds of 7–58 entries, and current
API list prices on Claude Opus 5.5 ($4 in / $20 out per million tokens; thinking is billed as
output). The thinking share is the uncertain part, so measure it on day one.

| Call | Size | Cost |
| --- | --- | --- |
| Ripples on a fact | about 1–4k tokens in; about 1k out plus thinking | about 4–10¢ |
| An inked scene, with its check | | about 10–20¢ |
| An active creator-week (30 Ripples, 10 scenes) | | about $3–6 |
| Five creators for two weeks | | about $30–60 |

Claude Sonnet 5.5 would be about half these figures, if quality holds. Set a hard cap well below
that before starting.

**Also:** hosting on a free tier, and a privacy notice. Creators' notes would pass through your
server to the Claude API.

**Not started.** It is a migration away from the supported runtime, so it waits for your
decision.
