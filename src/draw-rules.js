import { getItemWeight, normalizeSettings, randomUnitInterval } from './roulette.js';
import { CHARGE_ITEM_IDS, CHARGE_GRANT_ITEM_IDS, ITEM_COMBOS, heroHasChargeAbility } from './game-item-rules.js';
import { canApplyBuildTicket, coalesceBuildInventory, getLatestBuildEntries, getLatestBuildEntry } from './build-inventory.js';
import { isRoyalEntryUnrevealed } from './build-fate-state.js';

export const BUILD_TIER_DECAY = .2;
export const COMBO_WEIGHT_MULTIPLIER = .35;
const TIERS = [1, 2, 3, 4, 5];
const CATEGORIES = ['weapon', 'vitality', 'spirit'];
const idOfEntry = entry => entry?.ticketId || entry?.comboOrigin || entry?.itemId;

/** Combo tickets are extra outcomes; they never replace either ordinary ticket. */
export function createItemTickets(items, { pairsEnabled = true, combos = ITEM_COMBOS } = {}) {
  const catalog = Array.isArray(items) ? items : [];
  if (!pairsEnabled) return [...catalog];
  const itemById = new Map(catalog.map(item => [item.id, item]));
  const seen = new Set(catalog.map(item => item.id));
  const pairs = [];
  for (const combo of Array.isArray(combos) ? combos : []) {
    if (!combo || typeof combo.id !== 'string' || seen.has(combo.id) || !Array.isArray(combo.itemIds)
      || combo.itemIds.length !== 2 || new Set(combo.itemIds).size !== 2 || combo.itemIds.some(id => !itemById.has(id))) continue;
    const components = combo.itemIds.map(id => itemById.get(id));
    seen.add(combo.id);
    pairs.push({ ...combo, combo: true, components, itemIds: [...combo.itemIds],
      name: combo.name || components.map(item => item.name).join(' + '),
      nameRu: combo.nameRu || components.map(item => item.nameRu || item.name).join(' + '),
      tier: Math.max(...components.map(item => item.tier)), category: components[0].category,
      cost: components.reduce((total, item) => total + (item.cost || 0), 0), image: components[0].image });
  }
  return [...catalog, ...pairs];
}

export function getBuildDrawnIds(build = {}) {
  const consumed = Array.isArray(build.consumedTicketIds) ? build.consumedTicketIds
    : Array.isArray(build.discardedItemIds) ? build.discardedItemIds : [];
  return new Set([
    ...(Array.isArray(build.history) ? build.history.map(idOfEntry) : []),
    ...consumed,
  ].filter(id => typeof id === 'string' && id.trim()));
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

/** Both halves must pass category, tier, exclusion, weight and hero restrictions. */
function calculateTicketProbabilities(items, settings, drawnIds, { pairsEnabled = true, combos = ITEM_COMBOS, heroId = null, chargeGrant = false, build = null, action = 'draw', targetTier = null } = {}) {
  const effective = normalizeSettings(settings);
  const unavailable = new Set([...effective.excludedIds, ...drawnIds]);
  const tickets = createItemTickets(items, { pairsEnabled, combos });
  const chargesAllowed = !heroId || heroHasChargeAbility(heroId) || chargeGrant;
  const entries = [];
  const seen = new Set();
  for (const ticket of tickets) {
    if (!ticket || typeof ticket.id !== 'string' || seen.has(ticket.id) || unavailable.has(ticket.id)) continue;
    seen.add(ticket.id);
    const components = ticket.combo ? ticket.components : [ticket];
    if (targetTier !== null && ticket.tier !== targetTier) continue;
    if (components.some(item => !effective.enabledCategories.includes(item.category)
      || !effective.enabledTiers.includes(item.tier) || effective.excludedIds.includes(item.id)
      || (!chargesAllowed && CHARGE_ITEM_IDS.includes(item.id)) || !(getItemWeight(item, effective) > 0))) continue;
    if (build && !canApplyBuildTicket(build, ticket, items, { action, assumeCanonical: true }).available) continue;
    const weights = components.map(item => getItemWeight(item, effective)
      * (build?.fate?.kingMode === 'decree' && build.fate.kingEdict === item.category ? 6 : 1));
    const multiplier = ticket.combo ? (effective.itemWeights[ticket.id] ?? 1) * COMBO_WEIGHT_MULTIPLIER : 1;
    const weight = (ticket.combo ? sum(weights) / weights.length : weights[0]) * multiplier;
    if (weight > 0 && Number.isFinite(weight)) entries.push({ item: ticket, weight });
  }
  const totalWeight = sum(entries.map(entry => entry.weight));
  const probabilities = entries.map(entry => ({ ...entry, probability: entry.weight / totalWeight }));
  return {
    items: probabilities,
    byTier: Object.fromEntries(TIERS.map(tier => [tier, sum(probabilities.filter(entry => entry.item.tier === tier).map(entry => entry.probability))])),
    byCategory: Object.fromEntries(CATEGORIES.map(category => [category, sum(probabilities.filter(entry => entry.item.category === category).map(entry => entry.probability))])),
    totalWeight, eligibleCount: probabilities.length, tickets,
  };
}

/** Select directly from the computed distribution without clamped proxy weights. */
export function pickWeightedDistribution(distribution, { random = randomUnitInterval } = {}) {
  const entries = distribution?.items;
  if (!Array.isArray(entries) || !entries.length || !(distribution.totalWeight > 0)) return null;
  if (typeof random !== 'function') throw new TypeError('random must be a function.');
  const value = random();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('random must return a finite number in [0, 1).');
  const threshold = value * distribution.totalWeight;
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.weight;
    if (threshold < cumulative) return entry.item;
  }
  return entries.at(-1).item;
}

