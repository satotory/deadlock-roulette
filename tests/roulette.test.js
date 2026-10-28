import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  MAX_WEIGHT,
  normalizeSettings,
  getItemWeight,
  getEligibleItems,
  calculateProbabilities,
  pickWeightedItem,
  randomUnitInterval,
} from '../src/roulette.js';

const item = (id, tier = 1, category = 'weapon') => ({ id, tier, category, name: id, cost: 800 });
const catalog = [item('one'), item('two'), item('three', 2), item('four', 3, 'vitality'), item('five', 4, 'spirit'), item('legendary', 5, 'spirit')];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≠ ${expected}`);

test('default weights apply per item and aggregate actual tier/category chances', () => {
  const result = calculateProbabilities(catalog);
  assert.equal(result.totalWeight, 14);
  assert.equal(result.eligibleCount, 5);
  near(result.items.find(entry => entry.item.id === 'one').probability, 4 / 14);
  near(result.byTier[1], 8 / 14);
  near(result.byTier[2], 3 / 14);
  near(result.byTier[3], 2 / 14);
  near(result.byTier[4], 1 / 14);
  assert.equal(result.byTier[5], 0);
  near(result.byCategory.weapon, 11 / 14);
  near(result.byCategory.vitality, 2 / 14);
  near(result.byCategory.spirit, 1 / 14);
});

test('selection uses precise weighted intervals including zero and just below one', () => {
  const select = random => pickWeightedItem(catalog, undefined, [], { random: () => random }).id;
  assert.equal(select(0), 'one');
  assert.equal(select(4 / 14 - 1e-10), 'one');
  assert.equal(select(4 / 14), 'two');
  assert.equal(select(8 / 14), 'three');
  assert.equal(select(11 / 14), 'four');
  assert.equal(select(13 / 14), 'five');
  assert.equal(select(1 - Number.EPSILON), 'five');
});

test('reject invalid randomness and draw exactly one random number per nonempty pick', () => {
  for (const value of [-1, 1, 2, NaN, Infinity, '0', null, undefined]) {
    assert.throws(() => pickWeightedItem(catalog, undefined, [], { random: () => value }), RangeError);
  }
  assert.throws(() => pickWeightedItem(catalog, undefined, [], { random: 0 }), TypeError);
  let calls = 0;
  pickWeightedItem(catalog, undefined, [], { random: () => { calls++; return 0.5; } });
  assert.equal(calls, 1);
});

test('category and individual multipliers multiply tier weights', () => {
  const settings = { categoryWeights: { weapon: 2 }, itemWeights: { one: 3 } };
  assert.equal(getItemWeight(catalog[0], settings), 24);
  assert.equal(getItemWeight(catalog[1], settings), 8);
  assert.equal(getItemWeight(catalog[3], settings), 2);
  const result = calculateProbabilities(catalog, settings);
  assert.equal(result.totalWeight, 41);
  near(result.items[0].probability, 24 / 41);
});

test('drawn items never return when changing filters, then return on explicit reset', () => {
  const drawn = new Set();
  while (getEligibleItems(catalog, undefined, drawn).length) {
    const selected = pickWeightedItem(catalog, undefined, drawn, { random: () => 0.5 });
    assert.ok(!drawn.has(selected.id));
    drawn.add(selected.id);
  }
  assert.equal(drawn.size, 5);
  assert.equal(pickWeightedItem(catalog, undefined, drawn), null);
  const changed = { enabledCategories: ['weapon'], tierWeights: { 1: 100 } };
  assert.deepEqual(getEligibleItems(catalog, changed, drawn), []);
  drawn.clear();
  assert.equal(getEligibleItems(catalog, changed, drawn).length, 3);
});

test('zero weights, explicit exclusions, category and tier filters remove items', () => {
  const settings = {
    enabledTiers: [1, 2, 5],
    enabledCategories: ['weapon', 'spirit'],
    tierWeights: { 2: 0 },
    itemWeights: { two: 0 },
    excludedIds: ['one'],
  };
  assert.deepEqual(getEligibleItems(catalog, settings).map(entry => entry.id), ['legendary']);
  assert.equal(pickWeightedItem(catalog, settings, [], { random: () => 0 }).id, 'legendary');
  assert.deepEqual(getEligibleItems(catalog, { categoryWeights: { weapon: 0, vitality: 0, spirit: 0 } }), []);
  assert.deepEqual(getEligibleItems(catalog, { enabledCategories: [] }), []);
  assert.deepEqual(getEligibleItems(catalog, { enabledTiers: [] }), []);
});

test('empty pools report zero probabilities and never consume randomness', () => {
  const result = calculateProbabilities(catalog, { tierWeights: { 1: 0, 2: 0, 3: 0, 4: 0 } });
  assert.equal(result.totalWeight, 0);
  assert.equal(result.eligibleCount, 0);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.byTier, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  assert.deepEqual(result.byCategory, { weapon: 0, vitality: 0, spirit: 0 });
  assert.equal(pickWeightedItem([], undefined, [], { random: () => { throw Error('must not be called'); } }), null);
});

test('import normalization rejects invalid values, caps huge weights, and preserves intentional zero', () => {
  const settings = normalizeSettings({
    enabledCategories: ['weapon', 'bad', 'weapon', null],
    enabledTiers: [1, 5, '2', 10, 1],
    tierWeights: { 1: 1e308, 2: -7, 3: '2.5', 4: null, 5: Infinity },
    categoryWeights: { weapon: NaN, vitality: 0, spirit: '0' },
    itemWeights: { one: 1e308, two: 'bad', three: null, '': 4 },
    excludedIds: ['one', 'one', 3, null, ''],
    disabledIds: ['two'],
    unexpected: true,
  });
  assert.deepEqual(settings.enabledCategories, ['weapon']);
  assert.deepEqual(settings.enabledTiers, [1, 5]);
  assert.deepEqual(settings.tierWeights, { 1: MAX_WEIGHT, 2: 0, 3: 2.5, 4: 1, 5: 1 });
  assert.deepEqual(settings.categoryWeights, { weapon: 1, vitality: 0, spirit: 0 });
  assert.deepEqual(settings.itemWeights, { one: MAX_WEIGHT, two: 1, three: 1 });
  assert.deepEqual(settings.excludedIds, ['one', 'two']);
  assert.equal(settings.unexpected, undefined);
  const huge = { tierWeights: { 1: 1e308 }, categoryWeights: { weapon: 1e308 }, itemWeights: { one: 1e308 } };
  assert.equal(getItemWeight(catalog[0], huge), 1e6);
  const probabilities = calculateProbabilities(catalog, huge);
  assert.ok(Number.isFinite(probabilities.totalWeight));
  near(probabilities.items.reduce((total, entry) => total + entry.probability, 0), 1);
});

test('normalization returns fresh settings and safely handles corrupt imports', () => {
  const normalized = normalizeSettings();
  normalized.enabledTiers.push(5);
  normalized.tierWeights[1] = 0;
  assert.deepEqual(DEFAULT_SETTINGS.enabledTiers, [1, 2, 3, 4]);
  assert.equal(DEFAULT_SETTINGS.tierWeights[1], 4);
  for (const value of [null, 2, 'invalid', []]) {
    assert.deepEqual(normalizeSettings(value), normalizeSettings());
  }
  const malicious = JSON.parse('{"itemWeights":{"__proto__":0},"tierWeights":{"1":"invalid"}}');
  assert.equal(getItemWeight(item('__proto__'), malicious), 0);
  assert.equal({}.polluted, undefined);
});

test('catalog corruption and duplicate IDs cannot create extra tickets', () => {
  const malformed = [null, {}, item(''), item('one'), item('one', 4), item('bad-category', 1, 'unknown'), item('bad-tier', 0)];
  assert.deepEqual(getEligibleItems(malformed).map(entry => entry.id), ['one']);
  assert.deepEqual(getEligibleItems(null), []);
  assert.equal(getItemWeight(item('bad', 7)), 0);
});

test('secure random source samples a full 53-bit uniform interval without modulo bias', () => {
  const source = (first, second) => ({ getRandomValues(values) { values[0] = first; values[1] = second; return values; } });
  assert.equal(randomUnitInterval(source(0, 0)), 0);
  assert.equal(randomUnitInterval(source(0x80000000, 0)), 0.5);
  assert.equal(randomUnitInterval(source(0xffffffff, 0xffffffff)), 1 - 1 / 2 ** 53);
  assert.equal(randomUnitInterval(source(2047, 0)), 0);
  assert.equal(randomUnitInterval(source(2048, 0)), 1 / 2 ** 21);
  assert.throws(() => randomUnitInterval(null), /secure randomness is unavailable/);
});
