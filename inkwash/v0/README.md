# Inkwash v0

The first working version of the studio described in `../DESIGN.md`.

It runs as a single page published as a claude.ai artifact:
- **Live:** https://claude.ai/artifact/TxYpHeRRTDSLLg9mPj3DeK
- **Access:** private to its owner until it's shared from the page's Share menu.
- **Example:** it opens on an example world, *The Hollow Moon*.

## What it does

**Score.** Each chapter is a canvas you paint:
- a tension curve;
- mood washes, in pigments you name;
- a line for each character, where they appear.

Pins (your own sentences) and notes attach to scenes. Arrow keys and number keys paint too, so the score works from the keyboard.

**Ink.** "Ink this scene" sends the scene's brief to Claude on the viewer's own Claude account and streams the scene in as wet ink. You can see the brief under the scene. It is built from what you painted, your pins and notes, the relevant canon (with secrets fenced off until their chapter), the text around the scene, and your voice sample.

- **Repaint:** select words and give a direction; only that range changes.
- **Set with your seal:** dries the ink. It's blocked while a pinned line is missing.

**Ledger.** Setting a scene records the version of every fact it used. When you reword or retire a fact, the scenes that relied on it glow as stale, with the old and new wording side by side. From there you can:
- mark the scene **Still true**;
- edit it;
- repaint the part that's wrong;
- ink it again.

This is stalefence's premise ledger applied to a story. Scenes are also checked against the canon after inking, and contradictions are highlighted.

**Authorship.** Every character of a scene is recorded as **typed**, **pinned** or **inked** (by the model). The hand meter shows your share for each scene and for the whole book. The provenance export lists who wrote what.

**Canon, Dreams, Book.**
- **Canon:** versioned facts, each showing which scenes use it.
- **Dreams:** an inbox where Claude suggests seeds from a fragment, and nothing joins the canon until you keep it.
- **Book:** shows the whole book. From here you can:
  - publish a chapter (blocked while any scene is wet, stale, a draft, or missing a pin);
  - preview the reader view;
  - export as EPUB, HTML, Markdown, the bible as JSON, the provenance report as Markdown and JSON, or a full backup.

**Readers.** Anyone the page is shared with who isn't the owner sees only the reader view:
- published chapters;
- lore that is spoiler-safe: an entity appears only from the chapter that names it, and a secret only from the chapter that reveals it.

They never see the studio, because the access rules make `studio/` readable by the owner alone.

**Without the platform.** Without the `db` capability the page runs in sketchbook mode and keeps everything in this browser. Without `sample`, inking is off but painting, writing by hand and setting all still work.

## Files

| Path | What it is |
| --- | --- |
| `src/core.js` | All logic that has to be exactly right, as pure functions shared by the page and the tests: briefs, parsing model output, pin matching, authorship spans, the ledger, publishing, exports (including a stored-ZIP EPUB writer), backups |
| `src/app.js` | The page: storage through `claude.use('db')`, the canvas score, the views, the calls to `sample` and `downloads` |
| `src/styles.css`, `src/page.html` | Look and markup |
| `build.mjs` | Inlines everything into `dist/index.html` and copies the example world beside it |
| `example-world.json` | The Hollow Moon, as a backup file. It has a set scene, a stale scene, a wet scene and a scene ready to ink. Regenerate it with `tools/make-example.mjs` |
| `tools/example-docs.mjs` | The example as database documents, used to seed the artifact and by the end-to-end test |
| `test/core.test.mjs` | 21 unit tests |
| `test/e2e.mjs` | 19 browser steps against a fake claude.ai runtime |

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
published/<world>                   the public face: title, chapter list, spoiler-safe lore
published/<world>/chapters/<id>     published chapter text
```

## Where v0 differs from the design

- **Model tiers.** Repainting a selection uses the `default` tier, because waiting on `complex` for a sentence is too slow. Whole scenes use `complex`, continuity checks use `default`, and dream seeds use `quick`.
- **No PDF.** The viewer can't print and there is no PDF library on the page. EPUB and HTML cover reading.
- **Threads.** The score derives "first time these two share a scene" by itself. There are no marks for fights or exits yet.
- **Lanes.** The pace and secrets lanes are deferred, as planned. Secrets work through canon facts marked secret, each with the chapter that reveals it.
- **A small library.** v0 includes publishing and the reader view (the design had put them later), because stage 0 is showing your world to ten readers.
- **Several worlds.** v0 holds more than one world, so the example and your own world can live side by side.

## Known limits

- **One author.** Readers must be signed in to claude.ai, and the page must be shared with them.
- **The "facts used" list comes from the model.**
  - When the model returns no list, Inkwash records every fact about anyone the scene names. It flags too much rather than too little.
  - Strict continuity is coarse: any change to anyone on the page.
- **There's no undo.** Back up a world before big changes.
- **A repaint can't include a pinned line.**
- **Untested here:**
  - real `sample` calls in the live viewer, which spend the viewer's own usage after a consent prompt;
  - the real `downloads` prompt.

  The tests cover both with a fake runtime.
