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
  // cfg.loseFirstLife: writes made before the first reload never arrive, as if the tab closed first
  const lost = !!cfg.loseFirstLife && !sessionStorage.getItem('mock.lived');
  if (cfg.loseFirstLife) sessionStorage.setItem('mock.lived', '1');
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
          if (lost) return new Promise(() => {});
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
    if (String(input).startsWith('You are checking one scene')) return { conflicts: [{ fact: 'F1', quote: 'forgot what came after four', why: 'A test contradiction.' }], relies: ['F1'] };
    if (String(input).startsWith('You are a worldbuilder. Someone has told you a dream')) return JSON.parse(JSON.stringify(cfg.dream));
    if (String(input).startsWith('You are the worldbuilder of')) return { places: [{ name: 'Crabhollow', kind: 'village', near: 'coast', facts: ['A village of crab-catchers on the old shore.'] }, { name: 'Brinemoor Light', kind: 'tower', facts: ['A second lighthouse, dark since the draining.'] }, { name: 'Harrowgate', kind: 'city', facts: ['Already on the map, so it is skipped.'] }], features: [], facts: ['The road down the cliffs is a staircase of a thousand steps.'] };
    if (String(input).startsWith('You are the cartographer of')) {
      return { subtitle: 'the city and the sea', shape: 'coast', climate: 'temperate', accent: '#3d4f8f', seas: [{ name: 'The Black Sea', at: 'east' }], features: [],
        regions: [{ name: 'The Lamp Coast', biome: 'grassland', at: 'west', size: 'large', relief: 'hills', facts: ['Cliffs and lamps.'] }, { name: 'The Black Water', biome: 'marsh', at: 'south', size: 'small', relief: 'flat', facts: ['Reeds and stilts.'] }],
        places: [{ name: 'Vesk', kind: 'capital', region: 'The Lamp Coast', facts: [] }, { name: 'Gullwick', kind: 'village', region: 'The Lamp Coast', facts: ['A fishing village under Vesk.'] }, { name: 'Tarn', kind: 'town', region: 'The Black Water', facts: ['A town on stilts.'] }] };
    }
    if (String(input).includes('caught this fragment')) return { seeds: [{ kind: 'place', name: 'The Candle Gardens', fact: 'Inside the moon, candles grow like tulips.' }] };
    if (String(input).startsWith('You are thinking through one fact')) {
      if (/The author has an idea of where it leads: "the tides"/.test(String(input))) {
        return { ways: [{ label: 'The tides', about: 'The Tide Wardens', kind: 'faction', question: 'Who watches the tides, if looking at the moon is dangerous?',
          options: ['The Tide Wardens watch the water through smoked glass.', 'Nobody: the tide tables are a hundred years old.', 'Blind keepers, who have nothing left to lose to it.', 'The children, before they have loved anything.'] }] };
      }
      const key = (words) => { const m = new RegExp('\\[(F\\d+)\\] [^\\n]*' + words).exec(String(input)); return m ? m[1] : 'F99'; };
      const scene = /\[(S\d+)\]/.exec(String(input));
      return {
        breaks: [{ ref: key('sense of smell'), why: 'Mira lost her smell, not something she loved.' }, { ref: key('costs its lighter'), why: 'A lighter who forgot a lamp is not the same as one who let it go dark.' }, { ref: 'F999', why: 'not a key' }].concat(scene ? [{ ref: scene[1], why: 'Kael stands in moonlight here and forgets nothing.' }] : []),
        ways: [
          { label: 'The lamplighters', about: 'Mira', kind: 'character', question: 'What has Mira already forgotten?',
            options: ['Mira has forgotten her mother’s face.', 'Mira has forgotten the song her brother used to hum.', 'Mira has forgotten why she became a lamplighter.', 'Mira has forgotten something, and keeps a list to find out what.'] },
          { label: 'Through glass', about: '', kind: 'rule', question: 'Does moonlight through glass count?',
            options: ['Glass stops it, so the rich live behind windows.', 'Glass only slows it: you forget, but over a year.', 'Glass makes it worse.', 'Nobody knows, and nobody wants to test it.'] },
          { label: 'The records', about: 'The Archive of Losses', kind: 'place', question: 'Who keeps a record of what each person has lost?',
            options: ['The Archive of Losses, in the dark under the city.', 'Each family, in a book kept shut.', 'Nobody, on purpose.', 'The moon itself, if you know how to ask.'] },
          { label: 'Children', about: '', kind: 'rule', question: 'What does a child lose, who has loved so little?',
            options: ['A child loses the first thing it ever loved, and the moonlight takes its time finding out what that was, so for weeks afterwards the child wakes every morning a little emptier and nobody can say of what, until one day it stops reaching for its mother in the dark.', 'Nothing yet.', 'Its name.', 'The colour blue.'] },
        ],
      };
    }
    if (String(input).startsWith('You are composing')) {
      return String(input).startsWith('You are composing a portrait')
        ? { title: 'Kael', alt: 'Kael in profile.', mode: 'portrait', time: 'night', sitter: { head: 'cap', holds: 'lamp' } }
        : { title: 'The door in the moon', alt: 'A boy on a stair under a huge moon.', time: 'night', accent: '#e0a849', sky: { moon: { x: 0.7, y: 0.2, size: 1.8 } },
          water: { level: 0.78 }, things: [{ kind: 'houses', x: 0.2, depth: 'mid', count: 8, lit: true }, { kind: 'stair', x: 0.45, depth: 'near' }, { kind: '<script>' }],
          figures: [{ x: 0.42, depth: 'near', carry: 'lamp' }] };
    }
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
  catch (e) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n     '));
    if (typeof errors !== 'undefined' && errors.length) console.log('     page errors so far: ' + errors.join(' | '));
  }
}
// more.storageState: this browser's storage from an earlier visit; more.later: ms to move the clock on
async function open(cfg, viewport, scheme, more) {
  more = more || {};
  const ctx = await browser.newContext({ viewport: viewport || { width: 1400, height: 950 }, colorScheme: scheme || 'light', permissions: ['clipboard-read', 'clipboard-write'], storageState: more.storageState });
  const page = await ctx.newPage();
  if (more.later) await page.addInitScript((ms) => { const real = Date.now.bind(Date); Date.now = () => real() + ms; }, more.later);
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
const DREAM = JSON.parse(readFileSync(fileURLToPath(new URL('../dream-example.json', import.meta.url)), 'utf8'));
const { page, ctx, errors } = await open({ seed: exampleDocs(WID), dream: DREAM.answer });

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
  const listed = await st(page, () => {
    const S = window.__inkwash.state;
    const call = window.__mock.calls.find((c) => c.kind === 'text').input;
    const ids = ['F1', 'F2'].map((k) => { const m = call.match(new RegExp('\\[' + k + '\\] (.+)')); return m && m[1]; });
    const facts = [...S.canon.values()].flatMap((e) => e.facts);
    return ids.map((t) => (facts.find((f) => f.text === t) || {}).id);
  });
  const pend = p.pending.map((x) => x.f);
  assert.ok(listed.every((f) => f && pend.includes(f)), 'the two known facts the model listed are premises; the unknown F99 is ignored');
  assert.ok(pend.length > 2, 'facts whose words are on the page are premises too: ' + pend.join(', '));
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

await step('a contradiction blocks the seal until the author keeps it or fixes it', async () => {
  assert.equal(await page.isDisabled('#set-button'), true);
  assert.match(await page.textContent('#set-row'), /Resolve the contradiction above first/);
  await page.click('.conflict button:has-text("Keep it as written")');
  await page.waitForSelector('.conflict.kept');
  assert.equal(await page.isDisabled('#set-button'), false);
});

await step('setting with the seal dries the ink and records premises', async () => {
  const pending = await st(page, () => window.__inkwash.state.passages.get('c_door__s1').pending.map((x) => x.f));
  await page.click('#set-button');
  await page.waitForSelector('.seal-mark');
  await settle(page);
  const p = await st(page, () => window.__inkwash.state.passages.get('c_door__s1'));
  assert.equal(p.spans.some((x) => x.wet), false);
  assert.ok(pending.every((f) => p.premises.some((x) => x.f === f)), 'everything pending is now a premise');
  assert.match(await page.textContent('#set-row'), new RegExp(`The ledger recorded ${p.premises.length} facts`));
  assert.equal(await page.textContent('#scene-pill'), 'Set');
  const saved = await st(page, () => JSON.parse(window.__mock.docs.get('studio/w_hollow_moon/passages/c_door__s1')));
  assert.ok(saved.setAt > 0);
});

await step('rewording a fact flags exactly the scenes that used it, and still-true clears it', async () => {
  const used = await st(page, () => window.__inkwash.state.passages.get('c_door__s1').premises.map((x) => x.f));
  await page.click('.tab >> text=Canon');
  await page.waitForSelector('.codex');
  await page.click('.codex-link:text-is("Kael")');
  const fid = used.find((f) => f.startsWith('f_kael'));
  await page.fill('#fact-' + fid, 'Kael counts lamps when he is afraid, never stairs.');
  await page.keyboard.press('Tab');
  await page.waitForSelector('.toast.warn', { timeout: 4000 });
  const msg = await page.textContent('.toast.warn');
  assert.match(msg, /now flagged: .*chapter 2, scene 1/);
  await page.click('.toast.warn button:has-text("Show me")');
  await page.waitForSelector('.stale-box');
  // The fact may also be one an example scene relies on, so open chapter 2, scene 1 by name.
  await page.evaluate(() => { window.__inkwash.state.k = 0; });
  await page.click('.rail-item >> nth=1');
  await page.waitForFunction(() => window.__inkwash.state.cid === 'c_door' && document.querySelector('.stale-box'));
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

await step('painting a plate for a scene and for a character', async () => {
  await page.waitForSelector('button:has-text("Paint a plate for this scene")');
  await page.click('button:has-text("Paint a plate for this scene")');
  await page.waitForSelector('.sheet .plate svg', { timeout: 6000 });
  const call = await st(page, () => window.__mock.calls.filter((c) => c.kind === 'json').pop());
  assert.match(call.input, /^You are composing an illustration for a scene/);
  assert.ok(call.input.includes('The moon had a door in it'), 'the scene text is in the plate brief');
  assert.equal(call.tier, 'default');
  const plate = await st(page, () => window.__inkwash.state.plates.get('c_door__s1'));
  assert.equal(plate.spec.things.length, 2, 'the unknown kind was dropped before saving');
  assert.equal(await page.locator('.sheet .plate svg script').count(), 0);
  assert.equal(await page.textContent('.sheet .plate figcaption'), 'The door in the moon');
  // The example world comes with a portrait of Kael. Paint it again.
  await page.click('.tab >> text=Canon');
  await page.click('.codex-link:text-is("Kael")');
  await page.waitForSelector('.card[aria-label="Kael"] .entry-head .plate svg');
  assert.equal(await page.locator('.card[aria-label="Kael"] .plate svg').count(), 1, 'a portrait heads the page, and isn\'t shown twice');
  assert.equal(await st(page, () => window.__inkwash.state.plates.get('ent__e_kael').spec.time), 'dusk');
  await page.click('.card[aria-label="Kael"] button:has-text("Paint it again")');
  await page.waitForFunction(() => window.__inkwash.state.plates.get('ent__e_kael').spec.time === 'night', null, { timeout: 6000 });
  assert.match((await st(page, () => window.__mock.calls.filter((c) => c.kind === 'json').pop())).input, /^You are composing a portrait of a character/);
  // The Hollow Queen's secret (she is Kael’s mother) never goes into her plate's brief.
  await page.click('.codex-link:text-is("The Hollow Queen")');
  await page.click('.card[aria-label="The Hollow Queen"] button:has-text("Paint it again")');
  await page.waitForFunction(() => window.__inkwash.state.plates.get('ent__e_queen').spec.sitter.head === 'cap', null, { timeout: 6000 });
  const queenBrief = await st(page, () => window.__mock.calls.filter((c) => c.kind === 'json').pop().input);
  assert.ok(queenBrief.includes('She has lived inside the moon for twelve years.'));
  assert.ok(!queenBrief.includes('Kael’s mother'), 'secret facts stay out of a plate brief');
  await settle(page);
  assert.match(await st(page, () => window.__mock.docs.get('studio/w_hollow_moon/plates/ent__e_kael')), /"time":"night"/, 'the new plate is saved');
  await page.click('.tab >> text=Score');
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

await step('cutting and pasting back, or deleting and undoing, leaves the hand meter alone', async () => {
  await page.click('#ch-c_lamps .scene-block >> nth=2 >> button:has-text("Open in the score")');
  await page.waitForSelector('.sheet h2:has-text("Scene 3")');
  const read = () => st(page, () => { const p = window.__inkwash.state.passages.get('c_lamps__s3'); return { text: p.text, spans: JSON.stringify(p.spans), meter: document.querySelector('#scene-meter').textContent }; });
  const before = await read();
  await page.click('#passage-text');
  await page.keyboard.press('Control+A'); await page.keyboard.press('Control+X'); await page.keyboard.press('Control+V');
  await settle(page);
  assert.deepEqual(await read(), before);
  await page.click('#passage-text');
  await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); await page.keyboard.press('Control+Z');
  await settle(page);
  assert.deepEqual(await read(), before);
  await page.evaluate(() => navigator.clipboard.writeText(' A crow sat on the lamp and said nothing.'));
  await page.click('#passage-text');
  await page.keyboard.press('Control+End'); await page.keyboard.press('Control+V');
  await settle(page);
  const after = await read();
  assert.equal(after.meter, before.meter, 'pasted words are not the author’s hand');
  assert.ok(JSON.parse(after.spans).some((x) => x.o === 'pasted'));
  assert.match(await page.textContent('.legend'), /pasted in/);
});

await step('exports: EPUB, provenance report and bible', async () => {
  await page.click('.tab >> text=Book');
  await page.waitForSelector('.book-page');
  await page.click('.exports >> text=EPUB');
  await page.waitForSelector('.modal');
  assert.match(await page.textContent('.modal'), /Chapter 1, scene 2 is stale/);
  await page.click('.modal button:has-text("Export anyway")');
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

await step("ripples: the author's own idea comes first, then Claude's ways; an answer is the author's own first, Claude's to start from", async () => {
  await page.click('.tab >> text=Canon');
  await page.click('.codex-link:text-is("Moonlight")');
  const card = '.card[aria-label="Moonlight"]';
  await page.waitForSelector(card);
  await page.click(`${card} .fact:has(#fact-f_moon_forget) button:has-text("Ripples")`);
  await page.waitForSelector(`${card} .ripples`, { timeout: 6000 });
  const call = await st(page, () => window.__mock.calls.filter((c) => c.kind === 'json').pop());
  assert.equal(call.tier, 'default');
  assert.match(call.input, /^You are thinking through one fact of the story world "The Hollow Moon" \([^)]*\) with its author, who overthinks it\. The author decides/);
  assert.match(call.input, /THE FACT\nWorld rule: Anyone touched by direct moonlight forgets one thing they love\./);
  assert.match(call.input, /\[F\d+\] Mira: Mira lost her sense of smell to moonlight\./);
  assert.match(call.input, /Exactly 4 ways/);
  const panel = `${card} .ripples`;
  const frame = () => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)))); // the page redraws on the next frame
  assert.match(await page.textContent(panel), /What it breaks[\s\S]*Mira lost her smell[\s\S]*Where does it lead\?\s*My own idea\s*or one of Claude’s:/);
  assert.deepEqual(await page.locator(`${panel} .ripple-ways .btn`).allTextContents(), ['My own idea', 'The lamplighters', 'Through glass', 'The records', 'Children'], 'the author\'s own idea comes first');
  assert.equal(await page.locator(`${panel} .way-open`).count(), 0, 'nothing is open until the author picks');
  assert.doesNotMatch(await page.textContent(panel), /not a key/, 'a reference to nothing is dropped');
  // the contradiction leads to the fact it breaks, on its own page, and back
  await page.click(`${panel} .ripple.break button:has-text("Mira:")`);
  await page.waitForSelector('.card[aria-label="Mira"]');
  await frame();
  assert.equal(await st(page, () => document.activeElement.id), 'fact-f_mira_smell');
  await page.click('.entry-back:text-is("← Moonlight")');
  await page.waitForSelector(panel);

  // the author's own idea: written by them, filed where they say
  await page.click(`${panel} .ripple-ways .btn:has-text("My own idea")`);
  await frame();
  const idea = `${panel} .way-open.mine`;
  assert.match(await st(page, () => document.activeElement.id), /^ripple-idea-/, 'the box is ready to write in');
  assert.match(await page.textContent(`${idea} button[type="submit"]`), /^Add to Moonlight$/, 'it goes into the fact\'s own entry unless the author says otherwise');
  await page.fill(`${idea} textarea`, 'Kael has started wearing his hood up at dusk, and won\'t say why.');
  await page.selectOption(`${idea} select[id^="ripple-into-"]`, { label: 'Kael' });
  await frame();
  await page.click(`${idea} button:has-text("Add to Kael")`);
  await page.waitForSelector('.toast:has-text("Added to Kael. Where does that lead?") button:has-text("Ripples")');
  // and one in a new entry
  await page.click(`${panel} .ripple-ways .btn:has-text("My own idea")`);
  await frame();
  await page.fill(`${idea} textarea`, 'They tend the glass roofs of Vesk, and are paid in forgetting.');
  await page.selectOption(`${idea} select[id^="ripple-into-"]`, '__new');
  await frame();
  await page.click(`${idea} button:has-text("Add it")`);
  await page.waitForSelector('.toast:has-text("Give the new entry a name first.")');
  await page.fill(`${idea} input[aria-label="Name of the new entry"]`, 'The Glaziers');
  await page.selectOption(`${idea} select[aria-label="What the new entry is"]`, 'faction');
  await page.click(`${idea} button:has-text("Add it")`);
  await page.waitForSelector('.toast:has-text("The Glaziers is new in your canon. Where does that lead?")');

  // one of Claude's ways: the author's own answer comes first, Claude's are there to start from
  await page.click(`${panel} .ripple-ways .btn:has-text("The lamplighters")`);
  await frame();
  assert.equal(await page.getAttribute(`${panel} .ripple-ways .btn:has-text("The lamplighters")`, 'aria-pressed'), 'true');
  assert.match(await page.textContent(`${panel} .way-open`), /^The lamplighters: What has Mira already forgotten\?\s*My own answer[\s\S]*Or start from one of Claude’s:/);
  assert.deepEqual(await page.locator(`${panel} .ripple-options .btn`).allTextContents(), ['Mira has forgotten her mother’s face.', 'Mira has forgotten the song her brother used to hum.', 'Mira has forgotten why she became a lamplighter.', 'Mira has forgotten something, and keeps a list to find out what.']);
  const box = `${panel} .way-open textarea`;
  assert.equal(await page.inputValue(box), '', 'my own answer starts from an empty box');
  await page.click(`${panel} .ripple-options .btn:has-text("the song her brother")`);
  await frame();
  assert.equal(await page.inputValue(box), 'Mira has forgotten the song her brother used to hum.', 'Claude\'s answer goes into the box, to keep or rewrite');
  assert.match(await st(page, () => document.activeElement.id), /^ripple-answer-/);
  await page.click(`${panel} .way-open button:has-text("Add to Mira")`);
  await page.waitForSelector('.toast:has-text("Added to Mira. Where does that lead?") button:has-text("Ripples")');

  // the author's own words are never thrown away by a click on Claude's
  await page.click(`${panel} .ripple-ways .btn:has-text("Through glass")`);
  await frame();
  await page.fill(box, 'Glass only dims it.');
  await page.click(`${panel} .ripple-options .btn:has-text("Glass makes it worse.")`);
  await frame();
  assert.equal(await page.inputValue(box), 'Glass only dims it. Glass makes it worse.');
  await page.fill(box, 'Moonlight through glass is harmless, which is why the rich never leave their glasshouses.');
  await page.click(`${panel} .way-open button:has-text("Add to Moonlight")`);

  // a way not ready to decide waits in the dream inbox; its entry would be new
  await page.click(`${panel} .ripple-ways .btn:has-text("The records")`);
  await frame();
  assert.match(await page.textContent(`${panel} .way-open`), /The Archive of Losses is new: adding it starts a place in your canon\./);
  await page.click(`${panel} .way-open button:has-text("Later")`);

  // a long answer wraps inside the card
  await page.click(`${panel} .ripple-ways .btn:has-text("Children")`);
  await frame();
  assert.ok(await st(page, () => { const c = document.querySelector('.card[aria-label="Moonlight"]'); return c.scrollWidth <= c.clientWidth + 1; }), 'a long answer wraps inside its card');
  if (wantShots) { mkdirSync(SHOTS, { recursive: true }); await page.locator(card).screenshot({ path: join(SHOTS, 'ripples-light.png') }); }
  await page.click(`${panel} .ripple-ways .btn:has-text("Children")`);
  await frame();
  assert.equal(await page.locator(`${panel} .way-open`).count(), 0, 'a way closes again');

  // a bit of help with the author's own idea: one question that takes it further
  await page.click(`${panel} .ripple-ways .btn:has-text("My own idea")`);
  await frame();
  await page.click(`${idea} button:has-text("Help me think it through")`);
  await page.waitForSelector('.toast:has-text("Write a few words of your idea first")');
  await page.fill(`${idea} textarea`, 'the tides');
  await page.click(`${idea} button:has-text("Help me think it through")`);
  await page.waitForSelector(`${panel} .way-open:has-text("Who watches the tides")`, { timeout: 6000 });
  const asked = await st(page, () => window.__mock.calls.filter((c) => c.kind === 'json').pop());
  assert.match(asked.input, /The author has an idea of where it leads: "the tides"\.[\s\S]*Exactly 1 way: a question that takes the author's idea further/);
  await page.click(`${panel} .ripple-options .btn:has-text("smoked glass")`);
  await page.fill(box, 'The Tide Wardens work blindfolded and count the waves by ear.');
  await page.click(`${panel} .way-open button:has-text("Add to The Tide Wardens")`);
  await page.waitForSelector('.toast:has-text("The Tide Wardens is new in your canon. Where does that lead?")');
  await settle(page);

  const S = await st(page, () => {
    const s = window.__inkwash.state, by = (name) => [...s.canon.values()].find((e) => e.name === name);
    const facts = (e) => (e ? e.facts.map((f) => [f.text, f.origin]) : null);
    return { kael: facts(by('Kael')), mira: facts(by('Mira')), moon: facts(by('Moonlight')), glaziers: by('The Glaziers') ? [by('The Glaziers').kind, facts(by('The Glaziers'))] : null,
      wardens: by('The Tide Wardens') ? [by('The Tide Wardens').kind, facts(by('The Tide Wardens'))] : null, archive: !!by('The Archive of Losses'),
      rip: s.canon.get('e_moonlight').facts.find((f) => f.id === 'f_moon_forget').ripples, seeds: [...s.seeds.values()].map((d) => d.text) };
  });
  assert.ok(S.kael.some(([t, o]) => t === 'Kael has started wearing his hood up at dusk, and won\'t say why.' && o === 'human'), 'the author\'s own idea is theirs, where they filed it');
  assert.deepEqual(S.glaziers, ['faction', [['They tend the glass roofs of Vesk, and are paid in forgetting.', 'human']]]);
  assert.ok(S.mira.some(([t, o]) => t === 'Mira has forgotten the song her brother used to hum.' && o === 'accepted'), 'Claude\'s answer added as it was is marked as a suggestion kept');
  assert.ok(S.moon.some(([t, o]) => t === 'Moonlight through glass is harmless, which is why the rich never leave their glasshouses.' && o === 'human'));
  assert.deepEqual(S.wardens, ['faction', [['The Tide Wardens work blindfolded and count the waves by ear.', 'human']]], 'a rewritten answer is the author\'s, in a new entry of the kind it was about');
  assert.equal(S.archive, false, 'nothing joins the canon unless the author adds it');
  assert.deepEqual(S.rip.ways.map((w) => [w.label, w.status]), [['The lamplighters', 'answered'], ['Through glass', 'answered'], ['The records', 'later'], ['Children', 'new'], ['My own idea', 'answered'], ['My own idea', 'answered'], ['The tides', 'answered']]);
  assert.deepEqual([S.rip.ways[4].mine, S.rip.ways[4].answer.text, S.rip.ways[6].own, S.rip.ways[6].toward], [true, 'Kael has started wearing his hood up at dusk, and won\'t say why.', true, 'the tides']);
  assert.equal(S.rip.follows, undefined, 'Claude writes no consequences of its own');
  assert.ok(S.seeds.some((t) => t.startsWith('Who keeps a record of what each person has lost? (from Moonlight:')));
  assert.match(await st(page, () => window.__mock.docs.get('studio/w_hollow_moon/canon/e_moonlight')), /"ways"/, 'ripples are saved with the fact');
  // the panel now offers the author's own idea and the way still open, and shows what was decided
  assert.deepEqual(await page.locator(`${panel} .ripple-ways .btn`).allTextContents(), ['My own idea', 'Children']);
  assert.match(await page.textContent(panel), /Decided[\s\S]*The lamplighters: Mira has forgotten the song[\s\S]*Through glass: Moonlight through glass is harmless[\s\S]*My own idea: Kael has started wearing his hood[\s\S]*My own idea: They tend the glass roofs[\s\S]*The tides: The Tide Wardens work blindfolded/);
  await page.click('.tab >> text=Score');
});

await step('reader preview shows the published chapter', async () => {
  await page.click('.tab >> text=Book');
  await page.click('text=Read it as a reader');
  await page.waitForSelector('.reader');
  assert.match(await page.textContent('.reader article'), /The moon had a door in it/);
  assert.match(await page.textContent('.reader article'), /How this book was made: .* wrote \d+% of the words by hand/);
  assert.equal(await page.locator('.reader article .plate svg').count(), 1, 'the published chapter carries its plate');
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

// A point inside an element of the map where that element is the one under the pointer.
const pointOn = (sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel), r = el.getBoundingClientRect();
  for (let y = r.top + 4; y < r.bottom; y += 6) for (let x = r.left + 4; x < r.right; x += 6) if (document.elementFromPoint(x, y) === el) return [x, y];
  return null;
}, sel);
const atlasSpec = () => st(page, () => window.__inkwash.state.atlas.get('main').spec);

await step('dreaming a world grows its canon and draws its map', async () => {
  await page.selectOption('#world-select', '__dream');
  await page.waitForSelector('#dream-text');
  await page.fill('#dream-text', DREAM.dream);
  await page.click('text=Dream it');
  await page.waitForSelector('.atlas-stage svg', { timeout: 20000 });
  const call = await st(page, () => window.__mock.calls.filter((c) => c.kind === 'json').pop());
  assert.equal(call.tier, 'complex');
  assert.ok(call.input.includes('the ships stood on the seabed like cattle'), 'the dream is in the brief');
  const canon = await st(page, () => [...window.__inkwash.state.canon.values()].map((e) => ({ name: e.name, kind: e.kind, facts: e.facts.map((f) => [f.text, f.origin]) })));
  assert.ok(canon.length >= 45, `${canon.length} canon entries`);
  const harrow = canon.find((e) => e.name === 'Harrowgate');
  assert.deepEqual(harrow.facts[0], ['Harrowgate is a capital in The Old Coast.', 'accepted'], 'the geography is in the canon, marked as suggested');
  assert.ok(canon.some((e) => e.kind === 'character' && e.name === 'Ilse Varr'));
  assert.equal(await page.locator('.atlas-stage .atlas-region').count(), 8);
  assert.equal(await page.locator('.atlas-stage .atlas-place').count(), 24);
  await settle(page);
  const saved = await st(page, () => [...window.__mock.docs.keys()].filter((k) => /\/atlas\/main$/.test(k)).map((k) => JSON.parse(window.__mock.docs.get(k))));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].spec.regions.length, 8);
  assert.match(await page.textContent('.atlas-panel'), /I dreamed the sea went out/);
});

