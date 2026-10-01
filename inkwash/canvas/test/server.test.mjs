// The server: who it answers, what it keeps, and how a scene grows, with stand-in providers.
//   node --test 'inkwash/canvas/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import * as P from '../lib/providers.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function start(providers, { token = null } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'dream-canvas-test-'));
  const server = createServer(createApp({ dataDir, providers, token }));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(method, path, body, headers = {}) {
    const res = await fetch(base + path, { method, headers: Object.assign({ 'content-type': 'application/json' }, headers), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* a page or a file */ }
    return { status: res.status, json, text, type: res.headers.get('content-type') };
  }
  // a request with headers fetch won't send: another site's Host, or a page from elsewhere
  function raw(path, headers, method = 'GET') {
    return new Promise((ok, no) => {
      const u = new URL(base + path);
      const req = request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => { res.resume(); res.on('end', () => ok(res.statusCode)); });
      req.on('error', no);
      req.end(method === 'POST' ? '{}' : undefined);
    });
  }
  const media = () => readdirSync(join(dataDir, 'media')).sort();
  return { dataDir, base, call, raw, media, close: () => { server.close(); server.closeAllConnections(); rmSync(dataDir, { recursive: true, force: true }); } };
}
const stand = (over = {}) => { const f = P.fake(); return Object.assign({ fake: true, paint: f, world: f.world }, over); };

