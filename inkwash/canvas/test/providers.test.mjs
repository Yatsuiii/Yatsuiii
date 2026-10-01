// The provider layer: every request body and every reading of an answer, checked against the
// shapes of the Gemini and World Labs REST APIs, with a recorded fetch in place of the network.
//   node --test 'inkwash/canvas/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../lib/providers.mjs';

const reply = (status, body) => new Response(body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body), { status });
function recorder(answers) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    const a = answers.shift();
    if (a === undefined) throw new Error('unexpected call to ' + url);
    if (a instanceof Error) throw a;
    return typeof a === 'function' ? a(url, init) : a;
  };
  return { f, calls };
}
const MODELS = { models: [
  { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/veo-3.1-generate-001', supportedGenerationMethods: ['predictLongRunning'] },
  { name: 'models/veo-3.1-lite-generate-001', supportedGenerationMethods: ['predictLongRunning'] },
] };

test('the painting prompt keeps the sketch, the style, the dream and the world', () => {
  const p = P.paintPrompt({
    dream: 'A lighthouse on a drained sea', style: 'storybook',
    world: { title: 'The Drained Sea', premise: 'The sea left in a night.', place: { name: 'The Last Light', facts: ['The lamp burns green.'] }, rules: ['Salt remembers.'] },
  });
  assert.match(p, /keep its composition/);
  assert.match(p, /ink and watercolour/);
  assert.match(p, /WHAT IT IS: A lighthouse on a drained sea/);
  assert.match(p, /THE WORLD: The Drained Sea\. The sea left in a night\./);
  assert.match(p, /THE PLACE: The Last Light\nWHAT IS TRUE THERE \(never contradict it\):\n- The lamp burns green\./);
  assert.match(p, /HOW THE WORLD WORKS:\n- Salt remembers\./);
  const bare = P.paintPrompt({});
  assert.match(bare, /photograph taken on location/, 'a real photo by default');
  assert.match(bare, /Read what the sketch shows/);
  assert.doesNotMatch(bare + P.expandPrompt({}) + P.motionPrompt({}), /undefined|null|THE WORLD/);
  assert.match(P.expandPrompt({ dream: 'x', style: 'film' }), /panoramic.*\n\n.*big-budget fantasy film/s);
  assert.match(P.motionPrompt({}), /wind moves through it/, 'a gentle default when nothing is said about motion');
  assert.match(P.motionPrompt({ motion: 'the lamp turns' }), /^The scene comes alive, exactly as pictured: the lamp turns\./);
});

test('a picture request carries the image and asks for an image back', () => {
  assert.deepEqual(P.paintBody({ image: 'QUJD', mime: 'image/png', prompt: 'paint', aspect: '21:9', size: '2K' }), {
    contents: [{ role: 'user', parts: [{ text: 'paint' }, { inlineData: { mimeType: 'image/png', data: 'QUJD' } }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '21:9', imageSize: '2K' } },
  });
  assert.deepEqual(P.paintBody({ image: 'x', prompt: 'p' }).generationConfig.imageConfig, { aspectRatio: '16:9' });
});

test('reading a picture, and saying why there is none', () => {
  const ok = P.readImage({ candidates: [{ content: { parts: [{ text: 'Here it is.' }, { inlineData: { mimeType: 'image/jpeg', data: 'SU1H' } }] }, finishReason: 'STOP' }] });
  assert.deepEqual(ok, { mime: 'image/jpeg', data: 'SU1H', text: 'Here it is.' });
  assert.equal(P.readImage({ candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/png', data: 'eA==' } }] } }] }).mime, 'image/png');
  const why = (json) => { try { P.readImage(json); } catch (e) { return [e.code, e.message]; } return null; };
  assert.deepEqual(why({ promptFeedback: { blockReason: 'SAFETY' } }), ['no_image', 'the request was blocked (SAFETY)']);
  assert.deepEqual(why({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }), ['no_image', 'the picture was stopped (IMAGE_SAFETY)']);
  assert.deepEqual(why({ candidates: [{ content: { parts: [{ text: 'I can only describe it.' }] }, finishReason: 'STOP' }] }), ['no_image', 'no picture came back: I can only describe it.']);
});

test('a video request, and every way its operation can end', () => {
  assert.deepEqual(P.videoBody({ image: 'QQ==', mime: 'image/jpeg', prompt: 'move', aspect: '16:9', seconds: 6 }), {
    instances: [{ prompt: 'move', image: { bytesBase64Encoded: 'QQ==', mimeType: 'image/jpeg' } }],
    parameters: { aspectRatio: '16:9', durationSeconds: 6 },
  });
  const name = 'models/veo-3.1-lite-generate-001/operations/abc';
  assert.deepEqual(P.readVideoOp({ name, metadata: { progressPercent: 40 } }), { done: false, name, progress: 40 });
  assert.deepEqual(P.readVideoOp({ name, done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://x/files/v:download?alt=media' } }] } } }),
    { done: true, name, uri: 'https://x/files/v:download?alt=media', bytes: null, mime: 'video/mp4' });
  assert.equal(P.readVideoOp({ name, done: true, response: { generatedSamples: [{ video: { encodedVideo: 'TVA0', encoding: 'video/mp4' } }] } }).bytes, 'TVA0');
  assert.deepEqual(P.readVideoOp({ name, done: true, response: { generateVideoResponse: { raiMediaFilteredReasons: ['a person was shown'] } } }),
    { done: true, name, error: 'the video was held back: a person was shown' });
  assert.deepEqual(P.readVideoOp({ name, done: true, error: { code: 3, message: 'bad image' } }), { done: true, name, error: 'bad image' });
  assert.throws(() => P.readVideoOp({}), (e) => e.code === 'bad_answer');
});

test('the newest picture model and the cheapest Veo are chosen from what the key can use', () => {
  assert.deepEqual(P.pickModels(MODELS.models), { image: 'gemini-3.1-flash-image', video: 'veo-3.1-lite-generate-001' });
  assert.deepEqual(P.pickModels([{ name: 'models/gemini-9-image-x', supportedGenerationMethods: ['generateContent'] }, { name: 'models/veo-9', supportedGenerationMethods: ['predictLongRunning'] }]),
    { image: 'gemini-9-image-x', video: 'veo-9' }, 'unknown future names still work');
  assert.deepEqual(P.pickModels([{ name: 'models/veo-3.1-lite-generate-001', supportedGenerationMethods: ['generateContent'] }]), { image: null, video: null }, 'a model is used only for what it supports');
  assert.deepEqual(P.pickModels(null), { image: null, video: null });
});

test('the Gemini client: the key in a header, the chosen model, and errors that say what to do', async () => {
  const pages = recorder([reply(200, { models: MODELS.models.slice(0, 2), nextPageToken: 'p2' }), reply(200, { models: MODELS.models.slice(2) }),
    reply(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'UE5H' } }] } }] })]);
  const g = P.gemini({ key: 'k-123', fetch: pages.f });
  const out = await g.paint({ image: 'U0s=', mime: 'image/png', prompt: 'paint', aspect: '16:9' });
  assert.deepEqual(out, { mime: 'image/png', data: 'UE5H', text: '' });
  assert.equal(pages.calls[0].url, `${P.GEMINI}/models?pageSize=1000`);
  assert.equal(pages.calls[1].url, `${P.GEMINI}/models?pageSize=1000&pageToken=p2`);
  assert.equal(pages.calls[2].url, `${P.GEMINI}/models/gemini-3.1-flash-image:generateContent`);
  assert.equal(pages.calls[2].method, 'POST');
  assert.equal(pages.calls[2].headers['x-goog-api-key'], 'k-123');
  assert.equal(pages.calls[2].body.contents[0].parts[1].inlineData.data, 'U0s=');
  assert.ok(pages.calls.every((c) => !c.url.includes('k-123')), 'the key never goes in a URL');

  const pinned = recorder([reply(200, { models: [] }), reply(200, { name: 'models/my-veo/operations/1' }), reply(200, { name: 'models/my-veo/operations/1', done: false })]);
  const g2 = P.gemini({ key: 'k', fetch: pinned.f, imageModel: 'my-image', videoModel: 'my-veo' });
  assert.deepEqual(await g2.models(), { image: 'my-image', video: 'my-veo' });
  assert.deepEqual(await g2.startVideo({ image: 'QQ==', prompt: 'move', seconds: 4 }), { done: false, name: 'models/my-veo/operations/1', progress: null });
  assert.equal(pinned.calls[1].url, `${P.GEMINI}/models/my-veo:predictLongRunning`);
  assert.equal(pinned.calls[1].body.parameters.durationSeconds, 4);
  await g2.pollVideo('models/my-veo/operations/1');
  assert.equal(pinned.calls[2].url, `${P.GEMINI}/models/my-veo/operations/1`);
  assert.equal(pinned.calls[2].method, 'GET');

  const dl = recorder([reply(200, 'MP4BYTES')]);
  const g3 = P.gemini({ key: 'k-9', fetch: dl.f, imageModel: 'i', videoModel: 'v' });
  assert.equal((await g3.download('files/abc:download?alt=media')).toString(), 'MP4BYTES');
  assert.equal(dl.calls[0].url, `${P.GEMINI}/files/abc:download?alt=media`);
  assert.equal(dl.calls[0].headers['x-goog-api-key'], 'k-9');

  const fail = async (status, body) => {
    const r = recorder([reply(200, { models: [] }), reply(status, body)]);
    try { await P.gemini({ key: 'k', fetch: r.f }).paint({ image: 'x', prompt: 'p' }); } catch (e) { return [e.code, e.message]; }
  };
  assert.deepEqual(await fail(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }),
    ['bad_key', 'generativelanguage.googleapis.com said 400: API key not valid. Please pass a valid API key.'], 'Google says a key is wrong with a 400');
  assert.equal((await fail(400, { error: { message: 'Unsupported aspect ratio' } }))[0], 'api_error');
  assert.equal((await fail(403, { error: { message: 'Permission denied' } }))[0], 'bad_key');
  assert.equal((await fail(429, { error: { message: 'Quota exceeded' } }))[0], 'rate_limited');
  assert.equal((await fail(500, 'oops'))[1], 'generativelanguage.googleapis.com said 500: oops');
  const offline = recorder([reply(200, { models: [] }), new TypeError('fetch failed')]);
  await assert.rejects(P.gemini({ key: 'k', fetch: offline.f }).paint({ image: 'x', prompt: 'p' }), (e) => e.code === 'network' && /couldn't reach generativelanguage/.test(e.message));
  const refused = recorder([reply(401, { error: { message: 'bad key' } })]);
  await assert.rejects(P.gemini({ key: 'k', fetch: refused.f }).models(), (e) => e.code === 'bad_key', 'a refused key is reported, not hidden behind default models');
});

