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
const STUDIO_KEY = 'AIza' + 'x'.repeat(35); // the shape of an AI Studio key; a test value
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
  const g = P.gemini({ key: STUDIO_KEY, fetch: pages.f });
  const out = await g.paint({ image: 'U0s=', mime: 'image/png', prompt: 'paint', aspect: '16:9' });
  assert.deepEqual(out, { mime: 'image/png', data: 'UE5H', text: '' });
  assert.equal(pages.calls[0].url, `${P.GEMINI}/models?pageSize=1000`);
  assert.equal(pages.calls[1].url, `${P.GEMINI}/models?pageSize=1000&pageToken=p2`);
  assert.equal(pages.calls[2].url, `${P.GEMINI}/models/gemini-3.1-flash-image:generateContent`);
  assert.equal(pages.calls[2].method, 'POST');
  assert.equal(pages.calls[2].headers['x-goog-api-key'], STUDIO_KEY);
  assert.equal(pages.calls[2].body.contents[0].parts[1].inlineData.data, 'U0s=');
  assert.ok(pages.calls.every((c) => !c.url.includes(STUDIO_KEY)), 'the key never goes in a URL');

  const pinned = recorder([reply(200, { models: [] }), reply(200, { name: 'models/my-veo/operations/1' }), reply(200, { name: 'models/my-veo/operations/1', done: false })]);
  const g2 = P.gemini({ key: STUDIO_KEY, fetch: pinned.f, imageModel: 'my-image', videoModel: 'my-veo' });
  assert.deepEqual(await g2.models(), { api: 'studio', image: 'my-image', video: 'my-veo' });
  assert.deepEqual(await g2.startVideo({ image: 'QQ==', prompt: 'move', seconds: 4 }), { done: false, name: 'models/my-veo/operations/1', progress: null });
  assert.equal(pinned.calls[1].url, `${P.GEMINI}/models/my-veo:predictLongRunning`);
  assert.equal(pinned.calls[1].body.parameters.durationSeconds, 4);
  await g2.pollVideo('models/my-veo/operations/1');
  assert.equal(pinned.calls[2].url, `${P.GEMINI}/models/my-veo/operations/1`);
  assert.equal(pinned.calls[2].method, 'GET');

  const dl = recorder([reply(200, 'MP4BYTES')]);
  const g3 = P.gemini({ key: STUDIO_KEY, fetch: dl.f, imageModel: 'i', videoModel: 'v' });
  assert.equal((await g3.download('files/abc:download?alt=media')).toString(), 'MP4BYTES');
  assert.equal(dl.calls[0].url, `${P.GEMINI}/files/abc:download?alt=media`);
  assert.equal(dl.calls[0].headers['x-goog-api-key'], STUDIO_KEY);

  const fail = async (status, body) => {
    const r = recorder([reply(200, { models: [] }), reply(status, body)]);
    try { await P.gemini({ key: STUDIO_KEY, fetch: r.f }).paint({ image: 'x', prompt: 'p' }); } catch (e) { return [e.code, e.message]; }
  };
  assert.deepEqual(await fail(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }),
    ['bad_key', 'generativelanguage.googleapis.com said 400: API key not valid. Please pass a valid API key.'], 'Google says a key is wrong with a 400');
  assert.equal((await fail(400, { error: { message: 'Unsupported aspect ratio' } }))[0], 'api_error');
  assert.equal((await fail(403, { error: { message: 'Permission denied' } }))[0], 'bad_key');
  assert.equal((await fail(429, { error: { message: 'Quota exceeded' } }))[0], 'rate_limited');
  // what the Gemini API really answers a key whose project has no billing, for a picture model
  assert.equal((await fail(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. \n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-flash-image' } }))[0], 'no_billing', 'no waiting helps a model outside the free tier');
  assert.equal((await fail(500, 'oops'))[1], 'generativelanguage.googleapis.com said 500: oops');
  const offline = recorder([reply(200, { models: [] }), new TypeError('fetch failed')]);
  await assert.rejects(P.gemini({ key: STUDIO_KEY, fetch: offline.f }).paint({ image: 'x', prompt: 'p' }), (e) => e.code === 'network' && /couldn't reach generativelanguage/.test(e.message));
  const refused = recorder([reply(401, { error: { message: 'bad key' } })]);
  await assert.rejects(P.gemini({ key: STUDIO_KEY, fetch: refused.f }).models(), (e) => e.code === 'bad_key', 'a refused key is reported, not hidden behind default models');
});

test('a Google Cloud key goes through Vertex AI, as the SDK does in express mode', async () => {
  const name = 'projects/p1/locations/us-central1/publishers/google/models/veo-3.1-lite-generate-001/operations/op7';
  const r = recorder([
    reply(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }),
    reply(404, { error: { code: 404, message: 'Publisher Model `gemini-3.1-flash-image` was not found.' } }),
    reply(200, { candidates: [{ content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/png', data: 'VlRY' } }] } }] }),
    reply(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'VlRZ' } }] } }] }),
    reply(200, { name }),
    reply(200, { done: true, response: { '@type': 'type.googleapis.com/cloud.ai.large_models.vision.GenerateVideoResponse', videos: [{ bytesBase64Encoded: 'TVA0', mimeType: 'video/mp4' }] } }),
  ]);
  assert.equal(P.googleApi('AQ.Ab8-test'), 'vertex');
  assert.equal(P.googleApi(STUDIO_KEY), 'studio');
  const g = P.gemini({ key: 'AQ.Ab8-test', fetch: r.f });
  assert.deepEqual(await g.models(), { api: 'vertex', image: P.IMAGE_MODELS[0], video: P.VIDEO_MODELS[0] }, 'no model list to read on Vertex');
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls.shift().url, `${P.GEMINI}/models?pageSize=1000`, 'the Gemini API is asked first, and refuses this key');
  assert.equal((await g.paint({ image: 'U0s=', prompt: 'paint' })).data, 'VlRY');
  assert.equal(r.calls[0].url, `${P.VERTEX}/publishers/google/models/gemini-3.1-flash-image:generateContent`);
  assert.equal(r.calls[1].url, `${P.VERTEX}/publishers/google/models/gemini-3.1-flash-image-preview:generateContent`, 'a model Vertex lacks is skipped');
  assert.equal(r.calls[1].headers['x-goog-api-key'], 'AQ.Ab8-test');
  assert.equal(r.calls[1].body.contents[0].role, 'user');
  assert.equal((await g.paint({ image: 'U0s=', prompt: 'again' })).data, 'VlRZ');
  assert.equal(r.calls[2].url, r.calls[1].url, 'and the model that worked is remembered');
  const op = await g.startVideo({ image: 'QQ==', prompt: 'move', seconds: 4 });
  assert.equal(r.calls[3].url, `${P.VERTEX}/publishers/google/models/veo-3.1-lite-generate-001:predictLongRunning`);
  assert.equal(r.calls[3].body.parameters.generateAudio, true, 'Vertex videos come with sound');
  assert.equal(r.calls[3].body.instances[0].image.bytesBase64Encoded, 'QQ==');
  assert.deepEqual(op, { done: false, name, progress: null });
  const done = await g.pollVideo(name);
  assert.equal(r.calls[4].url, `${P.VERTEX}/projects/p1/locations/us-central1/publishers/google/models/veo-3.1-lite-generate-001:fetchPredictOperation`);
  assert.equal(r.calls[4].method, 'POST');
  assert.deepEqual(r.calls[4].body, { operationName: name });
  assert.deepEqual(done, { done: true, name, uri: null, bytes: 'TVA0', mime: 'video/mp4' });
  assert.equal(P.videoBody({ image: 'x', prompt: 'p' }).parameters.generateAudio, undefined, 'never sent to the Gemini API, which refuses it');
  await assert.rejects(g.download('gs://bucket/v.mp4'), /Google Cloud Storage/);
  assert.equal(P.readVideoOp({ name, done: true, response: { videos: [{ gcsUri: 'gs://b/v.mp4' }] } }).uri, 'gs://b/v.mp4');
});

