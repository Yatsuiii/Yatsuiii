# Inkwash v0

The first working version of the studio described in `../DESIGN.md`.

It runs as a single page published as a claude.ai artifact:
- **Live:** https://claude.ai/artifact/TxYpHeRRTDSLLg9mPj3DeK
- **Access:** private to its owner until it's shared from the page's Share menu.
- **Examples:** *The Drained Sea*, a world dreamed from three sentences, and *The Hollow Moon*, a book in progress.
- **Without claude.ai:** `node build.mjs` also writes `dist/inkwash-offline.html`, the same studio as one file that opens from disk, with both examples inside. It has no Claude, needs no account and keeps everything in the browser it's opened in. It's the preview track of the creator trial (see `../CREATOR_TRIAL.md`).
- **Trial copies:** `dist/inkwash-trial.html` is the studio for one creator's own copy on claude.ai. Each person's worlds live in their own space in the store, which the copy's published rules keep from everyone else, the owner included, until a new version changes its rules or code. Nothing is published. `dist/inkwash-trial-shared.html` is the fallback, keeping them in the copy's own studio. See `../TRIAL_SETUP.md` for what an Editor invite gives, and how to set it up.
- **Pictures, film and worlds:** Dream Canvas (`../canvas`) turns a sketch into a real picture, a moving shot and a world you can walk through. It runs on your own computer, with your own keys. It isn't needed for anything below.

## What it does

**Overthink it. Inkwash keeps it straight.** Inkwash is world creation for people who overthink: pour in every detail, and it keeps the world consistent and thinks it through with you.

**Bring your notes.** Paste notes, or open a `.txt` or `.md` file, into a new world or the one that's open. Inkwash reads them in the page; nothing is sent to Claude.
- A heading starts an entry, and the sentences and bullets under it become its facts. A heading such as Characters, Places, Factions, Creatures or Magic says what the entries under it are. `Name: what it is` on its own line, or as a bullet, works too. Text under no heading is kept as Unsorted notes.
- Before anything is added, you see every entry and fact it found, each with its line number. Untick what you don't want, fix a name or a kind, and rewrite any line. A kind guessed from a name, and anything not under a heading, is marked for you to check.
- Facts are your words as written; Inkwash only splits them at sentence ends and takes off Markdown marks. Nothing is invented.
- An entry already in the world is recognized by name, and its new facts are added to it; lines it already has are shown as already there and left out. Notes brought in before are recognized too, even with different line endings.
- The notes are kept whole, as written, under the world. Each fact records the notes it came from, and whether you rewrote it on the way in.
- **Where they came from.** You can tick "These notes are my own writing". Inkwash keeps that as your statement and can't check it; the provenance report says so and is not proof of copyright. Unticked, the facts are marked as brought in from outside the studio. Either way they're counted apart from facts written in the studio and from Claude's suggestions.
- What you add is one step in History, so the whole import can be undone.

**History and undo.** The changes you're most likely to regret are kept as steps, the last 40 per world, and the toast after each offers Undo:
- canon: adding, rewording, retiring and deleting facts and entries, renaming, changing a kind, making a fact secret;
- brought-in notes, kept suggestions and seeds, and everything a ripple adds or saves for later;
- scenes: typing (one step per stretch of typing), inking, repainting, setting, Still true, keeping a contradiction, clearing.

Undo is careful with what came after:
- It works fact by fact and document by document, and leaves alone, and names, anything that has changed since. Saving again, or a continuity check finding something in a scene, isn't a change; new words are.
- A fact put back is a new version, never an old version number. So a scene set against the words being undone goes stale, and says so; a scene set against the words put back holds again. Undo never quietly passes a scene.
- An entry deleted and brought back keeps its id, so scenes find it again.

Not in History: painting the score, pins and notes, chapters, world settings, the atlas, plates, dream fragments, publishing and deleting a whole world. Back up before big changes to those.

**Saving you can rely on.** Writes to claude.ai are queued and sent within half a second. If the page is hidden or closed with writes still on their way, they're noted in this browser, and the next visit finishes any the store never got (and never overwrites a newer copy). In sketchbook mode, this browser's copy is written at once when the page is hidden. Both are covered by browser tests that fail without the fix.