test('a world request, its operation, and the world it makes', () => {
  assert.deepEqual(P.worldBody({ image: 'SU1H', ext: 'jpg', prompt: 'a lighthouse', name: 'x'.repeat(80), model: 'marble-1.1' }), {
    display_name: 'x'.repeat(64), model: 'marble-1.1', permission: { public: false }, tags: ['inkwash'],
    world_prompt: { type: 'image', image_prompt: { source: 'data_base64', data_base64: 'SU1H', extension: 'jpg' }, is_pano: 'auto', text_prompt: 'a lighthouse' },
  });
  assert.equal(P.worldBody({ image: 'x' }).model, 'marble-1.0-draft', 'quick and cheap unless asked');
  assert.equal(P.worldBody({ image: 'x' }).world_prompt.text_prompt, undefined);
  assert.deepEqual(P.readWorldOp({ operation_id: 'op1', done: false, metadata: { progress_percentage: 30 } }), { done: false, id: 'op1', progress: 30 });
  assert.deepEqual(P.readWorldOp({ operation_id: 'op1', done: true, error: { code: 7, message: null } }), { done: true, id: 'op1', error: 'the world failed (code 7)' });
  assert.deepEqual(P.readWorldOp({ operation_id: 'op1', done: true, response: null }), { done: true, id: 'op1', error: 'the world came back empty' });
  const op = P.readWorldOp({ operation_id: 'op1', done: true, response: {
    world_id: 'w1', display_name: 'Light', world_marble_url: 'https://marble.worldlabs.ai/world/w1',
    assets: { caption: 'A lighthouse', thumbnail_url: 'https://cdn/t.jpg', imagery: { pano_url: 'https://cdn/p.jpg' },
      splats: { spz_urls: { '100k': 'https://cdn/a.spz', '500k': 'https://cdn/b.spz', full_res: 'https://cdn/c.spz' }, semantics_metadata: { metric_scale_factor: 1.7, ground_plane_offset: 0.4 } } },
  } });
  assert.deepEqual(op.world, {
    id: 'w1', url: 'https://marble.worldlabs.ai/world/w1', name: 'Light', caption: 'A lighthouse', thumbnail: 'https://cdn/t.jpg', pano: 'https://cdn/p.jpg',
    splats: { '100k': 'https://cdn/a.spz', '500k': 'https://cdn/b.spz', full_res: 'https://cdn/c.spz' }, mesh: {}, scale: 1.7, ground: 0.4,
  });
  assert.throws(() => P.readWorldOp({ done: true }), (e) => e.code === 'bad_answer');
});

