import { normalizeHistory } from './history.js';
import { ITEM_UPGRADE_PARENTS } from './game-item-rules.js';
import catalog from './catalog-data.js';
import { canonicalTicketHistory } from './ticket-history.js';

export const MAX_PURCHASE_STEPS = 512;

const validId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const itemMap = items => items instanceof Map ? items : new Map((Array.isArray(items) ? items : []).map(item => [item.id, item]));

function ancestorsOf(itemId, relations) {
  const found = new Set();
  const pending = [...(relations[itemId] || [])];
  while (pending.length) {
    const id = pending.pop();
    if (!validId(id) || id === itemId || found.has(id)) continue;
    found.add(id);
    pending.push(...(relations[id] || []));
  }
  return found;
}

/** One purchase per actual item, with optional recipe links and immutable draw metadata. */
export function normalizeBuildPurchasePlan(raw, knownIds, { relations = ITEM_UPGRADE_PARENTS } = {}) {
  if (!Array.isArray(raw)) return [];
  const sources = new Map();
  for (const entry of raw) if (entry && typeof entry.itemId === 'string' && !sources.has(entry.itemId)) sources.set(entry.itemId, entry);
  return canonicalTicketHistory(raw, knownIds, { inventory: true }).slice(0, MAX_PURCHASE_STEPS).map(entry => {
    const ancestors = ancestorsOf(entry.itemId, relations);
    const rawParents = sources.get(entry.itemId)?.upgradeFromIds;
    const upgradeFromIds = Array.isArray(rawParents)
      ? [...new Set(rawParents.filter(id => validId(id) && ancestors.has(id) && (!knownIds || knownIds.has(id))))]
      : [];
    const step = { ...entry, ...(upgradeFromIds.length ? { upgradeFromIds } : {}) };
    delete step.itemIds;
    return step;
  });
}

/** Keep only purchases contributing to the current final inventory, never reroll history. */
export function pruneBuildPurchasePlan(plan, history, { relations = ITEM_UPGRADE_PARENTS, knownIds } = {}) {
  const live = normalizeHistory(history, knownIds);
  const neededIds = new Set(live.map(entry => entry.itemId));
  for (const entry of live) for (const id of ancestorsOf(entry.itemId, relations)) neededIds.add(id);
  const steps = normalizeBuildPurchasePlan(plan, knownIds, { relations }).filter(entry => neededIds.has(entry.itemId));
  const planned = new Set(steps.map(entry => entry.itemId));
  for (const entry of live) if (!planned.has(entry.itemId)) {
    steps.push({ ...entry });
    planned.add(entry.itemId);
  }
  // Repair imported upgrade-before-component routes without inventing purchases.
  const topological = [];
  const visited = new Set();
  const visiting = new Set();
  const emit = entry => {
    if (visited.has(entry.itemId) || visiting.has(entry.itemId)) return;
    visiting.add(entry.itemId);
    const ancestors = ancestorsOf(entry.itemId, relations);
    for (const parent of steps) if (ancestors.has(parent.itemId)) emit(parent);
    visiting.delete(entry.itemId);
    visited.add(entry.itemId);
    topological.push(entry);
  };
  steps.forEach(emit);
  const liveById = new Map(live.map(entry => [entry.itemId, entry]));
  const previousIds = [];
  return topological.map(entry => {
    const ancestors = ancestorsOf(entry.itemId, relations);
    const candidates = previousIds.filter(id => ancestors.has(id));
    // Link the nearest observed component(s), so B → U → V stays a readable chain.
    const upgradeFromIds = candidates.filter(id => !candidates.some(other => other !== id && ancestorsOf(other, relations).has(id)));
    previousIds.push(entry.itemId);
    const result = { ...entry };
    delete result.upgradeFromIds;
    if (upgradeFromIds.length) result.upgradeFromIds = upgradeFromIds;
    if (liveById.get(entry.itemId)?.cursed === true) result.cursed = true;
    if (liveById.get(entry.itemId)?.sealed === true && entry.drawId === liveById.get(entry.itemId)?.drawId) result.sealed = true;
    if (liveById.get(entry.itemId)?.chickenOrigin === true) result.chickenOrigin = true;
    return result;
  });
}

