import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBuildDistribution, calculateBuildAction, getBuildDrawnIds, calculateRouletteAction, pickWeightedDistribution } from '../src/draw-rules.js';
import { createBuildState } from '../src/build-core.js';
import { normalizeSettings, pickWeightedItem } from '../src/roulette.js';

const items = [1, 2, 3, 4, 5].flatMap(tier => Array.from({ length: 5 }, (_, index) => ({ id: `${tier}-${index}`, tier, category: index % 2 ? 'spirit' : 'weapon' })));
const settings = normalizeSettings({ tierWeights: { 1: 4, 2: 3, 3: 2, 4: 1 }, enabledTiers: [1, 2, 3, 4] });

test('each same-tier purchase suppresses all remaining items of that tier and undo restores it', () => {
  const build = createBuildState({ history: [{ itemId: '1-0' }, { itemId: '1-1' }, { itemId: '1-2' }] });
  const result = calculateBuildDistribution(items, settings, build);
  assert.equal(result.tierCounts[1], 3);
  assert.ok(Math.abs(result.decayFactors[1] - .008) < 1e-12);
  assert.ok(result.byTier[1] < .005);
  const chosen = pickWeightedItem(items, result.settings, build.history.map(entry => entry.itemId), { random: () => .99 });
  assert.equal(chosen.tier, 4);
  const removed = build.history.pop();
  build.consumedTicketIds = build.consumedTicketIds.filter(id => id !== removed.itemId);
  const undone = calculateBuildDistribution(items, settings, build);
  assert.ok(undone.byTier[1] > result.byTier[1]);
  assert.equal(undone.tierCounts[1], 2);
  assert.ok(undone.items.some(entry => entry.item.id === '1-2'));
  assert.deepEqual(settings.tierWeights, { 1: 4, 2: 3, 3: 2, 4: 1, 5: 1 });
});

test('build tier switches are independent and decay never excludes the only available tier', () => {
  const build = createBuildState({ enabledTiers: [4], history: [{ itemId: '4-0' }, { itemId: '4-1' }, { itemId: '4-2' }] });
  const result = calculateBuildDistribution(items, settings, build);
  assert.equal(result.byTier[4], 1);
  assert.equal(result.eligibleCount, 2);
  assert.ok(result.totalWeight > 0);
  build.enabledTiers = [];
  assert.equal(calculateBuildDistribution(items, settings, build).eligibleCount, 0);
  build.enabledTiers = [1]; build.dynamicWeights = false;
  assert.equal(calculateBuildDistribution(items, settings, build).decayFactors[4], 1);
  assert.deepEqual(settings.enabledTiers, [1, 2, 3, 4]);
});

test('adjacent-tier actions never jump disabled tiers or return already consumed items', () => {
  const drawn = ['1-0', '2-0'];
  const upgrade = calculateRouletteAction(items, settings, drawn, items[0], 'upgrade');
  assert.equal(upgrade.targetTier, 2);
  assert.ok(upgrade.items.every(entry => entry.item.tier === 2 && entry.item.id !== '2-0'));
  assert.equal(upgrade.consumes, true);
  const down = calculateRouletteAction(items, settings, drawn, { tier: 1 }, 'downgrade');
  assert.equal(down.eligibleCount, 0);
  assert.equal(calculateRouletteAction(items, { ...settings, enabledTiers: [1, 3] }, drawn, { tier: 1 }, 'upgrade').eligibleCount, 0);
  assert.equal(calculateRouletteAction(items, settings, drawn, null, 'upgrade').eligibleCount, 0);
  assert.equal(calculateRouletteAction(items, settings, drawn, { tier: 4 }, 'upgrade').eligibleCount, 0);
  assert.equal(calculateRouletteAction(items, { ...settings, enabledTiers: [1, 2, 3, 4, 5] }, drawn, { tier: 4 }, 'upgrade').targetTier, 5);
});

