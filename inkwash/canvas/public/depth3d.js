// From a picture and its depth to a scene you can step into. Every few pixels become a soft
// coloured disc (a Gaussian splat), set back along its line of sight by how far away the depth
// model thinks it is, and laid flat on the surface it belongs to, so the ground still looks like
// ground from a step to the side. Behind the edge of anything near, the background is carried on
// a little way, so stepping aside shows more of it rather than a hole. Pure functions with no
// imports, so the same code runs in the page and in the tests.
//
// The scene is built in the frame Marble worlds use (x right, y down, z ahead), so the viewer turns
// ours over exactly as it turns theirs.

const SH_C0 = 0.28209479177387814; // the colour term of a Gaussian splat's light
const DEG = 180 / Math.PI;

// Depth models give relative inverse depth: bigger is nearer, in no particular unit. It is spread
// between a near and a far distance; what the model sees as nearly infinitely far is sky, and goes
// on a distant dome. A panorama (wider than 2:1) is wrapped round a cylinder instead of a flat view.
export function splatsFromDepth({ rgba, width, height, depth, dw = width, dh = height, budget = 600000, hfov, near = 1.2, far = 40, sky = 0.03, skyDistance = 150 }) {
  const aspect = width / height, wide = aspect > 2;
  const fov = hfov || ((wide ? 120 : 70) * Math.PI) / 180;
  const gw = Math.max(8, Math.round(Math.sqrt(budget * aspect))), gh = Math.max(8, Math.round(gw / aspect)), cells = gw * gh;

  // the robust range of the depth: the extreme 1% at each end is ignored
  const stride = Math.max(1, Math.floor(depth.length / 200000));
  const sample = new Float32Array(Math.ceil(depth.length / stride));
  for (let i = 0, k = 0; i < depth.length; i += stride) sample[k++] = depth[i];
  sample.sort();
  const lo = sample[Math.floor(sample.length * 0.01)], hi = sample[Math.floor(sample.length * 0.99)], span = Math.max(1e-6, hi - lo);

  // depth at a point: bilinear inside a surface, the nearest sample across an edge, so nothing
  // floats halfway between a tower and the sky behind it
  const at = (x, y) => depth[Math.min(dh - 1, Math.max(0, y)) * dw + Math.min(dw - 1, Math.max(0, x))];
  function depthAt(u, v) {
    const fx = u * dw - 0.5, fy = v * dh - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    if (Math.max(a, b, c, d) - Math.min(a, b, c, d) > span * 0.06) return tx < 0.5 ? (ty < 0.5 ? a : c) : (ty < 0.5 ? b : d);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }
  // colour of a cell: the average of the pixels under it
  const cellW = width / gw, cellH = height / gh, col = new Float32Array(cells * 3);
  for (let j = 0, n = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++, n++) {
      const x0 = Math.floor(i * cellW), x1 = Math.max(x0 + 1, Math.floor((i + 1) * cellW)), y0 = Math.floor(j * cellH), y1 = Math.max(y0 + 1, Math.floor((j + 1) * cellH));
      let r = 0, g = 0, b = 0, k = 0;
      for (let y = y0; y < y1 && y < height; y++) for (let x = x0; x < x1 && x < width; x++) { const p = (y * width + x) * 4; r += rgba[p]; g += rgba[p + 1]; b += rgba[p + 2]; k++; }
      col[n * 3] = r / k / 255; col[n * 3 + 1] = g / k / 255; col[n * 3 + 2] = b / k / 255;
    }
  }

  // where each cell's ray goes, and how near (0 far … 1 near) and how far away its surface is
  const tanH = Math.tan(fov / 2), tanV = wide ? (fov / 2) * (gh / gw) : tanH * (gh / gw);
  const cell = wide ? fov / gw : (2 * tanH) / gw; // a cell's width one unit away, across and down
  const ray = new Float32Array(cells * 3), dn = new Float32Array(cells), z = new Float32Array(cells);
  const toZ = (d) => (d < sky ? skyDistance : 1 / (d * (1 / near - 1 / far) + 1 / far));
  for (let j = 0, n = 0; j < gh; j++) {
    const v = (j + 0.5) / gh;
    for (let i = 0; i < gw; i++, n++) {
      const u = (i + 0.5) / gw;
      if (wide) { const th = (u - 0.5) * fov; ray[n * 3] = Math.sin(th); ray[n * 3 + 2] = Math.cos(th); } else { ray[n * 3] = (u * 2 - 1) * tanH; ray[n * 3 + 2] = 1; }
      ray[n * 3 + 1] = (v * 2 - 1) * tanV;
      dn[n] = Math.min(1, Math.max(0, (depthAt(u, v) - lo) / span));
      z[n] = toZ(dn[n]);
    }
  }
  const P = (n, k) => ray[n * 3 + k] * z[n];

  // what lies behind the edges of near things: the farthest surface within a few cells, and its colour
  const r = Math.max(4, Math.round(gw / 40));
  const far1 = new Float32Array(cells), arg1 = new Int32Array(cells), far2 = new Float32Array(cells), arg2 = new Int32Array(cells);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      let m = Infinity, a = 0;
      for (let k = Math.max(0, i - r); k <= Math.min(gw - 1, i + r); k++) { const q = j * gw + k; if (dn[q] < m) { m = dn[q]; a = q; } }
      far1[j * gw + i] = m; arg1[j * gw + i] = a;
    }
  }
  for (let i = 0; i < gw; i++) {
    for (let j = 0; j < gh; j++) {
      let m = Infinity, a = 0;
      for (let k = Math.max(0, j - r); k <= Math.min(gh - 1, j + r); k++) { const q = k * gw + i; if (far1[q] < m) { m = far1[q]; a = arg1[q]; } }
      far2[j * gw + i] = m; arg2[j * gw + i] = a;
    }
  }
  let behind = 0;
  for (let n = 0; n < cells; n++) if (dn[n] - far2[n] > 0.08) behind++;

  const count = cells + behind;
  const xyz = new Float32Array(count * 3), scale = new Float32Array(count * 3), rot = new Float32Array(count * 4), rgb = new Float32Array(count * 3), alpha = new Float32Array(count);
  const e1 = [0, 0, 0], e2 = [0, 0, 0], e3 = [0, 0, 0];
  // the step from one cell to the next across (k = 1) or down (k = gw), on the same surface: the
  // smaller of the steps either side, so an edge never stretches a disc across a gap
  function step(n, i, j, across, out) {
    const lim = across ? gw : gh, idx = across ? i : j, d = across ? 1 : gw;
    const f = z[n] * cell * 10; // a far floor rises in long steps; a gap is far longer
    let best = null, len = Infinity;
    for (const m of [idx + 1 < lim ? n + d : -1, idx > 0 ? n - d : -1]) {
      if (m < 0) continue;
      const s = m > n ? 1 : -1, v0 = (P(m, 0) - P(n, 0)) * s, v1 = (P(m, 1) - P(n, 1)) * s, v2 = (P(m, 2) - P(n, 2)) * s, l = Math.hypot(v0, v1, v2);
      if (l < len) { len = l; best = [v0, v1, v2]; }
    }
    if (!best || len > f) { // no neighbour on this surface: a disc square to the eye
      const c = z[n] * cell;
      if (across) { out[0] = c; out[1] = 0; out[2] = 0; } else { out[0] = 0; out[1] = c; out[2] = 0; }
      return;
    }
    out[0] = best[0]; out[1] = best[1]; out[2] = best[2];
  }
  const tu = [0, 0, 0], tv = [0, 0, 0];
  let n = 0;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++, n++) {
      xyz[n * 3] = P(n, 0); xyz[n * 3 + 1] = P(n, 1); xyz[n * 3 + 2] = P(n, 2);
      step(n, i, j, true, tu); step(n, i, j, false, tv);
      frame(tu, tv, e1, e2, e3);
      const lu = Math.hypot(tu[0], tu[1], tu[2]), lv = Math.abs(tv[0] * e2[0] + tv[1] * e2[1] + tv[2] * e2[2]) || lu;
      scale[n * 3] = lu * 0.62; scale[n * 3 + 1] = Math.max(lv, lu * 0.05) * 0.62; scale[n * 3 + 2] = Math.min(lu, lv || lu) * 0.12;
      quat(e1, e2, e3, rot, n * 4);
      rgb[n * 3] = col[n * 3]; rgb[n * 3 + 1] = col[n * 3 + 1]; rgb[n * 3 + 2] = col[n * 3 + 2];
      alpha[n] = 0.98;
    }
  }
  // the background carried on behind near edges, square to the eye, in the background's colour
  for (let q = 0; q < cells; q++) {
    if (!(dn[q] - far2[q] > 0.08)) continue;
    const zb = toZ(far2[q]), src = arg2[q], c = zb * cell * 0.7;
    xyz[n * 3] = ray[q * 3] * zb; xyz[n * 3 + 1] = ray[q * 3 + 1] * zb; xyz[n * 3 + 2] = ray[q * 3 + 2] * zb;
    scale[n * 3] = c; scale[n * 3 + 1] = c; scale[n * 3 + 2] = c * 0.2;
    const lr = Math.hypot(ray[q * 3], ray[q * 3 + 1], ray[q * 3 + 2]), rx = ray[q * 3] / lr, ry = ray[q * 3 + 1] / lr, rz = ray[q * 3 + 2] / lr;
    const qw = 1 + rz, qx = -ry, qy = rx, ql = Math.hypot(qw, qx, qy) || 1;
    rot[n * 4] = qw / ql; rot[n * 4 + 1] = qx / ql; rot[n * 4 + 2] = qy / ql; rot[n * 4 + 3] = 0;
    rgb[n * 3] = col[src * 3]; rgb[n * 3 + 1] = col[src * 3 + 1]; rgb[n * 3 + 2] = col[src * 3 + 2];
    alpha[n] = 0.98;
    n++;
  }

  // how far you may walk: a quarter of the way to the middle distance, so what's missing stays small
  const sortedZ = Float32Array.from(z).sort();
  const bound = Math.min(2, Math.max(0.3, sortedZ[Math.floor(cells / 2)] * 0.25));
  // the view to start with: just the picture, edge to edge
  const vfov = 2 * Math.atan(tanV) * DEG;
  // a haze for beyond the picture's edges: its top row fading into its bottom row, dimmed
  const edge = (row) => { let r = 0, g = 0, b = 0; for (let i = 0; i < gw; i++) { const q = row * gw + i; r += col[q * 3]; g += col[q * 3 + 1]; b += col[q * 3 + 2]; } return [r / gw * 0.6, g / gw * 0.6, b / gw * 0.6]; };
  const backdrop = { top: edge(0), bottom: edge(gh - 1) };
  return { count, cells, behind, grid: [gw, gh], wide, xyz, scale, rot, rgb, alpha, bound, vfov, backdrop };
}

