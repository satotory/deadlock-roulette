import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildState, generateSkillPlan } from '../src/build-core.js';
import { createContract, MAX_CONTRACTS, normalizeContractName, normalizeContractComment, replayContract, saveContract, updateContractReview } from '../src/contracts.js';
import { createSession, parseSessionJSON, serializeSession } from '../src/session.js';

const hero = { id: 'hero-1', abilities: [1, 2, 3, 4].map(slot => ({ id: `ability-${slot}`, slot })) };
const catalog = ['a', 'b', 'c'].map(id => ({ id, category: 'weapon', tier: 1 }));
const draw = itemId => ({ itemId, time: 1234, probability: .25, weight: 4, drawId: `draw-${itemId}` });
const build = () => createBuildState({
  heroId: hero.id,
  name: 'Midnight contract',
  excludedHeroIds: ['hero-2'],
  history: [draw('b')],
  ...generateSkillPlan(hero, { random: () => .5 }),
  checkedSkills: [0, 1],
  generatedAt: 1234,
});

test('a saved contract owns its items, skill plan and completion snapshot', () => {
  const current = build();
  const saved = createContract(current, '  Сумеречный   договор  ', { id: 'contract-1', savedAt: 2345 });
  assert.equal(saved.name, 'Сумеречный договор');
  assert.equal(saved.build.name, saved.name);
  assert.equal(saved.savedAt, 2345);
  current.history[0].itemId = 'c';
  current.skillPlan[0].rank = 3;
  current.checkedSkills.push(2);
  current.excludedHeroIds.push('hero-3');
  assert.equal(saved.build.history[0].itemId, 'b');
  assert.equal(saved.build.skillPlan[0].rank, 1);
  assert.deepEqual(saved.build.checkedSkills, [0, 1]);
  assert.deepEqual(saved.build.excludedHeroIds, ['hero-2']);
  assert.throws(() => createContract(createBuildState(), 'Empty build', { id: 'empty' }), TypeError);
  assert.throws(() => createContract(build(), '   ', { id: 'empty-name' }), TypeError);
});

test('replaying restores the same build with fresh checks and the current enabled hero pool', () => {
  const saved = createContract(build(), 'Replay me', { id: 'contract-1', savedAt: 2345 });
  const current = createBuildState({ heroId: 'other', excludedHeroIds: ['hero-3'], history: [draw('c')] });
  const replay = replayContract(saved, current);
  assert.equal(replay.heroId, saved.build.heroId);
  assert.equal(replay.name, saved.name);
  assert.deepEqual(replay.history, saved.build.history);
  assert.deepEqual(replay.skillPlan, saved.build.skillPlan);
  assert.deepEqual(replay.unlockOrder, saved.build.unlockOrder);
  assert.deepEqual(replay.checkedSkills, []);
  assert.deepEqual(replay.excludedHeroIds, ['hero-3']);
  replay.history[0].weight = 100;
  replay.skillPlan[0].abilityId = 'changed';
  replay.excludedHeroIds.push('hero-4');
  assert.equal(saved.build.history[0].weight, 4);
  assert.notEqual(saved.build.skillPlan[0].abilityId, 'changed');
  assert.deepEqual(current.excludedHeroIds, ['hero-3']);
  assert.deepEqual(current.history, [draw('c')]);
});

test('full archives reject another save without losing records and permit an explicit update', () => {
  let contracts = [];
  for (let index = 0; index < MAX_CONTRACTS; index++) {
    contracts = saveContract(contracts, build(), `Build ${index}`, { id: `contract-${index}`, savedAt: index });
  }
  const before = JSON.stringify(contracts);
  assert.throws(() => saveContract(contracts, build(), 'Overflow', { id: 'overflow' }), RangeError);
  assert.equal(JSON.stringify(contracts), before);
  const updated = saveContract(contracts, build(), 'Renamed', { id: 'contract-0', savedAt: 100 });
  assert.equal(updated.length, MAX_CONTRACTS);
  assert.equal(updated[0].id, 'contract-0');
  assert.equal(updated[0].name, 'Renamed');
  assert.equal(updated.filter(entry => entry.id === 'contract-0').length, 1);
  assert.equal(contracts.at(-1).name, 'Build 0');
});

test('saved contracts round-trip alongside independent roulette and live build progress', () => {
  const saved = createContract(build(), 'Вернуться сюда', { id: 'contract-1', savedAt: 1234 });
  const session = createSession({ history: [draw('a')], build: build(), contracts: [saved] }, catalog);
  const imported = parseSessionJSON(serializeSession(session), catalog);
  assert.deepEqual(imported, session);
  imported.build = replayContract(imported.contracts[0], imported.build);
  assert.deepEqual(imported.history, [draw('a')]);
  assert.deepEqual(imported.build.checkedSkills, []);
  assert.deepEqual(imported.contracts[0].build.checkedSkills, [0, 1]);
  assert.deepEqual(createSession({ history: [draw('a')] }, catalog).contracts, []);
});

