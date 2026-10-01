// Dream Canvas providers: Google Gemini paints pictures and makes them move, World Labs turns a
// picture into a world you can walk through. Every request body and every reading of a response
// follows the official REST mapping (the @google/genai 2.25 SDK and the World Labs OpenAPI client),
// written as small pure functions so they can be tested without a network or a key. A fake
// provider stands in for both when testing or demonstrating without keys.

export const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
export const VERTEX = 'https://aiplatform.googleapis.com/v1beta1';
export const WORLDLABS = 'https://api.worldlabs.ai/marble/v1';

export class ProviderError extends Error {
  constructor(message, code, status) { super(message); this.code = code || 'api_error'; this.status = status || 0; }
}

// ---------------------------------------------------------------- what to ask for

export const STYLES = {
  real: 'a photograph taken on location: natural light, real materials and textures, true depth and atmosphere, as if this place exists and someone stood there with a camera',
  film: 'a frame from a big-budget fantasy film: cinematic light, volumetric haze, epic scale and a sense of wonder',
  painted: 'a richly painted piece of concept art: confident brushwork, luminous colour, painterly detail',
  storybook: 'an ink and watercolour illustration from an old storybook: fine pen lines, soft washes, the texture of the paper',
};
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

// The world a picture belongs to, as Inkwash keeps it: what the world is, the place being drawn and
// what is true there. Everything is optional; nothing in it may be contradicted.
function worldLines(world) {
  if (!world || typeof world !== 'object') return '';
  const out = [];
  if (world.title) out.push(`THE WORLD: ${clip(world.title, 80)}${world.premise ? '. ' + clip(world.premise, 600) : ''}`);
  if (world.place && world.place.name) {
    out.push(`THE PLACE: ${clip(world.place.name, 80)}`);
    const facts = (world.place.facts || []).slice(0, 12).map((f) => '- ' + clip(f, 300)).filter((f) => f.length > 2);
    if (facts.length) out.push('WHAT IS TRUE THERE (never contradict it):\n' + facts.join('\n'));
  }
  const rules = (world.rules || []).slice(0, 8).map((f) => '- ' + clip(f, 300)).filter((f) => f.length > 2);
  if (rules.length) out.push('HOW THE WORLD WORKS:\n' + rules.join('\n'));
  return out.join('\n');
}

