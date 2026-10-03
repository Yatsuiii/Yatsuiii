# Inkwash: the next direction

*October 2026. What this release changes, why, how it was checked, and what is still unproven.*

## In short

Inkwash already did the interesting part: a canon of versioned facts, scenes tied to the facts
they rely on, and ripples the author leads. What stopped a real creator from using it was more
basic. They couldn't bring in the notes they already have, a mistake couldn't be taken back,
and nothing helped them pick up where they left off. Only the owner could use the studio at all.

This release fixes those, in that order. Nothing was built around video, 3D, payments or a market.

It adds two ways for creators to try Inkwash:

- **The offline preview,** a copy that runs from a single file, for onboarding and editing. It
  needs no account and no keys.
- **Trial copies,** one per creator on claude.ai, for the full loop with Ripples working. Each
  creator's worlds sit in their own space, which the copy's storage rules keep from everyone
  else, you included. A new version of the copy could change that, so it's not a guarantee
  against you. Claude runs on their own usage.

It's built and tested here. It is **not yet republished** to the live artifact, because that's
your call. One test copy of the trial page is published, private to you, for the check with a
second account of yours (`TRIAL_SETUP.md`).

Before any republish, the live store was backed up and the backups were verified to restore. The
exposure of private content was checked rather than assumed (see "Before republishing" below).

## The three obstacles, as found

1. **No way in for what creators already have.** The people Inkwash is for have notes: a doc, a
   wiki page, a notebook. The studio offered three starts: an empty world filled one fact at a
   time, a world dreamed by Claude, or an example. Someone with three years of notes had to
   retype them.
2. **Editing wasn't safe.** There was no undo anywhere ("There's no undo" was in the README). In
   sketchbook mode a change made less than about 0.75 s before a reload was lost, which was
   measured, not guessed. In claude.ai, writes wait half a second, so closing the tab at the
   wrong moment could drop the last change.
3. **Nothing to come back to, and no way in for anyone else.**
   - Anyone the artifact is shared with gets the reader view, never a studio.
   - The page opened from a file couldn't load its own examples.
   - Coming back after a day, nothing said where you were or what was still open.

## What changed

### 1. Bring your notes

Paste notes, or open a `.txt` or `.md` file, into a new world or the open one.

- **Read in the page, never sent to Claude.** Headings become entries. Sentences and bullets
  become facts. Section names like Characters, Places, Factions, Creatures or Magic set the
  kind. `Name: what it is` lines work too, and text under no heading is kept as Unsorted notes.
- **Reviewed before anything is added.** Every entry and fact is shown with its line number.
  The creator can untick, rename, re-kind and rewrite. Kinds guessed from a name, and text under
  no heading, are marked for checking. Only what is ticked is added.
- **Nothing invented.** Facts are the creator's words, only split at sentence ends with
  Markdown marks removed. A unit test checks that every word of every fact is in the notes.
- **No duplicates.**
  - An entry already in the world is matched by name, and only its new facts are added.
  - Lines already in the canon are shown as already there and left out.
  - The same notes brought in again are recognized, even with different line endings.
- **The notes are kept whole**, as written, and each fact records the notes it came from and
  whether it was rewritten on the way in.
- **Origin, honestly.** Brought-in facts are counted apart from facts written in the studio and
  from Claude's suggestions, in the canon, the provenance report and the bible.
  - "These notes are my own writing" is stored as the creator's statement. Inkwash can't check
    it, and the report says it is not proof of copyright.
  - Unticked, the facts are marked as brought in from outside the studio.
- **One step to undo**, with the rest of History.

### 2. Undo and recovery

- **History:** the last 40 changes per world, each with Undo, and Undo on the toast after each
  change.
  - Covered: the canon (add, reword, retire, delete, rename, kind, secrets), brought-in notes,
    kept suggestions and seeds, everything a ripple adds or saves for later, and scenes (typing,
    inking, repainting, setting, Still true, keeping a contradiction, clearing).
  - Not covered: painting the score, pins and notes, chapters, world settings, the atlas,
    plates, dream fragments, publishing and deleting a whole world.
- **Undo respects what came after.**
  - It works fact by fact and document by document, and leaves alone, and names, anything
    changed since.
  - A continuity check or a re-save isn't a change; new words are. Without this, a scene could
    never be un-inked, because the check runs right after inking. This was found while writing
    this, fixed, and covered by a unit test and a browser step.
