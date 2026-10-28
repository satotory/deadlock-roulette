import { createBuildState, DEFAULT_INVENTORY_SLOTS } from './build-core.js';
import { normalizeBuildFate, getPurchaseIdentity, shouldSealBuildDraw } from './build-fate-state.js';
import { getBuildPurchasePlan, pruneBuildPurchasePlan } from './build-purchase-plan.js';
import { planDrawSequence } from './draw-sequence.js';
import { calculateBuildDistribution, pickWeightedDistribution } from './draw-rules.js';
import { applyBuildDraw } from './build-inventory.js';
import { randomUnitInterval } from './roulette.js';
import { getKingContractAvailability } from './king-contract.js';

export { getPurchaseIdentity } from './build-fate-state.js';
export { shouldSealBuildDraw } from './build-fate-state.js';

/** Event history is compact and canonical, independent of inventory Undo. */
export function getBuildFateJournal(build, items = []) {
  const knownIds = items instanceof Map ? new Set(items.keys()) : Array.isArray(items) && items.length ? new Set(items.map(item => item.id)) : undefined;
  return normalizeBuildFate(build?.fate, knownIds).journal;
}

export function getPendingChickenEvent(build, items = []) {
  const pending = normalizeBuildFate(build?.fate).pendingChicken;
  return getBuildFateJournal(build, items).find(record => record.kind === 'chicken' && record.id === pending) || null;
}

/** Only explicit confirmation of this presentation clears its persistent gate. */
export function acknowledgeBuildChicken(build, eventId) {
  const fate = normalizeBuildFate(build?.fate);
  return { ...build, fate: { ...fate, pendingChicken: fate.pendingChicken === eventId ? null : fate.pendingChicken } };
}

/** Resolve visibility by the purchase identity, including retargeted owned pair halves. */
export function isBuildEntrySealed(build, entry, items = []) {
  if (!entry) return false;
  const purchase = getBuildPurchasePlan(build, items).find(step => step.itemId === entry.itemId) || entry;
  return purchase.sealed === true && !normalizeBuildFate(build?.fate).revealedPurchaseKeys.includes(getPurchaseIdentity(purchase));
}

export function getNextSealedPurchase(build, items = []) {
  const revealed = new Set(normalizeBuildFate(build?.fate).revealedPurchaseKeys);
  return getBuildPurchasePlan(build, items).find(entry => entry.sealed === true && !revealed.has(getPurchaseIdentity(entry))) || null;
}

/** Revealing changes only the persistent mask, never inventory, route or probabilities. */
export function revealNextSealedPurchase(rawBuild, items = []) {
  const next = getNextSealedPurchase(rawBuild, items);
  const fate = normalizeBuildFate(rawBuild?.fate);
  return { ...rawBuild, fate: next ? { ...fate, revealedPurchaseKeys: [...fate.revealedPurchaseKeys, getPurchaseIdentity(next)] } : fate };
}

function randomValue(random) {
  const value = random();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('random must return a finite number in [0, 1).');
  return value;
}
function chance(value, fallback = .1) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}
function rollChance(value, random) { return value > 0 && randomValue(random) < value; }
function appendEvent(plan, event) {
  plan.events.push(event);
  plan.timeline.push({ type: 'event', kind: 'event', event });
}
function makePlan(plan) {
  if (!plan) return null;
  const timeline = plan.steps.map(step => ({ type: 'draw', kind: 'draw', step }));
  return { ...plan, events: [], timeline, presentations: timeline };
}

function newestEntries(history, count) {
  return history.map((entry, index) => ({ entry, index })).sort((a, b) =>
    (b.entry.acquiredOrder || 0) - (a.entry.acquiredOrder || 0)
    || b.entry.time - a.entry.time || b.index - a.index).slice(0, count).map(record => record.entry);
}