await step('choosing a region on the map shows it, and exploring it adds places', async () => {
  const at = await pointOn('.atlas-region[data-id="r_glasswold"]');
  assert.ok(at, 'Glasswold can be clicked on the map');
  await page.mouse.click(at[0], at[1]);
  await page.waitForSelector('.atlas-panel h2 >> text=Glasswold');
  assert.match(await page.textContent('.atlas-panel'), /A desert of dunes fused into glass/);
  await page.click('.atlas-panel >> text=← The whole world');
  await page.click('.atlas-panel >> text=The Old Coast');
  await page.waitForSelector('.atlas-panel h2 >> text=The Old Coast');
  const before = (await atlasSpec()).places.length;
  await page.click('text=Explore deeper');
  await page.waitForFunction((n) => window.__inkwash.state.atlas.get('main').spec.places.length > n, before, { timeout: 8000 });
  const spec = await atlasSpec();
  assert.equal(spec.places.length, before + 2, 'two new places; one already on the map is skipped');
  const call = await st(page, () => window.__mock.calls.filter((c) => c.kind === 'json').pop());
  assert.equal(call.tier, 'default');
  assert.match(call.input, /ALREADY MAPPED HERE[\s\S]*Harrowgate/);
  const canon = await st(page, () => [...window.__inkwash.state.canon.values()]);
  assert.ok(canon.some((e) => e.name === 'Crabhollow' && e.facts[0].text === 'Crabhollow is a village in The Old Coast.'));
  assert.ok(canon.find((e) => e.name === 'The Old Coast').facts.some((f) => /thousand steps/.test(f.text)), 'the region learned something too');
  await page.waitForSelector('.atlas-stage .atlas-place[data-id^="p_crabhollow"]', { timeout: 15000 });
});