- **The ledger stays honest.** A fact put back is a *new version*, never a rewound number.
  - A scene set against the words put back holds again: the staleness rule now compares the
    words, not just the version.
  - A scene set against the words being undone goes stale, and the undo message names it.
  - Undo never quietly passes a scene.
- **Saving across a closed tab.**
  - claude.ai: when the page is hidden or closed with writes still in flight, they're noted in
    the browser. The next visit finishes any the store never got, and never overwrites a newer
    copy.
  - Sketchbook: the browser's copy is written at once when the page hides.
  - Both browser tests fail with the fix removed, which was checked by removing it.
- **Backups** carry the notes and stay `inkwash-backup/1`. Old backups open; new backups open in
  an older reader. History isn't in backups.

### 3. A useful return visit

- The studio reopens on the world, view, chapter and entry you were on. This is remembered per
  browser.
- **Where you left off.** After 20 minutes or more since the world's last change, a card shows:
  - the last change and when;
  - up to three open things, all from stored state: ripple ways not yet decided, questions
    saved for later, a stale scene, a scene with ink not set;
  - a button to carry on with the entry you were on.
- **No side effects.** Opening asks nothing of Claude (a browser test checks there are zero
  calls). There are no streaks, reminders or notifications. The card never appears for the
  examples, and shows once per visit.
- **My activity, in numbers:**
  - counts by day, per world, with worlds numbered rather than named and none of the words;
  - it stays in the studio unless the creator copies or saves it;
  - it's the opt-in summary for the trial.

### 4. An honest trial setup

See the runtime audit below, and `CREATOR_TRIAL.md`.

- `node inkwash/v0/build.mjs` now also writes `dist/inkwash-offline.html`: the studio as one
  ~535 KB file, with both examples inside, that opens from disk.
  - It needs no account, no Claude and no keys.
  - Its only network request is for its typefaces, from Google Fonts.
  - Without Claude, Ripples opens straight to the author's own idea.
- Dream Canvas now says "not yet run live" next to Google pictures and video, in the page and in
  its README.
- Copy was made true:
  - the design doc's "big labs won't build this" and "the moat is…" are now marked as
    hypotheses, and the overlap with existing tools is acknowledged;
  - "every scene that relied on it" became "scenes recorded as relying on it";
  - the reader page and exports no longer claim the author "painted the shape of every scene".

## The runtimes, audited

| Runtime | Who can use it | What works | Keys | What leaves the browser | Status |
| --- | --- | --- | --- | --- | --- |
| Studio artifact, as owner | You | Everything, Claude on your own usage | None | Studio data to claude.ai, readable by you alone (`studio` rules: owner only). Prompts to Claude when you ask | Live. This release isn't published there yet |
| Studio artifact, as anyone else | Signed-in people it's shared with | The reader view: published chapters and spoiler-safe lore | None | Nothing; they can't write | Live |
| Offline file | Anyone with the file and a browser | Notes, canon, own ripples, scenes by hand, the score, History, return card, backups, both examples | None | A request for the typefaces | Tested in Chromium only |
| Trial copy, one per creator (`TRIAL_SETUP.md`) | The creator, invited by email as an Editor of their copy | The full studio and loop, no publishing | None | Their worlds to their own space in that copy's store, kept from everyone else by its published rules; prompts to Claude on their own usage | One test copy published, private to you, with its rules checked on the real store. Not yet tried from a second account |
| Dream Canvas, local server | Someone who runs Node with keys | Sketch, picture, panorama, video, worlds, stepping inside | Server environment only; never in the page or exports | Sketches, pictures and world facts to Google; a panorama to World Labs | Stand-ins tested end to end. World Labs draft run live once. Google pictures and video **not run live** |

No key appears in either built page; checked by searching both for key patterns.

### The trial: a preview and the full experience

**The offline file is the preview, for onboarding and editing.** There's no sharing change, no
cost and no account, and nothing a creator writes leaves their computer. It can't show Claude's
side, so its feedback is never read as a verdict on the AI.

**Trial copies are the full experience, for 3–5 creators.** Each creator gets their own copy of
the studio on claude.ai, with their worlds in their own `data/users/<id>/`. The copy's published
rules keep that from everyone else, you included. Those rules hold only while the copy stays as
published. You, or an Editor of the copy, can publish a new version with different rules or
code, so it isn't privacy from you (`TRIAL_SETUP.md`, "What the rules protect, and what they
don't"). Claude's help runs on their own Claude usage.
`TRIAL_SETUP.md` covers:

