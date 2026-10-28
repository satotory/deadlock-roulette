import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../src/catalog-data.js';
import { createBuildState } from '../src/build-core.js';
import { applyBuildDraw, canApplyBuildTicket, canUndoBuildDraw, coalesceBuildInventory, getItemAncestors, getLatestBuildEntries, undoBuildDraw } from '../src/build-inventory.js';
import { calculateBuildAction, calculateBuildDistribution, calculateRouletteAction, createItemTickets, pickWeightedDistribution } from '../src/draw-rules.js';
import { CHARGE_ITEM_IDS, CHARGE_GRANT_ITEM_IDS, HERO_CHARGE_CAPABILITIES, ITEM_COMBOS, ITEM_UPGRADE_PARENTS } from '../src/game-item-rules.js';
import { canUseItemAction, getItemActionAvailability, spendItemAction } from '../src/item-actions.js';
import { normalizeHistory } from '../src/history.js';

const items = catalog.items;
const byId = new Map(items.map(item => [item.id, item]));
const meta = drawId => ({ drawId, time: 123, probability: .1, weight: 1 });
const byName = name => items.find(item => item.name === name);
const buildWith = ids => createBuildState({ history: ids.map((itemId, index) => ({ ...meta(`old-${index}`), itemId })), dynamicWeights: false });

test('all current recipes coalesce their owned ancestors instead of using extra slots', () => {
  for (const [upgradeId, parents] of Object.entries(ITEM_UPGRADE_PARENTS)) {
    if (!byId.has(upgradeId)) continue;
    const existingParents = parents.filter(id => byId.has(id));
    if (!existingParents.length) continue;
    const build = buildWith(existingParents);
    const old = JSON.stringify(build);
    const result = applyBuildDraw(build, byId.get(upgradeId), meta('new-upgrade'), items);
    assert.deepEqual(result.build.history.map(entry => entry.itemId), [upgradeId], upgradeId);
    assert.equal(result.build.latestDrawId, 'new-upgrade');
    assert.equal(JSON.stringify(build), old, 'The original build remains unchanged');
    for (const parent of existingParents) assert.ok(result.meta.mergedItemIds.includes(parent));
    assert.deepEqual(undoBuildDraw(result.build).history, build.history, 'Undo restores all consumed recipe components');
  }
});

test('Mystic Vulnerability and Escalating Exposure collapse old saved builds too', () => {
  const base = byName('Mystic Vulnerability');
  const upgraded = byName('Escalating Exposure');
  assert.ok(base && upgraded);
  const middle = byName('Mystic Shot');
  const build = buildWith([base.id, middle.id, upgraded.id]);
  build.history[0].cursed = true;
  const result = coalesceBuildInventory(build, items);
  assert.deepEqual(result.history.map(entry => entry.itemId), [upgraded.id, middle.id]);
  assert.equal(result.history[0].cursed, true, 'An inherited curse cannot be removed by merging');
  assert.ok(result.discardedItemIds.includes(base.id));
  assert.equal(canApplyBuildTicket(result, base, items).available, false);
  assert.ok(!calculateBuildDistribution(items, {}, result).items.some(entry => entry.item.id === base.id));
});

test('late T1 draws insert uniformly into positions 1–5 and actions still target that ticket', () => {
  const starter = byName('Monster Rounds');
  const existing = items.filter(item => item.tier === 4 && !getItemAncestors(item.id).has(starter.id)).slice(0, 7);
  const build = buildWith(existing.map(item => item.id));
  for (const [random, expectedIndex] of [[0, 0], [.2, 1], [.4, 2], [.6, 3], [.999, 4]]) {
    const result = applyBuildDraw(build, starter, meta('starter-late'), items, { random: () => random });
    assert.equal(result.build.history.findIndex(entry => entry.itemId === starter.id), expectedIndex);
    assert.deepEqual(result.build.history.filter(entry => entry.itemId !== starter.id).map(entry => entry.itemId), build.history.map(entry => entry.itemId));
    assert.equal(getLatestBuildEntries(result.build)[0].itemId, starter.id);
    assert.deepEqual(result.meta.earlyItemIds, [starter.id]);
    const replacement = calculateBuildAction(items, {}, result.build, starter, 'upgrade', { pairsEnabled: false });
    assert.ok(replacement.eligibleCount > 0);
    assert.ok(replacement.items.every(entry => entry.item.tier === 2));
    const replacementItem = pickWeightedDistribution(replacement, { random: () => 0 });
    const replaced = applyBuildDraw(result.build, replacementItem, meta('replaced-starter'), items, { action: 'upgrade' });
    assert.ok(!replaced.build.history.some(entry => entry.itemId === starter.id));
    assert.ok(replaced.build.history.some(entry => entry.itemId === existing.at(-1).id), 'Replacing the starter never removes the visual last slot');
    assert.deepEqual(undoBuildDraw(result.build).history, build.history, 'Undo restores exact pre-insertion purchase order');
  }
  assert.throws(() => applyBuildDraw(build, starter, meta('bad-random'), items, { random: () => 1 }), RangeError);
});

