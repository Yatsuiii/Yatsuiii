// Dream Canvas in the browser: the paper you draw on, the panel that turns a sketch into a
// picture, a panorama, a moving shot and a world, and the gallery of every scene you've made.
// It talks only to the small server beside it, which holds the keys.

const $ = (sel) => document.querySelector(sel);
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
  return n;
}
// rebuild a part of the page only when what it shows has changed, so a running video keeps
// playing and a slider stays where you left it while the page checks on things
function swap(box, key, build) {
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren(...[].concat(build()).filter(Boolean));
}

// ---------------------------------------------------------------- the server

const TOKEN = new URLSearchParams(location.search).get('t') || '';
const media = (rel) => (rel ? '/' + rel + (TOKEN ? '?t=' + encodeURIComponent(TOKEN) : '') : '');
async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, { method, headers: Object.assign({ 'content-type': 'application/json' }, TOKEN ? { 'x-canvas-token': TOKEN } : {}), body: body ? JSON.stringify(body) : undefined });
  } catch (e) { throw new Error("The canvas server isn't answering. Is it still running?"); }
  const json = await res.json().catch(() => null);
  if (!res.ok) { const e = new Error((json && json.error) || `The server said ${res.status}.`); e.code = json && json.code; e.status = res.status; throw e; }
  return json;
}
const HINTS = {
  bad_key: 'The key was refused: check it in your environment, then restart the server.',
  no_credits: 'That account is out of credit.',
  rate_limited: 'Too many requests at once. Wait a minute, then try again.',
  no_image: 'Try other words, or a clearer sketch.',
  network: 'Check the internet connection of the computer running the canvas.',
};
function showError(e) {
  const box = $('#error');
  box.hidden = !e;
  box.textContent = e ? e.message + (HINTS[e.code] ? ' ' + HINTS[e.code] : '') : '';
}

// ---------------------------------------------------------------- the paper

const paper = $('#paper'), ctx = paper.getContext('2d');
const W = paper.width, H = paper.height, PAPER = '#ffffff';
const INKS = [['Ink', '#1d1d1f'], ['Sky', '#4a90d9'], ['Sea', '#1f7a8c'], ['Grass', '#3d8b3d'], ['Earth', '#8b5a2b'], ['Sand', '#d8b26e'], ['Fire', '#e8552b'], ['Stone', '#8a8f98'], ['Night', '#5b3f8c']];
const SCALE = { pen: 1, brush: 4, eraser: 4 };
// Every stroke is kept, so it can be undone and redrawn. `base` is the sketch a scene was painted
// from, when you reopen one; `version` changes with every mark, so a changed sketch is sent again.
const draw = { tool: 'pen', color: INKS[0][1], size: 6, strokes: [], undone: [], base: null, live: null, penSeen: false, version: 0 };

const widthAt = (s, p) => Math.max(1, s.size * SCALE[s.tool] * (s.pressure ? 0.25 + 1.5 * p : 1));
function ink(c, s) { c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = c.fillStyle = s.tool === 'eraser' ? PAPER : s.color; }
function dot(c, s) { const [x, y, p] = s.points[0]; ink(c, s); c.beginPath(); c.arc(x, y, widthAt(s, p) / 2, 0, Math.PI * 2); c.fill(); }
// a curve through the midpoints keeps quick strokes smooth; pen pressure sets the width
function segment(c, s, i) {
  const pts = s.points, [x0, y0, p0] = pts[i - 1], [x1, y1, p1] = pts[i], before = pts[i - 2];
  ink(c, s);
  c.lineWidth = widthAt(s, (p0 + p1) / 2);
  c.beginPath();
  c.moveTo(before ? (before[0] + x0) / 2 : x0, before ? (before[1] + y0) / 2 : y0);
  c.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  c.stroke();
}
function tail(c, s) {
  const pts = s.points;
  if (pts.length < 2) return;
  const [xa, ya] = pts[pts.length - 2], [xb, yb, pb] = pts[pts.length - 1];
  ink(c, s);
  c.lineWidth = widthAt(s, pb);
  c.beginPath(); c.moveTo((xa + xb) / 2, (ya + yb) / 2); c.lineTo(xb, yb); c.stroke();
}
function paintStroke(c, s) {
  if (s.tool === 'clear') { c.fillStyle = PAPER; c.fillRect(0, 0, W, H); return; }
  if (s.tool === 'fill') { fill(c, s.x, s.y, s.color); return; }
  dot(c, s);
  for (let i = 1; i < s.points.length; i++) segment(c, s, i);
  tail(c, s);
}
function repaint() {
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  if (draw.base) ctx.drawImage(draw.base, 0, 0, W, H);
  for (const s of draw.strokes) paintStroke(ctx, s);
}

