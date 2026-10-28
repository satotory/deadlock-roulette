import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../src/catalog-data.js';
import { createSession, parseSessionJSON, serializeSession } from '../src/session.js';
import { createBuildState } from '../src/build-core.js';
import { applyBuildDraw, canUndoBuildDraw, undoBuildDraw, coalesceBuildInventory } from '../src/build-inventory.js';
import { calculateBuildDistribution } from '../src/draw-rules.js';
import { planDrawSequence } from '../src/draw-sequence.js';
import { createContract, replayContract } from '../src/contracts.js';
import { normalizeBuildFate, MAX_FATE_JOURNAL } from '../src/build-fate-state.js';
import { planBuildFateDraw, resolveArchmotherOffer, getNextSealedPurchase, isBuildEntrySealed, revealNextSealedPurchase, getPurchaseIdentity, getBuildFateJournal, getPendingChickenEvent, acknowledgeBuildChicken } from '../src/build-fate.js';

const items = Array.from({ length: 16 }, (_, index) => ({ id: `i${index}`, name: `Item ${index}`, tier: 2, category: 'spirit' }));
const meta = (id, index) => ({ itemId: id, drawId: `owned-${index}`, time: index, probability: .1, weight: 1, acquiredOrder: index });
function state(count = 3, preferences = {}, supplied = items) {
  const history = supplied.slice(0, count).map((item, index) => meta(item.id, index + 1));
  return createSession({ build: { heroId: '6', history, purchasePlan: history, starterOrderVersion: 1 },
    preferences: { mode: 'build', curseChance: 0, pairsEnabled: false, chickenChance: 0, archmotherChance: 0, hiddenKingChance: 0, ...preferences } }, supplied);
}
let controlSequence = 0;
function controls(values = []) {
  const prefix = ++controlSequence;
  let uuid = 0, time = 100;
  return { random: () => values.length ? values.shift() : 0, uuid: () => `new-${prefix}-${++uuid}`, now: () => ++time };
}

test('fate defaults and independent 0–100% controls sanitize and survive the session codec', () => {
  const defaults = createSession(undefined, items);
  for (const key of ['chickenChance', 'archmotherChance', 'hiddenKingChance']) assert.equal(defaults.preferences[key], .1);
  const restored = createSession({ preferences: { chickenChance: -2, archmotherChance: 8, hiddenKingChance: 'bad' } }, items);
  assert.equal(restored.preferences.chickenChance, 0);
  assert.equal(restored.preferences.archmotherChance, 1);
  assert.equal(restored.preferences.hiddenKingChance, .1);
  assert.deepEqual(parseSessionJSON(serializeSession(restored), items).preferences, restored.preferences);
});

test('all D12 deletion ranges remove newest individual items and preserve removed pool tickets', () => {
  for (let die = 1; die <= 11; die++) {
    const source = state(3, { chickenChance: 1 });
    const original = structuredClone(source);
    const plan = planBuildFateDraw(source, items, 'draw', controls([0, 0, (die - .5) / 12]));
    const event = plan.events.find(event => event.type === 'chicken');
    const removedCount = die <= 6 ? 1 : die <= 9 ? 2 : 3;
    assert.equal(event.die, die);
    assert.equal(event.removedEntries.length, removedCount);
    assert.deepEqual(event.removedItemIds, ['i3', 'i2', 'i1'].slice(0, removedCount));
    assert.equal(plan.session.build.history.length, 4 - removedCount);
    assert.equal(plan.session.build.fate.chickenUsed, true);
    for (const id of event.removedItemIds) {
      assert.ok(plan.session.build.consumedTicketIds.includes(id));
      assert.ok(!calculateBuildDistribution(items, {}, plan.session.build).items.some(entry => entry.item.id === id));
    }
    assert.equal(plan.session.build.inventoryUndo.length, 0, 'Deleted items cannot be restored from a previous journal');
    assert.deepEqual(source, original, 'Planning never mutates the caller');
    assert.equal(plan.timeline.at(-1).type, 'event');
  }
});

