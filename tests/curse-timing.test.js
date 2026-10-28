import test from 'node:test';
import assert from 'node:assert/strict';
import { curseTiming } from '../src/curse-timing.js';

test('curse messages retain a readable hold in normal, quick and reduced-motion modes', () => {
  const normal = curseTiming();
  assert.ok(normal.total >= 2600 && normal.total <= 3000);
  for (const timing of [normal, curseTiming({ quick: true }), curseTiming({ reducedMotion: true }), curseTiming({ quick: true, reducedMotion: true })]) {
    assert.ok(timing.total >= 1800);
    assert.ok(timing.hold >= 1300);
    assert.ok(timing.appear > 0 && timing.disappear > 0);
    assert.equal(timing.total, timing.appear + timing.hold + timing.disappear);
  }
});
