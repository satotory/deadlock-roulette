import test from 'node:test';
import assert from 'node:assert/strict';
import { getEligibleItems, pickWeightedItem } from '../src/roulette.js';
import {
  createSession,
  parseSessionJSON,
  serializeSession,
  SESSION_FORMAT,
  SESSION_VERSION,
  MAX_SESSION_BYTES,
  MIN_ZOOM_FACTOR,
  MAX_ZOOM_FACTOR,
  normalizeZoomFactor,
} from '../src/session.js';

const catalog = [
  { id: 'a', name: 'a', category: 'weapon', tier: 1 },
  { id: 'b', name: 'b', category: 'vitality', tier: 2 },
  { id: 'c', name: 'c', category: 'spirit', tier: 4 },
];
const entry = (itemId, overrides = {}) => ({ itemId, time: 1791943200000, probability: 0.25, weight: 4, drawId: `draw-${itemId}`, ...overrides });
const envelope = overrides => ({ format: SESSION_FORMAT, version: SESSION_VERSION, history: [], ...overrides });

test('new session returns independent defaults and canonical envelope', () => {
  const result = createSession(undefined, catalog);
  assert.equal(result.format, 'deadlock-roulette-session');
  assert.equal(result.version, 1);
  assert.deepEqual(result.history, []);
  assert.deepEqual(result.preferences, { sound: false, quick: false, zoomFactor: 1, music: true, musicTrack: 'title', language: 'en', musicVolume: .01, soundVolume: 1, soundStyle: 'streetbrawl', voices: true, voiceVolume: .65, uiSound: true, uiVolume: .35, catalogVisible: true, mode: 'roulette', curseChance: 0, pairsEnabled: true, chickenChance: .1, archmotherChance: .1, hiddenKingChance: .1 });
  assert.deepEqual(result.settings.enabledTiers, [1, 2, 3, 4]);
  result.settings.tierWeights[1] = 99;
  assert.equal(createSession(undefined, catalog).settings.tierWeights[1], 4);
});

test('older purchase orders bring T1 items forward once and retain their latest result identity', () => {
  const history = [entry('b'), entry('c'), entry('a')];
  const restored = createSession({ build: { heroId: 'hero', history, latestDrawId: 'draw-a' } }, catalog);
  assert.deepEqual(restored.build.history.map(entry => entry.itemId), ['a', 'b', 'c']);
  assert.equal(restored.build.latestDrawId, 'draw-a');
  assert.equal(restored.build.starterOrderVersion, 1);
  restored.build.history = [restored.build.history[1], restored.build.history[0], restored.build.history[2]];
  assert.deepEqual(parseSessionJSON(serializeSession(restored), catalog).build.history.map(entry => entry.itemId), ['b', 'a', 'c'], 'Subsequent restores keep the generated random positions');
});

test('music choice and special-action budgets survive export and restore independently', () => {
  const source = {
    preferences: { musicTrack: 'brawl', musicVolume: .15, music: false },
    itemActions: { usedActions: ['reroll'], modifiedDrawIds: ['draw-a', 'preview'] },
    history: [entry('a')],
    build: { history: [entry('b')], discardedItemIds: ['a', 'removed'], itemActions: { usedActions: ['upgrade'], modifiedDrawIds: ['draw-b'] } },
  };
  const session = createSession(source, catalog);
  const restored = parseSessionJSON(serializeSession(session), catalog);
  assert.deepEqual(restored, session);
  assert.equal(restored.preferences.musicTrack, 'brawl');
  assert.equal(restored.preferences.music, false);
  assert.deepEqual(restored.itemActions.usedActions, ['reroll']);
  assert.deepEqual(restored.build.itemActions.usedActions, ['upgrade']);
  assert.deepEqual(restored.build.discardedItemIds, ['a']);
  assert.equal(createSession({ preferences: { musicTrack: '../arbitrary.mp3' } }, catalog).preferences.musicTrack, 'title');
});

test('roulette sound choices and independent hero voice settings persist and sanitize bad imports', () => {
  const session = createSession({ preferences: { soundStyle: 'revolver', sound: false, voices: false, voiceVolume: .53 } }, catalog);
  const restored = parseSessionJSON(serializeSession(session), catalog);
  assert.equal(restored.preferences.soundStyle, 'revolver');
  assert.equal(restored.preferences.voices, false);
  assert.equal(restored.preferences.voiceVolume, .53);
  assert.equal(restored.preferences.sound, false);
  const invalid = createSession({ preferences: { soundStyle: '<script>', voices: 'false', voiceVolume: Infinity } }, catalog);
  assert.equal(invalid.preferences.soundStyle, 'streetbrawl');
  assert.equal(invalid.preferences.voices, true);
  assert.equal(invalid.preferences.voiceVolume, .65);
  assert.equal(createSession({ preferences: { voiceVolume: 0 } }, catalog).preferences.voiceVolume, 0);
  assert.equal(createSession({ preferences: { voiceVolume: 2 } }, catalog).preferences.voiceVolume, 1);
});