test('reroll is a nonconsuming weighted preview and honors zero weights and exclusions', () => {
  const source = normalizeSettings({ excludedIds: ['1-1'], itemWeights: { '1-2': 0 }, enabledCategories: ['weapon'] });
  const action = calculateRouletteAction(items, source, ['1-0'], null, 'reroll');
  assert.equal(action.consumes, false);
  assert.ok(action.items.every(entry => entry.item.category === 'weapon' && !['1-0', '1-1', '1-2'].includes(entry.item.id)));
  assert.ok(Math.abs(action.items.reduce((total, entry) => total + entry.probability, 0) - 1) < 1e-12);
});

test('build replacements use remaining inventory for tier decay and exclude original and discarded items', () => {
  const build = createBuildState({
    history: [{ itemId: '1-0' }, { itemId: '1-1' }, { itemId: '1-2' }],
    discardedItemIds: ['2-0'],
  });
  const before = JSON.stringify(build);
  const replacement = calculateBuildAction(items, settings, build, items.find(item => item.id === '1-2'), 'upgrade');
  assert.equal(replacement.replacesLast, true);
  assert.equal(replacement.consumes, true);
  assert.equal(replacement.targetTier, 2);
  assert.equal(replacement.tierCounts[1], 2);
  assert.equal(replacement.tierCounts[2], 0);
  assert.ok(Math.abs(replacement.decayFactors[1] - .04) < 1e-12);
  assert.ok(replacement.items.every(entry => entry.item.tier === 2 && entry.item.id !== '2-0'));
  assert.deepEqual([...replacement.drawnIds], ['1-0', '1-1', '1-2', '2-0']);
  // Selection uses the evaluated ticket weights, including independent pair tickets.
  const chosen = pickWeightedDistribution(replacement, { random: () => 0 });
  assert.equal(chosen.id, '2-1');
  assert.equal(JSON.stringify(build), before);

  build.discardedItemIds.push(build.history.at(-1).itemId);
  build.history.splice(-1, 1, { itemId: chosen.id });
  let after = calculateBuildDistribution(items, settings, build);
  assert.equal(after.tierCounts[1], 2);
  assert.equal(after.tierCounts[2], 1);
  assert.ok(!after.items.some(entry => ['1-2', '2-0', '2-1'].includes(entry.item.id)));
  build.history.pop();
  after = calculateBuildDistribution(items, settings, build);
  assert.equal(after.tierCounts[2], 0);
  assert.ok(after.items.some(entry => entry.item.id === '2-1'));
  assert.ok(!after.items.some(entry => ['1-2', '2-0'].includes(entry.item.id)));
});

test('build action distributions honor build tiers, disabled categories and per-item exclusions', () => {
  const build = createBuildState({ history: [{ itemId: '2-0' }], enabledTiers: [1, 2, 4] });
  const current = items.find(item => item.id === '2-0');
  assert.equal(calculateBuildAction(items, settings, build, current, 'upgrade').eligibleCount, 0);
  const down = calculateBuildAction(items, settings, build, current, 'downgrade');
  assert.equal(down.targetTier, 1);
  assert.ok(down.items.every(entry => entry.item.tier === 1));
  const reroll = calculateBuildAction(items, {
    ...settings, enabledCategories: ['weapon'], itemWeights: { '1-2': 0 }, excludedIds: ['1-0'],
  }, build, current, 'reroll');
  assert.ok(reroll.items.every(entry => entry.item.category === 'weapon' && !['1-0', '1-2', '2-0'].includes(entry.item.id)));
  assert.equal(reroll.replacesLast, true);
  assert.ok(Math.abs(reroll.items.reduce((total, entry) => total + entry.probability, 0) - 1) < 1e-12);
  assert.deepEqual(calculateBuildAction(items, settings, build, current, 'draw'), {
    ...calculateBuildDistribution(items, settings, build), targetTier: null, consumes: true, replacesLast: false,
  });
  assert.equal(calculateBuildAction(items, settings, createBuildState(), current, 'reroll').eligibleCount, 0);
  assert.equal(calculateBuildAction(items, settings, build, null, 'upgrade').eligibleCount, 0);
  assert.throws(() => calculateBuildAction(items, settings, build, current, 'unknown'), TypeError);
  assert.deepEqual([...getBuildDrawnIds({ history: [null, {}, { itemId: 'a' }, { itemId: 'a' }], discardedItemIds: ['b', '', 1] })], ['a', 'b']);
});
