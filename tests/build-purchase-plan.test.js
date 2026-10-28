import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../src/catalog-data.js';
import { createBuildState } from '../src/build-core.js';
import { applyBuildDraw, getItemAncestors, undoBuildDraw } from '../src/build-inventory.js';
import { getBuildPurchasePlan } from '../src/build-purchase-plan.js';
import { createItemTickets } from '../src/draw-rules.js';
import { createSession, parseSessionJSON, serializeSession } from '../src/session.js';
import { createContract, replayContract, updateContractReview } from '../src/contracts.js';

const items = catalog.items;
const byName = name => items.find(item => item.name === name);
const base = byName('Mystic Vulnerability');
const upgrade = byName('Escalating Exposure');
const unrelated = byName('Monster Rounds');
const meta = (drawId, time = 100) => ({ drawId, time, probability: .1, weight: 1 });
const ids = build => getBuildPurchasePlan(build, items).map(entry => entry.itemId);
const draw = (build, item, drawId, time, options = {}) => applyBuildDraw(build, item, meta(drawId, time), items, options).build;

test('recipe merges retain the obtained base and append the upgrade as a later purchase', () => {
  let build = createBuildState();
  build = draw(build, base, 'base', 100);
  build = draw(build, unrelated, 'other', 200);
  const before = structuredClone(build.purchasePlan);
  build = draw(build, upgrade, 'upgrade', 300);
  assert.deepEqual(build.history.map(entry => entry.itemId), [upgrade.id, unrelated.id]);
  assert.deepEqual(ids(build), [base.id, unrelated.id, upgrade.id]);
  assert.deepEqual(build.purchasePlan.at(-1).upgradeFromIds, [base.id]);
  assert.equal(build.purchasePlan.at(-1).drawId, 'upgrade');
  assert.deepEqual(undoBuildDraw(build).purchasePlan, before, 'Undo restores the exact purchase route as well as slots');
});

test('a full 12-slot inventory can upgrade a component while the purchase route grows to 13', () => {
  const compatible = [];
  for (const item of items) {
    if ([base.id, upgrade.id].includes(item.id) || getItemAncestors(item.id).has(base.id) || getItemAncestors(upgrade.id).has(item.id)) continue;
    if (compatible.every(other => !getItemAncestors(other.id).has(item.id) && !getItemAncestors(item.id).has(other.id))) compatible.push(item);
    if (compatible.length === 11) break;
  }
  const history = [base, ...compatible].map((item, index) => ({ itemId: item.id, ...meta(`owned-${index}`, index + 1) }));
  const build = createBuildState({ history, purchasePlan: history, starterOrderVersion: 1 });
  const upgraded = draw(build, upgrade, 'full-upgrade', 100);
  assert.equal(upgraded.history.length, 12);
  assert.equal(upgraded.purchasePlan.length, 13);
  assert.equal(upgraded.purchasePlan[0].itemId, base.id);
  assert.equal(upgraded.purchasePlan.at(-1).itemId, upgrade.id);
  assert.deepEqual(undoBuildDraw(upgraded).purchasePlan, build.purchasePlan);
});

test('reroll removes the cancelled upgrade and orphaned bases instead of keeping a drop journal', () => {
  let build = draw(createBuildState(), base, 'base-before-reroll', 100);
  build = draw(build, upgrade, 'upgrade-before-reroll', 200);
  const before = structuredClone(build.purchasePlan);
  build.itemActions.usedActions = ['reroll'];
  const rerolled = draw(build, unrelated, 'replacement', 300, { action: 'reroll' });
  assert.deepEqual(ids(rerolled), [unrelated.id]);
  assert.equal(rerolled.purchasePlan[0].drawId, 'replacement');
  const undone = undoBuildDraw(rerolled);
  assert.deepEqual(undone.purchasePlan, before);
  assert.deepEqual(undone.itemActions.usedActions, ['reroll']);
  const downgraded = draw(build, base, 'reacquired-base', 400, { action: 'downgrade' });
  assert.deepEqual(ids(downgraded), [base.id]);
  assert.equal(downgraded.purchasePlan[0].drawId, 'reacquired-base', 'A reobtained final item updates its ticket without duplicating the step');
});

test('late T1 insertion updates the first five purchases and Undo restores their exact order', () => {
  const existing = items.filter(item => item.tier === 4 && !getItemAncestors(item.id).has(unrelated.id)).slice(0, 7);
  const history = existing.map((item, index) => ({ itemId: item.id, ...meta(`earlier-${index}`, index + 1) }));
  const build = createBuildState({ history, purchasePlan: history, starterOrderVersion: 1 });
  const result = draw(build, unrelated, 'late-starter', 100, { random: () => .999 });
  assert.equal(result.history.findIndex(entry => entry.itemId === unrelated.id), 4);
  assert.equal(result.purchasePlan.findIndex(entry => entry.itemId === unrelated.id), 4);
  assert.equal(result.purchasePlan[4].drawId, 'late-starter');
  assert.deepEqual(undoBuildDraw(result).purchasePlan, build.purchasePlan);
});

