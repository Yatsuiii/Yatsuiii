# Inkwash on Quest (first prototype)

A world's map rises from your table, and you open its places by touching them.

- **Seated and hands-first.** The map appears on a table in front of you, 40 cm ahead and 43 cm
  below your eyes.
- **Touch a place's pin** with a fingertip, and its page stands up behind the map with everything
  the canon holds about it.
- **Pinch above the map** and turn your hand to turn the map, like a lazy Susan.
- **Controllers** point and pull the trigger. **On a computer,** the same page is a desktop
  preview: drag to turn, click to open.

It runs Inkwash's own code: the canon from `../v0/src/core.js`, and the land, places and ink map
from `../v0/src/atlas.js`. The map is the atlas's own drawing, draped over the relief the atlas
grows, with place names standing above their pins instead of printed under them.

**Status: built and tested in an emulator, not yet on a headset.**

- The browser test runs the built page in Chromium inside IWER, Meta's WebXR emulator, as a
  Quest 3 with tracked hands. Hand poses come from the emulator.
- How hand tracking *feels*, how passthrough looks, how legible the text is, and how fast it loads
  on a real Quest are **not verified**.

**Content:** made-up only. The one world is The Drained Sea, Inkwash's dreamed example.

## Files

| File | What it is |
| --- | --- |
| `src/diorama.js` | A world's atlas as a table-sized diorama: the land's heights, and a marker for every place and feature with its canon facts. Pure: no DOM, no three.js |
| `src/poke.js` | Pressing with a fingertip: once per touch, again only after drawing back; turning by a pinch. Pure |
| `src/board.js` | The diorama as three.js objects: the paper board, the land rising out of the map, the pins and their names |
| `src/page.js` | A place's page, drawn like a page of the studio's codex, as tall as what it says |
| `src/main.js` | The app: the room, entering the headset, placing the map, hands, controllers, the mouse, the emulator |
| `scripts/prepare.mjs` | Copies the core, the atlas and the example world into `public/` before every build |
| `test/diorama.test.mjs`, `test/poke.test.mjs` | 14 unit tests |
| `test/xr.e2e.mjs` | 8 browser steps: the desktop preview, then the emulated Quest 3 |

## Run it

```sh
cd inkwash/vr
npm install
npm run dev            # the desktop preview, on localhost
npm test               # 14 unit tests
npm run build          # the page, in dist/
npm run e2e            # 8 browser steps; add -- --shots for screenshots in test-shots/
```

`?emulate` at the end of the address puts the page inside IWER, as a Quest 3 with hands. The tests
use this. It has no on-screen controls for moving the hands yet.

The browser test uses the Playwright that's installed globally (`npm root -g`) and its Chromium.

## On a Quest

WebXR needs the page served over HTTPS. There are two ways, and neither is set up yet:

- **Host the built `dist/` folder,** for example on GitHub Pages. The page and its example world
  would then be public.
- **Serve it from your own computer over HTTPS** on your Wi-Fi, with a self-signed certificate the
  Quest browser asks you to accept.

Then, on the Quest:

1. Sit at a table and open the address in the Quest browser.
2. Choose **Enter with passthrough**, or **Enter VR**.

## How it's put together

**Placement.**
- When a session starts, the map is placed in front of where you're looking, level with the floor,
  40 cm ahead and 43 cm below your eyes.
- In passthrough nothing else is drawn, so the map sits in your room. In VR it stands on a wooden
  table in a dim room.

**Pressing.**
- Every pin has a generous 2 cm target.
- A press happens when the fingertip reaches it. Another press needs the fingertip to draw back
  1.5 cm first, so resting on a pin presses it once.
- Reaching for a pin lights it and shows its name.

**The page.**
- It stands behind the map, a little below eye level, facing you.
- Lines of sight to the map pass under it, and its close button is within reach.
- A thin line joins it to its pin.

**Turning.** A pinch over the map turns it about its centre by as much as your hand moves round it.
Letting go leaves it where it is.

**Controllers.** A controller's ray picks the nearest target it passes through. A hand's own
pinch-select is ignored there, so a pinch only turns the map.

## Next

- Snap the map to a real table, using the headset's plane detection.
- Move the map with both hands.
- Scenes on the map: where each scene happens, and which go stale when a fact changes.
- A world of your own, from a studio backup, and a showcase world once you've chosen which of its
  parts can be public.
- Sound for the rise, and on-screen controls for the emulator.
- Whether to move to Meta's Immersive Web SDK, which builds on the same three.js.