function buildDistribution(items, settings, build, { action = 'draw', targetTier = null, ...options } = {}) {
  build = coalesceBuildInventory(build, items);
  const effective = normalizeSettings(settings);
  effective.enabledTiers = Array.isArray(build.enabledTiers) ? build.enabledTiers.filter(tier => Number.isInteger(tier) && TIERS.includes(tier)) : [1, 2, 3, 4];
  if (build.fate?.kingMode === 'decree') {
    if (build.fate.kingEdict === 'no-t1') effective.enabledTiers = effective.enabledTiers.filter(tier => tier !== 1);
  }
  const itemById = new Map(items.map(item => [item.id, item]));
  const latestIds = new Set(action === 'draw' ? [] : getLatestBuildEntries(build).map(entry => entry.itemId));
  const liveIds = new Set((build.history || []).filter(entry => !latestIds.has(entry.itemId)).map(entry => entry.itemId));
  const tierCounts = Object.fromEntries(TIERS.map(tier => [tier, 0]));
  for (const id of liveIds) {
    const tier = itemById.get(id)?.tier;
    if (Object.hasOwn(tierCounts, tier)) tierCounts[tier]++;
  }
  const decayFactors = Object.fromEntries(TIERS.map(tier => [tier, build.dynamicWeights === false ? 1 : BUILD_TIER_DECAY ** tierCounts[tier]]));
  for (const tier of TIERS) effective.tierWeights[tier] *= decayFactors[tier];
  const drawnIds = getBuildDrawnIds(build);
  const chargeGrant = [...liveIds].some(id => CHARGE_GRANT_ITEM_IDS.includes(id));
  const distribution = calculateTicketProbabilities(items, effective, drawnIds, {
    ...options, pairsEnabled: options.pairsEnabled ?? (build.pairsEnabled !== false),
    heroId: build.heroId, chargeGrant, build, action, targetTier,
  });
  const royal = action === 'draw' ? build.fate?.kingImpostorQueue?.[0] : null;
  // Keep ordinary pool probabilities; never expose a precommitted royal ID as a 100% ticket.
  if (royal && !distribution.items.some(entry => entry.item.id === royal.itemId)) {
    distribution.items = []; distribution.totalWeight = 0; distribution.eligibleCount = 0;
    distribution.byTier = Object.fromEntries(TIERS.map(tier => [tier, 0]));
    distribution.byCategory = Object.fromEntries(CATEGORIES.map(category => [category, 0]));
  }
  return { ...distribution, settings: effective, tierCounts, decayFactors, drawnIds };
}

/** Counts reflect live slots after merges; undo restores the corresponding weight. */
export function calculateBuildDistribution(items, settings, build, options = {}) {
  return buildDistribution(items, settings, build, options);
}

/** Replace the latest draw group even when starter insertion moved it to slot 1. */
export function calculateBuildAction(items, settings, build, currentItem, action = 'draw', options = {}) {
  if (!['draw', 'reroll', 'upgrade', 'downgrade'].includes(action)) throw new TypeError('Unknown build action.');
  if (action === 'draw') return { ...calculateBuildDistribution(items, settings, build, options), targetTier: null, consumes: true, replacesLast: false };
  const latestEntries = getLatestBuildEntries(build);
  const targetTier = action === 'upgrade' || action === 'downgrade' ? currentItem?.tier + (action === 'upgrade' ? 1 : -1) : null;
  const valid = latestEntries.length && currentItem && !latestEntries.some(entry => entry.cursed === true || entry.locked === true || isRoyalEntryUnrevealed(build, entry));
  const scope = valid ? build : { ...build, enabledTiers: [] };
  return { ...buildDistribution(items, settings, scope, { ...options, action, targetTier }), targetTier, consumes: true, replacesLast: true };
}

/** Normal roulette also gives combos independent tickets and preserves filters. */
export function calculateRouletteAction(items, settings, drawnIds, currentItem, action = 'draw', options = {}) {
  if (!['draw', 'reroll', 'upgrade', 'downgrade'].includes(action)) throw new TypeError('Unknown roulette action.');
  const effective = normalizeSettings(settings);
  const targetTier = action === 'upgrade' || action === 'downgrade' ? currentItem?.tier + (action === 'upgrade' ? 1 : -1) : null;
  return { ...calculateTicketProbabilities(items, effective, drawnIds, { ...options, targetTier }), settings: effective, drawnIds: new Set(drawnIds), targetTier, consumes: action !== 'reroll' };
}

export function getLatestBuildResult(build, items, options = {}) {
  const entries = getLatestBuildEntries(build);
  const entry = getLatestBuildEntry(build);
  if (!entry) return { entry: null, item: null, entries: [] };
  const ticketId = entry.ticketId || entry.comboOrigin || entry.itemId;
  const item = createItemTickets(items, options).find(ticket => ticket.id === ticketId)
    || items.find(candidate => candidate.id === entry.itemId) || null;
  return { entry, item, entries };
}
