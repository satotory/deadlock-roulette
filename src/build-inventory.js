import { DEFAULT_INVENTORY_SLOTS, MAX_INVENTORY_UNDO, createBuildState } from './build-core.js';
import { randomUnitInterval } from './roulette.js';
import { ITEM_UPGRADE_PARENTS } from './game-item-rules.js';
import { getBuildPurchasePlan, pruneBuildPurchasePlan } from './build-purchase-plan.js';

const idOfTicket = entry => entry?.ticketId || entry?.comboOrigin || entry?.itemId;
const copyHistory = history => history.map(entry => ({ ...entry, ...(Array.isArray(entry.itemIds) ? { itemIds: [...entry.itemIds] } : {}) }));
const copyPurchasePlan = plan => (plan || []).map(entry => ({ ...entry, ...(Array.isArray(entry.upgradeFromIds) ? { upgradeFromIds: [...entry.upgradeFromIds] } : {}) }));

export function getTicketItemIds(ticket) {
  const ids = Array.isArray(ticket?.itemIds) ? ticket.itemIds
    : Array.isArray(ticket?.components) ? ticket.components.map(item => item?.id) : [ticket?.id];
  return [...new Set(ids.filter(id => typeof id === 'string' && id.trim()))].slice(0, 2);
}

/** Resolve direct recipes transitively; malformed cycles cannot recurse forever. */
export function getItemAncestors(itemId, relations = ITEM_UPGRADE_PARENTS) {
  const result = new Set();
  const pending = [...(relations?.[itemId] || [])];
  while (pending.length) {
    const id = pending.pop();
    if (typeof id !== 'string' || id === itemId || result.has(id)) continue;
    result.add(id);
    pending.push(...(relations?.[id] || []));
  }
  return result;
}

/** Migrate old inventories that contained a component beside its owned upgrade. */
export function coalesceBuildInventory(rawBuild, items = [], { relations = ITEM_UPGRADE_PARENTS } = {}) {
  const build = createBuildState(rawBuild);
  build.purchasePlan = getBuildPurchasePlan(build, items, { relations });
  const history = copyHistory(build.history);
  const dominated = new Set(history.filter(entry => history.some(other => other.itemId !== entry.itemId
    && getItemAncestors(other.itemId, relations).has(entry.itemId))).map(entry => entry.itemId));
  if (!dominated.size) {
    if (build.latestDrawId && !history.some(entry => entry.drawId === build.latestDrawId)) build.latestDrawId = history.at(-1)?.drawId || null;
    return build;
  }
  const kept = history.map((entry, originalIndex) => ({ entry, originalIndex })).filter(record => !dominated.has(record.entry.itemId));
  const positioned = kept.map(record => {
    const ancestors = getItemAncestors(record.entry.itemId, relations);
    const consumed = history.map((entry, index) => ({ entry, index })).filter(({ entry }) => dominated.has(entry.itemId) && ancestors.has(entry.itemId));
    const position = Math.min(record.originalIndex, ...consumed.map(({ index }) => index));
    const cursed = record.entry.cursed === true || consumed.some(({ entry }) => entry.cursed === true || entry.locked === true);
    const chickenOrigin = record.entry.chickenOrigin === true || consumed.some(({ entry }) => entry.chickenOrigin === true);
    return { ...record, position, entry: { ...record.entry, ...(cursed ? { cursed: true } : {}), ...(chickenOrigin ? { chickenOrigin: true } : {}) } };
  }).sort((a, b) => a.position - b.position || a.originalIndex - b.originalIndex);
  const next = { ...build, history: positioned.map(record => record.entry), discardedItemIds: [...new Set([...build.discardedItemIds, ...dominated])] };
  next.purchasePlan = pruneBuildPurchasePlan(build.purchasePlan, next.history, { relations });
  if (!next.history.some(entry => entry.drawId === next.latestDrawId)) next.latestDrawId = next.history.at(-1)?.drawId || null;
  return next;
}

