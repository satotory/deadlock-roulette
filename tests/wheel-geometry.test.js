import test from 'node:test';
import assert from 'node:assert/strict';
import { TAU, countBoundaryCrossings, slotAtPoint } from '../src/wheel-geometry.js';

test('clicks only correspond to real boundaries, including a one-item wheel', () => {
  const sectors = [{ start: 0 }, { start: Math.PI }];
  assert.equal(countBoundaryCrossings(.2, .3, sectors), 0);
  assert.equal(countBoundaryCrossings(Math.PI - .01, Math.PI + .01, sectors), 1);
  assert.equal(countBoundaryCrossings(0, TAU, sectors), 2);
  assert.equal(countBoundaryCrossings(0, 3 * TAU, [{ start: 0 }]), 3);
  assert.equal(countBoundaryCrossings(5, 5, sectors), 0);
});

test('late slow frames produce silence after the last crossed boundary, without catch-up', () => {
  const sectors = [{ start: 0 }, { start: Math.PI }];
  const frames = [Math.PI - .02, Math.PI + .01, Math.PI + .02, Math.PI + .024, Math.PI + .0241];
  const clicks = frames.slice(1).map((angle, index) => countBoundaryCrossings(frames[index], angle, sectors));
  assert.deepEqual(clicks, [1, 0, 0, 0]);
});

test('hover selects the displayed rotated sector while ignoring hub and outside', () => {
  const sectors = [{ start: 0, end: Math.PI }, { start: Math.PI, end: TAU }];
  assert.equal(slotAtPoint(sectors, 0, 70, 0, 30, 100), 0);
  assert.equal(slotAtPoint(sectors, Math.PI, 70, 0, 30, 100), 1);
  assert.equal(slotAtPoint(sectors, 0, 0, 0, 30, 100), -1);
  assert.equal(slotAtPoint(sectors, 0, 110, 0, 30, 100), -1);
});