/** Recover only confirmed recipe ancestors, never discarded unrelated reroll originals. */
export function migrateBuildPurchasePlan(build = {}, items = [], { relations = ITEM_UPGRADE_PARENTS, knownIds } = {}) {
  const supplied = itemMap(items);
  if (!knownIds && supplied.size) knownIds = new Set(supplied.keys());
  const catalogById = supplied.size ? supplied : itemMap(catalog.items);
  const history = normalizeHistory(build.history, knownIds);
  const needed = new Set(history.map(entry => entry.itemId));
  for (const entry of history) for (const id of ancestorsOf(entry.itemId, relations)) needed.add(id);
  const observed = new Map();
  const snapshots = Array.isArray(build.inventoryUndo) ? build.inventoryUndo : [];
  for (const snapshot of snapshots) {
    const proof = [...(Array.isArray(snapshot.purchasePlan) ? snapshot.purchasePlan : []), ...(Array.isArray(snapshot.history) ? snapshot.history : [])];
    for (const entry of normalizeHistory(proof, knownIds)) if (needed.has(entry.itemId) && !observed.has(entry.itemId)) observed.set(entry.itemId, entry);
  }
  for (const entry of history) if (!observed.has(entry.itemId)) observed.set(entry.itemId, entry);
  for (const id of Array.isArray(build.discardedItemIds) ? build.discardedItemIds : []) {
    if (!validId(id) || !needed.has(id) || observed.has(id) || (knownIds && !knownIds.has(id))) continue;
    const upgrade = history.find(entry => ancestorsOf(entry.itemId, relations).has(id));
    if (!upgrade) continue;
    observed.set(id, { itemId: id, drawId: `purchase-restored-${id}`.slice(0, 128), time: Math.max(0, upgrade.time - 1), probability: 0, weight: 0 });
  }
  const ordered = [...observed.values()].map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.time - b.entry.time || a.index - b.index).map(record => record.entry);
  const orderedById = new Map(ordered.map(entry => [entry.itemId, entry]));
  const result = [];
  const visited = new Set();
  const visiting = new Set();
  const emit = entry => {
    if (visited.has(entry.itemId) || visiting.has(entry.itemId)) return;
    visiting.add(entry.itemId);
    for (const candidate of ordered) if (candidate.itemId !== entry.itemId && ancestorsOf(entry.itemId, relations).has(candidate.itemId)) emit(orderedById.get(candidate.itemId));
    visiting.delete(entry.itemId);
    visited.add(entry.itemId);
    result.push(entry);
  };
  ordered.forEach(emit);
  // Legacy plans lack the insertion transaction; retain known opening positions.
  for (const entry of [...result]) {
    const index = result.findIndex(step => step.itemId === entry.itemId);
    if (catalogById.get(entry.itemId)?.tier !== 1 || index < 5) continue;
    const slot = history.findIndex(step => step.itemId === entry.itemId);
    result.splice(index, 1);
    result.splice(slot >= 0 && slot < 5 ? slot : 4, 0, entry);
  }
  return pruneBuildPurchasePlan(result, history, { relations, knownIds });
}

/** Renderer and exports share one canonical purchase route, independent of 12 final slots. */
export function getBuildPurchasePlan(build = {}, items = [], options = {}) {
  const supplied = itemMap(items);
  const knownIds = options.knownIds || (supplied.size ? new Set(supplied.keys()) : undefined);
  return Array.isArray(build.purchasePlan)
    ? pruneBuildPurchasePlan(build.purchasePlan, build.history, { ...options, knownIds })
    : migrateBuildPurchasePlan(build, items, { ...options, knownIds });
}
