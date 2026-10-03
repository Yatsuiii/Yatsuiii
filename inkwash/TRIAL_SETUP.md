# Giving 3–5 creators their own worlds, with Ripples working

*October 2026. Built and tested here against a fake runtime. Nothing has been published, and
nobody has been invited.*

## In short

**Use the current runtime: one trial copy of Inkwash per creator, published as its own artifact.**

- A copy has its own store, so creators can't reach each other's worlds or yours.
- Inside a copy, a creator's worlds live under their own `data/users/<id>/`. The platform keeps
  that part of the store from everyone else, you (the owner) included.
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
- An Editor of a copy can change that copy's page, which affects only that copy.

Two platform rules matter here:

- An Editor invited from outside your organization keeps write access **only while the page
  isn't also shared by link**. Never turn on link sharing for a trial copy.
- Outside visitors otherwise hold view access and can't save anything, not even into their own
  `data/users/<id>/`. Each creator has to be invited by email as an Editor of their copy.

## Why one copy per creator, not one shared trial page

**One shared page is simpler:** one link, one republish per update. Each creator's worlds would
still be private to them in normal use.

**But every creator would be an Editor of that one page.** Any one of them could publish a
changed page that copies the other creators' worlds when they next open it. Separation would
then rest on trust, not on the platform.

**With one copy each, nobody shares a store with anyone.** The cost: you invite one person per
copy, and I republish each copy for an update.

## What's built

**The trial page.** `dist/inkwash-trial.html` (`window.INKWASH_TRIAL = {store: "self"}`):

- No reader view: everyone who can save gets a studio.
- Every store path is under `data/users/<their id>/home/`.
- Publishing and the reader preview are hidden.
- A banner says where the worlds live, and that Claude's suggestions use the creator's own usage.
- When the platform gives a visit no id, it says so and saves nothing anywhere.
- When a person can only view, the page says to ask for an Editor invite.
- Changes that can't be saved are refused, with a message, not lost silently.

**The fallback page.** `dist/inkwash-trial-shared.html` (`{store: "shared"}`) is for when a
creator's visit gets no id (see "Not yet checked"). It keeps their worlds in that copy's own
studio instead, which you, as the copy's owner, could read. Its banner says so.

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
- the one-person copy saves to the copy's studio and says who can open it.

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
- **The fallback copy** uses `[{ "path": "", "read": "admin", "write": "admin" }]` instead: the
  creator, as Editor, and you, as owner, read and write that copy's studio.

## Runbook (when you decide to go ahead)

1. **Test it on yourself first.** I publish one copy, private, as a new artifact. You open it and
   bring in a page of notes. You run Ripples on a fact, keep one of Claude's answers, ink a scene
   and set it.
2. **Check a guest's view with a second account of your own.** Invite your other email to that
   copy as an Editor. Confirm three things:
   - the Share menu offers Editor for an outside email;
   - the copy opens a studio for that account, not the "can't give you a private studio" page;
   - Ripples asks for consent, then works on that account's usage.

   If the private studio page appears, use the fallback page for real creators and tell them you
   could read their copy.
3. **Per creator:** I publish a copy, and you invite them by email as an Editor, with link sharing
   off. Send them the link and the guide in `CREATOR_TRIAL.md`.
4. **Updates:** I republish each copy from the same file. Their worlds stay in each copy's store.

## Not yet checked (needs a real second account)

- That the Share menu offers **Editor** for an outside email on your plan. The artifact service
  says outside email invites are available; the level isn't stated.
- That an outside Editor gets a user id. The platform's own notes say a guest Editor "may have
  none". If not, use the fallback page for that creator.
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