test('serves the page, and nothing outside it', async () => {
  const s = await start(stand());
  try {
    const page = await s.call('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assert.match(page.text, /Dream Canvas/);
    assert.match((await s.call('GET', '/app.js')).type, /javascript/);
    for (const path of ['/../server.mjs', '/%2e%2e/server.mjs', '/..%2fserver.mjs', '/media/../scenes', '/media/%2e%2e/scenes/x.json', '/%E0%A4%A']) {
      assert.equal(await s.raw(path, {}), 404, path);
    }
    assert.equal((await s.call('GET', '/api/nothing')).status, 404);
    assert.equal((await s.call('PUT', '/app.js', {})).status, 405);
  } finally { s.close(); }
});

test('answers only to its own pages, so no other site can spend your credit', async () => {
  const s = await start(stand());
  try {
    const port = new URL(s.base).port;
    assert.equal(await s.raw('/api/status', { host: `127.0.0.1:${port}` }), 200);
    assert.equal(await s.raw('/api/status', { host: `localhost:${port}` }), 200);
    assert.equal(await s.raw('/api/status', { host: `evil.example:${port}` }), 403, 'another name pointed at this computer');
    assert.equal(await s.raw('/', { host: `evil.example:${port}` }), 403);
    assert.equal(await s.raw('/api/scenes', { host: `localhost:${port}`, origin: 'https://evil.example', 'content-type': 'application/json' }, 'POST'), 403, 'a page elsewhere');
    assert.equal(await s.raw('/api/scenes', { host: `localhost:${port}`, 'content-type': 'text/plain' }, 'POST'), 415, 'a plain form post');
    const sameSite = await s.call('POST', '/api/scenes', { sketch: 'nope' }, { origin: s.base });
    assert.equal(sameSite.status, 400, 'its own page gets through, to be told the sketch is wrong');
    assert.match(sameSite.json.error, /PNG, JPEG or WebP/);
  } finally { s.close(); }
});

test('a passcode guards everything but the page itself on a shared network', async () => {
  const s = await start(stand(), { token: 'secret-pass' });
  try {
    assert.equal((await s.call('GET', '/')).status, 200);
    assert.equal((await s.call('GET', '/app.js')).status, 200);
    assert.equal((await s.call('GET', '/style.css')).status, 200);
    assert.equal((await s.call('GET', '/api/status')).status, 401);
    assert.equal((await s.call('GET', '/api/status', undefined, { 'x-canvas-token': 'wrong' })).status, 401);
    assert.equal((await s.call('GET', '/api/status', undefined, { 'x-canvas-token': 'secret-pass' })).status, 200);
    assert.equal((await s.call('GET', '/api/status?t=secret-pass')).status, 200);
    assert.equal((await s.call('GET', '/media/anything.png')).status, 401);
    const port = new URL(s.base).port;
    assert.equal(await s.raw('/api/status?t=secret-pass', { host: `192.168.1.20:${port}` }), 200, 'a tablet on the Wi-Fi uses the address');
  } finally { s.close(); }
});

test('without keys it says what is missing', async () => {
  const s = await start({ fake: false, paint: null, world: null });
  try {
    assert.deepEqual((await s.call('GET', '/api/status')).json, { fake: false, paint: false, move: false, world: false, models: null });
    const r = await s.call('POST', '/api/scenes', { sketch: PNG });
    assert.equal(r.status, 503);
    assert.match(r.json.error, /GEMINI_API_KEY/);
    assert.deepEqual(s.media(), []);
  } finally { s.close(); }
});

test('a scene grows: painted, widened, set moving, built into a world, walked into, painted again, deleted', async () => {
  const fetched = [];
  const f = P.fake();
  const world = Object.assign({}, f.world, { fetchAsset: async (url) => { fetched.push(url); return f.world.fetchAsset(url); } });
  const s = await start({ fake: true, paint: f, world });
  try {
    let r = await s.call('POST', '/api/scenes', { sketch: PNG, dream: '  A lighthouse\n on the salt  ', style: 'film', world: { title: 'The Drained Sea', place: { name: 'The Last Light', facts: ['The lamp burns green.'] }, rules: [], extra: 'dropped' } });
    assert.equal(r.status, 200);
    let scene = r.json;
    const id = scene.id;
    assert.match(id, /^s_[a-z0-9]+$/);
    assert.equal(scene.dream, 'A lighthouse on the salt');
    assert.equal(scene.style, 'film');
    assert.deepEqual(scene.world, { title: 'The Drained Sea', premise: '', place: { name: 'The Last Light', facts: ['The lamp burns green.'] }, rules: [] });
    assert.equal(scene.takes.length, 1);
    assert.equal(scene.take, 0);
    const t0 = scene.takes[0];
    assert.equal(t0.n, 1);
    assert.equal(t0.sketch, scene.sketch);
    assert.match(t0.note, /stand-in/);
    for (const rel of [scene.sketch, t0.image]) assert.ok(existsSync(join(s.dataDir, rel)), rel);
    assert.equal((await s.call('GET', '/' + t0.image)).type, 'image/png');

    scene = (await s.call('POST', `/api/scenes/${id}/expand`, {})).json;
    assert.match(scene.takes[0].wide, /^media\/s_.*-wide-.*\.png$/);

    scene = (await s.call('POST', `/api/scenes/${id}/move`, { motion: 'the lamp turns', seconds: 8 })).json;
    assert.equal(scene.takes[0].video.status, 'running');
    assert.equal(scene.takes[0].video.seconds, 8);
    assert.equal((await s.call('POST', `/api/scenes/${id}/move`, { seconds: 4 })).json.takes[0].video.seconds, 8, 'one video at a time');
    assert.equal((await s.call('POST', `/api/scenes/${id}/move`, { seconds: 5 })).json.takes[0].video.seconds, 8);

    r = await s.call('POST', `/api/scenes/${id}/splat`, {});
    assert.equal(r.status, 409, 'no world yet');
    scene = (await s.call('POST', `/api/scenes/${id}/world`, { quality: 'full' })).json;
    assert.equal(scene.takes[0].world3d.status, 'running');
    assert.equal(scene.takes[0].world3d.quality, 'full');
    assert.equal(scene.takes[0].world3d.from, scene.takes[0].wide, 'the widest picture there is');

    scene = (await s.call('POST', `/api/scenes/${id}/refresh`, {})).json;
    assert.equal(scene.takes[0].video.status, 'running');
    assert.equal(scene.takes[0].world3d.status, 'running');
    scene = (await s.call('POST', `/api/scenes/${id}/refresh`, {})).json;
    assert.equal(scene.takes[0].video.status, 'done');
    assert.ok(existsSync(join(s.dataDir, scene.takes[0].video.file)));
    assert.equal((await s.call('GET', '/' + scene.takes[0].video.file)).type, 'video/mp4');
    assert.equal(scene.takes[0].world3d.status, 'done');
    assert.equal(scene.takes[0].world3d.world.name, 'A stand-in world');

    r = await s.call('POST', `/api/scenes/${id}/splat`, { budget: 150000 });
    assert.equal(r.status, 200);
    assert.equal(r.json.key, '100k');
    assert.match(r.json.file, /\.ply$/);
    assert.ok(existsSync(join(s.dataDir, r.json.file)));
    const again = await s.call('POST', `/api/scenes/${id}/splat`, { budget: 150000 });
    assert.equal(again.json.file, r.json.file);
    assert.equal(fetched.length, 1, 'the world file is fetched once, then kept');

    // painting again keeps the first painting and everything that grew from it
    scene = (await s.call('POST', `/api/scenes/${id}/paint`, { dream: 'A lighthouse at night', style: 'nonsense' })).json;
    assert.equal(scene.takes.length, 2);
    assert.equal(scene.take, 1);
    assert.equal(scene.dream, 'A lighthouse at night');
    assert.equal(scene.style, 'film', 'an unknown style changes nothing');
    assert.equal(scene.takes[1].n, 2);
    assert.equal(scene.takes[1].sketch, scene.takes[0].sketch, 'the same sketch, when none is sent');
    assert.equal(scene.takes[1].video, null);
    assert.equal(scene.takes[0].video.status, 'done');
    assert.deepEqual(scene.world.place.name, 'The Last Light', 'the world stays when none is sent');
    scene = (await s.call('POST', `/api/scenes/${id}/paint`, { sketch: PNG, world: null })).json;
    assert.equal(scene.takes.length, 3);
    assert.notEqual(scene.takes[2].sketch, scene.takes[0].sketch, 'a changed sketch is kept as its own file');
    assert.equal(scene.sketch, scene.takes[2].sketch);
    assert.equal(scene.world, null, 'and can be let go');
    assert.equal((await s.call('POST', `/api/scenes/${id}/take`, { index: 7 })).status, 400);
    scene = (await s.call('POST', `/api/scenes/${id}/take`, { index: 0 })).json;
    assert.equal(scene.take, 0);
    assert.equal((await s.call('POST', `/api/scenes/${id}/splat`, { budget: 150000 })).json.file, r.json.file);

    const list = (await s.call('GET', '/api/scenes')).json;
    assert.deepEqual(list.map((x) => x.id), [id]);
    assert.equal((await s.call('GET', `/api/scenes/${id}`)).json.takes.length, 3);
    assert.equal((await s.call('GET', '/api/scenes/s_nothing1')).status, 404);
    assert.equal((await s.call('GET', '/api/scenes/../../etc')).status, 404);

    assert.ok(s.media().length >= 8);
    assert.deepEqual((await s.call('DELETE', `/api/scenes/${id}`)).json, { deleted: id });
    assert.deepEqual(s.media(), [], 'every picture, video and world file goes with it');
    assert.deepEqual((await s.call('GET', '/api/scenes')).json, []);
  } finally { s.close(); }
});

test('a slow painting and a quick look at a video never overwrite each other', async () => {
  const f = P.fake();
  let release;
  const gate = new Promise((ok) => { release = ok; });
  let slow = false;
  const paint = Object.assign({}, f, { async paint(req) { if (slow) await gate; return f.paint(req); } });
  const s = await start({ fake: true, paint, world: f.world });
  try {
    const id = (await s.call('POST', '/api/scenes', { sketch: PNG })).json.id;
    await s.call('POST', `/api/scenes/${id}/move`, {});
    slow = true;
    const painting = s.call('POST', `/api/scenes/${id}/paint`, { dream: 'slowly' });
    await new Promise((ok) => setTimeout(ok, 50));
    await s.call('POST', `/api/scenes/${id}/refresh`, {});
    const looked = (await s.call('POST', `/api/scenes/${id}/refresh`, {})).json;
    assert.equal(looked.takes[0].video.status, 'done');
    release();
    const painted = (await painting).json;
    assert.equal(painted.takes.length, 2);
    assert.equal(painted.takes[0].video.status, 'done', 'the painting did not undo the video');

    let stuck = false; // a painting that never comes back
    const s2 = await start({ fake: true, paint: Object.assign({}, f, { paint: (req) => (stuck ? new Promise(() => {}) : f.paint(req)) }), world: f.world });
    try {
      const id2 = (await s2.call('POST', '/api/scenes', { sketch: PNG })).json.id;
      stuck = true;
      s2.call('POST', `/api/scenes/${id2}/expand`, {}).catch(() => {});
      await new Promise((ok) => setTimeout(ok, 50));
      const second = await s2.call('POST', `/api/scenes/${id2}/expand`, {});
      assert.equal(second.status, 409, 'a second panorama while the first is still being painted');
      assert.match(second.json.error, /Already on it/);
    } finally { s2.close(); }
  } finally { s.close(); }
});

test('what the services say becomes a status the page can explain', async () => {
  const f = P.fake();
  const failing = (code) => Object.assign({}, f, { async paint() { throw new P.ProviderError('nope', code); } });
  for (const [code, status] of [['bad_key', 401], ['no_credits', 402], ['rate_limited', 429], ['no_image', 422], ['network', 502], ['api_error', 502]]) {
    const s = await start({ fake: true, paint: failing(code), world: f.world });
    try {
      const r = await s.call('POST', '/api/scenes', { sketch: PNG });
      assert.equal(r.status, status, code);
      assert.deepEqual(r.json, { error: 'nope', code });
      assert.deepEqual(s.media(), [], 'nothing is kept from a painting that failed');
    } finally { s.close(); }
  }
});

test('a job the service forgot is over; a look that failed is tried again', async () => {
  const f = P.fake();
  let mode = 'gone';
  const paint = Object.assign({}, f, { async pollVideo() { throw mode === 'gone' ? new P.ProviderError('not found', 'api_error', 404) : new P.ProviderError('timeout', 'network'); } });
  const s = await start({ fake: true, paint, world: f.world });
  try {
    const id = (await s.call('POST', '/api/scenes', { sketch: PNG })).json.id;
    mode = 'flaky';
    await s.call('POST', `/api/scenes/${id}/move`, {});
    let v = (await s.call('POST', `/api/scenes/${id}/refresh`, {})).json.takes[0].video;
    assert.equal(v.status, 'running');
    assert.equal(v.checkError, 'timeout');
    mode = 'gone';
    v = (await s.call('POST', `/api/scenes/${id}/refresh`, {})).json.takes[0].video;
    assert.equal(v.status, 'failed');
    assert.match(v.error, /no longer has this job/);
    assert.equal(v.checkError, undefined);
  } finally { s.close(); }
});

test('a job started before the key was taken away waits, saying why', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dream-canvas-test-'));
  const f = P.fake();
  const serveWith = async (providers) => {
    const server = createServer(createApp({ dataDir, providers, token: null }));
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (path, body) => (await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    return { call, close: () => { server.close(); server.closeAllConnections(); } };
  };
  try {
    const before = await serveWith({ fake: true, paint: f, world: f.world });
    const id = (await before.call('/api/scenes', { sketch: PNG })).id;
    await before.call(`/api/scenes/${id}/move`, {});
    await before.call(`/api/scenes/${id}/world`, {});
    before.close();
    const after = await serveWith({ fake: false, paint: null, world: null });
    const t = (await after.call(`/api/scenes/${id}/refresh`, {})).takes[0];
    after.close();
    assert.equal(t.video.status, 'running');
    assert.equal(t.video.checkError, 'no video model is connected now');
    assert.equal(t.world3d.checkError, 'no world model is connected now');
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});