await step('the map moves and zooms, and lesser names come in closer', async () => {
  await page.click('.atlas-panel >> text=← The whole world');
  const vb = () => page.getAttribute('.atlas-stage svg', 'viewBox').then((v) => v.split(' ').map(Number));
  const box = await page.locator('.atlas-stage').boundingBox();
  assert.equal((await vb())[2], 1600);
  assert.equal(await page.getAttribute('.atlas-stage svg', 'data-z'), '1');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120);
  await page.waitForFunction(() => document.querySelector('.atlas-stage svg').dataset.z === '3');
  const [x1, , w1] = await vb();
  assert.ok(w1 < 600, `zoomed in to ${w1}`);
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 160, { steps: 5 });
  await page.mouse.up();
  const [x2] = await vb();
  assert.ok(x2 > x1, 'dragging moved the map');
  await page.click('text=Whole map');
  assert.equal((await vb())[2], 1600);
});

await step("the canon is the world's codex: a place shows where it lies, entries link to each other, the search finds a fact, and beside the map a page can be edited", async () => {
  const frame = () => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
  // beside the map, a place's page: its facts can be edited and rippled there
  await page.click('.atlas-panel button.linklike:text-is("The Old Coast")');
  await page.waitForSelector('.atlas-panel h2 >> text=The Old Coast');
  await page.click('.atlas-panel button.linklike:text-is("Harrowgate")');
  await page.waitForSelector('.atlas-panel h2 >> text=Harrowgate');
  assert.equal(await page.locator('.atlas-panel .entry.compact textarea.prose').count(), 3, 'its facts can be edited beside the map');
  assert.equal(await page.locator('.atlas-panel .entry.compact button:has-text("Ripples")').count(), 3);
  // what it's connected to opens on the map, when it's on the map
  await page.click('.atlas-panel .chip:text-is("The Old Coast")');
  await page.waitForSelector('.atlas-panel h2 >> text=The Old Coast');
  // in the codex, a place's page shows where it lies, rippling
  await page.click('.tab >> text=Canon');
  await page.click('.codex-link:text-is("Harrowgate")');
  const harrow = '.card[aria-label="Harrowgate"]';
  await page.waitForSelector(`${harrow} .entry-map svg`, { timeout: 15000 });
  assert.equal(await page.locator(`${harrow} .entry-mark .ring`).count(), 3);
  const vb = (await page.getAttribute(`${harrow} .entry-map svg`, 'viewBox')).split(' ').map(Number);
  assert.ok(vb[2] < 600 && vb[2] / vb[3] > 2.3, `a strip of map, zoomed in on the place (${vb.join(' ')})`);
  assert.match(await page.textContent(`${harrow} .entry-head .eyebrow`), /^Capital in The Old Coast$/);
  // what it names and what names it link to each other, and back
  await page.click(`${harrow} .chip:text-is("The Harbour Lords")`);
  await page.waitForSelector('.card[aria-label="The Harbour Lords"] .entry-seal');
  assert.equal(await page.textContent('.card[aria-label="The Harbour Lords"] .entry-seal'), 'H', 'no picture yet: an ink seal');
  await page.click('.entry-back:text-is("← Harrowgate")');
  await page.waitForSelector(`${harrow} .entry-map svg`);
  // the strip opens the atlas there
  await page.click(`${harrow} .entry-map`);
  await page.waitForSelector('.atlas-panel h2 >> text=Harrowgate');
  // the index finds a fact
  await page.click('.tab >> text=Canon');
  await page.fill('#codex-find', 'pigeons');
  await frame();
  assert.deepEqual(await page.locator('.codex-link').allTextContents(), ['Gullhallow']);
  await page.fill('#codex-find', '');
  await frame();
  assert.ok((await page.locator('.codex-link').count()) > 40);
  await page.click('.tab >> text=Atlas');
});

