import { normalizeBuildFate, KING_MODES, shouldSealBuildDraw } from './build-fate-state.js';
import { applyBuildDraw, coalesceBuildInventory, getItemAncestors } from './build-inventory.js';
import { calculateBuildDistribution, pickWeightedDistribution } from './draw-rules.js';
import { pruneBuildPurchasePlan } from './build-purchase-plan.js';
import { isBuildEntrySealed } from './build-fate.js';
import { randomUnitInterval } from './roulette.js';

export { shouldSealBuildDraw };
const clone = value => structuredClone(value);
const newest = history => history.map((entry, index) => ({ entry, index })).sort((a, b) =>
  (b.entry.acquiredOrder || 0) - (a.entry.acquiredOrder || 0) || b.entry.time - a.entry.time || b.index - a.index).map(record => record.entry);
const subset = (distribution, predicate) => {
  const entries = distribution.items.filter(predicate);
  const totalWeight = entries.reduce((total, entry) => total + entry.weight, 0);
  return { ...distribution, items: entries.map(entry => ({ ...entry, probability: entry.weight / totalWeight })), totalWeight, eligibleCount: entries.length };
};
const scope = (build, items) => coalesceBuildInventory({ ...build, fate: { ...normalizeBuildFate(build.fate), pendingKing: null,
  pendingChicken: null, pendingArchmother: null, kingMode: 'exchange', kingImpostorQueue: [] } }, items);
const compatible = (left, right) => left !== right && !getItemAncestors(left).has(right) && !getItemAncestors(right).has(left);

function removeEntries(build, entries) {
  const removedIds = new Set(entries.map(entry => entry.itemId));
  const history = build.history.filter(entry => !removedIds.has(entry.itemId));
  const latest = history.some(entry => entry.drawId === build.latestDrawId) ? build.latestDrawId : newest(history)[0]?.drawId || null;
  return { ...build, history, purchasePlan: pruneBuildPurchasePlan(build.purchasePlan, history), latestDrawId: latest, inventoryUndo: [],
    discardedItemIds: [...new Set([...build.discardedItemIds, ...removedIds])], consumedTicketIds: [...new Set([...build.consumedTicketIds, ...removedIds])] };
}

function distribution(session, items, build, pairsEnabled = true) {
  return calculateBuildDistribution(items, session.settings, build, { pairsEnabled });
}

function exchangePool(session, items, build, sacrifice) {
  const tier = items.find(item => item.id === sacrifice.itemId)?.tier;
  return subset(distribution(session, items, removeEntries(build, [sacrifice])), entry => entry.item.combo || entry.item.tier !== tier);
}

function treasuryChoices(session, items, build) {
  if (build.history.length < 3) return [];
  const reduced = removeEntries(build, newest(build.history).slice(0, 3));
  const initial = distribution(session, items, reduced);
  const pairs = initial.items.filter(entry => entry.item.combo);
  const options = [];
  for (const entry of initial.items.filter(entry => !entry.item.combo && entry.item.tier === 4)) {
    const after = applyBuildDraw(reduced, entry.item, { itemId: entry.item.id, drawId: 'king-preview-t4', time: 0 }, items, { recordUndo: false, preservePosition: true }).build;
    const validPairs = pairs.filter(pair => {
      if (!pair.item.itemIds.every(id => compatible(id, entry.item.id))) return false;
      try {
        const applied = applyBuildDraw(after, pair.item, { itemId: pair.item.id, drawId: 'king-preview-pair', time: 0 }, items, { recordUndo: false, preservePosition: true });
        return applied.changes.insertedItemIds.length === 2 && [entry.item.id, ...pair.item.itemIds].every(id => applied.build.history.some(item => item.itemId === id));
      } catch { return false; }
    });
    if (validPairs.length) options.push({ ...entry, pairs: validPairs });
  }
  return options;
}

function impostorChoices(session, items, build) {
  if (build.history.length > 9) return [];
  const eligible = distribution(session, items, build, false);
  const highs = eligible.items.filter(entry => [3, 4].includes(entry.item.tier));
  return eligible.items.filter(entry => entry.item.tier === 1).map(entry => {
    const candidates = highs.filter(high => compatible(entry.item.id, high.item.id));
    const firsts = candidates.filter(high => candidates.some(other => compatible(high.item.id, other.item.id)));
    return { ...entry, highs: candidates, firsts };
  }).filter(entry => entry.firsts.length);
}