/** The physical item count includes each half of a double; T1 display position is irrelevant. */
function applyChicken(plan, items, { random, uuid, now }) {
  const before = structuredClone(plan.session);
  const build = plan.session.build;
  const die = Math.floor(randomValue(random) * 12) + 1;
  const fullReroll = die === 12;
  const count = die <= 6 ? 1 : die <= 9 ? 2 : die <= 11 ? 3 : build.history.length;
  const removedEntries = newestEntries(build.history, count).map(entry => ({ ...entry, sealed: isBuildEntrySealed(build, entry, items) }));
  const removedIds = new Set(removedEntries.map(entry => entry.itemId));
  const history = fullReroll ? [] : build.history.filter(entry => !removedIds.has(entry.itemId));
  const fate = { ...normalizeBuildFate(build.fate), chickenUsed: true, pendingArchmother: null };
  if (fullReroll) {
    fate.revealedPurchaseKeys = [];
    plan.session.build = createBuildState({ ...build, history: [], purchasePlan: [], consumedTicketIds: [], discardedItemIds: [],
      latestDrawId: null, inventoryUndo: [], fate });
  } else {
    const survivingLatest = history.filter(entry => entry.drawId === build.latestDrawId);
    const newest = newestEntries(history, 1)[0];
    plan.session.build = { ...build, history, purchasePlan: pruneBuildPurchasePlan(build.purchasePlan, history),
      discardedItemIds: [...new Set([...build.discardedItemIds, ...removedIds])],
      consumedTicketIds: [...new Set([...build.consumedTicketIds, ...removedIds])],
      latestDrawId: survivingLatest.length ? build.latestDrawId : newest?.drawId || null,
      inventoryUndo: [], fate };
  }
  const record = { id: uuid(), kind: 'chicken', time: now(), die, removedEntries: structuredClone(removedEntries), ...(fullReroll ? { fullReroll: true } : {}) };
  const event = { id: record.id, type: 'chicken', die, removedItemIds: [...removedIds], removedEntries: structuredClone(removedEntries), before,
    after: structuredClone(plan.session), ...(fullReroll ? { fullReroll: true } : {}) };
  appendEvent(plan, event);
  // A fresh pool fills final slots while still respecting recipes, hero filters and tier decay.
  let iterations = 0;
  while (fullReroll && plan.session.build.history.length < DEFAULT_INVENTORY_SLOTS && iterations++ < items.length + 1) {
    const distribution = calculateBuildDistribution(items, plan.session.settings, plan.session.build, { pairsEnabled: false });
    if (!distribution.eligibleCount) break;
    const ticket = pickWeightedDistribution(distribution, { random });
    const selected = distribution.items.find(entry => entry.item.id === ticket.id);
    const previous = structuredClone(plan.session);
    const entry = { itemId: ticket.id, drawId: uuid(), time: now(), probability: selected.probability, weight: selected.weight, cursed: true, chickenOrigin: true,
      ...(shouldSealBuildDraw(plan.session.build) ? { sealed: true } : {}) };
    const applied = applyBuildDraw(plan.session.build, ticket, entry, items, { random, recordUndo: false });
    plan.session.build = applied.build;
    const step = { before: previous, after: structuredClone(plan.session), ticket, entry, distribution,
      changes: applied.changes, cursed: true, sealed: entry.sealed === true, fullReroll: true };
    plan.steps.push(step); plan.timeline.push({ type: 'draw', kind: 'draw', step });
  }
  if (fullReroll) plan.session.build.fate.totalLocked = true;
  plan.session.build.inventoryUndo = [];
  // Set the acknowledgement gate only after internal D12 draws have completed.
  plan.session.build.fate = normalizeBuildFate({ ...plan.session.build.fate,
    journal: [...plan.session.build.fate.journal, record], pendingChicken: record.id });
  event.after.build.fate = structuredClone(plan.session.build.fate);
  if (fullReroll && plan.session.build.history.length < DEFAULT_INVENTORY_SLOTS) {
    appendEvent(plan, { type: 'chicken-limited-pool', slotCount: plan.session.build.history.length, requestedSlots: DEFAULT_INVENTORY_SLOTS,
      before: structuredClone(plan.session), after: structuredClone(plan.session) });
  }
}

function applyAfterDrawFates(plan, items, options) {
  if (!plan || plan.session.preferences.mode !== 'build') return plan;
  if (plan.steps[0]?.kingScripted) return plan;
  const fate = normalizeBuildFate(plan.session.build.fate);
  if (!fate.chickenUsed && plan.session.build.history.length >= 3 && rollChance(chance(plan.session.preferences.chickenChance), options.random)) {
    applyChicken(plan, items, options);
  }
  if (!plan.session.build.fate.totalLocked && !plan.session.build.fate.kingActive && plan.session.build.history.length >= 5
    && rollChance(chance(plan.session.preferences.hiddenKingChance), options.random)
    && getKingContractAvailability(plan.session, items).some(choice => choice.available)) {
    const before = structuredClone(plan.session);
    const record = { id: options.uuid(), kind: 'hidden-king', time: options.now() };
    plan.session.build.fate = normalizeBuildFate({ ...plan.session.build.fate, kingActive: true, kingMode: null,
      pendingKing: { id: record.id, stage: 'mode', createdAt: record.time }, journal: [...plan.session.build.fate.journal, record] });
    appendEvent(plan, { id: record.id, type: 'hidden-king', before, after: structuredClone(plan.session) });
  }
  return plan;
}

