// Inkwash on Quest: a world's map rises from your table, and you open its places by touching
// them. Seated and hands-first: everything is within reach, a fingertip presses, and a pinch
// over the map turns it. Controllers point and click; on a computer, the mouse does.
//
// ?emulate installs IWER, Meta's WebXR emulator, so the whole thing runs on a computer as if on a
// Quest 3; the browser tests use it. Without it, the page is a desktop preview until a headset
// offers a session.
import * as THREE from 'three';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { makeWorld, buildDiorama, mapTextureSvg } from './diorama.js';
import { makeBoard } from './board.js';
import { makePage } from './page.js';
import { createPoker, turnAngle } from './poke.js';

const params = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const say = (t) => { $('#status').textContent = t; };
const api = (window.__inkvr = { ready: false, risen: false, mode: 'desktop', open: null, presses: 0, error: null });

const V = () => new THREE.Vector3();
const tmp = { a: V(), b: V(), c: V(), o: V(), d: V(), q: new THREE.Quaternion() };

// ---------------------------------------------------------------- the emulator, when asked for

async function installEmulator() {
  const { XRDevice, metaQuest3 } = await import('iwer');
  const device = new XRDevice(metaQuest3, { stereoEnabled: false });
  device.installRuntime({ forceInstall: true });
  device.position.set(0, 1.15, 0); // seated,
  device.quaternion.set(-0.276, 0, 0, 0.961); // looking down at the table
  device.primaryInputMode = 'hand';
  window.__xrDevice = device;
}

// ---------------------------------------------------------------- the room

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
$('#stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const NIGHT = new THREE.Color(0x1b1e25);
scene.background = NIGHT;
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 30);
camera.position.set(0, 0.64, 0.74);
camera.lookAt(0, 0.15, -0.08);
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5c5446, 1.25));
const sun = new THREE.DirectionalLight(0xfff1dc, 1.8);
sun.position.set(-0.7, 1.4, 0.5);
scene.add(sun);

// everything sits in one root, placed in front of the reader when a session starts
const root = new THREE.Group();
scene.add(root);
const table = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.03, 72), new THREE.MeshStandardMaterial({ color: 0x6b5843, roughness: 0.85 }));
table.position.y = -0.0264 - 0.015;
root.add(table);

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- a small sound for a touch

let audio = null;
function startAudio() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (e) { audio = null; }
}
function tap(gain = 1) {
  if (!audio) return;
  const len = Math.floor(audio.sampleRate * 0.05), buf = audio.createBuffer(1, len, audio.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 1.2; g.gain.value = 0.35 * gain;
  src.connect(f).connect(g).connect(audio.destination);
  src.start();
}

// ---------------------------------------------------------------- the ink map, as a texture

async function svgTexture(svg, width, mapW, mapH) {
  const height = Math.round((width * mapH) / mapW);
  const sized = svg.replace('<svg ', `<svg width="${width}" height="${height}" `);
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('the map could not be drawn')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  } finally { URL.revokeObjectURL(url); }
}

function raySphere(o, d, c, r) {
  const mx = o.x - c.x, my = o.y - c.y, mz = o.z - c.z;
  const b = mx * d.x + my * d.y + mz * d.z, cc = mx * mx + my * my + mz * mz - r * r;
  if (cc > 0 && b > 0) return null;
  const disc = b * b - cc;
  return disc < 0 ? null : Math.max(0, -b - Math.sqrt(disc));
}

// ---------------------------------------------------------------- the world

