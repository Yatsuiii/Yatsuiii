# Inkwash v0

The first working version of the studio described in `../DESIGN.md`.

It runs as a single page published as a claude.ai artifact:
- **Live:** https://claude.ai/artifact/TxYpHeRRTDSLLg9mPj3DeK
- **Access:** private to its owner until it's shared from the page's Share menu.
- **Examples:** *The Drained Sea*, a world dreamed from three sentences, and *The Hollow Moon*, a book in progress.
- **Pictures, film and worlds:** Dream Canvas (`../canvas`) turns a sketch into a real picture, a moving shot and a world you can walk through. It runs on your own computer, with your own keys.

## What it does

**Overthink it. Inkwash keeps it straight.** Inkwash is world creation for people who overthink: pour in every detail, and it keeps the world consistent and thinks it through with you.

**Ripples.** On any fact, Claude reads it against the rest of the canon and the scenes that touch it. Then you think it through, and you decide:
- **What it breaks:** clear contradictions, each linked to the fact or scene it breaks.
- **Where does it lead?** Four ways the fact could lead, plus **Other** to name your own. Pick one, and it asks you a question, with four possible answers and **Other, in my own words**.
  - A picked answer lands in a box, for you to keep or rewrite.
  - Add it, and it joins the canon under the entry it's about. It's your own fact, unless most of its words are the answer that was offered; then it's marked as suggested. Either can ripple in turn.
  - Not ready to decide? Save the question to the dream inbox.

Nothing from a ripple joins your canon unless you add it. Ripples are kept with the fact, for the wording they were made from. Inkwash offers them after you add or reword a fact, and never spends your usage on them unasked.

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

The map is grown from the world's spec with seeded noise, so the same world always draws the same map. You can drag it, zoom it and choose any region or place to read its canon and paint its plate. Names of lesser places come in as you zoom closer.

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

**Ledger.** Setting a scene records the version of every fact it relies on. Three witnesses decide which facts those are, and the ledger keeps everything any of them found:
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

Plates show in the scene sheet, the book, the canon cards, the reader view and its lore, and the EPUB and HTML exports. Backups carry them, and the provenance report counts them as composed by a model.

**Canon, Dreams, Book.**
- **Canon:** versioned facts, each showing which scenes use it.
- **Dreams:** an inbox where Claude suggests seeds from a fragment, and nothing joins the canon until you keep it.
- **Book:** shows the whole book. From here you can:
  - publish a chapter (blocked while any scene is wet, stale, a draft, missing a pin, or contradicting the canon);
  - preview the reader view;
  - export as EPUB, HTML, Markdown, the bible as JSON, the provenance report as Markdown and JSON, or a full backup.

**Readers.** Anyone the page is shared with who isn't the owner sees only the reader view:
- published chapters;
- lore that is spoiler-safe: an entity appears only from the chapter that names it, and a secret only from the chapter that reveals it.

They never see the studio, because the access rules make `studio/` readable by the owner alone.

**Without the platform.** Without the `db` capability the page runs in sketchbook mode and keeps everything in this browser. Without `sample`, inking and plates are off, but painting, writing by hand and setting all still work, and plates already painted still show.

## Files

| Path | What it is |
| --- | --- |
| `src/core.js` | All logic that has to be exactly right, as pure functions shared by the page and the tests: briefs, parsing model output, pin matching, authorship spans, the ledger, publishing, exports (including a stored-ZIP EPUB writer), backups |
| `src/atlas.js` | The atlas: cleans a world's spec, grows its land, rivers, regions, places and roads from seeded noise, and draws the map as SVG. Also the briefs for dreaming a world, drawing an atlas and exploring a region. Pure, shared by the page and the tests |
| `src/plates.js` | The plate painter: cleans a composition and paints it as an ink-wash SVG with seeded brushes, and writes the plate brief. Pure, shared by the page, the exports and the tests |
| `src/app.js` | The page: storage through `claude.use('db')`, the canvas score, the views, the calls to `sample` and `downloads` |
| `src/styles.css`, `src/page.html` | Look and markup |
| `build.mjs` | Inlines everything into `dist/index.html` and copies the example world beside it |
| `dream-example.json` | The dream behind *The Drained Sea* and the world grown from it, composed in place of the model; the page builds the example world from it with no call to Claude |
| `example-world.json` | The Hollow Moon, as a backup file. It has a set scene, a stale scene, a wet scene, a scene ready to ink, and seven plates. Regenerate it with `tools/make-example.mjs` |
| `tools/example-docs.mjs` | The example as database documents, used to seed the artifact and by the end-to-end test |
| `test/core.test.mjs` | 45 unit tests |
| `test/e2e.mjs` | 28 browser steps against a fake claude.ai runtime |

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
- **There's no undo.** Back up a world before big changes.
- **A repaint can't include a pinned line.**
- **Untested here:**
  - real `sample` calls in the live viewer, which spend the viewer's own usage after a consent prompt;
  - the real `downloads` prompt.

  The tests cover both with a fake runtime.
