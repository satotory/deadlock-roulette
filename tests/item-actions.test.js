import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_ACTIONS, createItemActionState, canUseItemAction, getItemActionAvailability, spendItemAction } from '../src/item-actions.js';

const ticket = drawId => ({ itemId: `item-${drawId}`, drawId });

test('each special action has one session charge and a draw accepts only one modification', () => {
  const initial = createItemActionState();
  assert.ok(ITEM_ACTIONS.every(action => canUseItemAction(initial, ticket('first'), action)));
  const rerolled = spendItemAction(initial, ticket('first'), ticket('preview'), 'reroll');
  assert.deepEqual(initial, { usedActions: [], modifiedDrawIds: [] });
  assert.deepEqual(rerolled, { usedActions: ['reroll'], modifiedDrawIds: ['first', 'preview'] });
  for (const entry of [ticket('first'), ticket('preview')]) {
    for (const action of ITEM_ACTIONS) assert.equal(canUseItemAction(rerolled, entry, action), false);
  }
  assert.equal(canUseItemAction(rerolled, ticket('second'), 'reroll'), false);
  assert.equal(canUseItemAction(rerolled, ticket('second'), 'upgrade'), true);
  const upgraded = spendItemAction(rerolled, ticket('second'), ticket('upgrade-result'), 'upgrade');
  const spent = spendItemAction(upgraded, ticket('third'), ticket('down-result'), 'downgrade');
  assert.deepEqual(spent.usedActions, ITEM_ACTIONS);
  assert.ok(ITEM_ACTIONS.every(action => !canUseItemAction(spent, ticket('fourth'), action)));
  assert.deepEqual(createItemActionState(), initial);
});

test('undo and restoring old tickets never return session charges or permit chaining', () => {
  const source = ticket('draw-original');
  const result = ticket('draw-new');
  const spent = spendItemAction(createItemActionState(), source, result, 'upgrade');
  const restored = createItemActionState(JSON.parse(JSON.stringify(spent)));
  assert.deepEqual(restored, spent);
  assert.equal(canUseItemAction(restored, source, 'reroll'), false);
  assert.equal(canUseItemAction(restored, result, 'downgrade'), false);
  assert.equal(canUseItemAction(restored, ticket('after-undo'), 'upgrade'), false);
  assert.equal(canUseItemAction(restored, ticket('after-undo'), 'downgrade'), true);
  // Independent roulette/build sessions own independent policy objects.
  assert.equal(canUseItemAction(createItemActionState(), source, 'upgrade'), true);
});

test('availability supplies precise reasons and rejects missing or malformed tickets', () => {
  const spent = spendItemAction(createItemActionState(), 'first', 'result', 'reroll');
  assert.deepEqual(getItemActionAvailability(spent, 'result'), {
    reroll: { available: false, reason: 'used' },
    upgrade: { available: false, reason: 'modified' },
    downgrade: { available: false, reason: 'modified' },
  });
  assert.deepEqual(getItemActionAvailability(spent, 'next').upgrade, { available: true, reason: '' });
  for (const entry of [null, {}, { drawId: '' }, { drawId: '<script>' }, { drawId: 'x'.repeat(129) }]) {
    assert.ok(Object.values(getItemActionAvailability(spent, entry)).every(policy => policy.reason === 'missing-item'));
    assert.equal(canUseItemAction(spent, entry, 'upgrade'), false);
  }
  assert.equal(canUseItemAction(spent, 'next', 'draw'), false);
});

test('import normalization drops unknown actions and invalid ticket IDs without aliasing state', () => {
  const raw = { usedActions: ['upgrade', 'upgrade', 'draw', null], modifiedDrawIds: ['valid-1', 'valid-1', '', '<script>', 1, 'x'.repeat(129)] };
  const normalized = createItemActionState(raw);
  assert.deepEqual(normalized, { usedActions: ['upgrade'], modifiedDrawIds: ['valid-1'] });
  normalized.usedActions.push('reroll');
  normalized.modifiedDrawIds.push('valid-2');
  assert.equal(raw.usedActions.length, 4);
  assert.equal(raw.modifiedDrawIds.length, 6);
  for (const value of [null, [], 1, true]) assert.deepEqual(createItemActionState(value), { usedActions: [], modifiedDrawIds: [] });
});

test('invalid or exhausted actions fail before mutating state', () => {
  const initial = createItemActionState();
  assert.throws(() => spendItemAction(initial, 'first', 'result', 'draw'), TypeError);
  assert.throws(() => spendItemAction(initial, null, 'result', 'reroll'), RangeError);
  assert.throws(() => spendItemAction(initial, 'first', null, 'reroll'), TypeError);
  const spent = spendItemAction(initial, 'first', 'result', 'reroll');
  assert.throws(() => spendItemAction(spent, 'second', 'other', 'reroll'), RangeError);
  assert.throws(() => spendItemAction(spent, 'result', 'other', 'upgrade'), RangeError);
  assert.deepEqual(initial, { usedActions: [], modifiedDrawIds: [] });
});
