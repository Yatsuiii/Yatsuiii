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
- **Step inside, free, on your device.**
  - An open depth model, Depth Anything V2 Small (Apache-2.0), runs in the browser. It reads how far away everything in the picture is.
  - The page then turns the picture into a 3D scene of soft splats:
    - each disc lies on the surface it belongs to;
    - the background is carried on behind near edges;
    - a haze of the picture's own colours fills what it doesn't show.
  - You can look around and take a few steps. The picture never leaves your devices, no key is needed and nothing is charged.
  - It works on the panorama, the picture, or the sketch itself ("Step into the sketch", before anything is made). A sketch becomes a little paper-theatre stage; a realistic picture becomes a convincing place.
- **Or build a whole world with World Labs.**
  - Marble builds a fuller 3D world from the panorama, or from the picture if there's no panorama. It's paid, on your World Labs key.
  - Walk through it right in the page, or open it in Marble.
- **Walking**, either way: W A S D or the arrow keys to move, drag to look, Shift to run, Escape to leave.
- **Paint it again.**
  - Each painting is a take, with its own panorama, video and world.
  - You can go back to any earlier take. Nothing you've made, or paid for, is thrown away.
- **Keep to your world.**
  - Load an Inkwash backup (in Inkwash: "Back up this world" in the Book view) and pick the place you're drawing.
  - The place's facts and the world's rules go into every prompt, so the picture doesn't contradict your canon.
  - Secret and retired facts stay behind.

## Run it

1. Get the keys:
   - `GEMINI_API_KEY`, for pictures and video. Either kind of Google key works:
     - an AI Studio key (`AIza…`) from https://aistudio.google.com/apikey goes through the Gemini API;
     - a Google Cloud key (`AQ.…`, Vertex AI) goes through Vertex AI, and its videos come with sound.

     The canvas tries the Gemini API first, for either kind, and Vertex AI if that refuses the key. Google charges for each picture and each second of video, so the key's project needs billing turned on.
   - `WORLDLABS_API_KEY`, from https://platform.worldlabs.ai/api-keys, for worlds. It's optional: without it, everything but building a whole world works, including stepping inside on your device.
2. Start the server from the repository's root:
   ```
   GEMINI_API_KEY=... WORLDLABS_API_KEY=... node inkwash/canvas/server.mjs
   ```
3. Open http://localhost:8787.

In a Claude Code cloud environment, start it with `NODE_USE_ENV_PROXY=1` in front: Node's own fetch ignores the environment's proxy otherwise.

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
- `GEMINI_IMAGE_MODEL` and `GEMINI_VIDEO_MODEL` pin a model. By default it takes the newest Nano Banana (`gemini-3.1-flash-image` first) and the cheapest Veo 3.1 (Lite first, then Fast):
  - with an AI Studio key, it first asks Google which models the key can use;
  - on Vertex AI, it moves down the list past any model the project doesn't have.

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
- **World Labs** gets the panorama (or the picture) and your words, only when you build a whole world. Worlds are made private (`public: false`) and tagged `inkwash`.
- **Stepping inside on your device** sends nothing. The browser fetches two open things once, then keeps them in its cache: the transformers.js library (Apache-2.0) from jsdelivr, and the depth model's weights (27 MB, 50 MB on a graphics card) from Hugging Face.
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
| `public/depthworld.js` | Stepping inside on the device: runs the open depth model in the browser. |
| `public/depth3d.js` | From a picture and its depth to splats, and splats to a standard PLY. Pure, so it's unit-tested. |
| `test/` | Unit tests for the providers, the server and the scene builder, and an end-to-end test in Chromium. |

## Test

```
node --test 'inkwash/canvas/test/*.test.mjs'   # providers, server, scene builder
node inkwash/canvas/test/e2e.mjs [--shots]     # the page, start to finish
```

The end-to-end test needs Playwright installed globally. It takes the page through, in order:
- the first stroke;
- stepping into the sketch;
- a refusal;
- making it real, widening, a video and a world;
- walking inside both ways;
- a second take with an Inkwash world's canon;
- a reload and a delete.

three.js, Spark, transformers.js and its runtime are fetched once from npm into `test/.cache`, and the depth model from Hugging Face. So both walks are tested without the CDNs, and the test checks that stepping inside on the device asks no service.

## Known limits

- **First live run (October 2026).**
  - World Labs: a quick world was built and read back for real. A finished operation names only part of its world, so the canvas always reads the world itself too. A draft world from a 16:9 picture cost 230 credits (80 to make the panorama, 150 for the world).
  - Google: a Google Cloud key often works on the Gemini API too, so the canvas asks the Gemini API first and uses Vertex AI only if that refuses the key. Picture and video models aren't in the Gemini API's free tier: the key's project needs billing turned on, and the canvas says so when Google answers "limit: 0". Pictures, panoramas and video haven't been run live yet.
  - Errors are passed through word for word, so whatever goes wrong will say what it is.
- **The picture is a new painting, not an exact trace.** The model keeps the layout, but it may move or change small things.
- **The panorama is painted fresh at 21:9**, with the picture at its centre. It isn't an exact outpainting, so details near the middle can shift.
- **Worlds take minutes**, and a draft world is rough at the edges. Walking needs WebGL2. Phones and tablets load a lighter version of each world.
- **A scene from one picture is whole only from near where it was taken.**
  - What the picture doesn't show isn't there: behind things, beyond its edges.
  - So the walk keeps you within a step or two of the start, and turning far shows the haze.
  - World Labs fills all of that in; that's what its whole worlds are for.
- **Stepping inside on a phone** uses the lighter scene (150,000 splats instead of 500,000). The first time, it waits for the model download.
- **One person at a time.** The server is for you, not for a crowd.
