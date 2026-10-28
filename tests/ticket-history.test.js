import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../src/catalog-data.js';
import { createSession, parseSessionJSON, serializeSession } from '../src/session.js';
import { ITEM_COMBOS } from '../src/item-combos.js';

const items = catalog.items;
const itemId = name => items.find(item => item.name === name).id;
const entry = (id, overrides = {}) => ({ itemId: id, time: 1, probability: .2, weight: 1, drawId: 'test-draw', ...overrides });
test('known inventory items cannot import another ticket or an unrelated combo identity', () => {
  const id = itemId('Sprint Boots');
  for (const alias of ['unknown-ticket', itemId('Healing Rite'), 'combo:mystic-express']) {
    const session = createSession({ build: { history: [entry(id, { ticketId: alias, comboOrigin: alias })], consumedTicketIds: [] } }, items);
    assert.equal(session.build.history[0].ticketId, id);
    assert.equal(session.build.history[0].comboOrigin, undefined);
    assert.ok(session.build.consumedTicketIds.includes(id), 'Replacing this item cannot reintroduce its ordinary ticket');
  }
});
test('combo history derives its two components from the registered combo descriptor', () => {
  const combo = ITEM_COMBOS.find(combo => combo.id === 'combo:mystic-express');
  const source = createSession({ history: [entry(combo.id, { itemIds: [itemId('Sprint Boots'), itemId('Healing Rite')] })] }, items);
  assert.deepEqual(source.history[0].itemIds, combo.itemIds);
  assert.deepEqual(parseSessionJSON(serializeSession(source), items).history, source.history);
});
test('valid physical halves retain their shared combo ticket identity', () => {
  const combo = ITEM_COMBOS.find(combo => combo.id === 'combo:mystic-express');
  const source = createSession({ build: { history: combo.itemIds.map(id => entry(id, { ticketId: combo.id, comboOrigin: combo.id })) } }, items);
  assert.deepEqual(source.build.consumedTicketIds, [combo.id]);
  assert.ok(source.build.history.every(entry => entry.ticketId === combo.id && entry.comboOrigin === combo.id));
});