- why one copy per creator and not one shared page;
- the rules each copy is published with;
- the runbook;
- what still needs a check with a second account of yours;
- a standalone fallback with its costs, which isn't needed unless the runtime fails that check.

**What an Editor invite gives.** On your own studio, an Editor can't read `studio/` through the
store. That was checked live, at Editor level. But an Editor can publish a new page, and its code
would run with your access when you next opened it. So never invite a creator as an Editor there.
On a trial copy, an Editor reaches only that copy, including anything you save in it, so keep
only made-up content in a copy you share.

**Not chosen:**

- **Sharing the live artifact.** Participants would see only the reader view.
- **One shared trial page for all creators.** Any one of them, as an Editor, could change the page
  the others open.
- **Dream Canvas.** It needs Node, keys and billing, and Google's side hasn't run live. It's left
  for later.

## Before republishing: backup, restore and exposure (checked 2026-10-03)

**Backup.**

- Every document in the live store was read to private files: 128 documents, your two worlds and
  the example. None of it went into this repository.
- From them came a backup per world, in the studio's own format, plus a dump of every document by
  path. All three went to you.

**Restore.**

- Both the live code and this release read each backup back exactly: entries, facts, chapters,
  scenes and plates.
- In a browser, against a local copy of the store, a backup made in each page restored as a new
  world identical to the original, with the original untouched.

**The new release on your data.**

- Opening your worlds and going through every view showed the same thing as the live page.
- It made no writes, called Claude zero times, threw no errors and sent no request outside the
  page.

**What's exposed now.**

- **The page is private.** Your plan allows link sharing and outside email invites. Who has
  access isn't visible to these tools, so confirm in the Share menu that nobody does.
- **The stored rules match the repo.** `studio/` is owner-only for reading and writing.
  `published/` is readable by anyone with access, and it is empty.
- **Reads as a viewer, a contributor and an Editor** return nothing from `studio/`.
- **The live page and both example files** are byte-identical to the repo's build and files.
- **No private sentence anywhere public.** Your worlds' names and every eight-word run of their
  text were searched for across the live page, every build in this release and the whole git
  history. No sentence matched. The only names that matched are ordinary words the app itself
  uses.

**What a republish would change.**

- Only the page. Republish to the same URL **without passing capabilities**, so the stored rules
  stay exactly as they are; passing a new set would replace them.
- The release's new records (History, notes, activity) live under `studio/`, which the rules
  already keep to you.
- One new thing is kept locally: writes that hadn't arrived when the tab closed are held in your
  browser until the next visit.
- In-app "Publish" still sends a chapter and its spoiler-safe lore to `published/`, readable by
  anyone you share the page with. That's by design, and it's unchanged.

## How it was checked

All run here, on the final build:

- **Unit tests:** 60 pass (`node --test inkwash/v0/test/core.test.mjs`), 15 of them new,
  and more assertions added to existing ones.
  They cover:
  - import, duplicates and line endings;
  - nothing invented;
  - provenance and declarations;
  - backup compatibility both ways;
  - undo of edits, retirements, secrets, renames, deletions, imports, ripple answers and scenes;
  - re-versioning and staleness both ways;
  - checks and re-saves not blocking undo;
  - activity counts.
- **Browser steps:** 50 pass (`node inkwash/v0/test/e2e.mjs`), the 29 earlier ones unchanged
  plus 21 new. The 7 trial-copy steps are listed in `TRIAL_SETUP.md`. The other new ones use a
  world made up for the tests, *The Glass Orchard*, and the public example. They cover:
  - bringing notes in, reviewed, with guesses marked, a line left out, one rewritten and the
    declaration ticked;
  - the same notes again, with duplicates left out;
  - a second file into existing entries, then undone exactly;
  - deleting an entry and undoing it from History;
  - a reworded fact and a hand-written scene, each undone;
  - undoing a rewording on *The Hollow Moon*: the scene on the restored words holds, and the
    scene marked Still true on the undone words is flagged;
  - inking, the automatic check, then undoing the inking;
  - reopening hours later, with the clock moved: the card, the open items, the right view and
    entry, zero Claude calls; and five minutes later, no card;
  - backup and restore with notes, provenance intact, and the notes still recognized;
  - writes lost before a reload, finished on the next visit;
  - a sketchbook world made a moment before a reload;
  - the offline file from `file://`: both examples, the author's own ripple with no Claude,
    notes brought in, nothing leaving but the typefaces;
  - a 195 KB notes file, about 2,500 lines in 1,400 entries, reviewed and brought in within
    seconds.
