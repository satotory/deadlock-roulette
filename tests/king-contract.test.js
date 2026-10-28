import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../src/catalog-data.js';
import { createSession, parseSessionJSON, serializeSession } from '../src/session.js';
import { getKingContractAvailability, planResolveKingContract, shouldSealBuildDraw } from '../src/king-contract.js';
import { planBuildFateDraw, getBuildFateJournal, isBuildEntrySealed, revealNextSealedPurchase } from '../src/build-fate.js';
import { planDrawSequence } from '../src/draw-sequence.js';
import { calculateBuildDistribution, calculateBuildAction, getLatestBuildResult } from '../src/draw-rules.js';
import { canUndoBuildDraw, undoBuildDraw, applyBuildDraw } from '../src/build-inventory.js';
import { createContract, replayContract } from '../src/contracts.js';

const items = catalog.items;
let controlsId = 0;
const controls = (values = []) => {
  let id = 0;
  const group = ++controlsId;
  return { random: () => values.length ? values.shift() : 0, uuid: () => `royal-${group}-${++id}`, now: () => 1000 + id };
};
function pending(count = 5) {
  const history = items.slice(0, count).map((item, index) => ({ itemId: item.id, drawId: `owned-${index}`, time: index,
    probability: .1, weight: 1, acquiredOrder: index + 1 }));
  return createSession({ preferences: { mode: 'build', curseChance: 0, chickenChance: 0, archmotherChance: 0, hiddenKingChance: 0 },
    build: { heroId: '6', history, purchasePlan: history, starterOrderVersion: 1, dynamicWeights: false, fate: { kingActive: true,
      pendingKing: { id: 'king-event', stage: 'mode', createdAt: 100 }, journal: [{ id: 'king-event', kind: 'hidden-king', time: 100 }] } } }, items);
}

test('new King menus persist and block all public mutation; legacy King builds retain the veil', () => {
  const source = pending();
  assert.equal(source.build.fate.kingMode, null);
  assert.equal(shouldSealBuildDraw(source.build), false);
  const resumed = parseSessionJSON(serializeSession(source), items);
  assert.deepEqual(resumed.build.fate.pendingKing, source.build.fate.pendingKing);
  assert.equal(planBuildFateDraw(resumed, items).pendingKing.id, 'king-event');
  for (const action of ['draw', 'reroll', 'upgrade', 'downgrade']) assert.equal(planDrawSequence(resumed, items, action), null);
  assert.equal(canUndoBuildDraw(resumed.build), false);
  assert.throws(() => applyBuildDraw(resumed.build, items[100], { itemId: items[100].id, drawId: 'bypass' }, items), RangeError);
  assert.equal(shouldSealBuildDraw({ fate: { kingActive: true } }), true);
  const choices = getKingContractAvailability(source, items);
  assert.deepEqual(choices.map(choice => choice.mode), ['exchange', 'treasury', 'impostor', 'decree']);
  assert.ok(choices.every(choice => choice.available));
  assert.deepEqual(source, resumed, 'Availability never mutates the live source');
});

test('exchange stages a persistent sacrifice menu, excludes locked items and replaces with another tier', () => {
  const source = pending();
  source.build.history[0].cursed = source.build.purchasePlan[0].cursed = true;
  const availability = getKingContractAvailability(source, items).find(choice => choice.mode === 'exchange');
  assert.ok(!availability.sacrificeItemIds.includes(source.build.history[0].itemId));
  const stage = planResolveKingContract(source, items, { mode: 'exchange' }, { random: () => { throw new Error('Staging must not generate a reward'); } });
  assert.equal(stage.session.build.fate.pendingKing.stage, 'sacrifice');
  assert.deepEqual(parseSessionJSON(serializeSession(stage.session), items).build.fate.pendingKing, stage.session.build.fate.pendingKing);
  assert.equal(stage.steps.length, 0);
  const sacrifice = source.build.history[1];
  const sourceCopy = structuredClone(stage.session);
  const plan = planResolveKingContract(stage.session, items, { mode: 'exchange', sacrificeItemId: sacrifice.itemId }, controls());
  assert.deepEqual(stage.session, sourceCopy);
  assert.equal(plan.session.build.fate.pendingKing, null);
  assert.equal(plan.session.build.fate.kingMode, 'exchange');
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].entry.kingOrigin, true);
  assert.equal(plan.steps[0].entry.sealed, true);
  assert.notEqual(plan.steps[0].ticket.tier, items.find(item => item.id === sacrifice.itemId).tier);
  assert.ok(!plan.session.build.history.some(entry => entry.itemId === sacrifice.itemId));
  assert.ok(plan.session.build.discardedItemIds.includes(sacrifice.itemId));
  assert.equal(plan.timeline[0].event.type, 'king-contract');
  assert.equal(plan.timeline[1].type, 'draw');
  assert.equal(canUndoBuildDraw(plan.session.build), false);
  assert.equal(getBuildFateJournal(plan.session.build).length, 1);
  assert.equal(getBuildFateJournal(plan.session.build)[0].mode, 'exchange');
  assert.equal(getBuildFateJournal(plan.session.build)[0].sacrificedEntries[0].itemId, sacrifice.itemId);
  const next = planBuildFateDraw(plan.session, items, 'draw', controls());
  assert.equal(next.steps[0].entry.sealed, undefined, 'Exchange does not veil future ordinary drops');
  assert.ok(undoBuildDraw(next.session.build));
});

