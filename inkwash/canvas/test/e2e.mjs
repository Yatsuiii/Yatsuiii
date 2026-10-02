// End-to-end test: drives the canvas in Chromium against the server with stand-in providers, from
// the first stroke to walking inside the world. three.js and Spark are fetched once from npm into
// test/.cache and served in place of their CDN, so the walk is tested offline too.
//   node inkwash/canvas/test/e2e.mjs [--shots]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import * as P from '../lib/providers.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(join(execSync('npm root -g').toString().trim(), 'playwright'));
const HERE = fileURLToPath(new URL('.', import.meta.url));
const CACHE = join(HERE, '.cache'), SHOTS = join(HERE, 'shots');
const wantShots = process.argv.includes('--shots');

// the libraries the page's import map names, at the same versions, and for stepping inside a
// picture on the device: transformers.js, the ONNX runtime it runs on, and the open depth model
const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';
function ensureLibs() {
  const pack = (name, spec, tgz) => {
    const dir = join(CACHE, name);
    if (existsSync(join(dir, 'package', 'package.json'))) return join(dir, 'package');
    if (!existsSync(join(CACHE, tgz))) execSync(`npm pack ${spec} --silent`, { cwd: CACHE, stdio: 'ignore', timeout: 180000 });
    mkdirSync(dir, { recursive: true });
    execSync(`tar -xzf ${JSON.stringify(join(CACHE, tgz))} -C ${JSON.stringify(dir)}`);
    return join(dir, 'package');
  };
  let libs = null;
  try {
    mkdirSync(CACHE, { recursive: true });
    libs = { three: pack('three', 'three@0.180.0', 'three-0.180.0.tgz'), spark: pack('spark', '@sparkjsdev/spark@2.3.1', 'sparkjsdev-spark-2.3.1.tgz') };
  } catch (e) {
    console.log(`  (three.js and Spark could not be fetched from npm: ${e.message.split('\n')[0]}; the walk is checked for a clear failure instead)`);
    return null;
  }
  try {
    const tv = /transformers@([\w.-]+)\//.exec(readFileSync(join(HERE, '../public/depthworld.js'), 'utf8'))[1];
    const transformers = pack('transformers', `@huggingface/transformers@${tv}`, `huggingface-transformers-${tv}.tgz`);
    const ov = JSON.parse(readFileSync(join(transformers, 'package.json'), 'utf8')).dependencies['onnxruntime-web'];
    const ort = pack('ort', `onnxruntime-web@${ov}`, `onnxruntime-web-${ov}.tgz`);
    const hf = join(CACHE, 'hf'), model = join(hf, DEPTH_MODEL, 'resolve/main');
    for (const f of ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx']) {
      if (existsSync(join(model, f))) continue;
      mkdirSync(dirname(join(model, f)), { recursive: true });
      execSync(`curl -sSfL --max-time 300 -o ${JSON.stringify(join(model, f))} https://huggingface.co/${DEPTH_MODEL}/resolve/main/${f}`, { stdio: 'ignore' });
    }
    libs.depth = { tv, ov, transformers, ort, hf };
  } catch (e) {
    console.log(`  (the depth model could not be fetched: ${e.message.split('\n')[0]}; stepping inside on the device is skipped)`);
  }
  return libs;
}

// The stand-in providers, plus a picture model that refuses when asked to, for the error path.
function providers() {
  const f = P.fake(), paints = [];
  const paint = Object.assign({}, f, {
    async paint(req) {
      paints.push(req);
      if (/please refuse/i.test(req.prompt)) throw new P.ProviderError('the request was blocked (SAFETY)', 'no_image');
      return f.paint(req);
    },
  });
  return { fake: true, paint, world: f.world, paints };
}