test('restoring damaged contracts filters removed items and retains only legal skill steps', () => {
  const saved = createContract(build(), '  Valid\nname  ', { id: 'contract-1', savedAt: 1234 });
  saved.build.history.push(draw('b'), draw('removed'));
  saved.build.skillPlan[2].rank = 3;
  saved.build.checkedSkills = [0, 11];
  const restored = createSession({ contracts: [
    null,
    { ...saved, id: '<script>' },
    { ...saved, id: 'nameless', name: '\u0000\u202e' },
    { ...saved, id: 'no-hero', build: {} },
    saved,
    { ...saved, name: 'Duplicate' },
  ] }, catalog);
  assert.equal(restored.contracts.length, 1);
  assert.equal(restored.contracts[0].name, 'Valid name');
  assert.deepEqual(restored.contracts[0].build.history, [draw('b')]);
  assert.equal(restored.contracts[0].build.skillPlan.length, 2);
  assert.deepEqual(restored.contracts[0].build.checkedSkills, [0]);
  assert.equal(JSON.parse(serializeSession(restored)).contracts[0].build.history.length, 1);
});

test('contract names are readable and bounded without splitting Unicode characters', () => {
  assert.equal(normalizeContractName(' \u202eОпасный\u0000\tдоговор\u2069 '), 'Опасный договор');
  const name = normalizeContractName('🎲'.repeat(61));
  assert.equal([...name].length, 60);
  assert.equal(name.endsWith('🎲'), true);
  assert.equal(createBuildState({ name: '  My\nname ' }).name, 'My name');
});

test('ratings and multiline comments survive save, export, import and replay without changing the build', () => {
  const comment = 'Подходит для пуша.\nПопробовать <Spirit> и "Mystic".';
  const contracts = saveContract([], build(), 'Любимый', { id: 'rated', savedAt: 1234, rating: 4, comment });
  const restored = parseSessionJSON(serializeSession(createSession({ contracts }, catalog)), catalog);
  assert.equal(restored.contracts[0].rating, 4);
  assert.equal(restored.contracts[0].comment, comment);
  const replay = replayContract(restored.contracts[0], createBuildState());
  assert.deepEqual(replay.checkedSkills, []);
  assert.deepEqual(replay.skillPlan, contracts[0].build.skillPlan);
  assert.equal(restored.contracts[0].rating, 4);
  assert.equal(restored.contracts[0].comment, comment);
});

test('legacy contracts and malformed annotations restore readable bounded values', () => {
  const oldContract = createContract(build(), 'Old', { id: 'old' });
  delete oldContract.rating; delete oldContract.comment;
  const contracts = createSession({ contracts: [oldContract,
    { ...oldContract, id: 'high', rating: 99, comment: ' \u202eFirst\r\nSecond\u0000 ' },
    { ...oldContract, id: 'invalid', rating: '5', comment: { text: 'not text' } },
    { ...oldContract, id: 'low', rating: -4 },
  ] }, catalog).contracts;
  assert.equal(contracts[0].rating, 0); assert.equal(contracts[0].comment, '');
  assert.equal(contracts[1].rating, 5); assert.equal(contracts[1].comment, 'First\nSecond');
  assert.equal(contracts[2].rating, 0); assert.equal(contracts[2].comment, '');
  assert.equal(contracts[3].rating, 0);
  assert.equal([...normalizeContractComment('🎲'.repeat(1001))].length, 1000);
});

test('a post-match review updates the same contract without altering its saved build or other reviews', () => {
  const saved = createContract(build(), 'Original', { id: 'review', savedAt: 1234, rating: 1, comment: 'Before' });
  const other = createContract(build(), 'Other', { id: 'other', savedAt: 4567, rating: 2 });
  const source = [saved, other];
  const result = updateContractReview(source, 'review', { rating: 5, comment: ' После\nматча ' });
  assert.equal(result.length, 2);
  assert.equal(result[0].id, saved.id);
  assert.equal(result[0].savedAt, 1234);
  assert.deepEqual(result[0].build, saved.build);
  assert.equal(result[0].rating, 5);
  assert.equal(result[0].comment, 'После\nматча');
  assert.deepEqual(result[1], other);
  assert.equal(saved.rating, 1); assert.equal(saved.comment, 'Before');
  assert.deepEqual(updateContractReview(source, 'missing', { rating: 3 }), source);
  const imported = parseSessionJSON(serializeSession(createSession({ contracts: result }, catalog)), catalog);
  assert.equal(imported.contracts[0].rating, 5);
  assert.equal(imported.contracts[0].comment, 'После\nматча');
});