test('the splat file that fits the device', () => {
  const urls = { '100k': 'a', '500k': 'b', full_res: 'c' };
  assert.equal(P.pickSplat(urls).key, '500k');
  assert.equal(P.pickSplat(urls, 150000).key, '100k');
  assert.equal(P.pickSplat(urls, 5e6).key, '500k', 'full resolution is never assumed to fit');
  assert.equal(P.pickSplat({ full_res: 'c' }, 100).key, 'full_res', 'the smallest there is, when nothing fits');
  assert.equal(P.pickSplat({ '2M': 'x', '150k': 'y' }, 1e6).key, '150k');
  assert.equal(P.pickSplat({ '100k': '' }), null);
  assert.equal(P.pickSplat(null), null);
});

test('the World Labs client: the key in its header, the world fetched when an operation omits it', async () => {
  const r = recorder([
    reply(200, { operation_id: 'op9', done: false }),
    reply(200, { operation_id: 'op9', done: true, response: { world_id: 'w9', assets: {} } }),
    reply(200, { world_id: 'w9', display_name: 'Nine', assets: { splats: { spz_urls: { '100k': 'https://cdn/n.spz' } } } }),
  ]);
  const wl = P.worldlabs({ key: 'wl-key', fetch: r.f });
  assert.deepEqual(await wl.start({ image: 'SU1H', ext: 'png', prompt: 'p', name: 'n', model: 'marble-1.0-draft' }), { done: false, id: 'op9', progress: null });
  assert.equal(r.calls[0].url, `${P.WORLDLABS}/worlds:generate`);
  assert.equal(r.calls[0].method, 'POST');
  assert.equal(r.calls[0].headers['WLT-Api-Key'], 'wl-key');
  assert.equal(r.calls[0].body.world_prompt.image_prompt.data_base64, 'SU1H');
  const done = await wl.poll('op9');
  assert.equal(r.calls[1].url, `${P.WORLDLABS}/operations/op9`);
  assert.equal(r.calls[2].url, `${P.WORLDLABS}/worlds/w9`);
  assert.deepEqual(done.world.splats, { '100k': 'https://cdn/n.spz' });
  assert.equal(done.world.name, 'Nine');

  const files = recorder([reply(200, 'SPZ'), reply(404, 'gone')]);
  const wl2 = P.worldlabs({ key: 'wl-key', fetch: files.f });
  assert.equal((await wl2.fetchAsset('https://cdn/n.spz')).toString(), 'SPZ');
  assert.equal(JSON.stringify(files.calls[0].headers), '{}', 'the key never goes to the file storage');
  await assert.rejects(wl2.fetchAsset('https://cdn/old.spz'), /\(404\)/);
  await assert.rejects(wl2.fetchAsset('http://cdn/n.spz'), /https/);
  await assert.rejects(wl2.fetchAsset('file:///etc/passwd'), /https/);
});

test('the stand-ins: a picture echoed, a video and a world after two looks, a valley to walk in', async () => {
  const f = P.fake();
  assert.equal((await f.paint({ image: 'QUJD', mime: 'image/png' })).data, 'QUJD');
  const op = await f.startVideo({});
  assert.equal((await f.pollVideo(op.name)).done, false);
  assert.equal((await f.pollVideo(op.name)).done, true);
  const w = await f.world.start({});
  assert.equal((await f.world.poll(w.id)).done, false);
  const world = (await f.world.poll(w.id)).world;
  assert.equal(P.pickSplat(world.splats).key, '100k');
  const ply = await f.world.fetchAsset(world.splats['100k']);
  const head = ply.subarray(0, 1000).toString('latin1');
  assert.match(head, /^ply\nformat binary_little_endian 1\.0\nelement vertex 24000\n/);
  assert.match(head, /property float f_dc_0[\s\S]*property float rot_3\nend_header\n/);
  assert.equal(ply.length, head.indexOf('end_header\n') + 'end_header\n'.length + 24000 * 17 * 4);
});