await step('a world with a canon gets an atlas drawn around it', async () => {
  await page.selectOption('#world-select', WID);
  await page.click('.tab >> text=Atlas');
  await page.waitForSelector('text=This world has no map yet');
  const vesk = await st(page, () => JSON.stringify([...window.__inkwash.state.canon.values()].find((e) => e.name === 'Vesk')));
  await page.click('text=Draw the atlas');
  await page.waitForSelector('.atlas-stage svg', { timeout: 20000 });
  const after = await st(page, () => [...window.__inkwash.state.canon.values()]);
  assert.equal(JSON.stringify(after.find((e) => e.name === 'Vesk')), vesk, 'a place already in the canon is left exactly as it was');
  for (const n of ['The Lamp Coast', 'Gullwick', 'Tarn']) assert.ok(after.some((e) => e.name === n), n + ' joined the canon');
  const spec = await atlasSpec();
  assert.equal(spec.places.find((p) => p.name === 'Vesk').entity, JSON.parse(vesk).id);
  // deleting a place from the canon takes it off the map
  await page.click('.tab >> text=Canon');
  await page.click('.codex-link:text-is("Gullwick")');
  await page.click('.card[aria-label="Gullwick"] button[aria-label="Delete Gullwick"]');
  await page.click('.modal button.seal');
  await settle(page);
  assert.ok(!(await atlasSpec()).places.some((p) => p.name === 'Gullwick'));
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
  await page.click('.tab >> text=Atlas');
  await page.waitForSelector('.atlas-stage svg');
  await page.screenshot({ path: join(SHOTS, 'atlas-light.png') });
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
  await r.page.click('.choice button:has-text("The Hollow Moon")');
  await r.page.waitForSelector('.score-view');
  await r.page.evaluate(() => window.__inkwash.flush());
  await r.page.waitForFunction(() => (localStorage.getItem('inkwash.sketchbook') || '').includes('The Hollow Moon'), null, { timeout: 5000 });
  assert.deepEqual(r.errors, []);
  await r.ctx.close();
});