// Fill the area around a point with a colour: everything near the colour that was tapped, up to the
// lines around it, and one pixel past, over their soft edges.
function fill(c, x0, y0, color) {
  const x = Math.floor(x0), y = Math.floor(y0);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const img = c.getImageData(0, 0, W, H), px = new Uint32Array(img.data.buffer);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const paint = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0, seed = px[y * W + x];
  if (seed === paint) return;
  const sr = seed & 255, sg = (seed >>> 8) & 255, sb = (seed >>> 16) & 255;
  const near = (v) => { const dr = (v & 255) - sr, dg = ((v >>> 8) & 255) - sg, db = ((v >>> 16) & 255) - sb; return dr * dr + dg * dg + db * db <= 4800; };
  const hit = new Uint8Array(W * H), stack = [x, y];
  while (stack.length) {
    const sy = stack.pop(), sx = stack.pop(), row = sy * W;
    if (hit[row + sx] || !near(px[row + sx])) continue;
    let l = sx, rr = sx;
    while (l > 0 && !hit[row + l - 1] && near(px[row + l - 1])) l--;
    while (rr < W - 1 && !hit[row + rr + 1] && near(px[row + rr + 1])) rr++;
    hit.fill(1, row + l, row + rr + 1);
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= H) continue;
      let open = false;
      for (let i = l; i <= rr; i++) {
        const ok = !hit[ny * W + i] && near(px[ny * W + i]);
        if (ok && !open) stack.push(i, ny);
        open = ok;
      }
    }
  }
  for (let yy = 0, i = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++, i++) {
      if (hit[i] || (xx > 0 && hit[i - 1]) || (xx < W - 1 && hit[i + 1]) || (yy > 0 && hit[i - W]) || (yy < H - 1 && hit[i + W])) px[i] = paint;
    }
  }
  c.putImageData(img, 0, 0);
}

function at(e) {
  const r = paper.getBoundingClientRect();
  return [Math.round((e.clientX - r.left) * (W / r.width) * 10) / 10, Math.round((e.clientY - r.top) * (H / r.height) * 10) / 10];
}
const pressureOf = (e) => (e.pointerType === 'pen' && e.pressure > 0 ? Math.round(e.pressure * 100) / 100 : 0.5);

paper.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'pen') draw.penSeen = true;
  else if (e.pointerType === 'touch' && draw.penSeen) return; // a palm resting while you draw with a pen
  if ((e.pointerType === 'mouse' && e.button !== 0) || draw.live) return;
  e.preventDefault();
  try { paper.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ }
  const [x, y] = at(e);
  if (draw.tool === 'fill') { fill(ctx, x, y, draw.color); commit({ tool: 'fill', x, y, color: draw.color }); return; }
  draw.live = { id: e.pointerId, tool: draw.tool, color: draw.color, size: draw.size, pressure: e.pointerType === 'pen', points: [[x, y, pressureOf(e)]] };
  dot(ctx, draw.live);
});
paper.addEventListener('pointermove', (e) => {
  const s = draw.live;
  if (!s || e.pointerId !== s.id) return;
  const all = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of all.length ? all : [e]) {
    const [x, y] = at(ev), last = s.points[s.points.length - 1];
    if (Math.abs(x - last[0]) + Math.abs(y - last[1]) < 1) continue;
    s.points.push([x, y, pressureOf(ev)]);
    segment(ctx, s, s.points.length - 1);
  }
});
function lift(e) {
  const s = draw.live;
  if (!s || e.pointerId !== s.id) return;
  draw.live = null;
  tail(ctx, s);
  delete s.id;
  commit(s);
}
paper.addEventListener('pointerup', lift);
paper.addEventListener('pointercancel', lift);