test('exchange availability respects source categories, tiers, zero weights and ordinary slot capacity', () => {
  const source = pending();
  source.build.enabledTiers = [1];
  source.settings.excludedIds = items.filter(item => !source.build.history.some(entry => entry.itemId === item.id)).map(item => item.id);
  const availability = getKingContractAvailability(source, items).find(choice => choice.mode === 'exchange');
  assert.equal(availability.available, false);
  assert.equal(planResolveKingContract(source, items, { mode: 'exchange', sacrificeItemId: source.build.history[1].itemId }, controls()), null);
});

test('treasury replaces the last three chronological items with T4 plus two distinct pair rewards', () => {
  const source = pending(12);
  source.build.history.reverse();
  const removedIds = source.build.history.filter(entry => entry.acquiredOrder >= 10).sort((a, b) => b.acquiredOrder - a.acquiredOrder).map(entry => entry.itemId);
  const plan = planResolveKingContract(source, items, { mode: 'treasury' }, controls());
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].ticket.tier, 4);
  assert.equal(plan.steps[0].ticket.combo, undefined);
  assert.equal(plan.steps[1].ticket.combo, true);
  assert.equal(plan.steps[1].changes.insertedItemIds.length, 2);
  const rewardIds = [plan.steps[0].ticket.id, ...plan.steps[1].ticket.itemIds];
  assert.equal(new Set(rewardIds).size, 3);
  assert.ok(rewardIds.every(id => plan.session.build.history.some(entry => entry.itemId === id && entry.kingOrigin && entry.sealed)));
  assert.ok(plan.session.build.history.length <= 12);
  assert.deepEqual(plan.events[0].sacrificedEntries.map(entry => entry.itemId), removedIds);
  assert.equal(plan.session.build.fate.kingMode, 'treasury');
  assert.equal(plan.session.build.inventoryUndo.length, 0);
  assert.equal(canUndoBuildDraw(plan.session.build), false);
  assert.equal(getBuildFateJournal(plan.session.build)[0].mode, 'treasury');
  const restored = parseSessionJSON(serializeSession(plan.session), items);
  assert.deepEqual(restored.build.fate, plan.session.build.fate);
  assert.ok(restored.build.history.filter(entry => entry.kingOrigin).length >= 3);
});

test('treasury is unavailable if the enabled source pool cannot deliver T4 and a real distinct pair', () => {
  const source = pending();
  source.build.enabledTiers = [1, 2, 3];
  assert.equal(getKingContractAvailability(source, items).find(choice => choice.mode === 'treasury').available, false);
  assert.equal(planResolveKingContract(source, items, { mode: 'treasury' }, controls()), null);
  source.build.enabledTiers = [4];
  source.settings.enabledCategories = ['weapon'];
  const pool = calculateBuildDistribution(items, source.settings, { ...source.build, fate: { ...source.build.fate, pendingKing: null, kingMode: 'treasury' } });
  if (!pool.items.some(entry => entry.item.combo)) assert.equal(getKingContractAvailability(source, items).find(choice => choice.mode === 'treasury').available, false);
});