/** Fate rolls occur once per ordinary builder draw; forced and manual actions cannot recurse. */
export function planBuildFateDraw(source, items, action = 'draw', options = {}) {
  const controls = { random: randomUnitInterval, uuid: () => crypto.randomUUID(), now: () => Date.now(), ...options };
  if (source.preferences.mode !== 'build' || action !== 'draw') return makePlan(planDrawSequence(source, items, action, controls));
  const fate = normalizeBuildFate(source.build.fate);
  if (fate.totalLocked || fate.pendingChicken) return null;
  if (fate.pendingKing) { const timeline = []; return { session: structuredClone(source), steps: [], events: [], timeline, presentations: timeline, pendingKing: structuredClone(fate.pendingKing) }; }
  if (fate.kingImpostorQueue.length) return makePlan(planDrawSequence(source, items, action, controls));
  if (fate.pendingArchmother) { const timeline = []; return { session: structuredClone(source), steps: [], events: [], timeline, presentations: timeline, pendingOffer: structuredClone(fate.pendingArchmother) }; }
  if (!fate.archmotherUsed && rollChance(chance(source.preferences.archmotherChance), controls.random)) {
    const eligible = calculateBuildDistribution(items, source.settings, source.build, { pairsEnabled: false });
    if (eligible.eligibleCount >= 3) {
      const offerIds = [];
      let remaining = eligible;
      for (let index = 0; index < 3; index++) {
        const selected = pickWeightedDistribution(remaining, { random: controls.random });
        offerIds.push(selected.id);
        const entries = remaining.items.filter(entry => entry.item.id !== selected.id);
        remaining = { ...remaining, items: entries, totalWeight: entries.reduce((sum, entry) => sum + entry.weight, 0) };
      }
      const state = structuredClone(source);
      state.build.fate = { ...fate, archmotherUsed: true, pendingArchmother: { id: controls.uuid(), itemIds: offerIds, createdAt: controls.now() } };
      const event = { type: 'archmother-offer', offerId: state.build.fate.pendingArchmother.id, before: structuredClone(source), after: structuredClone(state) };
      const timeline = [{ type: 'event', kind: 'event', event }];
      return { session: state, steps: [], events: [event], timeline, presentations: timeline, pendingOffer: structuredClone(state.build.fate.pendingArchmother) };
    }
  }
  return applyAfterDrawFates(makePlan(planDrawSequence(source, items, action, controls)), items, controls);
}

/** The three offered IDs are persisted; reopening or cancelling cannot redraw the offer. */
export function resolveArchmotherOffer(source, items, choiceId, options = {}) {
  const controls = { random: randomUnitInterval, uuid: () => crypto.randomUUID(), now: () => Date.now(), ...options };
  const fate = normalizeBuildFate(source.build?.fate);
  if (source.preferences.mode !== 'build' || fate.totalLocked || fate.pendingChicken || fate.pendingKing || !fate.pendingArchmother?.itemIds.includes(choiceId)) return null;
  const state = structuredClone(source);
  const offer = structuredClone(fate.pendingArchmother);
  state.build.fate = { ...fate, pendingArchmother: null };
  const plan = makePlan(planDrawSequence(state, items, 'draw', { ...controls, initialItemId: choiceId, archmotherOrigin: true }));
  if (!plan) return null;
  const chosenEntry = plan.steps[0].after.build.purchasePlan.find(entry => entry.itemId === choiceId) || plan.steps[0].entry;
  const record = { id: controls.uuid(), kind: 'archmother', time: controls.now(), offerId: offer.id, chosenEntry: structuredClone(chosenEntry) };
  plan.session.build.fate = normalizeBuildFate({ ...plan.session.build.fate, journal: [...plan.session.build.fate.journal, record] });
  const event = { id: record.id, type: 'archmother', offerId: offer.id, choiceId, before: structuredClone(source), after: structuredClone(state) };
  plan.events.unshift(event); plan.timeline.unshift({ type: 'event', kind: 'event', event });
  return applyAfterDrawFates(plan, items, controls);
}