await step('outside claude.ai, inking is off and writing by hand still works', async () => {
  const r = await open({ noClaude: true });
  await r.page.waitForSelector('.welcome');
  await r.page.click('.choice button:has-text("The Hollow Moon")');
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

await step('the dreamed example opens anywhere, without Claude, and its map can be read on a phone', async () => {
  const r = await open({ noClaude: true }, { width: 390, height: 844 });
  await r.page.waitForSelector('.welcome');
  await r.page.click('.choice button:has-text("The Drained Sea")');
  await r.page.waitForSelector('.atlas-stage svg', { timeout: 20000 });
  assert.equal(await r.page.locator('.atlas-stage .atlas-region').count(), 8);
  assert.equal(await r.page.locator('text=Explore deeper').count(), 0, 'exploring needs Claude');
  await r.page.click('.atlas-list button:text-is("Kelpreach")');
  await r.page.waitForSelector('.atlas-panel h2 >> text=Kelpreach');
  assert.ok(!/null/.test(await r.page.textContent('.atlas-panel')), 'nothing empty is printed');
  const overflow = await r.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `no sideways scroll on a phone (${overflow}px)`);
  if (wantShots) await r.page.screenshot({ path: join(SHOTS, 'atlas-phone.png'), fullPage: true });
  assert.deepEqual(r.errors, []);
  await r.ctx.close();
});

// ---------------------------------------------------------------- a creator's own notes
// The Glass Orchard is a world made up for these tests. Bringing notes in, what is already there,
// undo, coming back later, backups, and the copy of the studio that opens from a file.
const ORCHARD = `# The Glass Orchard

In the valley of Selt, the old trees grow glass instead of fruit.

## Places

### Vellmere
A hill town of glassblowers above the orchard.
- The bells of Vellmere are cast from green glass.
- Nobody in Vellmere may sell orchard glass.

### The Long Rows
Every autumn the trees ring like wind chimes.

## Characters
- Tamsin Hale: Odile's apprentice, who says she can hear the trees.

### Odile Marr
Odile is the orchard's last pruner. She is sixty-one.
- She lost two fingers to a cracking pear.

## Rules
Glass picked before the first frost shatters by spring.

## The Chime Wardens
They tune the orchard every autumn and answer to no town.
`;
const MORE_NOTES = `## Odile Marr
- She keeps a ledger of every tree she has cut.

## Wren Ashby
A glass merchant from the coast, and Odile's oldest enemy.
`;
const cr = await open({ seed: {} });
const cp = cr.page;
const S_ = (fn, arg) => cp.evaluate(fn, arg);
const canonOf = () => S_(() => [...window.__inkwash.state.canon.values()]);
const byName = async (name) => (await canonOf()).find((e) => e.name === name);
const toastBtn = (text, label) => cp.locator(`.toast:has-text(${JSON.stringify(text)}) button:has-text("${label}")`).first();

await step('bringing notes in: everything found is shown before anything is added, guesses are marked, and only what is ticked comes in, word for word', async () => {
  await cp.waitForSelector('.welcome');
  await cp.click('.choice.lead button:has-text("Bring in notes")');
  await cp.fill('#import-text', ORCHARD);
  await cp.click('button:has-text("Read my notes")');
  await cp.waitForSelector('.import-entry');
  assert.equal(await cp.inputValue('#import-title'), 'The Glass Orchard', 'a lone top heading is offered as the world\'s name');
  const names = await cp.locator('.import-entry .import-name').evaluateAll((els) => els.map((e) => e.value));
  assert.deepEqual(names, ['Unsorted notes', 'Vellmere', 'The Long Rows', 'Tamsin Hale', 'Odile Marr', 'Rules', 'The Chime Wardens']);
  assert.match(await cp.textContent('.import-entry[aria-label="The Chime Wardens"] .import-tag.guess'), /a guess from its name: check it/);
  assert.match(await cp.textContent('.import-entry[aria-label="Unsorted notes"] .import-tag.guess'), /not under any heading/);
  assert.match(await cp.textContent('.import-page .page-head'), /7 entries and 11 facts/);
  assert.equal(await cp.textContent('.import-page .btn.primary'), 'Add 11 facts to a new world');
  // leave out the unsorted line and one fact, reword one line, and say the notes are mine
  await cp.uncheck('.import-entry[aria-label="Unsorted notes"] .import-entry-head input[type=checkbox]');
  await cp.uncheck('.import-entry[aria-label="Odile Marr"] .import-facts li:nth-child(2) input[type=checkbox]');
  await cp.fill('.import-entry[aria-label="Tamsin Hale"] textarea.import-fact', 'Odile\'s apprentice, who swears she can hear the trees.');
  await cp.selectOption('.import-entry[aria-label="The Chime Wardens"] select', 'faction');
  await cp.check('#import-declared');
  await cp.waitForFunction(() => document.querySelector('.import-page .btn.primary').textContent === 'Add 9 facts to a new world');
  assert.equal(await S_(() => window.__mock.calls.length), 0, 'nothing was sent to Claude');
  assert.equal(await S_(() => window.__inkwash.state.worlds.size), 0, 'nothing is added before the creator says so');
  await cp.click('.import-page .btn.primary');
  await cp.waitForSelector('.card[aria-label="Vellmere"]');
  assert.match(await cp.textContent('#toasts'), /Brought in 9 facts in 6 entries, in your own words\./);
  await settle(cp);
  const w = await S_(() => [...window.__inkwash.state.worlds.values()][0]);
  assert.equal(w.title, 'The Glass Orchard');
  const canon = await canonOf();
  assert.deepEqual(canon.map((e) => e.name).sort(), ['Odile Marr', 'Rules', 'Tamsin Hale', 'The Chime Wardens', 'The Long Rows', 'Vellmere']);
  const src = await S_(() => [...window.__inkwash.state.sources.values()][0]);
  const facts = canon.flatMap((e) => e.facts);
  assert.equal(facts.length, 9);
  assert.ok(facts.every((f) => f.origin === 'imported' && f.src === src.id && f.declared === true && f.v === 1), 'each fact says where it came from');
  const tamsin = canon.find((e) => e.name === 'Tamsin Hale').facts[0];
  assert.deepEqual([tamsin.text, tamsin.editedOnImport], ['Odile\'s apprentice, who swears she can hear the trees.', true]);
  assert.deepEqual(canon.find((e) => e.name === 'Odile Marr').facts.map((f) => f.text), ['Odile is the orchard\'s last pruner.', 'She lost two fingers to a cracking pear.']);
  assert.equal(canon.find((e) => e.name === 'The Chime Wardens').kind, 'faction');
  const stored = await S_((id) => JSON.parse(window.__mock.docs.get(`studio/${window.__inkwash.state.wid}/sources/${id}`)), src.id);
  assert.equal(stored.text, ORCHARD, 'the notes are kept exactly as they were pasted');
  assert.deepEqual([stored.declared, stored.facts, stored.entries], [true, 9, 6]);
  const hist = await S_(() => [...window.__inkwash.state.history.values()]);
  assert.deepEqual(hist.map((x) => [x.kind, x.label]), [['import', 'Brought in Pasted notes']]);
  assert.equal(await cp.locator('.card[aria-label="Vellmere"] .badge.imported').count(), 3);
  assert.match(await cp.getAttribute('.card[aria-label="Vellmere"] .badge.imported >> nth=0', 'title'), /your statement; not checked/);
});

await step('the same notes again are recognized: what is already in the canon is left out', async () => {
  await cp.selectOption('#world-select', '__import');
  await cp.waitForSelector('#import-text');
  assert.equal(await cp.inputValue('#import-target'), await S_(() => window.__inkwash.state.wid), 'notes go into the world that is open');
  await cp.fill('#import-text', ORCHARD.replace(/\n/g, '\r\n') + '\n\n');
  await cp.click('button:has-text("Read my notes")');
  await cp.waitForSelector('.banner.warn');
  assert.match(await cp.textContent('.banner.warn'), /You brought these notes in before\./);
  assert.equal(await cp.locator('.import-facts li.dup').count(), 8, 'every line already in the canon is shown as already there');
  assert.equal(await cp.textContent('.import-page .btn.primary'), 'Add 3 facts to The Glass Orchard', 'only the lines left out last time, and the original of the reworded one, are offered');
  assert.equal(await cp.locator('.import-entry.off').count(), 4, 'entries with nothing new are left out');
  await cp.click('.import-page button:has-text("Cancel")');
  await cp.waitForSelector('.codex');
  assert.equal(await S_(() => window.__inkwash.state.sources.size), 1, 'cancelling adds nothing');
});

await step('notes about entries already there add to them, and undo takes out only what they added', async () => {
  const odileBefore = (await byName('Odile Marr')).facts;
  await cp.selectOption('#world-select', '__import');
  await cp.setInputFiles('.import-row input[type=file]', { name: 'more-notes.md', mimeType: 'text/markdown', buffer: Buffer.from(MORE_NOTES) });
  await cp.waitForFunction(() => document.querySelector('#import-text').value.includes('Wren Ashby'));
  await cp.click('button:has-text("Read my notes")');
  await cp.waitForSelector('.import-entry[aria-label="Wren Ashby"]');
  assert.match(await cp.textContent('.import-entry[aria-label="Odile Marr"]'), /already in your canon as a character: these facts are added to it/);
  await cp.selectOption('.import-entry[aria-label="Wren Ashby"] select', 'character');
  await cp.click('.import-page .btn.primary');
  await cp.waitForSelector('.toast:has-text("Brought in 2 facts")');
  assert.equal((await byName('Odile Marr')).facts.length, 3);
  assert.ok(await byName('Wren Ashby'));
  assert.equal(await S_(() => [...window.__inkwash.state.sources.values()].find((x) => x.name === 'more-notes.md').text), MORE_NOTES);
  await toastBtn('Brought in 2 facts', 'Undo').click();
  await cp.waitForSelector('.toast:has-text("Undone: Brought in more-notes.md")');
  await settle(cp);
  assert.deepEqual((await byName('Odile Marr')).facts, odileBefore, 'the entry is as it was, fact for fact');
  assert.equal(await byName('Wren Ashby'), undefined);
  assert.deepEqual(await S_(() => [...window.__inkwash.state.sources.values()].map((x) => x.name)), ['Pasted notes'], 'the notes it brought are gone too');
  assert.ok(!(await S_(() => [...window.__mock.docs.keys()].some((k) => k.includes('/canon/') && window.__mock.docs.get(k).includes('Wren Ashby')))), 'and gone from the store');
});

await step('deleting an entry can be undone from History, and History says what each change was', async () => {
  const wardens = await byName('The Chime Wardens');
  await cp.click('.codex-link:text-is("The Chime Wardens")');
  await cp.click('.card[aria-label="The Chime Wardens"] button[aria-label="Delete The Chime Wardens"]');
  assert.match(await cp.textContent('.modal'), /You can undo it from History\./);
  await cp.click('.modal button.seal');
  await settle(cp);
  assert.equal(await byName('The Chime Wardens'), undefined);
  await cp.click('#open-history');
  await cp.waitForSelector('.history-list');
  const rows = await cp.locator('.history-list li').evaluateAll((els) => els.map((li) => [li.querySelector('.history-label').textContent, li.className]));
  assert.deepEqual(rows, [['Deleted The Chime Wardens', ''], ['Brought in more-notes.md', 'undone'], ['Brought in Pasted notes', '']]);
  await cp.click('.history-list li:first-child button:has-text("Undo")');
  await cp.waitForSelector('.history-list li.undone >> nth=1');
  await cp.keyboard.press('Escape');
  await settle(cp);
  const back = await byName('The Chime Wardens');
  assert.ok(back.updatedAt >= wardens.updatedAt);
  assert.deepEqual(Object.assign({}, back, { updatedAt: 0 }), Object.assign({}, wardens, { updatedAt: 0 }), 'it comes back as it was, under the same id');
});

await step('rewording a fact, and a scene written by hand, can each be undone', async () => {
  const odile = await byName('Odile Marr');
  const fid = odile.facts[1].id;
  await cp.click('.codex-link:text-is("Odile Marr")');
  await cp.fill('#fact-' + fid, 'She lost three fingers to a cracking pear.');
  await cp.keyboard.press('Tab');
  await cp.waitForSelector('.toast:has-text("Odile Marr changed.")');
  await toastBtn('Odile Marr changed.', 'Undo').click();
  await settle(cp);
  const f = (await byName('Odile Marr')).facts[1];
  assert.deepEqual([f.text, f.v, f.history.map((x) => x.v)], ['She lost two fingers to a cracking pear.', 3, [1, 2]], 'the old words come back as a new version');
  // a scene, written by hand
  await cp.click('.tab >> text=Score');
  await cp.waitForSelector('button:has-text("Write it yourself")');
  await cp.click('button:has-text("Write it yourself")');
  await cp.waitForSelector('#passage-text');
  await cp.keyboard.type('Odile counted the rows twice and still came up one tree short.');
  await cp.click('.chapter-title');
  await settle(cp);
  const key = await S_(() => `${window.__inkwash.state.cid}__s1`);
  assert.match(await S_((k) => window.__inkwash.state.passages.get(k).text, key), /one tree short/);
  await cp.click('#open-history');
  assert.equal(await cp.textContent('.history-list li:first-child .history-label'), 'Edited chapter 1, scene 1');
  await cp.click('.history-list li:first-child button:has-text("Undo")');
  await cp.keyboard.press('Escape');
  await settle(cp);
  assert.equal(await S_((k) => (window.__inkwash.state.passages.get(k) || {}).text || '', key), '', 'the words typed are taken back');
});

await step('a question saved for later and ripples not yet decided wait in the canon', async () => {
  await cp.click('.tab >> text=Canon');
  await cp.click('.codex-link:text-is("Odile Marr")');
  await cp.click('.card[aria-label="Odile Marr"] .fact >> nth=1 >> button:has-text("Ripples")');
  await cp.waitForSelector('.card[aria-label="Odile Marr"] .ripple-ways .btn.way:has-text("The records")', { timeout: 8000 });
  await cp.click('.card[aria-label="Odile Marr"] .ripple-ways .btn.way:has-text("The records")');
  await cp.click('.ripple.way-open button:has-text("Later")');
  await cp.waitForSelector('.toast:has-text("Saved in the dream inbox for later.")');
  await cp.click('.codex-link:text-is("Vellmere")');
  await settle(cp);
  assert.equal(await S_(() => [...window.__inkwash.state.seeds.values()].filter((d) => d.from).length), 1);
});

const later = { storageState: await cr.ctx.storageState(), docs: await S_(() => Object.fromEntries([...window.__mock.docs].map(([k, v]) => [k, JSON.parse(v)]))) };
assert.deepEqual(cr.errors, []);
await cr.ctx.close();

await step('coming back hours later: the studio opens where the creator left off, says what is still undecided, and asks nothing of Claude', async () => {
  const r = await open({ seed: later.docs }, null, null, { storageState: later.storageState, later: 3 * 3600e3 });
  await r.page.waitForSelector('.left-off');
  const card = await r.page.textContent('.left-off');
  assert.match(card, /Welcome back to The Glass Orchard/);
  assert.match(card, /Your last change, .*: Saved a question for later\./);
  assert.match(card, /Ripples on Odile Marr: 3 ways you haven’t decided yet/);
  assert.match(card, /1 question you saved for later, in the dream inbox/);
  assert.equal(await r.page.textContent('.left-off .btn.primary'), 'Continue with Vellmere');
  assert.equal(await r.page.evaluate(() => window.__inkwash.state.view), 'canon', 'the view it was left on');
  assert.ok(await r.page.locator('.card[aria-label="Vellmere"]').count(), 'and the entry');
  await r.page.waitForTimeout(400);
  assert.equal(await r.page.evaluate(() => window.__mock.calls.length), 0, 'opening asks nothing of Claude');
  if (wantShots) await r.page.screenshot({ path: join(SHOTS, 'return-light.png') });
  await r.page.click('.left-off button:has-text("Dream inbox")');
  await r.page.waitForSelector('.dream-form');
  assert.equal(await r.page.locator('.left-off').count(), 0, 'once followed, it is gone');
  await r.page.click('.tab >> text=Canon');
  assert.equal(await r.page.locator('.left-off').count(), 0, 'and stays gone');
  assert.deepEqual(r.errors, []);
  await r.ctx.close();
  // a short break is not a return
  const soon = await open({ seed: later.docs }, null, null, { storageState: later.storageState, later: 5 * 60e3 });
  await soon.page.waitForSelector('.codex');
  await soon.page.waitForTimeout(300);
  assert.equal(await soon.page.locator('.left-off').count(), 0);
  await soon.ctx.close();
});

await step('a backup carries the notes; restoring it keeps where each fact came from, and the notes are still known', async () => {
  const r = await open({ seed: later.docs }, null, null, { storageState: later.storageState });
  const p = r.page;
  await p.waitForSelector('.codex');
  await p.click('.tab >> text=Book');
  await p.click('button:has-text("Back up this world")');
  await p.waitForFunction(() => window.__mock.saves.some((x) => x.filename === 'the-glass-orchard-backup.json'));
  const b64 = await p.evaluate(() => window.__mock.saves.find((x) => x.filename === 'the-glass-orchard-backup.json').b64);
  const backup = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  assert.equal(backup.format, 'inkwash-backup/1');
  assert.deepEqual(backup.sources.map((x) => [x.name, x.text]), [['Pasted notes', ORCHARD]]);
  await p.setInputFiles('input[type=file][accept=".json,application/json"]', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await p.waitForFunction(() => window.__inkwash.state.worlds.size === 2);
  await settle(p);
  const restored = await p.evaluate(() => ({ wid: window.__inkwash.state.wid, canon: [...window.__inkwash.state.canon.values()], sources: [...window.__inkwash.state.sources.values()] }));
  assert.equal(restored.sources[0].text, ORCHARD);
  const tamsin = restored.canon.find((e) => e.name === 'Tamsin Hale').facts[0];
  assert.deepEqual([tamsin.origin, tamsin.src, tamsin.declared, tamsin.editedOnImport], ['imported', restored.sources[0].id, true, true]);
  assert.equal(await p.locator('.left-off').count(), 0, 'a world just restored is not a return');
  await p.selectOption('#world-select', '__import');
  await p.fill('#import-text', ORCHARD);
  await p.click('button:has-text("Read my notes")');
  await p.waitForSelector('.banner.warn:has-text("You brought these notes in before.")');
  assert.deepEqual(r.errors, []);
  await r.ctx.close();
});

await step('undoing a reworded fact never quietly passes a scene: one set on the words put back holds again, one set on the undone words is flagged', async () => {
  const r = await open({ seed: exampleDocs(WID) });
  const p = r.page;
  await p.waitForSelector('.score-view');
  const sceneDoc = () => p.evaluate(() => window.__inkwash.state.passages.get('c_lamps__s1'));
  await p.click('.tab >> text=Canon');
  await p.click('.codex-link:text-is("Vesk")');
  await p.fill('#fact-f_vesk_lamps', 'Vesk is a city of a thousand lamps on a cliff above a black sea.');
  await p.keyboard.press('Tab');
  await p.waitForSelector('.toast.warn:has-text("now flagged: chapter 1, scene 1")');
  await p.locator('.toast.warn:has-text("Vesk changed.") button:has-text("Undo")').click();
  await settle(p);
  const scene = (k) => p.evaluate((kk) => { const dots = document.querySelectorAll('.rail-item')[0].querySelectorAll('.dot'); return dots[kk].dataset.state; }, k);
  await p.click('.tab >> text=Score');
  await p.waitForSelector('.rail-item');
  assert.equal(await scene(0), 'set', 'the scene relied on these very words, so it holds');
  const f1 = await p.evaluate(() => window.__inkwash.state.canon.get('e_vesk').facts.find((f) => f.id === 'f_vesk_lamps'));
  assert.deepEqual([f1.v, f1.text], [3, 'Vesk is a city of nine hundred lamps on a cliff above a black sea.']);
  // reword it again, and this time tell the scene its words are still true
  await p.click('.tab >> text=Canon');
  await p.fill('#fact-f_vesk_lamps', 'Vesk is a city of a thousand lamps on a cliff above a black sea.');
  await p.keyboard.press('Tab');
  await p.locator('.toast.warn:has-text("Vesk changed.") button:has-text("Show me")').click();
  await p.waitForSelector('.stale-box');
  await p.click('.stale-box button:has-text("Still true")');
  await p.waitForFunction(() => document.querySelector('#scene-pill').textContent === 'Set');
  assert.deepEqual((await sceneDoc()).premises.find((x) => x.f === 'f_vesk_lamps'), { f: 'f_vesk_lamps', v: 4 });
  // now undo the rewording: the scene was set on the words being undone
  await p.click('#open-history');
  const labels = await p.locator('.history-list li .history-label').allTextContents();
  assert.deepEqual(labels.slice(0, 2), ['Marked chapter 1, scene 1 still true', 'Reworded a fact about Vesk']);
  await p.click('.history-list li:nth-child(2) button:has-text("Undo")');
  await p.keyboard.press('Escape');
  await p.waitForSelector('.toast.warn:has-text("written against the undone words is now flagged: chapter 1, scene 1")');
  await settle(p);
  assert.equal(await p.textContent('#scene-pill'), 'Stale');
  const f2 = await p.evaluate(() => window.__inkwash.state.canon.get('e_vesk').facts.find((f) => f.id === 'f_vesk_lamps'));
  assert.deepEqual([f2.v, f2.text], [5, 'Vesk is a city of nine hundred lamps on a cliff above a black sea.'], 'versions only move forward');
  assert.deepEqual(r.errors, []);
  await r.ctx.close();
});

await step('inking a scene can be undone after the continuity check has run on it', async () => {
  const r = await open({ seed: exampleDocs(WID) });
  const p = r.page;
  await p.waitForSelector('.score-view');
  await p.click('.rail-item >> nth=1');
  await p.click('button:has-text("Ink this scene")');
  await p.waitForFunction(() => { const x = window.__inkwash.state.passages.get('c_door__s1'); return x && x.checkedAt && !window.__inkwash.state.busy['check:c_door__s1']; }, null, { timeout: 10000 });
  assert.ok((await p.evaluate(() => window.__inkwash.state.passages.get('c_door__s1').conflicts.length)) > 0, 'the check found something and saved it');
  await p.click('#open-history');
  assert.equal(await p.textContent('.history-list li:first-child .history-label'), 'Inked chapter 2, scene 1');
  await p.click('.history-list li:first-child button:has-text("Undo")');
  await p.keyboard.press('Escape');
  await p.waitForSelector('.toast:has-text("Undone: Inked chapter 2, scene 1.")');
  assert.ok(!(await p.textContent('#toasts')).includes('changed since'));
  await settle(p);
  assert.equal(await p.evaluate(() => window.__inkwash.state.passages.has('c_door__s1')), false, 'the scene is back to not written');
  assert.equal(await p.evaluate(() => window.__mock.docs.has('studio/w_hollow_moon/passages/c_door__s1')), false);
  assert.deepEqual(r.errors, []);
  await r.ctx.close();
});

await step('work saved just before the page closed: what never reached the store is finished on the next visit', async () => {
  const r = await open({ seed: exampleDocs(WID), loseFirstLife: true });
  const p = r.page;
  await p.waitForSelector('.score-view');
  await p.click('.tab >> text=Canon');
  await p.click('.codex-link:text-is("Mira")');
  await p.fill('#new-fact-e_mira', 'Mira hums when she climbs.');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => window.__inkwash.state.canon.get('e_mira').facts.some((f) => f.text === 'Mira hums when she climbs.'));
  await p.reload();
  await p.waitForSelector('.toast:has-text("hadn\'t arrived when the page last closed")', { timeout: 8000 });
  await settle(p);
  assert.ok((await p.evaluate(() => window.__mock.docs.get('studio/w_hollow_moon/canon/e_mira'))).includes('Mira hums when she climbs.'), 'the store has it now');
  assert.ok(await p.evaluate(() => window.__inkwash.state.canon.get('e_mira').facts.some((f) => f.text === 'Mira hums when she climbs.')));
  assert.equal(await p.evaluate(() => localStorage.getItem('inkwash.pending')), null, 'nothing is left waiting');
  assert.deepEqual(r.errors, []);
  await r.ctx.close();
});

await step('sketchbook mode: a world made a moment before a reload is still there after it', async () => {
  const r = await open({ noDb: true });
  const p = r.page;
  await p.waitForSelector('.welcome');
  await p.click('.choice button:has-text("Start a world")');
  await p.fill('#wf-title', 'A Quick Thought');
  await p.click('#world-form button[type=submit]');
  await p.waitForFunction(() => [...window.__inkwash.state.worlds.values()].some((w) => w.title === 'A Quick Thought'));
  await p.reload();
  await p.waitForSelector('#world-select');
  await p.waitForFunction(() => [...window.__inkwash.state.worlds.values()].some((w) => w.title === 'A Quick Thought'), null, { timeout: 5000 });
  assert.deepEqual(r.errors, []);
  await r.ctx.close();
});

await step('the studio as one file: it opens from disk with its examples, keeps notes in the browser, and the creator\'s own idea needs no Claude', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const net = [];
  p.on('request', (q) => { if (!q.url().startsWith('file:') && !q.url().startsWith('data:') && !q.url().startsWith('blob:')) net.push(q.url()); });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (q) => q.abort());
  await p.goto('file://' + join(DIST, 'inkwash-offline.html'));
  await p.waitForSelector('.welcome');
  assert.match(await p.textContent('#banners'), /Sketchbook mode/);
  await p.click('.choice button:has-text("The Hollow Moon")');
  await p.waitForSelector('.score-view');
  assert.equal(await p.inputValue('#chapter-title'), 'Nine Hundred Lamps');
  assert.match(await p.textContent('#banners'), /running outside claude\.ai, so inking is off/);
  // the creator's own idea, without Claude
  await p.click('.tab >> text=Canon');
  await p.click('.codex-link:text-is("Mira")');
  const fid = await p.evaluate(() => window.__inkwash.state.canon.get('e_mira').facts[0].id);
  await p.click(`.card[aria-label="Mira"] .fact:has(#fact-${fid}) button:has-text("Ripples")`);
  await p.waitForSelector('#ripple-idea-' + fid);
  assert.match(await p.textContent('.card[aria-label="Mira"] .ripples'), /need the claude\.ai version of Inkwash/);
  await p.fill('#ripple-idea-' + fid, 'Mira keeps a jar of lamp smoke she can no longer smell.');
  await p.click('.ripple.way-open.mine button:has-text("Add to Mira")');
  await p.waitForFunction(() => window.__inkwash.state.canon.get('e_mira').facts.some((f) => f.text === 'Mira keeps a jar of lamp smoke she can no longer smell.' && f.origin === 'human'));
  // and notes come in here too
  await p.selectOption('#world-select', '__import');
  await p.selectOption('#import-target', 'new');
  await p.fill('#import-text', ORCHARD);
  await p.click('button:has-text("Read my notes")');
  await p.click('.import-page .btn.primary');
  await p.waitForSelector('.card[aria-label="Vellmere"]');
  await p.evaluate(() => window.__inkwash.flush());
  await p.waitForFunction(() => (localStorage.getItem('inkwash.sketchbook') || '').includes('glassblowers'));
  assert.deepEqual(net.filter((u) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)), [], 'nothing but a request for its typefaces leaves the browser');
  assert.deepEqual(errs, []);
  await ctx.close();
  // the other example opens from the file too
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  await p2.route(/fonts\.(googleapis|gstatic)\.com/, (q) => q.abort());
  await p2.goto('file://' + join(DIST, 'inkwash-offline.html'));
  await p2.click('.choice button:has-text("The Drained Sea")');
  await p2.waitForSelector('.atlas-stage svg', { timeout: 20000 });
  await ctx2.close();
});