**Where you left off.** Come back to a world after a while (20 minutes or more since its last change) and it opens where you left it, with a short card:
- your last change, and when;
- up to three things still open: a ripple with ways you haven't decided, questions you saved for later, a scene gone stale, a scene with ink not set;
- a button to carry on with the entry you were on.

It's built from what's stored; opening asks nothing of Claude and spends nothing. It shows once per visit, not for the examples, and goes away when dismissed or followed. There are no streaks or reminders. The world, view, chapter and entry you were on are remembered by this browser.

**My activity.** History's "My activity, in numbers" shows days you made something and counts of what you did (facts written, kept or brought in, ripples decided, questions saved, writing in scenes, scenes inked and set, undos), per world, numbered rather than named. Opening or reading the studio isn't counted; only changes are. None of your world's words are in it. It stays in the studio unless you copy it or save it, for a trial you've chosen to join.

**Ripples.** On any fact, Claude reads it against the rest of the canon and the scenes that touch it. Then you think it through, and you decide:
- **What it breaks:** clear contradictions, each linked to the fact or scene it breaks.
- **Where does it lead?**
  - **My own idea** comes first. Write where you think it leads, and choose the entry it goes into, or start a new one. Stuck? **Help me think it through**, and Claude asks you one question about your idea.
  - Then four ways Claude sees it leading. Pick one, and it asks you a question. **My own answer** comes first, with four of Claude's answers below it to start from. Pick one of Claude's and it goes into your box to keep or rewrite; it never replaces what you've written.
  - Add it, and it joins the canon under the entry it's about. It's your own fact, unless most of its words are Claude's answer; then it's marked as suggested. Either can ripple in turn.
  - Not ready to decide? Save the question to the dream inbox.

Nothing from a ripple joins your canon unless you add it. Ripples are kept with the fact, for the wording they were made from. Inkwash offers them after you add or reword a fact, and never spends your usage on them unasked. Without Claude (the offline copy, or a view without `sample`), Ripples opens straight to **My own idea**: no call, nothing suggested.

**Dream a world.** Write a dream the way it came. Claude grows it into a whole world, and Inkwash keeps all of it in the canon, each fact marked as suggested. The world has:
- its shape and climate;
- 6 to 9 regions, each with its own people, look and trouble;
- 24 to 36 places;
- its seas and features;
- the rules it runs on;
- factions, and the people who matter now.

The canon also records the geography ("Harrowgate is a capital in The Old Coast."), so a scene's brief knows where things are. The example was grown from three sentences into 48 canon entries and 101 facts.

**Atlas.** A world is drawn as a map in the manner of an old hand-inked atlas:
- **Land:** the coast hatched with ripples, mountains shaded on their eastern faces, woods, marsh, dunes and salt.
- **Water:** rivers that gather rain and run to the sea, lakes in the hollows they can't drain, and dry pans in deserts.
- **Settlement:** borders that wander, roads between places, every place with its icon and name.

The map is grown from the world's spec with seeded noise, so the same world always draws the same map. You can drag it, zoom it and choose any region or place to open its page beside the map: edit its facts, ripple them and paint its plate. Names of lesser places come in as you zoom closer.

- **Explore deeper:** asks Claude for the places nobody has mapped yet in a region. They join the canon and the map, and nothing already placed moves.
- **Draw the atlas:** for a world that already has a canon, draws a map around it. Every place you have stays as it was; only what the map adds becomes new canon.
- **Save the map:** downloads it as an SVG.

**Score.** Each chapter is a canvas you paint:
- a tension curve;
- mood washes, in pigments you name;
- a line for each character, where they appear.

Pins (your own sentences) and notes attach to scenes. Arrow keys and number keys paint too, so the score works from the keyboard.

**Ink.** "Ink this scene" sends the scene's brief to Claude on the viewer's own Claude account and streams the scene in as wet ink. You can see the brief under the scene. It is built from what you painted, your pins and notes, the relevant canon (with secrets fenced off until their chapter), the text around the scene, and your voice sample.

