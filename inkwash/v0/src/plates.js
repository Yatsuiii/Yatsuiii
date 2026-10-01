/* Inkwash plates: ink-wash paintings for scenes, places and characters. Claude composes a plate as
 * a small spec (what is in the picture and roughly where); this module cleans the spec and paints
 * it as an SVG with Inkwash's own brushes. No DOM and no platform calls, so the page, the exports
 * and the Node tests share exactly this code. Loaded in the page as window.InkPlates. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InkPlates = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const W = 1000, H = 600;
  const PAPER = '#f1ebdd', CLEAN = '#f8f5ee', INK = '#1c2230';
  const TIMES = ['dawn', 'day', 'dusk', 'night', 'storm'];
  const WEATHER = ['clear', 'mist', 'rain', 'snow'];
  const DEPTHS = ['far', 'mid', 'near'];
  const SIZES = { small: 0.62, medium: 1, large: 1.5 };
  const THINGS = ['houses', 'house', 'tower', 'belltower', 'spire', 'castle', 'wall', 'gate', 'bridge', 'viaduct', 'station',
    'cabin', 'platform', 'rails', 'train', 'wagon', 'crowd', 'lamp', 'trees', 'pines', 'ship', 'ruin', 'stair', 'clock', 'rocks'];
  const POSES = ['standing', 'walking', 'reaching', 'sitting'];
  const CARRY = ['none', 'lamp', 'child', 'staff', 'ladder', 'bag'];
  const GROUNDS = ['none', 'hill', 'flat', 'platform', 'shore'];
  const VOIDS = ['rect', 'band', 'wedge', 'circle'];
  const HEADS = ['bare', 'hood', 'cap', 'brimmed', 'tall'];
  const HAIR = ['short', 'long', 'bun', 'none'];
  const HOLDS = ['none', 'lamp', 'staff', 'book'];
  const SLOTS = { left: 0.14, 'center-left': 0.32, center: 0.5, 'center-right': 0.68, right: 0.86 };
  // Where each depth stands: the line things rest on, how large they are, how dark the ink is.
  const PLANE = { far: { base: 0.6, scale: 0.4, ink: 0.24 }, mid: { base: 0.77, scale: 0.66, ink: 0.52 }, near: { base: 0.97, scale: 1.05, ink: 0.86 } };

  // ---------------------------------------------------------------- cleaning a spec

  const num = (v, a, b, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
  const pick = (v, list, d) => { const s = String(v == null ? '' : v).toLowerCase().trim(); return list.includes(s) ? s : d; };
  const hex = (v, d) => { const s = String(v == null ? '' : v).trim().toLowerCase(); return /^#[0-9a-f]{6}$/.test(s) ? s : d; };
  const text = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const yes = (v) => v === true || v === 'true' || v === 1;
  const xpos = (v, d) => (typeof v === 'string' && SLOTS[v.toLowerCase().trim()] != null ? SLOTS[v.toLowerCase().trim()] : num(v, 0, 1, d));
  const list = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);

  function cleanScenery(s) {
    s = s || {};
    const sky = s.sky || {};
    const moon = sky.moon ? { x: xpos(sky.moon.x, 0.75), y: num(sky.moon.y, 0.05, 0.5, 0.18), size: num(sky.moon.size, 0.4, 2.2, 1), phase: pick(sky.moon.phase, ['full', 'crescent'], 'full') } : null;
    const sun = sky.sun ? { x: xpos(sky.sun.x, 0.3), y: num(sky.sun.y, 0.05, 0.6, 0.35), size: num(sky.sun.size, 0.4, 2.2, 1) } : null;
    return {
      time: pick(s.time, TIMES, 'day'),
      weather: pick(s.weather, WEATHER, 'clear'),
      sky: { moon, sun, stars: yes(sky.stars), clouds: num(sky.clouds, 0, 1, 0.3) },
      ranges: list(s.ranges, 6).map((r) => ({
        depth: pick(r && r.depth, DEPTHS, 'far'), from: num(r && r.from, 0, 1, 0), to: num(r && r.to, 0, 1, 1),
        height: num(r && r.height, 0.05, 1, 0.5), rough: num(r && r.rough, 0, 1, 0.5), peaks: Math.round(num(r && r.peaks, 1, 6, 3)), wooded: yes(r && r.wooded),
      })).filter((r) => r.to - r.from >= 0.05),
      water: s.water ? { level: num(s.water.level, 0.45, 0.9, 0.7), kind: pick(s.water.kind, ['sea', 'lake', 'river'], 'lake') } : null,
      ground: pick(s.ground, GROUNDS, 'none'),
      things: list(s.things, 24).map((t) => ({
        kind: pick(t && t.kind, THINGS, null), x: xpos(t && t.x, 0.5), depth: pick(t && t.depth, DEPTHS, 'mid'),
        size: pick(t && t.size, Object.keys(SIZES), 'medium'), count: Math.round(num(t && t.count, 1, 14, 1)), lit: yes(t && t.lit),
      })).filter((t) => t.kind),
    };
  }

  // Make a spec safe and complete: unknown kinds are dropped, numbers clamped, colors checked.
  // Nothing from the model reaches the SVG except through these fields.
  function normalizePlate(raw, seed) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const mode = pick(raw.mode, ['landscape', 'portrait'], 'landscape');
    const out = Object.assign({ v: 1, mode, seed: Math.floor(num(raw.seed, 0, 2147483647, seed || 1)), title: text(raw.title, 80), alt: text(raw.alt, 300), accent: hex(raw.accent, '#b5793a') }, cleanScenery(raw));
    out.figures = list(raw.figures, 12).map((f) => ({
      x: xpos(f && f.x, 0.5), depth: pick(f && f.depth, DEPTHS, 'near'), pose: pick(f && f.pose, POSES, 'standing'),
      facing: pick(f && f.facing, ['left', 'right'], 'right'), carry: pick(f && f.carry, CARRY, 'none'), cloak: yes(f && f.cloak),
    }));
    out.voids = list(raw.voids, 6).map((v) => ({
      shape: pick(v && v.shape, VOIDS, 'rect'), depth: pick(v && v.depth, DEPTHS, 'near'), x: num(v && v.x, 0, 1, 0.4), y: num(v && v.y, 0, 1, 0.5),
      w: num(v && v.w, 0.01, 1, 0.2), h: num(v && v.h, 0.01, 1, 0.2), angle: num(v && v.angle, -45, 45, 0),
    }));
    if (mode === 'portrait') {
      const s = raw.sitter || {};
      out.sitter = {
        facing: pick(s.facing, ['left', 'right'], 'right'), head: pick(s.head, HEADS, 'bare'), hair: pick(s.hair, HAIR, 'short'),
        beard: yes(s.beard), collar: yes(s.collar), cloak: yes(s.cloak), holds: pick(s.holds, HOLDS, 'none'),
        age: pick(s.age, ['young', 'adult', 'old'], 'adult'), build: pick(s.build, ['slight', 'medium', 'broad'], 'medium'),
      };
    }
    return out;
  }

  // ---------------------------------------------------------------- brushes

  // A small, fast, seeded random source, so the same spec paints the same picture every time.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function noise1(r) {
    const pts = Array.from({ length: 64 }, r);
    return (x) => { const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f); return pts[i & 63] * (1 - s) + pts[(i + 1) & 63] * s; };
  }
  const f1 = (n) => Math.round(n * 10) / 10;
  const pt = (p) => f1(p[0]) + ' ' + f1(p[1]);
  const poly = (ps) => 'M' + ps.map(pt).join('L') + 'Z';
  const line = (ps) => 'M' + ps.map(pt).join('L');
  const rect = (x, y, w, h) => `M${f1(x)} ${f1(y)}h${f1(w)}v${f1(h)}h${f1(-w)}Z`;
  // Shapes wind clockwise and fill with the nonzero rule, so overlapping parts stay solid.
  const circle = (cx, cy, r) => `M${f1(cx - r)} ${f1(cy)}a${f1(r)} ${f1(r)} 0 1 1 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 1 ${f1(-2 * r)} 0Z`;
  // An arched opening winds the other way, so it cuts a hole through the shape it sits in.
  const arch = (cx, base, w, h) => { const r = w / 2; return `M${f1(cx + r)} ${f1(base)}V${f1(base - h + r)}A${f1(r)} ${f1(r)} 0 0 0 ${f1(cx - r)} ${f1(base - h + r)}V${f1(base)}Z`; };
  // Air in front of the land, which a void leaves alone (see cut() in paint).
  const atmos = (svg) => ({ atmos: svg });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // A mountain ridge across [x0, x1]: a few broad peaks with fractal roughness on top. Ends that
  // stop inside the frame come down to the base; ends at the frame's edge run on out of it.
  function ridge(r, x0, x1, base, top, peaks, rough) {
    const n1 = noise1(r), n2 = noise1(r), n3 = noise1(r);
    const span = x1 - x0;
    const bumps = Array.from({ length: peaks }, (_, i) => ({
      c: x0 + span * ((i + 0.5) / peaks + ((r() - 0.5) * 0.6) / peaks),
      w: (span * (0.16 + r() * 0.2)) / Math.sqrt(peaks), h: 0.5 + r() * 0.5,
    }));
    const N = Math.max(30, Math.round(span / 6));
    const P = [];
    for (let i = 0; i <= N; i++) {
      const x = x0 + span * (i / N);
      let h = 0.06;
      for (const b of bumps) h = Math.max(h, b.h * Math.exp(-((x - b.c) ** 2) / (2 * b.w * b.w)));
      h += rough * (0.17 * (n1(x / 60) - 0.5) + 0.07 * (n2(x / 16) - 0.5) + 0.018 * (n3(x / 5) - 0.5));
      const edge = Math.max(18, span * 0.1);
      let t = 1;
      if (x0 > 2) t = Math.min(t, (x - x0) / edge);
      if (x1 < W - 2) t = Math.min(t, (x1 - x) / edge);
      h = Math.max(0, h) * Math.max(0, Math.min(1, t)) ** 0.7;
      P.push([x, base - (base - top) * h]);
    }
    return P;
  }

  // ---------------------------------------------------------------- things
  // Each painter draws in its own units: base centre at (0, 0), up is negative y, about 100 units
  // tall for a medium thing on the near plane. It returns ink paths, lit windows and glows.

  const T = {};
  T.house = (r) => {
    const w = 46 + r() * 18, h = 28 + r() * 16, rh = 15 + r() * 12;
    let d = rect(-w / 2, -h, w, h) + poly([[-w / 2 - 4, -h], [r() * 6 - 3, -h - rh], [w / 2 + 4, -h]]);
    if (r() < 0.5) d += rect(w * 0.16, -h - rh * 0.85, 6, rh * 0.6);
    return { d, lit: [[-w * 0.24, -h * 0.68, 8, 9], [w * 0.12, -h * 0.68, 8, 9]].slice(0, 1 + (r() < 0.5 ? 1 : 0)) };
  };
  T.houses = (r, o) => {
    const n = Math.max(3, o.count > 1 ? o.count : 6), out = { d: '', lit: [] };
    const spread = n * 34;
    for (let i = 0; i < n; i++) {
      // stepped a little up and down the slope, each house standing on the base line
      const x = -spread / 2 + (spread * (i + 0.5)) / n + (r() - 0.5) * 16, lift = -r() * 14, s = 0.7 + r() * 0.5;
      const w = (46 + r() * 18) * s, h = (28 + r() * 16) * s, rh = (15 + r() * 12) * s;
      out.d += rect(x - w / 2, lift - h, w, h - lift) + poly([[x - w / 2 - 4 * s, lift - h], [x + (r() * 6 - 3) * s, lift - h - rh], [x + w / 2 + 4 * s, lift - h]]);
      if (r() < 0.4) out.d += rect(x + w * 0.16, lift - h - rh * 0.85, 6 * s, rh * 0.6);
      if (r() < 0.6) out.lit.push([x - w * 0.24, lift - h * 0.68, 8 * s, 9 * s]);
    }
    return out;
  };
  T.tower = (r) => {
    const w = 24 + r() * 8, h = 100 + r() * 30, rh = 30 + r() * 12;
    return { d: rect(-w / 2, -h, w, h) + poly([[-w / 2 - 5, -h], [0, -h - rh], [w / 2 + 5, -h]]), lit: [[-3, -h * 0.82, 6, 10]] };
  };
  T.belltower = (r) => {
    const w = 30, h = 112 + r() * 20, rh = 26;
    const d = rect(-w / 2, -h, w, h) + arch(0, -h + 34, 16, 26) + poly([[-w / 2 - 6, -h], [0, -h - rh], [w / 2 + 6, -h]])
      + rect(-w / 2 - 3, -h + 36, w + 6, 4);
    return { d, bell: [0, -h + 20], lit: [] };
  };
  T.spire = (r) => { const h = 150 + r() * 40; return { d: rect(-12, -40, 24, 40) + poly([[-12, -40], [0, -40 - h], [12, -40]]), lit: [] }; };
  T.castle = (r) => {
    let d = rect(-110, -58, 220, 58);
    for (let x = -110; x < 106; x += 14) d += rect(x, -66, 8, 8);
    for (const cx of [-110, 50, 110]) {
      const th = cx === 50 ? 128 : 92 + r() * 10;
      d += rect(cx - 17, -th, 34, th) + poly([[cx - 21, -th], [cx, -th - 38], [cx + 21, -th]]);
    }
    d += arch(-34, 0, 26, 40);
    return { d, lit: [[-76, -40, 6, 9], [46, -96, 7, 10]] };
  };
  T.wall = () => { let d = rect(-130, -32, 260, 32); for (let x = -130; x < 126; x += 15) d += rect(x, -40, 9, 8); return { d, lit: [] }; };
  T.gate = () => ({ d: rect(-46, -86, 92, 86) + arch(0, 0, 40, 62) + rect(-62, -104, 22, 104) + rect(40, -104, 22, 104), lit: [] });
  T.bridge = (r, o) => {
    const n = Math.max(1, Math.min(5, o.count > 1 ? o.count : 3)), L = 90 * n + 40;
    let d = rect(-L / 2, -46, L, 46);
    for (let i = 0; i < n; i++) d += arch(-L / 2 + 20 + (L - 40) * ((i + 0.5) / n), 0, (L - 40) / n - 14, 34);
    d += rect(-L / 2, -52, L, 3);
    return { d, lit: [] };
  };
  T.viaduct = (r, o) => {
    const n = Math.max(3, Math.min(15, o.count > 1 ? o.count : 7)), span = 52, L = span * n, h = 120;
    let d = rect(-L / 2, -h, L, h);
    for (let i = 0; i < n; i++) d += arch(-L / 2 + span * (i + 0.5), 0, span - 12, h - 22);
    d += rect(-L / 2 - 4, -h - 6, L + 8, 6);
    return { d, lit: [] };
  };
  T.station = (r, o) => {
    const L = 360, wallH = 64, roofH = 40;
    let d = rect(-L / 2, -wallH, L, wallH);
    const n = 7;
    for (let i = 0; i < n; i++) d += arch(-L / 2 + L * ((i + 0.5) / n), 0, L / n - 14, wallH - 14);
    // the long arched roof of the train shed
    d += `M${f1(-L / 2 - 8)} ${-wallH}C${f1(-L / 2 + 20)} ${f1(-wallH - roofH * 1.25)} ${f1(L / 2 - 20)} ${f1(-wallH - roofH * 1.25)} ${f1(L / 2 + 8)} ${-wallH}Z`;
    d += rect(-6, -wallH - roofH - 26, 12, 26);
    const lit = [];
    for (let i = 0; i < n; i++) lit.push([-L / 2 + L * ((i + 0.5) / n) - 6, -30, 12, 9]);
    return { d, lit: o.lit ? lit : [], clock: [0, -wallH - roofH - 30] };
  };
  T.cabin = (r, o) => {
    const d = rect(-26, -40, 52, 40) + rect(-34, -82, 68, 42) + poly([[-40, -82], [0, -100], [40, -82]]) + rect(28, -42, 30, 3);
    return { d, lit: [[-27, -74, 16, 13], [-8, -74, 16, 13], [11, -74, 16, 13]], rail: [[30, 0], [58, -40]] };
  };
  T.platform = () => ({ d: rect(-260, -12, 520, 12), lit: [], edge: [-260, 260, -12] });
  T.rails = () => ({ rails: true, d: '', lit: [] });
  T.train = (r, o) => {
    const n = Math.max(1, Math.min(8, o.count > 1 ? o.count : 4)), cw = 104, gap = 6, L = n * (cw + gap) + 70;
    let d = '', lit = [], x = -L / 2;
    // the engine first, then the carriages
    d += rect(x, -40, 70, 32) + rect(x + 46, -56, 24, 48) + rect(x + 8, -58, 9, 18) + circle(x + 18, -4, 7) + circle(x + 48, -4, 7);
    x += 76;
    for (let i = 0; i < n; i++) {
      d += `M${f1(x)} -8V-40Q${f1(x)} -48 ${f1(x + 8)} -48H${f1(x + cw - 8)}Q${f1(x + cw)} -48 ${f1(x + cw)} -40V-8Z`;
      d += circle(x + 18, -4, 6) + circle(x + cw - 18, -4, 6);
      for (let k = 0; k < 5; k++) lit.push([x + 10 + k * 19, -38, 11, 12]);
      x += cw + gap;
    }
    return { d, lit: o.lit ? lit : [] };
  };
  // A squat car or cart on wheels with one lamp: a shunting car, a wagon, a handcart.
  T.wagon = () => ({ d: 'M-48 -8V-40Q-48 -46 -42 -46H42Q48 -46 48 -40V-8Z' + rect(-36, -54, 72, 8) + circle(-30, -4, 7) + circle(30, -4, 7) + rect(-56, -18, 8, 6), lit: [], glow: [[-50, -30, 18]], lamp: [-50, -30] });
  // People standing close together, a few heights, a few turned away.
  T.crowd = (r, o) => {
    const n = Math.max(3, o.count > 1 ? o.count : 8);
    let d = '';
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 13 + (r() - 0.5) * 6, h = 38 + r() * 12, w = 5 + r() * 2.5;
      d += circle(x, -h + 4.5, 4.5) + poly([[x - w, -h + 10], [x + w, -h + 10], [x + w + 1.5, -10], [x - w - 1.5, -10]]) + rect(x - 3.5, -10, 2.6, 10) + rect(x + 1, -10, 2.6, 10);
      if (r() < 0.25) d += rect(x + w - 1, -h * 0.55, 6, 8);
    }
    return { d, lit: [] };
  };
  T.lamp = () => ({ d: rect(-1.6, -74, 3.2, 74) + poly([[-4, -86], [4, -86], [6, -74], [-6, -74]]) + rect(-8, -88, 16, 3), lit: [], glow: [[0, -80, 26]] });
  T.trees = (r, o) => {
    const n = Math.max(2, o.count > 1 ? o.count : 5);
    let d = '';
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 30 + (r() - 0.5) * 14, h = 40 + r() * 30;
      d += rect(x - 1.5, -h * 0.5, 3, h * 0.5);
      for (let k = 0; k < 4; k++) d += circle(x + (r() - 0.5) * 22, -h * 0.55 - r() * h * 0.45, 9 + r() * 9);
    }
    return { d, lit: [] };
  };
  T.pines = (r, o) => {
    const n = Math.max(2, o.count > 1 ? o.count : 6);
    let d = '';
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 22 + (r() - 0.5) * 10, h = 50 + r() * 40;
      d += rect(x - 1.2, -h * 0.25, 2.4, h * 0.25);
      for (let k = 0; k < 4; k++) { const y = -h * 0.2 - k * h * 0.2, w = (4 - k) * 5 + 4; d += poly([[x - w, y], [x, y - h * 0.32], [x + w, y]]); }
    }
    return { d, lit: [] };
  };
  T.ship = () => ({ d: 'M-62 -18Q-56 0 -30 0H34Q58 0 66 -18Z' + rect(-2, -110, 4, 92) + 'M4 -104Q44 -70 6 -26Z' + 'M-4 -96Q-40 -66 -6 -28Z' + poly([[2, -110], [20, -106], [2, -102]]), lit: [] });
  T.ruin = (r) => {
    let d = '';
    for (const [x, w, h] of [[-80, 26, 70], [-40, 20, 46], [10, 34, 88], [60, 22, 40]]) {
      const top = [];
      for (let k = 0; k <= 4; k++) top.push([x + (w * k) / 4, -h + (r() - 0.3) * 16]);
      d += 'M' + pt([x, 0]) + 'L' + top.map(pt).join('L') + 'L' + pt([x + w, 0]) + 'Z';
    }
    return { d: d + arch(27, 0, 16, 40), lit: [] };
  };
  T.stair = () => {
    const steps = 9, sw = 13, sh = 8, P = [[-60, -steps * sh - 10]];
    for (let i = 0; i < steps; i++) { const x = -60 + i * sw, y = -(steps - i) * sh; P.push([x, y], [x + sw, y]); }
    P.push([-60 + steps * sw, 0], [-60, 0]);
    return { d: poly(P), lit: [], rail: [[-60, -steps * sh - 34], [-60 + steps * sw, -26]] };
  };
  T.clock = () => ({ d: rect(-2, -96, 4, 96), lit: [], face: [0, -104, 15] });
  T.rocks = (r, o) => {
    let d = '';
    const n = Math.max(1, o.count > 1 ? o.count : 3);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 34, w = 22 + r() * 22, h = 12 + r() * 18;
      d += poly([[x - w / 2, 0], [x - w * 0.4, -h * 0.6], [x - w * 0.1, -h], [x + w * 0.3, -h * 0.8], [x + w / 2, 0]]);
    }
    return { d, lit: [] };
  };

  // A small standing person, about 48 units tall, facing right; mirrored for left.
  function figure(f) {
    const walk = f.pose === 'walking', sit = f.pose === 'sitting', reach = f.pose === 'reaching';
    const top = sit ? -34 : -48;
    let d = circle(1, top + 5.5, 5.5);
    if (f.cloak) d += poly([[-6, top + 12], [6, top + 12], [10, sit ? -6 : -10], [-11, sit ? -6 : -10]]);
    else d += poly([[-5, top + 12], [5, top + 12], [6, sit ? -10 : -18], [-6, sit ? -10 : -18]]);
    if (sit) d += poly([[-6, -10], [10, -10], [12, -6], [12, 0], [9, 0], [8, -6], [-6, -6]]);
    else if (walk) d += poly([[-4, -18], [-1, -18], [-8, 0], [-11, 0]]) + poly([[1, -18], [4, -18], [10, 0], [7, 0]]);
    else d += rect(-4, -18, 3, 18) + rect(1, -18, 3, 18);
    if (reach) d += poly([[3, top + 13], [5, top + 11], [18, top + 2], [17, top + 6]]);
    const extra = [];
    if (f.carry === 'staff') d += rect(9, top - 6, 2, -top + 6);
    if (f.carry === 'bag') d += rect(6, -24, 8, 9);
    if (f.carry === 'ladder') { d += poly([[-14, top + 30], [-12, top + 31], [16, top - 10], [14, top - 11]]) + poly([[-9, top + 34], [-7, top + 35], [21, top - 6], [19, top - 7]]); }
    if (f.carry === 'child') d += circle(-12, -25, 3.6) + poly([[-15, -21], [-9, -21], [-8, -8], [-16, -8]]) + rect(-15, -8, 2, 8) + rect(-11, -8, 2, 8);
    if (f.carry === 'lamp') { d += rect(8, top + 22, 1.4, 6) + rect(6, top + 28, 6, 7); extra.push([9, top + 31, 20]); }
    return { d, glow: extra };
  }

  // ---------------------------------------------------------------- the painting

  const SKY = {
    dawn: [['#dfe2e6', 0.55, 0], ['accent', 0.32, 0.92]],
    day: [['#c9d6e2', 0.5, 0], [PAPER, 0, 0.95]],
    dusk: [[INK, 0.28, 0], ['accent', 0.38, 0.75], ['accent', 0.18, 1]],
    night: [[INK, 0.7, 0], [INK, 0.36, 1]],
    storm: [['#4f5564', 0.55, 0], ['#8b909a', 0.22, 1]],
  };

  function paint(spec, opts) {
    const s = normalizePlate(spec, 1);
    const r = rng(s.seed);
    const uid = 'p' + String((opts && opts.id) || (s.seed % 1e6).toString(36)).replace(/[^A-Za-z0-9_-]/g, '_') + '_';
    const accent = s.accent;
    const night = s.time === 'night' || s.time === 'storm';
    const defs = [], air = [], back = [], mid = [], front = [], top = [];
    const horizon = s.water ? s.water.level * H : PLANE.far.base * H;
    let gid = 0;
    const grad = (stops, x2, y2) => {
      const id = uid + 'g' + gid++;
      defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="${x2 == null ? 0 : x2}" y2="${y2 == null ? 1 : y2}">`
        + stops.map(([o, c, a]) => `<stop offset="${Number(o).toFixed(3)}" stop-color="${c}" stop-opacity="${(Math.round(a * 100) / 100).toFixed(2)}"/>`).join('') + '</linearGradient>');
      return `url(#${id})`;
    };
    const radial = (c, a) => {
      const id = uid + 'r' + gid++;
      defs.push(`<radialGradient id="${id}"><stop offset="0" stop-color="${c}" stop-opacity="${a}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`);
      return `url(#${id})`;
    };
    defs.push(`<filter id="${uid}ink" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${s.seed % 997}"/><feDisplacementMap in="SourceGraphic" scale="3.2"/></filter>`);
    defs.push(`<filter id="${uid}soft" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="14"/></filter>`);
    defs.push(`<filter id="${uid}paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${(s.seed * 7) % 997}"/><feColorMatrix values="0 0 0 0 0.36 0 0 0 0 0.3 0 0 0 0 0.2 0 0 0 0.11 0"/></filter>`);

    // sky
    const reach = Math.min(1, (horizon + 70) / H);
    const sky = SKY[s.time].map(([c, a, o]) => [f1(o * (horizon / H) * 100) / 100, c === 'accent' ? accent : c, a]);
    const last = sky[sky.length - 1];
    sky.push([f1(reach * 100) / 100, last[1], 0]);
    air.push(`<rect width="${W}" height="${H}" fill="${grad(sky)}"/>`);
    // a faint earth tone under everything, so the foot of the picture is never bare
    back.push(atmos(`<rect y="${f1(H * 0.55)}" width="${W}" height="${f1(H * 0.45)}" fill="${grad([[0, INK, 0], [1, INK, night ? 0.22 : 0.1]])}"/>`));
    if (s.sky.stars && night) for (let i = 0; i < 46; i++) air.push(`<circle cx="${f1(r() * W)}" cy="${f1(r() * horizon * 0.7)}" r="${f1(0.5 + r() * 0.9)}" fill="${CLEAN}" opacity="${f1(0.4 + r() * 0.5)}"/>`);
    if (s.sky.moon) {
      const m = s.sky.moon, cx = m.x * W, cy = m.y * H, rr = 26 * m.size;
      air.push(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(rr * 3.4)}" fill="${radial(CLEAN, night ? 0.32 : 0.5)}"/>`);
      air.push(m.phase === 'crescent'
        ? `<path d="M${f1(cx)} ${f1(cy - rr)}A${f1(rr)} ${f1(rr)} 0 1 0 ${f1(cx)} ${f1(cy + rr)}A${f1(rr * 0.78)} ${f1(rr)} 0 1 1 ${f1(cx)} ${f1(cy - rr)}Z" fill="${CLEAN}"/>`
        : `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(rr)}" fill="${CLEAN}" stroke="${INK}" stroke-opacity="0.12"/>`);
    }
    if (s.sky.sun) {
      const u = s.sky.sun, cx = u.x * W, cy = u.y * H, rr = 24 * u.size;
      air.push(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(rr * 4)}" fill="${radial(accent, 0.3)}"/><circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(rr)}" fill="${accent}" opacity="0.62"/>`);
    }
    const nClouds = Math.round(s.sky.clouds * 7);
    for (let i = 0; i < nClouds; i++) {
      const cy = horizon * (0.1 + r() * 0.6), cw = 120 + r() * 260;
      air.push(`<ellipse cx="${f1(r() * W)}" cy="${f1(cy)}" rx="${f1(cw / 2)}" ry="${f1(8 + r() * 14)}" fill="${night ? INK : '#8d96a3'}" opacity="${f1((night ? 0.3 : 0.16) + r() * 0.1)}" filter="url(#${uid}soft)"/>`);
    }

    // ranges, far to near, each with a wash, a ridge line, texture strokes and a mist band
    const order = { far: 0, mid: 1, near: 2 };
    const ranges = s.ranges.slice().sort((a, b) => order[a.depth] - order[b.depth]);
    for (const rg of ranges) {
      const pl = PLANE[rg.depth], base = pl.base * H, a = pl.ink * (night ? 1.1 : 1);
      const topY = rg.depth === 'far' ? H * 0.1 : rg.depth === 'mid' ? H * 0.28 : H * 0.5;
      const ceiling = base - (base - topY) * rg.height;
      const P = ridge(r, rg.from * W, rg.to * W, base, ceiling, rg.peaks, 0.4 + rg.rough * 0.9);
      const fade = rg.depth === 'far' ? 70 : rg.depth === 'mid' ? 90 : 130;
      const fill = grad([[0, INK, a * 0.95], [0.5, INK, a * 0.42], [1, INK, 0]]);
      const target = rg.depth === 'near' ? front : rg.depth === 'mid' ? mid : back;
      let g = `<g filter="url(#${uid}ink)"><path d="M${f1(P[0][0])} ${f1(base + fade)}L${P.map(pt).join('L')}L${f1(P[P.length - 1][0])} ${f1(base + fade)}Z" fill="${fill}"/>`
        + `<path d="${line(P)}" fill="none" stroke="${INK}" stroke-opacity="${f1(a * 0.5 * 100) / 100}" stroke-width="${rg.depth === 'near' ? 5 : 3.5}" stroke-linejoin="round"/>`
        + `<path d="${line(P)}" fill="none" stroke="${INK}" stroke-opacity="${f1(Math.min(1, a * 1.2) * 100) / 100}" stroke-width="${rg.depth === 'far' ? 0.9 : rg.depth === 'mid' ? 1.4 : 2.2}" stroke-linejoin="round"/>`;
      let tex = '';
      for (let i = 2; i < P.length - 2; i += 3) {
        if (r() > 0.32) continue;
        const [x, y] = P[i], slope = (P[i + 2][1] - P[i - 2][1]) / (P[i + 2][0] - P[i - 2][0] || 1);
        if (Math.abs(slope) < 0.15) continue;
        const len = 6 + r() * Math.min(40, (base - y) * 0.22), dir = slope > 0 ? -1 : 1;
        tex += `M${f1(x)} ${f1(y + 2)}q${f1(dir * len * 0.35)} ${f1(len * 0.45)} ${f1(dir * len * 0.55)} ${f1(len)}`;
      }
      g += `<path d="${tex}" fill="none" stroke="${INK}" stroke-opacity="${f1(a * 0.45 * 100) / 100}" stroke-width="0.9" stroke-linecap="round"/>`;
      if (rg.wooded) {
        let dots = '';
        for (let i = 0; i < P.length; i++) {
          if (r() > 0.55) continue;
          const [x, y] = P[i], k = rg.depth === 'near' ? 1.4 : rg.depth === 'mid' ? 1 : 0.7;
          for (let j = 0; j < 2; j++) dots += `M${f1(x + (r() - 0.5) * 8 - 3.5 * k)} ${f1(y + r() * 10 * k)}a${f1(3.5 * k)} ${f1(1.8 * k)} 0 1 0 ${f1(7 * k)} 0a${f1(3.5 * k)} ${f1(1.8 * k)} 0 1 0 ${f1(-7 * k)} 0Z`;
        }
        g += `<path d="${dots}" fill="${INK}" opacity="${f1(Math.min(1, a * 1.25) * 100) / 100}"/>`;
      }
      target.push(g + '</g>');
      // the mist that settles at the foot of every range
      target.push(atmos(`<rect x="-40" y="${f1(base - 16)}" width="${W + 80}" height="${rg.depth === 'near' ? 30 : 46}" fill="${PAPER}" opacity="0.82" filter="url(#${uid}soft)"/>`));
    }

    // water
    if (s.water) {
      const y0 = s.water.level * H;
      mid.push(`<rect y="${f1(y0)}" width="${W}" height="${f1(H - y0)}" fill="${grad([[0, PAPER, 0.9], [1, INK, 0.16]])}"/>`);
      let rip = '';
      for (let i = 0; i < 110; i++) { const y = y0 + (H - y0) * r() ** 1.8, x = r() * W, l = 10 + r() * 50; rip += `M${f1(x)} ${f1(y)}h${f1(l)}`; }
      mid.push(`<path d="${rip}" stroke="${INK}" stroke-opacity="0.22" stroke-width="0.9" fill="none" stroke-linecap="round"/>`);
    }

    // things, far to near
    const things = s.things.slice().sort((a, b) => order[a.depth] - order[b.depth]);
    for (const t of things) {
      const pl = PLANE[t.depth], sc = pl.scale * SIZES[t.size], X = t.x * W, B = pl.base * H;
      const target = t.depth === 'near' ? front : t.depth === 'mid' ? mid : back;
      const a = Math.max(t.depth === 'far' ? 0.42 : 0.6, pl.ink);
      if (t.kind === 'rails') {
        let d = '';
        const L = 720 * sc;
        d += `M${f1(X - L / 2)} ${f1(B - 3 * sc)}h${f1(L)}M${f1(X - L / 2)} ${f1(B - 9 * sc)}h${f1(L)}`;
        for (let x = X - L / 2; x < X + L / 2; x += 16 * sc) d += `M${f1(x)} ${f1(B)}l${f1(4 * sc)} ${f1(-12 * sc)}`;
        target.push(`<path d="${d}" stroke="${INK}" stroke-opacity="${f1(a * 0.8 * 100) / 100}" stroke-width="${f1(Math.max(0.8, 1.6 * sc))}" fill="none"/>`);
        continue;
      }
      const g = T[t.kind](r, t);
      const tf = `translate(${f1(X)} ${f1(B)}) scale(${f1(sc * 100) / 100})`;
      target.push(`<g transform="${tf}" filter="url(#${uid}ink)"><path d="${g.d}" fill="${INK}" opacity="${f1(a * 100) / 100}"/>`
        + (g.rail ? `<path d="${line(g.rail)}" stroke="${INK}" stroke-width="2" opacity="${f1(a * 100) / 100}" fill="none"/>` : '')
        + (g.bell ? `<path d="M${g.bell[0] - 6} ${g.bell[1] + 8}q6 -16 12 0z" fill="${INK}" opacity="${f1(a * 100) / 100}"/>` : '')
        + (g.face ? `<circle cx="${g.face[0]}" cy="${g.face[1]}" r="${g.face[2]}" fill="${CLEAN}" stroke="${INK}" stroke-width="2.4" opacity="${f1(Math.min(1, a + 0.1) * 100) / 100}"/><path d="M0 ${g.face[1]}v-9M0 ${g.face[1]}l6 3" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>` : '')
        + (g.clock ? `<circle cx="${g.clock[0]}" cy="${g.clock[1]}" r="11" fill="${CLEAN}" stroke="${INK}" stroke-width="2" opacity="${f1(a * 100) / 100}"/>` : '')
        + (g.edge ? `<path d="M${g.edge[0]} ${g.edge[2] + 2}H${g.edge[1]}" stroke="${accent}" stroke-width="1.6" opacity="0.8"/>` : '')
        + (g.lamp ? `<circle cx="${g.lamp[0]}" cy="${g.lamp[1]}" r="4" fill="${accent}"/>` : '')
        + '</g>');
      const litOn = t.lit || t.kind === 'lamp' || t.kind === 'wagon';
      if (litOn) {
        let lights = '';
        for (const [lx, ly, lw, lh] of g.lit || []) {
          lights += `<rect x="${f1(X + lx * sc)}" y="${f1(B + ly * sc)}" width="${f1(lw * sc)}" height="${f1(lh * sc)}" fill="${accent}" opacity="0.92"/>`;
          lights += `<circle cx="${f1(X + (lx + lw / 2) * sc)}" cy="${f1(B + (ly + lh / 2) * sc)}" r="${f1(Math.min(34, Math.max(8, Math.min(lw, lh) * sc * 2.2)))}" fill="${radial(accent, 0.3)}"/>`;
        }
        for (const [gx, gy, gr] of g.glow || []) lights += `<circle cx="${f1(X + gx * sc)}" cy="${f1(B + gy * sc)}" r="${f1(Math.min(60, gr * sc * 1.4))}" fill="${radial(accent, 0.42)}"/>`;
        target.push(lights);
      }
    }

    // ground
    const nb = PLANE.near.base * H;
    if (s.ground === 'flat' || s.ground === 'platform') front.push(`<rect y="${f1(nb - 8)}" width="${W}" height="${f1(H - nb + 8)}" fill="${grad([[0, INK, 0.82], [1, INK, 0.92]])}" filter="url(#${uid}ink)"/>`);
    if (s.ground === 'platform') front.push(`<path d="M0 ${f1(nb - 6)}H${W}" stroke="${accent}" stroke-width="2.2" opacity="0.85"/><path d="M0 ${f1(nb - 9)}H${W}" stroke="${CLEAN}" stroke-width="1" opacity="0.35"/>`);
    if (s.ground === 'hill') {
      const P = ridge(r, 0, W, H + 10, nb - 50, 2, 0.5);
      front.push(`<path d="M0 ${H}L${P.map(pt).join('L')}L${W} ${H}Z" fill="${grad([[0, INK, 0.85], [1, INK, 0.95]])}" filter="url(#${uid}ink)"/>`);
    }
    if (s.ground === 'shore') front.push(`<path d="M0 ${f1(nb - 40)}Q${W * 0.3} ${f1(nb - 10)} ${W * 0.62} ${f1(nb + 4)}L${W} ${H}H0Z" fill="${INK}" opacity="0.85" filter="url(#${uid}ink)"/>`);

    // weather
    if (s.weather === 'mist') top.push(atmos(`<rect y="${f1(horizon - 40)}" width="${W}" height="120" fill="${PAPER}" opacity="0.55" filter="url(#${uid}soft)"/>`));
    if (s.weather === 'rain') { let d = ''; for (let i = 0; i < 160; i++) { const x = r() * W, y = r() * H; d += `M${f1(x)} ${f1(y)}l-5 16`; } top.push(atmos(`<path d="${d}" stroke="${INK}" stroke-opacity="0.16" stroke-width="0.8"/>`)); }
    if (s.weather === 'snow') for (let i = 0; i < 120; i++) top.push(atmos(`<circle cx="${f1(r() * W)}" cy="${f1(r() * H)}" r="${f1(0.8 + r() * 1.4)}" fill="${CLEAN}" opacity="0.8"/>`));

    // people
    for (const f of s.figures.slice().sort((a, b) => order[a.depth] - order[b.depth])) {
      const pl = PLANE[f.depth], sc = pl.scale * (f.depth === 'near' ? 1.25 : 1), X = f.x * W, B = pl.base * H - (f.depth === 'near' && (s.ground === 'flat' || s.ground === 'platform') ? 8 : 0);
      const fg = figure(f), flip = f.facing === 'left' ? -1 : 1;
      top.push(`<g transform="translate(${f1(X)} ${f1(B)}) scale(${f1(sc * flip * 100) / 100} ${f1(sc * 100) / 100})"><path d="${fg.d}" fill="${INK}" opacity="${f1(Math.max(0.75, pl.ink) * 100) / 100}"/></g>`);
      for (const [gx, gy, gr] of fg.glow) top.push(`<circle cx="${f1(X + gx * sc * flip)}" cy="${f1(B + gy * sc)}" r="${f1(gr * sc)}" fill="${radial(accent, 0.55)}"/>`);
    }

    // portrait: one large figure in profile, lit along its face
    if (s.mode === 'portrait' && s.sitter) top.push(portrait(s.sitter, accent, uid, radial));

    // paper grain over everything painted, and a faint darkening toward the edges
    const grain = `<rect width="${W}" height="${H}" filter="url(#${uid}paper)"/>`;
    const vign = `<rect width="${W}" height="${H}" fill="${radialVignette(defs, uid)}"/>`;
    // A void at a depth takes that depth and everything nearer, and shows what lies beyond it:
    // a missing step shows the sea behind it, a Cut through the town shows the far hills and air.
    // Only land is cut: earth, water, buildings, people. The air in front of it (mist, rain, the
    // earth's own wash) stays, so an absence reads as missing ground, not as a beam of light.
    const cut = (items, depths) => {
      const vs = s.voids.filter((v) => depths.includes(v.depth));
      const id = uid + 'cut' + depths.length;
      if (vs.length) defs.push(`<mask id="${id}"><rect width="${W}" height="${H}" fill="#fff"/>${vs.map(voidShape).join('')}</mask>`);
      let out = '', run = '';
      const flush = () => { if (run) out += vs.length ? `<g mask="url(#${id})">${run}</g>` : run; run = ''; };
      for (const it of items) {
        if (typeof it === 'string') run += it;
        else { flush(); out += it.atmos; }
      }
      flush();
      return out;
    };
    const world = cut(back, ['far']) + cut(mid, ['far', 'mid']) + cut(front.concat(top), DEPTHS) + grain;
    const title = esc(s.alt || s.title || 'An ink painting');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}" class="plate-svg">`
      + `<title>${title}</title><defs>${defs.join('')}</defs>`
      + `<rect width="${W}" height="${H}" fill="${PAPER}"/>${air.join('')}${world}${vign}</svg>`;
  }
  function radialVignette(defs, uid) {
    const id = uid + 'vig';
    defs.push(`<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="${INK}" stop-opacity="0"/><stop offset="1" stop-color="${INK}" stop-opacity="0.14"/></radialGradient>`);
    return `url(#${id})`;
  }
  // A clean absence, as a shape in the mask that cuts the world away: whatever stood there is
  // gone, with edges straighter than anything a brush makes, and the air behind shows through.
  function voidShape(v) {
    const x = v.x * W, y = v.y * H, w = v.w * W, h = v.h * H;
    let d;
    if (v.shape === 'circle') d = circle(x + w / 2, y + h / 2, Math.min(w, h) / 2);
    else if (v.shape === 'band') d = rect(-20, y, W + 40, h);
    else if (v.shape === 'wedge') d = poly([[x, y], [x + w, y], [x + w / 2, y + h]]);
    else d = rect(x, y, w, h);
    const rot = v.angle && v.shape !== 'band' && v.shape !== 'circle' ? ` transform="rotate(${f1(v.angle)} ${f1(x + w / 2)} ${f1(y + h / 2)})"` : '';
    return `<path d="${d}"${rot} fill="#000"/>`;
  }

  // A sitter in profile, head and shoulders, facing right before mirroring.
  function portrait(p, accent, uid, radial) {
    const flip = p.facing === 'left' ? -1 : 1;
    const cx = p.facing === 'left' ? W * 0.62 : W * 0.38, neckY = H * 0.5;
    const broad = p.build === 'broad' ? 1.18 : p.build === 'slight' ? 0.86 : 1;
    const stoop = p.age === 'old' ? 9 : 0;
    const head = 'M-40 0C-50 -40 -72 -70 -62 -100C-52 -140 -16 -160 14 -152C40 -146 51 -128 51 -112C51 -104 55 -100 56 -96L67 -72C69 -67 64 -64 56 -63L58 -56C56 -52 55 -51 53 -50L57 -45C54 -38 52 -32 46 -28C38 -22 28 -20 22 -14L20 0Z';
    let extra = '';
    if (p.head === 'hood' || p.cloak) extra += `M-86 70C-128 -40 -96 -178 2 -184C60 -186 86 -146 76 -110L58 -101C62 -128 44 -150 10 -154C-30 -156 -58 -132 -60 -96C-62 -40 -40 10 -30 40Z`;
    if (p.head === 'brimmed') extra += 'M-84 -126C-40 -138 50 -138 96 -124C60 -114 -40 -114 -84 -126Z M-44 -126C-44 -168 -30 -178 4 -178C38 -178 48 -168 46 -126Z';
    if (p.head === 'cap') extra += 'M-52 -124C-56 -160 -20 -168 8 -164C36 -160 50 -146 50 -126L84 -122C80 -114 50 -116 40 -118Z';
    if (p.head === 'tall') extra += 'M-74 -128C-30 -136 40 -136 80 -128C50 -120 -40 -120 -74 -128Z M-40 -130L-36 -220H36L40 -130Z';
    if (p.hair === 'long') extra += 'M-56 -120C-92 -60 -86 30 -58 66L-18 46C-40 4 -46 -60 -30 -122Z';
    if (p.hair === 'bun') extra += circle(-60, -122, 22);
    if (p.beard) extra += 'M54 -47C64 -30 58 -4 34 6C18 10 12 -4 20 -14Z';
    if (p.collar) extra += 'M-46 14L-60 -26L-26 2Z M22 14L38 -22L12 2Z';
    const sh = 190 * broad;
    const body = `M-40 0C-60 24 -120 30 ${f1(-sh + 20)} 58C${f1(-sh - 10)} 74 ${f1(-sh - 24)} 150 ${f1(-sh - 30)} 340L${f1(sh + 10)} 340C${f1(sh + 4)} 150 ${f1(sh - 8)} 74 ${f1(sh - 40)} 58C110 36 40 24 20 0Z`;
    let held = '', glow = '';
    if (p.holds === 'staff') held = rect(sh - 10, -200, 7, 540);
    if (p.holds === 'book') held = rect(70, 110, 74, 52);
    let lamp = '';
    if (p.holds === 'lamp') {
      held = rect(96, 64, 3, 26);
      lamp = `<path d="M86 90h24l-4 36h-16Z" fill="${accent}"/><path d="M84 88h28v4h-28Z" fill="${INK}"/>`;
      glow = `<circle cx="${f1(cx + 98 * flip)}" cy="${f1(neckY + 108)}" r="90" fill="${radial(accent, 0.55)}"/>`;
    }
    const tf = `translate(${f1(cx)} ${f1(neckY)}) scale(${flip} 1)`;
    const headTf = stoop ? ` transform="rotate(${stoop} 0 0) translate(6 6)"` : '';
    const halo = `<circle cx="${f1(cx + 10 * flip)}" cy="${f1(neckY - 90)}" r="210" fill="${radial(accent, 0.34)}"/>`;
    const solid = (d) => (d ? `<path d="${d}" fill="${INK}"/>` : '');
    return halo + `<g transform="${tf}" filter="url(#${uid}ink)">`
      + `<g${headTf}><path d="${head}" fill="none" stroke="${accent}" stroke-width="5" opacity="0.8" transform="translate(3 0)"/></g>`
      + `<g opacity="0.94">${solid(body)}${held.split('Z').filter(Boolean).map((d) => solid(d + 'Z')).join('')}</g>${lamp}`
      + `<g${headTf} opacity="0.95">${solid(head)}${extra.split('Z').filter((d) => d.trim()).map((d) => solid(d.trim() + 'Z')).join('')}</g></g>` + glow;
  }

  // ---------------------------------------------------------------- asking Claude for a plate

  const GUIDE = `Reply with only JSON in this form (every field optional except "title" and "alt"):
{"title": "short caption", "alt": "one sentence describing the picture for someone who cannot see it",
 "mode": "landscape" or "portrait",
 "time": "dawn|day|dusk|night|storm", "weather": "clear|mist|rain|snow", "accent": "#rrggbb",
 "sky": {"moon": {"x": 0.75, "y": 0.18, "size": 1, "phase": "full|crescent"}, "sun": {"x": 0.3, "y": 0.35, "size": 1}, "stars": false, "clouds": 0.3},
 "ranges": [{"depth": "far|mid|near", "from": 0, "to": 1, "height": 0.6, "rough": 0.5, "peaks": 3, "wooded": false}],
 "water": {"level": 0.7, "kind": "sea|lake|river"},
 "ground": "none|hill|flat|platform|shore",
 "things": [{"kind": "${THINGS.join('|')}", "x": 0.5, "depth": "far|mid|near", "size": "small|medium|large", "count": 1, "lit": false}],
 "figures": [{"x": 0.5, "depth": "far|mid|near", "pose": "standing|walking|reaching|sitting", "facing": "left|right", "carry": "none|lamp|child|staff|ladder|bag", "cloak": false}],
 "voids": [{"shape": "rect|band|wedge|circle", "depth": "far|mid|near", "x": 0.4, "y": 0.5, "w": 0.2, "h": 0.2, "angle": 0}],
 "sitter": {"facing": "left|right", "head": "bare|hood|cap|brimmed|tall", "hair": "short|long|bun|none", "beard": false, "collar": false, "cloak": false, "holds": "none|lamp|staff|book", "age": "young|adult|old", "build": "slight|medium|broad"}}
x and y run from 0 (left, top) to 1 (right, bottom). Leave out what the picture doesn't need. "count" sets how many arches a viaduct or bridge has, carriages a train has, or houses, trees or rocks a cluster has. "voids" are places that are simply gone: clean absences cut out of the picture. A void at a depth removes everything at that depth and nearer, and what lies beyond shows through. Use them only if the world has such things. "sitter" is only for a portrait.`;

  // What Claude gets: the subject, the facts that describe it, the world's own colors.
  function buildPlatePrompt({ world, subject, name, facts, text: body, notes, pigments }) {
    const kind = subject === 'character' ? 'a portrait of a character' : subject === 'place' ? 'a picture of a place' : 'an illustration for a scene';
    const parts = [
      `You are composing ${kind} for the novel "${(world && world.title) || 'Untitled'}", as one plate in an illustrated edition: an ink wash painting on paper, mostly ink with one accent color. Inkwash paints it from your composition, so describe what is in the picture and roughly where.`,
      world && world.premise ? 'THE WORLD\n' + world.premise : '',
      name ? 'SUBJECT\n' + name : '',
      facts && facts.length ? 'FACTS (never contradict them)\n' + facts.map((f) => '- ' + f).join('\n') : '',
      notes && notes.length ? "THE AUTHOR'S NOTES\n" + notes.map((n) => '- ' + n).join('\n') : '',
      body ? 'THE SCENE\n"""\n' + String(body).slice(0, 6000) + '\n"""' : '',
      // the moods painted on this scene if there are any, else the world's palette
      pigments && pigments.length
        ? (pigments.some((p) => p.pct) ? 'MOODS THE AUTHOR PAINTED HERE, WITH THEIR COLORS (take the accent from the strongest)\n' : "THE WORLD'S MOODS, WITH THEIR COLORS (take the accent from the one that fits best)\n")
          + pigments.map((p) => `- ${p.name} ${p.color}${p.pct ? ` (${p.pct}%)` : ''}`).join('\n')
        : '',
      subject === 'character'
        ? 'Make a portrait ("mode": "portrait"): the sitter in profile, head and shoulders, with a faint backdrop of where they belong. Choose head, hair and what they hold from the facts; invent nothing the facts would contradict.'
        : subject === 'place'
          ? 'Make a landscape of the place as a traveller would first see it: its shape, its landmarks and its light.'
          : 'Choose the single most striking moment of the scene and the view a painter would take of it: usually from outside, with the people small against the world.',
      GUIDE,
    ];
    return parts.filter(Boolean).join('\n\n');
  }
  function parsePlate(json, seed) {
    if (!json || typeof json !== 'object') return null;
    const spec = normalizePlate(json, seed);
    if (!spec.title) spec.title = spec.mode === 'portrait' ? 'Portrait' : 'Plate';
    return spec;
  }
  // Plates live in their own collection, keyed by what they illustrate.
  const plateId = { scene: (chapterId, k) => `${chapterId}__s${k + 1}`, entity: (entityId) => `ent__${entityId}` };

  return { W, H, THINGS, normalizePlate, paint, buildPlatePrompt, parsePlate, plateId, GUIDE };
});
