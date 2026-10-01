# Dream Canvas

Draw a place from a dream, and see it real:
- **Gemini** paints your sketch as a real place, widens it into a panorama and sets it moving.
- **World Labs** builds it into a 3D world you can walk through.

It runs as a small server on your own computer, because a page on claude.ai can't hold API keys or reach these models. The server keeps your keys away from the browser and keeps every scene in a folder on your disk. There is nothing to install beyond Node 18 or later.

## What it does

- **Draw.**
  - Tools: pen, brush (for areas), fill and eraser, with nine colours, undo and redo.
  - With an Apple Pencil or an S Pen, the pen line follows your pressure. Once a pen has touched the paper, a resting palm is ignored.
  - Shortcuts: P, B, F and E pick a tool, [ and ] change the size, Ctrl+Z undoes and Ctrl+Shift+Z redoes.
- **Make it real.**
  - Gemini's picture model (Nano Banana) paints the sketch as a photo, a film still, a painting or a storybook page.
  - It keeps the sketch's layout: where things stand, the horizon, the sense of scale.
  - The sketch sweeps away to reveal the picture. A slider then lets you compare the two.
- **See all around it.** The same place, widened into a 21:9 panorama you can drag across.
- **Make it move.** Veo turns the picture into a 4, 6 or 8 second video.
  - Say what moves: "the lamp turns, gulls wheel over the flats".
  - Or leave it blank for wind, water, light, small lives and a slow drift forward.
- **Step inside.**
  - World Labs (Marble) builds a 3D world from the panorama, or from the picture if there's no panorama.
  - Walk through it right in the page: W A S D or the arrow keys to move, drag to look, Shift to run, Escape to leave.
  - Or open it in Marble.
- **Paint it again.**
  - Each painting is a take, with its own panorama, video and world.
  - You can go back to any earlier take. Nothing you've made, or paid for, is thrown away.
- **Keep to your world.**
  - Load an Inkwash backup (in Inkwash: "Back up this world" in the Book view) and pick the place you're drawing.
  - The place's facts and the world's rules go into every prompt, so the picture doesn't contradict your canon.
  - Secret and retired facts stay behind.

## Run it

1. Get the keys:
   - `GEMINI_API_KEY`, from https://aistudio.google.com/apikey. It covers pictures and video. Google charges for each picture and each second of video, so the key's project needs billing turned on.
   - `WORLDLABS_API_KEY`, from https://platform.worldlabs.ai/api-keys. It covers worlds. It's optional: without it, everything but "Step inside" works.
2. Start the server from the repository's root:
   ```
   GEMINI_API_KEY=... WORLDLABS_API_KEY=... node inkwash/canvas/server.mjs
   ```
3. Open http://localhost:8787.

The header shows what's connected. If Google refuses the key, it says so there.

**Draw on a tablet.**
- Start the server with `--lan`, then open the "on your Wi-Fi" link it prints on the iPad or Galaxy Tab.
- The link carries a passcode. Without it, the canvas answers nothing but the empty page.
- Anyone on the same Wi-Fi who has the link can use your keys, so use `--lan` only on a network you trust.

**Try it without keys.** `node inkwash/canvas/server.mjs --fake` runs everything with stand-ins:
- your sketch comes back as the picture;
- videos and worlds finish after a few seconds;
- "Walk inside" opens a small stand-in valley.

Nothing is charged.

**Other options:**
- `--port 8787`.
- `--data <folder>`: where scenes are kept. The default is `inkwash/canvas/data`, which git ignores.
- `GEMINI_IMAGE_MODEL` and `GEMINI_VIDEO_MODEL` pin a model. By default the server asks Google which models the key can use. It picks the newest Nano Banana (`gemini-3.1-flash-image` first) and the cheapest Veo 3.1 (Lite first, then Fast).

## What it costs

Rough prices; the panel shows them for the models in use.

| Step | Service | About |
| --- | --- | --- |
| Make it real, paint it again | Gemini 3.1 Flash Image | 5¢ a picture (13¢ with a Pro model) |
| See all around it | Gemini 3.1 Flash Image | 5¢ |
| Make it move | Veo 3.1 Lite / Fast / standard | 5¢ / 10¢ / 40¢ a second |
| Step inside, quick | Marble 1.0 draft | $0.12–0.20 |
| Step inside, full | Marble 1.1 | $1.20 |

## What is sent where

- **Gemini** gets:
  - the sketch, or the picture you're widening or moving;
  - your words;
  - the style;
  - if you loaded a world: its title, its premise, the place's facts and its rules.
- **World Labs** gets the panorama (or the picture) and your words. Worlds are made private (`public: false`) and tagged `inkwash`.
- **Your disk** keeps everything in `data/`:
  - `scenes/` holds one JSON file per scene;
  - `media/` holds sketches, pictures, videos and world files.

  Deleting a scene deletes all its files.
- **The browser** never sees the keys.

Without `--lan`, the server listens only on this computer. It also refuses any request from another website open in the same browser, or from another site's name pointed at this computer: either could otherwise spend your credit.

## Files

| File | What it is |
| --- | --- |
| `server.mjs` | The server: scenes, takes, jobs, media, security. No dependencies. |
| `lib/providers.mjs` | Gemini, Veo and World Labs: request bodies, answers, errors, and the stand-ins. |
| `public/index.html`, `style.css` | The page. |
| `public/app.js` | Drawing, the panel, the views, the gallery. |
| `public/walk.js` | The walk: three.js and Spark, loaded from their CDNs only when you step inside. |
| `test/` | Unit tests for the providers and the server, and an end-to-end test in Chromium. |

## Test

```
node --test 'inkwash/canvas/test/*.test.mjs'   # providers and server
node inkwash/canvas/test/e2e.mjs [--shots]     # the page, start to finish
```

The end-to-end test needs Playwright installed globally. It takes the page from the first stroke through a refusal, making it real, widening, a video, a world, walking inside, a second take with an Inkwash world's canon, a reload and a delete. three.js and Spark are fetched once from npm into `test/.cache`, so the walk is tested without their CDNs.

## Known limits

- **Not yet run against the live services.**
  - The requests and answers follow the official SDKs (`@google/genai` 2.25 and the World Labs OpenAPI client) and are unit-tested against those shapes.
  - The first real run may still turn up a detail they don't show.
  - Errors are passed through word for word, so whatever goes wrong will say what it is.
- **The picture is a new painting, not an exact trace.** The model keeps the layout, but it may move or change small things.
- **The panorama is painted fresh at 21:9**, with the picture at its centre. It isn't an exact outpainting, so details near the middle can shift.
- **Worlds take minutes**, and a draft world is rough at the edges. Walking needs WebGL2. Phones and tablets load a lighter version of each world.
- **One person at a time.** The server is for you, not for a crowd.
