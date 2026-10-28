/** The tier weight applies to each item, rather than to the tier as a whole. */
export const DEFAULT_SETTINGS = Object.freeze({
  enabledCategories: Object.freeze(['weapon', 'vitality', 'spirit']),
  enabledTiers: Object.freeze([1, 2, 3, 4]),
  tierWeights: Object.freeze({ 1: 4, 2: 3, 3: 2, 4: 1, 5: 1 }),
  categoryWeights: Object.freeze({ weapon: 1, vitality: 1, spirit: 1 }),
  itemWeights: Object.freeze({}),
  excludedIds: Object.freeze([]),
});

export const MAX_WEIGHT = 100;
const CATEGORIES = ['weapon', 'vitality', 'spirit'];
const TIERS = [1, 2, 3, 4, 5];

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function weight(value, fallback) {
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  if (typeof value === 'string' && !value.trim()) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(MAX_WEIGHT, Math.max(0, number)) : fallback;
}

function ids(value) {
  if (!Array.isArray(value) && !(value instanceof Set)) return [];
  return [...new Set([...value].filter(id => typeof id === 'string' && id.trim()))];
}

/** Return a fresh, validated settings object, also suitable for imported JSON. */
export function normalizeSettings(input = {}) {
  const source = record(input);
  const tierWeights = record(source.tierWeights);
  const categoryWeights = record(source.categoryWeights);
  const itemWeights = record(source.itemWeights);
  return {
    enabledCategories: Array.isArray(source.enabledCategories)
      ? [...new Set(source.enabledCategories.filter(category => CATEGORIES.includes(category)))]
      : [...DEFAULT_SETTINGS.enabledCategories],
    enabledTiers: Array.isArray(source.enabledTiers)
      ? [...new Set(source.enabledTiers.filter(tier => Number.isInteger(tier) && TIERS.includes(tier)))]
      : [...DEFAULT_SETTINGS.enabledTiers],
    tierWeights: Object.fromEntries(TIERS.map(tier => [tier, weight(tierWeights[tier], DEFAULT_SETTINGS.tierWeights[tier])])),
    categoryWeights: Object.fromEntries(CATEGORIES.map(category => [category, weight(categoryWeights[category], 1)])),
    itemWeights: Object.fromEntries(Object.entries(itemWeights)
      .filter(([id]) => id.trim())
      .map(([id, value]) => [id, weight(value, 1)])),
    excludedIds: ids([...(ids(source.excludedIds)), ...(ids(source.disabledIds))]),
  };
}

function itemWeight(item, settings) {
  if (!item || !CATEGORIES.includes(item.category) || !TIERS.includes(item.tier)) return 0;
  const multiplier = Object.hasOwn(settings.itemWeights, item.id) ? settings.itemWeights[item.id] : 1;
  return settings.tierWeights[item.tier] * settings.categoryWeights[item.category] * multiplier;
}

/** Tier weight × category weight × optional per-item multiplier. */
export function getItemWeight(item, settings = DEFAULT_SETTINGS) {
  return itemWeight(item, normalizeSettings(settings));
}

function eligibleItems(items, settings, drawnIds) {
  if (!Array.isArray(items)) return [];
  const unavailable = new Set([...settings.excludedIds, ...ids(drawnIds)]);
  const seen = new Set();
  return items.filter(item => {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || seen.has(item.id)) return false;
    seen.add(item.id);
    return !unavailable.has(item.id)
      && settings.enabledCategories.includes(item.category)
      && settings.enabledTiers.includes(item.tier)
      && itemWeight(item, settings) > 0;
  });
}

/** Drawn IDs remain excluded when category, tier, or weight settings change. */
export function getEligibleItems(items, settings = DEFAULT_SETTINGS, drawnIds = []) {
  return eligibleItems(items, normalizeSettings(settings), drawnIds);
}

function sum(values) {
  let total = 0;
  let correction = 0;
  for (const value of values) {
    const adjusted = value - correction;
    const next = total + adjusted;
    correction = (next - total) - adjusted;
    total = next;
  }
  return total;
}

/** All probability values are fractions in [0, 1]; empty pools return zeros. */
export function calculateProbabilities(items, settings = DEFAULT_SETTINGS, drawnIds = []) {
  const normalized = normalizeSettings(settings);
  const entries = eligibleItems(items, normalized, drawnIds)
    .map(item => ({ item, weight: itemWeight(item, normalized) }));
  const totalWeight = sum(entries.map(entry => entry.weight));
  const probabilities = entries.map(entry => ({ ...entry, probability: entry.weight / totalWeight }));
  return {
    items: probabilities,
    byTier: Object.fromEntries(TIERS.map(tier => [tier, sum(probabilities.filter(entry => entry.item.tier === tier).map(entry => entry.probability))])),
    byCategory: Object.fromEntries(CATEGORIES.map(category => [category, sum(probabilities.filter(entry => entry.item.category === category).map(entry => entry.probability))])),
    totalWeight,
    eligibleCount: entries.length,
  };
}

/** Uniform 53-bit sampling from Web Crypto; no modulo operation or Math.random. */
export function randomUnitInterval(cryptoSource = globalThis.crypto) {
  if (!cryptoSource || typeof cryptoSource.getRandomValues !== 'function') {
    throw new Error('Cryptographically secure randomness is unavailable in this environment.');
  }
  const values = new Uint32Array(2);
  cryptoSource.getRandomValues(values);
  return ((values[0] >>> 11) * 0x100000000 + values[1]) / 0x20000000000000;
}

/**
 * Return the chosen catalog item, or null when the pool is empty.
 * The caller records item.id in its drawn set and clears that set only on reset.
 * Tests may inject { random: () => number }, with a result in [0, 1).
 */
export function pickWeightedItem(items, settings = DEFAULT_SETTINGS, drawnIds = [], { random = randomUnitInterval } = {}) {
  const distribution = calculateProbabilities(items, settings, drawnIds);
  if (!distribution.eligibleCount) return null;
  if (typeof random !== 'function') throw new TypeError('random must be a function.');
  const value = random();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('random must return a finite number greater than or equal to 0 and less than 1.');
  }
  const threshold = value * distribution.totalWeight;
  let cumulative = 0;
  for (const entry of distribution.items) {
    cumulative += entry.weight;
    if (threshold < cumulative) return entry.item;
  }
  // Floating-point multiplication/addition may round the final boundary upward.
  return distribution.items.at(-1).item;
}