function commit(s) { draw.strokes.push(s); draw.undone = []; draw.version++; syncTools(); }
function undo() { if (!draw.strokes.length) return; draw.undone.push(draw.strokes.pop()); draw.version++; repaint(); syncTools(); }
function redo() { if (!draw.undone.length) return; draw.strokes.push(draw.undone.pop()); draw.version++; repaint(); syncTools(); }
function clearPaper() { if (!draw.strokes.length && !draw.base) return; commit({ tool: 'clear' }); paintStroke(ctx, { tool: 'clear' }); }
function hasInk() {
  const d = ctx.getImageData(0, 0, W, H).data;
  for (let i = 0; i < d.length; i += 16) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) return true;
  return false;
}
// marks made since the last painting, that would be lost by leaving
const unsaved = () => draw.version !== state.paintedVersion && draw.strokes.length > 0;
function loadImage(src) {
  return new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error("Couldn't load the sketch.")); im.src = src; });
}
async function useSketch(rel) {
  draw.base = rel ? await loadImage(media(rel)) : null;
  draw.strokes = []; draw.undone = []; draw.version++;
  state.paintedVersion = draw.version;
  repaint(); syncTools();
}

function setTool(tool) {
  draw.tool = tool;
  paper.style.cursor = tool === 'fill' ? 'cell' : 'crosshair';
  if (state.view !== 'sketch') show('sketch');
  syncTools();
}
function setSize(n) { draw.size = Math.max(2, Math.min(60, n)); $('#size').value = String(draw.size); }
function syncTools() {
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === draw.tool));
  for (const b of document.querySelectorAll('.swatch')) b.setAttribute('aria-checked', String(b.dataset.color === draw.color));
  $('#undo').disabled = !draw.strokes.length;
  $('#redo').disabled = !draw.undone.length;
}
for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
$('#swatches').append(...INKS.map(([name, color]) => el('button', {
  type: 'button', class: 'swatch', role: 'radio', 'aria-label': name, title: name, 'data-color': color, style: `background:${color}`,
  onclick: () => { draw.color = color; if (draw.tool === 'eraser') draw.tool = 'pen'; setTool(draw.tool); },
})));
$('#size').addEventListener('input', (e) => setSize(Number(e.target.value)));
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$('#clear').addEventListener('click', () => { if (state.view !== 'sketch') show('sketch'); clearPaper(); });

document.addEventListener('keydown', (e) => {
  if (!$('#walk').hidden) { if (e.key === 'Escape') closeWalk(); return; }
  const a = document.activeElement;
  const typing = a && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && a.type === 'text'));
  if (typing) return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) { e.preventDefault(); if (key === 'y' || e.shiftKey) redo(); else undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tool = { p: 'pen', b: 'brush', f: 'fill', e: 'eraser' }[key];
  if (tool) setTool(tool);
  else if (e.key === '[') setSize(draw.size - 2);
  else if (e.key === ']') setSize(draw.size + 2);
});

// ---------------------------------------------------------------- the scene

const state = { status: null, scene: null, view: 'sketch', style: 'real', busy: false, paintedVersion: 0, world: null, reveal: false, scenes: [] };
const take = (scene) => scene.takes[scene.take] || scene.takes[scene.takes.length - 1];
const running = (job) => !!job && job.status === 'running';

const STYLES = [['real', 'A photo'], ['film', 'A film still'], ['painted', 'A painting'], ['storybook', 'A storybook']];
function setStyle(style) {
  state.style = STYLES.some(([k]) => k === style) ? style : 'real';
  for (const b of document.querySelectorAll('#styles .chip')) b.setAttribute('aria-checked', String(b.dataset.style === state.style));
}
$('#styles').setAttribute('role', 'radiogroup');
$('#styles').append(...STYLES.map(([k, label]) => el('button', { type: 'button', class: 'chip', role: 'radio', 'data-style': k, onclick: () => setStyle(k) }, label)));
setStyle('real');

