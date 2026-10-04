// Unit tests for the diorama: the dreamed example world, The Drained Sea, laid out on a table.
// Run: node --test inkwash/vr/test/diorama.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { makeWorld, buildDiorama, surfaceAt, mapTextureSvg, heightOf } from '../src/diorama.js';

const require = createRequire(import.meta.url);
const C = require('../../v0/src/core.js');
const AT = require('../../v0/src/atlas.js');
const dream = JSON.parse(readFileSync(new URL('../../v0/dream-example.json', import.meta.url), 'utf8'));

const w = makeWorld({ C, AT, dream, now: 1 });
const dio = buildDiorama({ spec: w.spec, layout: w.layout, entities: w.entities, mapW: w.mapW, mapH: w.mapH });
const places = dio.markers.filter((m) => m.type === 'place');
const named = (name) => dio.markers.find((m) => m.name === name);

test('the board is table-sized and keeps the map\'s proportions', () => {
  assert.equal(dio.width, 0.72);
  assert.ok(Math.abs(dio.depth - 0.45) < 1e-9, '1600 by 1000 makes 0.72 m by 0.45 m');
  assert.equal(dio.grid.heights.length, dio.grid.cols * dio.grid.rows);
});

test('every place on the map stands on the board, linked to its canon entry and its facts', () => {
  assert.equal(places.length, w.spec.places.length);
  for (const m of places) {
    assert.ok(Math.abs(m.x) <= dio.width / 2 && Math.abs(m.z) <= dio.depth / 2, `${m.name} is on the board`);
    assert.ok(m.entity && w.entities.some((e) => e.id === m.entity), `${m.name} has a canon entry`);
    assert.ok(m.facts.length >= 1, `${m.name} has facts`);
    assert.ok(m.region, `${m.name} names its region`);
  }
  const harrowgate = named('Harrowgate');
  assert.equal(harrowgate.kind, 'capital');
  assert.equal(harrowgate.region, 'The Old Coast');
  assert.ok(harrowgate.facts.some((f) => /lamplit terraces/.test(f)), 'its own words from the dream');
  assert.ok(harrowgate.z < 0, 'The Old Coast lies north, on the far side of the table');
});

test('the land\'s features are markers too, each with its facts', () => {
  const features = dio.markers.filter((m) => m.type === 'feature').map((m) => m.name).sort();
  assert.deepEqual(features, ['Mount Hiss', 'The Coral Spine', 'The Deep', 'The Last Water']);
  for (const f of dio.markers.filter((m) => m.type === 'feature')) assert.ok(f.facts.length >= 1, `${f.name} has facts`);
});

test('water lies flat, land rises, and mountains stand higher than salt flats', () => {
  const { heights } = dio.grid;
  let max = 0;
  for (const h of heights) { assert.ok(h >= 0); max = Math.max(max, h); }
  assert.ok(max > 0.03 && max <= dio.lift * 1.2, `the highest point is ${max.toFixed(3)} m`);
  const mean = (name) => {
    const r = dio.regions.find((g) => g.name === name);
    let s = 0, n = 0;
    for (let dz = -0.03; dz <= 0.03; dz += 0.01) for (let dx = -0.03; dx <= 0.03; dx += 0.01) { s += surfaceAt(dio, r.x + dx, r.z + dz); n++; }
    return s / n;
  };
  assert.ok(mean('The Spines') > mean('The Seabed') * 1.5, 'the mountain region stands above the seabed');
  assert.equal(heightOf(0.5, true, 0.055), 0, 'water is flat');
  assert.ok(heightOf(0, false, 0.055) > 0, 'a coast is a visible step');
});

test('a marker stands on the ground under it', () => {
  for (const m of dio.markers) assert.ok(Math.abs(m.y - surfaceAt(dio, m.x, m.z)) < 0.004, `${m.name} stands on the land`);
});

test('every region has a middle on the board, over its own land', () => {
  assert.equal(dio.regions.length, w.spec.regions.length);
  for (const r of dio.regions) {
    assert.ok(r.cells > 0, `${r.name} has land`);
    assert.ok(Math.abs(r.x) < dio.width / 2 && Math.abs(r.z) < dio.depth / 2);
  }
});

test('the same world always makes the same diorama', () => {
  const again = buildDiorama({ spec: w.spec, layout: AT.layout(w.spec), entities: w.entities, mapW: w.mapW, mapH: w.mapH });
  assert.deepEqual(Array.from(again.grid.heights), Array.from(dio.grid.heights));
  assert.deepEqual(again.markers.map((m) => [m.name, m.x, m.z]), dio.markers.map((m) => [m.name, m.x, m.z]));
});

test('the board\'s map keeps region and sea names but leaves place names to the markers', () => {
  const svg = AT.paint(w.spec, {});
  const tex = mapTextureSvg(svg, dio.markers);
  for (const name of ['Harrowgate', 'Sela', 'Mount Hiss']) {
    assert.ok(svg.includes(`>${name}</text>`), `the drawn map names ${name}`);
    assert.ok(!tex.includes(`>${name}</text>`), `the board's map leaves ${name} to its marker`);
  }
  assert.ok(tex.includes('The Seabed') || tex.includes('THE SEABED') || /atlas-region-name/.test(tex), 'region names stay');
  assert.ok(tex.includes('The Outer Ocean'), 'the sea\'s name stays');
  assert.ok(tex.length > svg.length * 0.9, 'only the labels were taken out');
});
