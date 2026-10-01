/* Inkwash atlas: a whole world drawn as an ink map. Claude dreams the world as a small spec (its
 * shape, its regions and what they're like, its peoples' places); this module grows the land,
 * mountains, rivers and borders from that spec with seeded noise, settles every place where it
 * would plausibly stand, and draws it all as an SVG in the manner of a hand-inked map. The same
 * spec always draws the same world, and adding places never moves the land. No DOM and no
 * platform calls, so the page, the exports and the Node tests share exactly this code. Loaded in
 * the page as window.InkAtlas. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InkAtlas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const W = 1600, H = 1000, CELL = 4, GW = W / CELL, GH = H / CELL, N = GW * GH, ASPECT = W / H;
  const PAPER = '#ece3cd', LAND = '#f5efdf', SEA = '#e1e3da', INK = '#1f232b', WATER = '#2f4b63';
  const SHAPES = ['continent', 'archipelago', 'twin', 'basin', 'inland-sea', 'coast'];
  const CLIMATES = ['temperate', 'cold', 'hot', 'varied'];
  const BIOMES = ['grassland', 'forest', 'taiga', 'jungle', 'desert', 'steppe', 'tundra', 'marsh', 'badlands', 'volcanic', 'saltflat', 'highlands'];
  const RELIEFS = ['flat', 'hills', 'mountains'];
  const AT = { north: [0.52, 0.25], 'north-east': [0.74, 0.28], east: [0.78, 0.52], 'south-east': [0.73, 0.73], south: [0.48, 0.76], 'south-west': [0.27, 0.72], west: [0.22, 0.48], 'north-west': [0.28, 0.27], center: [0.5, 0.5] };
  const AT_ORDER = ['center', 'north', 'south', 'east', 'west', 'north-west', 'south-east', 'north-east', 'south-west'];
  const SIZES = { small: 0.085, medium: 0.115, large: 0.15 };
  const KINDS = ['capital', 'city', 'town', 'village', 'port', 'fortress', 'ruin', 'temple', 'tower', 'mine', 'camp', 'wreck', 'landmark'];
  const NEAR = ['any', 'coast', 'river', 'mountains', 'center', 'border', 'edge'];
  const FEATURES = ['range', 'forest', 'desert', 'marsh', 'lake', 'river', 'chasm', 'volcano', 'plain', 'bay', 'island'];
  const ALIAS = {
    plains: 'grassland', plain: 'grassland', meadow: 'grassland', meadows: 'grassland', farmland: 'grassland', fields: 'grassland',
    woods: 'forest', woodland: 'forest', snow: 'tundra', ice: 'tundra', glacier: 'tundra', swamp: 'marsh', wetland: 'marsh', wetlands: 'marsh', fen: 'marsh', bog: 'marsh',
    mountains: 'highlands', mountain: 'highlands', hills: 'highlands', alpine: 'highlands', volcano: 'volcanic', ash: 'volcanic', salt: 'saltflat', 'salt-flat': 'saltflat', 'salt-flats': 'saltflat', seabed: 'saltflat',
    rainforest: 'jungle', savanna: 'steppe', savannah: 'steppe', prairie: 'steppe', wasteland: 'badlands', canyons: 'badlands', canyon: 'badlands', dunes: 'desert', boreal: 'taiga',
  };
  const AT_ALIAS = { n: 'north', s: 'south', e: 'east', w: 'west', ne: 'north-east', nw: 'north-west', se: 'south-east', sw: 'south-west', northeast: 'north-east', northwest: 'north-west', southeast: 'south-east', southwest: 'south-west', middle: 'center', centre: 'center', central: 'center' };
  // How much rain each kind of land catches, so rivers rise where they would.
  const RAIN = { grassland: 1, forest: 1.25, taiga: 1, jungle: 1.7, desert: 0.12, steppe: 0.55, tundra: 0.6, marsh: 1.4, badlands: 0.3, volcanic: 0.7, saltflat: 0.08, highlands: 1.15 };
  const HILL = 0.4, MOUNT = 0.56, PEAK = 0.74;

  // ---------------------------------------------------------------- cleaning a spec

  const num = (v, a, b, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
  const word = (v) => String(v == null ? '' : v).toLowerCase().trim().replace(/[\s_]+/g, '-');
  const pick = (v, list, d, alias) => { let s = word(v); if (alias && alias[s]) s = alias[s]; return list.includes(s) ? s : d; };
  const text = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const hex = (v, d) => { const s = String(v == null ? '' : v).trim().toLowerCase(); return /^#[0-9a-f]{6}$/.test(s) ? s : d; };
  const list = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  const ID = /^[A-Za-z0-9_-]{1,64}$/;
  const idOk = (v) => (typeof v === 'string' && ID.test(v) ? v : null);
  const slug = (s) => word(s).replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'x';

  // Make a spec safe and complete. Regions and places may name each other by id or by name;
  // whatever is unknown is dropped, numbers are clamped, and every id is unique.
  function normalizeAtlas(raw, seed) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const used = new Set();
    const unique = (want, fallback) => { let id = idOk(want) || fallback; let k = 2; const base = id; while (used.has(id)) id = `${base}_${k++}`; used.add(id); return id; };
    const regions = list(raw.regions, 16).map((r, i) => {
      r = r || {};
      const name = text(r.name, 60) || `Region ${i + 1}`;
      return {
        id: unique(r.id, 'r_' + slug(name)), name, biome: pick(r.biome, BIOMES, 'grassland', ALIAS),
        at: pick(r.at, Object.keys(AT), AT_ORDER[i % AT_ORDER.length], AT_ALIAS), size: pick(r.size, Object.keys(SIZES), 'medium'),
        relief: pick(r.relief, RELIEFS, 'hills'), entity: idOk(r.entity),
      };
    });
    const region = (v) => {
      if (v == null) return null;
      const s = String(v);
      const hit = regions.find((r) => r.id === s) || regions.find((r) => r.name.toLowerCase() === s.toLowerCase().trim());
      return hit ? hit.id : null;
    };
    const places = list(raw.places, 240).map((p, i) => {
      p = p || {};
      const name = text(p.name, 60) || `Place ${i + 1}`;
      return { id: unique(p.id, 'p_' + slug(name)), name, kind: pick(p.kind, KINDS, 'town'), region: region(p.region), near: pick(p.near, NEAR, 'any'), entity: idOk(p.entity) };
    }).filter((p) => p.region);
    const features = list(raw.features, 40).map((f, i) => {
      f = f || {};
      const name = text(f.name, 60) || `Feature ${i + 1}`;
      return { id: unique(f.id, 'f_' + slug(name)), name, kind: pick(f.kind, FEATURES, 'range'), region: region(f.region), entity: idOk(f.entity) };
    }).filter((f) => f.region);
    const seas = list(raw.seas, 8).map((s) => ({ name: text(s && s.name, 60), at: pick(s && s.at, Object.keys(AT), 'south', AT_ALIAS) })).filter((s) => s.name);
    return {
      v: 1, seed: Math.floor(num(raw.seed, 1, 2147483647, seed || 1)), title: text(raw.title, 80), subtitle: text(raw.subtitle, 120),
      shape: pick(raw.shape, SHAPES, 'continent'), climate: pick(raw.climate, CLIMATES, 'temperate'), accent: hex(raw.accent, '#a8572e'),
      regions, places, seas, features,
    };
  }

  // ---------------------------------------------------------------- randomness and noise

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
  function hash(s) { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
  // Gradient noise on a seeded lattice, about -1..1.
  function noise(seed) {
    const r = rng(seed), p = new Uint8Array(512), gx = new Float32Array(256), gy = new Float32Array(256);
    const perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
      const X = xi & 255, Y = yi & 255, a = p[X], b = p[X + 1];
      const h00 = p[a + Y], h10 = p[b + Y], h01 = p[a + Y + 1], h11 = p[b + Y + 1];
      const n00 = gx[h00] * xf + gy[h00] * yf, n10 = gx[h10] * (xf - 1) + gy[h10] * yf;
      const n01 = gx[h01] * xf + gy[h01] * (yf - 1), n11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1);
      const top = n00 + (n10 - n00) * u, bot = n01 + (n11 - n01) * u;
      return (top + (bot - top) * v) * 1.414;
    };
  }
  function fbm(n, x, y, oct) { let s = 0, a = 1, f = 1, t = 0; for (let o = 0; o < oct; o++) { s += a * n(x * f, y * f); t += a; a *= 0.5; f *= 2.03; } return s / t; }
  function ridged(n, x, y, oct) { let s = 0, a = 1, f = 1, t = 0; for (let o = 0; o < oct; o++) { const v = 1 - Math.abs(n(x * f + o * 17.3, y * f)); s += a * v * v; t += a; a *= 0.5; f *= 2.1; } return s / t; }

  // ---------------------------------------------------------------- grid helpers

  const idx = (i, j) => j * GW + i;
  const cx = (c) => ((c % GW) + 0.5) * CELL, cy = (c) => (Math.floor(c / GW) + 0.5) * CELL;
  const cellAt = (x, y) => idx(Math.min(GW - 1, Math.max(0, Math.floor(x / CELL))), Math.min(GH - 1, Math.max(0, Math.floor(y / CELL))));
  const N8 = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [1, 1, 1.414]];
  function eachNeighbor(c, fn) {
    const i = c % GW, j = (c - i) / GW;
    for (const [di, dj, d] of N8) { const a = i + di, b = j + dj; if (a >= 0 && a < GW && b >= 0 && b < GH) fn(b * GW + a, d); }
  }
  // A small binary heap of (key, value) pairs, smallest key first.
  function heap() {
    const k = [], v = [];
    return {
      get size() { return k.length; },
      push(key, val) { k.push(key); v.push(val); let i = k.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; } },
      pop() {
        const top = v[0], lk = k.pop(), lv = v.pop();
        if (k.length) {
          k[0] = lk; v[0] = lv; let i = 0;
          for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < k.length && k[l] < k[m]) m = l; if (r < k.length && k[r] < k[m]) m = r; if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; }
        }
        return top;
      },
    };
  }
  // Distance in cells from every cell to the nearest cell where mask is set (two-pass chamfer).
  function distanceTo(mask) {
    const d = new Float32Array(N);
    for (let c = 0; c < N; c++) d[c] = mask[c] ? 0 : 1e9;
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const c = idx(i, j); let v = d[c];
      if (i > 0) v = Math.min(v, d[c - 1] + 1);
      if (j > 0) { v = Math.min(v, d[c - GW] + 1); if (i > 0) v = Math.min(v, d[c - GW - 1] + 1.414); if (i < GW - 1) v = Math.min(v, d[c - GW + 1] + 1.414); }
      d[c] = v;
    }
    for (let j = GH - 1; j >= 0; j--) for (let i = GW - 1; i >= 0; i--) {
      const c = idx(i, j); let v = d[c];
      if (i < GW - 1) v = Math.min(v, d[c + 1] + 1);
      if (j < GH - 1) { v = Math.min(v, d[c + GW] + 1); if (i < GW - 1) v = Math.min(v, d[c + GW + 1] + 1.414); if (i > 0) v = Math.min(v, d[c + GW - 1] + 1.414); }
      d[c] = v;
    }
    return d;
  }

  // Contour lines of a field at a level (marching squares over cell centres), joined into
  // polylines. The field is padded with `pad` beyond the frame, so contours of land close.
  function contours(field, level, pad) {
    const PW = GW + 2, PH = GH + 2;
    const at = (i, j) => (i < 1 || j < 1 || i > GW || j > GH ? pad : field[(j - 1) * GW + (i - 1)]);
    const segs = [];
    for (let j = 0; j < PH - 1; j++) for (let i = 0; i < PW - 1; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      const k = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (k === 0 || k === 15) continue;
      const x0 = (i - 0.5) * CELL, y0 = (j - 0.5) * CELL, t = (p, q) => (level - p) / (q - p);
      const T = () => [x0 + t(a, b) * CELL, y0], R = () => [x0 + CELL, y0 + t(b, c) * CELL];
      const B = () => [x0 + t(d, c) * CELL, y0 + CELL], L = () => [x0, y0 + t(a, d) * CELL];
      switch (k) {
        case 1: case 14: segs.push([L(), B()]); break;
        case 2: case 13: segs.push([B(), R()]); break;
        case 3: case 12: segs.push([L(), R()]); break;
        case 4: case 11: segs.push([T(), R()]); break;
        case 5: segs.push([L(), T()], [B(), R()]); break;
        case 6: case 9: segs.push([T(), B()]); break;
        case 7: case 8: segs.push([L(), T()]); break;
        case 10: segs.push([L(), B()], [T(), R()]); break;
        default: break;
      }
    }
    return chain(segs);
  }
  function chain(segs) {
    const key = (p) => p[0].toFixed(2) + ',' + p[1].toFixed(2);
    const ends = new Map();
    segs.forEach((s, i) => { for (const p of s) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } });
    const used = new Uint8Array(segs.length), lines = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const line = [segs[i][0], segs[i][1]];
      for (let pass = 0; pass < 2; pass++) {
        for (;;) {
          const k = key(line[line.length - 1]);
          const next = (ends.get(k) || []).find((j) => !used[j]);
          if (next === undefined) break;
          used[next] = 1;
          const s = segs[next];
          line.push(key(s[0]) === k ? s[1] : s[0]);
        }
        line.reverse();
      }
      const closed = line.length > 3 && key(line[0]) === key(line[line.length - 1]);
      lines.push({ pts: line, closed });
    }
    return lines;
  }
  // Rounder lines: corner cutting, keeping the ends of open lines where they are.
  function chaikin(pts, closed, times) {
    let p = pts;
    for (let t = 0; t < times; t++) {
      const q = [];
      const n = closed ? p.length - 1 : p.length;
      if (!closed) q.push(p[0]);
      for (let i = 0; i < n - (closed ? 0 : 1); i++) {
        const a = p[i], b = p[(i + 1) % n];
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      if (closed) q.push(q[0]); else q.push(p[p.length - 1]);
      p = q;
    }
    return p;
  }
  const f1 = (v) => Math.round(v * 10) / 10;
  const pathOf = (pts, closed) => (pts.length < 2 ? '' : 'M' + pts.map((p) => f1(p[0]) + ' ' + f1(p[1])).join('L') + (closed ? 'Z' : ''));
  // A faint line needs no tenth of a unit: rounder numbers keep a large map small.
  const roughPath = (pts, closed) => (pts.length < 2 ? '' : 'M' + pts.map((p) => Math.round(p[0]) + ' ' + Math.round(p[1])).join('L') + (closed ? 'Z' : ''));
  const smooth = (l, eps, times) => chaikin(l.closed ? simplify(l.pts.slice(0, -1), eps).concat([l.pts[0]]) : simplify(l.pts, eps), l.closed, times);
  const lineLen = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };

  // ---------------------------------------------------------------- the land

  // Where each region's heart lies, in 0..1 map units, spread apart when several share a side.
  function anchors(s) {
    const r = rng(s.seed ^ 0x5bd1e995), seen = {};
    return s.regions.map((g) => {
      const k = (seen[g.at] = (seen[g.at] || 0) + 1) - 1;
      let [x, y] = AT[g.at];
      if (k) { const a = k * 2.39996 + r(); x += (Math.cos(a) * 0.13) / ASPECT; y += Math.sin(a) * 0.13; }
      x += (r() - 0.5) * 0.1; y += (r() - 0.5) * 0.1;
      const lift = s.shape === 'archipelago' ? 0.6 : s.shape === 'basin' ? (g.at === 'center' ? 0 : 0.08) : 0.08;
      return { x: Math.min(0.88, Math.max(0.12, x)), y: Math.min(0.86, Math.max(0.14, y)), r: SIZES[g.size] * (s.shape === 'archipelago' ? 0.62 : 1), relief: g.relief, biome: g.biome, lift };
    });
  }
  // The land as a plateau that falls to the sea at its edge: height inland comes from the ridges
  // and hills the regions ask for, never from mere distance to the coast.
  function baseShape(shape, x, y) {
    const ex = (x - 0.5) * ASPECT, ey = y - 0.5;
    const ell = (ox, oy, rx, ry) => Math.sqrt(((ex - ox) / rx) ** 2 + ((ey - oy) / ry) ** 2);
    const shelf = (d, k) => 0.24 * Math.tanh((1 - d) * (k || 2.4));
    const dip = (d, a, b) => { const t = Math.min(1, Math.max(0, (a - d) / (a - b))); return t * t * (3 - 2 * t); };
    switch (shape) {
      case 'archipelago': return -0.24;
      case 'twin': return Math.max(shelf(ell(-0.4, 0, 0.32, 0.38)), shelf(ell(0.4, 0, 0.32, 0.38)));
      case 'basin': { const d = ell(0, 0, 0.64, 0.41); return shelf(d, 3) - 0.17 * dip(d, 0.74, 0.38); }
      case 'inland-sea': { const d = ell(0, 0, 0.66, 0.42); return shelf(d, 3) - 0.5 * dip(d, 0.66, 0.42); }
      case 'coast': return 0.24 * Math.tanh((0.6 - x) * 6);
      default: return shelf(ell(0, 0, 0.56, 0.37));
    }
  }

  const terrainCache = new Map();
  function terrain(s) {
    const key = JSON.stringify([s.seed, s.shape, s.climate, s.regions.map((r) => [r.at, r.size, r.relief, r.biome]), s.features.map((f) => [f.kind, f.region])]);
    if (terrainCache.has(key)) return terrainCache.get(key);
    const A = anchors(s);
    const N1 = noise(s.seed), N2 = noise(s.seed + 11), N3 = noise(s.seed + 23), NR = noise(s.seed + 37), NB = noise(s.seed + 51);
    const e = new Float32Array(N), flat = new Float32Array(N);
    const extra = [];
    if (s.shape === 'archipelago') { const r = rng(s.seed + 5); for (let k = 0; k < 9; k++) extra.push({ x: 0.08 + r() * 0.84, y: 0.1 + r() * 0.8, r: 0.025 + r() * 0.03, lift: 0.38 }); }
    // Features that shape the ground: a range rises, a lake sinks, a volcano stands.
    const fr = rng(s.seed + 77), shaped = [];
    for (const f of s.features) {
      const a = A[s.regions.findIndex((g) => g.id === f.region)];
      if (!a) continue;
      const ang = fr() * Math.PI * 2, off = a.r * (0.35 + fr() * 0.35);
      const x = a.x + (Math.cos(ang) * off) / ASPECT, y = a.y + Math.sin(ang) * off;
      if (f.kind === 'range') { const d = ang + Math.PI / 2 + (fr() - 0.5); shaped.push({ kind: 'range', x0: x - (Math.cos(d) * a.r * 0.9) / ASPECT, y0: y - Math.sin(d) * a.r * 0.9, x1: x + (Math.cos(d) * a.r * 0.9) / ASPECT, y1: y + Math.sin(d) * a.r * 0.9, f }); }
      else if (f.kind === 'lake') shaped.push({ kind: 'lake', x, y, r: 0.028 + fr() * 0.016, f });
      else if (f.kind === 'volcano') shaped.push({ kind: 'volcano', x, y, r: 0.03, f });
      else shaped.push({ kind: f.kind, x, y, r: a.r * 0.55, f });
    }
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const x = (i + 0.5) / GW, y = (j + 0.5) / GH;
      const wx = x + 0.09 * fbm(N2, x * 2.3, y * 2.3, 4), wy = y + 0.09 * fbm(N3, x * 2.3 + 7.7, y * 2.3 + 3.3, 4);
      let h = baseShape(s.shape, wx, wy), rough = 1, ridge = 0.06;
      for (const a of A.concat(extra)) {
        const dx = (wx - a.x) * ASPECT, dy = wy - a.y, g = Math.exp(-(dx * dx + dy * dy) / (2 * a.r * a.r));
        h += a.lift * g;
        if (a.relief === 'mountains') ridge += 0.8 * g;
        else if (a.relief === 'hills') ridge += 0.32 * g;
        else { ridge -= 0.06 * g; rough -= 0.45 * g; }
        if (a.biome === 'marsh' || a.biome === 'saltflat') rough -= 0.35 * g;
      }
      for (const f of shaped) {
        if (f.kind === 'range') {
          const vx = (f.x1 - f.x0) * ASPECT, vy = f.y1 - f.y0, px = (wx - f.x0) * ASPECT, py = wy - f.y0;
          const t = Math.max(0, Math.min(1, (px * vx + py * vy) / (vx * vx + vy * vy)));
          const d = Math.hypot(px - t * vx, py - t * vy);
          ridge += 0.9 * Math.exp(-(d * d) / 0.0015) * Math.sin(Math.PI * t) ** 0.5;
        } else if (f.kind === 'volcano') {
          const d = Math.hypot((wx - f.x) * ASPECT, wy - f.y);
          h += 0.55 * Math.exp(-(d * d) / (2 * f.r * f.r));
        }
      }
      h += 0.36 * Math.max(0.3, rough) * fbm(N1, wx * 4.4, wy * 4.4, 6) + 0.1 * fbm(N3, wx * 13, wy * 13, 4);
      if (ridge > 0) h += ridge * (ridged(NR, wx * 4.6, wy * 4.6, 4) - 0.36) * 1.15;
      for (const f of shaped) {
        if (f.kind !== 'lake') continue;
        const d = Math.hypot((x - f.x) * ASPECT, y - f.y), rr = f.r * (1 + 0.35 * fbm(N2, x * 30, y * 30, 2));
        if (d < rr) h = Math.min(h, -0.05 * (1 - d / rr) - 0.01);
      }
      // the frame is open sea, except a coast's landward side
      const edge = Math.min(x, 1 - x, y, 1 - y);
      if (edge < 0.05 && !(s.shape === 'coast' && x < 0.5)) h -= (0.05 - edge) * 8;
      e[j * GW + i] = h;
      flat[j * GW + i] = rough;
    }
    // water: sea is any low cell joined to the frame; the rest is lakes
    const water = new Uint8Array(N), stack = [];
    for (let c = 0; c < N; c++) { const i = c % GW, j = (c - i) / GW; if ((i === 0 || j === 0 || i === GW - 1 || j === GH - 1) && e[c] <= 0) { water[c] = 1; stack.push(c); } }
    while (stack.length) { const c = stack.pop(); eachNeighbor(c, (nb) => { if (!water[nb] && e[nb] <= 0) { water[nb] = 1; stack.push(nb); } }); }
    for (let c = 0; c < N; c++) if (!water[c] && e[c] <= 0) water[c] = 2;
    // no specks: tiny lakes are filled and tiny islets sunk
    blobs(water, (c) => water[c] === 2, (cells) => { if (cells.length < 10) for (const c of cells) { water[c] = 0; e[c] = 0.01; } });
    blobs(water, (c) => water[c] === 0, (cells) => { if (cells.length < 6) for (const c of cells) { water[c] = 1; e[c] = -0.01; } });
    const out = { A, e, water, flat, shaped, NB, seed: s.seed };
    regionsOf(s, out);
    biomesOf(s, out);
    hydrology(out);
    if (terrainCache.size > 4) terrainCache.clear();
    terrainCache.set(key, out);
    return out;
  }
  function blobs(water, member, fn) {
    const seen = new Uint8Array(N);
    for (let c = 0; c < N; c++) {
      if (seen[c] || !member(c)) continue;
      const cells = [c], st = [c]; seen[c] = 1;
      while (st.length) { const a = st.pop(); eachNeighbor(a, (nb) => { if (!seen[nb] && member(nb)) { seen[nb] = 1; cells.push(nb); st.push(nb); } }); }
      fn(cells);
    }
  }
  // Each region is the land nearest its heart, measured through a warped space so borders wander
  // the way real ones do; a stray piece cut off from its own region joins the one it touches.
  function regionsOf(s, T) {
    const { A, water } = T, raw = new Int16Array(N).fill(-1), region = new Int16Array(N).fill(-1);
    const W1 = noise(s.seed + 99), W2 = noise(s.seed + 131);
    const weight = s.regions.map((g) => (g.size === 'large' ? 1.22 : g.size === 'small' ? 0.82 : 1));
    for (let c = 0; c < N; c++) {
      if (water[c]) continue;
      const x = cx(c), y = cy(c), wx = x + 300 * fbm(W1, x / 420, y / 420, 5), wy = y + 300 * fbm(W2, x / 420, y / 420, 5);
      let best = -1, bd = Infinity;
      A.forEach((a, k) => { const d = Math.hypot(wx - a.x * W, wy - a.y * H) / weight[k]; if (d < bd) { bd = d; best = k; } });
      raw[c] = best;
    }
    // keep each region in one piece with its heart
    const q = [];
    A.forEach((a, k) => {
      let c = cellAt(a.x * W, a.y * H);
      if (water[c] || raw[c] !== k) { let bd = Infinity; for (let d = 0; d < N; d += 2) if (!water[d] && raw[d] === k) { const dd = Math.hypot(cx(d) - a.x * W, cy(d) - a.y * H); if (dd < bd) { bd = dd; c = d; } } }
      a.cell = c;
      if (!water[c] && region[c] < 0) { region[c] = k; q.push(c); }
    });
    for (let h = 0; h < q.length; h++) { const c = q[h]; eachNeighbor(c, (nb) => { if (!water[nb] && region[nb] < 0 && raw[nb] === region[c]) { region[nb] = region[c]; q.push(nb); } }); }
    for (let h = 0; h < q.length; h++) { const c = q[h]; eachNeighbor(c, (nb) => { if (!water[nb] && region[nb] < 0) { region[nb] = region[c]; q.push(nb); } }); }
    for (let c = 0; c < N; c++) if (!water[c] && region[c] < 0) region[c] = raw[c];
    T.region = region;
  }
  function biomesOf(s, T) {
    const { region, water, e, shaped, NB } = T, biome = new Uint8Array(N), B = (b) => BIOMES.indexOf(b);
    for (let c = 0; c < N; c++) {
      if (water[c] || region[c] < 0) continue;
      let b = s.regions[region[c]].biome;
      const x = cx(c) / W, y = cy(c) / H, v = fbm(NB, x * 7, y * 7, 3);
      // some variety inside a region: woods in the fields, clearings in the woods
      if ((b === 'grassland' || b === 'steppe') && v > 0.28 && s.climate !== 'hot') b = 'forest';
      else if (b === 'forest' && v < -0.32) b = 'grassland';
      else if (b === 'highlands' && v > 0.3) b = 'taiga';
      for (const f of shaped) {
        if (!['forest', 'desert', 'marsh', 'plain'].includes(f.kind) || s.regions[region[c]].id !== f.f.region) continue;
        const d = Math.hypot((x - f.x) * ASPECT, y - f.y);
        if (d < f.r * (0.8 + 0.35 * v)) b = f.kind === 'plain' ? 'grassland' : f.kind;
      }
      // the climate turns woods to pine in the cold and to jungle in the heat
      const lat = s.climate === 'cold' ? 0.9 : s.climate === 'hot' ? 0 : s.climate === 'varied' ? 1 - y : 0.45;
      if (b === 'forest' && lat > 0.72) b = 'taiga';
      if (b === 'forest' && s.climate === 'varied' && y > 0.8) b = 'jungle';
      biome[c] = B(b);
    }
    T.biome = biome;
  }
  // Rain runs downhill to the sea (through lakes); where enough gathers, there is a river.
  function hydrology(T) {
    const { water, biome } = T, M = noise(T.seed + 404);
    // a faint undulation of its own, so water finds a winding way across flat ground
    const e = Float32Array.from(T.e, (v, c) => v + 0.035 * fbm(M, cx(c) / 45, cy(c) / 45, 3));
    const filled = Float32Array.from(e), down = new Int32Array(N).fill(-1), seen = new Uint8Array(N), q = heap();
    for (let c = 0; c < N; c++) if (water[c] === 1) { seen[c] = 1; q.push(e[c], c); }
    const order = [];
    while (q.size) {
      const c = q.pop();
      order.push(c);
      eachNeighbor(c, (nb) => {
        if (seen[nb]) return;
        seen[nb] = 1;
        filled[nb] = Math.max(e[nb], filled[c] + 1e-5);
        down[nb] = c;
        q.push(filled[nb], nb);
      });
    }
    const acc = new Float32Array(N);
    for (let c = 0; c < N; c++) if (!water[c]) acc[c] = (RAIN[BIOMES[biome[c]]] || 1) * (1 + 0.6 * Math.max(0, e[c]));
    for (let k = order.length - 1; k >= 0; k--) { const c = order[k]; if (water[c] !== 1 && down[c] >= 0) acc[down[c]] += acc[c]; }
    const land = []; for (let c = 0; c < N; c++) if (!water[c]) land.push(acc[c]);
    land.sort((a, b) => a - b);
    const T0 = Math.max(150, land[Math.floor(land.length * 0.985)] || 150);
    // A hollow the land can't drain holds a lake if the country is wet enough, and is a dry pan
    // if it isn't. Either way a river that reaches it ends there instead of crossing it.
    const depth = Float32Array.from(filled, (f, c) => f - e[c]), hollow = new Uint8Array(N);
    for (let c = 0; c < N; c++) if (!water[c] && depth[c] > 0.02) hollow[c] = 1;
    const dry = new Set(['desert', 'saltflat', 'steppe', 'badlands', 'volcanic']);
    blobs(water, (c) => hollow[c] === 1, (cells) => {
      const wet = cells.filter((c) => !dry.has(BIOMES[biome[c]])).length > cells.length / 2;
      if (wet && cells.length >= 12 && cells.length <= 1500) for (const c of cells) if (depth[c] > 0.03) water[c] = 2;
    });
    const river = new Uint8Array(N);
    for (let c = 0; c < N; c++) if (!water[c] && !hollow[c] && acc[c] > T0) river[c] = 1;
    // trace each river from its source to where it meets the sea, a lake or a bigger river
    const into = new Uint16Array(N);
    for (let c = 0; c < N; c++) if (river[c] && down[c] >= 0 && river[down[c]]) into[down[c]]++;
    const lines = [], done = new Uint8Array(N);
    const sources = []; for (let c = 0; c < N; c++) if (river[c] && !into[c]) sources.push(c);
    sources.sort((a, b) => acc[b] - acc[a]);
    for (const src of sources) {
      const pts = [], ws = [];
      let c = src;
      for (let guard = 0; c >= 0 && guard < 4000; guard++) {
        pts.push([cx(c), cy(c)]); ws.push(acc[c]);
        if (done[c] || water[c] || hollow[c]) break;
        done[c] = 1;
        c = down[c];
      }
      if (pts.length > 4) lines.push({ pts, acc: ws, len: pts.length });
    }
    T.down = down; T.acc = acc; T.river = river; T.rivers = lines; T.riverT = T0; T.hollow = hollow;
  }

  // ---------------------------------------------------------------- settling the places

  function settle(s, T) {
    const { e, water, region, river, biome } = T;
    const sea = new Uint8Array(N); for (let c = 0; c < N; c++) sea[c] = water[c] === 1 ? 1 : 0;
    const coastD = distanceTo(sea), riverD = distanceTo(river);
    const edgeMask = new Uint8Array(N);
    for (let c = 0; c < N; c++) { if (water[c] || region[c] < 0) continue; eachNeighbor(c, (nb) => { if (!water[nb] && region[nb] !== region[c]) edgeMask[c] = 1; }); }
    const borderD = distanceTo(edgeMask);
    const cells = s.regions.map(() => []);
    for (let j = 1; j < GH - 1; j += 2) for (let i = 1; i < GW - 1; i += 2) { const c = idx(i, j); if (!water[c] && region[c] >= 0) cells[region[c]].push(c); }
    const centre = cells.map((cs) => { let x = 0, y = 0; for (const c of cs) { x += cx(c); y += cy(c); } return cs.length ? [x / cs.length, y / cs.length] : [W / 2, H / 2]; });
    const placed = [];
    const out = s.places.map((p) => {
      const k = s.regions.findIndex((g) => g.id === p.region), cs = cells[k] || [];
      const r = rng(s.seed ^ hash(p.id));
      let best = -1, bs = -1e9;
      for (const c of cs) {
        const h = e[c], x = cx(c), y = cy(c), steep = h > MOUNT;
        let sc = r() * 0.7;
        const nearRiver = riverD[c] < 3 ? 1 : riverD[c] < 7 ? 0.4 : 0;
        const nearCoast = coastD[c] < 3 ? 1 : coastD[c] < 8 ? 0.3 : 0;
        const toCentre = 1 - Math.min(1, Math.hypot(x - centre[k][0], y - centre[k][1]) / 260);
        if (river[c]) sc -= 3;
        switch (p.kind) {
          case 'capital': sc += 1.6 * toCentre + 1.1 * nearRiver + 0.6 * nearCoast - (steep ? 3 : 0); break;
          case 'city': sc += 1.1 * nearRiver + 0.9 * nearCoast + 0.3 * toCentre - (steep ? 3 : 0); break;
          case 'port': sc += 3 * (coastD[c] < 2.5 ? 1 : 0) + 0.4 * nearRiver - (steep ? 3 : 0); break;
          case 'town': sc += 0.7 * nearRiver + 0.5 * nearCoast - (steep ? 2 : 0); break;
          case 'village': sc += 0.4 * nearRiver - (steep ? 2 : 0); break;
          case 'fortress': sc += 1.3 * Math.min(1, Math.max(0, h - 0.2) * 3) + (borderD[c] < 8 ? 1 : 0); break;
          case 'temple': case 'tower': sc += 1.1 * Math.min(1, Math.max(0, h - 0.25) * 3) + 0.4 * (1 - toCentre); break;
          case 'mine': sc += h > HILL ? 2 : 0; break;
          case 'ruin': case 'camp': case 'wreck': sc += 0.5 * (1 - toCentre); break;
          default: break;
        }
        if (p.near === 'coast') sc += 2 * (coastD[c] < 2.5 ? 1 : 0);
        if (p.near === 'river') sc += 2 * nearRiver;
        if (p.near === 'mountains') sc += 2 * (h > HILL ? 1 : 0);
        if (p.near === 'center') sc += 2 * toCentre;
        if (p.near === 'border') sc += borderD[c] < 6 ? 2 : 0;
        if (p.near === 'edge') sc += 1.5 * (1 - toCentre);
        let crowd = 0;
        for (const q of placed) { const d = Math.hypot(q.x - x, q.y - y); if (d < 70) crowd += (70 - d) / 70; }
        sc -= 3 * crowd;
        if (sc > bs) { bs = sc; best = c; }
      }
      if (best < 0) return null;
      const pos = { id: p.id, x: cx(best) + (r() - 0.5) * 2, y: cy(best) + (r() - 0.5) * 2, cell: best, kind: p.kind, name: p.name, region: p.region, entity: p.entity };
      placed.push(pos);
      return pos;
    }).filter(Boolean);
    return { places: out, coastD, borderD };
  }

  // Roads join each region's places, and each region's chief place to its neighbours'.
  function roads(s, T, places) {
    const { e, water, region } = T, G = 2, gw = GW / G, gh = GH / G, n = gw * gh;
    const cost = new Float32Array(n);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const c = idx(i * G, j * G), h = e[c];
      cost[j * gw + i] = water[c] ? Infinity : 1 + (h > MOUNT ? 6 : h > HILL ? 1.5 : 0) + (T.river[c] ? 2.5 : 0);
    }
    const node = (p) => Math.floor(p.y / CELL / G) * gw + Math.floor(p.x / CELL / G);
    function path(a, b) {
      const g = new Float32Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), q = heap(), bx = b % gw, by = Math.floor(b / gw);
      g[a] = 0; q.push(0, a);
      let steps = 0;
      while (q.size && steps++ < 60000) {
        const c = q.pop();
        if (c === b) break;
        const i = c % gw, j = (c - i) / gw;
        for (const [di, dj, d] of N8) {
          const x = i + di, y = j + dj; if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
          const nb = y * gw + x, w = cost[nb]; if (w === Infinity) continue;
          const ng = g[c] + d * (w + 12 * Math.abs(e[idx(x * G, y * G)] - e[idx(i * G, j * G)]));
          if (ng < g[nb]) { g[nb] = ng; from[nb] = c; q.push(ng + Math.hypot(x - bx, y - by), nb); }
        }
      }
      if (from[b] < 0 && a !== b) return null;
      const pts = []; for (let c = b; c >= 0; c = from[c]) { pts.push([((c % gw) + 0.5) * G * CELL, (Math.floor(c / gw) + 0.5) * G * CELL]); if (c === a) break; }
      return pts.reverse();
    }
    const linked = [], pairs = [];
    const roaded = places.filter((p) => !['ruin', 'camp', 'landmark', 'wreck'].includes(p.kind));
    for (const g of s.regions) {
      const ps = roaded.filter((p) => p.region === g.id);
      // a spanning tree over the region's places
      const inTree = ps.length ? [ps[0]] : [];
      while (inTree.length < ps.length) {
        let best = null, bd = Infinity;
        for (const a of inTree) for (const b of ps) { if (inTree.includes(b)) continue; const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < bd) { bd = d; best = [a, b]; } }
        inTree.push(best[1]); pairs.push(best);
      }
    }
    const chief = (id) => roaded.find((p) => p.region === id && p.kind === 'capital') || roaded.find((p) => p.region === id && p.kind === 'city') || roaded.find((p) => p.region === id);
    const touching = new Set();
    for (let c = 0; c < N; c += 1) { if (T.water[c] || region[c] < 0) continue; const i = c % GW; if (i < GW - 1 && !T.water[c + 1] && region[c + 1] >= 0 && region[c + 1] !== region[c]) touching.add(Math.min(region[c], region[c + 1]) + ':' + Math.max(region[c], region[c + 1])); }
    for (const key of touching) {
      const [a, b] = key.split(':').map(Number), pa = chief(s.regions[a].id), pb = chief(s.regions[b].id);
      if (pa && pb) pairs.push([pa, pb]);
    }
    for (const [a, b] of pairs.slice(0, 80)) {
      const p = path(node(a), node(b));
      if (p && p.length > 1) { p[0] = [a.x, a.y]; p[p.length - 1] = [b.x, b.y]; linked.push(chaikin(simplify(p, 3), false, 2)); }
    }
    return linked;
  }
  function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    let far = -1, fd = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      const d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L;
      if (d > fd) { fd = d; far = i; }
    }
    if (fd <= eps) return [a, b];
    return simplify(pts.slice(0, far + 1), eps).slice(0, -1).concat(simplify(pts.slice(far), eps));
  }

  // ---------------------------------------------------------------- drawing

  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // A mountain in the old manner: two slopes meeting at a peak, the eastern face hatched.
  function mountain(x, y, h, r, snow, crater) {
    const w = h * (1.2 + r() * 0.35), dx = (r() - 0.5) * w * 0.22, top = [x + dx, y - h];
    const L = [x - w / 2, y], R = [x + w / 2, y];
    const bend = (p, q, k) => [(p[0] + q[0]) / 2 + k * (q[1] - p[1]) * 0.08, (p[1] + q[1]) / 2 - k * (q[0] - p[0]) * 0.08];
    const lm = bend(L, top, 1), rm = bend(top, R, 1);
    const peak = crater ? `L${f1(top[0] - w * 0.08)} ${f1(top[1] + h * 0.06)}L${f1(top[0] + w * 0.08)} ${f1(top[1] + h * 0.06)}` : `L${f1(top[0])} ${f1(top[1])}`;
    const outline = `M${f1(L[0])} ${f1(L[1])}Q${f1(lm[0])} ${f1(lm[1])} ${f1(top[0] - (crater ? w * 0.08 : 0))} ${f1(top[1] + (crater ? h * 0.06 : 0))}`
      + (crater ? `L${f1(top[0] + w * 0.08)} ${f1(top[1] + h * 0.06)}` : '') + `Q${f1(rm[0])} ${f1(rm[1])} ${f1(R[0])} ${f1(R[1])}`;
    let hatch = '';
    const n = 3 + Math.floor(h / 7), start = snow ? 0.32 : 0.12;
    for (let k = 0; k < n; k++) {
      const t = start + ((1 - start) * (k + 0.5)) / n, p = [top[0] + (R[0] - top[0]) * t, top[1] + (R[1] - top[1]) * t];
      const len = h * 0.55 * (1 - t * 0.55);
      hatch += `M${f1(p[0] - 0.8)} ${f1(p[1] + 0.6)}l${f1(-len * 0.32)} ${f1(len * 0.62)}`;
    }
    let cap = '';
    if (snow) {
      const a = [top[0] + (L[0] - top[0]) * 0.3, top[1] + (L[1] - top[1]) * 0.3], b = [top[0] + (R[0] - top[0]) * 0.3, top[1] + (R[1] - top[1]) * 0.3];
      cap = `M${f1(a[0])} ${f1(a[1])}l${f1((b[0] - a[0]) * 0.25)} ${f1(h * 0.07)}l${f1((b[0] - a[0]) * 0.25)} ${f1(-h * 0.06)}l${f1((b[0] - a[0]) * 0.25)} ${f1(h * 0.07)}L${f1(b[0])} ${f1(b[1])}`;
    }
    const fill = outline + `L${f1(L[0])} ${f1(L[1])}Z`;
    return { fill, outline, hatch, cap, top };
  }
  function hill(x, y, w, r) {
    const h = w * (0.38 + r() * 0.12);
    return { outline: `M${f1(x - w / 2)} ${f1(y)}Q${f1(x)} ${f1(y - h * 2)} ${f1(x + w / 2)} ${f1(y)}`, hatch: `M${f1(x + w * 0.16)} ${f1(y - h * 0.45)}l${f1(w * 0.08)} ${f1(h * 0.4)}M${f1(x + w * 0.3)} ${f1(y - h * 0.25)}l${f1(w * 0.06)} ${f1(h * 0.24)}` };
  }
  function tree(x, y, kind, r) {
    if (kind === 'taiga') {
      const h = 7 + r() * 3.5, w = h * 0.52;
      return { body: `M${f1(x)} ${f1(y - h)}L${f1(x + w * 0.3)} ${f1(y - h * 0.62)}L${f1(x + w * 0.18)} ${f1(y - h * 0.62)}L${f1(x + w / 2)} ${f1(y - 1.6)}L${f1(x - w / 2)} ${f1(y - 1.6)}L${f1(x - w * 0.18)} ${f1(y - h * 0.62)}L${f1(x - w * 0.3)} ${f1(y - h * 0.62)}Z`, trunk: `M${f1(x)} ${f1(y - 1.6)}v2.2`, shade: '' };
    }
    if (kind === 'jungle') {
      // a broad crown of three lobes
      const w = 4.2 + r() * 1.6, b = y - 2.4;
      return {
        body: `M${f1(x - w)} ${f1(b)}A${f1(w * 0.48)} ${f1(w * 0.48)} 0 0 1 ${f1(x - w * 0.42)} ${f1(b - w * 0.9)}A${f1(w * 0.55)} ${f1(w * 0.55)} 0 0 1 ${f1(x + w * 0.45)} ${f1(b - w * 0.85)}A${f1(w * 0.5)} ${f1(w * 0.5)} 0 0 1 ${f1(x + w)} ${f1(b)}Z`,
        trunk: `M${f1(x)} ${f1(b)}v2.6`, shade: `M${f1(x + w * 0.55)} ${f1(b - w * 0.6)}q${f1(w * 0.25)} ${f1(w * 0.3)} 0 ${f1(w * 0.55)}`,
      };
    }
    // a round-headed tree on a short trunk, shaded on its eastern side
    const rx = 2.6 + r() * 1.1, ry = rx * (1.05 + r() * 0.15), cy0 = y - ry - 2.2;
    return {
      body: `M${f1(x - rx)} ${f1(cy0)}A${f1(rx)} ${f1(ry)} 0 1 1 ${f1(x + rx)} ${f1(cy0)}A${f1(rx)} ${f1(ry)} 0 1 1 ${f1(x - rx)} ${f1(cy0)}Z`,
      trunk: `M${f1(x)} ${f1(cy0 + ry)}v2.4`, shade: `M${f1(x + rx * 0.45)} ${f1(cy0 - ry * 0.45)}q${f1(rx * 0.4)} ${f1(ry * 0.45)} 0 ${f1(ry * 0.9)}`,
    };
  }
  // Icons for places, drawn around (0, 0) and placed with a transform.
  const ICON = {
    capital: 'M-9 4V-3H-6V-7H-4V-5H-2V-9H0V-11L4 -9.5L0 -8V-5H2V-7H4V-3H6V4Z',
    city: 'M-7 4V-4H-4V-8H-1V-2H1V-6H4V-1H7V4Z',
    town: 'M-6 4V-1L-3.5 -4L-1 -1V4ZM0 4V-2L3 -5L6 -2V4Z',
    village: 'M-3 4V0L0 -3L3 0V4Z',
    port: 'M-5 1V-3L-2.5 -5.5L0 -3V1ZM1 3Q4.5 5.5 8 3ZM4.5 3V-4L7.5 1Z',
    fortress: 'M-6 4V-5H-4.5V-7H-3V-5H-1V-7H1V-5H3V-7H4.5V-5H6V4Z',
    ruin: 'M-6 4V-4L-4.5 -6L-3 -3V4ZM-1 4V-2L1 -4L2 -1V4ZM3.5 4V-5.5L5 -4L6 -6V4Z',
    temple: 'M-6 4V0H6V4ZM-4.5 0A4.5 4.5 0 0 1 4.5 0ZM0 -4.5V-8',
    tower: 'M-2.2 4V-6H2.2V4ZM-3 -6L0 -10L3 -6Z',
    mine: 'M-5 4L5 -6M-5 -6L5 4M-6.5 -4.5L-3.5 -7.5M3.5 -7.5L6.5 -4.5',
    camp: 'M-6 4L0 -5L6 4ZM0 -5L0 4',
    landmark: 'M0 -7L1.8 -2.2L6.7 -2.2L2.8 0.9L4.2 5.7L0 2.8L-4.2 5.7L-2.8 0.9L-6.7 -2.2L-1.8 -2.2Z',
    wreck: 'M-8 1Q-6 5 1 4.5L7 0.5L-7 -1.5ZM-1.5 0L1.5 -9.5M1.5 -9.5L5.5 -4.5L0.5 -3.5',
  };
  const LABEL = { capital: [17, 700, 1], city: [14.5, 500, 1], port: [13, 400, 2], town: [13, 400, 2], fortress: [12.5, 400, 2], village: [11.5, 400, 3], ruin: [11.5, 400, 3, 1], temple: [11.5, 400, 3, 1], tower: [11.5, 400, 3, 1], mine: [11, 400, 3, 1], camp: [11, 400, 3, 1], wreck: [11, 400, 3, 1], landmark: [12, 400, 2, 1] };
  const width = (str, size, caps, spacing) => str.length * size * (caps ? 0.68 : 0.47) + Math.max(0, str.length - 1) * (spacing || 0);

  // Lay out a world: its terrain, settled places, roads and where every name goes.
  function layout(spec) {
    const s = normalizeAtlas(spec, 1);
    const T = terrain(s);
    const { places, coastD } = settle(s, T);
    return { s, T, places, coastD, roads: roads(s, T, places) };
  }

  function paint(spec, opts) {
    opts = opts || {};
    const { s, T, places, coastD, roads: ways } = layout(spec);
    const uid = 'm' + String(opts.id || (s.seed % 1e6).toString(36)).replace(/[^A-Za-z0-9_-]/g, '_') + '_';
    const r = rng(s.seed + 1000), accent = s.accent;
    const { e, water, region, biome } = T;
    const defs = [], out = [];
    defs.push(`<filter id="${uid}ink" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="${s.seed % 997}"/><feDisplacementMap in="SourceGraphic" scale="2.2"/></filter>`);
    defs.push(`<filter id="${uid}paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${(s.seed * 7) % 997}"/><feColorMatrix values="0 0 0 0 0.35 0 0 0 0 0.29 0 0 0 0 0.2 0 0 0 0.13 0"/></filter>`);
    defs.push(`<radialGradient id="${uid}vig" cx="0.5" cy="0.5" r="0.75"><stop offset="0.62" stop-color="#5a4527" stop-opacity="0"/><stop offset="1" stop-color="#5a4527" stop-opacity="0.2"/></radialGradient>`);

    // sea, its ripples along every shore, then the land
    out.push(`<rect width="${W}" height="${H}" fill="${SEA}"/>`);
    const fromLand = distanceTo(Uint8Array.from(water, (w) => (w === 1 ? 0 : 1)));
    const ripples = [[1.6, 0.9, 0.55], [3.4, 0.75, 0.4], [6, 0.65, 0.27], [9.5, 0.55, 0.16]];
    for (const [lv, sw, op] of ripples) {
      const d = contours(fromLand, lv, 0).filter((l) => l.pts.length > 6).map((l) => roughPath(smooth(l, 0.8, 1), l.closed)).join('');
      out.push(`<path d="${d}" fill="none" stroke="${WATER}" stroke-width="${sw}" stroke-opacity="${op}"/>`);
    }
    const landF = Float32Array.from(e, (v, c) => (water[c] ? Math.min(-0.002, v < 0 ? v : -0.02) : Math.max(0.002, v)));
    const coast = contours(landF, 0, -1).map((l) => ({ pts: smooth(l, 0.35, 2), closed: l.closed }));
    out.push(`<path d="${coast.map((l) => pathOf(l.pts, l.closed)).join('')}" fill="${LAND}" fill-rule="evenodd"/>`);
    // lakes ripple inwards from their shores
    const lakeD = distanceTo(Uint8Array.from(water, (w) => (w === 2 ? 0 : 1)));
    out.push(`<path d="${contours(lakeD, 1.7, 0).map((l) => roughPath(smooth(l, 0.8, 1), l.closed)).join('')}" fill="none" stroke="${WATER}" stroke-width="0.7" stroke-opacity="0.45"/>`);

    // the ground's textures, kind by kind
    const tex = { grass: '', dots: '', dunes: '', marsh: '', cracks: '', snow: '', bad: '', ash: '' };
    const step = 11;
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
      const px = x + (r() - 0.5) * step * 0.9, py = y + (r() - 0.5) * step * 0.9, c = cellAt(px, py);
      if (water[c] || e[c] > HILL || T.river[c]) continue;
      const b = BIOMES[biome[c]], k = r();
      if (b === 'grassland' && k < 0.12) tex.grass += `M${f1(px - 2)} ${f1(py)}q0.6 -2.6 1.4 -3.8M${f1(px)} ${f1(py)}v-3.4M${f1(px + 2)} ${f1(py)}q-0.6 -2.6 -1.4 -3.8`;
      else if (b === 'steppe' && k < 0.2) tex.grass += `M${f1(px - 1.5)} ${f1(py)}l0.8 -2.8M${f1(px + 1)} ${f1(py)}l-0.4 -2.6`;
      else if (b === 'desert') { if (k < 0.55) tex.dots += `M${f1(px)} ${f1(py)}h0.1`; if (k < 0.08) tex.dunes += `M${f1(px - 7)} ${f1(py)}q7 -5 14 0`; }
      else if (b === 'saltflat' && k < 0.5) { const a = r() * Math.PI; tex.cracks += `M${f1(px)} ${f1(py)}l${f1(Math.cos(a) * 4)} ${f1(Math.sin(a) * 4)}l${f1(Math.cos(a + 1.2) * 3)} ${f1(Math.sin(a + 1.2) * 3)}`; }
      else if (b === 'marsh' && k < 0.35) tex.marsh += `M${f1(px - 2.2)} ${f1(py)}l0.9 -3.5M${f1(px)} ${f1(py)}v-4.2M${f1(px + 2.2)} ${f1(py)}l-0.9 -3.5M${f1(px - 4)} ${f1(py + 1.6)}h8`;
      else if (b === 'tundra' && k < 0.3) tex.snow += `M${f1(px - 3)} ${f1(py)}h6M${f1(px - 1)} ${f1(py + 2)}h3`;
      else if (b === 'badlands' && k < 0.3) tex.bad += `M${f1(px)} ${f1(py)}l2.4 -5M${f1(px + 2)} ${f1(py)}l2.4 -5M${f1(px + 4)} ${f1(py)}l2.4 -5`;
      else if (b === 'volcanic' && k < 0.6) tex.ash += `M${f1(px)} ${f1(py)}h0.1`;
    }
    out.push(`<g fill="none" stroke="${INK}" stroke-linecap="round">`
      + `<path d="${tex.grass}" stroke-width="0.6" stroke-opacity="0.45"/>`
      + `<path d="${tex.dots}" stroke-width="1.3" stroke-opacity="0.4"/>`
      + `<path d="${tex.dunes}" stroke-width="0.7" stroke-opacity="0.4"/>`
      + `<path d="${tex.cracks}" stroke-width="0.6" stroke-opacity="0.32"/>`
      + `<path d="${tex.marsh}" stroke-width="0.6" stroke-opacity="0.5"/>`
      + `<path d="${tex.snow}" stroke="${WATER}" stroke-width="0.7" stroke-opacity="0.4"/>`
      + `<path d="${tex.bad}" stroke-width="0.6" stroke-opacity="0.4"/>`
      + `<path d="${tex.ash}" stroke-width="1.6" stroke-opacity="0.5"/></g>`);

    // rivers, widening as they gather water, drawn as tapered shapes
    let rivers = '';
    for (const rv of T.rivers) {
      const pts = chaikin(rv.pts, false, 3), n = pts.length;
      const wAt = (i) => 0.6 + 2.6 * Math.sqrt(rv.acc[Math.min(rv.acc.length - 1, Math.floor((i / n) * rv.acc.length))] / T.riverT) * 0.45;
      const left = [], right = [];
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, w = Math.min(4.2, wAt(i)) / 2;
        left.push([pts[i][0] - (dy / L) * w, pts[i][1] + (dx / L) * w]); right.push([pts[i][0] + (dy / L) * w, pts[i][1] - (dx / L) * w]);
      }
      rivers += pathOf(left.concat(right.reverse()), true);
    }
    out.push(`<path d="${rivers}" fill="${WATER}" fill-opacity="0.85" filter="url(#${uid}ink)"/>`);
    // the coast, inked
    const shore = coast.map((l) => l.pts.filter((p) => p[0] > 2 && p[0] < W - 2 && p[1] > 2 && p[1] < H - 2)).filter((p) => p.length > 1);
    out.push(`<path d="${shore.map((p) => pathOf(p, false)).join('')}" fill="none" stroke="${INK}" stroke-width="1.7" stroke-linejoin="round" filter="url(#${uid}ink)"/>`);

    // a basin's old shore, where the water stood: a line of cliffs hachured downhill
    if (s.shape === 'basin') {
      let cliff = '', ticks = '';
      // only the stretches well inland and long enough to be a shore, split where they leave off
      const runs = [];
      for (const l of contours(e, 0.135, -1)) {
        if (lineLen(l.pts) < 120) continue;
        let run = [];
        for (const p of smooth(l, 1, 2)) {
          if (coastD[cellAt(p[0], p[1])] > 16 && !water[cellAt(p[0], p[1])]) run.push(p);
          else { if (run.length > 10) runs.push(run); run = []; }
        }
        if (run.length > 10) runs.push(run);
      }
      for (const pts of runs) {
        cliff += pathOf(pts, false);
        for (let i = 1; i < pts.length - 1; i += 2) {
          const [x, y] = pts[i], dx = pts[i + 1][0] - pts[i - 1][0], dy = pts[i + 1][1] - pts[i - 1][1], L = Math.hypot(dx, dy) || 1;
          let nx = -dy / L, ny = dx / L;
          if (e[cellAt(x + nx * 5, y + ny * 5)] > e[cellAt(x - nx * 5, y - ny * 5)]) { nx = -nx; ny = -ny; }
          ticks += `M${f1(x)} ${f1(y)}l${f1(nx * 5)} ${f1(ny * 5)}`;
        }
      }
      out.push(`<path d="${cliff}" fill="none" stroke="${INK}" stroke-width="1.1" stroke-opacity="0.7"/><path d="${ticks}" stroke="${INK}" stroke-width="0.6" stroke-opacity="0.55"/>`);
    }
    // borders between regions, with a wash of the accent along them
    const segs = [];
    for (let c = 0; c < N; c++) {
      if (water[c] || region[c] < 0) continue;
      const i = c % GW, j = (c - i) / GW, x0 = i * CELL, y0 = j * CELL;
      if (i < GW - 1 && !water[c + 1] && region[c + 1] >= 0 && region[c + 1] !== region[c]) segs.push([[x0 + CELL, y0], [x0 + CELL, y0 + CELL]]);
      if (j < GH - 1 && !water[c + GW] && region[c + GW] >= 0 && region[c + GW] !== region[c]) segs.push([[x0, y0 + CELL], [x0 + CELL, y0 + CELL]]);
    }
    const borders = chain(segs).filter((l) => l.pts.length > 3).map((l) => pathOf(chaikin(simplify(l.pts, 1.2), l.closed, 3), l.closed)).join('');
    out.push(`<path d="${borders}" fill="none" stroke="${accent}" stroke-width="6" stroke-opacity="0.16" stroke-linejoin="round"/>`);
    out.push(`<path d="${borders}" fill="none" stroke="${INK}" stroke-width="1" stroke-opacity="0.6" stroke-dasharray="7 3 1.5 3"/>`);
    // roads
    out.push(`<path d="${ways.map((p) => pathOf(p, false)).join('')}" fill="none" stroke="${INK}" stroke-width="1" stroke-opacity="0.42" stroke-dasharray="3 3.5" stroke-linecap="round"/>`);

    // woods: a faint shade over the whole wood first
    const woods = noise(s.seed + 313), wooded = (c) => {
      const b = BIOMES[biome[c]];
      return !water[c] && e[c] < MOUNT && (b === 'forest' || b === 'taiga' || b === 'jungle') && fbm(woods, cx(c) / 70, cy(c) / 70, 3) >= (b === 'jungle' ? -0.25 : -0.12);
    };
    const woodMask = new Float32Array(N); for (let c = 0; c < N; c++) woodMask[c] = wooded(c) ? 1 : 0;
    out.push(`<path d="${contours(woodMask, 0.5, 0).filter((l) => l.pts.length > 10).map((l) => roughPath(smooth(l, 1, 2), l.closed)).join('')}" fill="${INK}" fill-opacity="0.05"/>`);
    // woods and mountains, back to front, so nearer ones overlap farther ones
    const sprites = [];
    const avoid = places.map((p) => [p.x, p.y]);
    const clear = (x, y, d) => avoid.every(([ax, ay]) => Math.abs(ax - x) > d || Math.abs(ay - y) > d);
    for (let y = 4; y < H; y += 8) for (let x = 4; x < W; x += 8) {
      const px = x + (r() - 0.5) * 6, py = y + (r() - 0.5) * 6, c = cellAt(px, py);
      if (water[c] || T.river[c] || e[c] > MOUNT) continue;
      const b = BIOMES[biome[c]];
      if (!wooded(c) || r() < (b === 'jungle' ? 0.55 : 0.42) || !clear(px, py, 13)) continue;
      if (e[c] > HILL && b !== 'taiga') continue;
      sprites.push({ y: py, kind: 'tree', t: tree(px, py, b, r) });
    }
    const snowy = s.climate === 'cold' ? HILL + 0.08 : s.climate === 'hot' ? 2 : PEAK;
    for (let y = 6; y < H; y += 13) for (let x = 6; x < W; x += 15) {
      const px = x + (r() - 0.5) * 10, py = y + (r() - 0.5) * 8, c = cellAt(px, py), h = e[c];
      if (water[c] || h < HILL || !clear(px, py, 16)) continue;
      const volcanic = BIOMES[biome[c]] === 'volcanic';
      if (h < MOUNT) { if (r() < 0.4) sprites.push({ y: py, kind: 'hill', t: hill(px, py, 14 + r() * 6, r) }); continue; }
      sprites.push({ y: py, kind: 'mount', t: mountain(px, py, 14 + Math.min(1, (h - MOUNT) / 0.4) * 22 + r() * 5, r, h > snowy, volcanic && h > PEAK && r() < 0.4) });
    }
    for (const f of T.shaped) if (f.kind === 'volcano') { const px = f.x * W, py = f.y * H + 14; sprites.push({ y: py, kind: 'mount', t: mountain(px, py, 40, r, false, true), smoke: true }); }
    sprites.sort((a, b) => a.y - b.y);
    let row = [], rowY = -1;
    const flush = () => {
      if (!row.length) return;
      out.push(`<path d="${row.map((t) => t.body).join('')}" fill="${LAND}" stroke="${INK}" stroke-width="0.75" stroke-opacity="0.85"/><path d="${row.map((t) => t.trunk + t.shade).join('')}" fill="none" stroke="${INK}" stroke-width="0.65" stroke-opacity="0.75"/>`);
      row = [];
    };
    for (const sp of sprites) {
      if (sp.kind === 'tree') { if (sp.y - rowY > 6) { flush(); rowY = sp.y; } row.push(sp.t); continue; }
      flush();
      if (sp.kind === 'hill') out.push(`<path d="${sp.t.outline}" fill="none" stroke="${INK}" stroke-width="0.9" stroke-opacity="0.75"/><path d="${sp.t.hatch}" stroke="${INK}" stroke-width="0.6" stroke-opacity="0.6"/>`);
      else {
        const t = sp.t;
        out.push(`<path d="${t.fill}" fill="${LAND}"/><path d="${t.hatch}" stroke="${INK}" stroke-width="0.6" stroke-opacity="0.75"/><path d="${t.outline}" fill="none" stroke="${INK}" stroke-width="1.15" stroke-linejoin="round"/>`
          + (t.cap ? `<path d="${t.cap}" fill="none" stroke="${INK}" stroke-width="0.7"/>` : '')
          + (sp.smoke ? `<path d="M${f1(t.top[0])} ${f1(t.top[1] - 3)}q-6 -8 0 -14q6 -6 0 -14" fill="none" stroke="${accent}" stroke-width="1.4" stroke-opacity="0.7" stroke-linecap="round"/>` : ''));
      }
    }
    flush();
    // chasms: a long black split in the ground, its lips hatched
    for (const f of T.shaped) if (f.kind === 'chasm') {
      const n = 22, ang = r() * Math.PI, len = 260, top = [], bot = [];
      let hatch = '';
      for (let k = 0; k <= n; k++) {
        const t = k / n, x = f.x * W + Math.cos(ang) * (t - 0.5) * len + (r() - 0.5) * 6, y = f.y * H + Math.sin(ang) * (t - 0.5) * len + (r() - 0.5) * 6;
        const w = 0.6 + 6.5 * Math.sin(Math.PI * t) ** 0.8 * (0.75 + r() * 0.5), nx = -Math.sin(ang), ny = Math.cos(ang);
        top.push([x + nx * w, y + ny * w]); bot.push([x - nx * w, y - ny * w]);
        if (k % 2 === 0 && k && k < n) hatch += `M${f1(x + nx * (w + 1))} ${f1(y + ny * (w + 1))}l${f1(nx * 4)} ${f1(ny * 4)}M${f1(x - nx * (w + 1))} ${f1(y - ny * (w + 1))}l${f1(-nx * 4)} ${f1(-ny * 4)}`;
      }
      out.push(`<path d="${pathOf(top.concat(bot.reverse()), true)}" fill="${INK}"/><path d="${hatch}" stroke="${INK}" stroke-width="0.7" stroke-opacity="0.7"/>`);
      f.labelAt = [f.x * W, f.y * H + 22];
    }

    // places, each with a clear patch so its icon reads
    const boxes = [];
    let icons = '';
    for (const p of places) {
      const sc = p.kind === 'capital' ? 1.25 : p.kind === 'city' ? 1.1 : 1;
      icons += `<g class="atlas-place" data-id="${esc(p.id)}"${p.entity ? ` data-entity="${esc(p.entity)}"` : ''} transform="translate(${f1(p.x)} ${f1(p.y)}) scale(${sc})">`
        + `<path d="${ICON[p.kind]}" fill="${LAND}" stroke="${LAND}" stroke-width="4" stroke-linejoin="round"/>`
        + `<path d="${ICON[p.kind]}" fill="${p.kind === 'landmark' ? accent : LAND}" stroke="${INK}" stroke-width="1.05" stroke-linejoin="round"/>`
        + (p.kind === 'capital' ? `<path d="M0 -11L4 -9.5L0 -8Z" fill="${accent}"/>` : '') + '</g>';
      boxes.push([p.x - 9 * sc, p.y - 11 * sc, p.x + 9 * sc, p.y + 5 * sc]);
    }
    const deco = decorations(s, T, accent);
    boxes.push(...deco.boxes);
    const hit = (b) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) || b[0] < 24 || b[1] < 24 || b[2] > W - 24 || b[3] > H - 24;

    // names: chief places first, then regions, seas, lesser places and features
    const labels = [];
    const rank = (k) => ['capital', 'city', 'port', 'town', 'fortress', 'landmark', 'village', 'temple', 'tower', 'ruin', 'wreck', 'mine', 'camp'].indexOf(k);
    const nameOf = (p) => {
      const [size, weight, lod, italic] = LABEL[p.kind], wd = width(p.name, size, false, 0);
      const tries = [[10, 4, 'start'], [-10, 4, 'end'], [0, -14, 'middle'], [0, 18, 'middle'], [9, -8, 'start'], [-9, -8, 'end'], [9, 14, 'start'], [-9, 14, 'end']];
      let chosen = null;
      for (const t of tries) {
        const x = p.x + t[0], y = p.y + t[1], x0 = t[2] === 'start' ? x : t[2] === 'end' ? x - wd : x - wd / 2;
        const b = [x0 - 2, y - size * 0.8, x0 + wd + 2, y + size * 0.25];
        if (!hit(b)) { chosen = t; boxes.push(b); break; }
      }
      // a capital or a city is always named; a lesser place that can't fit waits for a closer look
      const t = chosen || tries[0], x = p.x + t[0], y = p.y + t[1];
      if (!chosen && lod === 1) { const x0 = t[2] === 'start' ? x : x - wd; boxes.push([x0, y - size * 0.8, x0 + wd, y + size * 0.25]); }
      labels.push(`<text class="lbl l${chosen || lod === 1 ? lod : 3}" x="${f1(x)}" y="${f1(y)}" font-size="${size}" font-weight="${weight}"${italic ? ' font-style="italic"' : ''} text-anchor="${t[2]}" fill="${INK}">${esc(p.name)}</text>`);
    };
    const byRank = places.slice().sort((a, b) => rank(a.kind) - rank(b.kind));
    const chief = byRank.filter((p) => p.kind === 'capital' || p.kind === 'city'), minor = byRank.filter((p) => !chief.includes(p));
    for (const p of chief) nameOf(p);
    const regionCells = s.regions.map(() => []);
    for (let c = 0; c < N; c++) if (!water[c] && region[c] >= 0) regionCells[region[c]].push(c);
    const edges = new Uint8Array(N);
    for (let c = 0; c < N; c++) { if (water[c] || region[c] < 0) { edges[c] = 1; continue; } eachNeighbor(c, (nb) => { if (region[nb] !== region[c]) edges[c] = 1; }); }
    const fromEdge = distanceTo(edges);
    s.regions.forEach((g, k) => {
      const cs = regionCells[k];
      if (!cs.length) return;
      let mx = 0, my = 0; for (const c of cs) { mx += cx(c); my += cy(c); } mx /= cs.length; my /= cs.length;
      let sxx = 0, sxy = 0, syy = 0; for (const c of cs) { const dx = cx(c) - mx, dy = cy(c) - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
      let ang = (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      ang = Math.max(-14, Math.min(14, ang));
      const size = Math.max(15, Math.min(30, 9 + Math.sqrt(cs.length) * 0.16)), name = g.name.toUpperCase(), sp = size * 0.26;
      const wd = width(name, size, true, sp);
      // the deepest point of the region that leaves the whole name on land and on the page
      const ranked = cs.filter((c, i) => i % 3 === 0).sort((a, b) => fromEdge[b] - fromEdge[a] + 0.002 * (Math.hypot(cx(a) - mx, cy(a) - my) - Math.hypot(cx(b) - mx, cy(b) - my)));
      let at = null;
      for (const c of ranked.slice(0, 120)) {
        const x = Math.max(wd / 2 + 30, Math.min(W - wd / 2 - 30, cx(c))), y = cy(c) + size * 0.3;
        const b = [x - wd / 2, y - size * 0.8, x + wd / 2, y + size * 0.3];
        if (!hit(b)) { at = [x, y, b]; break; }
      }
      if (!at) { const c = ranked[0], x = Math.max(wd / 2 + 30, Math.min(W - wd / 2 - 30, cx(c))), y = cy(c); at = [x, y, [x - wd / 2, y - size * 0.8, x + wd / 2, y + size * 0.3]]; }
      const [x, y, b] = at;
      labels.push(`<text class="lbl l1 atlas-region-name" x="${f1(x)}" y="${f1(y)}" transform="rotate(${f1(ang)} ${f1(x)} ${f1(y)})" font-size="${f1(size)}" letter-spacing="${f1(sp)}" text-anchor="middle" fill="${INK}" fill-opacity="0.72">${esc(name)}</text>`);
      boxes.push(b);
    });
    // seas: the open water farthest from any shore, on the side each sea is said to lie
    for (const sea of s.seas) {
      const [ax, ay] = AT[sea.at], size = 22, wd = width(sea.name, size, false, 3) * 1.1;
      let best = null, bs = -Infinity;
      for (let c = 0; c < N; c += 3) {
        const x = cx(c), y = cy(c);
        if (water[c] !== 1 || x < wd / 2 + 40 || x > W - wd / 2 - 40 || y < 70 || y > H - 50) continue;
        const b = [x - wd / 2, y - size * 0.8, x + wd / 2, y + size * 0.3];
        const score = Math.min(fromLand[c], 14) - Math.hypot(x / W - ax, y / H - ay) * 40;
        if (score > bs && !hit(b)) { bs = score; best = [x, y, b]; }
      }
      if (!best) continue;
      boxes.push(best[2]);
      labels.push(`<text class="lbl l1" x="${f1(best[0])}" y="${f1(best[1])}" font-size="${size}" font-style="italic" letter-spacing="3" text-anchor="middle" fill="${WATER}" fill-opacity="0.8">${esc(sea.name)}</text>`);
    }
    // named features, in italic, near what they name
    for (const f of T.shaped) {
      const x = f.labelAt ? f.labelAt[0] : f.kind === 'range' ? ((f.x0 + f.x1) / 2) * W : f.x * W, y = f.labelAt ? f.labelAt[1] : (f.kind === 'range' ? ((f.y0 + f.y1) / 2) * H : f.y * H) + (f.kind === 'volcano' ? 32 : 0);
      const size = f.kind === 'range' ? 14 : 13, wd = width(f.f.name, size, false, 1.5);
      const b = [x - wd / 2, y - size, x + wd / 2, y + 4];
      if (hit(b)) continue;
      boxes.push(b);
      labels.push(`<text class="lbl l2" x="${f1(x)}" y="${f1(y)}" font-size="${size}" font-style="italic" letter-spacing="1.5" text-anchor="middle" fill="${f.kind === 'lake' ? WATER : INK}" fill-opacity="0.8">${esc(f.f.name)}</text>`);
    }
    // the largest river of a region carries the name of the region's river feature
    for (const f of s.features.filter((x) => x.kind === 'river')) {
      const k = s.regions.findIndex((g) => g.id === f.region);
      const rv = T.rivers.filter((v) => v.pts.some(([x, y]) => region[cellAt(x, y)] === k)).sort((a, b) => b.len - a.len)[0];
      if (!rv) continue;
      const m = rv.pts[Math.floor(rv.pts.length * 0.45)], b = [m[0] - 40, m[1] - 18, m[0] + 40, m[1] - 4];
      if (hit(b)) continue;
      boxes.push(b);
      labels.push(`<text class="lbl l2" x="${f1(m[0])}" y="${f1(m[1] - 7)}" font-size="12" font-style="italic" letter-spacing="1" text-anchor="middle" fill="${WATER}">${esc(f.name)}</text>`);
    }

    // the lesser places, wherever their names still fit
    for (const p of minor) nameOf(p);
    // a ship or two on the open sea, in the old manner
    let ships = '';
    const open = [];
    for (let c = 0; c < N; c += 7) if (water[c] === 1 && fromLand[c] > 14 && cx(c) > 90 && cx(c) < W - 90 && cy(c) > 90 && cy(c) < H - 70) open.push(c);
    for (let k = 0; k < 2 && open.length; k++) {
      const c = open[Math.floor(r() * open.length)], x = cx(c), y = cy(c), b = [x - 18, y - 30, x + 18, y + 8];
      if (hit(b)) continue;
      boxes.push(b);
      const flip = r() < 0.5 ? -1 : 1;
      ships += `<g transform="translate(${f1(x)} ${f1(y)}) scale(${flip} 1)" stroke="${INK}" stroke-width="0.9" stroke-linejoin="round"><path d="M-16 -4Q-12 4 0 4H10Q15 1 17 -5Z" fill="${LAND}"/><path d="M-2 -4V-28M8 -5V-22" fill="none"/><path d="M-2 -27Q8 -20 -1 -9ZM8 -21Q14 -16 8 -9Z" fill="${LAND}"/><path d="M-1 -28L-8 -25.5L-1 -23Z" fill="${accent}" stroke="none"/><path d="M-22 7q4 -2 8 0t8 0M6 8q4 -2 8 0t8 0" fill="none" stroke="${WATER}" stroke-opacity="0.6"/></g>`;
    }
    out.push(ships);

    // click targets: each region's shape, invisible until hovered
    let targets = '';
    s.regions.forEach((g, k) => {
      const mask = new Float32Array(N);
      for (let c = 0; c < N; c++) mask[c] = !water[c] && region[c] === k ? 1 : 0;
      const d = contours(mask, 0.5, 0).map((l) => roughPath(smooth(l, 1.5, 1), l.closed)).join('');
      targets += `<path class="atlas-region" data-id="${esc(g.id)}"${g.entity ? ` data-entity="${esc(g.entity)}"` : ''} d="${d}" fill="${accent}" fill-opacity="0"/>`;
    });

    const title = esc(s.title ? `A map of ${s.title}` : 'A map');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="atlas-svg" role="img" aria-label="${title}" font-family="Alegreya, Georgia, serif"${opts.zoom ? ` data-z="${opts.zoom}"` : ''}>`
      + `<title>${title}</title><defs>${defs.join('')}</defs>`
      + `<style>.atlas-svg text{paint-order:stroke;stroke:${LAND};stroke-width:3.2px;stroke-linejoin:round}.atlas-svg[data-z="1"] .l2,.atlas-svg[data-z="1"] .l3,.atlas-svg[data-z="2"] .l3{display:none}</style>`
      + out.join('') + `<g>${targets}</g>` + `<g>${icons}</g>` + `<g pointer-events="none">${labels.join('')}</g>` + `<g pointer-events="none">${deco.svg}</g>`
      + `<rect width="${W}" height="${H}" filter="url(#${uid}paper)" pointer-events="none"/><rect width="${W}" height="${H}" fill="url(#${uid}vig)" pointer-events="none"/>`
      + frame() + '</svg>';
  }

  // The title, the compass and the scale, set where the open sea leaves the most room for them.
  function decorations(s, T, accent) {
    const sea = (b) => { let n = 0, t = 0; for (let y = b[1]; y < b[3]; y += 12) for (let x = b[0]; x < b[2]; x += 12) { t++; if (T.water[cellAt(x, y)] === 1) n++; } return t ? n / t : 0; };
    const best = (boxes, not) => boxes.filter((b) => !not || !(b[0] < not[2] && b[2] > not[0] && b[1] < not[3] && b[3] > not[1])).sort((a, b) => sea(b) - sea(a))[0];
    const corners = (bw, bh) => [[34, 34], [W - 34 - bw, 34], [34, H - 34 - bh], [W - 34 - bw, H - 34 - bh]].map(([x, y]) => [x, y, x + bw, y + bh]);
    let out = '', boxes = [], tb = null;
    if (s.title) {
      const name = s.title.toUpperCase(), size = Math.max(22, Math.min(38, 560 / Math.max(10, name.length))), sp = size * 0.18, wd = width(name, size, true, sp);
      const bw = wd + 70, bh = s.subtitle ? 92 : 72;
      tb = best(corners(bw, bh));
      const [bx, by] = tb;
      out += `<g class="atlas-title"><rect x="${f1(bx)}" y="${f1(by)}" width="${f1(bw)}" height="${bh}" fill="${LAND}" stroke="${INK}" stroke-width="1.6"/>`
        + `<rect x="${f1(bx + 5)}" y="${f1(by + 5)}" width="${f1(bw - 10)}" height="${bh - 10}" fill="none" stroke="${INK}" stroke-width="0.6"/>`
        + `<text x="${f1(bx + bw / 2)}" y="${f1(by + 44)}" font-size="${f1(size)}" letter-spacing="${f1(sp)}" text-anchor="middle" fill="${INK}" style="stroke:none">${esc(name)}</text>`
        + `<path d="M${f1(bx + bw / 2 - 46)} ${f1(by + 55)}h92" stroke="${accent}" stroke-width="1.3"/>`
        + (s.subtitle ? `<text x="${f1(bx + bw / 2)}" y="${f1(by + 76)}" font-size="13.5" font-style="italic" text-anchor="middle" fill="${INK}" fill-opacity="0.75" style="stroke:none">${esc(s.subtitle)}</text>` : '') + '</g>';
      boxes.push(tb);
    }
    const kb = best(corners(150, 190), tb), kx = kb[0] + 75, ky = kb[1] + 82;
    let star = '';
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 - Math.PI / 2, L = k % 2 ? 26 : 52, wv = k % 2 ? 6 : 9;
      const tip = [kx + Math.cos(a) * L, ky + Math.sin(a) * L], l = [kx + Math.cos(a - Math.PI / 2) * wv, ky + Math.sin(a - Math.PI / 2) * wv], rr = [kx + Math.cos(a + Math.PI / 2) * wv, ky + Math.sin(a + Math.PI / 2) * wv];
      star += `<path d="M${f1(kx)} ${f1(ky)}L${f1(l[0])} ${f1(l[1])}L${f1(tip[0])} ${f1(tip[1])}Z" fill="${k === 0 ? accent : INK}"/><path d="M${f1(kx)} ${f1(ky)}L${f1(rr[0])} ${f1(rr[1])}L${f1(tip[0])} ${f1(tip[1])}Z" fill="${LAND}" stroke="${INK}" stroke-width="0.8"/>`;
    }
    out += `<g class="atlas-compass"><circle cx="${f1(kx)}" cy="${f1(ky)}" r="36" fill="${LAND}" fill-opacity="0.5" stroke="${INK}" stroke-width="0.8"/><circle cx="${f1(kx)}" cy="${f1(ky)}" r="40" fill="none" stroke="${INK}" stroke-width="0.5"/>${star}`
      + `<text x="${f1(kx)}" y="${f1(ky - 58)}" font-size="16" text-anchor="middle" fill="${INK}">N</text></g>`;
    const sx = kx - 60, sy = ky + 74;
    let bar = '';
    for (let k = 0; k < 4; k++) bar += `<rect x="${f1(sx + k * 30)}" y="${f1(sy)}" width="30" height="5" fill="${k % 2 ? LAND : INK}" stroke="${INK}" stroke-width="0.8"/>`;
    out += `<g class="atlas-scale">${bar}<text x="${f1(sx)}" y="${f1(sy + 18)}" font-size="11" fill="${INK}">0</text><text x="${f1(sx + 120)}" y="${f1(sy + 18)}" font-size="11" text-anchor="end" fill="${INK}">100 leagues</text></g>`;
    boxes.push(kb);
    return { svg: out, boxes };
  }
  function frame() {
    let ticks = '';
    for (let x = 40; x < W - 20; x += 40) ticks += `M${x} 10v6M${x} ${H - 10}v-6`;
    for (let y = 40; y < H - 20; y += 40) ticks += `M10 ${y}h6M${W - 10} ${y}h-6`;
    return `<g fill="none" stroke="${INK}" pointer-events="none"><rect x="5" y="5" width="${W - 10}" height="${H - 10}" stroke-width="2.4"/><rect x="16" y="16" width="${W - 32}" height="${H - 32}" stroke-width="0.8"/><path d="${ticks}" stroke-width="0.8"/></g>`
      + `<path d="M0 0H${W}V${H}H0ZM5 5V${H - 5}H${W - 5}V5Z" fill="${PAPER}" fill-rule="evenodd"/>`;
  }

  // ---------------------------------------------------------------- asking Claude for a world

  const FORM = {
    region: `{"name": "...", "biome": "${BIOMES.join('|')}", "at": "${Object.keys(AT).join('|')}", "size": "small|medium|large", "relief": "flat|hills|mountains", "facts": ["..."]}`,
    place: `{"name": "...", "kind": "${KINDS.join('|')}", "region": "the name of its region", "near": "${NEAR.join('|')}", "facts": ["..."]}`,
    feature: `{"name": "...", "kind": "range|forest|desert|marsh|lake|river|chasm|volcano|plain", "region": "the name of its region", "facts": ["..."]}`,
  };
  const FACTS = 'Facts are short, concrete sentences, one idea each, written so a novelist could rely on them: who lives there, what it looks like, what is wrong or wondrous there. Name things the way the people of this world would.';
  const QUOTE = '"""';

  // A dream becomes a whole world: its shape, regions, peoples, places, powers and people.
  function buildDreamPrompt({ dream, notes }) {
    return [
      "You are a worldbuilder. Someone has told you a dream. Grow it into a whole world, as large and particular as a published fantasy setting, with the dream at its heart: its images, its feeling and its strangeness should run through everything, and the geography itself should tell the dream's story.",
      'THE DREAM\n' + QUOTE + '\n' + String(dream || '').slice(0, 8000) + '\n' + QUOTE,
      notes ? "THE DREAMER'S NOTES\n" + String(notes).slice(0, 2000) : '',
      `Reply with only JSON in this form:
{"title": "the world's name", "subtitle": "a short line for the map's cartouche",
 "premise": "two or three sentences: what this world is and what has gone wrong or wondrous in it",
 "pigments": [{"name": "one word for a mood of this world", "color": "#rrggbb"}],
 "accent": "#rrggbb",
 "shape": "${SHAPES.join('|')}", "climate": "${CLIMATES.join('|')}",
 "rules": [{"name": "...", "facts": ["..."]}],
 "regions": [${FORM.region}],
 "places": [${FORM.place}],
 "seas": [{"name": "...", "at": "${Object.keys(AT).join('|')}"}],
 "features": [${FORM.feature}],
 "factions": [{"name": "...", "facts": ["..."]}],
 "characters": [{"name": "...", "facts": ["..."]}]}
Give 3 to 5 pigments, 2 to 4 rules (how this world works: its magic, curse, law or physics), 6 to 9 regions, 24 to 36 places with at least two in every region and one capital or city in most, 1 to 3 seas, 3 to 6 features, 3 to 5 factions and 4 to 6 characters who matter now. Give every region its own people, look and trouble, and 1 to 3 facts to every entry. ${FACTS} "shape" is the lie of the land: one continent, an archipelago, twin continents, a basin ringed by high ground, a ring of land around an inland sea, or a coast with the sea to the east. "at" is where a region lies on the map.`,
    ].filter(Boolean).join('\n\n');
  }
  const facts = (v) => list(v, 6).map((f) => text(f, 300)).filter(Boolean);
  const named = (v, n) => list(v, n).filter((x) => x && typeof x === 'object' && text(x.name, 80)).map((x) => ({ name: text(x.name, 80), facts: facts(x.facts) }));
  // Clean what came back; a world needs at least a region to stand on.
  function parseDream(json) {
    if (!json || typeof json !== 'object') return null;
    const regions = [];
    for (const r of list(json.regions, 12)) {
      const name = r && text(r.name, 60);
      if (!name || regions.some((g) => g.name.toLowerCase() === name.toLowerCase())) continue;
      regions.push({ name, biome: pick(r.biome, BIOMES, 'grassland', ALIAS), at: pick(r.at, Object.keys(AT), 'center', AT_ALIAS), size: pick(r.size, Object.keys(SIZES), 'medium'), relief: pick(r.relief, RELIEFS, 'hills'), facts: facts(r.facts) });
    }
    if (!regions.length) return null;
    const regionOf = (v) => {
      const s = text(v, 60).toLowerCase();
      const hit = regions.find((r) => r.name.toLowerCase() === s) || regions.find((r) => s && (r.name.toLowerCase().includes(s) || s.includes(r.name.toLowerCase())));
      return hit ? hit.name : null;
    };
    const pigments = list(json.pigments, 6).map((p) => ({ name: text(p && p.name, 30), color: hex(p && p.color, '') })).filter((p) => p.name && p.color);
    return {
      title: text(json.title, 80) || 'A dreamed world', subtitle: text(json.subtitle, 120), premise: text(json.premise, 600),
      pigments, accent: hex(json.accent, pigments[0] ? pigments[0].color : '#a8572e'),
      shape: pick(json.shape, SHAPES, 'continent'), climate: pick(json.climate, CLIMATES, 'temperate'),
      rules: named(json.rules, 6), regions,
      places: list(json.places, 60).filter((p) => p && text(p.name, 60) && regionOf(p.region)).map((p) => ({ name: text(p.name, 60), kind: pick(p.kind, KINDS, 'town'), region: regionOf(p.region), near: pick(p.near, NEAR, 'any'), facts: facts(p.facts) })),
      seas: list(json.seas, 4).map((x) => ({ name: text(x && x.name, 60), at: pick(x && x.at, Object.keys(AT), 'south', AT_ALIAS) })).filter((x) => x.name),
      features: list(json.features, 8).filter((f) => f && text(f.name, 60) && regionOf(f.region)).map((f) => ({ name: text(f.name, 60), kind: pick(f.kind, FEATURES, 'range'), region: regionOf(f.region), facts: facts(f.facts) })),
      factions: named(json.factions, 8), characters: named(json.characters, 10),
    };
  }

  // A world that already has a canon gets a map drawn around it: every place in it stays as it
  // is, and the land that holds them is filled in.
  function buildAtlasPrompt({ world, places, rules, others }) {
    return [
      `You are the cartographer of "${(world && world.title) || 'this world'}". Draw its map: lay out the land so that every place already known stands where its story says it does, and fill in the regions, places and features that land would also hold.`,
      world && world.premise ? 'THE WORLD\n' + world.premise : '',
      rules && rules.length ? 'HOW THE WORLD WORKS (never contradict it)\n' + rules.map((f) => '- ' + f).join('\n') : '',
      places && places.length ? 'PLACES ALREADY KNOWN (use these exact names, and contradict none of their facts)\n' + places.map((p) => `- ${p.name}${p.facts.length ? ': ' + p.facts.join(' ') : ''}`).join('\n') : '',
      others && others.length ? 'WHO ELSE IS IN THIS WORLD\n' + others.map((o) => '- ' + o).join('\n') : '',
      `Reply with only JSON in this form:
{"subtitle": "a short line for the map's cartouche", "accent": "#rrggbb",
 "shape": "${SHAPES.join('|')}", "climate": "${CLIMATES.join('|')}",
 "regions": [${FORM.region}],
 "places": [${FORM.place}],
 "seas": [{"name": "...", "at": "${Object.keys(AT).join('|')}"}],
 "features": [${FORM.feature}]}
Put every known place in "places" with its exact name, in the region where it belongs, with "facts": [] (its facts are already known). Then give 5 to 8 regions in all and 12 to 24 new places, at least one in every region, 1 to 3 seas and 2 to 5 features, each new entry with 1 to 3 facts. A known place may itself be a region: then list it under "regions" with its exact name instead. ${FACTS}`,
    ].filter(Boolean).join('\n\n');
  }

  // Exploring a region: more of its places, consistent with everything already true there.
  function buildExplorePrompt({ world, region, facts: known, places, rules, neighbours }) {
    return [
      `You are the worldbuilder of "${(world && world.title) || 'this world'}". Explore one of its regions further: add the places a traveller would find there that nobody has mapped yet.`,
      world && world.premise ? 'THE WORLD\n' + world.premise : '',
      rules && rules.length ? 'HOW THE WORLD WORKS (never contradict it)\n' + rules.map((f) => '- ' + f).join('\n') : '',
      `THE REGION: ${region}\n` + (known && known.length ? known.map((f) => '- ' + f).join('\n') : '- (nothing more is known yet)'),
      places && places.length ? "ALREADY MAPPED HERE (keep them, and don't repeat them)\n" + places.map((p) => `- ${p.name} (${p.kind})${p.facts && p.facts.length ? ': ' + p.facts.join(' ') : ''}`).join('\n') : '',
      neighbours && neighbours.length ? 'ITS NEIGHBOURS\n' + neighbours.map((n) => '- ' + n).join('\n') : '',
      `Reply with only JSON in this form:
{"places": [{"name": "...", "kind": "${KINDS.join('|')}", "near": "${NEAR.join('|')}", "facts": ["..."]}],
 "features": [{"name": "...", "kind": "range|forest|desert|marsh|lake|river|chasm|volcano|plain", "facts": ["..."]}],
 "facts": ["new facts about the region itself"]}
Give 5 to 8 new places of several kinds, 0 to 2 features and 1 to 3 facts about the region, each place with 1 to 3 facts. ${FACTS} Everything must fit what is already true here.`,
    ].filter(Boolean).join('\n\n');
  }
  function parseExplore(json) {
    if (!json || typeof json !== 'object') return null;
    const places = list(json.places, 12).filter((p) => p && text(p.name, 60)).map((p) => ({ name: text(p.name, 60), kind: pick(p.kind, KINDS, 'village'), near: pick(p.near, NEAR, 'any'), facts: facts(p.facts) }));
    const features = list(json.features, 3).filter((f) => f && text(f.name, 60)).map((f) => ({ name: text(f.name, 60), kind: pick(f.kind, FEATURES, 'range'), facts: facts(f.facts) }));
    if (!places.length && !features.length) return null;
    return { places, features, facts: facts(json.facts) };
  }

  return { W, H, SHAPES, CLIMATES, BIOMES, KINDS, FEATURES, normalizeAtlas, layout, paint, buildDreamPrompt, parseDream, buildAtlasPrompt, buildExplorePrompt, parseExplore };
});