async function run(label, fn) {
  if (state.busy) return;
  state.busy = true;
  showError(null);
  $('#busy-text').textContent = label;
  $('#busy').hidden = false;
  syncPanel();
  try { await fn(); } catch (e) { showError(e); } finally { state.busy = false; $('#busy').hidden = true; syncPanel(); }
}
function setScene(scene, opts = {}) {
  const switched = (scene && scene.id) !== (state.scene && state.scene.id);
  state.scene = scene;
  if (opts.view) state.view = opts.view;
  if (opts.reveal) state.reveal = true;
  if (switched && scene) { $('#dream').value = scene.dream || ''; setStyle(scene.style); }
  render();
  schedulePoll();
}

async function make() {
  if (!hasInk()) return showError(new Error('Draw something first: a horizon and a few shapes are enough.'));
  const version = draw.version;
  await run('Painting your dream…', async () => {
    const scene = await api('POST', '/api/scenes', { sketch: paper.toDataURL('image/png'), dream: $('#dream').value, style: state.style, world: worldContext() || null });
    state.paintedVersion = version;
    setScene(scene, { view: 'real', reveal: true });
    loadGallery();
  });
}
async function again() {
  const version = draw.version, changed = version !== state.paintedVersion;
  if (changed && !hasInk()) return showError(new Error('The page is empty: draw something to paint.'));
  await run('Painting it again…', async () => {
    const body = { dream: $('#dream').value, style: state.style };
    const world = worldContext();
    if (world) body.world = world;
    if (changed) body.sketch = paper.toDataURL('image/png');
    const scene = await api('POST', `/api/scenes/${state.scene.id}/paint`, body);
    state.paintedVersion = version;
    setScene(scene, { view: 'real', reveal: true });
    loadGallery();
  });
}
async function widen() {
  await run('Looking all around…', async () => { setScene(await api('POST', `/api/scenes/${state.scene.id}/expand`, {}), { view: 'wide' }); loadGallery(); });
}
async function move() {
  await run('Sending it to Veo…', async () => {
    setScene(await api('POST', `/api/scenes/${state.scene.id}/move`, { motion: $('#motion').value, seconds: Number($('#seconds').value) }), { view: 'moving' });
  });
}
async function buildWorld() {
  const quality = $('#quality').value;
  if (quality === 'full' && !confirm('A full world costs about $1.20 of World Labs credit. Build it?')) return;
  await run('Sending the picture to World Labs…', async () => {
    setScene(await api('POST', `/api/scenes/${state.scene.id}/world`, { quality }), { view: 'world' });
  });
}
async function pickTake(i) {
  if (state.busy || !state.scene || i === state.scene.take) return;
  try {
    const scene = await api('POST', `/api/scenes/${state.scene.id}/take`, { index: i });
    if (!unsaved()) await useSketch(take(scene).sketch || scene.sketch);
    setScene(scene, { view: 'real' });
  } catch (e) { showError(e); }
}
async function openScene(id) {
  if (state.busy || (state.scene && state.scene.id === id)) return;
  if (unsaved() && !confirm('Leave this drawing? It hasn\'t been made real yet.')) return;
  try {
    const scene = await api('GET', `/api/scenes/${id}`);
    await useSketch(take(scene).sketch || scene.sketch);
    showError(null);
    setScene(scene, { view: 'real' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) { showError(e); }
}
async function startOver() {
  if (state.busy) return;
  if (unsaved() && !confirm('Start a new drawing? This one hasn\'t been made real yet.')) return;
  await useSketch(null);
  $('#dream').value = '';
  $('#motion').value = '';
  showError(null);
  setScene(null, { view: 'sketch' });
}
async function deleteScene() {
  const scene = state.scene;
  if (!scene || state.busy || !confirm('Delete this scene, with its pictures, video and world files? This can\'t be undone.')) return;
  try {
    await api('DELETE', `/api/scenes/${scene.id}`);
    state.paintedVersion = draw.version; // nothing left to lose
    await startOver();
    loadGallery();
  } catch (e) { showError(e); }
}
$('#make').addEventListener('click', make);
$('#again').addEventListener('click', again);
$('#widen').addEventListener('click', widen);
$('#move').addEventListener('click', move);
$('#world').addEventListener('click', buildWorld);
$('#delete').addEventListener('click', deleteScene);
$('#new').addEventListener('click', startOver);
$('#seconds').addEventListener('change', syncCosts);

// While a video or a world is being made, look in on it: soon at first, then every few seconds.
let pollTimer = 0, pollTries = 0;
function schedulePoll() {
  clearTimeout(pollTimer);
  const scene = state.scene;
  if (!scene || !scene.takes.some((t) => running(t.video) || running(t.world3d))) { pollTries = 0; return; }
  pollTimer = setTimeout(async () => {
    pollTries++;
    try {
      const fresh = await api('POST', `/api/scenes/${scene.id}/refresh`, {});
      if (!state.scene || state.scene.id !== scene.id) return;
      const was = scene.takes.filter((t) => running(t.video) || running(t.world3d)).length;
      setScene(fresh);
      if (fresh.takes.filter((t) => running(t.video) || running(t.world3d)).length !== was) loadGallery();
    } catch (e) {
      if (state.scene && state.scene.id === scene.id) schedulePoll();
    }
  }, Math.min(5000, 1000 + 1000 * pollTries));
}

// ---------------------------------------------------------------- an Inkwash world

// A backup from Inkwash, read here in the browser. Only what the picture needs goes to the server:
// the world's title and premise, the place being drawn and its facts, and the world's rules.
// Secret and retired facts stay behind.
function readWorld(data) {
  if (!data || data.format !== 'inkwash-backup/1' || !data.world || typeof data.world !== 'object') throw new Error('That file is not an Inkwash backup. In Inkwash, use "Back up this world" in the Book view.');
  const entities = Array.isArray(data.entities) ? data.entities.filter((e) => e && typeof e === 'object') : [];
  const live = (e) => (Array.isArray(e.facts) ? e.facts : []).filter((f) => f && f.text && !f.retired && !f.secret).map((f) => String(f.text));
  const places = entities.filter((e) => e.kind === 'place').map((e) => ({ id: String(e.id), name: String(e.name || 'A place'), facts: live(e) }));
  const rules = entities.filter((e) => e.kind === 'rule').flatMap((e) => { const f = live(e); return f.length ? f.map((x) => `${e.name}: ${x}`) : [String(e.name || '')]; }).filter(Boolean);
  return { title: String(data.world.title || 'An untitled world'), premise: String(data.world.premise || ''), places, rules };
}
function worldContext() {
  const w = state.world;
  if (!w) return undefined;
  const p = w.places.find((x) => x.id === $('#place').value);
  return { title: w.title, premise: w.premise, place: p ? { name: p.name, facts: p.facts.slice(0, 12) } : null, rules: w.rules.slice(0, 8) };
}
$('#world-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    state.world = readWorld(JSON.parse(await file.text()));
    const sel = $('#place');
    sel.replaceChildren(el('option', { value: '' }, `Somewhere in ${state.world.title}`), ...state.world.places.map((p) => el('option', { value: p.id }, p.name)));
    showError(null);
  } catch (err) {
    showError(new Error(err instanceof SyntaxError ? 'That file is not JSON.' : err.message));
  }
  syncWorld();
});
function syncWorld() {
  const w = state.world, sw = state.scene && state.scene.world, note = $('#world-note');
  $('#place').hidden = !w;
  $('.file').firstChild.textContent = w ? 'Load another world' : 'Load a world backup';
  if (w) note.textContent = `Pictures keep to the canon of ${w.title}${w.places.length ? ': pick the place you are drawing' : ''}. Its facts about that place and its rules go to Google with each picture.`;
  else if (sw && sw.title) note.textContent = `This scene keeps to the canon of ${sw.title}${sw.place && sw.place.name ? `, at ${sw.place.name}` : ''}.`;
  else note.textContent = 'Its canon keeps the pictures true to your world: what you\'ve written about a place is never contradicted. In Inkwash, make one with "Back up this world" in the Book view.';
}

