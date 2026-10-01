#!/usr/bin/env node
// Dream Canvas: draw a place from a dream and see it real. You sketch; Gemini paints it as a real
// place, widens it into a panorama and sets it moving; World Labs turns it into a world you can
// walk through. This small server holds your API keys, so they never reach the browser, and keeps
// every scene in a folder on your own disk. No dependencies: Node 18 or later.
//
//   GEMINI_API_KEY=... WORLDLABS_API_KEY=... node inkwash/canvas/server.mjs
//   then open http://localhost:8787
//
// Options: --port 8787 | --lan (reachable from a tablet on your Wi-Fi, behind a passcode)
//          --data <folder> (default: inkwash/canvas/data) | --fake (no keys: a stand-in for testing)
import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, extname, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import * as P from './lib/providers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// A scene is one sketch and every painting made from it. Each painting (a "take") keeps what grew
// from it: the panorama, the moving shot and the walkable world. Painting again adds a take, so
// nothing already made, or paid for, is ever thrown away.
export function createApp({ dataDir, providers, token, log = () => {} }) {
  const PUBLIC = join(HERE, 'public');
  const SCENES = join(dataDir, 'scenes'), MEDIA = join(dataDir, 'media');
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.svg': 'image/svg+xml' };
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4' };
  const ID = /^s_[a-z0-9]{6,40}$/;
  const queues = new Map(), inflight = new Set(), polling = new Set(), fetching = new Map();

  async function ready() { await mkdir(SCENES, { recursive: true }); await mkdir(MEDIA, { recursive: true }); }
  const sceneFile = (id) => join(SCENES, id + '.json');
  async function load(id) {
    if (!ID.test(id)) throw httpError(404, 'No such scene.');
    try { return JSON.parse(await readFile(sceneFile(id), 'utf8')); } catch (e) { throw httpError(404, 'No such scene.'); }
  }
  async function save(scene) {
    scene.updatedAt = Date.now();
    const tmp = sceneFile(scene.id) + '.' + randomBytes(4).toString('hex') + '.tmp';
    await writeFile(tmp, JSON.stringify(scene, null, 2));
    await rename(tmp, sceneFile(scene.id));
    return scene;
  }
  // Changes are applied one at a time to the latest copy on disk, so a slow painting and a quick
  // look at a running video never overwrite each other. The slow calls happen outside.
  function update(id, change) {
    const run = (queues.get(id) || Promise.resolve()).then(async () => { const scene = await load(id); await change(scene); return save(scene); });
    const tail = run.catch(() => {});
    queues.set(id, tail);
    tail.then(() => { if (queues.get(id) === tail) queues.delete(id); });
    return run;
  }
  async function once(key, fn) {
    if (inflight.has(key)) throw httpError(409, 'Already on it.');
    inflight.add(key);
    try { return await fn(); } finally { inflight.delete(key); }
  }

  const stamp = () => Date.now().toString(36) + randomBytes(2).toString('hex');
  async function putMedia(name, bytes) { await writeFile(join(MEDIA, name), bytes); return 'media/' + name; }
  const b64 = async (rel) => (await readFile(join(dataDir, rel))).toString('base64');
  const mimeOf = (rel) => TYPES[extname(rel).toLowerCase()] || 'image/png';
  const exists = (rel) => stat(join(dataDir, rel)).then((s) => s.isFile(), () => false);
  const current = (scene) => scene.takes[scene.take] || scene.takes[scene.takes.length - 1];
  const takeN = (scene, n) => scene.takes.find((t) => t.n === n);

  function dataUrl(v) {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(v || ''));
    if (!m) throw httpError(400, 'The sketch must be a PNG, JPEG or WebP data URL.');
    return { mime: m[1], data: m[2] };
  }
  const text = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  function context(w) {
    if (!w || typeof w !== 'object') return null;
    const list = (a, n) => (Array.isArray(a) ? a.slice(0, n).map((x) => text(x, 300)).filter(Boolean) : []);
    return {
      title: text(w.title, 80), premise: text(w.premise, 600),
      place: w.place && typeof w.place === 'object' ? { name: text(w.place.name, 80), facts: list(w.place.facts, 12) } : null,
      rules: list(w.rules, 8),
    };
  }
  function needPaint() { if (!providers.paint) throw httpError(503, 'No picture model is connected. Start the server with GEMINI_API_KEY.'); }
  function needWorld() { if (!providers.world) throw httpError(503, 'No world model is connected. Start the server with WORLDLABS_API_KEY.'); }

  async function paint(id, sketch, sketchRel, { dream, style, world }) {
    const out = await providers.paint.paint({ image: sketch.data, mime: sketch.mime, prompt: P.paintPrompt({ dream, style, world }), aspect: '16:9' });
    const rel = await putMedia(`${id}-real-${stamp()}.${EXT[out.mime] || 'png'}`, Buffer.from(out.data, 'base64'));
    return { rel, take: { n: 0, sketch: sketchRel, image: rel, note: out.text || '', dream, style, wide: null, video: null, world3d: null, createdAt: Date.now() } };
  }
  // what a finished, failed or still-running job looks like once its service has answered
  async function settleVideo(id, job, op) {
    const base = Object.assign({}, job, { checkError: undefined });
    if (!op.done) return { job: Object.assign(base, { progress: op.progress }) };
    if (op.error) return { job: Object.assign(base, { status: 'failed', error: op.error }) };
    const bytes = op.bytes ? Buffer.from(op.bytes, 'base64') : await providers.paint.download(op.uri);
    const file = await putMedia(`${id}-moving-${stamp()}.mp4`, bytes);
    return { job: Object.assign(base, { status: 'done', file, doneAt: Date.now() }), file };
  }
  function settleWorld(job, op) {
    const base = Object.assign({}, job, { checkError: undefined });
    if (!op.done) return { job: Object.assign(base, { progress: op.progress }) };
    if (op.error) return { job: Object.assign(base, { status: 'failed', error: op.error }) };
    return { job: Object.assign(base, { status: 'done', world: op.world, doneAt: Date.now() }) };
  }
  // a look that failed: a job the service has forgotten is over; anything else, try again later
  const lost = (job, e) => ({ job: e.status === 404 ? Object.assign({}, job, { status: 'failed', error: 'The service no longer has this job.', checkError: undefined }) : Object.assign({}, job, { checkError: e.message }) });

  const routes = [
    ['GET', /^\/api\/status$/, async () => ({
      fake: providers.fake, paint: !!providers.paint, move: !!providers.paint, world: !!providers.world,
      models: providers.paint && !providers.fake ? await providers.paint.models().catch((e) => ({ error: e.message, code: e.code })) : null,
    })],
    ['GET', /^\/api\/scenes$/, async () => {
      const files = (await readdir(SCENES)).filter((f) => f.endsWith('.json'));
      const scenes = [];
      for (const f of files) { try { scenes.push(JSON.parse(await readFile(join(SCENES, f), 'utf8'))); } catch (e) { /* half-written or foreign file */ } }
      return scenes.filter((s) => s && ID.test(s.id) && Array.isArray(s.takes)).sort((a, b) => b.createdAt - a.createdAt);
    }],
    ['GET', /^\/api\/scenes\/(s_[a-z0-9]+)$/, async (m) => load(m[1])],
    // a new scene: the sketch, what it is, and its first painting
    ['POST', /^\/api\/scenes$/, async (m, body) => {
      needPaint();
      const sketch = dataUrl(body.sketch);
      const id = 's_' + Date.now().toString(36) + randomBytes(4).toString('hex');
      const words = { dream: text(body.dream, 1500), style: P.STYLES[body.style] ? body.style : 'real', world: context(body.world) };
      const sketchRel = await putMedia(`${id}-sketch-${stamp()}.${EXT[sketch.mime]}`, Buffer.from(sketch.data, 'base64'));
      let painted;
      try { painted = await paint(id, sketch, sketchRel, words); } catch (e) { await rm(join(dataDir, sketchRel), { force: true }); throw e; }
      painted.take.n = 1;
      return save(Object.assign({ id, createdAt: Date.now() }, words, { sketch: sketchRel, takes: [painted.take], take: 0, files: [sketchRel, painted.rel] }));
    }],
    // paint it again, from the same sketch or a changed one, perhaps with new words or a new style
    ['POST', /^\/api\/scenes\/(s_[a-z0-9]+)\/paint$/, async (m, body) => {
      needPaint();
      const scene = await load(m[1]);
      const words = {
        dream: body.dream != null ? text(body.dream, 1500) : scene.dream,
        style: P.STYLES[body.style] ? body.style : scene.style,
        world: body.world !== undefined ? context(body.world) : scene.world,
      };
      let sketch, sketchRel = null;
      if (body.sketch) { sketch = dataUrl(body.sketch); sketchRel = await putMedia(`${scene.id}-sketch-${stamp()}.${EXT[sketch.mime]}`, Buffer.from(sketch.data, 'base64')); }
      const from = sketchRel || current(scene).sketch || scene.sketch;
      if (!sketch) sketch = { mime: mimeOf(from), data: await b64(from) };
      let painted;
      try { painted = await paint(scene.id, sketch, from, words); } catch (e) { if (sketchRel) await rm(join(dataDir, sketchRel), { force: true }); throw e; }
      return update(scene.id, (s) => {
        Object.assign(s, words);
        if (sketchRel) s.sketch = sketchRel;
        painted.take.n = s.takes.reduce((a, t) => Math.max(a, t.n), 0) + 1;
        s.takes.push(painted.take);
        s.take = s.takes.length - 1;
        s.files.push(...[sketchRel, painted.rel].filter(Boolean));
      });
    }],
    // go back to an earlier painting, with everything that grew from it
    ['POST', /^\/api\/scenes\/(s_[a-z0-9]+)\/take$/, async (m, body) => update(m[1], (s) => {
      const i = Number(body.index);
      if (!Number.isInteger(i) || i < 0 || i >= s.takes.length) throw httpError(400, 'No such painting.');
      s.take = i;
    })],
    // widen it: the same place, as far as the eye can see to either side
    ['POST', /^\/api\/scenes\/(s_[a-z0-9]+)\/expand$/, async (m) => {
      needPaint();
      const scene = await load(m[1]), t = current(scene);
      return once(`${scene.id}:${t.n}:expand`, async () => {
        const out = await providers.paint.paint({ image: await b64(t.image), mime: mimeOf(t.image), prompt: P.expandPrompt({ dream: t.dream, style: t.style, world: scene.world }), aspect: '21:9' });
        const rel = await putMedia(`${scene.id}-wide-${stamp()}.${EXT[out.mime] || 'png'}`, Buffer.from(out.data, 'base64'));
        return update(scene.id, (s) => { takeN(s, t.n).wide = rel; s.files.push(rel); });
      });
    }],
    // set it moving: a few seconds of video from the picture
    ['POST', /^\/api\/scenes\/(s_[a-z0-9]+)\/move$/, async (m, body) => {
      needPaint();
      const scene = await load(m[1]), t = current(scene);
      if (t.video && t.video.status === 'running') return scene;
      return once(`${scene.id}:${t.n}:move`, async () => {
        const seconds = [4, 6, 8].includes(Number(body.seconds)) ? Number(body.seconds) : 6, motion = text(body.motion, 600);
        const op = await providers.paint.startVideo({ image: await b64(t.image), mime: mimeOf(t.image), prompt: P.motionPrompt({ dream: t.dream, motion }), aspect: '16:9', seconds });
        const done = await settleVideo(scene.id, { status: 'running', op: op.name, motion, seconds, startedAt: Date.now(), progress: op.progress }, op);
        return update(scene.id, (s) => { takeN(s, t.n).video = done.job; if (done.file) s.files.push(done.file); });
      });
    }],
    // step inside it: a world built from the widest picture there is
    ['POST', /^\/api\/scenes\/(s_[a-z0-9]+)\/world$/, async (m, body) => {
      needWorld();
      const scene = await load(m[1]), t = current(scene);
      if (t.world3d && t.world3d.status === 'running') return scene;
      return once(`${scene.id}:${t.n}:world`, async () => {
        const quality = body.quality === 'full' ? 'full' : 'quick', from = t.wide || t.image;
        const op = await providers.world.start({ image: await b64(from), ext: extname(from).slice(1) || 'png', prompt: t.dream, name: t.dream || 'A dreamed place', model: P.WORLD_MODELS[quality] });
        const done = settleWorld({ status: 'running', op: op.id, quality, from, startedAt: Date.now(), progress: op.progress }, op);
        return update(scene.id, (s) => { takeN(s, t.n).world3d = done.job; });
      });
    }],
    // look again at whatever is still being made, in every take
    ['POST', /^\/api\/scenes\/(s_[a-z0-9]+)\/refresh$/, async (m) => {
      const scene = await load(m[1]);
      if (polling.has(scene.id)) return scene;
      polling.add(scene.id);
      try {
        const changes = [];
        // a job started before the server lost its key waits, saying why, until the key is back
        const keyless = (job, name) => ({ job: Object.assign({}, job, { checkError: `no ${name} is connected now` }) });
        for (const t of scene.takes) {
          if (t.video && t.video.status === 'running') {
            changes.push([t.n, 'video', !providers.paint ? keyless(t.video, 'video model')
              : await providers.paint.pollVideo(t.video.op).then((op) => settleVideo(scene.id, t.video, op), (e) => lost(t.video, e))]);
          }
          if (t.world3d && t.world3d.status === 'running') {
            changes.push([t.n, 'world3d', !providers.world ? keyless(t.world3d, 'world model')
              : await providers.world.poll(t.world3d.op).then((op) => settleWorld(t.world3d, op), (e) => lost(t.world3d, e))]);
          }
        }
        if (!changes.length) return scene;
        return await update(scene.id, (s) => {
          for (const [n, key, c] of changes) { takeN(s, n)[key] = c.job; if (c.file) s.files.push(c.file); }
        });
      } finally { polling.delete(scene.id); }
    }],
    // bring the walkable world home: fetched once, then kept beside the scene, so stepping in is
    // quick and still works after the service's links expire
    ['POST', /^\/api\/scenes\/(s_[a-z0-9]+)\/splat$/, async (m, body) => {
      const scene = await load(m[1]), t = current(scene);
      const w = t.world3d && t.world3d.status === 'done' && t.world3d.world;
      if (!w) throw httpError(409, 'Build the world first.');
      const pick = P.pickSplat(w.splats, Number(body.budget) > 0 ? Number(body.budget) : undefined);
      if (!pick) throw httpError(409, 'This world has no files to walk through here. Open it in Marble instead.');
      const answer = (file) => ({ file, key: pick.key, scale: w.scale, ground: w.ground });
      const have = ((t.world3d.files || {})[pick.key]);
      if (have && await exists(have)) return answer(have);
      const k = `${scene.id}:${t.n}:${pick.key}`;
      if (!fetching.has(k)) {
        fetching.set(k, (async () => {
          const bytes = await (providers.world || { fetchAsset: P.fetchAsset }).fetchAsset(pick.url);
          const rel = await putMedia(`${scene.id}-world-${pick.key.replace(/[^a-z0-9]/gi, '')}-${stamp()}.${bytes.subarray(0, 3).toString('latin1') === 'ply' ? 'ply' : 'spz'}`, bytes);
          await update(scene.id, (s) => { const tt = takeN(s, t.n); tt.world3d.files = Object.assign({}, tt.world3d.files, { [pick.key]: rel }); s.files.push(rel); });
          return rel;
        })().finally(() => fetching.delete(k)));
      }
      return answer(await fetching.get(k));
    }],
    ['DELETE', /^\/api\/scenes\/(s_[a-z0-9]+)$/, async (m) => {
      const scene = await load(m[1]);
      const all = new Set([...(scene.files || []), scene.sketch, ...scene.takes.flatMap((t) => [t.sketch, t.image, t.wide, t.video && t.video.file, ...Object.values((t.world3d && t.world3d.files) || {})])]);
      for (const rel of all) if (/^media\/[A-Za-z0-9._-]+$/.test(String(rel))) await rm(join(dataDir, rel), { force: true });
      await rm(sceneFile(scene.id), { force: true });
      return { deleted: scene.id };
    }],
  ];

  function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
  const STATUS = { bad_key: 401, no_credits: 402, rate_limited: 429, network: 502, no_image: 422, bad_answer: 502, api_error: 502 };
  function send(res, status, body, type) {
    res.writeHead(status, { 'content-type': type || 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(type ? body : JSON.stringify(body));
  }
  async function bodyOf(req) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 40 * 1024 * 1024) throw httpError(413, 'That is too large.'); chunks.push(c); }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { throw httpError(400, 'The request was not JSON.'); }
  }
  async function file(res, root, rel) {
    let p;
    try { p = resolve(root, '.' + decodeURIComponent(rel)); } catch (e) { return send(res, 404, { error: 'Not found.' }); }
    if (!p.startsWith(resolve(root) + sep)) return send(res, 404, { error: 'Not found.' });
    try { const st = await stat(p); if (!st.isFile()) throw new Error('not a file'); } catch (e) { return send(res, 404, { error: 'Not found.' }); }
    res.writeHead(200, { 'content-type': TYPES[extname(p).toLowerCase()] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
    createReadStream(p).on('error', () => res.destroy()).pipe(res);
  }
  // Without a passcode the canvas answers only to itself: not to another website open in the same
  // browser, and not to another site's name pointed at this computer. Either could spend your credit.
  const LOCAL = ['localhost', '127.0.0.1', '[::1]'];
  function foreign(req) {
    if (token) return false;
    if (!LOCAL.includes(String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase())) return true;
    const origin = req.headers.origin;
    if (!origin) return false;
    try { return !LOCAL.includes(new URL(origin).hostname); } catch (e) { return true; }
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    try {
      await ready();
      if (foreign(req)) return send(res, 403, { error: 'Dream Canvas only answers to pages it served itself.' });
      // on a shared network, everything but the page itself needs the passcode
      if (token && url.pathname !== '/' && !url.pathname.match(/^\/(app\.js|walk\.js|style\.css|favicon\.svg)$/)) {
        const given = req.headers['x-canvas-token'] || url.searchParams.get('t');
        if (given !== token) return send(res, 401, { error: 'This canvas needs its passcode: use the link the server printed.' });
      }
      if (url.pathname.startsWith('/api/')) {
        const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname));
        if (!route) return send(res, 404, { error: 'No such call.' });
        // a plain form or a no-cors request from elsewhere can't send JSON, so only JSON changes anything
        if (req.method !== 'GET' && !/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Send JSON.' });
        const body = req.method === 'POST' ? await bodyOf(req) : {};
        return send(res, 200, await route[2](route[1].exec(url.pathname), body));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Not here.' });
      if (url.pathname.startsWith('/media/')) return file(res, MEDIA, url.pathname.slice('/media'.length));
      return file(res, PUBLIC, url.pathname === '/' ? '/index.html' : url.pathname);
    } catch (e) {
      const status = e.status && e.status < 600 && !e.code ? e.status : STATUS[e.code] || e.status || 500;
      if (status >= 500) log(`${req.method} ${url.pathname}: ${e.message}`);
      if (!res.headersSent) send(res, status, { error: e.message, code: e.code || null });
      else res.end();
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes('--' + name);
  const opt = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
  const fake = flag('fake');
  const gkey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY, wkey = process.env.WORLDLABS_API_KEY;
  const f = P.fake();
  const providers = {
    fake,
    paint: fake ? f : gkey ? P.gemini({ key: gkey, imageModel: process.env.GEMINI_IMAGE_MODEL, videoModel: process.env.GEMINI_VIDEO_MODEL }) : null,
    world: fake ? f.world : wkey ? P.worldlabs({ key: wkey }) : null,
  };
  const lan = flag('lan'), port = Number(opt('port', process.env.PORT || 8787));
  const token = lan ? randomBytes(9).toString('base64url') : null;
  const handle = createApp({ dataDir: resolve(opt('data', join(HERE, 'data'))), providers, token, log: (m) => console.error(m) });
  createServer(handle).listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
    console.log('Dream Canvas is open:');
    console.log(`  on this computer  http://localhost:${port}/${token ? '?t=' + token : ''}`);
    if (lan) for (const list of Object.values(networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  on your Wi-Fi     http://${a.address}:${port}/?t=${token}`);
    console.log(`  pictures and video: ${providers.paint ? (fake ? 'stand-in (--fake)' : 'Gemini') : 'off (set GEMINI_API_KEY)'}`);
    console.log(`  walkable worlds:    ${providers.world ? (fake ? 'stand-in (--fake)' : 'World Labs') : 'off (set WORLDLABS_API_KEY)'}`);
  });
}
