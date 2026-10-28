import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildState, generateSkillPlan, normalizeSkillPlan, pickHero, shuffled } from '../src/build-core.js';

const heroes = ['a', 'b', 'c'].map(id => ({ id, name: id, abilities: [1, 2, 3, 4].map(slot => ({ id: `${id}-${slot}`, slot, name: `${slot}` })) }));

test('hero selection uses uniform intervals and excludes disabled heroes', () => {
  assert.equal(pickHero(heroes, [], { random: () => 0 }).id, 'a');
  assert.equal(pickHero(heroes, [], { random: () => 1 / 3 }).id, 'b');
  assert.equal(pickHero(heroes, [], { random: () => .999999 }).id, 'c');
  assert.equal(pickHero(heroes, ['a', 'c'], { random: () => .999999 }).id, 'b');
  assert.equal(pickHero(heroes, ['a', 'b', 'c'], { random: () => 0 }), null);
  assert.equal(pickHero([...heroes, heroes[0]], [], { random: () => .999999 }).id, 'c');
  assert.equal(pickHero(heroes, [], { random: () => 0 }).id, pickHero(heroes, [], { random: () => 0 }).id);
});

test('hero and skill selection reject invalid random generators', () => {
  for (const value of [-1, 1, NaN, Infinity, '0']) {
    assert.throws(() => pickHero(heroes, [], { random: () => value }), RangeError);
    assert.throws(() => generateSkillPlan(heroes[0], { random: () => value }), RangeError);
  }
});

test('skill plans preserve rank prerequisites, exhaust four abilities and track AP', () => {
  for (const constant of [0, .2, .5, .9, .999999]) {
    const { unlockOrder, skillPlan } = generateSkillPlan(heroes[0], { random: () => constant });
    assert.deepEqual([...unlockOrder].sort(), [1, 2, 3, 4]);
    assert.equal(unlockOrder.at(-1), 4);
    assert.equal(skillPlan.length, 12);
    assert.notEqual(skillPlan[0].slot, 4);
    assert.equal(skillPlan[0].slot, unlockOrder[0]);
    const ranks = [0, 0, 0, 0];
    let total = 0;
    for (const step of skillPlan) {
      assert.equal(step.rank, ++ranks[step.slot - 1]);
      assert.equal(step.abilityId, `a-${step.slot}`);
      assert.equal(step.cost, [1, 2, 5][step.rank - 1]);
      total += step.cost;
      assert.equal(step.cumulativeCost, total);
    }
    assert.deepEqual(ranks, [3, 3, 3, 3]);
    assert.equal(total, 32);
    assert.deepEqual(normalizeSkillPlan(skillPlan), skillPlan);
  }
});

test('missing or malformed ability data produces no fictional skill plan', () => {
  for (const hero of [null, {}, { abilities: [] }, { abilities: heroes[0].abilities.slice(0, 3) }, { abilities: [{ slot: 1 }, { slot: 1 }, { slot: 3 }, { slot: 4 }] }, { abilities: [{ slot: 1 }, { slot: 2 }, { slot: 3 }, { slot: 9 }] }]) {
    assert.deepEqual(generateSkillPlan(hero), { unlockOrder: [], skillPlan: [] });
  }
});

test('imported skill plans keep only legal steps and recompute point totals', () => {
  const result = normalizeSkillPlan([
    { abilityId: 'a-1', slot: 1, rank: 1, cost: -99, cumulativeCost: 999 },
    { abilityId: 'a-2', slot: 2, rank: 1, cost: 9 },
    { abilityId: 'a-1', slot: 1, rank: 3 },
    { abilityId: 'a-3', slot: 3, rank: 1 },
  ]);
  assert.deepEqual(result, [
    { abilityId: 'a-1', slot: 1, rank: 1, cost: 1, cumulativeCost: 1 },
    { abilityId: 'a-2', slot: 2, rank: 1, cost: 1, cumulativeCost: 2 },
  ]);
});

test('build state restores the selection, pool, skill checks and independent inventory', () => {
  const plan = generateSkillPlan(heroes[0], { random: () => .5 });
  const raw = { heroId: 'a', excludedHeroIds: ['b', 'b', 6], history: [{ itemId: 'x' }], ...plan, checkedSkills: [0, 3, 3, 12, -1, '2'], generatedAt: 123 };
  const state = createBuildState(raw);
  assert.deepEqual(state.excludedHeroIds, ['b']);
  assert.deepEqual(state.checkedSkills, [0, 3]);
  assert.equal(state.generatedAt, 123);
  assert.equal(state.history[0].itemId, 'x');
  assert.deepEqual(createBuildState(JSON.parse(JSON.stringify(state))), state);
  assert.deepEqual(createBuildState(null), { name: '', heroId: null, excludedHeroIds: [], enabledTiers: [1, 2, 3, 4], dynamicWeights: true, starterOrderVersion: 1, history: [], purchasePlan: [], nextAcquiredOrder: 0, fate: { chickenUsed: false, archmotherUsed: false, kingActive: false, kingMode: null, kingEdict: null, kingBoundaryOrder: 0, kingImpostorQueue: [], totalLocked: false, pendingArchmother: null, pendingChicken: null, pendingKing: null, journal: [], revealedPurchaseKeys: [] }, discardedItemIds: [], consumedTicketIds: [], latestDrawId: null, inventoryUndo: [], itemActions: { usedActions: [], modifiedDrawIds: [] }, skillPlan: [], checkedSkills: [], unlockOrder: [], generatedAt: null });
  assert.deepEqual(createBuildState({ enabledTiers: [4, 4, '2', 0, 6], dynamicWeights: false }).enabledTiers, [4]);
  assert.deepEqual(createBuildState({ enabledTiers: [] }).enabledTiers, []);
});

test('build state restores one-use action charges and permanently discarded originals', () => {
  const raw = {
    discardedItemIds: ['old-1', 'old-1', '', null, 'old-2'],
    itemActions: { usedActions: ['upgrade', 'upgrade', 'invalid'], modifiedDrawIds: ['source-1', 'result-1', 'result-1', '<script>'] },
  };
  const build = createBuildState(raw);
  assert.deepEqual(build.discardedItemIds, ['old-1', 'old-2']);
  assert.deepEqual(build.itemActions, { usedActions: ['upgrade'], modifiedDrawIds: ['source-1', 'result-1'] });
  assert.deepEqual(createBuildState(JSON.parse(JSON.stringify(build))), build);
  assert.notEqual(build.discardedItemIds, raw.discardedItemIds);
  assert.notEqual(build.itemActions.usedActions, raw.itemActions.usedActions);
});

test('Fisher–Yates creates a permutation without mutating its input', () => {
  const input = [1, 2, 3, 4];
  assert.deepEqual(shuffled(input, { random: () => 0 }), [2, 3, 4, 1]);
  assert.deepEqual(input, [1, 2, 3, 4]);
});
