// Browser test: the built page in Chromium, first as the desktop preview, then inside IWER,
// Meta's WebXR emulator, as a Quest 3 with tracked hands. A seated reader enters, the map rises
// in front of them, a fingertip opens a place, the page's close button closes it, a pinch turns
// the map, and a controller's ray opens a place too.
// Run after `npm run build`: node test/xr.e2e.mjs [--shots]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(join(execSync('npm root -g').toString().trim(), 'playwright'));
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const SHOTS = fileURLToPath(new URL('../test-shots/', import.meta.url));
const wantShots = process.argv.includes('--shots');
if (wantShots) mkdirSync(SHOTS, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(DIST, path === '/' ? 'index.html' : path);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });

let failed = 0;
async function step(name, fn) {
  try { await fn(); console.log('ok  ', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n    ', String(e && e.stack || e).split('\n').slice(0, 6).join('\n     ')); }
}
async function open(query) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(BASE + (query || ''));
  await page.waitForFunction(() => window.__inkvr && (window.__inkvr.ready || window.__inkvr.error), null, { timeout: 60000 });
  const err = await page.evaluate(() => window.__inkvr.error);
  if (err) throw new Error('the page failed to start: ' + err);
  return { page, ctx, errors };
}
const shot = async (page, name) => { if (wantShots) await page.screenshot({ path: join(SHOTS, name + '.png') }); };
const near = (a, b, tol, what) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tol, `${what}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);

// ---------------------------------------------------------------- the desktop preview

await step('the desktop preview: the dreamed world\'s map rises, and clicking a place opens its page', async () => {
  const { page, ctx, errors } = await open('');
  assert.equal(await page.evaluate(() => window.__inkvr.world), 'The Drained Sea');
  assert.equal((await page.evaluate(() => window.__inkvr.places)).length, 28, '24 places and 4 features of the land');
  await page.waitForFunction(() => window.__inkvr.risen, null, { timeout: 20000 });
  assert.match(await page.textContent('#note'), /desktop preview/, 'no headset: it says this is the preview');
  await shot(page, 'desktop-preview');
  const [x, y] = await page.evaluate(() => window.__inkvr.project('Harrowgate'));
  await page.mouse.click(x, y);
  await page.waitForFunction(() => window.__inkvr.open === 'Harrowgate');
  const pg = await page.evaluate(() => window.__inkvr.page());
  assert.ok(pg.facts.some((f) => /lamplit terraces/.test(f)), 'its page carries its canon facts');
  await page.waitForTimeout(150);
  await shot(page, 'desktop-page');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ---------------------------------------------------------------- inside the emulated headset

const { page: xr, ctx: xrCtx, errors: xrErrors } = await open('?emulate');
const dev = (fn, arg) => xr.evaluate(fn, arg);
const frames = (n = 3) => xr.evaluate((k) => new Promise((ok) => { let i = 0; const f = () => (++i >= k ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
let right = -1;

// moves the emulated right hand until its index fingertip is at `want` (closed loop: the app
// reports where the fingertip is, and the hand is moved by the difference)
async function fingertipTo(want, tol = 0.0015) {
  for (let i = 0; i < 40; i++) {
    const tip = (await dev(() => window.__inkvr.tips()))[right];
    assert.ok(tip, 'the right fingertip is tracked');
    const d = [want[0] - tip[0], want[1] - tip[1], want[2] - tip[2]];
    if (Math.hypot(...d) <= tol) return;
    await dev((dd) => { const p = window.__xrDevice.hands.right.position; p.x += dd[0]; p.y += dd[1]; p.z += dd[2]; }, d);
    await frames(2);
  }
  throw new Error('the fingertip did not get there');
}
const above = (p, h) => [p[0], p[1] + h, p[2]];

await step('a Quest 3 is offered both passthrough and VR, and entering raises the map in front of a seated reader', async () => {
  assert.equal(await xr.isVisible('#enter-ar'), true);
  assert.equal(await xr.isVisible('#enter-vr'), true);
  assert.match(await xr.textContent('#note'), /Sit at a table/);
  await xr.click('#enter-vr');
  await xr.waitForFunction(() => window.__inkvr.mode === 'vr');
  assert.equal(await xr.evaluate(() => window.__inkvr.risen), false, 'the map starts flat');
  if (wantShots) {
    for (const [at, name] of [[0.02, 'xr-rise-1'], [0.15, 'xr-rise-2'], [0.7, 'xr-rise-3']]) {
      await xr.waitForFunction((a) => window.__inkvr.rise() >= a, at, { timeout: 20000 });
      await shot(xr, name);
    }
  }
  await xr.waitForFunction(() => window.__inkvr.risen, null, { timeout: 20000 });
  near(await dev(() => window.__inkvr.board()), [0, 0.72, -0.4], 0.02, '40 cm ahead, at table height for a seated reader');
  await shot(xr, 'xr-risen');
});

await step('both hands are tracked, and the right fingertip is reported', async () => {
  await xr.waitForFunction(() => window.__inkvr.handedness().filter(Boolean).length === 2, null, { timeout: 10000 });
  right = (await dev(() => window.__inkvr.handedness())).indexOf('right');
  assert.ok(right >= 0);
  await dev(() => { window.__xrDevice.hands.right.poseId = 'point'; });
  await frames(3);
  assert.ok((await dev(() => window.__inkvr.tips()))[right], 'a fingertip to poke with');
});

await step('reaching for a place lights it; touching it opens its page beside the map', async () => {
  const m = await dev(() => window.__inkvr.marker('Harrowgate'));
  await fingertipTo(above(m.p, 0.15));
  await frames(3);
  assert.equal(await dev(() => window.__inkvr.marker('Harrowgate').hovered), false, 'far above: nothing yet');
  await fingertipTo(above(m.p, m.r + 0.03));
  await frames(3);
  assert.equal(await dev(() => window.__inkvr.marker('Harrowgate').hovered), true, 'reaching for it lights it');
  assert.equal(await dev(() => window.__inkvr.open), null, 'and opens nothing yet');
  await fingertipTo(above(m.p, m.r * 0.5));
  await frames(3);
  assert.equal(await dev(() => window.__inkvr.open), 'Harrowgate');
  const pg = await dev(() => window.__inkvr.page());
  assert.ok(pg.facts.some((f) => /lamplit terraces/.test(f)) && pg.facts.some((f) => /Harbour Lords/.test(f)), 'its facts, as the canon keeps them');
  await shot(xr, 'xr-page');
  const presses = await dev(() => window.__inkvr.presses);
  await frames(10);
  assert.equal(await dev(() => window.__inkvr.presses), presses, 'resting the finger there presses once, not again and again');
});

await step('the page\'s close button closes it, and another place opens just as easily', async () => {
  const m = await dev(() => window.__inkvr.marker('Harrowgate'));
  await fingertipTo(above(m.p, 0.08));
  await frames(2);
  const c = await dev(() => window.__inkvr.close());
  assert.ok(c, 'the page has a close button');
  await fingertipTo([c[0], c[1], c[2] + 0.06]);
  await frames(2);
  await fingertipTo(c);
  await frames(3);
  assert.equal(await dev(() => window.__inkvr.open), null, 'closed');
  await fingertipTo([c[0], c[1], c[2] + 0.08]);
  for (const name of ['Sela', 'Mount Hiss']) {
    const t = await dev((n) => window.__inkvr.marker(n), name);
    await fingertipTo(above(t.p, 0.08));
    await frames(2);
    await fingertipTo(above(t.p, t.r * 0.5));
    await frames(3);
    assert.equal(await dev(() => window.__inkvr.open), name, `${name} opens`);
    await fingertipTo(above(t.p, 0.08));
    await frames(2);
  }
  assert.match((await dev(() => window.__inkvr.page())).facts.join(' '), /volcano/, 'a feature of the land has its page too');
});

await step('a pinch above the map turns it, and letting go leaves it turned', async () => {
  const b = await dev(() => window.__inkvr.board());
  const yaw0 = await dev(() => window.__inkvr.yaw());
  // above the map's right-hand side, clear of the pins
  await fingertipTo([b[0] + 0.25, b[1] + 0.11, b[2] + 0.12]);
  await dev(() => window.__xrDevice.hands.right.updatePinchValue(1));
  await xr.waitForFunction(() => window.__inkvr.turning(), null, { timeout: 5000 });
  const p0 = await dev((i) => window.__inkvr.pinch(i), right);
  const a0 = Math.atan2(p0.z - b[2], p0.x - b[0]);
  // sweep the pinch a quarter of the way round, towards the far side
  for (let k = 1; k <= 6; k++) {
    const a = a0 - (k / 6) * 0.6, r = Math.hypot(p0.x - b[0], p0.z - b[2]);
    const tip = (await dev(() => window.__inkvr.tips()))[right];
    const pin = await dev((i) => window.__inkvr.pinch(i), right);
    const want = [b[0] + Math.cos(a) * r, pin.y, b[2] + Math.sin(a) * r];
    await dev((dd) => { const p = window.__xrDevice.hands.right.position; p.x += dd[0]; p.z += dd[2]; }, [want[0] - pin.x, 0, want[2] - pin.z]);
    await frames(2);
    void tip;
  }
  const pin = await dev((i) => window.__inkvr.pinch(i), right);
  const moved = Math.atan2(pin.z - b[2], pin.x - b[0]) - a0;
  const turned = (await dev(() => window.__inkvr.yaw())) - yaw0;
  assert.ok(Math.abs(turned) > 0.4, `the map turned (${turned.toFixed(2)} rad)`);
  assert.ok(Math.abs(turned + moved) < 0.08, `by as much as the hand moved round it (${turned.toFixed(2)} vs ${(-moved).toFixed(2)})`);
  await dev(() => window.__xrDevice.hands.right.updatePinchValue(0));
  await xr.waitForFunction(() => !window.__inkvr.turning(), null, { timeout: 5000 });
  const settled = await dev(() => window.__inkvr.yaw());
  await dev(() => { window.__xrDevice.hands.right.position.x -= 0.1; });
  await frames(4);
  assert.equal(await dev(() => window.__inkvr.yaw()), settled, 'let go: it stays where it was turned');
  await shot(xr, 'xr-turned');
});

await step('with controllers instead of hands, pointing at a place and pulling the trigger opens it', async () => {
  if (await dev(() => window.__inkvr.open)) {
    const c = await dev(() => window.__inkvr.close());
    await fingertipTo([c[0], c[1], c[2] + 0.06]); await frames(2); await fingertipTo(c); await frames(3);
  }
  await dev(() => { window.__xrDevice.primaryInputMode = 'controller'; });
  await frames(4);
  const t = await dev(() => window.__inkvr.marker('Pomona'));
  // hold the right controller beside the reader and aim it at Pomona's pin
  await dev((target) => {
    const c = window.__xrDevice.controllers.right;
    c.position.set(0.18, 1.0, -0.12);
    const dx = target[0] - 0.18, dy = target[1] - 1.0, dz = target[2] + 0.12, n = Math.hypot(dx, dy, dz);
    // the rotation taking (0, 0, -1) to the direction of the pin
    const ax = [0, 0, -1], d = [dx / n, dy / n, dz / n];
    const cx = ax[1] * d[2] - ax[2] * d[1], cy = ax[2] * d[0] - ax[0] * d[2], cz = ax[0] * d[1] - ax[1] * d[0];
    const w = 1 + (ax[0] * d[0] + ax[1] * d[1] + ax[2] * d[2]), l = Math.hypot(cx, cy, cz, w);
    c.quaternion.set(cx / l, cy / l, cz / l, w / l);
  }, t.p);
  await frames(3);
  await dev(() => window.__xrDevice.controllers.right.updateButtonValue('trigger', 1));
  await frames(3);
  await dev(() => window.__xrDevice.controllers.right.updateButtonValue('trigger', 0));
  await frames(3);
  assert.equal(await dev(() => window.__inkvr.open), 'Pomona');
  await shot(xr, 'xr-controller');
  await dev(() => { window.__xrDevice.primaryInputMode = 'hand'; });
});

await step('passthrough: the same map sits in the room with nothing drawn around it', async () => {
  await dev(() => window.__xrDevice.activeSession && window.__xrDevice.activeSession.end());
  await xr.waitForFunction(() => window.__inkvr.mode === 'desktop', null, { timeout: 10000 });
  await xr.click('#enter-ar');
  await xr.waitForFunction(() => window.__inkvr.mode === 'ar' && window.__inkvr.risen, null, { timeout: 20000 });
  near(await dev(() => window.__inkvr.board()), [0, 0.72, -0.4], 0.02, 'placed in front of the reader again');
  await shot(xr, 'xr-passthrough');
  assert.deepEqual(xrErrors, []);
});

await xrCtx.close();
await browser.close();
server.close();
console.log(failed ? `\n${failed} step(s) failed` : '\nall steps passed');
process.exit(failed ? 1 : 0);