async function serve(dataDir, prov) {
  const server = createServer(createApp({ dataDir, providers: prov, token: null }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function main() {
  const libs = ensureLibs();
  const dataDir = mkdtempSync(join(tmpdir(), 'dream-canvas-'));
  const prov = providers();
  const { server, base } = await serve(dataDir, prov);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  if (libs) {
    const from = (root) => async (route) => {
      const url = new URL(route.request().url());
      const rel = root === libs.spark ? 'dist/spark.module.js' : url.pathname.replace(/^\/npm\/three@0\.180\.0\//, '');
      const file = join(root, rel);
      if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not cached' });
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(file) });
    };
    await context.route('https://cdn.jsdelivr.net/npm/three@0.180.0/**', from(libs.three));
    await context.route('https://sparkjs.dev/releases/spark/2.3.1/spark.module.js', from(libs.spark));
    if (libs.depth) {
      const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
      const local = (root, prefix) => async (route) => {
        const file = join(root, decodeURIComponent(new URL(route.request().url()).pathname).slice(prefix.length));
        if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not cached' });
        return route.fulfill({ status: 200, contentType: TYPES[extname(file)] || 'application/octet-stream', body: readFileSync(file), headers: { 'access-control-allow-origin': '*' } });
      };
      const { tv, ov } = libs.depth;
      await context.route(`https://cdn.jsdelivr.net/npm/@huggingface/transformers@${tv}/dist/**`, local(join(libs.depth.transformers, 'dist'), `/npm/@huggingface/transformers@${tv}/dist`));
      await context.route(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${ov}/dist/**`, local(join(libs.depth.ort, 'dist'), `/npm/onnxruntime-web@${ov}/dist`));
      await context.route('https://huggingface.co/**', local(libs.depth.hf, ''));
    }
  }
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const shot = async (name) => { if (wantShots) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, name + '.png') }); } };
  const step = (name) => console.log('  ✓ ' + name);
  // wait for a walk to open, then measure how much of what's on screen is lit (a WebGL canvas
  // can't be read back once shown, so this reads a screenshot)
  async function seeWalk(name, timeout = 90000) {
    await page.waitForFunction(() => document.querySelector('#walk-view canvas') && !document.querySelector('#walk-view .pending'), null, { timeout });
    const frames = () => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
    await frames();
    await page.waitForTimeout(1000);
    await frames();
    const png = await page.screenshot({ clip: await page.locator('#walk-view').boundingBox(), timeout: 120000 });
    if (wantShots) { mkdirSync(SHOTS, { recursive: true }); writeFileSync(join(SHOTS, name + '.png'), png); }
    return page.evaluate(async (src) => {
      const im = new Image();
      im.src = src;
      await im.decode();
      const probe = document.createElement('canvas');
      probe.width = 64; probe.height = 36;
      const g = probe.getContext('2d');
      g.drawImage(im, 0, 0, 64, 36);
      const d = g.getImageData(0, 0, 64, 36).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) n++;
      return n / (64 * 36);
    }, 'data:image/png;base64,' + png.toString('base64'));
  }
  // every request that leaves this computer, to show which steps need nobody else
  const away = [];
  page.on('request', (r) => { const h = new URL(r.url()).hostname; if (h !== '127.0.0.1' && !r.url().startsWith('data:')) away.push(h); });
  const scenes = () => readdirSync(join(dataDir, 'scenes')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dataDir, 'scenes', f), 'utf8')));
  const pixel = (x, y) => page.evaluate(([x, y]) => [...document.querySelector('#paper').getContext('2d').getImageData(x, y, 1, 1).data], [x, y]);
  const box = async () => page.locator('#paper').boundingBox();
  // a stroke in paper coordinates (the paper is 1600 by 900)
  async function stroke(points) {
    const b = await box(), at = ([x, y]) => [b.x + (x / 1600) * b.width, b.y + (y / 900) * b.height];
    await page.mouse.move(...at(points[0]));
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(...at(p), { steps: 8 });
    await page.mouse.up();
  }

  try {
    await page.goto(base + '/');
    await page.waitForSelector('#status .pill');
    assert.match(await page.textContent('#status'), /Stand-in mode/);
    assert.equal(await page.isDisabled('#undo'), true);
    assert.equal(await page.isDisabled('#views [data-view=real]'), true);
    assert.match(await page.textContent('#gallery'), /Nothing yet/);
    step('opens in stand-in mode with an empty gallery');

    // an empty page can't be made real
    await page.click('#make');
    assert.match(await page.textContent('#error'), /Draw something first/);

    // a horizon, a box of a house, and the sky filled in blue
    await stroke([[0, 520], [400, 500], [800, 540], [1200, 500], [1600, 520]]);
    await stroke([[700, 520], [700, 380], [900, 380], [900, 520]]);
    assert.equal(await page.isDisabled('#undo'), false);
    assert.deepEqual((await pixel(800, 200)).slice(0, 3), [255, 255, 255]);
    await page.click('#swatches [aria-label=Sky]');
    await page.click('[data-tool=fill]');
    const b = await box();
    await page.mouse.click(b.x + (800 / 1600) * b.width, b.y + (200 / 900) * b.height);
    assert.deepEqual((await pixel(800, 200)).slice(0, 3), [0x4a, 0x90, 0xd9], 'the sky is filled');
    assert.deepEqual((await pixel(800, 700)).slice(0, 3), [255, 255, 255], 'the fill stops at the horizon');
    await page.click('#undo');
    assert.deepEqual((await pixel(800, 200)).slice(0, 3), [255, 255, 255], 'undo takes the fill back');
    await page.click('#redo');
    assert.deepEqual((await pixel(800, 200)).slice(0, 3), [0x4a, 0x90, 0xd9], 'redo puts it back');
    await page.keyboard.press('p');
    assert.equal(await page.getAttribute('[data-tool=pen]', 'aria-pressed'), 'true');
    step('draws, fills an area, undoes and redoes');

    if (libs && libs.depth) {
      await page.setViewportSize({ width: 880, height: 560 }); // the lighter scene, and a smaller view, for software WebGL
      away.length = 0;
      await page.click('#walk-sketch');
      await page.waitForSelector('#walk:not([hidden])');
      const lit = await seeWalk('0-sketch-walk', 240000);
      assert.ok(lit > 0.5, `the sketch is a scene around you (${Math.round(lit * 100)}% lit)`);
      assert.deepEqual([...new Set(away)].filter((h) => !['cdn.jsdelivr.net', 'huggingface.co', 'sparkjs.dev'].includes(h)), [], 'only open libraries and the open model are fetched');
      assert.equal(scenes().length, 0, 'nothing was sent to the server, let alone a service');
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1400, height: 1000 });
      step(`steps into the sketch, on this device, with no service (${Math.round(lit * 100)}% lit)`);
    }

    // the picture model refuses: the error is shown and nothing is saved
    await page.fill('#dream', 'please refuse this one');
    await page.click('#make');
    await page.waitForSelector('#error:not([hidden])');
    assert.match(await page.textContent('#error'), /blocked.*Try other words/);
    assert.equal(scenes().length, 0);
    assert.equal(readdirSync(join(dataDir, 'media')).length, 0, 'the refused sketch is not kept');
    step('shows a refusal plainly and keeps nothing');

    await page.fill('#dream', 'A lighthouse on the rim of a drained sea, its lamp still turning at dawn');
    await page.click('#styles [data-style=painted]');
    await page.click('#make');
    await page.waitForSelector('#result .compare');
    await page.waitForFunction(() => document.querySelector('#result .compare').style.getPropertyValue('--cut') === '0%', null, { timeout: 8000 });
    assert.equal(await page.getAttribute('#views [data-view=real]', 'aria-current'), 'true');
    assert.equal(await page.isHidden('#make'), true);
    assert.equal(await page.isVisible('#next'), true);
    let [scene] = scenes();
    assert.equal(scene.takes.length, 1);
    assert.equal(scene.style, 'painted');
    assert.match(prov.paints.at(-1).prompt, /concept art/);
    assert.match(prov.paints.at(-1).prompt, /drained sea/);
    assert.equal(prov.paints.at(-1).aspect, '16:9');
    await page.waitForSelector('#gallery .card');
    await shot('1-real');
    step('makes it real: the sketch sweeps away to the picture, and the scene is saved');

    await page.click('#widen');
    await page.waitForSelector('#result .wide-scroll img');
    assert.equal(prov.paints.at(-1).aspect, '21:9');
    assert.match(prov.paints.at(-1).prompt, /panoramic/);
    step('widens it into a panorama');

    await page.fill('#motion', 'the lamp turns and gulls wheel over the salt flats');
    await page.selectOption('#seconds', '4');
    assert.match(await page.textContent('#move-cost'), /Veo/);
    await page.click('#move');
    await page.waitForSelector('#result .pending');
    assert.equal(await page.isDisabled('#move'), true, 'one video at a time');
    await page.waitForSelector('#result video', { timeout: 20000 });
    [scene] = scenes();
    assert.equal(scene.takes[0].video.status, 'done');
    assert.equal(scene.takes[0].video.seconds, 4);
    assert.ok(existsSync(join(dataDir, scene.takes[0].video.file)));
    step('sets it moving, and finds the video when it is ready');

    await page.click('#world');
    await page.waitForSelector('#result .pending');
    await page.waitForSelector('#walk-in', { timeout: 20000 });
    [scene] = scenes();
    assert.equal(scene.takes[0].world3d.status, 'done');
    assert.equal(scene.takes[0].world3d.from, scene.takes[0].wide, 'the world grows from the panorama');
    await shot('2-world');
    step('builds a world from the panorama');

    await page.setViewportSize({ width: 960, height: 600 }); // software WebGL is slow; a smaller view keeps it moving
    await page.click('#walk-in');
    await page.waitForSelector('#walk:not([hidden])');
    if (libs) {
      const lit = await seeWalk('3-walk');
      assert.ok(lit > 0.2, `the world is visible (${Math.round(lit * 100)}% of the view is lit)`);
      await page.keyboard.down('w'); await page.waitForTimeout(400); await page.keyboard.up('w');
      step(`walks inside the world (${Math.round(lit * 100)}% of the view lit)`);
    } else {
      await page.waitForFunction(() => /Couldn't open the world/.test(document.querySelector('#walk-view').textContent), null, { timeout: 30000 });
      step('says plainly when the world viewer cannot load');
    }
    [scene] = scenes();
    const splat = Object.values(scene.takes[0].world3d.files)[0];
    assert.ok(splat && existsSync(join(dataDir, splat)), 'the world file is kept beside the scene');
    await page.keyboard.press('e'); // up, in the world; not the eraser
    await page.keyboard.press('Escape');
    assert.equal(await page.isHidden('#walk'), true);
    await page.setViewportSize({ width: 1400, height: 1000 });
    assert.equal(await page.locator('#walk-view canvas').count(), 0);
    assert.equal(await page.getAttribute('[data-tool=pen]', 'aria-pressed'), 'true', 'keys pressed while walking did not change the tool');
    step('closes the walk with Escape');

    if (libs && libs.depth) {
      await page.setViewportSize({ width: 880, height: 560 });
      const before = scenes()[0].files.length;
      await page.click('#walk-here');
      await page.waitForSelector('#walk:not([hidden])');
      const lit = await seeWalk('3b-free-walk', 240000);
      assert.ok(lit > 0.5, `the picture is a scene around you (${Math.round(lit * 100)}% lit)`);
      assert.equal(scenes()[0].files.length, before, 'no world service was asked');
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1400, height: 1000 });
      step(`steps inside the picture, on this device, for free (${Math.round(lit * 100)}% lit)`);
    }

    // an Inkwash world: its canon goes with the next painting, its secrets don't
    const backup = {
      format: 'inkwash-backup/1',
      world: { title: 'The Drained Sea', premise: 'A sea that drained in a night, leaving its towns on the salt.' },
      entities: [
        { id: 'e_light', kind: 'place', name: 'The Last Light', facts: [{ text: 'The lighthouse lamp burns green.' }, { text: 'Its keeper is a traitor.', secret: true }, { text: 'It once stood on an island.', retired: true }] },
        { id: 'e_flats', kind: 'place', name: 'The Salt Flats', facts: [] },
        { id: 'e_rule', kind: 'rule', name: 'Salt remembers', facts: [{ text: 'Footprints in salt never fade.' }] },
      ],
    };
    await page.setInputFiles('#world-file', { name: 'drained-sea-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.waitForSelector('#place:not([hidden])');
    await page.selectOption('#place', 'e_light');
    assert.match(await page.textContent('#world-note'), /The Drained Sea/);
    await page.click('[data-tool=pen]');
    await stroke([[1100, 300], [1150, 250], [1200, 300]]);
    await page.click('#again');
    await page.waitForSelector('#takes:not([hidden]) .take >> nth=1');
    const prompt = prov.paints.at(-1).prompt;
    assert.match(prompt, /THE PLACE: The Last Light/);
    assert.match(prompt, /lamp burns green/);
    assert.match(prompt, /Footprints in salt never fade/);
    assert.doesNotMatch(prompt, /traitor|island/, 'secret and retired facts stay behind');
    [scene] = scenes();
    assert.equal(scene.takes.length, 2);
    assert.equal(scene.take, 1);
    assert.notEqual(scene.takes[1].sketch, scene.takes[0].sketch, 'the changed sketch was sent');
    assert.equal(scene.world.place.name, 'The Last Light');
    assert.equal(await page.isDisabled('#views [data-view=moving]'), true, 'the new painting starts fresh');
    step('paints again with an Inkwash world\'s canon, leaving its secrets out');

    await page.click('#takes .take >> nth=0');
    await page.waitForSelector('#views [data-view=moving]:not([disabled])');
    assert.equal(scenes()[0].take, 0);
    await page.click('#views [data-view=moving]');
    await page.waitForSelector('#result video');
    step('goes back to the first painting, with its video and world');

    await page.reload();
    await page.waitForSelector('#gallery .card');
    const tags = await page.textContent('#gallery .card .tags');
    assert.match(tags, /2 paintings/);
    assert.match(tags, /moving/);
    assert.match(tags, /world/);
    await page.click('#gallery .card');
    await page.waitForSelector('#result .compare');
    assert.equal(await page.inputValue('#dream'), 'A lighthouse on the rim of a drained sea, its lamp still turning at dawn');
    assert.equal(await page.getAttribute('#styles [data-style=painted]', 'aria-checked'), 'true');
    assert.match(await page.textContent('#world-note'), /canon of The Drained Sea, at The Last Light/);
    assert.notDeepEqual((await pixel(800, 200)).slice(0, 3), [255, 255, 255], 'the sketch is back on the paper');
    await shot('4-reopened');
    step('keeps everything across a reload, and reopens a scene from the gallery');

    await page.click('#delete');
    await page.waitForSelector('#gallery :text("Nothing yet")');
    assert.equal(scenes().length, 0);
    assert.deepEqual(readdirSync(join(dataDir, 'media')), [], 'every file of the scene is gone');
    assert.equal(await page.isVisible('#make'), true);
    step('deletes a scene and all its files');

    assert.deepEqual(problems, []);
    console.log('\nAll end-to-end checks passed.');
  } finally {
    await browser.close();
    server.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