// ---------------------------------------------------------------- showing it

const VIEWS = [['sketch', 'Sketch'], ['real', 'Real'], ['wide', 'All around'], ['moving', 'Moving'], ['world', 'World']];
function show(view) { state.view = view; render(); }
function render() { renderViews(); renderResult(); renderTakes(); syncPanel(); syncWorld(); renderGallery(); }

function renderViews() {
  const t = state.scene && take(state.scene);
  const has = { sketch: true, real: !!t, wide: !!(t && t.wide), moving: !!(t && t.video), world: !!(t && t.world3d) };
  if (!has[state.view]) state.view = t ? 'real' : 'sketch';
  const dots = { moving: running(t && t.video) ? ' …' : '', world: running(t && t.world3d) ? ' …' : '' };
  swap($('#views'), JSON.stringify([state.view, has, dots]), () => VIEWS.map(([k, label]) =>
    el('button', { type: 'button', 'data-view': k, 'aria-current': String(state.view === k), disabled: !has[k], onclick: () => show(k) }, label + (dots[k] || ''))));
}
const jobKey = (j) => (j ? [j.status, j.file || '', j.progress == null ? '' : Math.round(j.progress), j.error || '', j.checkError || '', j.world ? j.world.id : ''].join('|') : '');
function renderResult() {
  const box = $('#result'), scene = state.scene, t = scene && take(scene);
  if (state.view === 'sketch' || !t) { box.hidden = true; swap(box, '', () => []); return; }
  box.hidden = false;
  if (state.view === 'real') swap(box, 'real:' + t.image, () => compare(media(t.sketch || scene.sketch), media(t.image), state.reveal));
  else if (state.view === 'wide') swap(box, 'wide:' + t.wide, () => wideView(media(t.wide)));
  else if (state.view === 'moving') swap(box, 'moving:' + jobKey(t.video), () => movingView(t.video));
  else if (state.view === 'world') swap(box, 'world:' + jobKey(t.world3d), () => worldView(t.world3d, t));
  state.reveal = false;
}

