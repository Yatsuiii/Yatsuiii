// End-to-end test: drives the built page in Chromium against a fake claude.ai runtime (db, sample,
// user, downloads). Run after `node build.mjs`: node inkwash/v0/test/e2e.mjs [--shots]
import { createRequire } from 'node:module';
import { execSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { exampleDocs } from '../tools/example-docs.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(join(execSync('npm root -g').toString().trim(), 'playwright'));
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const SHOTS = fileURLToPath(new URL('../test-shots/', import.meta.url));
const wantShots = process.argv.includes('--shots');
const WID = 'w_hollow_moon';

// The fake runtime, injected before the page's scripts run.
function mockClaude(cfg) {
  const docs = new Map(Object.entries(cfg.seed || {}).map(([p, b]) => [p, JSON.stringify(b)]));
  const listeners = new Set();
  const M = (window.__mock = { docs, saves: [], calls: [], writes: 0 });
  const parent = (p) => p.split('/').slice(0, -1).join('/');
  const snap = (p, body) => ({ id: p.split('/').pop(), exists: body != null, data: () => (body == null ? undefined : JSON.parse(body)), metadata: { fromCache: false, hasPendingWrites: false } });
  const deliver = (l) => {
    const paths = [...docs.keys()].filter((p) => parent(p) === l.coll).sort();
    const changes = [];
    const next = new Map(paths.map((p) => [p, docs.get(p)]));
    for (const p of paths) {
      if (!l.prev.has(p)) changes.push({ type: 'added', doc: snap(p, docs.get(p)) });
      else if (l.prev.get(p) !== docs.get(p)) changes.push({ type: 'modified', doc: snap(p, docs.get(p)) });
    }
    for (const [p, old] of l.prev) if (!next.has(p)) changes.push({ type: 'removed', doc: snap(p, old) });
    const first = !l.started;
    l.started = true; l.prev = next;
    if (!first && !changes.length) return;
    l.fn({ docs: paths.map((p) => snap(p, docs.get(p))), size: paths.length, empty: !paths.length, docChanges: () => changes, metadata: { fromCache: false, hasPendingWrites: false } });
  };
  const notify = () => setTimeout(() => listeners.forEach(deliver), 5);
  const db = {
    doc(path) {
      return {
        id: path.split('/').pop(), path,
        get: async () => snap(path, docs.get(path)),
        set: async (data) => {
          if (cfg.owner === false && path.startsWith('studio')) throw { code: 'invalid_argument', message: 'not allowed' };
          const s = JSON.stringify(data);
          if (s.length > 262144) throw { code: 'invalid_argument', message: 'document over 256 KiB' };
          M.writes++;
          docs.set(path, s); notify();
        },
        delete: async () => { docs.delete(path); notify(); },
      };
    },
    collection(path) {
      return {
        path,
        onSnapshot(fn) {
          if (cfg.owner === false && path.startsWith('studio')) { setTimeout(() => fn({ docs: [], size: 0, empty: true, docChanges: () => [], metadata: {} }), 5); return () => {}; }
          const l = { coll: path, fn, prev: new Map(), started: false };
          listeners.add(l); setTimeout(() => deliver(l), 5);
          return () => listeners.delete(l);
        },
      };
    },
  };
  const user = {
    isOwner: async () => cfg.owner !== false, canEdit: async () => cfg.owner !== false, can: async () => null,
    id: async () => 'u_test', me: async () => ({ id: 'u_test', name: '', avatarUrl: '', color: '#888', email: null, isOwner: cfg.owner !== false, canEdit: cfg.owner !== false }),
  };
  function sample(input, opts) {
    opts = opts || {};
    M.calls.push({ kind: 'text', input: String(input), tier: opts.modelTier, cache: opts.cache });
    let text;
    if (String(input).startsWith('You are repainting part of a scene')) {
      text = 'Kael climbed with his eyes shut, counting, and did not look at the seam.\n===LEDGER===\n{"used": ["F1"], "new": []}';
    } else {
      const pins = [...String(input).matchAll(/^ {2}\d+\. (.+)$/gm)].map((m) => m[1]);
      text = 'Kael climbed the last of the stairs with the lamp still swinging. Vesk lay below him, nine hundred lamps and one dark one.\n\n'
        + (pins.length ? pins.join(' ') + '\n\n' : '')
        + 'He counted to four and then forgot what came after four.\n===LEDGER===\n{"used": ["F1", "F2", "F99"], "new": [{"about": "Kael", "fact": "Kael is afraid of heights."}]}';
    }
    return new Promise((resolve, reject) => {
      let i = 0;
      const step = () => {
        if (opts.signal && opts.signal.aborted) { reject({ code: 'cancelled', message: 'aborted', text: text.slice(0, i) }); return; }
        i = Math.min(text.length, i + 40);
        if (opts.onText) opts.onText({ text: text.slice(0, i), delta: text.slice(i - 40, i) });
        if (i >= text.length) resolve({ text, truncated: false, modelTierApplied: opts.modelTier || 'default' });
        else setTimeout(step, cfg.slow ? 60 : 8);
      };
      setTimeout(step, 20);
    });
  }
  sample.json = async (input, opts) => {
    M.calls.push({ kind: 'json', input: String(input), tier: opts && opts.modelTier });
    if (String(input).startsWith('You are checking one scene')) return { conflicts: [{ fact: 'F1', quote: 'forgot what came after four', why: 'A test contradiction.' }] };
    if (String(input).includes('caught this fragment')) return { seeds: [{ kind: 'place', name: 'The Candle Gardens', fact: 'Inside the moon, candles grow like tulips.' }] };
    return {};
  };
  sample.limits = async () => ({ maxPromptBytes: 262144 });
  const downloads = {
    save: async ({ filename, data }) => {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      M.saves.push({ filename, b64: btoa(bin) });
      return { status: 'saved' };
    },
  };
  const caps = { db: cfg.noDb ? null : db, user, sample: cfg.noSample ? null : sample, downloads };
  if (!cfg.noClaude) window.claude = { use: async (name) => (name in caps ? caps[name] : null) };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
const server = createServer((req, res) => {
  const p = join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(DIST) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
let failures = 0;
async function step(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n     ')); }
}
async function open(cfg, viewport, scheme) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1400, height: 950 }, colorScheme: scheme || 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test((m.location() || {}).url || '') && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push('console: ' + m.text() + ' @ ' + ((m.location() || {}).url || '')); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.addInitScript(mockClaude, cfg);
  await page.goto(BASE + 'index.html');
  return { page, ctx, errors };
}
const st = (page, fn) => page.evaluate(fn);
async function settle(page) { await page.evaluate(() => window.__inkwash.flush()); await page.waitForTimeout(80); }

// ---------------------------------------------------------------- the owner's studio
const { page, ctx, errors } = await open({ seed: exampleDocs(WID) });

await step('opens the seeded example world in the score', async () => {
  await page.waitForSelector('.score-view', { timeout: 8000 });
  assert.match(await page.textContent('#banners'), /Example world\./);
  assert.equal(await page.locator('.rail-item').count(), 2);
  assert.equal(await page.inputValue('#chapter-title'), 'Nine Hundred Lamps');
  assert.equal(await page.textContent('#scene-pill'), 'Set');
  const dots = await page.locator('.rail-item').first().locator('.dot').evaluateAll((els) => els.map((e) => e.dataset.state));
  assert.deepEqual(dots, ['set', 'stale', 'wet']);
});

await step('the stale scene explains what changed', async () => {
  await page.click('.sheet-nav button[aria-label="Next scene"]');
  await page.waitForSelector('.stale-box');
  const box = await page.textContent('.stale-box');
  assert.match(box, /Kael is seventeen\./);
  assert.match(box, /Kael is sixteen\./);
});

await step('painting tension on an unpainted scene', async () => {
  await page.click('.rail-item >> nth=1');
  await page.waitForFunction(() => document.querySelector('#chapter-title').value === 'The Door in the Moon');
  const box = await page.locator('#score-canvas').boundingBox();
  const lay = await page.evaluate(() => ({ x0: Math.min(96, document.querySelector('#score-canvas').clientWidth * 0.22) }));
  const x1 = box.width - 14;
  const sx = (f) => box.x + lay.x0 + f * (x1 - lay.x0);
  const before = await st(page, () => window.__inkwash.state.chapters.get('c_door').tension.slice(84).filter((v) => v != null).length);
  assert.equal(before, 0);
  await page.mouse.move(sx(0.7), box.y + 40 + 100);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(sx(0.7 + (0.29 * i) / 12), box.y + 40 + 100 - i * 7);
  await page.mouse.up();
  await settle(page);
  const after = await st(page, () => window.__inkwash.state.chapters.get('c_door').tension.slice(84).filter((v) => v != null).length);
  assert.ok(after > 25, `painted ${after} samples`);
  const saved = await st(page, () => JSON.parse(window.__mock.docs.get('studio/w_hollow_moon/chapters/c_door')));
  assert.ok(saved.strokes >= 10, 'the stroke was counted and saved');
});

await step('keyboard painting raises a scene’s tension', async () => {
  await page.focus('#score-canvas');
  const t0 = await st(page, () => window.__inkwash.state.chapters.get('c_door').tension[5]);
  await page.keyboard.press('ArrowUp');
  await settle(page);
  const t1 = await st(page, () => window.__inkwash.state.chapters.get('c_door').tension[5]);
  assert.ok(Math.abs(t1 - t0 - 0.05) < 1e-9, `${t0} -> ${t1}`);
});

await step('inking a scene streams wet ink, keeps the pin and checks continuity', async () => {
  await page.click('.sheet-nav button[aria-label="Previous scene"]').catch(() => {});
  await page.evaluate(() => { window.__inkwash.state.k = 0; });
  await page.click('.rail-item >> nth=1');
  await page.waitForSelector('button:has-text("Ink this scene")');
  await page.click('button:has-text("Ink this scene")');
  await page.waitForSelector('#passage-text', { timeout: 8000 });
  const call = await st(page, () => window.__mock.calls.find((c) => c.kind === 'text'));
  assert.equal(call.tier, 'complex');
  assert.equal(call.cache, false);
  assert.ok(call.input.includes('1. The moon had a door in it, and the door was open.'));
  assert.ok(call.input.includes('THE STORY JUST BEFORE THIS SCENE'), 'the wet scene before it is context');
  const p = await st(page, () => window.__inkwash.state.passages.get('c_door__s1'));
  assert.ok(p.text.includes('The moon had a door in it, and the door was open.'));
  assert.ok(p.spans.some((x) => x.o === 'pinned' && !x.wet));
  assert.ok(p.spans.some((x) => x.o === 'inked' && x.wet));
  assert.equal(p.pending.length, 2, 'two known facts used; the unknown F99 is ignored');
  assert.equal(p.proposals.length, 1);
  assert.equal(await page.textContent('#scene-pill'), 'Wet ink');
  await page.waitForSelector('.conflict', { timeout: 5000 });
  assert.match(await page.textContent('.conflict'), /forgot what came after four/);
  assert.equal(await page.locator('.h-conflict').count(), 1);
});

await step('keeping a suggested fact adds it to the canon', async () => {
  await page.click('.proposal button:has-text("Keep")');
  await settle(page);
  const kael = await st(page, () => window.__inkwash.state.canon.get('e_kael'));
  assert.ok(kael.facts.some((f) => f.text === 'Kael is afraid of heights.' && f.origin === 'accepted'));
});

await step('typing by hand is recorded as the author’s', async () => {
  await page.click('#passage-text');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' He did not look down.');
  await settle(page);
  const p = await st(page, () => window.__inkwash.state.passages.get('c_door__s1'));
  assert.ok(p.text.endsWith('He did not look down.'));
  assert.ok(p.spans.some((x) => x.o === 'typed' && p.text.slice(x.s, x.e).includes('did not look down')));
  assert.match(await page.textContent('#scene-meter'), /\d+% your hand/);
});

await step('setting with the seal dries the ink and records premises', async () => {
  await page.click('#set-button');
  await page.waitForSelector('.seal-mark');
  await settle(page);
  const p = await st(page, () => window.__inkwash.state.passages.get('c_door__s1'));
  assert.equal(p.spans.some((x) => x.wet), false);
  assert.equal(p.premises.length, 2);
  assert.equal(await page.textContent('#scene-pill'), 'Set');
  const saved = await st(page, () => JSON.parse(window.__mock.docs.get('studio/w_hollow_moon/passages/c_door__s1')));
  assert.ok(saved.setAt > 0);
});

await step('rewording a fact flags exactly the scenes that used it, and still-true clears it', async () => {
  const used = await st(page, () => window.__inkwash.state.passages.get('c_door__s1').premises.map((x) => x.f));
  await page.click('.tab >> text=Canon');
  await page.waitForSelector('.cards');
  const fid = used.find((f) => f.startsWith('f_kael'));
  await page.fill('#fact-' + fid, 'Kael counts lamps when he is afraid, never stairs.');
  await page.keyboard.press('Tab');
  await page.waitForSelector('.toast.warn', { timeout: 4000 });
  const msg = await page.textContent('.toast.warn');
  assert.match(msg, /now flagged: .*chapter 2, scene 1/);
  await page.click('.toast.warn button:has-text("Show me")');
  await page.waitForSelector('.stale-box');
  await page.click('.stale-box button:has-text("Still true")');
  try { await page.waitForFunction(() => document.querySelector('#scene-pill').textContent === 'Set', null, { timeout: 4000 }); }
  catch (err) {
    const dbg = await page.evaluate(() => {
      const S = window.__inkwash.state;
      return { cid: S.cid, k: S.k, pill: document.querySelector('#scene-pill').textContent, p: S.passages.get('c_door__s1'), kael: S.canon.get('e_kael').facts.map((f) => [f.id, f.v, f.text]) };
    });
    console.log(JSON.stringify({ cid: dbg.cid, k: dbg.k, pill: dbg.pill, premises: dbg.p.premises, kael: dbg.kael }));
    const again = await page.evaluate(async () => {
      const btn = document.querySelector('.stale-box .btn.seal');
      const out = { found: !!btn, text: btn && btn.textContent, disabled: btn && btn.disabled };
      if (btn) btn.click();
      await new Promise((r) => setTimeout(r, 200));
      out.premises = window.__inkwash.state.passages.get('c_door__s1').premises;
      out.pill = document.querySelector('#scene-pill').textContent;
      return out;
    });
    console.log(JSON.stringify(again));
    throw err;
  }
});

await step('repainting a selection changes only those words', async () => {
  const before = await st(page, () => window.__inkwash.state.passages.get('c_door__s1').text);
  const s = before.indexOf('He counted');
  const e = before.indexOf('after four.') + 'after four.'.length;
  await page.evaluate(([s, e]) => { const ta = document.querySelector('#passage-text'); ta.focus(); ta.setSelectionRange(s, e); ta.dispatchEvent(new Event('select')); }, [s, e]);
  await page.waitForSelector('#repaint-direction');
  await page.fill('#repaint-direction', 'colder');
  await page.click('.selection-bar button[type=submit]');
  await page.waitForFunction(() => window.__inkwash.state.passages.get('c_door__s1').text.includes('did not look at the seam'), null, { timeout: 6000 });
  const call = await st(page, () => window.__mock.calls.filter((c) => c.kind === 'text').pop());
  assert.equal(call.tier, 'default');
  assert.ok(call.input.includes('DIRECTION: colder'));
  assert.ok(call.input.includes('⟦He counted to four'));
  const p = await st(page, () => window.__inkwash.state.passages.get('c_door__s1'));
  assert.equal(p.text, before.slice(0, s) + 'Kael climbed with his eyes shut, counting, and did not look at the seam.' + before.slice(e));
  const wet = p.spans.filter((x) => x.wet);
  assert.equal(wet.length, 1);
  assert.equal(p.text.slice(wet[0].s, wet[0].e), 'Kael climbed with his eyes shut, counting, and did not look at the seam.');
  assert.equal(await page.textContent('#scene-pill'), 'Wet ink');
});

await step('publishing is blocked by wet ink, then goes through once set', async () => {
  await page.click('.tab >> text=Book');
  await page.waitForSelector('.book-page');
  await page.click('#ch-c_door button:has-text("Publish chapter")');
  await page.waitForSelector('#ch-c_door .problems');
  assert.match(await page.textContent('#ch-c_door .problems'), /Scene 1 is still wet/);
  await page.click('#ch-c_door .scene-block button:has-text("Open in the score")');
  await page.click('#set-button');
  await page.click('.tab >> text=Book');
  await page.click('#ch-c_door button:has-text("Publish chapter")');
  await settle(page);
  const pubCh = await st(page, () => JSON.parse(window.__mock.docs.get('published/w_hollow_moon/chapters/c_door')));
  assert.equal(pubCh.scenes.length, 1);
  const pubWorld = await st(page, () => window.__mock.docs.get('published/w_hollow_moon'));
  assert.ok(pubWorld, 'the public world document exists');
  assert.ok(!pubWorld.includes('The Hollow Queen'), 'the Queen never appears in published text, so neither she nor her secret is published');
  assert.ok(pubWorld.includes('apprentice in the lamplighters'), 'public facts about Kael are published');
  assert.equal(await page.locator('#ch-c_lamps .problems').count(), 0);
});

await step('chapter 1 cannot be published while a scene is stale or wet', async () => {
  await page.click('#ch-c_lamps button:has-text("Publish chapter")');
  const probs = await page.textContent('#ch-c_lamps .problems');
  assert.match(probs, /Scene 2 is stale/);
  assert.match(probs, /Scene 3 is still wet/);
  assert.equal(await st(page, () => window.__mock.docs.has('published/w_hollow_moon/chapters/c_lamps')), false);
});

await step('exports: EPUB, provenance report and bible', async () => {
  await page.click('.exports >> text=EPUB');
  await page.click('.exports >> text=Who wrote what (Markdown)');
  await page.click('.exports >> text=The bible (JSON)');
  await page.waitForFunction(() => window.__mock.saves.length >= 3);
  const saves = await st(page, () => window.__mock.saves);
  const epub = saves.find((x) => x.filename === 'the-hollow-moon.epub');
  assert.ok(epub);
  const py = spawnSync('python3', ['-c', 'import base64,io,sys,zipfile\nz=zipfile.ZipFile(io.BytesIO(base64.b64decode(sys.stdin.read())))\nassert z.testzip() is None\nn=z.namelist()\nassert n[0]=="mimetype" and z.read("mimetype")==b"application/epub+zip"\nprint(len(n), "OEBPS/ch2.xhtml" in n, b"Rain came to Vesk" in z.read("OEBPS/ch1.xhtml"))'], { input: epub.b64 });
  assert.equal(py.stderr.toString(), '');
  assert.equal(py.stdout.toString().trim(), '9 True True');
  const prov = Buffer.from(saves.find((x) => x.filename === 'the-hollow-moon-provenance.md').b64, 'base64').toString();
  assert.match(prov, /# How "The Hollow Moon" was made/);
  assert.match(prov, /Written by the author \(typed or pinned\): \d+ \(\d+%\)/);
  const bible = JSON.parse(Buffer.from(saves.find((x) => x.filename === 'the-hollow-moon-bible.json').b64, 'base64').toString());
  assert.equal(bible.format, 'inkwash-bible/1');
  assert.ok(bible.entities.some((e) => e.name === 'The Brass Ladder'));
});

await step('dream inbox: catch a fragment, find seeds, keep one', async () => {
  await page.click('.tab >> text=Dreams');
  await page.fill('#dream-new', 'A garden inside the moon where candles grow.');
  await page.click('.dream-form button[type=submit]');
  await page.waitForSelector('.dream >> text=A garden inside the moon');
  await page.click('.dream:has-text("A garden inside the moon") >> text=Find seeds');
  await page.waitForSelector('.dream:has-text("A garden inside the moon") .seed');
  const call = await st(page, () => window.__mock.calls.filter((c) => c.kind === 'json').pop());
  assert.equal(call.tier, 'quick');
  await page.click('.dream:has-text("A garden inside the moon") .seed >> text=Keep');
  await settle(page);
  const names = await st(page, () => [...window.__inkwash.state.canon.values()].map((e) => e.name));
  assert.ok(names.includes('The Candle Gardens'));
});

await step('reader preview shows the published chapter', async () => {
  await page.click('.tab >> text=Book');
  await page.click('text=Read it as a reader');
  await page.waitForSelector('.reader');
  assert.match(await page.textContent('.reader article'), /The moon had a door in it/);
  assert.match(await page.textContent('.reader article'), /How this book was made: .* wrote \d+% of the words by hand/);
  await page.click('text=Back to the studio');
});

await step('a new world starts from the form', async () => {
  await page.selectOption('#world-select', '__new');
  await page.waitForSelector('#world-form');
  await page.fill('#wf-title', 'Salt Kingdoms');
  await page.click('#world-form >> text=Create world');
  await page.waitForSelector('.page-head >> text=What is true in Salt Kingdoms');
  await page.fill('#new-entity-name', 'Odile');
  await page.click('text=Add to canon');
  await page.waitForSelector('.card[aria-label="Odile"]');
  await settle(page);
  const worlds = await st(page, () => [...window.__mock.docs.keys()].filter((k) => /^studio\/[^/]+$/.test(k)).length);
  assert.equal(worlds, 2);
});

if (wantShots) {
  mkdirSync(SHOTS, { recursive: true });
  await page.selectOption('#world-select', WID);
  await page.click('.tab >> text=Score');
  await page.waitForSelector('.score-view');
  await page.click('.rail-item >> nth=0');
  await page.click('.sheet-nav button[aria-label="Next scene"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, 'score-light.png'), fullPage: true });
}
const studioDocs = await st(page, () => Object.fromEntries([...window.__mock.docs].map(([k, v]) => [k, JSON.parse(v)])));
assert.deepEqual(errors, []);
await ctx.close();

// ---------------------------------------------------------------- a reader who isn't the owner
await step('a reader sees published chapters and spoiler-safe lore, never the studio', async () => {
  const r = await open({ owner: false, seed: studioDocs });
  await r.page.waitForSelector('.reader');
  const text = await r.page.textContent('.reader');
  assert.match(text, /The Door in the Moon/);
  assert.match(text, /What you know so far/);
  assert.ok(!text.includes('Rain came to Vesk'), 'unpublished chapter 1 stays private');
  assert.equal(await r.page.locator('.sheet, .score-view, #world-select').count(), 0);
  assert.deepEqual(r.errors, []);
  await r.ctx.close();
});

await step('sketchbook mode when the db capability is absent', async () => {
  const r = await open({ noDb: true });
  await r.page.waitForSelector('.welcome');
  assert.match(await r.page.textContent('#banners'), /Sketchbook mode/);
  await r.page.click('.choice button:has-text("Open the example world")');
  await r.page.waitForSelector('.score-view');
  await r.page.evaluate(() => window.__inkwash.flush());
  await r.page.waitForFunction(() => (localStorage.getItem('inkwash.sketchbook') || '').includes('The Hollow Moon'), null, { timeout: 5000 });
  assert.deepEqual(r.errors, []);
  await r.ctx.close();
});

await step('outside claude.ai, inking is off and writing by hand still works', async () => {
  const r = await open({ noClaude: true });
  await r.page.waitForSelector('.welcome');
  await r.page.click('.choice button:has-text("Open the example world")');
  await r.page.waitForSelector('.score-view');
  assert.match(await r.page.textContent('#banners'), /Inking is off/);
  await r.page.click('.rail-item >> nth=1');
  await r.page.waitForSelector('button:has-text("Write it yourself")');
  assert.equal(await r.page.locator('button:has-text("Ink this scene")').count(), 0);
  await r.page.click('button:has-text("Write it yourself")');
  await r.page.waitForSelector('#passage-text');
  await r.page.keyboard.type('The moon had a door in it, and the door was open. Kael knocked.');
  await r.page.click('#set-button');
  await r.page.waitForSelector('.seal-mark');
  const p = await r.page.evaluate(() => window.__inkwash.state.passages.get('c_door__s1'));
  assert.equal(C_hand(p), 1);
  assert.deepEqual(r.errors, []);
  await r.ctx.close();
});
function C_hand(p) { return p.spans.every((x) => x.o !== 'inked') ? 1 : 0; }

if (wantShots) {
  for (const [name, vp, scheme] of [['score-dark', { width: 1400, height: 950 }, 'dark'], ['score-phone', { width: 390, height: 844 }, 'light'], ['book-phone-dark', { width: 390, height: 844 }, 'dark']]) {
    const r = await open({ seed: exampleDocs(WID) }, vp, scheme);
    await r.page.waitForSelector('.score-view');
    if (name.startsWith('book')) { await r.page.click('.tab >> text=Book'); await r.page.waitForSelector('.book-page'); }
    else { await r.page.click('.sheet-nav button[aria-label="Next scene"]'); }
    await r.page.waitForTimeout(300);
    const overflow = await r.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`     ${name}: horizontal overflow ${overflow}px`);
    if (overflow > 0) console.log('       ' + (await r.page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      return [...document.querySelectorAll('body *')].map((el) => [el, el.getBoundingClientRect()]).filter(([, rc]) => rc.right > W + 0.5 && rc.width > 0)
        .slice(0, 6).map(([el, rc]) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}#${el.id} right=${rc.right.toFixed(1)}`).join(' | ');
    })));
    await r.page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: name !== 'score-phone' });
    await r.ctx.close();
  }
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} step(s) failed` : '\nall steps passed');
process.exit(failures ? 1 : 0);