export function getLatestBuildEntries(build = {}) {
  const history = Array.isArray(build.history) ? build.history : [];
  const drawId = build.latestDrawId || history.at(-1)?.drawId;
  return drawId ? history.filter(entry => entry.drawId === drawId) : history.length ? [history.at(-1)] : [];
}

/** A ticket, rather than its visual slot index, identifies the editable result. */
export function getLatestBuildEntry(build = {}) {
  const entries = getLatestBuildEntries(build);
  if (!entries.length) return null;
  return entries.some(entry => entry.cursed === true || entry.locked === true)
    ? { ...entries[0], cursed: true } : entries[0];
}

function randomEarlyIndex(length, random) {
  const value = random();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('random must return a finite number in [0, 1).');
  }
  return Math.floor(value * Math.min(5, length + 1));
}

function snapshotInventory(build, drawId, blocked = false) {
  return {
    history: copyHistory(build.history || []),
    purchasePlan: copyPurchasePlan(build.purchasePlan),
    discardedItemIds: [...(build.discardedItemIds || [])],
    consumedTicketIds: [...(build.consumedTicketIds || [])],
    latestDrawId: build.latestDrawId || build.history?.at(-1)?.drawId || null,
    drawId,
    blocked,
  };
}

function resolveInventory(build, ticket, meta, items, { random = randomUnitInterval, relations = ITEM_UPGRADE_PARENTS, action = 'draw', preservePosition = false } = {}) {
  if (build.fate?.totalLocked || build.fate?.pendingArchmother || build.fate?.pendingChicken || build.fate?.pendingKing) throw new RangeError('The build cannot be altered while fate holds it.');
  const itemById = items instanceof Map ? items : new Map((items || []).map(item => [item.id, item]));
  const requestedIds = getTicketItemIds(ticket);
  if (!requestedIds.length || requestedIds.some(id => !itemById.has(id))) throw new TypeError('A draw ticket must contain known items.');
  const pair = requestedIds.length === 2;
  let history = copyHistory(Array.isArray(build.history) ? build.history : []);
  const discarded = new Set(build.discardedItemIds || []);
  const replaced = action === 'draw' ? [] : getLatestBuildEntries(build);
  if (action !== 'draw' && !replaced.length) throw new RangeError('There is no result to replace.');
  if (replaced.some(entry => entry.cursed === true || entry.locked === true)) throw new RangeError('A cursed result cannot be changed.');
  if (replaced.length) {
    const replacedIds = new Set(replaced.map(entry => entry.itemId));
    history = history.filter(entry => !replacedIds.has(entry.itemId));
    replaced.forEach(entry => discarded.add(entry.itemId));
  }
  const changes = { insertedItemIds: [], mergedItemIds: [], earlyItemIds: [], replacedItemIds: replaced.map(entry => entry.itemId) };
  const earlyPositions = {};
  const touchedIds = new Set();
  const incoming = requestedIds.filter(id => !requestedIds.some(other => other !== id && getItemAncestors(other, relations).has(id)));
  for (const itemId of incoming) {
    const existing = history.find(entry => entry.itemId === itemId);
    if (existing) { touchedIds.add(itemId); continue; }
    // A lower recipe component adds no inventory slot when its upgrade is owned.
    if (history.some(entry => getItemAncestors(entry.itemId, relations).has(itemId))) continue;
    const ancestors = getItemAncestors(itemId, relations);
    const parentEntries = history.filter(entry => ancestors.has(entry.itemId));
    const parentIndex = history.findIndex(entry => ancestors.has(entry.itemId));
    const inheritsCurse = parentEntries.some(entry => entry.cursed === true || entry.locked === true);
    history = history.filter(entry => !ancestors.has(entry.itemId));
    parentEntries.forEach(entry => {
      discarded.add(entry.itemId);
      changes.mergedItemIds.push(entry.itemId);
    });
    const entry = {
      ...meta,
      itemId,
      ticketId: ticket.id,
      ...(pair ? { comboOrigin: ticket.id } : {}),
      ...(meta?.cursed === true || inheritsCurse ? { cursed: true } : {}),
      ...(meta?.chickenOrigin === true || parentEntries.some(entry => entry.chickenOrigin === true) ? { chickenOrigin: true } : {}),
    };
    delete entry.itemIds;
    // Final inventory upgrades occupy the earliest consumed component's slot.
    // A newly drawn starter goes into slots 1–5, before late-game purchases.
    const early = !preservePosition && itemById.get(itemId).tier === 1 && history.length >= 5 && parentIndex < 0;
    const index = parentIndex >= 0 ? Math.min(parentIndex, history.length)
      : early ? randomEarlyIndex(history.length, random) : history.length;
    history.splice(index, 0, entry);
    touchedIds.add(itemId);
    changes.insertedItemIds.push(itemId);
    if (early) { changes.earlyItemIds.push(itemId); earlyPositions[itemId] = index; }
  }
  if (!changes.insertedItemIds.length) return { valid: false, reason: 'redundant', history, changes, discardedItemIds: [...discarded], addedEntries: [] };
  if (history.length > DEFAULT_INVENTORY_SLOTS) return { valid: false, reason: 'full', history, changes, discardedItemIds: [...discarded], addedEntries: [] };
  // Existing halves of a newly rolled pair join its ticket without duplicating.
  if (pair) history = history.map(entry => touchedIds.has(entry.itemId) ? {
    ...entry, drawId: meta?.drawId, ticketId: ticket.id, comboOrigin: ticket.id,
    ...(meta?.cursed === true ? { cursed: true } : {}),
  } : entry);
  const addedEntries = history.filter(entry => entry.drawId === meta?.drawId);
  return { valid: true, history, changes, discardedItemIds: [...discarded], addedEntries, earlyPositions };
}