test('chicken waits for three real items, ignores T1 positions, and never returns through Undo', () => {
  const two = planBuildFateDraw(state(1, { chickenChance: 1 }), items, 'draw', controls());
  assert.equal(two.session.build.history.length, 2);
  assert.equal(two.events.length, 0);
  assert.equal(two.session.build.fate.chickenUsed, false);
  const starterItems = items.map((item, index) => ({ ...item, tier: index === 5 ? 1 : 2 }));
  const plan = planBuildFateDraw(state(5, { chickenChance: 1 }, starterItems), starterItems, 'draw', controls([0, .999, 0, 0]));
  assert.equal(plan.steps[0].after.build.history.findIndex(entry => entry.itemId === 'i5'), 4);
  assert.deepEqual(plan.events[0].removedItemIds, ['i5'], 'The newest starter is deleted instead of the last visual slot');
  const acknowledged = { ...plan.session, build: acknowledgeBuildChicken(plan.session.build, plan.events[0].id) };
  const next = planBuildFateDraw(acknowledged, starterItems, 'draw', controls());
  assert.equal(next.events.filter(event => event.type === 'chicken').length, 0);
  const undone = undoBuildDraw(next.session.build);
  assert.equal(undone.fate.chickenUsed, true);
  assert.ok(undone.consumedTicketIds.includes('i5'));
});

test('D12 resets the pool, fills 12 cursed slots, and hard-locks every mutation without recursion', () => {
  const source = state(3, { chickenChance: 1, curseChance: 1, hiddenKingChance: 1 });
  source.build.itemActions.usedActions = ['reroll'];
  const plan = planBuildFateDraw(source, items, 'draw', controls([0, 0, 0, 0, .999]));
  const event = plan.events.find(event => event.type === 'chicken');
  assert.equal(event.die, 12);
  assert.equal(event.after.build.history.length, 0);
  assert.equal(event.fullReroll, true);
  const rerolls = plan.steps.filter(step => step.fullReroll);
  assert.equal(rerolls.length, 12);
  assert.equal(plan.session.build.history.length, 12);
  assert.ok(plan.session.build.history.every(entry => entry.cursed));
  assert.ok(plan.session.build.history.some(entry => entry.itemId === 'i0'), 'The fresh pool can contain previously drawn items');
  assert.equal(plan.session.build.fate.totalLocked, true);
  assert.equal(plan.session.build.fate.kingActive, false, 'A completed locked build cannot waste a King event');
  assert.deepEqual(plan.session.build.itemActions.usedActions, ['reroll'], 'Chicken never refunds existing action charges');
  assert.equal(planDrawSequence(plan.session, items), null);
  for (const action of ['draw', 'reroll', 'upgrade', 'downgrade']) assert.equal(planBuildFateDraw(plan.session, items, action, controls()), null);
  assert.equal(calculateBuildDistribution(items, {}, plan.session.build).eligibleCount, 0);
  assert.equal(canUndoBuildDraw(plan.session.build), false);
  assert.equal(undoBuildDraw(plan.session.build), null);
  assert.throws(() => applyBuildDraw(plan.session.build, items[15], { ...meta('i15', 999), drawId: 'bypass' }, items), RangeError);
  const restored = parseSessionJSON(serializeSession(plan.session), items);
  assert.equal(restored.build.fate.totalLocked, true);
  assert.equal(planDrawSequence(restored, items), null);
});

test('a restricted D12 pool fills its maximum and reports the shortage instead of hanging', () => {
  const tiny = items.slice(0, 3);
  const plan = planBuildFateDraw(state(2, { chickenChance: 1 }, tiny), tiny, 'draw', controls([0, 0, .999]));
  assert.equal(plan.session.build.history.length, 3);
  assert.equal(plan.session.build.fate.totalLocked, true);
  assert.equal(plan.events.at(-1).type, 'chicken-limited-pool');
  assert.equal(plan.events.at(-1).slotCount, 3);
});

