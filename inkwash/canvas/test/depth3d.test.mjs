// Building a scene from a picture and its depth, checked on scenes whose right answer is known: a
// floor running back to a horizon, a box standing on it, and sky above.
//   node --test 'inkwash/canvas/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splatsFromDepth, toPly } from '../public/depth3d.js';

// a 160×90 picture: sky above row 30, a floor below it; a box in the middle of the floor. Depth is
// inverse depth, as depth models give it: bigger is nearer.
function scene({ width = 160, height = 90, colour = [200, 120, 40] } = {}) {
  const rgba = new Uint8ClampedArray(width * height * 4), depth = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x, box = x >= 60 && x < 100 && y >= 40 && y < 75;
      rgba.set(y < 30 ? [70, 140, 220, 255] : box ? [...colour, 255] : [210, 180, 110, 255], p * 4);
      depth[p] = y < 30 ? 0 : box ? 0.9 : 0.1 + 0.6 * ((y - 30) / (height - 30)); // the floor comes nearer toward the bottom
    }
  }
  return { rgba, width, height, depth };
}
const splatAt = (s, n) => ({ x: s.xyz[n * 3], y: s.xyz[n * 3 + 1], z: s.xyz[n * 3 + 2], s: [s.scale[n * 3], s.scale[n * 3 + 1], s.scale[n * 3 + 2]], q: Array.from(s.rot.slice(n * 4, n * 4 + 4)), c: Array.from(s.rgb.slice(n * 3, n * 3 + 3)) });

test('every cell becomes a splat in front of the eye, at the depth its picture shows', () => {
  const s = splatsFromDepth(Object.assign(scene(), { budget: 3600 }));
  assert.deepEqual(s.grid, [80, 45]);
  assert.equal(s.cells, 80 * 45);
  assert.equal(s.count, s.cells + s.behind);
  assert.ok(s.behind > 0, 'the background is carried on behind the box');
  for (let n = 0; n < s.count; n++) {
    const p = splatAt(s, n);
    assert.ok(p.z > 0, 'everything lies ahead');
    assert.ok(Math.abs(Math.hypot(...p.q) - 1) < 1e-4, 'rotations are unit quaternions');
    assert.ok(p.s.every((v) => v > 0 && Number.isFinite(v)), 'scales are positive');
  }
  const cell = (i, j) => splatAt(s, j * 80 + i);
  assert.equal(cell(40, 2).z, 150, 'sky goes on the far dome');
  assert.ok(cell(40, 2).y < 0 && cell(40, 44).y > 0, 'up is up: y points down, as in Marble worlds');
  assert.ok(cell(10, 44).z < cell(10, 20).z, 'the floor comes nearer toward the bottom of the picture');
  assert.ok(cell(40, 28).z < cell(10, 28).z, 'the box stands in front of the floor behind it');
  assert.ok(cell(5, 30).x < 0 && cell(75, 30).x > 0, 'left is left');
});

test('a depth edge never stretches a disc across the gap, and the floor lies flat', () => {
  const s = splatsFromDepth(Object.assign(scene(), { budget: 3600 }));
  const fov = (70 * Math.PI) / 180, cellWidth = (2 * Math.tan(fov / 2)) / 80;
  const edge = 39 * 80 + 30; // the top row of the box, against the floor far behind
  const p = splatAt(s, edge);
  assert.ok(Math.max(...p.s) < p.z * cellWidth * 3, `a disc at the edge stays the size of its cell (${Math.max(...p.s).toFixed(3)} vs ${(p.z * cellWidth).toFixed(3)})`);
  // on the floor the disc's thin axis points up and down, not at the eye: the third column of its
  // rotation is roughly vertical
  const f = splatAt(s, 35 * 80 + 10), [w, x, y, z] = f.q;
  const third = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
  assert.ok(Math.abs(third[1]) > 0.6, `the floor's discs lie on the floor (normal ${third.map((v) => v.toFixed(2)).join(', ')})`);
});

test('behind the box, the floor is carried on in its own colour', () => {
  const s = splatsFromDepth(Object.assign(scene({ colour: [255, 0, 0] }), { budget: 3600 }));
  const extra = Array.from({ length: s.behind }, (_, k) => splatAt(s, s.cells + k));
  assert.ok(extra.every((p) => !(p.c[0] > 0.9 && p.c[1] < 0.1)), 'none of them is the red of the box');
  const fore = splatAt(s, 50 * 80 + 40 - 80 * 10 + 0); // a cell on the box
  assert.ok(extra.some((p) => p.z > fore.z), 'they lie farther than the box');
});

