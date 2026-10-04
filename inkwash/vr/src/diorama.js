// A world's atlas as a diorama on a table: the land's relief as a height grid in metres, and a
// marker for every place and feature, each with its canon facts. Pure: no DOM and no three.js,
// so the headset, the desktop preview and the Node tests share exactly this code.
//
// The map lies flat in front of the reader, north away from them, the way a paper map lies on a
// table: map x runs left to right, map y runs from the far edge to the near one.

// How prominent each kind of place is: the marker's size, and whether its name shows unasked.
export const RANK = {
  capital: 3, city: 2.4, port: 2, fortress: 2, temple: 1.8, tower: 1.8, town: 1.6, landmark: 1.6,
  mine: 1.3, ruin: 1.3, wreck: 1.3, village: 1.2, camp: 1, feature: 1.5,
};

// A world from Inkwash's own pieces: a dreamed world's canon, its normalized atlas and the land
// grown from it. C and AT are Inkwash's core and atlas modules, passed in so this file needs no
// loader of its own.
export function makeWorld({ C, AT, dream, now = 0 }) {
  const d = AT.parseDream(dream.answer);
  if (!d) throw new Error('the dream could not be read');
  const seed = dream.seed || 1;
  const made = C.worldFromDream(d, { now, seed, dream: dream.dream });
  const spec = AT.normalizeAtlas(made.atlas, seed);
  return { world: made.world, entities: made.entities, spec, layout: AT.layout(spec), mapW: AT.W, mapH: AT.H };
}

function factsOf(entity) {
  if (!entity || !Array.isArray(entity.facts)) return [];
  return entity.facts.filter((f) => f && !f.retired && String(f.text || '').trim()).map((f) => String(f.text).trim());
}

// Land rises from the table; water lies flat on it. A low minimum keeps every coast a visible
// step, and a gentle curve keeps plains low while mountains stand out.
export function heightOf(e, isWater, lift) {
  if (isWater) return 0;
  return Math.max(0.0015, Math.pow(Math.max(0, e), 1.15) * lift);
}

// 0.72 m across: the far edge stays within a seated reader's reach, with a small lean.
export function buildDiorama({ spec, layout, entities, mapW = 1600, mapH = 1000, width = 0.72, lift = 0.055, cols = 160, rows = 100 }) {
  const { T, places } = layout;
  const s = layout.s || spec;
  const cells = T.e.length;
  const GH = Math.round(Math.sqrt((cells * mapH) / mapW)), GW = cells / GH;
  if (!Number.isInteger(GW)) throw new Error('the atlas grid has an unexpected shape');
  const depth = (width * mapH) / mapW;

  // height of each atlas cell, then sampled onto the mesh grid
  const hc = new Float32Array(cells);
  for (let c = 0; c < cells; c++) hc[c] = heightOf(T.e[c], !!T.water[c], lift);
  const at = (u, v) => {
    const gx = Math.min(GW - 1, Math.max(0, u * GW - 0.5)), gy = Math.min(GH - 1, Math.max(0, v * GH - 0.5));
    const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(GW - 1, x0 + 1), y1 = Math.min(GH - 1, y0 + 1);
    const fx = gx - x0, fy = gy - y0;
    const a = hc[y0 * GW + x0], b = hc[y0 * GW + x1], c = hc[y1 * GW + x0], d = hc[y1 * GW + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  const heights = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) heights[j * cols + i] = at(i / (cols - 1), j / (rows - 1));

  const toBoard = (u, v) => ({ x: (u - 0.5) * width, z: (v - 0.5) * depth });
  const ent = new Map((entities || []).map((e) => [e.id, e]));
  const regionName = new Map(s.regions.map((r) => [r.id, r.name]));

  const markers = places.map((p) => {
    const u = p.x / mapW, v = p.y / mapH, b = toBoard(u, v);
    return {
      id: p.id, name: p.name, kind: p.kind, type: 'place', region: regionName.get(p.region) || '',
      entity: p.entity || null, x: b.x, z: b.z, y: at(u, v), rank: RANK[p.kind] || 1, facts: factsOf(ent.get(p.entity)),
    };
  });
  // features that shape the land (a range, a lake, a volcano, a chasm) are places in the canon too
  for (const f of T.shaped || []) {
    const u = f.kind === 'range' ? (f.x0 + f.x1) / 2 : f.x, v = f.kind === 'range' ? (f.y0 + f.y1) / 2 : f.y;
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
    const b = toBoard(Math.min(0.98, Math.max(0.02, u)), Math.min(0.98, Math.max(0.02, v)));
    markers.push({
      id: f.f.id, name: f.f.name, kind: f.kind, type: 'feature', region: regionName.get(f.f.region) || '',
      entity: f.f.entity || null, x: b.x, z: b.z, y: at(u, v), rank: RANK.feature, facts: factsOf(ent.get(f.f.entity)),
    });
  }

  // each region's middle, over its land
  const sum = s.regions.map(() => ({ x: 0, y: 0, n: 0 }));
  for (let c = 0; c < cells; c++) {
    const k = T.region[c];
    if (T.water[c] || k < 0 || !sum[k]) continue;
    sum[k].x += (c % GW) + 0.5; sum[k].y += Math.floor(c / GW) + 0.5; sum[k].n++;
  }
  const regions = s.regions.map((r, k) => {
    const m = sum[k];
    const u = m.n ? m.x / m.n / GW : 0.5, v = m.n ? m.y / m.n / GH : 0.5, b = toBoard(u, v);
    return { id: r.id, name: r.name, entity: r.entity || null, x: b.x, z: b.z, y: at(u, v), cells: m.n, facts: factsOf(ent.get(r.entity)) };
  });

  return { title: s.title || '', subtitle: s.subtitle || '', accent: s.accent || '#a8572e', width, depth, lift, grid: { cols, rows, heights }, markers, regions };
}

// The surface height at a point on the board, in the board's own coordinates.
export function surfaceAt(dio, x, z) {
  const { cols, rows, heights } = dio.grid;
  const gx = Math.min(cols - 1, Math.max(0, (x / dio.width + 0.5) * (cols - 1)));
  const gy = Math.min(rows - 1, Math.max(0, (z / dio.depth + 0.5) * (rows - 1)));
  const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(cols - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1);
  const fx = gx - x0, fy = gy - y0;
  const a = heights[y0 * cols + x0], b = heights[y0 * cols + x1], c = heights[y1 * cols + x0], d = heights[y1 * cols + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

// The ink map as a texture for the board: the atlas's own drawing, without the place names,
// which stand above their markers instead. Region and sea names stay painted on the land.
export function mapTextureSvg(svg, markers) {
  let out = String(svg);
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const re = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of markers) out = out.replace(new RegExp(`<text class="lbl l[123]"[^>]*>${re(esc(m.name))}</text>`, 'g'), '');
  return out;
}