test('King activates after the fifth item; legacy veil reveals the next purchase without changing items', () => {
  const activated = planBuildFateDraw(state(4, { hiddenKingChance: 1 }), items, 'draw', controls());
  assert.equal(activated.events[0].type, 'hidden-king');
  assert.equal(activated.steps[0].entry.sealed, undefined, 'The activation batch remains visible');
  assert.equal(activated.session.build.fate.pendingKing.stage, 'mode');
  assert.equal(activated.session.build.fate.kingMode, null);
  assert.deepEqual(parseSessionJSON(serializeSession(activated.session), items).build.fate.pendingKing, activated.session.build.fate.pendingKing);
  activated.session.build.fate.pendingKing = null;
  activated.session.build.fate.kingMode = 'veil';
  const hidden = planBuildFateDraw(activated.session, items, 'draw', controls());
  assert.equal(hidden.events.length, 0);
  assert.equal(hidden.steps[0].entry.sealed, true);
  const next = getNextSealedPurchase(hidden.session.build, items);
  assert.equal(next.itemId, 'i5');
  const history = structuredClone(hidden.session.build.history), route = structuredClone(hidden.session.build.purchasePlan);
  const revealed = revealNextSealedPurchase(hidden.session.build, items);
  assert.deepEqual(revealed.history, history);
  assert.deepEqual(revealed.purchasePlan, route);
  assert.equal(isBuildEntrySealed(revealed, history.at(-1), items), false);
  assert.equal(getNextSealedPurchase(revealed, items), null);
  const undone = undoBuildDraw(revealed);
  assert.equal(undone.fate.kingActive, true);
  const control = controls(); control.uuid = () => 'different-redraw';
  const redrawn = planBuildFateDraw({ ...hidden.session, build: undone }, items, 'draw', control);
  assert.equal(redrawn.steps[0].entry.itemId, next.itemId);
  assert.equal(isBuildEntrySealed(redrawn.session.build, redrawn.session.build.history.at(-1), items), true, 'Undo and redrawing the same item cannot reuse the old reveal');
});

test('sealed recipe purchases and their reveal identities survive merge, archive and replay', () => {
  const actual = catalog.items;
  const base = actual.find(item => item.name === 'Mystic Vulnerability');
  const upgrade = actual.find(item => item.name === 'Escalating Exposure');
  let source = state(0, {}, actual);
  source.build.fate.kingActive = true;
  source.build.fate.kingMode = 'veil';
  const first = planBuildFateDraw(source, actual, 'draw', { ...controls(), initialItemId: base.id });
  source = first.session;
  source.build = revealNextSealedPurchase(source.build, actual);
  const second = planBuildFateDraw(source, actual, 'draw', { ...controls(), uuid: () => 'upgrade-ticket', initialItemId: upgrade.id });
  assert.deepEqual(second.session.build.purchasePlan.map(entry => entry.itemId), [base.id, upgrade.id]);
  assert.equal(isBuildEntrySealed(second.session.build, second.session.build.purchasePlan[0], actual), false);
  assert.equal(isBuildEntrySealed(second.session.build, second.session.build.history[0], actual), true);
  assert.equal(getNextSealedPurchase(second.session.build, actual).itemId, upgrade.id);
  const saved = createContract(second.session.build, 'Sealed recipe', { id: 'sealed-contract' });
  const restored = replayContract(saved, second.session.build);
  assert.deepEqual(restored.fate.revealedPurchaseKeys, source.build.fate.revealedPurchaseKeys);
  assert.equal(getNextSealedPurchase(restored, actual).itemId, upgrade.id);
  assert.equal(isBuildEntrySealed(parseSessionJSON(serializeSession(second.session), actual).build, restored.history[0], actual), true);
});

test('an already owned half of a future pair retains its original visible purchase identity', () => {
  const actual = catalog.items, solo = actual.find(item => item.name === 'Mystic Shot');
  let source = state(0, {}, actual);
  const first = planBuildFateDraw(source, actual, 'draw', { ...controls(), initialItemId: solo.id });
  source = first.session;
  source.build.fate.kingActive = true;
  source.build.fate.kingMode = 'veil';
  source.preferences.pairsEnabled = true;
  const pair = planBuildFateDraw(source, actual, 'draw', { ...controls(), uuid: () => 'pair-ticket', initialItemId: 'combo:mystic-express' });
  const existing = pair.session.build.history.find(entry => entry.itemId === solo.id);
  assert.equal(existing.drawId, 'pair-ticket');
  assert.equal(isBuildEntrySealed(pair.session.build, existing, actual), false);
  const secret = pair.session.build.purchasePlan.find(entry => entry.itemId !== solo.id);
  assert.equal(isBuildEntrySealed(pair.session.build, secret, actual), true);
});