await step('a big notes file, about 2,500 lines in 1,400 entries, is reviewed and brought in within seconds', async () => {
  let big = '', i = 0;
  while (big.length < 195000) { big += ORCHARD.replace(/Vellmere|Odile Marr|Tamsin Hale|The Long Rows|The Chime Wardens/g, (m) => `${m} ${i}`) + '\n'; i++; }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (q) => q.abort());
  await p.goto('file://' + join(DIST, 'inkwash-offline.html'));
  await p.click('.choice.lead button:has-text("Bring in notes")');
  await p.waitForSelector('#import-text');
  await p.evaluate((t) => { const ta = document.querySelector('#import-text'); ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true })); }, big);
  let t = Date.now();
  await p.click('button:has-text("Read my notes")');
  await p.waitForSelector('.import-entry');
  const review = Date.now() - t;
  assert.ok((await p.locator('textarea.import-fact').count()) > 2500);
  t = Date.now();
  await p.click('.import-page .btn.primary');
  await p.waitForSelector('.toast:has-text("Brought in")', { timeout: 30000 });
  const accept = Date.now() - t;
  console.log(`     review ${review} ms, accept ${accept} ms`);
  assert.ok(review < 8000 && accept < 8000, `review ${review} ms, accept ${accept} ms`);
  await ctx.close();
});

