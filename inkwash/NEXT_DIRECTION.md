# Inkwash: the next direction

*October 2026. What this release changes, why, how it was checked, and what is still unproven.*

## In short

Inkwash already did the interesting part: a canon of versioned facts, scenes tied to the facts
they rely on, and ripples the author leads. What stopped a real creator from using it was more
basic. They couldn't bring in the notes they already have, a mistake couldn't be taken back,
and nothing helped them pick up where they left off. Only the owner could use the studio at all.

This release fixes those, in that order, and adds a copy of the studio that runs from a single
file, so ten people can try it without an account, without keys and without sharing the live
artifact. Nothing was built around video, 3D, payments or a market.

It's built and tested here. It is **not yet republished** to the live artifact, because that
page holds your private world and republishing is your call.

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
| Dream Canvas, local server | Someone who runs Node with keys | Sketch, picture, panorama, video, worlds, stepping inside | Server environment only; never in the page or exports | Sketches, pictures and world facts to Google; a panorama to World Labs | Stand-ins tested end to end. World Labs draft run live once. Google pictures and video **not run live** |

No key appears in either built page; checked by searching both for key patterns.

### Why the offline file for the trial

**It's the least invasive route that works today.** There's no sharing change, no exposure of
the live artifact, no cost and no account. Nothing a participant writes leaves their computer,
and the examples let them look before bringing their own notes.

**It has a cost.** Participants can't try Claude's side: its ways and answers in ripples, what
a fact breaks, inking, dreaming a world, plates. The trial measures the core loop (notes, canon,
thinking it through, coming back), not whether Claude's help is wanted. In assisted sessions you
can show Claude's side on an example world in your own studio. The world menu lists your
worlds' titles, so open an example before sharing your screen.

**Not chosen, and why:**

- **Sharing the live artifact.** Participants would see only the reader view, and it holds your
  private world.
- **A hosted trial studio, one per participant.** This is the bounded next step, and it isn't
  built. It needs:
  - **code:** per-person storage under `data/users/<id>/` for non-owners, with publishing off
    for them;
  - **a new, separate artifact** with no private data;
  - **sharing:** each participant invited by email as an Editor. Outside visitors hold `view`
    and can't write even their own data. An outside Editor keeps that only while the page isn't
    also shared by link, and Editors hold admin rights on the page, so check what that allows
    before inviting strangers;
  - **participants:** a claude.ai account, and their own Claude usage for Claude's features.

  Those are your decisions to make, not routine details.
- **Dream Canvas.** It needs Node, keys and billing, and Google's side hasn't run live. It's not
  part of the trial.

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
- **Browser steps:** 43 pass (`node inkwash/v0/test/e2e.mjs`), the 29 earlier ones unchanged
  plus 14 new. The new ones use a world made up for the tests, *The Glass Orchard*, and the
  public example. They cover:
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

1. **Try the offline file with your own notes for ten minutes**, before anyone else does. You'll
   find the rough edges fastest.
2. **Republish the studio artifact with this release?** It's ready for the same URL:
   - the page `inkwash/v0/dist/index.html`, plus `example-world.json` and `dream-example.json`;
   - the stored capabilities and rules kept as they are.

   The change is additive: the new history, notes and activity records sit under `studio/`,
   which your rules already keep to you. Nothing is migrated, and your world stays as it is.
   It needs your go-ahead because the page holds your private world.
3. **Send the trial file to the first participants**, with the drafts in `CREATOR_TRIAL.md`.
   Nothing has been sent.
4. **Later, if the trial says so:** build the hosted per-participant studio, which needs the
   sharing decisions above.
5. **Optional:** authorize about 30¢ of Google usage for the first live check of Dream Canvas
   pictures and video: one picture, one panorama and one 4-second Lite video. Until then, they
   stay labeled as not run live.

## After the trial

Ten people is too few for rates. Read the answers as direction:

- **Most get a useful first session, but few come back on their own.** The problem is the
  return. Read what interrupted them before building anything new.
- **Few get a useful first session.** Fix the first ten minutes first: how notes come in and
  how the codex reads.
- **Several come back and keep building, and ask for Claude's help.** Build the hosted studio
  per participant, so the trial can measure whether they use Claude's ways or their own.

In every case, video and 3D wait until the core loop and the providers' real behavior are
dependable.