- **Repaint:** select words and give a direction; only that range changes.
- **Set with your seal:** dries the ink. It's blocked while a pinned line is missing, and while a contradiction with the canon is open: change the words, or keep them on purpose (a lie, a character's mistake, canon you're about to change).

**Ledger.** Setting a scene records the version of each fact it relies on. Three witnesses decide which facts those are, and the ledger keeps everything any of them found (it can still miss a fact a scene leans on without naming it; see Known limits):
- the model's own list of the facts it used;
- the scene's words: a fact whose distinctive words are on the page;
- the continuity check, which lists every fact the scene depends on.

A scene you write by hand gets its premises from the last two. The facts are listed under each set scene.

When you reword or retire a fact, the scenes that relied on it glow as stale, with the old and new wording side by side. From there you can:
- mark the scene **Still true**;
- edit it;
- repaint the part that's wrong;
- ink it again.

This is stalefence's premise ledger applied to a story. Scenes are also checked against the canon after inking. A contradiction is highlighted in the text and blocks setting and publishing until it's resolved. Exporting a book with a stale or contradicted set scene asks first.

**Authorship.** Every character of a scene is recorded as **typed**, **pinned**, **inked** (by the model) or **pasted** (from outside the studio). The hand meter shows your share, typed and pinned words, for each scene and for the whole book. The provenance export lists who wrote what.

Text keeps its origin when it moves. Cut and paste it back, drag it, undo a deletion, or copy a sentence elsewhere: the words stay whoever's they were. The model's words for a scene are remembered after they're deleted, so pasting them back later still counts as ink. Text pasted from outside can't be traced, so it isn't counted as anyone's hand.

**Plates.** Any scene, region, place or character can have a plate: an ink wash painting on paper, mostly ink with one accent color.
- "Paint a plate" sends Claude a short brief: the subject and its facts, with secrets fenced off as for inking. For a scene it also sends the text, your notes and pins, and the moods you painted there. With no moods painted it sends the world's palette instead, so a book's plates share its colors.
- Claude composes the picture as a small JSON description of what's in it and roughly where: time and weather, mountain ranges, water, buildings, a train, people, and voids (clean holes cut out of the world).
- Inkwash paints it as SVG with its own brushes. The same composition always paints the same picture. "Paint it again" asks for a new one.

Plates show in the scene sheet, the book, the canon's pages, the reader view and its lore, and the EPUB and HTML exports. Backups carry them, and the provenance report counts them as composed by a model.

**Canon, Dreams, Book.**
- **Canon:** the world's codex. An index of everything in the world, and one entry at a time as an illustrated page:
  - a place or region shows where it lies on a strip of the map, with ink rings rippling out from it (click it to open the atlas there);
  - anyone else shows their plate, or an ink seal with their first letter until they have one;
  - facts read as prose and are edited where they stand. Each is versioned and shows which scenes use it; its version, secret switch and Retire appear when you reach for it;
  - **Connected** lists what the entry names and what names it, so you can walk the web of the world.
- **Beside the map:** choosing a place or region in the atlas opens the same page next to the map, where its facts can be edited and rippled.
- **Dreams:** an inbox where Claude suggests seeds from a fragment, and nothing joins the canon until you keep it.
- **Book:** shows the whole book. From here you can:
  - publish a chapter (blocked while any scene is wet, stale, a draft, missing a pin, or contradicting the canon);
  - preview the reader view;
  - export as EPUB, HTML, Markdown, the bible as JSON, the provenance report as Markdown and JSON, or a full backup. A backup restores here, or from the welcome page when there's no world yet, as a new world.

**Readers.** Anyone the page is shared with who isn't the owner sees only the reader view:
- published chapters;
- lore that is spoiler-safe: an entity appears only from the chapter that names it, and a secret only from the chapter that reveals it.

They never see the studio, because the access rules make `studio/` readable by the owner alone.