test('a pair creates two purchase steps while a previously owned half remains a single step', () => {
  const pair = createItemTickets(items).find(item => item.id === 'combo:mystic-express');
  const fullPair = draw(createBuildState(), pair, 'new-pair', 100);
  assert.deepEqual(ids(fullPair), pair.itemIds);
  assert.ok(fullPair.purchasePlan.every(entry => entry.comboOrigin === pair.id && entry.drawId === 'new-pair'));
  const first = pair.components[0];
  const owned = draw(createBuildState(), first, 'owned-half', 50);
  const coalesced = draw(owned, pair, 'overlapping-pair', 100);
  assert.deepEqual(ids(coalesced), pair.itemIds);
  assert.equal(coalesced.purchasePlan[0].drawId, 'owned-half', 'An existing half does not become an extra purchase');
  assert.equal(coalesced.purchasePlan[1].drawId, 'overlapping-pair');
  assert.deepEqual(undoBuildDraw(coalesced).purchasePlan, owned.purchasePlan);
});

test('purchase routes and recipe links survive export, archive reviews, replay and curse locks', () => {
  let build = draw(createBuildState({ heroId: '6' }), base, 'export-base', 100);
  build = draw(build, upgrade, 'export-upgrade', 200, { });
  const bonus = byName('Mystic Shot');
  build = applyBuildDraw(build, bonus, { ...meta('locked-bonus', 300), cursed: true }, items).build;
  const saved = createContract(build, 'Recipe route', { id: 'recipe-contract', savedAt: 1000 });
  assert.deepEqual(saved.build.purchasePlan, build.purchasePlan);
  assert.equal(saved.build.inventoryUndo.length, 0);
  const reviewed = updateContractReview([saved], saved.id, { rating: 5, comment: 'Works' })[0];
  assert.deepEqual(reviewed.build.purchasePlan, saved.build.purchasePlan);
  assert.deepEqual(replayContract(reviewed, build).purchasePlan, build.purchasePlan);
  const restored = parseSessionJSON(serializeSession(createSession({ build, contracts: [reviewed] }, items)), items);
  assert.deepEqual(restored.build.purchasePlan, build.purchasePlan);
  assert.deepEqual(restored.contracts[0].build.purchasePlan, build.purchasePlan);
  assert.ok(restored.build.purchasePlan.some(entry => entry.itemId === bonus.id && entry.cursed));
  assert.deepEqual(restored.build.inventoryUndo.at(-1).purchasePlan, build.inventoryUndo.at(-1).purchasePlan);
});

test('legacy routes recover confirmed merged components from discarded IDs and old Undo proof only', () => {
  const legacy = {
    heroId: '6', starterOrderVersion: 1,
    history: [{ itemId: upgrade.id, ...meta('legacy-upgrade', 300) }],
    discardedItemIds: [base.id, unrelated.id],
    inventoryUndo: [{ history: [{ itemId: base.id, ...meta('legacy-base', 100) }, { itemId: unrelated.id, ...meta('discarded-reroll', 200) }] }],
  };
  const restored = createSession({ build: legacy }, items).build;
  assert.deepEqual(ids(restored), [base.id, upgrade.id]);
  assert.equal(restored.purchasePlan[0].drawId, 'legacy-base');
  assert.deepEqual(restored.purchasePlan[1].upgradeFromIds, [base.id]);
  assert.ok(!restored.purchasePlan.some(entry => entry.itemId === unrelated.id));
  const withoutSnapshots = createSession({ build: { ...legacy, inventoryUndo: [] } }, items).build;
  assert.deepEqual(ids(withoutSnapshots), [base.id, upgrade.id]);
  const directUpgrade = createSession({ build: { ...legacy, discardedItemIds: [], inventoryUndo: [] } }, items).build;
  assert.deepEqual(ids(directUpgrade), [upgrade.id], 'A component that was never observed is never invented');
});

test('malformed imported routes repair recipe order, filter unknown items and canonicalize ticket aliases', () => {
  const raw = {
    heroId: '6', starterOrderVersion: 1,
    history: [{ itemId: upgrade.id, ...meta('final-upgrade', 300) }],
    purchasePlan: [
      { itemId: upgrade.id, ...meta('first-but-upgrade', 300), ticketId: 'made-up-ticket', upgradeFromIds: [unrelated.id] },
      { itemId: base.id, ...meta('second-but-base', 100), comboOrigin: 'combo:mystic-express' },
      { itemId: 'removed-catalog-item', ...meta('unknown', 100) },
    ],
    inventoryUndo: [{ history: [{ itemId: base.id, ...meta('undo-base', 100) }], purchasePlan: [
      { itemId: base.id, ...meta('base-purchase', 100), ticketId: 'also-made-up' },
      { itemId: 'removed-catalog-item', ...meta('bad-undo-step', 200) },
    ] }],
  };
  const restored = createSession({ build: raw }, items).build;
  assert.deepEqual(ids(restored), [base.id, upgrade.id]);
  assert.deepEqual(restored.purchasePlan[1].upgradeFromIds, [base.id]);
  assert.equal(restored.purchasePlan[1].ticketId, upgrade.id);
  assert.equal(restored.purchasePlan[0].ticketId, base.id);
  assert.equal(restored.purchasePlan[0].comboOrigin, undefined);
  assert.deepEqual(restored.inventoryUndo[0].purchasePlan.map(entry => entry.itemId), [base.id]);
  assert.equal(restored.inventoryUndo[0].purchasePlan[0].ticketId, base.id);
});
