import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../src/catalog-data.js';
import { createSession, parseSessionJSON, serializeSession } from '../src/session.js';
import { planDrawSequence, currentDrawResult } from '../src/draw-sequence.js';
import { canUseItemAction } from '../src/item-actions.js';

const items = catalog.items;
const names = (...values) => values.map(name => items.find(item => item.name === name).id);
function stateFor(namesToEnable, preferences = {}, build = {}) {
  const ids = names(...namesToEnable);
  return createSession({
    settings: { itemWeights: Object.fromEntries(items.map(item => [item.id, ids.includes(item.id) ? 1 : 0])) },
    preferences: { mode: 'build', curseChance: 0, pairsEnabled: false, ...preferences },
    build: { heroId: '69', ...build },
  }, items);
}
function options(random = () => 0) { let number = 0; return { random, uuid: () => `draw-${++number}`, now: () => 1000 + number }; }

test('100% curse commits exactly one forced locked item and never starts a recursive chain', () => {
  const source = stateFor(['Sprint Boots', 'Healing Rite', 'Mystic Burst'], { curseChance: 1 });
  const before = structuredClone(source);
  const plan = planDrawSequence(source, items, 'draw', options());
  assert.deepEqual(source, before, 'Planning has no partial effects on the live session');
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].cursed, false);
  assert.equal(plan.steps[1].cursed, true);
  const result = currentDrawResult(plan.session, items);
  assert.equal(result.cursed, true);
  for (const action of ['reroll', 'upgrade', 'downgrade']) assert.equal(canUseItemAction(plan.session.build.itemActions, result, action), false);
  assert.deepEqual(parseSessionJSON(serializeSession(plan.session), items).build.history, plan.session.build.history, 'Both results and the lock survive a close during the animation');
});

test('zero curse chance produces one ticket and a failed bonus leaves the valid origin intact', () => {
  const source = stateFor(['Sprint Boots']);
  assert.equal(planDrawSequence(source, items, 'draw', options()).steps.length, 1);
  source.preferences.curseChance = 1;
  const plan = planDrawSequence(source, items, 'draw', options());
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.curseUnavailable, true);
  assert.equal(plan.session.build.history.length, 1);
  assert.equal(plan.session.build.history[0].cursed, undefined);
});

test('a combo consumes its own ticket, occupies two slots and survives normal/session codecs', () => {
  const source = stateFor(['Mystic Shot', 'Express Shot'], { pairsEnabled: true });
  const plan = planDrawSequence(source, items, 'draw', options(() => .999999));
  assert.equal(plan.steps[0].ticket.id, 'combo:mystic-express');
  assert.equal(plan.session.build.history.length, 2);
  assert.equal(new Set(plan.session.build.history.map(entry => entry.itemId)).size, 2);
  assert.deepEqual(plan.session.build.consumedTicketIds, ['combo:mystic-express']);
  assert.equal(currentDrawResult(plan.session, items).itemId, 'combo:mystic-express');
  assert.deepEqual(parseSessionJSON(serializeSession(plan.session), items).build.history, plan.session.build.history);
  source.preferences.mode = 'roulette';
  const normal = planDrawSequence(source, items, 'draw', options(() => .999999));
  assert.equal(normal.session.history[0].itemIds.length, 2);
  assert.deepEqual(parseSessionJSON(serializeSession(normal.session), items).history, normal.session.history);
});

test('special charges are committed once and a cursed result cannot initiate another action', () => {
  const source = stateFor(['Sprint Boots', 'Healing Rite', 'Mystic Burst']);
  const first = planDrawSequence(source, items, 'draw', options());
  first.session.preferences.curseChance = 1;
  const reroll = planDrawSequence(first.session, items, 'reroll', options(() => .3));
  assert.deepEqual(reroll.session.build.itemActions.usedActions, ['reroll']);
  assert.equal(reroll.steps.length, 2);
  assert.equal(planDrawSequence(reroll.session, items, 'upgrade', options()), null);
});

test('each half of a double has its own curse roll and forced items cannot extend the sequence', () => {
  const source = stateFor(['Mystic Shot', 'Express Shot', 'Sprint Boots', 'Healing Rite'], { pairsEnabled: true, curseChance: 1 });
  const plan = planDrawSequence(source, items, 'draw', options(() => .999999));
  assert.equal(plan.steps[0].ticket.id, 'combo:mystic-express');
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.curseCount, 2);
  assert.equal(plan.session.build.history.length, 4);
  assert.equal(plan.session.build.history.filter(entry => entry.cursed).length, 2);
});

test('non-consuming normal previews cannot force the same item immediately afterwards', () => {
  const source = stateFor(['Sprint Boots', 'Healing Rite', 'Mystic Burst'], { mode: 'roulette' });
  const first = planDrawSequence(source, items, 'draw', options());
  first.session.preferences.curseChance = 1;
  const reroll = planDrawSequence(first.session, items, 'reroll', options());
  assert.notEqual(reroll.steps[0].ticket.id, reroll.steps[1].ticket.id);
  assert.equal(reroll.steps[0].after.rouletteResult.consumed, false);
  assert.equal(reroll.steps[1].after.rouletteResult.cursed, true);
});