// the sketch over the picture, with a line between them you can slide; a new painting is revealed
// by sweeping the sketch away
function compare(before, after, reveal) {
  const box = el('div', { class: 'compare' });
  const real = el('img', { src: after, alt: 'Your dream, made real', draggable: 'false' });
  const sketch = el('img', { class: 'over', src: before, alt: 'Your sketch', draggable: 'false' });
  const range = el('input', { type: 'range', min: '0', max: '100', step: '0.5', value: '50', 'aria-label': 'Slide between your sketch and the real picture' });
  let raf = 0;
  const set = (v) => { box.style.setProperty('--cut', v + '%'); range.value = String(v); };
  range.addEventListener('input', () => { cancelAnimationFrame(raf); box.style.setProperty('--cut', range.value + '%'); });
  box.append(real, sketch, el('div', { class: 'handle' }), el('span', { class: 'label l', text: 'Sketch' }), el('span', { class: 'label r', text: 'Real' }), range);
  if (!reveal) { set(50); return box; }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { set(0); return box; }
  set(100);
  Promise.all([real.decode(), sketch.decode()]).catch(() => {}).then(() => {
    const t0 = performance.now() + 200, dur = 1700;
    const step = (now) => {
      const k = Math.min(1, Math.max(0, (now - t0) / dur)), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      set(Math.round(1000 * (1 - e)) / 10);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  });
  return box;
}
function wideView(src) {
  const img = el('img', { src, alt: 'The same place, all around', draggable: 'false' });
  const box = el('div', { class: 'wide-scroll' }, img);
  img.addEventListener('load', () => { box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2; });
  let drag = null; // a mouse drags the view; fingers and trackpads scroll it already
  box.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') return; drag = { x: e.clientX, left: box.scrollLeft }; box.setPointerCapture(e.pointerId); });
  box.addEventListener('pointermove', (e) => { if (drag) box.scrollLeft = drag.left - (e.clientX - drag.x); });
  box.addEventListener('pointerup', () => { drag = null; });
  return box;
}
function waiting(lines, job) {
  return el('div', { class: 'pending' }, el('span', { class: 'dot' }), lines.map((t) => el('p', { text: t })),
    job.progress != null ? el('p', { class: 'hint', text: `${Math.round(job.progress)}%` }) : null,
    job.checkError ? el('p', { class: 'hint', text: `The last look failed (${job.checkError}); trying again.` }) : null);
}
function movingView(job) {
  if (job.status === 'done') {
    const v = el('video', { src: media(job.file), autoplay: true, loop: true, muted: true, playsinline: true, controls: true });
    v.muted = true;
    return v;
  }
  if (job.status === 'failed') return el('div', { class: 'pending' }, el('p', { text: `The video didn't come out: ${job.error}` }), el('button', { type: 'button', class: 'btn', onclick: move }, 'Try again'));
  return waiting(['Setting it moving…', 'A video takes a minute or two. You can keep drawing.'], job);
}
const safeLink = (u) => (/^https:\/\//.test(String(u || '')) ? u : null);
function worldView(job, t) {
  if (job.status === 'done') {
    const w = job.world || {};
    const img = el('img', { src: safeLink(w.thumbnail) || safeLink(w.pano) || media(job.from || t.image), alt: w.caption || 'Your world' });
    img.addEventListener('error', () => { if (img.src !== location.origin + media(t.image)) img.src = media(t.image); }, { once: true });
    return el('div', { class: 'world-card' }, img, w.caption ? el('p', { class: 'hint', text: w.caption }) : null,
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn primary big', id: 'walk-in', onclick: walkIn }, 'Walk inside'),
        safeLink(w.url) ? el('a', { class: 'btn ghost', href: w.url, target: '_blank', rel: 'noopener' }, 'Open in Marble') : null));
  }
  if (job.status === 'failed') return el('div', { class: 'pending' }, el('p', { text: `The world didn't come out: ${job.error}` }), el('button', { type: 'button', class: 'btn', onclick: buildWorld }, 'Try again'));
  return waiting(['Building your world…', 'This takes a few minutes. You can keep drawing.'], job);
}
function renderTakes() {
  const box = $('#takes'), scene = state.scene;
  box.hidden = !scene || scene.takes.length < 2;
  if (box.hidden) return;
  swap(box, JSON.stringify([scene.id, scene.take, scene.takes.map((t) => t.image)]), () => [
    el('span', { class: 'hint', text: 'Paintings' }),
    ...scene.takes.map((t, i) => el('button', { type: 'button', class: 'take', 'aria-current': String(i === scene.take), 'aria-label': `Painting ${i + 1}`, title: `Painting ${i + 1}`, onclick: () => pickTake(i) },
      el('img', { src: media(t.image), alt: '' }))),
  ]);
}

const cents = (n) => (n < 1 ? `${Math.round(n * 100)}¢` : `$${n.toFixed(2)}`);
function syncCosts() {
  const s = state.status, m = (s && s.models) || {};
  if (s && s.fake) {
    $('#make-cost').textContent = 'Stand-in mode: your sketch comes back as the picture, and nothing is charged.';
    $('#widen-cost').textContent = 'The same place, widened into a panorama.';
    $('#move-cost').textContent = 'Video with Veo.';
    return;
  }
  const pic = /pro/.test(m.image || '') ? 0.13 : 0.05;
  const perSecond = /lite/.test(m.video || '') ? 0.05 : /fast/.test(m.video || '') ? 0.1 : 0.4, secs = Number($('#seconds').value) || 6;
  $('#make-cost').textContent = `About ${cents(pic)} a picture, on your Google key.`;
  $('#widen-cost').textContent = `The same place, widened into a panorama. About ${cents(pic)}.`;
  $('#move-cost').textContent = `Video with Veo: about ${cents(perSecond * secs)} for ${secs} seconds.`;
}
function syncPanel() {
  const s = state.status, scene = state.scene, t = scene && take(scene), busy = state.busy;
  const canPaint = !!(s && s.paint), canWorld = !!(s && s.world);
  $('#make').hidden = !!scene;
  $('#make').disabled = busy || !canPaint;
  $('#next').hidden = !scene;
  for (const id of ['again', 'widen']) $('#' + id).disabled = busy || !canPaint;
  $('#move').disabled = busy || !canPaint || running(t && t.video);
  $('#world').disabled = busy || !canWorld || running(t && t.world3d);
  $('#world').title = canWorld ? '' : 'Start the server with WORLDLABS_API_KEY to build worlds.';
  $('#delete').disabled = busy;
  syncCosts();
}
function renderStatus() {
  const s = state.status, box = $('#status');
  if (!s) return box.replaceChildren(el('span', { class: 'pill off', text: 'The server isn\'t answering' }));
  if (s.fake) return box.replaceChildren(el('span', { class: 'pill', text: 'Stand-in mode: no keys, nothing charged' }));
  const m = s.models || {};
  box.replaceChildren(
    el('span', { class: 'pill ' + (s.paint && !m.error ? 'on' : 'off'), title: m.error || (m.image ? `Pictures: ${m.image}. Video: ${m.video}.` : '') },
      !s.paint ? 'Pictures: off (no GEMINI_API_KEY)' : m.code === 'bad_key' ? 'Google key refused' : 'Pictures and video: Gemini'),
    el('span', { class: 'pill ' + (s.world ? 'on' : 'off') }, s.world ? 'Worlds: World Labs' : 'Worlds: off (no WORLDLABS_API_KEY)'),
  );
}
async function loadStatus() {
  try { state.status = await api('GET', '/api/status'); } catch (e) { state.status = null; showError(e); }
  renderStatus();
  syncPanel();
}

// ---------------------------------------------------------------- the gallery

async function loadGallery() {
  try { state.scenes = await api('GET', '/api/scenes'); } catch (e) { return; }
  renderGallery();
}
function renderGallery() {
  const box = $('#gallery'), open = state.scene && state.scene.id;
  if (!state.scenes.length) return swap(box, 'empty', () => el('p', { class: 'hint', text: 'Nothing yet. Draw a place from a dream, then make it real.' }));
  swap(box, JSON.stringify([open, state.scenes.map((s) => [s.id, s.updatedAt])]), () => state.scenes.map((s) => {
    const t = take(s);
    const tags = [s.takes.length > 1 && `${s.takes.length} paintings`, t.wide && 'all around', t.video && t.video.status === 'done' && 'moving', t.world3d && t.world3d.status === 'done' && 'world'].filter(Boolean);
    return el('button', { type: 'button', class: 'card', 'data-id': s.id, 'aria-current': String(open === s.id), onclick: () => openScene(s.id) },
      el('img', { src: media(t.image || s.sketch), alt: '', loading: 'lazy' }),
      el('span', { text: s.dream || 'An unnamed dream' }),
      tags.length ? el('div', { class: 'tags' }, tags.map((x) => el('span', { text: x }))) : null);
  }));
}

// ---------------------------------------------------------------- walking inside

// The world's splat file is brought home by the server (once), then drawn here by three.js and
// Spark, which load only now. Phones and tablets get the lighter file.
let walker = null, walkSession = 0;
async function walkIn() {
  const scene = state.scene, t = scene && take(scene), w = t && t.world3d && t.world3d.world;
  if (!w) return;
  const session = ++walkSession, box = $('#walk'), view = $('#walk-view'), marble = $('#walk-marble');
  const say = (text) => { const p = view.querySelector('.pending p'); if (p) p.textContent = text; };
  $('#walk-title').textContent = w.name || scene.dream || 'Your world';
  marble.hidden = !safeLink(w.url);
  if (safeLink(w.url)) marble.href = w.url;
  view.replaceChildren(el('div', { class: 'pending' }, el('span', { class: 'dot' }), el('p', { text: 'Bringing the world home…' })));
  box.hidden = false;
  $('#walk-close').focus();
  try {
    const small = matchMedia('(pointer: coarse)').matches || innerWidth < 900;
    const got = await api('POST', `/api/scenes/${scene.id}/splat`, { budget: small ? 150000 : 600000 });
    if (session !== walkSession) return;
    say('Opening the world…');
    const { walk } = await import('./walk.js');
    if (session !== walkSession) return;
    const opened = await walk(view, {
      url: media(got.file), scale: got.scale,
      onProgress: (e) => { if (e && e.total) say(`Opening the world… ${Math.round((100 * e.loaded) / e.total)}%`); },
    });
    if (session !== walkSession) { opened.close(); return; }
    walker = opened;
    const pending = view.querySelector('.pending');
    if (pending) pending.remove();
  } catch (e) {
    if (session === walkSession) { const p = view.querySelector('.pending'); if (p) p.replaceChildren(el('p', { text: `Couldn't open the world: ${e.message}` })); }
  }
}
function closeWalk() {
  walkSession++;
  $('#walk').hidden = true;
  if (walker) { walker.close(); walker = null; }
  $('#walk-view').replaceChildren();
}
$('#walk-close').addEventListener('click', closeWalk);

// ---------------------------------------------------------------- start

addEventListener('beforeunload', (e) => { if (unsaved()) { e.preventDefault(); e.returnValue = ''; } });
repaint();
syncTools();
render();
loadStatus();
loadGallery();
