import { normalizeSettings } from './roulette.js';
import { createBuildState, DEFAULT_INVENTORY_SLOTS } from './build-core.js';
import { normalizeHistory as historyEntries } from './history.js';
import { normalizeContracts } from './contracts.js';
import { normalizeSoundStyle } from './sound-palette.js';
import { createItemActionState } from './item-actions.js';
import { normalizeMusicTrack } from './music-tracks.js';
import { ITEM_COMBOS } from './item-combos.js';
import { coalesceBuildInventory } from './build-inventory.js';
import { canonicalTicketHistory } from './ticket-history.js';
import { getBuildPurchasePlan } from './build-purchase-plan.js';
import { normalizeBuildFate } from './build-fate-state.js';

export const SESSION_FORMAT = 'deadlock-roulette-session';
export const SESSION_VERSION = 1;
export const MAX_SESSION_BYTES = 2 * 1024 * 1024;
export const MIN_ZOOM_FACTOR = 0.75;
export const MAX_ZOOM_FACTOR = 2.5;
const MAX_TIME = 8.64e15;

/** Restore old sessions at 100% and keep imported scale within usable limits. */
export function normalizeZoomFactor(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, value));
}

export function normalizeVolume(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validItemId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function canonicalSession(raw, knownIds, catalogItems = []) {
  const source = isRecord(raw) ? raw : {};
  const knownTicketIds = knownIds ? new Set([...knownIds, ...ITEM_COMBOS.filter(combo => combo.itemIds.every(id => knownIds.has(id))).map(combo => combo.id)]) : undefined;
  const settings = normalizeSettings(source.settings);
  if (knownIds) {
    settings.excludedIds = settings.excludedIds.filter(id => knownIds.has(id));
    settings.itemWeights = Object.fromEntries(Object.entries(settings.itemWeights).filter(([id]) => knownIds.has(id)));
  }
  const preferences = isRecord(source.preferences) ? source.preferences : {};
  let build = createBuildState(source.build);
  build.fate = normalizeBuildFate(build.fate, knownIds);
  build.history = canonicalTicketHistory(build.history, knownIds, { inventory: true }).slice(0, DEFAULT_INVENTORY_SLOTS);
  if (knownIds) build.discardedItemIds = build.discardedItemIds.filter(id => knownIds.has(id));
  if (knownTicketIds) build.consumedTicketIds = build.consumedTicketIds.filter(id => knownTicketIds.has(id));
  build.consumedTicketIds = [...new Set([...build.consumedTicketIds, ...build.history.map(entry => entry.ticketId || entry.comboOrigin || entry.itemId)])];
  build.inventoryUndo = build.inventoryUndo.map(snapshot => ({ ...snapshot, history: canonicalTicketHistory(snapshot.history, knownIds, { inventory: true }).slice(0, DEFAULT_INVENTORY_SLOTS),
    discardedItemIds: snapshot.discardedItemIds.filter(id => !knownIds || knownIds.has(id)), consumedTicketIds: snapshot.consumedTicketIds.filter(id => !knownTicketIds || knownTicketIds.has(id)) }));
  build.purchasePlan = getBuildPurchasePlan(build, catalogItems, { knownIds });
  build.inventoryUndo = build.inventoryUndo.map((snapshot, index) => ({ ...snapshot,
    purchasePlan: getBuildPurchasePlan({ ...snapshot, inventoryUndo: build.inventoryUndo.slice(0, index) }, catalogItems, { knownIds }) }));
  build = coalesceBuildInventory(build);
  if (build.starterOrderVersion !== 1 && catalogItems.length) {
    const byId = new Map(catalogItems.map(item => [item.id, item]));
    const starters = build.history.filter(entry => byId.get(entry.itemId)?.tier === 1);
    const others = build.history.filter(entry => byId.get(entry.itemId)?.tier !== 1);
    build.history = [...starters, ...others];
    build.inventoryUndo = [];
    build.starterOrderVersion = 1;
  }
  const rouletteResult = canonicalTicketHistory(isRecord(source.rouletteResult) ? [source.rouletteResult] : [], knownTicketIds)[0];
  return {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    settings,
    history: canonicalTicketHistory(source.history, knownTicketIds),
    rouletteResult: rouletteResult ? { ...rouletteResult, consumed: source.rouletteResult.consumed !== false } : null,
    itemActions: createItemActionState(source.itemActions),
    build,
    contracts: normalizeContracts(source.contracts, knownIds, catalogItems),
    preferences: {
      sound: typeof preferences.sound === 'boolean' ? preferences.sound : false,
      quick: typeof preferences.quick === 'boolean' ? preferences.quick : false,
      zoomFactor: normalizeZoomFactor(preferences.zoomFactor),
      music: typeof preferences.music === 'boolean' ? preferences.music : true,
      musicTrack: normalizeMusicTrack(preferences.musicTrack),
      language: preferences.language === 'en' ? 'en' : 'ru',
      musicVolume: normalizeVolume(preferences.musicVolume, .22),
      soundVolume: normalizeVolume(preferences.soundVolume, 1),
      soundStyle: normalizeSoundStyle(preferences.soundStyle),
      voices: typeof preferences.voices === 'boolean' ? preferences.voices : true,
      voiceVolume: normalizeVolume(preferences.voiceVolume, .65),
      uiSound: typeof preferences.uiSound === 'boolean' ? preferences.uiSound : true,
      uiVolume: normalizeVolume(preferences.uiVolume, .35),
      catalogVisible: typeof preferences.catalogVisible === 'boolean' ? preferences.catalogVisible : true,
      mode: preferences.mode === 'build' ? 'build' : 'roulette',
      curseChance: normalizeVolume(preferences.curseChance, .5),
      pairsEnabled: typeof preferences.pairsEnabled === 'boolean' ? preferences.pairsEnabled : true,
      chickenChance: normalizeVolume(preferences.chickenChance, .1),
      archmotherChance: normalizeVolume(preferences.archmotherChance, .1),
      hiddenKingChance: normalizeVolume(preferences.hiddenKingChance, .1),
    },
  };
}

/**
 * Tolerant restoration for local storage: keep first known draws even when their
 * metadata is damaged, so reopening the app cannot reintroduce drawn items.
 */
export function createSession(raw, catalogItems = []) {
  const knownIds = new Set((Array.isArray(catalogItems) ? catalogItems : [])
    .filter(item => isRecord(item) && validItemId(item.id))
    .map(item => item.id));
  return canonicalSession(raw, knownIds, catalogItems);
}

/** Strict import envelope; unknown IDs and duplicate draws are sanitized afterward. */
export function parseSessionJSON(text, catalogItems = []) {
  if (typeof text !== 'string') throw new TypeError('Сессия должна быть JSON-текстом.');
  if (text.length > MAX_SESSION_BYTES || new TextEncoder().encode(text).byteLength > MAX_SESSION_BYTES) {
    throw new Error('Файл сессии превышает 2 МБ.');
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Не удалось прочитать JSON-файл сессии.');
  }
  if (!isRecord(raw) || raw.format !== SESSION_FORMAT || raw.version !== SESSION_VERSION) {
    throw new Error('Неподдерживаемый формат или версия сессии.');
  }
  if (!Array.isArray(raw.history) || raw.history.some(entry => !isRecord(entry)
    || !validItemId(entry.itemId)
    || typeof entry.time !== 'number' || !Number.isFinite(entry.time) || entry.time < 0 || entry.time > MAX_TIME
    || typeof entry.probability !== 'number' || !Number.isFinite(entry.probability) || entry.probability < 0 || entry.probability > 1
    || typeof entry.weight !== 'number' || !Number.isFinite(entry.weight) || entry.weight < 0
    || typeof entry.drawId !== 'string' || !entry.drawId.trim() || entry.drawId.length > 128)) {
    throw new Error('Некорректная история выпадений в файле сессии.');
  }
  return createSession(raw, catalogItems);
}

/** Serialize a canonical copy without changing the caller's session. */
export function serializeSession(session, catalogMetadata) {
  const result = canonicalSession(session);
  if (isRecord(catalogMetadata)) {
    const metadata = Object.fromEntries(Object.entries(catalogMetadata).filter(([, value]) =>
      typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))));
    if (Object.keys(metadata).length) result.catalog = metadata;
  }
  return JSON.stringify(result, null, 2);
}