export function paintPrompt({ dream, style, world }) {
  return [
    'Turn this rough sketch into a finished picture of a place from a dream.',
    `The sketch is the layout: keep its composition, where things stand, their shapes, the horizon and the sense of scale. Render it as ${STYLES[style] || STYLES.real}. Replace the sketch's lines and flat colours entirely: no outlines, no text, no labels, no borders.`,
    dream ? `WHAT IT IS: ${clip(dream, 1500)}` : 'Read what the sketch shows and make it real.',
    worldLines(world),
  ].filter(Boolean).join('\n\n');
}
export function expandPrompt({ dream, style, world }) {
  return [
    'Extend this picture into a wide panoramic view of the same place, as if the camera stepped back and turned to take in everything around it.',
    `Keep the original scene recognisable at the centre, with the same light, weather, time of day and style (${STYLES[style] || STYLES.real}). Continue the land and the sky seamlessly to the left and right, and show what lies around it. No text, no borders, no visible seams.`,
    dream ? `WHAT THIS PLACE IS: ${clip(dream, 1500)}` : '',
    worldLines(world),
  ].filter(Boolean).join('\n\n');
}
export function motionPrompt({ dream, motion }) {
  return [
    `The scene comes alive, exactly as pictured: ${clip(motion, 600) || 'wind moves through it, clouds and water drift, lights flicker, small figures and creatures go about their lives, and the camera slowly drifts forward'}.`,
    'Keep every place and thing as it is in the image. No text or captions.',
    dream ? `What this place is: ${clip(dream, 800)}` : '',
  ].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- Gemini: pictures

// A picture from a picture: the sketch (or the last picture) goes in as inline data with the
// instruction; the answer may carry text and an image.
export function paintBody({ image, mime, prompt, aspect, size }) {
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: mime || 'image/png', data: image } }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: Object.assign({ aspectRatio: aspect || '16:9' }, size ? { imageSize: size } : {}) },
  };
}
export function readImage(json) {
  const cand = ((json && json.candidates) || [])[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join(' ').trim();
  for (const p of parts) {
    const d = p.inlineData || p.inline_data;
    if (d && d.data) return { mime: d.mimeType || d.mime_type || 'image/png', data: d.data, text };
  }
  const blocked = json && json.promptFeedback && json.promptFeedback.blockReason;
  const why = blocked ? `the request was blocked (${blocked})`
    : cand && cand.finishReason && cand.finishReason !== 'STOP' ? `the picture was stopped (${cand.finishReason})` : 'no picture came back';
  throw new ProviderError(text ? `${why}: ${clip(text, 400)}` : why, 'no_image');
}

// ---------------------------------------------------------------- Gemini: video (Veo)

// Sound is asked for only on Vertex AI; the Gemini API refuses the setting.
export function videoBody({ image, mime, prompt, aspect, seconds, resolution, audio }) {
  return {
    instances: [{ prompt, image: { bytesBase64Encoded: image, mimeType: mime || 'image/png' } }],
    parameters: Object.assign({ aspectRatio: aspect || '16:9' }, seconds ? { durationSeconds: seconds } : {}, resolution ? { resolution } : {}, audio != null ? { generateAudio: !!audio } : {}),
  };
}
const progressOf = (meta) => {
  if (!meta || typeof meta !== 'object') return null;
  for (const [k, v] of Object.entries(meta)) if (/progress/i.test(k) && Number.isFinite(Number(v))) return Number(v);
  return null;
};
export function readVideoOp(json) {
  if (!json || typeof json.name !== 'string') throw new ProviderError('the video service answered with no operation', 'bad_answer');
  if (json.error) return { done: true, name: json.name, error: json.error.message || 'the video failed' };
  if (!json.done) return { done: false, name: json.name, progress: progressOf(json.metadata) };
  // the Gemini API answers with generatedSamples[].video; Vertex AI with videos[], usually inline
  const resp = json.response && (json.response.generateVideoResponse || json.response);
  const v = resp && ((resp.generatedSamples && resp.generatedSamples[0] && resp.generatedSamples[0].video) || (resp.videos && resp.videos[0]));
  const uri = v && (v.uri || v.gcsUri), bytes = v && (v.encodedVideo || v.bytesBase64Encoded);
  if (uri || bytes) return { done: true, name: json.name, uri: uri || null, bytes: bytes || null, mime: v.encoding || v.mimeType || 'video/mp4' };
  const reasons = resp && resp.raiMediaFilteredReasons;
  return { done: true, name: json.name, error: reasons && reasons.length ? `the video was held back: ${reasons.join('; ')}` : 'no video came back' };
}

// Which models this key can use: the newest Nano Banana for pictures, and Veo 3.1, cheapest first,
// for video. A name the key doesn't have is skipped rather than failed on.
export const IMAGE_MODELS = ['gemini-3.1-flash-image', 'gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image', 'gemini-3-pro-image', 'gemini-3-pro-image-preview', 'nano-banana-pro-preview'];
export const VIDEO_MODELS = ['veo-3.1-lite-generate-001', 'veo-3.1-lite-generate-preview', 'veo-3.1-fast-generate-001', 'veo-3.1-fast-generate-preview', 'veo-3.1-generate-001', 'veo-3.1-generate-preview', 'veo-3.0-fast-generate-001', 'veo-3.0-generate-001'];
export function pickModels(models) {
  const can = (m, how) => (m.supportedGenerationMethods || []).includes(how);
  const names = (how) => (models || []).filter((m) => m && m.name && can(m, how)).map((m) => m.name.replace(/^models\//, ''));
  const images = names('generateContent'), videos = names('predictLongRunning');
  return {
    image: IMAGE_MODELS.find((n) => images.includes(n)) || images.filter((n) => /image/.test(n)).sort().pop() || null,
    video: VIDEO_MODELS.find((n) => videos.includes(n)) || videos.filter((n) => /^veo/.test(n)).sort().pop() || null,
  };
}

// ---------------------------------------------------------------- World Labs

export const WORLD_MODELS = { quick: 'marble-1.0-draft', full: 'marble-1.1' };
export function worldBody({ image, ext, prompt, name, model }) {
  return {
    display_name: clip(name, 64) || 'A dreamed place',
    model: model || WORLD_MODELS.quick,
    permission: { public: false },
    tags: ['inkwash'],
    world_prompt: Object.assign({ type: 'image', image_prompt: { source: 'data_base64', data_base64: image, extension: ext || 'png' }, is_pano: 'auto' }, prompt ? { text_prompt: clip(prompt, 2000) } : {}),
  };
}
export function readWorld(w) {
  const a = (w && w.assets) || {}, sm = (a.splats && a.splats.semantics_metadata) || {};
  return {
    id: w.world_id, url: w.world_marble_url || null, name: w.display_name || '', caption: a.caption || '',
    thumbnail: a.thumbnail_url || null, pano: (a.imagery && a.imagery.pano_url) || null,
    splats: (a.splats && a.splats.spz_urls) || {}, mesh: a.mesh || {},
    scale: sm.metric_scale_factor != null ? sm.metric_scale_factor : null, ground: sm.ground_plane_offset != null ? sm.ground_plane_offset : null,
  };
}
export function readWorldOp(json) {
  if (!json || typeof json.operation_id !== 'string' || typeof json.done !== 'boolean') throw new ProviderError('the world service answered with no operation', 'bad_answer');
  if (json.error) return { done: true, id: json.operation_id, error: json.error.message || `the world failed${json.error.code != null ? ` (code ${json.error.code})` : ''}` };
  if (!json.done) return { done: false, id: json.operation_id, progress: progressOf(json.metadata) };
  const w = json.response;
  if (!w || !w.world_id) return { done: true, id: json.operation_id, error: 'the world came back empty' };
  const credits = json.cost && Number.isFinite(Number(json.cost.total_credits)) ? Number(json.cost.total_credits) : null;
  return Object.assign({ done: true, id: json.operation_id, world: readWorld(w) }, credits != null ? { credits } : {});
}
// A finished operation carries only part of its world (no name, no panorama); the world itself has
// the rest. What the world says wins, and whatever it leaves empty is kept from the operation.
export function mergeWorld(partial, full) {
  const out = Object.assign({}, partial);
  for (const [k, v] of Object.entries(full || {})) {
    const empty = v == null || v === '' || (typeof v === 'object' && !Object.values(v).some((x) => x != null && x !== ''));
    if (!empty) out[k] = v;
  }
  return out;
}

// Which splat file to walk through. Worlds come at several sizes ("100k", "500k", "full_res"):
// take the largest that fits the budget, or the smallest there is.
export function pickSplat(urls, budget = 600000) {
  const size = (k) => { const m = /^(\d+(?:\.\d+)?)\s*([km]?)$/i.exec(k); return m ? Number(m[1]) * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1) : Infinity; };
  const all = Object.entries(urls || {}).filter(([, u]) => typeof u === 'string' && u).map(([key, url]) => ({ key, url, n: size(key) }));
  if (!all.length) return null;
  const fits = all.filter((x) => x.n <= budget).sort((a, b) => b.n - a.n);
  return fits[0] || all.sort((a, b) => a.n - b.n)[0];
}

// A world to stand in for a real one when testing without keys: a small valley under a starry
// dome, written as a standard Gaussian-splat PLY in the same frame Marble uses (y down, z ahead).
export function standInWorld({ count = 24000, seed = 7 } = {}) {
  let t = seed >>> 0;
  const rand = () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  const SH = 0.28209479177387814, dc = (c) => (c - 0.5) / SH, logit = (a) => Math.log(a / (1 - a));
  const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const head = `ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${props.map((p) => `property float ${p}`).join('\n')}\nend_header\n`;
  const body = Buffer.alloc(count * props.length * 4);
  const hill = (x, z) => 0.9 * Math.sin(x * 0.35) * Math.cos(z * 0.28) + 0.5 * Math.sin(x * 0.9 + z * 0.6);
  for (let i = 0; i < count; i++) {
    let x, y, z, c, s;
    const k = rand();
    if (k < 0.62) { // the valley floor, rolling away in every direction
      const r = 12 * Math.sqrt(rand()), a = rand() * Math.PI * 2;
      x = Math.cos(a) * r; z = Math.sin(a) * r; y = 1.6 - hill(x, z) * Math.min(1, r / 4);
      const g = 0.35 + 0.3 * rand();
      c = [0.18 + 0.2 * g, 0.38 + 0.3 * g, 0.2 + 0.1 * g]; s = 0.09;
    } else if (k < 0.74) { // a ring of trees
      const a = rand() * Math.PI * 2, r = 6 + 4 * rand(), h = rand();
      x = Math.cos(a) * r; z = Math.sin(a) * r; y = 1.6 - hill(x, z) - h * 2.2;
      c = [0.08, 0.25 + 0.15 * rand(), 0.14]; s = 0.12;
    } else { // the dome of the sky, dusk at the horizon and stars above
      const u = rand(), a = rand() * Math.PI * 2, el = Math.asin(u), R = 30;
      x = Math.cos(a) * Math.cos(el) * R; z = Math.sin(a) * Math.cos(el) * R; y = -Math.sin(el) * R + 1;
      const star = rand() < 0.03 && u > 0.3;
      c = star ? [1, 0.97, 0.85] : [0.95 - 0.7 * u, 0.55 - 0.3 * u, 0.45 + 0.1 * u]; s = star ? 0.08 : 0.9;
    }
    const v = [x, y, z, 0, 0, 0, dc(c[0]), dc(c[1]), dc(c[2]), logit(0.92), Math.log(s), Math.log(s), Math.log(s), 1, 0, 0, 0];
    for (let j = 0; j < v.length; j++) body.writeFloatLE(v[j], (i * props.length + j) * 4);
  }
  return Buffer.concat([Buffer.from(head, 'latin1'), body]);
}

// ---------------------------------------------------------------- the clients

async function call(f, url, init, headers) {
  let res;
  try { res = await f(url, Object.assign({}, init, { headers: Object.assign({ 'content-type': 'application/json' }, headers, init && init.headers) })); }
  catch (e) { throw new ProviderError(`couldn't reach ${new URL(url).host} (${e.message})`, 'network'); }
  const body = await res.text();
  let json = null;
  try { json = body ? JSON.parse(body) : null; } catch (e) { json = null; }
  if (!res.ok) {
    const msg = (json && json.error && (json.error.message || json.error.status)) || (json && json.detail && (typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail))) || clip(body, 300) || res.statusText;
    // Google answers a wrong key with 400 and the reason API_KEY_INVALID, not with 401
    const badKey = res.status === 401 || res.status === 403 || /API key not valid|API_KEY_INVALID/i.test(String(msg)) || !!(json && json.error && Array.isArray(json.error.details) && json.error.details.some((d) => d && d.reason === 'API_KEY_INVALID'));
    // a model outside the free tier answers 429 with "limit: 0": no waiting will help, only billing
    const unpaid = res.status === 429 && /free_tier|limit: 0\b/i.test(String(msg));
    const code = badKey ? 'bad_key' : unpaid ? 'no_billing' : res.status === 429 ? 'rate_limited' : res.status === 402 ? 'no_credits' : 'api_error';
    throw new ProviderError(`${new URL(url).host} said ${res.status}: ${clip(msg, 400)}`, code, res.status);
  }
  return json;
}

// Google has two doors to the same models. A key from AI Studio ("AIza…") opens the Gemini API; a
// Google Cloud key ("AQ.…", Vertex AI's express mode) opens Vertex AI. The key's shape picks the
// door, and if that door refuses the key, the other is tried once. Paths follow the SDK for each.
export function googleApi(key) { return /^AIza/.test(String(key || '')) ? 'studio' : 'vertex'; }
const DOORS = {
  studio: { base: GEMINI, model: (m) => `models/${m}` },
  vertex: { base: VERTEX, model: (m) => `publishers/google/models/${m}` },
};
// a model this key, region or door doesn't have: the next one in the list is tried
const missing = (e) => e.status === 404 || (e.status === 400 && /not found|not supported|unsupported model|does not exist/i.test(e.message));

export function gemini({ key, fetch: f = globalThis.fetch, imageModel, videoModel, api }) {
  const headers = { 'x-goog-api-key': key };
  let door = api || googleApi(key), tried = !!api, chosen = null;
  async function models() {
    if (chosen) return chosen;
    let found = { image: null, video: null };
    // A Google Cloud key often opens the Gemini API too, while its project may not have Vertex AI
    // turned on at all (Vertex then answers 403 "API has not been used in project"). So unless a
    // door was chosen, the Gemini API is asked first: it lists the models, and costs nothing.
    if (door === 'studio' || !tried) {
      try {
        const all = [];
        let token = '';
        for (let page = 0; page < 5; page++) {
          const json = await call(f, `${GEMINI}/models?pageSize=1000${token ? '&pageToken=' + encodeURIComponent(token) : ''}`, { method: 'GET' }, headers);
          all.push(...((json && json.models) || []));
          token = json && json.nextPageToken;
          if (!token) break;
        }
        found = pickModels(all);
        if (door === 'vertex') { door = 'studio'; tried = true; }
      } catch (e) {
        if (door === 'studio' && e.code === 'bad_key') throw e; // an AI Studio key the Gemini API refuses is simply wrong
        if (e.code === 'bad_key') tried = true; // the Gemini API refused it: Vertex AI is the only door
      }
    }
    chosen = { api: door, image: imageModel || found.image || IMAGE_MODELS[0], video: videoModel || found.video || VIDEO_MODELS[0] };
    return chosen;
  }
  // the first call learns which door takes this key
  async function through(run) {
    try { return await run(); } catch (e) {
      if (e.code !== 'bad_key' || tried) throw e;
      tried = true;
      const was = door;
      door = door === 'studio' ? 'vertex' : 'studio';
      chosen = null;
      // the other door is kept only if it got past the key; otherwise the first refusal is the news
      try { return await run(); } catch (e2) { if (e2.code === 'bad_key' || e2.code === 'network') { door = was; chosen = null; throw e; } throw e2; }
    }
  }
  // the chosen model first, then the rest of the list, until one exists here
  async function withModel(kind, run) {
    const m = await models(), pinned = kind === 'image' ? imageModel : videoModel;
    const list = pinned ? [pinned] : [m[kind], ...(kind === 'image' ? IMAGE_MODELS : VIDEO_MODELS).filter((x) => x !== m[kind])];
    let first = null;
    for (const name of list) {
      try { const out = await run(DOORS[door], name); m[kind] = name; return out; } catch (e) { if (!missing(e)) throw e; first = first || e; }
    }
    throw first;
  }
  return {
    name: 'gemini',
    models,
    async paint({ image, mime, prompt, aspect, size }) {
      return through(() => withModel('image', async (d, model) =>
        readImage(await call(f, `${d.base}/${d.model(model)}:generateContent`, { method: 'POST', body: JSON.stringify(paintBody({ image, mime, prompt, aspect, size })) }, headers))));
    },
    async startVideo({ image, mime, prompt, aspect, seconds, resolution }) {
      return through(() => withModel('video', async (d, model) =>
        readVideoOp(await call(f, `${d.base}/${d.model(model)}:predictLongRunning`, { method: 'POST', body: JSON.stringify(videoBody({ image, mime, prompt, aspect, seconds, resolution, audio: d === DOORS.vertex ? true : null })) }, headers))));
    },
    // a Vertex AI operation is read back through its model; a Gemini API one by its own name
    async pollVideo(name) {
      if (/^(projects|publishers)\//.test(name)) {
        const json = await call(f, `${VERTEX}/${name.split('/operations/')[0]}:fetchPredictOperation`, { method: 'POST', body: JSON.stringify({ operationName: name }) }, headers);
        return readVideoOp(Object.assign({ name }, json));
      }
      return readVideoOp(await call(f, `${GEMINI}/${name}`, { method: 'GET' }, headers));
    },
    async download(uri) {
      if (/^gs:\/\//.test(uri)) throw new ProviderError('the video was saved to Google Cloud Storage, which the canvas can\'t read', 'api_error');
      const url = /^https?:/.test(uri) ? uri : `${GEMINI}/${uri.replace(/^\/+/, '')}`;
      let res;
      try { res = await f(url, { headers }); } catch (e) { throw new ProviderError(`couldn't download the video (${e.message})`, 'network'); }
      if (!res.ok) throw new ProviderError(`couldn't download the video (${res.status})`, 'api_error', res.status);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

export function worldlabs({ key, fetch: f = globalThis.fetch }) {
  const headers = { 'WLT-Api-Key': key };
  return {
    name: 'worldlabs',
    async start({ image, ext, prompt, name, model }) { return readWorldOp(await call(f, `${WORLDLABS}/worlds:generate`, { method: 'POST', body: JSON.stringify(worldBody({ image, ext, prompt, name, model })) }, headers)); },
    async poll(id) {
      const op = readWorldOp(await call(f, `${WORLDLABS}/operations/${encodeURIComponent(id)}`, { method: 'GET' }, headers));
      if (op.done && op.world) {
        try { op.world = mergeWorld(op.world, readWorld(await call(f, `${WORLDLABS}/worlds/${encodeURIComponent(op.world.id)}`, { method: 'GET' }, headers))); } catch (e) { /* keep what the operation said */ }
      }
      return op;
    },
    fetchAsset: (url) => download(f, url),
  };
}

// World files live on World Labs' storage behind plain links. Only https, and only up to 400 MB.
async function download(f, url) {
  if (!/^https:\/\//.test(String(url))) throw new ProviderError('that world file has no https link', 'bad_answer');
  let res;
  try { res = await f(url); } catch (e) { throw new ProviderError(`couldn't download the world (${e.message})`, 'network'); }
  if (!res.ok) throw new ProviderError(`couldn't download the world (${res.status})`, 'api_error', res.status);
  if (Number(res.headers.get('content-length')) > 400e6) throw new ProviderError('that world is too large to fetch', 'api_error');
  return Buffer.from(await res.arrayBuffer());
}

// A stand-in for both services, for tests and for trying the canvas without keys: it hands the
// picture it was given straight back, and finishes videos and worlds after a couple of looks.
export function fake() {
  let n = 0;
  const looks = new Map();
  const later = (id) => { const k = (looks.get(id) || 0) + 1; looks.set(id, k); return k >= 2; };
  return {
    name: 'fake',
    async models() { return { image: 'fake-image', video: 'fake-video' }; },
    async paint({ image, mime }) { return { mime: mime || 'image/png', data: image, text: 'A stand-in: no picture model is connected.' }; },
    async startVideo() { const name = `models/fake-video/operations/${++n}`; return { done: false, name, progress: 0 }; },
    async pollVideo(name) { return later(name) ? { done: true, name, uri: 'fake://video', bytes: Buffer.from('a stand-in video').toString('base64'), mime: 'video/mp4' } : { done: false, name, progress: 50 }; },
    async download() { return Buffer.from('a stand-in video'); },
    world: {
      name: 'fake',
      async start() { return { done: false, id: `op_fake_${++n}`, progress: 0 }; },
      async poll(id) {
        return later(id)
          ? { done: true, id, world: { id: 'w_fake', url: null, name: 'A stand-in world', caption: 'A stand-in valley: no world model is connected.', thumbnail: null, pano: null, splats: { '100k': 'https://stand-in.invalid/valley.ply' }, mesh: {}, scale: null, ground: null } }
          : { done: false, id, progress: 40 };
      },
      async fetchAsset() { return standInWorld(); },
    },
  };
}

// The same download, for a world made before its key was taken away.
export const fetchAsset = (url, f = globalThis.fetch) => download(f, url);