test('pair tickets are independent in the normal pool and honor both halves of filters', () => {
  const combo = ITEM_COMBOS.find(entry => entry.id === 'combo:mystic-express');
  const tickets = createItemTickets(items);
  const pair = tickets.find(ticket => ticket.id === combo.id);
  assert.equal(pair.components.length, 2);
  const afterPair = calculateRouletteAction(items, {}, [pair.id], null);
  for (const id of pair.itemIds) assert.ok(afterPair.items.some(entry => entry.item.id === id));
  const afterSolo = calculateRouletteAction(items, {}, [pair.itemIds[0]], null);
  assert.ok(afterSolo.items.some(entry => entry.item.id === pair.id));
  assert.ok(!calculateRouletteAction(items, { itemWeights: { [pair.itemIds[1]]: 0 } }, [], null).items.some(entry => entry.item.id === pair.id));
  const disabledTier = pair.components[1].tier;
  assert.ok(!calculateRouletteAction(items, { enabledTiers: [1, 2, 3, 4].filter(tier => tier !== disabledTier) }, [], null).items.some(entry => entry.item.id === pair.id));
});

test('pairs occupy two ordinary slots, coalesce already owned halves and retain group identity', () => {
  const pair = createItemTickets(items).find(ticket => ticket.id === 'combo:mystic-express');
  let build = buildWith([pair.itemIds[0]]);
  const originalActionState = build.itemActions;
  const result = applyBuildDraw(build, pair, meta('pair-result'), items);
  build = result.build;
  assert.equal(build.history.length, 2);
  assert.equal(new Set(build.history.map(entry => entry.itemId)).size, 2);
  assert.equal(getLatestBuildEntries(build).length, 2);
  assert.ok(build.history.every(entry => entry.comboOrigin === pair.id && entry.ticketId === pair.id && entry.drawId === 'pair-result'));
  assert.ok(build.consumedTicketIds.includes(pair.id));
  assert.ok(!build.consumedTicketIds.includes(pair.itemIds[1]), 'A pair never spends a separate solo ticket');
  assert.equal(canApplyBuildTicket(build, pair, items).available, false, 'A completely redundant pair adds no slot');
  const changed = calculateBuildAction(items, {}, build, pair, 'reroll', { pairsEnabled: false });
  const winner = pickWeightedDistribution(changed, { random: () => 0 });
  const replaced = applyBuildDraw(build, winner, meta('pair-replaced'), items, { action: 'reroll' });
  assert.equal(replaced.build.history.length, 1, 'A special action replaces the whole pair group');
  replaced.build.itemActions = spendItemAction(originalActionState, build.history[0], replaced.build.history[0], 'reroll');
  const undone = undoBuildDraw(replaced.build);
  assert.deepEqual(undone.history, build.history);
  assert.deepEqual(undone.itemActions.usedActions, ['reroll'], 'Undo never refunds special-action charges');
});

