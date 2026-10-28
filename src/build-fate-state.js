import { canonicalTicketHistory } from './ticket-history.js';

export const DEFAULT_FATE_CHANCE = .1;
export const MAX_FATE_JOURNAL = 32;
export const KING_MODES = Object.freeze(['exchange', 'treasury', 'impostor', 'decree']);
export const KING_EDICTS = Object.freeze(['spirit', 'vitality', 'no-t1']);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const validKey = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,257}$/.test(value);
const boundedTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15 ? Math.trunc(value) : 0;
function journalItems(raw, knownIds) {
  return canonicalTicketHistory(raw, knownIds, { inventory: true }).map(entry => {
    const result = { ...entry };
    delete result.itemIds;
    return result;
  });
}

/** Persist only compact event facts. Removed masks are permanent visibility snapshots. */
export function normalizeBuildFateJournal(raw, knownIds) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !validId(entry.id) || seen.has(entry.id)) continue;
    const record = { id: entry.id, kind: entry.kind, time: boundedTime(entry.time) };
    if (entry.kind === 'chicken') {
      if (!Number.isInteger(entry.die) || entry.die < 1 || entry.die > 12) continue;
      const removed = Array.isArray(entry.removedEntries) ? entry.removedEntries.filter(item => validId(item?.itemId) && !item.itemId.startsWith('combo:')) : [];
      const visibility = new Map();
      for (const item of removed) if (!visibility.has(item.itemId)) visibility.set(item.itemId, item.sealed === true);
      record.die = entry.die;
      record.removedEntries = journalItems(removed, knownIds).slice(0, 12).map(item => ({ ...item, sealed: visibility.get(item.itemId) === true }));
      if (entry.die === 12) record.fullReroll = true;
    } else if (entry.kind === 'archmother') {
      if (!validId(entry.offerId) || !validId(entry.chosenEntry?.itemId) || entry.chosenEntry.itemId.startsWith('combo:')) continue;
      const chosenEntry = journalItems([entry.chosenEntry], knownIds)[0];
      if (!chosenEntry) continue;
      record.offerId = entry.offerId;
      record.chosenEntry = chosenEntry;
    } else if (entry.kind === 'hidden-king') {
      if (KING_MODES.includes(entry.mode) || entry.mode === 'veil') record.mode = entry.mode;
      if (KING_EDICTS.includes(entry.edict)) record.edict = entry.edict;
      if (Array.isArray(entry.sacrificedEntries)) {
        const sources = entry.sacrificedEntries.filter(item => validId(item?.itemId) && !item.itemId.startsWith('combo:'));
        const masks = new Map();
        for (const item of sources) if (!masks.has(item.itemId)) masks.set(item.itemId, item.sealed === true);
        record.sacrificedEntries = journalItems(sources, knownIds).slice(0, 3).map(item => ({ ...item, sealed: masks.get(item.itemId) === true }));
      }
    } else continue;
    seen.add(entry.id);
    result.push(record);
  }
  return result.slice(-MAX_FATE_JOURNAL);
}

/** Event flags deliberately stay outside item Undo snapshots. */
export function normalizeBuildFate(raw = {}, knownIds) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const pending = source.pendingArchmother;
  const itemIds = Array.isArray(pending?.itemIds) ? [...new Set(pending.itemIds.filter(id => validId(id) && (!knownIds || knownIds.has(id))))] : [];
  const pendingArchmother = validId(pending?.id) && itemIds.length === 3 ? {
    id: pending.id, itemIds,
    createdAt: boundedTime(pending.createdAt),
  } : null;
  const journal = normalizeBuildFateJournal(source.journal, knownIds);
  const pendingChicken = validId(source.pendingChicken) && journal.some(record => record.kind === 'chicken' && record.id === source.pendingChicken) ? source.pendingChicken : null;
  const pendingKing = validId(source.pendingKing?.id) && ['mode', 'sacrifice'].includes(source.pendingKing.stage) ? {
    id: source.pendingKing.id, stage: source.pendingKing.stage,
    ...(source.pendingKing.stage === 'sacrifice' ? { mode: 'exchange' } : {}), createdAt: boundedTime(source.pendingKing.createdAt),
  } : null;
  const kingActive = source.kingActive === true || pendingKing !== null || journal.some(record => record.kind === 'hidden-king');
  const kingMode = source.kingMode === null ? null : KING_MODES.includes(source.kingMode) || source.kingMode === 'veil' ? source.kingMode : kingActive && !pendingKing ? 'veil' : null;
  return {
    chickenUsed: source.chickenUsed === true || journal.some(record => record.kind === 'chicken'),
    archmotherUsed: source.archmotherUsed === true || pendingArchmother !== null || journal.some(record => record.kind === 'archmother'),
    kingActive,
    kingMode,
    kingEdict: KING_EDICTS.includes(source.kingEdict) ? source.kingEdict : null,
    kingBoundaryOrder: Number.isSafeInteger(source.kingBoundaryOrder) && source.kingBoundaryOrder >= 0 ? source.kingBoundaryOrder : 0,
    kingImpostorQueue: journalItems(Array.isArray(source.kingImpostorQueue) ? source.kingImpostorQueue.filter(entry => validId(entry?.itemId) && !entry.itemId.startsWith('combo:')) : [], knownIds).slice(0, 3).map(entry => ({ ...entry, sealed: true, kingOrigin: true })),
    totalLocked: source.totalLocked === true,
    pendingArchmother,
    pendingChicken,
    pendingKing,
    journal,
    revealedPurchaseKeys: Array.isArray(source.revealedPurchaseKeys) ? [...new Set(source.revealedPurchaseKeys.filter(validKey))].slice(-512) : [],
  };
}

/** Old archived King builds retain their veil; new contracts seal only royal rewards. */
export function shouldSealBuildDraw(build) {
  const fate = normalizeBuildFate(build?.fate);
  return fate.kingActive && fate.kingMode === 'veil';
}

/** Royal action availability must not reveal a secret reward's tier through button patterns. */
export function isRoyalEntryUnrevealed(build, entry) {
  if (entry?.kingOrigin !== true) return false;
  const purchase = Array.isArray(build?.purchasePlan) ? build.purchasePlan.find(step => step.itemId === entry.itemId) || entry : entry;
  return purchase.sealed === true && !normalizeBuildFate(build?.fate).revealedPurchaseKeys.includes(getPurchaseIdentity(purchase));
}

export function getPurchaseIdentity(entry) {
  return `${entry?.drawId || ''}:${entry?.itemId || ''}`;
}
