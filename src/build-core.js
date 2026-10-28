import { randomUnitInterval } from './roulette.js';
import { createItemActionState } from './item-actions.js';
import { normalizeHistory } from './history.js';
import { normalizeBuildPurchasePlan } from './build-purchase-plan.js';
import { normalizeBuildFate } from './build-fate-state.js';

export const DEFAULT_UPGRADE_COSTS = Object.freeze([1, 2, 5]);
export const DEFAULT_INVENTORY_SLOTS = 12;
export const MAX_BUILD_NAME_LENGTH = 60;
export const MAX_INVENTORY_UNDO = 24;
const validTicketId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const uniqueTicketIds = value => Array.isArray(value) ? [...new Set(value.filter(validTicketId))].slice(0, 512) : [];

/** Snapshot only the inventory transaction; action charges are never refunded. */
export function normalizeInventoryUndo(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_INVENTORY_UNDO).filter(snapshot => snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)).map(snapshot => ({
    history: normalizeHistory(snapshot.history).slice(0, DEFAULT_INVENTORY_SLOTS),
    purchasePlan: Array.isArray(snapshot.purchasePlan) ? normalizeBuildPurchasePlan(snapshot.purchasePlan) : null,
    discardedItemIds: uniqueTicketIds(snapshot.discardedItemIds),
    consumedTicketIds: uniqueTicketIds(snapshot.consumedTicketIds),
    latestDrawId: validTicketId(snapshot.latestDrawId) ? snapshot.latestDrawId : null,
    drawId: validTicketId(snapshot.drawId) ? snapshot.drawId : null,
    blocked: snapshot.blocked === true,
  }));
}

export function normalizeBuildName(value) {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return [...clean].slice(0, MAX_BUILD_NAME_LENGTH).join('');
}

function randomIndex(length, random) {
  const value = random();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('random must return a finite number in [0, 1).');
  }
  return Math.floor(value * length);
}

/** A uniform draw from the enabled hero pool; rerolls intentionally allow repeats. */
export function pickHero(heroes, excludedIds = [], { random = randomUnitInterval } = {}) {
  const excluded = new Set(excludedIds);
  const seen = new Set();
  const pool = (Array.isArray(heroes) ? heroes : []).filter(hero => {
    if (!hero || typeof hero.id !== 'string' || seen.has(hero.id)) return false;
    seen.add(hero.id);
    return !excluded.has(hero.id);
  });
  return pool.length ? pool[randomIndex(pool.length, random)] : null;
}

export function shuffled(values, { random = randomUnitInterval } = {}) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = randomIndex(index + 1, random);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/**
 * Each step draws uniformly from abilities that can still be upgraded. A rank
 * can only follow the previous rank of the same ability. Unlocks and upgrades
 * are kept separately because unlocking an ability does not spend upgrade AP.
 */
export function generateSkillPlan(hero, { random = randomUnitInterval, costs = DEFAULT_UPGRADE_COSTS } = {}) {
  const abilities = Array.isArray(hero?.abilities) ? hero.abilities.slice(0, 4) : [];
  if (abilities.length !== 4 || abilities.some(ability => !ability || ![1, 2, 3, 4].includes(ability.slot))
    || new Set(abilities.map(ability => ability.slot)).size !== 4) return { unlockOrder: [], skillPlan: [] };
  // The ultimate is gated until the fourth unlock; only basic ability order is random.
  const unlockOrder = [...shuffled([1, 2, 3], { random }), 4];
  const ranks = abilities.map(() => 0);
  const skillPlan = [];
  let cumulativeCost = 0;
  while (ranks.some(rank => rank < costs.length)) {
    const options = ranks.map((rank, index) => rank < costs.length ? index : -1)
      .filter(index => index >= 0 && (skillPlan.length || abilities[index].slot === unlockOrder[0]));
    const index = options[randomIndex(options.length, random)];
    const rank = ++ranks[index];
    const ability = abilities[index];
    const cost = costs[rank - 1];
    cumulativeCost += cost;
    skillPlan.push({ abilityId: String(ability.id), slot: ability.slot, rank, cost, cumulativeCost });
  }
  return { unlockOrder, skillPlan };
}