- **Mutation checks:** with each fix removed in a scratch copy, its browser step fails. This was
  done for the sketchbook flush, noting pending writes, and undo ignoring check results.
- **Dream Canvas:** 28 unit tests and 15 browser checks pass, with stand-ins.
- **Screenshots, inspected:**
  - the welcome page and the import review, on a desktop and on a phone in dark mode;
  - History, the canon with brought-in facts, and the return card on both.

  On a phone, neither the import review nor the return card scrolls sideways (measured). One bug
  found this way was fixed: long lines in the review were cut off on a phone.

**Found and fixed while checking:**

- **Big notes froze the page.** A 195 KB notes file stopped the page for over 30 seconds on
  "Read my notes", because each of 2,500 lines resized itself with its own layout pass. Sizing
  them together brought the review to about 1 second.
- **Bringing them in was slow.** Bringing in the same file took 14 seconds in sketchbook mode,
  because every write re-sent each collection to every listener. One delivery per burst brought
  it under 1 second.
- **Sizes were counted in letters.** The store limits a document to 256 KiB as stored, but the
  page counted letters, not bytes. Notes in a script of three bytes a letter could pass the
  check and then be refused. A refused write switches the studio to "can't save".
  - Every limit now counts bytes.
  - An import measures everything it would save before changing anything.
- **Inked scenes couldn't be undone** (above).
- **A reader-facing claim was false:** "the author painted the shape of every scene" (above).

**Not checked:**

- this release in the live claude.ai viewer;
- real `sample` and `downloads` prompts;
- finishing lost writes against the real store (the fake store loses every write before a
  reload);
- Safari and Firefox;
- Google's picture and video calls, live.

## Still unproven

These are open questions, not facts, and the trial is the first test of the first three.

- That creators with notes will bring them in, and find the result worth keeping.
- That they come back on a later day without being asked, and keep building the same world.
- What they'd pay, if anything. No price is set, and none should rest on an assumed margin: the
  cost of inking per creator hasn't been measured.
- That the gap against existing story-bible and worldbuilding tools is real. The overlap is
  large: codexes, lorebooks and wikis already exist and people pay for them.
- That a big lab won't build this, or that a community will be a moat. Neither is established.

## Your decisions, in order

1. **Confirm in the Share menu that nobody else has access to the studio.** Keep link sharing off.
2. **Republish the studio with this release?** It's ready for the same URL:
   - the page `inkwash/v0/dist/index.html`, plus `example-world.json` and `dream-example.json`;
   - capabilities omitted, so the stored rules stay as they are.

   Backups are in hand, and the checks above passed.
3. **Run the full loop on the test copy, then from a second account of yours.** The copy is
   published, private to you: https://claude.ai/artifact/76GitMowRjowobZd1vvXtn. The steps are
   in `TRIAL_SETUP.md`, "Testing with a second account". If that account gets no id, stop:
   the only fallback lets you read a creator's worlds. Nobody else is invited until the whole
   loop works there.
4. **Then 3–5 creators, one copy each,** invited by you as Editors of their own copy. The Track
   F drafts in `CREATOR_TRIAL.md` are finished with what the second account's run showed.
5. **The preview** can go to anyone else at any time (Track P). Nothing has been sent.
6. **Later, as you said:** a first live check of Dream Canvas's Google pictures and video. About
   30¢; not authorized, not run.

## After the trial

A handful of people is too few for rates. Read the answers as direction, track by track:

- **Most get a useful first session, but few come back on their own.** The problem is the
  return. Read what interrupted them before building anything new.
- **Few get a useful first session.** Fix the first ten minutes first: how notes come in and
  how the codex reads.
- **Several come back and keep building.** Look at how they used Claude's help in Track F. Did
  they take Claude's ways or their own ideas? Did they keep, rewrite or skip Claude's answers? Did
  they ink scenes or write them? Then decide what Ripples and inking should become.

In every case, video and 3D wait until the core loop and the providers' real behavior are
dependable.