test('impostor precommits exactly one T1 among two genuine T3/T4, issues solo purchases without recursive fates or positional clues', () => {
  const source = pending();
  source.preferences.curseChance = source.preferences.chickenChance = source.preferences.archmotherChance = source.preferences.hiddenKingChance = 1;
  const selected = planResolveKingContract(source, items, { mode: 'impostor' }, controls([0, 0, 0, .99]));
  assert.equal(selected.steps.length, 0);
  const queue = selected.session.build.fate.kingImpostorQueue;
  assert.equal(queue.length, 3);
  assert.equal(new Set(queue.map(entry => entry.itemId)).size, 3);
  assert.equal(queue.filter(entry => entry.kingImpostor).length, 1);
  assert.equal(queue[2].kingImpostor, true);
  assert.ok(queue.every(entry => entry.sealed && entry.kingOrigin));
  for (const entry of queue) assert.ok(entry.kingImpostor ? items.find(item => item.id === entry.itemId).tier === 1 : [3, 4].includes(items.find(item => item.id === entry.itemId).tier));
  let current = parseSessionJSON(serializeSession(selected.session), items);
  const ownedCount = current.build.purchasePlan.length;
  for (let index = 0; index < 3; index++) {
    assert.equal(planDrawSequence(current, items, 'reroll'), null);
    const draw = planBuildFateDraw(current, items, 'draw', { random: () => { throw new Error('Precommitted purchases cannot reroll RNG'); } });
    assert.equal(draw.steps.length, 1);
    assert.equal(draw.events.length, 0);
    assert.equal(draw.steps[0].entry.itemId, queue[index].itemId);
    assert.equal(draw.steps[0].kingScripted, true);
    assert.equal(draw.steps[0].ticket.combo, undefined);
    assert.deepEqual(draw.steps[0].changes.earlyItemIds, []);
    assert.equal(draw.session.build.fate.kingImpostorQueue.length, 2 - index);
    current = parseSessionJSON(serializeSession(draw.session), items);
  }
  assert.equal(current.build.purchasePlan.findIndex(entry => entry.kingImpostor), ownedCount + 2);
  assert.equal(canUndoBuildDraw(current.build), false);
  const royal = current.build.purchasePlan.filter(entry => entry.kingOrigin);
  assert.ok(royal.every(entry => isBuildEntrySealed(current.build, entry, items)));
  for (const entry of royal) {
    current.build = revealNextSealedPurchase(current.build, items);
    assert.equal(isBuildEntrySealed(current.build, entry, items), false);
  }
  assert.equal(royal.filter(entry => entry.kingImpostor).length, 1);
});

test('a royal queue respects later source exclusions instead of replacing its saved outcome', () => {
  const selected = planResolveKingContract(pending(), items, { mode: 'impostor' }, controls());
  const queue = structuredClone(selected.session.build.fate.kingImpostorQueue);
  selected.session.settings.excludedIds.push(queue[0].itemId);
  assert.equal(calculateBuildDistribution(items, selected.session.settings, selected.session.build).eligibleCount, 0);
  assert.equal(planBuildFateDraw(selected.session, items, 'draw', { random: () => { throw new Error('Cannot replace a filtered royal outcome'); } }), null);
  assert.deepEqual(selected.session.build.fate.kingImpostorQueue, queue);
  selected.session.settings.excludedIds = [];
  assert.equal(planBuildFateDraw(selected.session, items, 'draw', controls()).steps[0].entry.itemId, queue[0].itemId);
  assert.equal(getKingContractAvailability(pending(10), items).find(choice => choice.mode === 'impostor').reason, 'need-three-slots');
});

test('unrevealed royal rewards cannot leak their tier through manual action availability; revealing enables actions', () => {
  const source = pending();
  const chosen = source.build.history[0].itemId;
  const plan = planResolveKingContract(source, items, { mode: 'exchange', sacrificeItemId: chosen }, controls());
  const result = getLatestBuildResult(plan.session.build, items).item;
  for (const action of ['reroll', 'upgrade', 'downgrade']) {
    assert.equal(calculateBuildAction(items, plan.session.settings, plan.session.build, result, action).eligibleCount, 0);
    assert.equal(planDrawSequence(plan.session, items, action, { random: () => { throw new Error('An unrevealed reward cannot reroll'); } }), null);
  }
  const visible = { ...plan.session, build: revealNextSealedPurchase(plan.session.build, items) };
  assert.ok(calculateBuildAction(items, visible.settings, visible.build, result, 'reroll').eligibleCount > 0);
  const changed = planDrawSequence(visible, items, 'reroll', controls());
  assert.ok(changed);
  assert.deepEqual(changed.session.build.itemActions.usedActions, ['reroll']);
});

test('decree applies a persistent sixfold category weight and blocks Undo before the contract boundary', () => {
  const source = pending();
  const baselineBuild = { ...source.build, fate: { ...source.build.fate, pendingKing: null, kingMode: 'exchange' } };
  const baseline = calculateBuildDistribution(items, source.settings, baselineBuild);
  const decree = planResolveKingContract(source, items, { mode: 'decree' }, controls());
  assert.equal(decree.session.build.fate.kingEdict, 'spirit');
  assert.equal(decree.steps.length, 0);
  assert.equal(canUndoBuildDraw(decree.session.build), false);
  const changed = calculateBuildDistribution(items, decree.session.settings, decree.session.build);
  for (const entry of changed.items.filter(entry => !entry.item.combo)) {
    const old = baseline.items.find(before => before.item.id === entry.item.id);
    assert.equal(entry.weight, old.weight * (entry.item.category === 'spirit' ? 6 : 1));
  }
  assert.deepEqual(decree.session.settings, source.settings);
  const next = planBuildFateDraw(decree.session, items, 'draw', controls());
  const undone = undoBuildDraw(next.session.build);
  assert.equal(undone.fate.kingEdict, 'spirit');
  assert.equal(canUndoBuildDraw(undone), false);
  const archived = replayContract(createContract(decree.session.build, 'Royal decree', { id: 'decree-contract' }), source.build);
  assert.equal(archived.fate.kingMode, 'decree');
  assert.equal(archived.fate.kingEdict, 'spirit');
  assert.equal(getBuildFateJournal(archived)[0].edict, 'spirit');
});

