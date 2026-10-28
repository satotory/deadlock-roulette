import test from 'node:test';
import assert from 'node:assert/strict';
import { createReelPlan, reelPosition, reelDuration } from '../src/reel-motion.js';

const pool = ['allowed-a', 'allowed-b', 'winner'].map(id => ({ id }));

test('visual reels use eligible neighbors and land on the separately chosen winner', () => {
  const plan = createReelPlan(pool, pool[2], { random: () => .73 });
  assert.equal(plan.entries[plan.landingIndex], pool[2]);
  assert.ok(plan.entries.every(entry => pool.includes(entry)));
  assert.notEqual(plan.entries[plan.landingIndex - 1].id, 'winner');
  assert.notEqual(plan.entries[plan.landingIndex + 1].id, 'winner');
  assert.equal(reelPosition(plan, 0), 1);
  assert.equal(reelPosition(plan, reelDuration(plan)), plan.landingIndex);
  assert.equal(reelPosition(plan, reelDuration(plan) + 100), plan.landingIndex);
});

test('the continuous reel slows its last cards and settles with a spring on either side', () => {
  for (const randomValue of [.2, .8]) {
    const plan = createReelPlan(pool, pool[2], { random: () => randomValue });
    assert.ok(reelDuration(plan) > 6500);
    const speed = elapsed => reelPosition(plan, elapsed + 10) - reelPosition(plan, elapsed);
    assert.ok(speed(1000) > speed(4000) * 2);
    assert.ok(speed(4000) > speed(5400) * 2);
    let previous = reelPosition(plan, 0);
    for (let elapsed = 16; elapsed < plan.travelDuration; elapsed += 16) {
      const position = reelPosition(plan, elapsed);
      assert.ok(position >= previous, 'Travel is continuous and never swaps backward');
      previous = position;
    }
    const edge = reelPosition(plan, plan.travelDuration) - plan.landingIndex;
    const returnSide = reelPosition(plan, plan.travelDuration + plan.settleDuration * .45) - plan.landingIndex;
    assert.ok(edge * returnSide < 0, 'The spring crosses the chosen center');
    assert.equal(Math.round(reelPosition(plan, plan.travelDuration)), plan.landingIndex);
  }
});

test('quick reels retain the same effect and a one-entry pool always shows that entry', () => {
  const plan = createReelPlan([pool[2]], pool[2], { random: () => .2, quick: true });
  assert.ok(reelDuration(plan) >= 2200 && reelDuration(plan) <= 2500);
  assert.ok(plan.entries.every(entry => entry === pool[2]));
  assert.equal(reelPosition(plan, reelDuration(plan)), plan.landingIndex);
  for (const invalid of [-1, 1, NaN, Infinity, '0']) {
    assert.throws(() => createReelPlan(pool, pool[2], { random: () => invalid }), RangeError);
  }
});

test('five-card supply reels keep two complete neighbors visible at both ends', () => {
  const plan = createReelPlan(pool, pool[2], { random: () => .4, neighbors: 2 });
  assert.equal(plan.startIndex, 2);
  assert.equal(plan.neighbors, 2);
  assert.ok(plan.entries[plan.startIndex - 2]);
  assert.ok(plan.entries[plan.landingIndex + 2]);
  assert.equal(plan.entries[plan.landingIndex], pool[2]);
  assert.equal(reelPosition(plan, reelDuration(plan)), plan.landingIndex);
  assert.equal(reelDuration(plan), reelDuration(createReelPlan(pool, pool[2], { random: () => .4 })));
});