function eligibleEdicts(session, items, build) {
  const eligible = distribution(session, items, build, false);
  return ['spirit', 'vitality', 'no-t1'].filter(edict => eligible.items.some(entry => edict === 'no-t1' ? entry.item.tier !== 1 : entry.item.category === edict));
}

/** Pure availability has no RNG and never discloses a precommitted reward. */
export function getKingContractAvailability(session, items) {
  const build = scope(session.build, items);
  if (session.preferences?.mode !== 'build' || build.fate.totalLocked) return KING_MODES.map(mode => ({ mode, available: false, reason: 'locked' }));
  const sacrificeItemIds = build.history.filter(entry => !entry.cursed && !entry.locked).filter(entry =>
    exchangePool(session, items, build, entry).eligibleCount > 0).map(entry => entry.itemId);
  const treasury = treasuryChoices(session, items, build).length > 0;
  const impostor = impostorChoices(session, items, build).length > 0;
  const decree = eligibleEdicts(session, items, build).length > 0;
  return [
    { mode: 'exchange', available: sacrificeItemIds.length > 0, reason: sacrificeItemIds.length ? '' : 'no-sacrifice', sacrificeItemIds },
    { mode: 'treasury', available: treasury, reason: treasury ? '' : 'no-treasury' },
    { mode: 'impostor', available: impostor, reason: build.history.length > 9 ? 'need-three-slots' : impostor ? '' : 'no-impostor-pool' },
    { mode: 'decree', available: decree, reason: decree ? '' : 'no-edict' },
  ];
}

function markContract(build, mode, additions = {}) {
  const fate = normalizeBuildFate(build.fate);
  let matched = false;
  const journal = fate.journal.map(record => {
    if (record.kind !== 'hidden-king' || record.id !== fate.pendingKing?.id) return record;
    matched = true;
    return { ...record, mode, ...additions };
  });
  if (!matched && fate.pendingKing) journal.push({ id: fate.pendingKing.id, kind: 'hidden-king', time: fate.pendingKing.createdAt, mode, ...additions });
  return { ...build, inventoryUndo: [], fate: normalizeBuildFate({ ...fate, pendingKing: null, kingMode: mode, journal,
    kingBoundaryOrder: Math.max(build.nextAcquiredOrder || 0, ...build.history.map(entry => entry.acquiredOrder || 0)),
    ...(additions.edict ? { kingEdict: additions.edict } : {}) }) };
}