// an orthonormal frame from the steps across and down: e1 along the surface across, e2 along it
// down, e3 out of it
function frame(tu, tv, e1, e2, e3) {
  let l = Math.hypot(tu[0], tu[1], tu[2]) || 1;
  e1[0] = tu[0] / l; e1[1] = tu[1] / l; e1[2] = tu[2] / l;
  const d = tv[0] * e1[0] + tv[1] * e1[1] + tv[2] * e1[2];
  e2[0] = tv[0] - d * e1[0]; e2[1] = tv[1] - d * e1[1]; e2[2] = tv[2] - d * e1[2];
  l = Math.hypot(e2[0], e2[1], e2[2]);
  if (l < 1e-9) { // the two steps are parallel: any perpendicular will do
    const a = Math.abs(e1[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    e2[0] = a[1] * e1[2] - a[2] * e1[1]; e2[1] = a[2] * e1[0] - a[0] * e1[2]; e2[2] = a[0] * e1[1] - a[1] * e1[0];
    l = Math.hypot(e2[0], e2[1], e2[2]);
  }
  e2[0] /= l; e2[1] /= l; e2[2] /= l;
  e3[0] = e1[1] * e2[2] - e1[2] * e2[1]; e3[1] = e1[2] * e2[0] - e1[0] * e2[2]; e3[2] = e1[0] * e2[1] - e1[1] * e2[0];
}
// the rotation with columns e1, e2, e3, as a quaternion (w, x, y, z)
function quat(e1, e2, e3, out, o) {
  const m00 = e1[0], m10 = e1[1], m20 = e1[2], m01 = e2[0], m11 = e2[1], m21 = e2[2], m02 = e3[0], m12 = e3[1], m22 = e3[2];
  const t = m00 + m11 + m22;
  let w, x, y, z;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4; }
  const l = Math.hypot(w, x, y, z) || 1;
  out[o] = w / l; out[o + 1] = x / l; out[o + 2] = y / l; out[o + 3] = z / l;
}

// The splats as a standard Gaussian-splat PLY (the layout of the original 3DGS code), which Spark
// and every other splat viewer can read.
export function toPly({ count, xyz, scale, rot, rgb, alpha }) {
  const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const head = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${props.map((p) => `property float ${p}`).join('\n')}\nend_header\n`);
  const bytes = new Uint8Array(head.length + count * props.length * 4);
  bytes.set(head, 0);
  const view = new DataView(bytes.buffer, head.length);
  const logit = (a) => Math.log(a / (1 - a));
  for (let n = 0, o = 0; n < count; n++) {
    const row = [xyz[n * 3], xyz[n * 3 + 1], xyz[n * 3 + 2], 0, 0, 0,
      (rgb[n * 3] - 0.5) / SH_C0, (rgb[n * 3 + 1] - 0.5) / SH_C0, (rgb[n * 3 + 2] - 0.5) / SH_C0, logit(alpha[n]),
      Math.log(Math.max(1e-6, scale[n * 3])), Math.log(Math.max(1e-6, scale[n * 3 + 1])), Math.log(Math.max(1e-6, scale[n * 3 + 2])),
      rot[n * 4], rot[n * 4 + 1], rot[n * 4 + 2], rot[n * 4 + 3]];
    for (let k = 0; k < row.length; k++, o += 4) view.setFloat32(o, row[k], true);
  }
  return bytes;
}