test('a nonconsuming reroll restores its displayed result without putting that item into history', () => {
  const source = envelope({ history: [entry('a')], rouletteResult: { ...entry('b'), consumed: false } });
  const session = createSession(source, catalog);
  assert.equal(session.rouletteResult.itemId, 'b');
  assert.equal(session.rouletteResult.consumed, false);
  assert.deepEqual(session.history.map(draw => draw.itemId), ['a']);
  assert.deepEqual(parseSessionJSON(serializeSession(session), catalog), session);
  assert.deepEqual(getEligibleItems(catalog, session.settings, session.history.map(draw => draw.itemId)).map(item => item.id), ['b', 'c']);
  assert.equal(createSession({ rouletteResult: entry('removed') }, catalog).rouletteResult, null);
  assert.equal(createSession({ rouletteResult: null }, catalog).rouletteResult, null);
  assert.equal(createSession({ rouletteResult: { itemId: 'b', probability: Infinity, time: -1 } }, catalog).rouletteResult.consumed, true);
});

test('restore preserves first unique known draw and drops removed catalog items', () => {
  const raw = envelope({ history: [entry('a'), entry('b'), entry('a', { time: 1 }), entry('removed'), entry('c'), entry('b')] });
  const result = createSession(raw, catalog);
  assert.deepEqual(result.history.map(draw => draw.itemId), ['a', 'b', 'c']);
  assert.equal(result.history[0].time, raw.history[0].time);
  assert.equal(result.history.length, catalog.length);
  assert.deepEqual(createSession(raw, [catalog[2]]).history.map(draw => draw.itemId), ['c']);
});

test('corrupt local history metadata cannot reintroduce a known drawn item', () => {
  const result = createSession({
    history: [null, {}, entry('a', { time: NaN, probability: -1, weight: Infinity, drawId: '<script>' }), { itemId: 'b' }],
    preferences: { sound: 'true', quick: true, injected: true },
  }, catalog);
  assert.deepEqual(result.history, [
    entry('a', { time: 0, probability: 0, weight: 0, drawId: 'restored-1' }),
    entry('b', { time: 0, probability: 0, weight: 0, drawId: 'restored-2' }),
  ]);
  assert.deepEqual(result.preferences, { sound: false, quick: true, zoomFactor: 1, music: true, musicTrack: 'title', language: 'en', musicVolume: .01, soundVolume: 1, soundStyle: 'streetbrawl', voices: true, voiceVolume: .65, uiSound: true, uiVolume: .35, catalogVisible: true, mode: 'roulette', curseChance: 0, pairsEnabled: true, chickenChance: .1, archmotherChance: .1, hiddenKingChance: .1 });
  assert.deepEqual(getEligibleItems(catalog, result.settings, result.history.map(draw => draw.itemId)).map(item => item.id), ['c']);
});

test('unknown exclusions and per-item weights are removed during restore/import', () => {
  const result = createSession({ settings: { excludedIds: ['a', 'removed'], disabledIds: ['b'], itemWeights: { a: 2, removed: 100 }, tierWeights: { 1: 1e308 } } }, catalog);
  assert.deepEqual(result.settings.excludedIds, ['a', 'b']);
  assert.deepEqual(result.settings.itemWeights, { a: 2 });
  assert.equal(result.settings.tierWeights[1], 100);
  assert.deepEqual(createSession(result, []).settings.excludedIds, []);
});

test('export/import round trip retains filters, preferences, history and no-repeat state', () => {
  const initial = createSession({ settings: { tierWeights: { 1: 7 }, excludedIds: ['c'], itemWeights: { b: 2 } }, preferences: { sound: true, quick: true, zoomFactor: 1.5 } }, catalog);
  const chosen = pickWeightedItem(catalog, initial.settings, [], { random: () => 0 });
  initial.history.push(entry(chosen.id));
  const json = serializeSession(initial, { verifiedAt: '2026-10-14', itemCount: 3, ignored: { giant: 'data' } });
  const restarted = createSession(JSON.parse(json), catalog);
  const imported = parseSessionJSON(json, catalog);
  assert.deepEqual(imported, initial);
  assert.deepEqual(restarted, initial);
  assert.equal(imported.preferences.zoomFactor, 1.5);
  assert.deepEqual(JSON.parse(json).catalog, { verifiedAt: '2026-10-14', itemCount: 3 });
  assert.deepEqual(getEligibleItems(catalog, imported.settings, imported.history.map(draw => draw.itemId)).map(item => item.id), ['b']);
});