test('capacity checks account for pair coalescing and recipe upgrades at 12 slots', () => {
  const base = byName('Mystic Vulnerability');
  const upgraded = byName('Escalating Exposure');
  const pair = createItemTickets(items).find(ticket => ticket.id === 'combo:mystic-express');
  const unrelated = items.filter(item => ![base.id, upgraded.id, ...pair.itemIds].includes(item.id)
    && pair.itemIds.every(id => !getItemAncestors(item.id).has(id) && !getItemAncestors(id).has(item.id))
    && !getItemAncestors(item.id).has(base.id) && !getItemAncestors(base.id).has(item.id)
    && !getItemAncestors(item.id).has(upgraded.id) && !getItemAncestors(upgraded.id).has(item.id));
  const distinct = [];
  for (const item of unrelated) {
    if (distinct.every(other => !getItemAncestors(other.id).has(item.id) && !getItemAncestors(item.id).has(other.id))) distinct.push(item);
    if (distinct.length === 11) break;
  }
  const full = buildWith([base.id, ...distinct.map(item => item.id)]);
  assert.equal(full.history.length, 12);
  assert.equal(canApplyBuildTicket(full, pair, items).available, false);
  assert.equal(canApplyBuildTicket(full, upgraded, items).available, true);
  const result = applyBuildDraw(full, upgraded, meta('full-upgrade'), items);
  assert.equal(result.build.history.length, 12);
  assert.ok(result.build.history.some(entry => entry.itemId === upgraded.id));
  assert.ok(calculateBuildDistribution(items, {}, full).items.some(entry => entry.item.id === upgraded.id));
  const eleven = buildWith([pair.itemIds[0], ...distinct.slice(0, 10).map(item => item.id)]);
  assert.equal(canApplyBuildTicket(eleven, pair, items).available, true);
  assert.equal(applyBuildDraw(eleven, pair, meta('fits-pair'), items).build.history.length, 12);
});

test('charge-only singles and pairs are filtered per hero and an owned charge grant enables them', () => {
  const nonChargeHero = Object.keys(HERO_CHARGE_CAPABILITIES).find(id => HERO_CHARGE_CAPABILITIES[id] === false);
  const chargeHero = Object.keys(HERO_CHARGE_CAPABILITIES).find(id => HERO_CHARGE_CAPABILITIES[id] === true);
  const build = createBuildState({ heroId: nonChargeHero, dynamicWeights: false });
  const unavailable = calculateBuildDistribution(items, {}, build);
  assert.ok(unavailable.items.every(entry => !(entry.item.components || [entry.item]).some(item => CHARGE_ITEM_IDS.includes(item.id))));
  const available = calculateBuildDistribution(items, {}, { ...build, heroId: chargeHero });
  for (const id of CHARGE_ITEM_IDS) assert.ok(available.items.some(entry => entry.item.id === id));
  const grant = createBuildState({ ...build, history: [{ itemId: CHARGE_GRANT_ITEM_IDS[0], ...meta('charge-grant') }] });
  const granted = calculateBuildDistribution(items, {}, grant);
  for (const id of CHARGE_ITEM_IDS) assert.ok(granted.items.some(entry => entry.item.id === id));
});

test('cursed bonus results cannot be changed or undone and their locks survive normalization', () => {
  let build = createBuildState();
  const first = items.find(item => item.tier === 2);
  const origin = applyBuildDraw(build, first, meta('curse-origin'), items);
  build = origin.build;
  const distribution = calculateBuildDistribution(items, {}, build, { pairsEnabled: false });
  const second = pickWeightedDistribution(distribution, { random: () => .7 });
  const forced = applyBuildDraw(build, second, { ...meta('curse-bonus'), cursed: true, cursedBy: 'curse-origin' }, items, { recordUndo: false });
  const latest = getLatestBuildEntries(forced.build)[0];
  assert.equal(canUseItemAction(forced.build.itemActions, latest, 'reroll'), false);
  assert.equal(getItemActionAvailability(forced.build.itemActions, latest).upgrade.reason, 'cursed');
  assert.equal(canUndoBuildDraw(forced.build), false);
  assert.equal(undoBuildDraw(forced.build), null);
  const restored = createBuildState(JSON.parse(JSON.stringify(forced.build)));
  assert.equal(restored.inventoryUndo.at(-1).blocked, true);
  assert.equal(getLatestBuildEntries(restored)[0].cursed, true);
  const history = normalizeHistory(restored.history, new Set(items.map(item => item.id)));
  assert.ok(history.some(entry => entry.cursed === true && entry.cursedBy === 'curse-origin'));
});

test('combo result history keeps two known halves and rejects malformed import bundles', () => {
  const pair = createItemTickets(items).find(ticket => ticket.combo);
  const ids = new Set(createItemTickets(items).map(ticket => ticket.id));
  const normalized = normalizeHistory([{ itemId: pair.id, itemIds: pair.itemIds, ...meta('normal-pair'), cursed: true }], ids);
  assert.deepEqual(normalized[0].itemIds, pair.itemIds);
  assert.equal(normalized[0].cursed, true);
  assert.deepEqual(normalizeHistory([{ itemId: pair.id, itemIds: [pair.itemIds[0], 'not-a-known-item'], ...meta('bad-pair') }], ids), []);
  assert.deepEqual(createBuildState({ discardedItemIds: { invalid: true } }).consumedTicketIds, []);
});