test('Archmother persists three unique choices, consumes its event on creation, and resolves old curses once', () => {
  const source = state(0, { archmotherChance: 1, curseChance: 1 });
  const offer = planBuildFateDraw(source, items, 'draw', controls());
  assert.equal(offer.steps.length, 0);
  assert.equal(offer.timeline[0].event.type, 'archmother-offer');
  assert.equal(offer.pendingOffer.itemIds.length, 3);
  assert.equal(new Set(offer.pendingOffer.itemIds).size, 3);
  assert.equal(offer.session.build.fate.archmotherUsed, true);
  const resumed = parseSessionJSON(serializeSession(offer.session), items);
  const same = planBuildFateDraw(resumed, items, 'draw', { random: () => { throw new Error('Closing the offer must not reroll'); } });
  assert.deepEqual(same.pendingOffer, offer.pendingOffer);
  assert.equal(same.timeline.length, 0);
  assert.equal(planDrawSequence(resumed, items, 'reroll'), null);
  assert.equal(undoBuildDraw(resumed.build), null);
  assert.equal(resolveArchmotherOffer(resumed, items, 'invalid-choice', controls()), null);
  const choice = offer.pendingOffer.itemIds[2];
  const picked = resolveArchmotherOffer(resumed, items, choice, controls());
  assert.equal(picked.steps[0].entry.itemId, choice);
  assert.equal(picked.steps[0].archmotherSelected, true);
  assert.equal(picked.steps[0].entry.archmotherOrigin, true);
  assert.equal(picked.steps.length, 2);
  assert.equal(picked.steps[1].cursed, true);
  assert.equal(picked.steps[1].entry.archmotherOrigin, undefined);
  const record = getBuildFateJournal(picked.session.build, items)[0];
  assert.equal(record.kind, 'archmother');
  assert.equal(record.offerId, offer.pendingOffer.id);
  assert.equal(record.chosenEntry.itemId, choice);
  assert.equal(record.chosenEntry.archmotherOrigin, true);
  assert.equal(picked.session.build.fate.pendingArchmother, null);
  assert.equal(picked.session.build.fate.archmotherUsed, true);
  const another = planBuildFateDraw(picked.session, items, 'draw', controls());
  assert.equal(another.pendingOffer, undefined);
  assert.equal(another.events.filter(event => event.type === 'archmother-offer').length, 0);
});

test('manual actions and normal roulette bypass event rolls while all one-build flags survive Undo', () => {
  const source = state(3, { archmotherChance: 1, chickenChance: 1, hiddenKingChance: 1 });
  const manual = planBuildFateDraw(source, items, 'reroll', controls());
  assert.equal(manual.events.length, 0);
  assert.equal(manual.session.build.fate.archmotherUsed, false);
  const normal = planBuildFateDraw({ ...source, preferences: { ...source.preferences, mode: 'roulette' } }, items, 'draw', controls());
  assert.equal(normal.events.length, 0);
  assert.deepEqual(normal.session.build.fate, source.build.fate);
  const next = planDrawSequence(source, items, 'draw', controls());
  next.session.build.fate = { ...next.session.build.fate, chickenUsed: true, archmotherUsed: true, kingActive: true };
  assert.equal(undoBuildDraw(next.session.build).fate.chickenUsed, true);
  assert.equal(undoBuildDraw(next.session.build).fate.archmotherUsed, true);
  assert.equal(undoBuildDraw(next.session.build).fate.kingActive, true);
  assert.equal(createBuildState().fate.chickenUsed, false);
  assert.equal(createBuildState().fate.archmotherUsed, false);
  assert.equal(createBuildState().fate.kingActive, false);
});

