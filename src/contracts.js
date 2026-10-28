import { createBuildState, DEFAULT_INVENTORY_SLOTS, MAX_BUILD_NAME_LENGTH, normalizeBuildName } from './build-core.js';
import { normalizeHistory } from './history.js';
import { coalesceBuildInventory } from './build-inventory.js';
import { canonicalTicketHistory } from './ticket-history.js';
import { getBuildPurchasePlan } from './build-purchase-plan.js';
import { normalizeBuildFate } from './build-fate-state.js';

export const MAX_CONTRACTS = 30;
export const MAX_CONTRACT_NAME_LENGTH = MAX_BUILD_NAME_LENGTH;
export const MAX_CONTRACT_COMMENT_LENGTH = 1000;
export const normalizeContractName = normalizeBuildName;
const MAX_TIME = 8.64e15;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);

export function normalizeContractRating(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(5, Math.max(0, Math.round(value))) : 0;
}

export function normalizeContractComment(value) {
  if (typeof value !== 'string') return '';
  return [...value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim()]
    .slice(0, MAX_CONTRACT_COMMENT_LENGTH).join('');
}

function snapshotBuild(raw, name, knownIds, items = []) {
  const build = createBuildState(raw);
  build.fate = normalizeBuildFate(build.fate, knownIds);
  build.name = name;
  build.history = canonicalTicketHistory(build.history, knownIds, { inventory: true }).slice(0, DEFAULT_INVENTORY_SLOTS);
  build.consumedTicketIds = [...new Set([...build.consumedTicketIds, ...build.history.map(entry => entry.ticketId || entry.comboOrigin || entry.itemId)])];
  build.purchasePlan = getBuildPurchasePlan(build, items, { knownIds });
  // Saved match sheets need the finished inventory; keeping 30 undo journals wastes the export quota.
  build.inventoryUndo = [];
  return coalesceBuildInventory(build);
}

/** Tolerant restoration skips damaged records, while retaining usable builds. */
export function normalizeContracts(raw, knownIds, items = []) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !validId(entry.id) || seen.has(entry.id)) continue;
    const name = normalizeContractName(entry.name);
    const build = snapshotBuild(entry.build, name, knownIds, items);
    if (!name || !validId(build.heroId)) continue;
    seen.add(entry.id);
    result.push({
      id: entry.id,
      name,
      rating: normalizeContractRating(entry.rating),
      comment: normalizeContractComment(entry.comment),
      savedAt: typeof entry.savedAt === 'number' && Number.isFinite(entry.savedAt) && entry.savedAt >= 0 && entry.savedAt <= MAX_TIME
        ? Math.trunc(entry.savedAt)
        : 0,
      build,
    });
    if (result.length === MAX_CONTRACTS) break;
  }
  return result;
}

/** A contract owns its snapshot: changing a live build cannot alter the archive. */
export function createContract(build, name, { id = globalThis.crypto.randomUUID(), savedAt = Date.now(), rating = 0, comment = '' } = {}) {
  const contract = normalizeContracts([{ id, name, savedAt, rating, comment, build }])[0];
  if (!contract) throw new TypeError('A saved contract requires an id, a name and a selected hero.');
  return contract;
}

/** Save without silently discarding older contracts when the archive is full. */
export function saveContract(contracts, build, name, options) {
  const contract = createContract(build, name, options);
  const remaining = normalizeContracts(contracts).filter(entry => entry.id !== contract.id);
  if (remaining.length >= MAX_CONTRACTS) throw new RangeError('The contract archive is full.');
  return [contract, ...remaining];
}

/** Change a post-match review while preserving the saved build and its identity. */
export function updateContractReview(contracts, id, { rating, comment } = {}) {
  return normalizeContracts(contracts).map(contract => contract.id === id ? {
    ...contract,
    rating: rating === undefined ? contract.rating : normalizeContractRating(rating),
    comment: comment === undefined ? contract.comment : normalizeContractComment(comment),
  } : contract);
}

/** Start the same build again, without resetting the user's enabled hero pool. */
export function replayContract(contract, currentBuild) {
  const snapshot = normalizeContracts([contract])[0];
  if (!snapshot) throw new TypeError('Cannot replay a damaged contract.');
  return createBuildState({
    ...snapshot.build,
    fate: { ...snapshot.build.fate, pendingChicken: null, pendingKing: null },
    excludedHeroIds: createBuildState(currentBuild).excludedHeroIds,
    checkedSkills: [],
  });
}