if (wantShots) {
  // the new screens, on a desktop and on a phone
  for (const [name, vp, scheme] of [['import-light', { width: 1400, height: 950 }, 'light'], ['import-phone-dark', { width: 390, height: 844 }, 'dark']]) {
    const r = await open({ seed: {} }, vp, scheme);
    await r.page.waitForSelector('.welcome');
    if (name === 'import-light') await r.page.screenshot({ path: join(SHOTS, 'welcome-light.png'), fullPage: true });
    await r.page.click('.choice.lead button:has-text("Bring in notes")');
    await r.page.fill('#import-text', ORCHARD);
    await r.page.click('button:has-text("Read my notes")');
    await r.page.waitForSelector('.import-entry');
    const overflow = await r.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`     ${name}: horizontal overflow ${overflow}px`);
    await r.page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: true });
    await r.page.click('.import-page .btn.primary');
    await r.page.waitForSelector('.codex');
    await r.page.click('#open-history');
    await r.page.waitForSelector('.history-list');
    await r.page.screenshot({ path: join(SHOTS, name.replace('import', 'history') + '.png') });
    await r.page.keyboard.press('Escape');
    await r.page.waitForTimeout(200);
    await r.page.screenshot({ path: join(SHOTS, name.replace('import', 'canon-notes') + '.png'), fullPage: name === 'import-light' });
    await r.ctx.close();
  }
  const r = await open({ seed: later.docs }, { width: 390, height: 844 }, 'dark', { storageState: later.storageState, later: 3 * 3600e3 });
  await r.page.waitForSelector('.left-off');
  const overflow = await r.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`     return-phone-dark: horizontal overflow ${overflow}px`);
  await r.page.screenshot({ path: join(SHOTS, 'return-phone-dark.png') });
  await r.ctx.close();
}

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