**Without the platform.** Without the `db` capability the page runs in sketchbook mode and keeps everything in this browser. Without `sample`, inking, plates, dreaming and Claude's side of ripples are off, but bringing in notes, the canon, your own ripples, painting, writing by hand, setting, History and backups all still work, and plates already painted still show. The offline copy is this mode, from a file: its only request is for its typefaces, from Google Fonts, and if that fails it uses the system's fonts.

## Files

| Path | What it is |
| --- | --- |
| `src/core.js` | All logic that has to be exactly right, as pure functions shared by the page and the tests: briefs, parsing model output, pin matching, authorship spans, the ledger, publishing, exports (including a stored-ZIP EPUB writer), backups |
| `src/atlas.js` | The atlas: cleans a world's spec, grows its land, rivers, regions, places and roads from seeded noise, and draws the map as SVG. Also the briefs for dreaming a world, drawing an atlas and exploring a region. Pure, shared by the page and the tests |
| `src/plates.js` | The plate painter: cleans a composition and paints it as an ink-wash SVG with seeded brushes, and writes the plate brief. Pure, shared by the page, the exports and the tests |
| `src/app.js` | The page: storage through `claude.use('db')`, the canvas score, the views, the calls to `sample` and `downloads` |
| `src/styles.css`, `src/page.html` | Look and markup |
| `build.mjs` | Inlines everything into `dist/index.html` and copies the examples beside it; writes `dist/inkwash-offline.html`, a whole document with the examples inside, and the two trial pages |
| `dream-example.json` | The dream behind *The Drained Sea* and the world grown from it, composed in place of the model; the page builds the example world from it with no call to Claude |
| `example-world.json` | The Hollow Moon, as a backup file. It has a set scene, a stale scene, a wet scene, a scene ready to ink, and seven plates. Regenerate it with `tools/make-example.mjs` |
| `tools/example-docs.mjs` | The example as database documents, used to seed the artifact and by the end-to-end test |
| `test/core.test.mjs` | 60 unit tests |
| `test/e2e.mjs` | 50 browser steps against a fake claude.ai runtime, the offline copy opened from disk, and the trial pages against a fake store that enforces a trial copy's rules |

## Build, test, publish

```sh
node --test inkwash/v0/test/core.test.mjs
node inkwash/v0/build.mjs
node inkwash/v0/test/e2e.mjs            # add --shots to save screenshots in test-shots/
```

The end-to-end test uses the Playwright that's installed globally (`npm root -g`) and its Chromium.

To publish, use the Artifact tool:
- **Page:** `inkwash/v0/dist/index.html`, published to the same URL.
- **Supporting file:** `example-world.json`, from `dist/example-world.json`.
- **Capabilities:**
  - `sample`;
  - `user`;
  - `downloads`;
  - `db`, with these rules:

    ```json
    [{"path": "", "read": "view", "write": "owner"},
     {"path": "studio", "read": "owner", "write": "owner"},
     {"path": "published", "read": "view", "write": "owner"}]
    ```

Database layout:

```
studio/<world>                      world settings, moods, voice sample
studio/<world>/canon/<entity>       an entity and its versioned facts
studio/<world>/chapters/<chapter>   the painted score, pins and notes
studio/<world>/passages/<scene>     text, authorship spans, premises
studio/<world>/seeds/<fragment>     the dream inbox
studio/<world>/atlas/main           the atlas: the world's shape, regions, places, features and seas, each tied to its canon entry
studio/<world>/plates/<id>          a plate: <chapter>__s<n> for a scene, ent__<entity> for a place or character
studio/<world>/sources/<id>         notes brought in, kept whole: name, text, a print of it, the declaration, the facts it gave
studio/<world>/history/<id>         a step that can be undone: what each document looked like before, and enough of after
studio/<world>/meta/activity        counts by day, never words
published/<world>                   the public face: title, chapter list, spoiler-safe lore and its plates
published/<world>/chapters/<id>     published chapter text and its plates
```

## Where v0 differs from the design