/** Capacity and redundancy are evaluated after coalescing all recipe components. */
export function canApplyBuildTicket(build, ticket, items, options = {}) {
  try {
    const base = options.assumeCanonical ? build : coalesceBuildInventory(build, items, options);
    const result = resolveInventory(base, ticket, { drawId: 'preview-ticket' }, items, { ...options, random: () => 0 });
    return { available: result.valid, reason: result.reason || '', slotCount: result.history.length, changes: result.changes };
  } catch {
    return { available: false, reason: 'invalid', slotCount: build.history?.length || 0, changes: { insertedItemIds: [], mergedItemIds: [], earlyItemIds: [], replacedItemIds: [] } };
  }
}

/** Pure inventory transaction: ordinary singles and combo tickets stay independent. */
export function applyBuildDraw(rawBuild, ticket, entryMeta, items, options = {}) {
  const build = coalesceBuildInventory(rawBuild, items, options);
  if (typeof entryMeta?.drawId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(entryMeta.drawId)) throw new TypeError('A draw requires a valid ticket ID.');
  const resolved = resolveInventory(build, ticket, entryMeta, items, options);
  if (!resolved.valid) throw new RangeError(resolved.reason === 'full' ? 'The draw does not fit in the inventory.' : 'The draw adds no new item.');
  let nextAcquiredOrder = Math.max(build.nextAcquiredOrder, ...resolved.history.map(entry => entry.acquiredOrder || 0));
  const orderById = new Map(resolved.changes.insertedItemIds.map(id => [id, ++nextAcquiredOrder]));
  resolved.history = resolved.history.map(entry => orderById.has(entry.itemId) ? { ...entry, acquiredOrder: orderById.get(entry.itemId) } : entry);
  resolved.addedEntries = resolved.history.filter(entry => entry.drawId === entryMeta.drawId);
  const blocked = resolved.addedEntries.some(entry => entry.cursed === true);
  const itemById = items instanceof Map ? items : new Map((items || []).map(item => [item.id, item]));
  let purchasePlan = copyPurchasePlan(build.purchasePlan);
  for (const itemId of resolved.changes.insertedItemIds) {
    const entry = resolved.history.find(entry => entry.itemId === itemId);
    const existingStep = purchasePlan.findIndex(step => step.itemId === itemId);
    if (existingStep >= 0) { purchasePlan[existingStep] = { ...entry }; continue; }
    let position = purchasePlan.length;
    if (!options.preservePosition && itemById.get(itemId)?.tier === 1 && purchasePlan.length >= 5) {
      position = Object.hasOwn(resolved.earlyPositions, itemId) ? resolved.earlyPositions[itemId]
        : randomEarlyIndex(purchasePlan.length, options.random || randomUnitInterval);
      if (!resolved.changes.earlyItemIds.includes(itemId)) resolved.changes.earlyItemIds.push(itemId);
    }
    purchasePlan.splice(position, 0, { ...entry });
  }
  purchasePlan = pruneBuildPurchasePlan(purchasePlan, resolved.history, options);
  let inventoryUndo = [...build.inventoryUndo];
  if (options.recordUndo !== false) inventoryUndo.push(snapshotInventory(build, entryMeta.drawId, blocked));
  else if (blocked && inventoryUndo.length) inventoryUndo[inventoryUndo.length - 1] = { ...inventoryUndo.at(-1), blocked: true };
  inventoryUndo = inventoryUndo.slice(-MAX_INVENTORY_UNDO);
  const consumedTicketIds = [...new Set([...build.consumedTicketIds, ticket.id])];
  const next = {
    ...build,
    history: resolved.history,
    purchasePlan,
    nextAcquiredOrder,
    discardedItemIds: resolved.discardedItemIds,
    consumedTicketIds,
    latestDrawId: entryMeta.drawId,
    inventoryUndo,
  };
  const meta = { ...resolved.changes, changes: resolved.changes, addedEntries: resolved.addedEntries, ticketId: ticket.id, drawId: entryMeta.drawId };
  return { build: next, meta, changes: resolved.changes, addedEntries: resolved.addedEntries };
}