test('King uses the real post-batch inventory, including curse bonuses and Chicken deletions', () => {
  for (let count = 0; count <= 3; count++) {
    const below = planBuildFateDraw(state(count, { hiddenKingChance: 1 }), items, 'draw', controls());
    assert.equal(below.session.build.fate.kingActive, false);
    assert.equal(below.events.length, 0);
  }
  const bonuses = planBuildFateDraw(state(3, { curseChance: 1, hiddenKingChance: 1 }), items, 'draw', controls());
  assert.equal(bonuses.session.build.history.length, 5);
  assert.equal(bonuses.session.build.fate.kingActive, true);
  const pecked = planBuildFateDraw(state(4, { chickenChance: 1, hiddenKingChance: 1 }), items, 'draw', controls([0, 0, 0]));
  assert.equal(pecked.session.build.history.length, 4);
  assert.equal(pecked.session.build.fate.kingActive, false, 'The transient fifth item was removed before the King gate');
  assert.deepEqual(pecked.events.map(event => event.type), ['chicken']);
  const fiveAfterPecks = planBuildFateDraw(state(5, { chickenChance: 1, hiddenKingChance: 1 }), items, 'draw', controls([0, 0, 0, 0]));
  assert.equal(fiveAfterPecks.session.build.history.length, 5);
  assert.deepEqual(fiveAfterPecks.events.map(event => event.type), ['chicken', 'hidden-king']);
  assert.deepEqual(getBuildFateJournal(fiveAfterPecks.session.build).map(record => record.kind), ['chicken', 'hidden-king']);
});

test('Chicken pending confirmation persists, blocks all mutations, and clears only the matching presentation', () => {
  const plan = planBuildFateDraw(state(3, { chickenChance: 1 }), items, 'draw', controls([0, 0, 0]));
  const restored = parseSessionJSON(serializeSession(plan.session), items);
  const record = getPendingChickenEvent(restored.build, items);
  assert.equal(record.id, plan.events[0].id);
  assert.equal(record.die, 1);
  assert.equal(restored.build.fate.pendingChicken, record.id);
  assert.equal(plan.events[0].after.build.fate.pendingChicken, record.id);
  assert.deepEqual(getBuildFateJournal(restored.build, items), getBuildFateJournal(plan.session.build, items));
  const noRandom = { random: () => { throw new Error('A pending presentation cannot generate new outcomes'); } };
  for (const action of ['draw', 'reroll', 'upgrade', 'downgrade']) {
    assert.equal(planBuildFateDraw(restored, items, action, noRandom), null);
    assert.equal(planDrawSequence(restored, items, action, noRandom), null);
  }
  assert.equal(canUndoBuildDraw(restored.build), false);
  assert.equal(undoBuildDraw(restored.build), null);
  assert.equal(calculateBuildDistribution(items, {}, restored.build).eligibleCount, 0);
  assert.throws(() => applyBuildDraw(restored.build, items[15], meta('i15', 99), items), RangeError);
  assert.equal(acknowledgeBuildChicken(restored.build, 'different-event').fate.pendingChicken, record.id);
  const acknowledged = acknowledgeBuildChicken(restored.build, record.id);
  assert.equal(acknowledged.fate.pendingChicken, null);
  assert.equal(getPendingChickenEvent(acknowledged, items), null);
  assert.deepEqual(acknowledged.history, restored.build.history, 'Confirmation never changes the committed outcome');
  assert.deepEqual(acknowledged.fate.journal, restored.build.fate.journal);
  const next = planBuildFateDraw({ ...restored, build: acknowledged }, items, 'draw', controls());
  const undone = undoBuildDraw(next.session.build);
  assert.equal(undone.fate.pendingChicken, null);
  assert.equal(undone.fate.chickenUsed, true);
  assert.deepEqual(undone.fate.journal, acknowledged.fate.journal);
});