/** Reject malformed imported plans, preserving the legal prefix only. */
export function normalizeSkillPlan(plan, costs = DEFAULT_UPGRADE_COSTS) {
  if (!Array.isArray(plan)) return [];
  const ranks = new Map([[1, 0], [2, 0], [3, 0], [4, 0]]);
  let cumulativeCost = 0;
  const normalized = [];
  for (const step of plan.slice(0, costs.length * 4)) {
    if (!step || !ranks.has(step.slot) || step.rank !== ranks.get(step.slot) + 1 || step.rank > costs.length) break;
    const cost = costs[step.rank - 1];
    cumulativeCost += cost;
    ranks.set(step.slot, step.rank);
    normalized.push({ abilityId: String(step.abilityId ?? ''), slot: step.slot, rank: step.rank, cost, cumulativeCost });
  }
  return normalized;
}

export function createBuildState(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const skillPlan = normalizeSkillPlan(source.skillPlan);
  const unlockOrder = Array.isArray(source.unlockOrder) ? [...new Set(source.unlockOrder.filter(slot => [1, 2, 3, 4].includes(slot)))] : [];
  return {
    name: normalizeBuildName(source.name),
    heroId: typeof source.heroId === 'string' ? source.heroId : null,
    excludedHeroIds: Array.isArray(source.excludedHeroIds) ? [...new Set(source.excludedHeroIds.filter(id => typeof id === 'string'))] : [],
    enabledTiers: Array.isArray(source.enabledTiers) ? [...new Set(source.enabledTiers.filter(tier => Number.isInteger(tier) && tier >= 1 && tier <= 5))] : [1, 2, 3, 4],
    dynamicWeights: typeof source.dynamicWeights === 'boolean' ? source.dynamicWeights : true,
    starterOrderVersion: source.starterOrderVersion === 1 || !source.history?.length ? 1 : 0,
    history: Array.isArray(source.history) ? source.history : [],
    purchasePlan: Array.isArray(source.purchasePlan) ? normalizeBuildPurchasePlan(source.purchasePlan)
      : source.history?.length ? null : [],
    nextAcquiredOrder: Number.isSafeInteger(source.nextAcquiredOrder) && source.nextAcquiredOrder >= 0 ? source.nextAcquiredOrder
      : Math.max(0, ...(Array.isArray(source.history) ? source.history.map(entry => Number.isSafeInteger(entry?.acquiredOrder) && entry.acquiredOrder > 0 ? entry.acquiredOrder : 0) : [])),
    fate: normalizeBuildFate(source.fate),
    discardedItemIds: Array.isArray(source.discardedItemIds) ? [...new Set(source.discardedItemIds.filter(id => typeof id === 'string' && id.trim()))] : [],
    consumedTicketIds: Array.isArray(source.consumedTicketIds) ? uniqueTicketIds(source.consumedTicketIds)
      : uniqueTicketIds([...(Array.isArray(source.history) ? source.history.map(entry => entry?.ticketId || entry?.comboOrigin || entry?.itemId) : []), ...(Array.isArray(source.discardedItemIds) ? source.discardedItemIds : [])]),
    latestDrawId: validTicketId(source.latestDrawId) ? source.latestDrawId
      : validTicketId(source.history?.at?.(-1)?.drawId) ? source.history.at(-1).drawId : null,
    inventoryUndo: normalizeInventoryUndo(source.inventoryUndo),
    itemActions: createItemActionState(source.itemActions),
    skillPlan,
    checkedSkills: Array.isArray(source.checkedSkills) ? [...new Set(source.checkedSkills.filter(index => Number.isInteger(index) && index >= 0 && index < skillPlan.length))] : [],
    unlockOrder: unlockOrder.length === 4 && unlockOrder.at(-1) === 4 ? unlockOrder : [],
    generatedAt: typeof source.generatedAt === 'number' && Number.isFinite(source.generatedAt) && source.generatedAt >= 0 ? source.generatedAt : null,
  };
}