export function canUndoBuildDraw(build = {}) {
  if (build.fate?.totalLocked || build.fate?.pendingArchmother || build.fate?.pendingChicken || build.fate?.pendingKing || build.fate?.kingImpostorQueue?.length) return false;
  const latest = getLatestBuildEntries(build);
  if (!latest.length || latest.some(entry => entry.cursed === true || entry.locked === true || entry.kingOrigin === true)) return false;
  if (build.fate?.kingMode && build.fate.kingMode !== 'veil' && latest.every(entry => (entry.acquiredOrder || 0) <= (build.fate.kingBoundaryOrder || 0))) return false;
  return build.inventoryUndo?.length ? build.inventoryUndo.at(-1).blocked !== true : true;
}

/** Restore the entire transaction, including slot order and merged components. */
export function undoBuildDraw(rawBuild) {
  const build = createBuildState(rawBuild);
  if (!canUndoBuildDraw(build)) return null;
  const snapshot = build.inventoryUndo.at(-1);
  if (snapshot) return {
    ...build,
    history: copyHistory(snapshot.history),
    purchasePlan: getBuildPurchasePlan({ ...snapshot, inventoryUndo: build.inventoryUndo.slice(0, -1) }),
    discardedItemIds: [...snapshot.discardedItemIds],
    consumedTicketIds: [...snapshot.consumedTicketIds],
    latestDrawId: snapshot.latestDrawId,
    inventoryUndo: build.inventoryUndo.slice(0, -1),
  };
  // Backward-compatible undo for contracts saved before transaction snapshots.
  const drawId = getLatestBuildEntries(build)[0]?.drawId;
  const removed = build.history.filter(entry => entry.drawId === drawId);
  const history = build.history.filter(entry => entry.drawId !== drawId);
  const removedTickets = new Set(removed.map(idOfTicket));
  return { ...build, history, purchasePlan: pruneBuildPurchasePlan(getBuildPurchasePlan(build), history), latestDrawId: history.at(-1)?.drawId || null,
    consumedTicketIds: build.consumedTicketIds.filter(id => !removedTickets.has(id)) };
}