test('a Google Cloud key that the Gemini API takes goes there, since Vertex AI may be off in its project', async () => {
  // what Vertex AI really answers a Google Cloud key whose project hasn't turned it on
  const off = { error: { code: 403, message: 'Agent Platform API has not been used in project 123456789012 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/aiplatform.googleapis.com/overview?project=123456789012 then retry.', status: 'PERMISSION_DENIED' } };
  const live = { models: [
    { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent', 'countTokens', 'batchGenerateContent'] },
    { name: 'models/gemini-3.1-flash-lite-image', supportedGenerationMethods: ['generateContent', 'countTokens', 'batchGenerateContent'] },
    { name: 'models/veo-3.1-generate-preview', supportedGenerationMethods: ['predictLongRunning'] },
    { name: 'models/veo-3.1-fast-generate-preview', supportedGenerationMethods: ['predictLongRunning'] },
    { name: 'models/veo-3.1-lite-generate-preview', supportedGenerationMethods: ['predictLongRunning'] },
  ] };
  const r = recorder([reply(200, live), reply(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'T0s=' } }] } }] })]);
  const g = P.gemini({ key: 'AQ.Ab8-test', fetch: r.f });
  assert.deepEqual(await g.models(), { api: 'studio', image: 'gemini-3.1-flash-image', video: 'veo-3.1-lite-generate-preview' });
  assert.equal((await g.paint({ image: 'x', prompt: 'p' })).data, 'T0s=');
  assert.equal(r.calls[0].url, `${P.GEMINI}/models?pageSize=1000`);
  assert.equal(r.calls[1].url, `${P.GEMINI}/models/gemini-3.1-flash-image:generateContent`);
  assert.equal(r.calls.length, 2, 'Vertex AI is never tried');

  // if the list can't be read, Vertex AI is tried, and its refusal sends the key to the Gemini API
  const swap = recorder([new TypeError('fetch failed'), reply(403, off), reply(200, MODELS), reply(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'T0s=' } }] } }] })]);
  const g2 = P.gemini({ key: 'AQ.Ab8-test', fetch: swap.f });
  assert.equal((await g2.paint({ image: 'x', prompt: 'p' })).data, 'T0s=');
  assert.match(swap.calls[1].url, /^https:\/\/aiplatform\.googleapis\.com\//);
  assert.equal(swap.calls[2].url, `${P.GEMINI}/models?pageSize=1000`);
  assert.equal(swap.calls[3].url, `${P.GEMINI}/models/gemini-3.1-flash-image:generateContent`);
  assert.equal((await g2.models()).api, 'studio', 'and the door that worked is kept');

  // refused at both: Vertex AI's refusal is what you hear
  const both = recorder([reply(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }), reply(403, off)]);
  await assert.rejects(P.gemini({ key: 'AQ.bad', fetch: both.f }).paint({ image: 'x', prompt: 'p' }), (e) => e.code === 'bad_key' && /aiplatform\.googleapis\.com said 403: Agent Platform API has not been used/.test(e.message));
  assert.equal(both.calls.length, 2);
  const pinned = recorder([reply(401, { error: { message: 'no' } })]);
  await assert.rejects(P.gemini({ key: 'AQ.x', fetch: pinned.f, api: 'vertex' }).paint({ image: 'x', prompt: 'p' }), (e) => e.code === 'bad_key');
  assert.equal(pinned.calls.length, 1, 'a chosen door is never switched');
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

  // what Marble really answers for a finished draft world: the operation's world has splats but no
  // name and no panorama, and the progress is a status, not a number; the world itself has the rest
  const cdn = 'https://cdn.marble.worldlabs.ai/w1';
  const spz = { '500k': `${cdn}/a_500k.spz`, '100k': `${cdn}/b_100k.spz`, full_res: `${cdn}/c.spz` };
  const live = recorder([
    reply(200, { operation_id: 'op1', done: false, error: null, metadata: { progress: { status: 'IN_PROGRESS', description: 'Generating world' }, world_id: 'w1', operation_type: 'world_generation', public_model_name: 'marble-1.0-draft' }, response: null }),
    reply(200, { operation_id: 'op1', done: true, error: null,
      metadata: { progress: { status: 'SUCCEEDED', description: 'World generation completed successfully' }, world_id: 'w1', operation_type: 'world_generation', public_model_name: 'marble-1.0-draft' },
      response: { world_id: 'w1', display_name: '', tags: null, assets: { mesh: { collider_mesh_url: `${cdn}/m.glb`, hq_mesh_url: null, full_res_mesh_url: null }, imagery: { pano_url: null }, splats: { spz_urls: spz, semantics_metadata: null }, thumbnail_url: `${cdn}/thumbnail.webp`, caption: 'A lighthouse on a cliff.' }, created_at: null, permission: { public: false }, world_prompt: null, world_marble_url: 'https://marble.worldlabs.ai/world/w1', model: null },
      cost: { total_credits: 230, line_items: [{ name: 'Pano generation (image, non-pano)', credits: 80 }, { name: 'Draft world generation', credits: 150 }] } }),
    reply(200, { world_id: 'w1', display_name: 'The Drained Sea at dawn', tags: ['inkwash'], assets: { mesh: { collider_mesh_url: `${cdn}/m.glb`, hq_mesh_url: null, full_res_mesh_url: null }, imagery: { pano_url: `${cdn}/rgb_0.png` }, splats: { spz_urls: spz, semantics_metadata: null }, thumbnail_url: `${cdn}/thumbnail.webp`, caption: 'A lighthouse on a cliff.' }, world_marble_url: 'https://marble.worldlabs.ai/world/w1', model: 'marble-1.0-draft' }),
  ]);
  const wl3 = P.worldlabs({ key: 'wl-key', fetch: live.f });
  assert.deepEqual(await wl3.poll('op1'), { done: false, id: 'op1', progress: null }, 'a status, not a number, is no progress to show');
  const built = await wl3.poll('op1');
  assert.equal(live.calls[2].url, `${P.WORLDLABS}/worlds/w1`, 'the world is read even though the operation has its splats');
  assert.equal(built.credits, 230);
  assert.deepEqual(built.world, {
    id: 'w1', url: 'https://marble.worldlabs.ai/world/w1', name: 'The Drained Sea at dawn', caption: 'A lighthouse on a cliff.',
    thumbnail: `${cdn}/thumbnail.webp`, pano: `${cdn}/rgb_0.png`, splats: spz, mesh: { collider_mesh_url: `${cdn}/m.glb`, hq_mesh_url: null, full_res_mesh_url: null }, scale: null, ground: null,
  });
  assert.deepEqual(P.mergeWorld({ name: 'op', pano: 'p', splats: { a: 1 } }, { name: '', pano: null, splats: {} }), { name: 'op', pano: 'p', splats: { a: 1 } }, 'an empty world keeps what the operation said');

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