test('D12 provenance and journal survive codec/archive; replay clears only the old presentation gate', () => {
  const source = state(3, { chickenChance: 1 });
  source.build.fate.kingActive = true;
  source.build.fate.kingMode = 'veil';
  const plan = planBuildFateDraw(source, items, 'draw', controls([0, 0, .999]));
  assert.ok(plan.steps.filter(step => step.fullReroll).every(step => step.entry.chickenOrigin && !step.after.build.fate.pendingChicken));
  assert.ok(plan.session.build.history.every(entry => entry.chickenOrigin && entry.cursed && entry.sealed));
  assert.ok(plan.session.build.purchasePlan.every(entry => entry.chickenOrigin && entry.cursed && entry.sealed));
  const restored = parseSessionJSON(serializeSession(plan.session), items);
  assert.deepEqual(restored.build.fate, plan.session.build.fate);
  assert.deepEqual(restored.build.purchasePlan, plan.session.build.purchasePlan);
  const contract = createContract(restored.build, 'Chicken contract', { id: 'chicken-contract', savedAt: 1000 });
  assert.equal(contract.build.fate.pendingChicken, plan.events[0].id);
  assert.ok(contract.build.history.every(entry => entry.chickenOrigin));
  const replayed = replayContract(contract, restored.build);
  assert.equal(replayed.fate.pendingChicken, null);
  assert.equal(replayed.fate.chickenUsed, true);
  assert.equal(replayed.fate.totalLocked, true);
  assert.deepEqual(replayed.fate.journal, restored.build.fate.journal);
  assert.equal(planDrawSequence({ ...restored, build: acknowledgeBuildChicken(restored.build, plan.events[0].id) }, items), null, 'Acknowledging D12 does not remove its permanent inventory lock');
});

test('removed-item journal masks retain visibility at removal permanently', () => {
  const source = state(4, { chickenChance: 1 });
  source.build.fate.kingActive = true;
  source.build.fate.kingMode = 'veil';
  source.build.history[3].sealed = source.build.purchasePlan[3].sealed = true;
  source.build.fate.revealedPurchaseKeys = [getPurchaseIdentity(source.build.purchasePlan[3])];
  const plan = planBuildFateDraw(source, items, 'draw', controls([0, 0, .8]));
  const removed = getBuildFateJournal(plan.session.build, items)[0].removedEntries;
  assert.deepEqual(removed.map(entry => [entry.itemId, entry.sealed]), [['i4', true], ['i3', false], ['i2', false]]);
  const changed = structuredClone(plan.session);
  changed.build.fate.revealedPurchaseKeys.push(getPurchaseIdentity(removed[0]));
  const restored = parseSessionJSON(serializeSession(changed), items);
  assert.equal(getBuildFateJournal(restored.build, items)[0].removedEntries[0].sealed, true, 'Later reveal state cannot expose a previously hidden removal');
});

test('journal normalization caps records, filters known items and strips untrusted snapshots', () => {
  const known = new Set(items.map(item => item.id));
  const source = Array.from({ length: MAX_FATE_JOURNAL + 4 }, (_, index) => ({
    id: `event-${index}`, kind: 'chicken', time: index, die: 1, removedEntries: [
      { ...meta('i0', 1), sealed: true, chickenOrigin: true, arbitrary: 'drop' },
      meta('unknown', 2),
    ], before: { secret: 'large session' }, after: { secret: 'large session' },
  }));
  source.push({ id: 'bad-die', kind: 'chicken', die: 13 }, { id: 'bad-kind', kind: 'other' });
  const fate = normalizeBuildFate({ journal: source, pendingChicken: 'event-35' }, known);
  assert.equal(fate.journal.length, MAX_FATE_JOURNAL);
  assert.equal(fate.journal[0].id, 'event-4');
  assert.equal(fate.pendingChicken, 'event-35');
  assert.equal(fate.chickenUsed, true);
  assert.deepEqual(Object.keys(fate.journal[0]).sort(), ['die', 'id', 'kind', 'removedEntries', 'time']);
  assert.equal(fate.journal[0].removedEntries.length, 1);
  assert.equal(fate.journal[0].removedEntries[0].arbitrary, undefined);
  assert.equal(fate.journal[0].removedEntries[0].chickenOrigin, true);
  assert.equal(normalizeBuildFate({ journal: source, pendingChicken: 'event-0' }, known).pendingChicken, null, 'A dropped journal entry cannot leave an unresumable gate');
  assert.equal(normalizeBuildFate({ journal: [{ id: 'offer-event', kind: 'archmother', offerId: 'offer', chosenEntry: meta('unknown', 1) }] }, known).journal.length, 0);
});