test('version 1 sessions saved before scale support restore and import at 100%', () => {
  const legacy = envelope({ preferences: { sound: true, quick: false }, history: [entry('a')] });
  const restored = createSession(legacy, catalog);
  const imported = parseSessionJSON(JSON.stringify(legacy), catalog);
  assert.equal(restored.preferences.zoomFactor, 1);
  assert.deepEqual(imported, restored);
  assert.deepEqual(imported.history, legacy.history);
  assert.equal(imported.version, 1);
});

test('language and independent music/click switches survive import and legacy preferences', () => {
  const initial = createSession({ preferences: { sound: true, music: false, language: 'en', zoomFactor: 1.5 } }, catalog);
  initial.history.push(entry('a'));
  const imported = parseSessionJSON(serializeSession(initial), catalog);
  assert.equal(imported.preferences.language, 'en');
  assert.equal(imported.preferences.music, false);
  assert.equal(imported.preferences.sound, true);
  assert.equal(imported.preferences.zoomFactor, 1.5);
  assert.deepEqual(imported.history, initial.history);
  const legacy = createSession({ preferences: { sound: false, language: '<script>', music: 'false' } }, catalog);
  assert.equal(legacy.preferences.language, 'en');
  assert.equal(legacy.preferences.music, true);
  assert.equal(legacy.preferences.sound, false);
  const existing = createSession({ preferences: { language: 'ru', musicVolume: .22, curseChance: .5 } }, catalog);
  const restored = parseSessionJSON(serializeSession(existing), catalog).preferences;
  assert.equal(restored.language, 'ru');
  assert.equal(restored.musicVolume, .22);
  assert.equal(restored.curseChance, .5);
});

test('volumes, visibility and build progress persist independently of the normal roulette', () => {
  const session = createSession({
    history: [entry('a')],
    preferences: { musicVolume: .37, soundVolume: .63, catalogVisible: false, mode: 'build' },
    build: { heroId: 'hero-1', excludedHeroIds: ['hero-2'], history: [entry('b'), entry('b')], skillPlan: [{ slot: 1, abilityId: 'skill-1', rank: 1 }], checkedSkills: [0] },
  }, catalog);
  const imported = parseSessionJSON(serializeSession(session), catalog);
  assert.equal(imported.preferences.musicVolume, .37);
  assert.equal(imported.preferences.soundVolume, .63);
  assert.equal(imported.preferences.catalogVisible, false);
  assert.equal(imported.preferences.mode, 'build');
  assert.deepEqual(imported.history.map(draw => draw.itemId), ['a']);
  assert.deepEqual(imported.build.history.map(draw => draw.itemId), ['b']);
  assert.equal(imported.build.heroId, 'hero-1');
  assert.deepEqual(imported.build.checkedSkills, [0]);
  imported.build.history = [];
  assert.equal(imported.history.length, 1);
});

test('saved volume limits retain intentional silence and reject nonnumeric values', () => {
  const prefs = createSession({ preferences: { musicVolume: 0, soundVolume: 3 } }, catalog).preferences;
  assert.equal(prefs.musicVolume, 0);
  assert.equal(prefs.soundVolume, 1);
  const corrupt = createSession({ preferences: { musicVolume: Infinity, soundVolume: '0', mode: 'unknown' } }, catalog).preferences;
  assert.equal(corrupt.musicVolume, .01);
  assert.equal(corrupt.soundVolume, 1);
  assert.equal(corrupt.mode, 'roulette');
});

test('interface audio preferences round trip independently with compatible old-session defaults', () => {
  const session = createSession({ preferences: { music: false, sound: true, uiSound: false, musicVolume: .22, soundVolume: .63, uiVolume: .41 } }, catalog);
  const imported = parseSessionJSON(serializeSession(session), catalog);
  assert.deepEqual(imported.preferences, session.preferences);
  assert.equal(imported.preferences.uiSound, false);
  assert.equal(imported.preferences.uiVolume, .41);
  assert.equal(imported.preferences.music, false);
  assert.equal(imported.preferences.sound, true);
  assert.equal(imported.preferences.soundVolume, .63);
  const old = parseSessionJSON(JSON.stringify(envelope({ preferences: { sound: false } })), catalog);
  assert.equal(old.preferences.uiSound, true);
  assert.equal(old.preferences.uiVolume, .35);
  const silent = createSession({ preferences: { uiSound: true, uiVolume: 0 } }, catalog);
  assert.equal(parseSessionJSON(serializeSession(silent), catalog).preferences.uiVolume, 0);
  for (const invalid of [undefined, null, NaN, Infinity, '0', {}]) {
    assert.equal(createSession({ preferences: { uiVolume: invalid, uiSound: 'false' } }, catalog).preferences.uiVolume, .35);
    assert.equal(createSession({ preferences: { uiSound: 'false' } }, catalog).preferences.uiSound, true);
  }
  assert.equal(createSession({ preferences: { uiVolume: -1 } }, catalog).preferences.uiVolume, 0);
  assert.equal(createSession({ preferences: { uiVolume: 10 } }, catalog).preferences.uiVolume, 1);
});