async function boot() {
  if (params.has('emulate')) await installEmulator();
  const C = window.InkCore, AT = window.InkAtlas;
  if (!C || !AT) throw new Error('Inkwash’s core did not load');
  const dream = await (await fetch('./worlds/drained-sea.json')).json();
  const w = makeWorld({ C, AT, dream, now: Date.now() });
  const dio = buildDiorama({ spec: w.spec, layout: w.layout, entities: w.entities, mapW: w.mapW, mapH: w.mapH });
  $('#title').textContent = w.world.title;
  say('Inking the map…');
  if (document.fonts && document.fonts.load) {
    await Promise.race([Promise.all(['600 64px Alegreya', '38px Alegreya', '600 32px "Alegreya Sans"'].map((f) => document.fonts.load(f))).catch(() => null), new Promise((ok) => setTimeout(ok, 2500))]);
  }
  const tex = await svgTexture(mapTextureSvg(AT.paint(w.spec, { id: 'vr' }), dio.markers), 2048, w.mapW, w.mapH);
  const board = makeBoard(dio, tex, { maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
  root.add(board.group);
  const page = makePage({ accent: dio.accent, worldTitle: w.world.title });
  // the page stands up behind the map, facing the reader, a little below eye level: easy to read,
  // and its close button within reach. Lines of sight to the map pass beneath it.
  page.group.position.set(dio.width * 0.1, 0.36, -dio.depth * 0.13);
  root.add(page.group);
  const leader = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V()]), new THREE.LineBasicMaterial({ color: dio.accent }));
  leader.visible = false;
  leader.frustumCulled = false;
  scene.add(leader);

  // ------------------------------------------------ opening and closing a page

  function faceViewer() {
    const head = renderer.xr.isPresenting ? renderer.xr.getCamera().getWorldPosition(tmp.a) : camera.getWorldPosition(tmp.a);
    page.group.lookAt(head);
  }
  function openMarker(id) {
    const k = board.marker(id);
    if (!k) return;
    page.show(k.m);
    board.setOpen(id);
    api.open = k.m.name;
    faceViewer();
    tap();
  }
  function closePage() {
    page.hide();
    board.setOpen(null);
    api.open = null;
    tap(0.6);
  }
  function press(id) {
    api.presses++;
    if (id === '#close') closePage();
    else openMarker(id);
  }
  function allTargets() {
    const t = board.targets();
    const c = page.closeTarget();
    if (c) t.push(c);
    return t;
  }
  function pickRay(o, d) {
    let best = null, bt = Infinity;
    for (const t of allTargets()) {
      const hit = raySphere(o, d, t.p, t.r);
      if (hit !== null && hit < bt) { bt = hit; best = t.id; }
    }
    return best;
  }

  // ------------------------------------------------ hands: a fingertip presses, a pinch turns

  const handFactory = new XRHandModelFactory();
  const hands = [0, 1].map((i) => {
    const hand = renderer.xr.getHand(i);
    scene.add(hand);
    const model = handFactory.createHandModel(hand, 'spheres');
    hand.add(model);
    const tipMark = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 12, 8), new THREE.MeshBasicMaterial({ color: dio.accent }));
    tipMark.visible = false;
    scene.add(tipMark);
    hand.addEventListener('connected', (e) => {
      hand.userData.handedness = e.data.handedness;
      hand.userData.isHand = !!e.data.hand;
      // the hand model is made when the hand connects: draw it soft, paper-coloured and half see-through
      const mesh = model.motionController && model.motionController.handMesh;
      if (mesh) { mesh.material.color.set(0xe9dfc8); mesh.material.transparent = true; mesh.material.opacity = 0.5; mesh.material.depthWrite = false; }
    });
    hand.addEventListener('disconnected', () => { hand.userData.isHand = false; });
    hand.addEventListener('pinchstart', () => startTurn(hand));
    hand.addEventListener('pinchend', () => { if (turning && turning.hand === hand) turning = null; });
    return { hand, model, tipMark };
  });
  function tips() {
    return hands.map(({ hand }, i) => {
      const j = hand.joints && hand.joints['index-finger-tip'];
      if (!renderer.xr.isPresenting || !hand.userData.isHand || !j || !j.visible) return { id: 'h' + i, p: null };
      return { id: 'h' + i, p: { x: j.position.x, y: j.position.y, z: j.position.z } };
    });
  }
  function pinchPoint(hand) {
    const a = hand.joints && hand.joints['index-finger-tip'], b = hand.joints && hand.joints['thumb-tip'];
    if (!a || !b) return null;
    return { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2, z: (a.position.z + b.position.z) / 2 };
  }
  let turning = null;
  function startTurn(hand) {
    if (turning || !board.risen) return;
    const p = pinchPoint(hand);
    if (!p) return;
    const local = board.group.worldToLocal(tmp.b.set(p.x, p.y, p.z));
    if (Math.abs(local.x) > dio.width / 2 + 0.06 || Math.abs(local.z) > dio.depth / 2 + 0.06 || local.y < -0.03 || local.y > 0.16) return;
    board.group.getWorldPosition(tmp.c);
    turning = { hand, center: { x: tmp.c.x, z: tmp.c.z }, from: { x: p.x, z: p.z }, yaw0: board.group.rotation.y };
  }
  function updateTurn() {
    if (!turning) return;
    const p = pinchPoint(turning.hand);
    if (p) board.group.rotation.y = turning.yaw0 - turnAngle(turning.center, turning.from, { x: p.x, z: p.z });
  }

  // ------------------------------------------------ controllers: point and pull the trigger

  for (const i of [0, 1]) {
    const ctrl = renderer.xr.getController(i);
    scene.add(ctrl);
    const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xf5efdf, transparent: true, opacity: 0.7 }));
    ray.scale.z = 1.5;
    ray.visible = false;
    ctrl.add(ray);
    ctrl.addEventListener('connected', (e) => { ctrl.userData.isHand = !!e.data.hand; ray.visible = !e.data.hand; });
    ctrl.addEventListener('disconnected', () => { ray.visible = false; });
    ctrl.addEventListener('selectstart', () => {
      if (ctrl.userData.isHand) return; // a hand's pinch turns the map; its fingertip presses
      ctrl.getWorldPosition(tmp.o);
      tmp.d.set(0, 0, -1).applyQuaternion(ctrl.getWorldQuaternion(tmp.q));
      const id = pickRay(tmp.o, tmp.d);
      if (id) press(id);
    });
  }

  // ------------------------------------------------ the mouse, in the desktop preview

  const mouseHover = new Set();
  let drag = null;
  const ray = new THREE.Raycaster();
  const pickAt = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera);
    return pickRay(ray.ray.origin, ray.ray.direction);
  };
  renderer.domElement.addEventListener('pointerdown', (e) => { startAudio(); drag = { x: e.clientX, yaw: board.group.rotation.y, moved: false }; });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (renderer.xr.isPresenting) return;
    if (drag) {
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 4) drag.moved = true;
      if (drag.moved) board.group.rotation.y = drag.yaw + dx * 0.008;
    }
    mouseHover.clear();
    const id = pickAt(e);
    if (id && id !== '#close') mouseHover.add(id);
    renderer.domElement.style.cursor = id ? 'pointer' : drag && drag.moved ? 'grabbing' : 'grab';
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (drag && !drag.moved && !renderer.xr.isPresenting) { const id = pickAt(e); if (id) press(id); }
    drag = null;
  });

  // ------------------------------------------------ entering and leaving the headset

  let placed = true;
  function placeFromViewer(frame) {
    const pose = frame.getViewerPose(renderer.xr.getReferenceSpace());
    if (!pose) return;
    const { position: p, orientation: o } = pose.transform;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(tmp.q.set(o.x, o.y, o.z, o.w));
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    // a table in front of the reader: 40 cm ahead, 43 cm below the eyes
    root.position.set(p.x + fwd.x * 0.4, Math.max(0.5, p.y - 0.43), p.z + fwd.z * 0.4);
    root.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
    placed = true;
  }
  async function enter(mode) {
    startAudio();
    const session = await navigator.xr.requestSession(mode === 'ar' ? 'immersive-ar' : 'immersive-vr', { optionalFeatures: ['local-floor', 'hand-tracking'] });
    api.mode = mode;
    const passthrough = mode === 'ar';
    scene.background = passthrough ? null : NIGHT;
    renderer.setClearColor(0x000000, passthrough ? 0 : 1);
    table.visible = !passthrough;
    for (const h of hands) h.model.visible = !passthrough;
    placed = false;
    board.restart();
    api.risen = false;
    if (page.shown) closePage();
    session.addEventListener('end', () => {
      api.mode = 'desktop';
      document.body.classList.remove('in-xr');
      root.position.set(0, 0, 0);
      root.rotation.set(0, 0, 0);
      scene.background = NIGHT;
      table.visible = true;
      renderer.setClearColor(0x000000, 1);
    });
    await renderer.xr.setSession(session);
    document.body.classList.add('in-xr');
  }
  $('#enter-ar').addEventListener('click', () => enter('ar').catch((e) => say(`The headset didn’t start (${e.message || e}).`)));
  $('#enter-vr').addEventListener('click', () => enter('vr').catch((e) => say(`The headset didn’t start (${e.message || e}).`)));

  // ------------------------------------------------ every frame

  const poke = createPoker();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop((time, frame) => {
    const dt = Math.min(0.05, clock.getDelta());
    if (frame && !placed) placeFromViewer(frame);
    board.advance(dt);
    api.risen = board.risen;
    const ts = tips();
    const r = poke(ts, allTargets());
    board.setHover(new Set([...r.hovered, ...mouseHover]));
    for (const p of r.presses) press(p.target);
    updateTurn();
    hands.forEach(({ tipMark }, i) => {
      const tp = ts[i].p;
      tipMark.visible = !!tp;
      if (tp) tipMark.position.set(tp.x, tp.y, tp.z);
    });
    if (page.shown) {
      const k = board.marker(page.shown.id);
      k.head.getWorldPosition(tmp.a);
      page.group.localToWorld(tmp.b.copy(page.anchor));
      const pos = leader.geometry.attributes.position;
      pos.setXYZ(0, tmp.a.x, tmp.a.y, tmp.a.z);
      pos.setXYZ(1, tmp.b.x, tmp.b.y, tmp.b.z);
      pos.needsUpdate = true;
      leader.visible = true;
    } else leader.visible = false;
    renderer.render(scene, camera);
  });

  // ------------------------------------------------ what the browser tests read

  const head = (k) => { k.head.getWorldPosition(tmp.c); return [tmp.c.x, tmp.c.y, tmp.c.z]; };
  Object.assign(api, {
    world: w.world.title,
    places: dio.markers.map((m) => m.name),
    marker: (name) => { const k = board.markers.find((x) => x.m.name === name); return k ? { id: k.m.id, p: head(k), r: k.hitR, hovered: k.head.material.emissiveIntensity > 0 } : null; },
    close: () => { const c = page.closeTarget(); return c ? [c.p.x, c.p.y, c.p.z] : null; },
    tips: () => tips().map((t) => (t.p ? [t.p.x, t.p.y, t.p.z] : null)),
    handedness: () => hands.map(({ hand }) => (hand.userData.isHand ? hand.userData.handedness : null)),
    pinch: (i) => pinchPoint(hands[i].hand),
    page: () => (page.shown ? { name: page.shown.name, facts: page.shown.facts.slice() } : null),
    yaw: () => board.group.rotation.y,
    turning: () => !!turning,
    rise: () => board.rise,
    board: () => { board.group.getWorldPosition(tmp.c); return [tmp.c.x, tmp.c.y, tmp.c.z]; },
    // where a place's pin stands on the screen, in the desktop preview
    project: (name) => {
      const k = board.markers.find((x) => x.m.name === name);
      if (!k) return null;
      k.head.getWorldPosition(tmp.c).project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return [r.left + ((tmp.c.x + 1) / 2) * r.width, r.top + ((1 - tmp.c.y) / 2) * r.height];
    },
    enter,
  });

  // the buttons the device offers
  let ar = false, vr = false;
  if (navigator.xr) [ar, vr] = await Promise.all(['immersive-ar', 'immersive-vr'].map((m) => navigator.xr.isSessionSupported(m).catch(() => false)));
  $('#enter-ar').hidden = !ar;
  $('#enter-vr').hidden = !vr;
  $('#note').textContent = ar || vr
    ? 'Sit at a table. The map appears in front of you, at table height.'
    : 'This is the desktop preview: drag to turn the map, click a place to open it. On a Quest, open this page in its browser to step in.';
  say('');
  api.ready = true;
}

boot().catch((e) => {
  api.error = String((e && e.message) || e);
  say(`Something went wrong: ${api.error}`);
});