test('recipe descendants inherit Chicken origin while Mother origin stays on the chosen purchase; Undo restores badges', () => {
  const actual = catalog.items;
  const base = actual.find(item => item.name === 'Mystic Vulnerability');
  const upgrade = actual.find(item => item.name === 'Escalating Exposure');
  const source = state(0, {}, actual);
  const first = applyBuildDraw(source.build, base, { ...meta(base.id, 1), archmotherOrigin: true, chickenOrigin: true }, actual).build;
  const second = applyBuildDraw(first, upgrade, meta(upgrade.id, 2), actual).build;
  assert.equal(second.history[0].chickenOrigin, true);
  assert.equal(second.history[0].archmotherOrigin, undefined);
  assert.equal(second.purchasePlan[0].archmotherOrigin, true);
  assert.equal(second.purchasePlan[1].chickenOrigin, true);
  const restored = parseSessionJSON(serializeSession({ ...source, build: second }), actual).build;
  assert.deepEqual(restored.history, second.history);
  assert.deepEqual(restored.purchasePlan, second.purchasePlan);
  const undone = undoBuildDraw(restored);
  assert.deepEqual(undone.history, first.history);
  assert.deepEqual(undone.purchasePlan, first.purchasePlan);
  const archived = replayContract(createContract(second, 'Origin recipe', { id: 'origin-recipe' }), source.build);
  assert.deepEqual(archived.history, second.history);
  assert.deepEqual(archived.purchasePlan, second.purchasePlan);
});

test('a curse upgrade of the Mother gift is not itself marked as the selected gift', () => {
  const actual = catalog.items;
  const base = actual.find(item => item.name === 'Mystic Vulnerability');
  const upgrade = actual.find(item => item.name === 'Escalating Exposure');
  const source = state(0, { curseChance: 1 }, actual);
  source.settings.excludedIds = actual.filter(item => item.id !== base.id && item.id !== upgrade.id).map(item => item.id);
  source.build.fate.archmotherUsed = true;
  source.build.fate.pendingArchmother = { id: 'recipe-offer', itemIds: [base.id, upgrade.id, items[0].id], createdAt: 1 };
  const plan = resolveArchmotherOffer(source, actual, base.id, controls());
  assert.equal(plan.steps[0].archmotherSelected, true);
  assert.equal(plan.steps[1].entry.itemId, upgrade.id);
  assert.equal(plan.session.build.history[0].archmotherOrigin, undefined);
  assert.equal(plan.session.build.purchasePlan[0].archmotherOrigin, true);
  assert.equal(getBuildFateJournal(plan.session.build, actual)[0].chosenEntry.archmotherOrigin, true);
});

test('legacy coalescing and already-owned pair halves retain their own provenance', () => {
  const actual = catalog.items;
  const base = actual.find(item => item.name === 'Mystic Vulnerability');
  const upgrade = actual.find(item => item.name === 'Escalating Exposure');
  const history = [{ ...meta(base.id, 1), chickenOrigin: true, archmotherOrigin: true }, meta(upgrade.id, 2)];
  const migrated = coalesceBuildInventory({ heroId: '6', history, purchasePlan: history }, actual);
  assert.equal(migrated.history[0].chickenOrigin, true);
  assert.equal(migrated.history[0].archmotherOrigin, undefined);
  assert.equal(migrated.purchasePlan[0].archmotherOrigin, true);
  assert.equal(migrated.purchasePlan[1].chickenOrigin, true);
  const solo = actual.find(item => item.name === 'Mystic Shot');
  const source = state(0, {}, actual);
  source.build = applyBuildDraw(source.build, solo, { ...meta(solo.id, 1), archmotherOrigin: true, chickenOrigin: true }, actual).build;
  source.preferences.pairsEnabled = true;
  const pair = planDrawSequence(source, actual, 'draw', { ...controls(), initialItemId: 'combo:mystic-express' });
  const oldHalf = pair.session.build.history.find(entry => entry.itemId === solo.id);
  assert.equal(oldHalf.archmotherOrigin, true);
  assert.equal(oldHalf.chickenOrigin, true);
  assert.equal(pair.session.build.history.find(entry => entry.itemId !== solo.id).archmotherOrigin, undefined);
  assert.equal(pair.session.build.purchasePlan.filter(entry => entry.archmotherOrigin).length, 1);
});