test('no-T1 decree excludes starter halves from pairs too and never overrides source restrictions', () => {
  const source = pending();
  const selected = planResolveKingContract(source, items, { mode: 'decree' }, controls([.999]));
  assert.equal(selected.session.build.fate.kingEdict, 'no-t1');
  const pool = calculateBuildDistribution(items, selected.session.settings, selected.session.build);
  assert.ok(pool.items.every(entry => (entry.item.combo ? entry.item.components : [entry.item]).every(item => item.tier !== 1)));
  assert.equal(pool.byTier[1], 0);
  selected.session.settings.enabledCategories = ['weapon'];
  selected.session.settings.tierWeights[4] = 0;
  const filtered = calculateBuildDistribution(items, selected.session.settings, selected.session.build);
  assert.ok(filtered.items.every(entry => (entry.item.combo ? entry.item.components : [entry.item]).every(item => item.category === 'weapon' && item.tier !== 4)));
});

test('category decrees multiply already normalized weights by six at the 100 maximum and retain zero exclusions', () => {
  const source = pending();
  for (const category of ['spirit', 'vitality']) for (const baseWeight of [20, 100]) {
    const settings = structuredClone(source.settings);
    settings.categoryWeights[category] = baseWeight;
    const baseBuild = { ...source.build, fate: { ...source.build.fate, pendingKing: null, kingMode: 'exchange' } };
    const baseline = calculateBuildDistribution(items, settings, baseBuild, { pairsEnabled: false });
    const edictBuild = { ...baseBuild, fate: { ...baseBuild.fate, kingMode: 'decree', kingEdict: category } };
    const multiplied = calculateBuildDistribution(items, settings, edictBuild, { pairsEnabled: false });
    for (const entry of multiplied.items) {
      const old = baseline.items.find(candidate => candidate.item.id === entry.item.id);
      assert.equal(entry.weight, old.weight * (entry.item.category === category ? 6 : 1));
    }
    assert.equal(multiplied.settings.categoryWeights[category], baseWeight, 'The source setting is not rewritten or clamped by the decree');
    settings.categoryWeights[category] = 0;
    assert.ok(calculateBuildDistribution(items, settings, edictBuild).items.every(entry =>
      (entry.item.combo ? entry.item.components : [entry.item]).every(item => item.category !== category)));
  }
});

test('a decree draw at all three maximum weights keeps its exact six-million metadata through the codec', () => {
  const source = pending();
  source.build.fate.pendingKing = null;
  source.build.fate.kingMode = 'decree';
  source.build.fate.kingEdict = 'spirit';
  const item = calculateBuildDistribution(items, source.settings, source.build, { pairsEnabled: false }).items.find(entry => entry.item.category === 'spirit').item;
  source.settings.categoryWeights.spirit = 100;
  source.settings.tierWeights[item.tier] = 100;
  source.settings.itemWeights[item.id] = 100;
  const draw = planDrawSequence(source, items, 'draw', { ...controls(), initialItemId: item.id });
  assert.equal(draw.steps[0].entry.weight, 6000000);
  assert.equal(draw.session.build.history.find(entry => entry.itemId === item.id).weight, 6000000);
  assert.equal(draw.session.build.purchasePlan.find(entry => entry.itemId === item.id).weight, 6000000);
  const restored = parseSessionJSON(serializeSession(draw.session), items);
  assert.equal(restored.build.history.find(entry => entry.itemId === item.id).weight, 6000000);
  assert.equal(restored.build.purchasePlan.find(entry => entry.itemId === item.id).weight, 6000000);
});

test('archived royal provenance and queued outcomes survive replay without reopening the old mode menu', () => {
  const selected = planResolveKingContract(pending(), items, { mode: 'impostor' }, controls());
  const archived = createContract(selected.session.build, 'Royal script', { id: 'royal-script' });
  const replayed = replayContract(archived, selected.session.build);
  assert.equal(replayed.fate.pendingKing, null);
  assert.equal(replayed.fate.kingMode, 'impostor');
  assert.deepEqual(replayed.fate.kingImpostorQueue, selected.session.build.fate.kingImpostorQueue);
  assert.equal(getBuildFateJournal(replayed).length, 1);
  assert.equal(getBuildFateJournal(replayed)[0].mode, 'impostor');
});