test('invalid scale defaults to 100% and finite scale is clamped in restore and export', () => {
  for (const value of [undefined, null, '1.5', true, {}, NaN, Infinity, -Infinity]) {
    assert.equal(normalizeZoomFactor(value), 1);
    assert.equal(createSession({ preferences: { zoomFactor: value } }, catalog).preferences.zoomFactor, 1);
  }
  for (const [value, expected] of [[-1, MIN_ZOOM_FACTOR], [0.74, MIN_ZOOM_FACTOR], [0.75, 0.75], [1.37, 1.37], [2.5, 2.5], [100, MAX_ZOOM_FACTOR]]) {
    const raw = envelope({ preferences: { zoomFactor: value } });
    assert.equal(createSession(raw, catalog).preferences.zoomFactor, expected);
    assert.equal(parseSessionJSON(JSON.stringify(raw), catalog).preferences.zoomFactor, expected);
    assert.equal(JSON.parse(serializeSession(raw)).preferences.zoomFactor, expected);
    assert.equal(raw.preferences.zoomFactor, value);
  }
});

test('strict JSON import rejects unsupported envelopes and malformed histories', () => {
  for (const raw of [null, [], {}, envelope({ format: 'other' }), envelope({ version: 2 }), envelope({ history: null }), envelope({ history: [{}] })]) {
    assert.throws(() => parseSessionJSON(JSON.stringify(raw), catalog));
  }
  for (const malformed of [
    entry('a', { itemId: '' }), entry('a', { time: -1 }), entry('a', { time: '1' }),
    entry('a', { probability: 1.1 }), entry('a', { probability: null }),
    entry('a', { weight: -1 }), entry('a', { drawId: '' }), entry('a', { drawId: 'x'.repeat(129) }),
  ]) {
    assert.throws(() => parseSessionJSON(JSON.stringify(envelope({ history: [malformed] })), catalog), /история/);
  }
  assert.throws(() => parseSessionJSON('{broken', catalog), /JSON/);
  assert.throws(() => parseSessionJSON(42, catalog), TypeError);
});

test('strict import sanitizes duplicate/unknown IDs and preserves intentional zeros', () => {
  const result = parseSessionJSON(JSON.stringify(envelope({
    history: [entry('a', { probability: 0, weight: 0 }), entry('removed'), entry('a'), entry('b')],
    settings: { itemWeights: { b: 0 }, tierWeights: { 4: 0 }, excludedIds: ['removed'] },
  })), catalog);
  assert.deepEqual(result.history.map(draw => draw.itemId), ['a', 'b']);
  assert.equal(result.history[0].probability, 0);
  assert.equal(result.history[0].weight, 0);
  assert.equal(result.settings.itemWeights.b, 0);
  assert.deepEqual(result.settings.excludedIds, []);
});

test('UTF-8 size limit rejects oversized ASCII and Unicode imports', () => {
  assert.throws(() => parseSessionJSON(' '.repeat(MAX_SESSION_BYTES + 1), catalog), /2 МБ/);
  const text = JSON.stringify(envelope({ padding: 'я'.repeat(MAX_SESSION_BYTES / 2) }));
  assert.ok(text.length < MAX_SESSION_BYTES);
  assert.throws(() => parseSessionJSON(text, catalog), /2 МБ/);
  assert.deepEqual(parseSessionJSON(JSON.stringify(envelope()), catalog).history, []);
});

test('serialization sanitizes canonical fields without mutating the session', () => {
  const raw = { history: [entry('a'), entry('a')], settings: { excludedIds: ['b'] }, preferences: { sound: false }, unexpected: 'discard' };
  const original = JSON.stringify(raw);
  const serialized = JSON.parse(serializeSession(raw));
  assert.equal(JSON.stringify(raw), original);
  assert.equal(serialized.history.length, 1);
  assert.deepEqual(serialized.settings.excludedIds, ['b']);
  assert.equal(serialized.unexpected, undefined);
  assert.equal(serialized.format, SESSION_FORMAT);
});
