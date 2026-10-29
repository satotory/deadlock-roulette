import { randomUnitInterval } from './roulette.js';
import { calculateBuildAction, calculateRouletteAction, createItemTickets, pickWeightedDistribution } from './draw-rules.js';
import { applyBuildDraw, getLatestBuildEntries } from './build-inventory.js';
import { canUseItemAction, spendItemAction } from './item-actions.js';
import { shouldSealBuildDraw, isRoyalEntryUnrevealed } from './build-fate-state.js';

export function currentDrawResult(state, items) {
  if (state.preferences.mode !== 'build') return state.rouletteResult || state.history.at(-1) || null;
  const group = getLatestBuildEntries(state.build);
  if (!group.length) return null;
  const first = group[0], ticketId = first.ticketId || first.comboOrigin || first.itemId;
  const ticket = createItemTickets(items).find(entry => entry.id === ticketId);
  return { ...first, itemId: ticket?.id || first.itemId, ...(ticket?.combo ? { itemIds: [...ticket.itemIds] } : {}), ...(group.some(entry => entry.cursed) ? { cursed: true } : {}) };
}

export function distributionForDraw(state, items, action = 'draw', { forced = false } = {}) {
  const current = currentDrawResult(state, items);
  const ticket = createItemTickets(items).find(entry => entry.id === current?.itemId);
  const options = { pairsEnabled: !forced && state.preferences.pairsEnabled !== false };
  return state.preferences.mode === 'build'
    ? calculateBuildAction(items, state.settings, state.build, ticket, action, options)
    : calculateRouletteAction(items, state.settings, [...state.history.map(entry => entry.itemId), ...(forced ? ticket?.itemIds || [ticket?.id].filter(Boolean) : [])], ticket, action, options);
}

/** Commit the complete drop together: quitting during a curse cannot return its locked item. */
export function planDrawSequence(source, items, action = 'draw', { random = randomUnitInterval, uuid = () => crypto.randomUUID(), now = () => Date.now(), initialItemId = null, skipCurse = false, archmotherOrigin = false } = {}) {
  const state = structuredClone(source);
  const inBuild = state.preferences.mode === 'build';
  if (inBuild && (state.build.fate?.totalLocked || state.build.fate?.pendingArchmother || state.build.fate?.pendingChicken || state.build.fate?.pendingKing)) return null;
  const royal = inBuild && action === 'draw' ? state.build.fate?.kingImpostorQueue?.[0] : null;
  if (inBuild && state.build.fate?.kingImpostorQueue?.length && action !== 'draw') return null;
  if (inBuild && action !== 'draw' && getLatestBuildEntries(state.build).some(entry => isRoyalEntryUnrevealed(state.build, entry))) return null;
  const result = currentDrawResult(state, items);
  if (action !== 'draw' && !canUseItemAction(inBuild ? state.build.itemActions : state.itemActions, result, action)) return null;
  const steps = [];
  function addStep(stepAction, cursed = false) {
    const before = structuredClone(state);
    const probabilities = distributionForDraw(state, items, stepAction, { forced: cursed });
    if (!probabilities.eligibleCount) return false;
    const specifiedId = !steps.length && royal ? royal.itemId : initialItemId;
    const ticket = !steps.length && specifiedId ? probabilities.items.find(entry => entry.item.id === specifiedId)?.item
      : pickWeightedDistribution(probabilities, { random });
    if (!ticket) return false;
    const selected = probabilities.items.find(entry => entry.item.id === ticket.id);
    const entry = { itemId: ticket.id, time: now(), probability: selected.probability, weight: selected.weight, drawId: uuid(),
      ...(ticket.combo ? { itemIds: [...ticket.itemIds] } : {}), ...(cursed ? { cursed: true } : {}) };
    if (inBuild && shouldSealBuildDraw(state.build)) entry.sealed = true;
    if (!steps.length && royal) Object.assign(entry, royal, { probability: selected.probability, weight: selected.weight });
    const archmotherSelected = inBuild && archmotherOrigin === true && !steps.length && !cursed;
    if (archmotherSelected) entry.archmotherOrigin = true;
    const previousResult = currentDrawResult(state, items);
    let changes = null;
    if (inBuild) {
      const applied = applyBuildDraw(state.build, ticket, entry, items, { action: stepAction, random, preservePosition: !!royal, recordUndo: !royal });
      state.build = applied.build; changes = applied.changes || applied.meta;
      if (royal) state.build.fate.kingImpostorQueue = state.build.fate.kingImpostorQueue.slice(1);
    } else {
      if (probabilities.consumes) state.history.push(entry);
      state.rouletteResult = { ...entry, consumed: probabilities.consumes !== false };
    }
    if (stepAction !== 'draw') {
      if (inBuild) state.build.itemActions = spendItemAction(state.build.itemActions, previousResult, entry, stepAction);
      else state.itemActions = spendItemAction(state.itemActions, previousResult, entry, stepAction);
    }
    steps.push({ before, after: structuredClone(state), ticket, entry, distribution: probabilities, changes, cursed, sealed: entry.sealed === true, ...(archmotherSelected ? { archmotherSelected: true } : {}), ...(royal ? { kingScripted: true } : {}) });
    return true;
  }
  if (!addStep(action)) return null;
  const chance = skipCurse || royal ? 0 : Math.min(1, Math.max(0, source.preferences.curseChance ?? 0));
  let curseCount = 0;
  const checks = steps[0].ticket.combo ? steps[0].ticket.itemIds.length : 1;
  if (chance > 0) for (let check = 0; check < checks; check++) {
    const curseRoll = random();
    if (!Number.isFinite(curseRoll) || curseRoll < 0 || curseRoll >= 1) throw new RangeError('Invalid curse random value.');
    if (curseRoll < chance) curseCount++;
  }
  let curseUnavailable = false;
  for (let index = 0; index < curseCount; index++) if (!addStep('draw', true)) { curseUnavailable = true; break; }
  return { session: state, steps, curseTriggered: steps.length > 1, curseCount: steps.length - 1, curseUnavailable };
}
