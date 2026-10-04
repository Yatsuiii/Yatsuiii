// Unit tests for poking: one press per touch, nothing while resting inside, two hands apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPoker, turnAngle } from '../src/poke.js';

const target = { id: 'harrowgate', p: { x: 0, y: 0, z: 0 }, r: 0.02 };
const at = (y, x = 0) => ({ x, y, z: 0 });

test('reaching for a target hovers it, touching it presses it once', () => {
  const step = createPoker();
  let r = step([{ id: 'right', p: at(0.2) }], [target]);
  assert.deepEqual([r.hovered.size, r.presses.length], [0, 0], 'far away: nothing');
  r = step([{ id: 'right', p: at(0.05) }], [target]);
  assert.ok(r.hovered.has('harrowgate'), 'near: hovered');
  assert.equal(r.presses.length, 0);
  r = step([{ id: 'right', p: at(0.015) }], [target]);
  assert.deepEqual(r.presses, [{ tip: 'right', target: 'harrowgate' }], 'touching: pressed');
  r = step([{ id: 'right', p: at(0.01) }], [target]);
  assert.equal(r.presses.length, 0, 'resting inside: no second press');
});

test('drawing back far enough lets the same finger press again', () => {
  const step = createPoker();
  step([{ id: 'right', p: at(0.2) }], [target]);
  assert.equal(step([{ id: 'right', p: at(0.01) }], [target]).presses.length, 1);
  assert.equal(step([{ id: 'right', p: at(0.03) }], [target]).presses.length, 0, 'a little way back is not enough');
  assert.equal(step([{ id: 'right', p: at(0.01) }], [target]).presses.length, 0);
  step([{ id: 'right', p: at(0.06) }], [target]);
  assert.equal(step([{ id: 'right', p: at(0.01) }], [target]).presses.length, 1, 'after drawing back, it presses again');
});

test('a fingertip that appears inside a target does not press it until it has left', () => {
  const step = createPoker();
  assert.equal(step([{ id: 'left', p: at(0.005) }], [target]).presses.length, 0);
  step([{ id: 'left', p: at(0.08) }], [target]);
  assert.equal(step([{ id: 'left', p: at(0.005) }], [target]).presses.length, 1);
});

test('the nearest target is the one pressed, and each hand keeps its own state', () => {
  const step = createPoker();
  const other = { id: 'sela', p: { x: 0.03, y: 0, z: 0 }, r: 0.02 };
  step([{ id: 'left', p: at(0.2) }, { id: 'right', p: at(0.2, 0.03) }], [target, other]);
  const r = step([{ id: 'left', p: at(0.01) }, { id: 'right', p: at(0.01, 0.03) }], [target, other]);
  assert.deepEqual(r.presses.map((p) => [p.tip, p.target]).sort(), [['left', 'harrowgate'], ['right', 'sela']]);
});

test('a hand that disappears and comes back starts fresh', () => {
  const step = createPoker();
  step([{ id: 'right', p: at(0.2) }], [target]);
  step([{ id: 'right', p: null }], [target]);
  assert.equal(step([{ id: 'right', p: at(0.01) }], [target]).presses.length, 0, 'it came back inside, so it must leave first');
});

test('turning a pinch around the centre gives the angle it moved through', () => {
  const c = { x: 0, z: 0 };
  assert.ok(Math.abs(turnAngle(c, { x: 1, z: 0 }, { x: 0, z: 1 }) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(turnAngle(c, { x: -1, z: 0.001 }, { x: -1, z: -0.001 }) - 0.002) < 1e-6, 'across the back, the short way round');
});