/** The choice and its rewards are committed before presentation; no ordinary fate recursion. */
export function planResolveKingContract(source, items, choice, options = {}) {
  const { random = randomUnitInterval, uuid = () => crypto.randomUUID(), now = () => Date.now() } = options;
  const fate = normalizeBuildFate(source.build?.fate);
  const mode = choice?.mode;
  if (source.preferences?.mode !== 'build' || !fate.pendingKing || fate.pendingChicken || fate.pendingArchmother || fate.totalLocked || !KING_MODES.includes(mode)) return null;
  const availability = getKingContractAvailability(source, items).find(entry => entry.mode === mode);
  if (!availability?.available) return null;
  const state = clone(source);
  if (mode === 'exchange' && !choice.sacrificeItemId && !choice.itemId) {
    state.build.fate.pendingKing = { ...fate.pendingKing, stage: 'sacrifice', mode: 'exchange' };
    return { session: state, steps: [], events: [], timeline: [], presentations: [], pendingKing: clone(state.build.fate.pendingKing) };
  }
  const before = clone(source);
  const steps = [], events = [], timeline = [];
  state.build = scope(state.build, items);
  function addReward(ticket, selected, extra = {}) {
    const previous = clone(state);
    const entry = { itemId: ticket.id, drawId: uuid(), time: now(), probability: selected.probability, weight: selected.weight,
      sealed: true, kingOrigin: true, ...(ticket.combo ? { itemIds: [...ticket.itemIds] } : {}), ...extra };
    const applied = applyBuildDraw(state.build, ticket, entry, items, { random, recordUndo: false, preservePosition: true });
    state.build = applied.build;
    const step = { before: previous, after: clone(state), ticket, entry, distribution: distribution(state, items, previous.build), changes: applied.changes,
      cursed: false, sealed: true, kingReward: true };
    steps.push(step); timeline.push({ type: 'draw', kind: 'draw', step });
    return entry;
  }
  let sacrificedEntries = [];
  if (mode === 'exchange' || mode === 'treasury') {
    const itemId = choice.sacrificeItemId || choice.itemId;
    if (mode === 'exchange' && !availability.sacrificeItemIds.includes(itemId)) return null;
    sacrificedEntries = (mode === 'exchange' ? state.build.history.filter(entry => entry.itemId === itemId) : newest(state.build.history).slice(0, 3))
      .map(entry => ({ ...entry, sealed: isBuildEntrySealed(source.build, entry, items) }));
    state.build = removeEntries(state.build, sacrificedEntries);
  }
  const additions = sacrificedEntries.length ? { sacrificedEntries } : {};
  state.build = markContract({ ...state.build, fate: { ...state.build.fate, pendingKing: fate.pendingKing } }, mode, additions);
  const event = { id: fate.pendingKing.id, type: 'king-contract', mode, sacrificedEntries: clone(sacrificedEntries), before, after: clone(state) };
  events.push(event); timeline.push({ type: 'event', kind: 'event', event });
  if (mode === 'exchange') {
    const tier = items.find(item => item.id === sacrificedEntries[0].itemId)?.tier;
    const pool = subset(distribution(state, items, state.build), entry => entry.item.combo || entry.item.tier !== tier);
    const ticket = pickWeightedDistribution(pool, { random });
    addReward(ticket, pool.items.find(entry => entry.item.id === ticket.id));
  } else if (mode === 'treasury') {
    const original = scope(source.build, items);
    const choices = treasuryChoices(source, items, original);
    const pool = { items: choices, totalWeight: choices.reduce((total, entry) => total + entry.weight, 0) };
    const ticket = pickWeightedDistribution(pool, { random });
    const selected = choices.find(entry => entry.item.id === ticket.id);
    addReward(ticket, selected);
    const next = subset(distribution(state, items, state.build), entry => selected.pairs.some(pair => pair.item.id === entry.item.id));
    const pair = pickWeightedDistribution(next, { random });
    addReward(pair, next.items.find(entry => entry.item.id === pair.id));
  } else if (mode === 'impostor') {
    const choices = impostorChoices(source, items, scope(source.build, items));
    const weighted = entries => ({ items: entries, totalWeight: entries.reduce((total, entry) => total + entry.weight, 0) });
    const fake = pickWeightedDistribution(weighted(choices), { random });
    const selected = choices.find(entry => entry.item.id === fake.id);
    const first = pickWeightedDistribution(weighted(selected.firsts), { random });
    const second = pickWeightedDistribution(weighted(selected.highs.filter(entry => compatible(entry.item.id, first.id))), { random });
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('Invalid impostor position random value.');
    const fakeIndex = Math.floor(value * 3);
    const order = [first, second]; order.splice(fakeIndex, 0, fake);
    let simulated = clone(state.build);
    const queue = order.map(ticket => {
      const pool = distribution(state, items, simulated, false);
      const selected = pool.items.find(entry => entry.item.id === ticket.id);
      if (!selected) throw new RangeError('The royal sequence no longer fits its source filters.');
      const entry = { itemId: ticket.id, drawId: uuid(), time: now(), weight: selected.weight, probability: selected.probability,
        sealed: true, kingOrigin: true, ...(ticket.id === fake.id ? { kingImpostor: true } : {}) };
      simulated = applyBuildDraw(simulated, ticket, entry, items, { recordUndo: false, preservePosition: true }).build;
      return entry;
    });
    state.build.fate.kingImpostorQueue = queue;
    event.after = clone(state);
  } else {
    const edicts = eligibleEdicts(source, items, scope(source.build, items));
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('Invalid edict random value.');
    const edict = edicts[Math.floor(value * edicts.length)];
    state.build = markContract({ ...state.build, fate: { ...state.build.fate, pendingKing: fate.pendingKing } }, mode, { edict });
    event.edict = edict; event.after = clone(state);
  }
  state.build.inventoryUndo = [];
  return { session: state, steps, events, timeline, presentations: timeline };
}