test('the start view frames the picture, the walk stays near it, the haze is its own', () => {
  const s = splatsFromDepth(Object.assign(scene(), { budget: 3600 }));
  assert.ok(Math.abs(s.vfov - 2 * Math.atan(Math.tan((35 * Math.PI) / 180) * 45 / 80) * (180 / Math.PI)) < 1e-6);
  assert.ok(Math.abs(s.vfov - 43.0) < 0.5, '43° tall for a 16:9 picture 70° wide');
  assert.ok(s.bound >= 0.3 && s.bound <= 2);
  assert.ok(s.backdrop.top[2] > s.backdrop.top[0], 'the haze above is the sky blue, dimmed');
  assert.ok(s.backdrop.bottom[0] > s.backdrop.bottom[2], 'and below, the sandy floor');
  assert.ok(s.backdrop.top.every((v) => v <= 0.6 + 1e-9));
});

test('a panorama is wrapped round a cylinder', () => {
  const width = 250, height = 100, rgba = new Uint8ClampedArray(width * height * 4).fill(128), depth = new Float32Array(width * height).fill(0.5);
  for (let i = 0; i < width * height; i++) depth[i] = 0.3 + 0.4 * ((i % width) / width) * 0 + (i % 7) * 0.01;
  const s = splatsFromDepth({ rgba, width, height, depth, budget: 2500 });
  assert.equal(s.wide, true);
  const [gw] = s.grid, first = splatAt(s, 0), mid = splatAt(s, Math.floor(gw / 2));
  const th = Math.atan2(first.x, first.z);
  assert.ok(Math.abs(th - (-(60 * Math.PI) / 180 + (Math.PI * 120) / 180 / gw / 2)) < 0.02, `the left edge looks 60° to the left (${(th * 180 / Math.PI).toFixed(1)}°)`);
  assert.ok(Math.abs(mid.x) < 0.2 * mid.z, 'the middle looks ahead');
});

test('a colour is the average of the pixels under its cell', () => {
  const width = 16, height = 16, rgba = new Uint8ClampedArray(width * height * 4), depth = new Float32Array(width * height).fill(0.5);
  for (let p = 0; p < width * height; p++) rgba.set((p % 2) ? [255, 0, 0, 255] : [0, 0, 255, 255], p * 4); // red and blue columns
  depth[0] = 0; depth[1] = 1; // give the depth a range
  const s = splatsFromDepth({ rgba, width, height, depth, budget: 64 }); // an 8×8 grid: two columns to a cell
  assert.deepEqual(s.grid, [8, 8]);
  const c = splatAt(s, 5).c;
  assert.ok(Math.abs(c[0] - 0.5) < 0.01 && Math.abs(c[2] - 0.5) < 0.01, `red and blue stripes average to purple (${c.map((v) => v.toFixed(2))})`);
});

test('the splats are written as a standard 3DGS PLY', () => {
  const s = splatsFromDepth(Object.assign(scene(), { budget: 400 }));
  const bytes = toPly(s);
  const text = new TextDecoder().decode(bytes.subarray(0, 1000));
  const head = text.slice(0, text.indexOf('end_header\n') + 11);
  assert.match(head, new RegExp(`^ply\\nformat binary_little_endian 1\\.0\\nelement vertex ${s.count}\\n`));
  assert.match(head, /property float x\n[\s\S]*property float f_dc_0[\s\S]*property float opacity\nproperty float scale_0[\s\S]*property float rot_3\nend_header\n$/);
  assert.equal(bytes.length, head.length + s.count * 17 * 4);
  const v = new DataView(bytes.buffer, bytes.byteOffset + head.length);
  const f = (n, k) => v.getFloat32((n * 17 + k) * 4, true);
  const n = 7;
  assert.ok(Math.abs(f(n, 0) - s.xyz[n * 3]) < 1e-5 && Math.abs(f(n, 2) - s.xyz[n * 3 + 2]) < 1e-5);
  assert.ok(Math.abs(f(n, 6) - (s.rgb[n * 3] - 0.5) / 0.28209479177387814) < 1e-4, 'colour as the first spherical harmonic');
  assert.ok(Math.abs(f(n, 9) - Math.log(0.98 / 0.02)) < 1e-4, 'opacity as a logit');
  assert.ok(Math.abs(Math.exp(f(n, 10)) - s.scale[n * 3]) < 1e-5, 'scale as a log');
  assert.ok(Math.abs(f(n, 13) - s.rot[n * 4]) < 1e-6, 'rotation w first');
});