- **Model tiers.** Repainting a selection uses the `default` tier, because waiting on `complex` for a sentence is too slow. Whole scenes, dreaming a world and drawing an atlas use `complex`; continuity checks, plates and exploring a region use `default`; dream seeds use `quick`.
- **No PDF.** The viewer can't print and there is no PDF library on the page. EPUB and HTML cover reading.
- **Threads.** The score derives "first time these two share a scene" by itself. There are no marks for fights or exits yet.
- **Lanes.** The pace and secrets lanes are deferred, as planned. Secrets work through canon facts marked secret, each with the chapter that reveals it.
- **A small library.** v0 includes publishing and the reader view (the design had put them later), because stage 0 is showing your world to ten readers.
- **Several worlds.** v0 holds more than one world, so the example and your own world can live side by side.

## Known limits

- **One author.** Readers must be signed in to claude.ai, and the page must be shared with them.
- **What a scene relies on is a judgment.**
  - The words witness matches word forms, not meaning. A scene that relies on a fact without sharing its words is caught only if the model or the check names it.
  - It errs toward flagging: a fact that shares a few words with a scene may flag it when it changes. "Still true" clears that in one click.
  - When the model returns no list, Inkwash records every fact about anyone the scene names.
  - Strict continuity is coarse: any change to anyone on the page.
- **Pasted text is nobody's hand.** That includes your own drafts pasted from another editor: Inkwash can't tell where they came from. Your own words removed in an earlier visit and pasted back count the same way; the model's are recognized.
- **The atlas is drawn, not painted.**
  - Maps come from code: they look like hand-inked cartography, not like concept art.
  - Each world has one map.
  - Moving a place by hand isn't possible yet; drawing the land again with a new seed is the only way to reshape it.
  - Drawing a large world takes a second or two in the browser.
  - Readers don't see the atlas yet; it stays in the studio.
- **Plates paint with a fixed set of brushes.**
  - Claude can compose only from what the painter knows: ranges, water, a few kinds of building, a bridge and a viaduct, a train and a wagon, trees, rocks, lamps, people and crowds. Anything else is left out.
  - Interiors are painted from outside.
  - Portraits are silhouettes in profile.
  - You can't upload your own art yet.
- **Undo has limits.** See "Not in History" above. History keeps 40 steps a world, and a single change too big to keep a way back from (over 200 KB) is listed but can't be undone; restore a backup instead. Backups don't carry History: a restored world starts with none.
- **Bringing notes in reads structure, not meaning.**
  - It finds entries from headings, `Name: …` lines and bullets. Notes without headings arrive as one Unsorted entry to sort by hand.
  - Inside an entry, a `Name: …` line stays a fact of that entry (so "Age: 34" works); it can't be split into an entry of its own during review.
  - Kinds are guessed from section names and a few words in a name, and marked as guesses.
  - Plain text and Markdown only, up to 200 KB at a time (counted in bytes, so fewer letters in scripts that take more bytes each). No Word, Google Docs, PDF or Scrivener files: save or export them as text first.
  - Big notes are slower to review: about a second per change for 2,500 lines, which is the size the tests time. Bringing in hundreds of entries at once makes as many writes to claude.ai; if the store asks it to slow down, Inkwash retries, but that hasn't been tried against the real store.
  - Before anything is added, every document it would save is measured against the store's 256 KiB limit; notes that would go over are refused whole, not cut short.
  - Two entries are the same only if their names match (ignoring case, punctuation and a leading "The"). "Ilse" and "Ilse Varr" are two entries.
- **The offline copy is one browser's.** Its worlds live in that browser's storage, on that device. Clearing site data deletes them, and a private window forgets them. Back up to a file. It has been tested in Chromium only.
- **The return card's memory is this browser's.** Where you were is remembered per browser, so on another device the studio opens on the first of your worlds.
- **A repaint can't include a pinned line.**
- **Untested here:**
  - real `sample` calls in the live viewer, which spend the viewer's own usage after a consent prompt;
  - the real `downloads` prompt;
  - finishing writes that never arrived, against the real store: the tests use a fake store that loses every write before a reload;
  - this release in the live artifact: it hasn't been republished (see `../NEXT_DIRECTION.md`).

  The tests cover the first three with a fake runtime.
