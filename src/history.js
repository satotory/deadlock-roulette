import { MAX_WEIGHT } from './roulette.js';

const MAX_TIME = 8.64e15;
const MAX_ITEM_WEIGHT = 6 * MAX_WEIGHT ** 3;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);

function boundedNumber(value, minimum, maximum, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

/** Preserve the first known draw even if its metadata needs repairing. */
export function normalizeHistory(history, knownIds) {
  if (!Array.isArray(history)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of history) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.itemId !== 'string' || !entry.itemId.trim() || seen.has(entry.itemId)) continue;
    if (knownIds && !knownIds.has(entry.itemId)) continue;
    const itemIds = Array.isArray(entry.itemIds)
      ? [...new Set(entry.itemIds.filter(id => typeof id === 'string' && id.trim() && (!knownIds || knownIds.has(id))))].slice(0, 2)
      : [];
    if (entry.itemId.startsWith('combo:') && itemIds.length !== 2) continue;
    seen.add(entry.itemId);
    const rawWeight = boundedNumber(entry.weight, 0, Number.MAX_VALUE);
    const normalized = {
      itemId: entry.itemId,
      time: Math.trunc(boundedNumber(entry.time, 0, MAX_TIME)),
      probability: boundedNumber(entry.probability, 0, 1),
      weight: Math.min(MAX_ITEM_WEIGHT, rawWeight),
      drawId: validId(entry.drawId)
        ? entry.drawId
        : `restored-${result.length + 1}`,
    };
    if (itemIds.length === 2) normalized.itemIds = itemIds;
    if (validId(entry.ticketId)) normalized.ticketId = entry.ticketId;
    if (validId(entry.comboOrigin) && entry.comboOrigin.startsWith('combo:')) normalized.comboOrigin = entry.comboOrigin;
    if (entry.cursed === true || entry.locked === true) normalized.cursed = true;
    if (entry.sealed === true) normalized.sealed = true;
    if (entry.archmotherOrigin === true) normalized.archmotherOrigin = true;
    if (entry.chickenOrigin === true) normalized.chickenOrigin = true;
    if (entry.kingOrigin === true) normalized.kingOrigin = true;
    if (entry.kingImpostor === true) normalized.kingImpostor = true;
    if (Number.isSafeInteger(entry.acquiredOrder) && entry.acquiredOrder > 0) normalized.acquiredOrder = entry.acquiredOrder;
    if (entry.curseTriggered === true) normalized.curseTriggered = true;
    if (validId(entry.cursedBy)) normalized.cursedBy = entry.cursedBy;
    result.push(normalized);
  }
  return result;
}
