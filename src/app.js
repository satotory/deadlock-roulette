import catalog from './catalog-data.js';
import { calculateProbabilities, pickWeightedItem, randomUnitInterval, normalizeSettings } from './roulette.js';
import { createSession, parseSessionJSON, serializeSession, normalizeZoomFactor } from './session.js';
import { messages, translate, localeFor, localizedItemName, secondaryItemName } from './i18n.js';
import { audio } from './audio.js';
import heroCatalog from './hero-data.js';
import { createBuildMode } from './build-mode.js';
import { createBuildState, DEFAULT_INVENTORY_SLOTS } from './build-core.js';
import { saveContract, replayContract, normalizeContractName, updateContractReview } from './contracts.js';
import { calculateBuildDistribution, calculateBuildAction, calculateRouletteAction, createItemTickets } from './draw-rules.js';
import { planDrawSequence, currentDrawResult, distributionForDraw } from './draw-sequence.js';
import { undoBuildDraw, getLatestBuildEntries } from './build-inventory.js';
import { planBuildFateDraw, resolveArchmotherOffer, revealNextSealedPurchase, isBuildEntrySealed, getNextSealedPurchase, getPendingChickenEvent, acknowledgeBuildChicken } from './build-fate.js';
import { fateBadgesHTML } from './fate-presentation.js';
import { getKingContractAvailability, planResolveKingContract } from './king-contract.js';
import { showBuildNewspaper } from './newspaper.js';
import { createItemActionState, getItemActionAvailability, canUseItemAction, spendItemAction } from './item-actions.js';
import { countBoundaryCrossings, slotAtPoint } from './wheel-geometry.js';
import { showContractPoster } from './contract-poster.js';
import heroArt from './hero-art.js';
import { MUSIC_TRACKS } from './music-tracks.js';
import { curseTiming } from './curse-timing.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const TAU = Math.PI * 2;
const STORAGE_KEY = 'deadlock-roulette.session.v1';
const ZOOM_LEVELS = [.75, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];
const CATEGORY = {
  weapon: { glyph: '⌁', color: '#df9b55', rgb: [223, 155, 85] },
  vitality: { glyph: '♡', color: '#9ec679', rgb: [158, 198, 121] },
  spirit: { glyph: '✧', color: '#b895d8', rgb: [184, 149, 216] },
};
const items = catalog.items;
const tickets = createItemTickets(items);
const itemById = new Map(tickets.map(item => [item.id, item]));
const locale = () => localeFor(session.preferences.language);
const currency = value => new Intl.NumberFormat(locale()).format(value);
const percent = value => `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(value * 100)}%`;
const t = (key, variables) => translate(session.preferences.language, key, variables);
const itemName = item => localizedItemName(item, session.preferences.language);
const otherName = item => secondaryItemName(item, session.preferences.language);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const iconURL = item => new URL(`../${item.icon}`, import.meta.url).href;
const iconHTML = (item, className = '') => item.combo ? `<span class="combo-icons">${item.components.map(component => iconHTML(component, className)).join('')}<b>+</b></span>` : item.icon ? `<img class="item-icon ${className}" src="${escape(iconURL(item))}" alt="" loading="lazy">` : `<span class="fallback-icon">${CATEGORY[item.category].glyph}</span>`;
let session;
let storageFailed = false;
try { session = createSession(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'), items); }
catch { session = createSession({}, items); storageFailed = true; }
// The requested original draft effect replaces the old palette once; subsequent choices persist.
try {
  if (localStorage.getItem('deadlock-roulette.audio-refresh.v2') !== 'done') {
    session.preferences.soundStyle = 'streetbrawl';
    localStorage.setItem('deadlock-roulette.audio-refresh.v2', 'done');
  }
} catch { /* The existing storage warning covers unavailable persistence. */ }
let spinning = false;
let offerBusy = false;
let visualSession = null;
let pendingVisibleHistory = null;
let spinConsumes = true;
let rotation = 0;
let wheelEntries = [];
let distribution;
let toastTimer;
let catalogCategory = 'all';
let focusedItemId = null;
let lastTick = 0;
let zoomRequest = 0;
let buildMode;
let hoveredIndex = -1;
const imageCache = new Map();
const canvas = $('#wheel');
const ctx = canvas.getContext('2d');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const getHeroArt = hero => heroArt[String(hero?.id)] || null;
const ambience = document.createElement('div'); ambience.className = 'hero-ambience'; ambience.setAttribute('aria-hidden', 'true');
ambience.innerHTML = '<i></i><i></i>'; document.body.prepend(ambience);
let themeHeroId, ambienceIndex = 0;
function updateHeroTheme(hero = heroCatalog.heroes.find(entry => entry.id === session.build.heroId)) {
  const id = hero?.id || 'empty';
  if (id === themeHeroId) return;
  themeHeroId = id;
  const color = getHeroArt(hero)?.color || '#9d7fbd';
  const rgb = color.slice(1).match(/../g).map(value => parseInt(value, 16));
  const dark = rgb.map((value, index) => Math.round(value * .105 + [13, 14, 18][index] * .895));
  document.body.style.setProperty('--hero-color', color);
  document.body.style.setProperty('--hero-background', `rgb(${dark.join(',')})`);
  const previous = ambience.children[ambienceIndex]; ambienceIndex = 1 - ambienceIndex;
  const next = ambience.children[ambienceIndex];
  next.style.background = `radial-gradient(ellipse at 19% 32%, ${color}40, transparent 55%), radial-gradient(ellipse at 80% 7%, ${color}24, transparent 62%)`;
  requestAnimationFrame(() => { previous.classList.remove('is-active'); next.classList.add('is-active'); });
}
const effectLayer = document.createElement('div');
effectLayer.className = 'interface-effects';
effectLayer.setAttribute('aria-hidden', 'true');
document.body.append(effectLayer);

function interfaceAccent(x, y, color, strong = false) {
  if (prefersReducedMotion || effectLayer.childElementCount > 72) return;
  const ring = document.createElement('i');
  ring.className = 'interface-ring';
  ring.style.left = `${x}px`; ring.style.top = `${y}px`; ring.style.color = color;
  effectLayer.append(ring);
  setTimeout(() => ring.remove(), 650);
  if (!strong) return;
  for (let index = 0; index < 9; index++) {
    const angle = index / 9 * TAU - Math.PI / 2;
    const spark = document.createElement('i');
    spark.className = 'interface-spark';
    spark.style.left = `${x}px`; spark.style.top = `${y}px`; spark.style.backgroundColor = color;
    spark.style.setProperty('--spark-x', `${Math.cos(angle) * (34 + index % 3 * 12)}px`);
    spark.style.setProperty('--spark-y', `${Math.sin(angle) * (34 + index % 3 * 12)}px`);
    effectLayer.append(spark);
    setTimeout(() => spark.remove(), 700);
  }
}
function resultAccents(element, color) {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) return;
  interfaceAccent(rect.left + rect.width / 2, rect.top + rect.height / 2, color, true);
}
function revealCompleteBuild() {
  if (prefersReducedMotion) return;
  const seal = document.createElement('div');
  seal.className = 'contract-seal';
  seal.innerHTML = `<span aria-hidden="true">✦</span><small>DEADLOCK / CONTRACT</small><strong>${escape(t('buildFull'))}</strong><b>12 / 12</b>`;
  effectLayer.append(seal);
  setTimeout(() => seal.remove(), 2200);
  audio.ui('success');
}

document.addEventListener('pointerover', event => {
  if (spinning || buildMode?.busy) return;
  const element = event.target.closest('button,summary,.build-item-slot:not(.is-empty),.build-skill-step');
  if (!element || element.disabled || element.contains(event.relatedTarget)) return;
  audio.ui('hover');
});
document.addEventListener('click', event => {
  const element = event.target.closest('button,summary');
  if (!element || element.disabled || ['ui-sound-button', 'sound-preview'].includes(element.id)) return;
  const kind = element.dataset.buildContractRating ? 'mark' : element.matches('summary') ? 'open' : element.hasAttribute('aria-pressed') ? 'toggle' : 'tap';
  audio.ui(kind);
  const rect = element.getBoundingClientRect();
  const x = event.detail ? event.clientX : rect.left + rect.width / 2;
  const y = event.detail ? event.clientY : rect.top + rect.height / 2;
  interfaceAccent(x, y, session.preferences.mode === 'build' ? '#c8ace1' : '#dfc28b');
}, true);
document.addEventListener('change', event => {
  const input = event.target;
  if (input.matches('[data-build-skill-index]')) {
    audio.ui(input.checked ? 'mark' : 'close');
    const index = Number(input.dataset.buildSkillIndex);
    if (input.checked && Number.isInteger(index)) resultAccents($(`[data-build-skill-index="${index}"]`)?.closest('label'), '#c8ace1');
  } else if (input.matches('select,input[type=range],.weight-stepper input')) audio.ui('toggle');
});

function save() {
  try { localStorage.setItem(STORAGE_KEY, serializeSession(session)); return true; }
  catch { toast(t('saveFailed')); return false; }
}
function viewSession() { return visualSession || session; }
function activeHistory() { const view = viewSession(); return session.preferences.mode === 'build' ? view.build.history : view.history; }
function entryIsSealed(entry, state = viewSession()) {
  return state.preferences.mode === 'build' && isBuildEntrySealed(state.build, entry, items);
}
function secretContext(state = viewSession()) {
  return state.preferences.mode === 'build' && Boolean(getNextSealedPurchase(state.build, items) || state.build.fate?.kingImpostorQueue?.length);
}
function drawnIds() { return new Set([...activeHistory().filter(entry => !entryIsSealed(entry)).map(entry => entry.itemId), ...(session.preferences.mode === 'build' && !secretContext() ? session.build.discardedItemIds : [])]); }
// A committed draw remains hidden until its animation has completed.
function visibleHistory() { return pendingVisibleHistory || activeHistory(); }
function currentResult() { return currentDrawResult(viewSession(), items); }
function itemActionAvailability(inBuild = session.preferences.mode === 'build') {
  const stateForMode = { ...session, preferences: { ...session.preferences, mode: inBuild ? 'build' : 'roulette' } };
  const result = currentDrawResult(stateForMode, items);
  const state = inBuild ? session.build.itemActions : session.itemActions;
  const policies = getItemActionAvailability(state, result);
  return Object.fromEntries(['reroll', 'upgrade', 'downgrade'].map(action => {
    const candidate = distributionForDraw(stateForMode, items, action);
    const policy = policies[action];
    const royalSealed = inBuild && getLatestBuildEntries(session.build).some(entry => entry.kingOrigin && isBuildEntrySealed(session.build, entry, items));
    const fateBlocked = inBuild && (session.build.fate?.totalLocked || session.build.fate?.pendingArchmother || session.build.fate?.pendingChicken || session.build.fate?.pendingKing || session.build.fate?.kingImpostorQueue?.length || royalSealed);
    const reason = fateBlocked ? session.build.fate?.totalLocked ? 'fateLocked' : session.build.fate?.pendingChicken ? 'pendingChicken' : session.build.fate?.pendingKing ? 'pendingKing' : session.build.fate?.kingImpostorQueue?.length ? 'kingQueue' : royalSealed ? 'royalSeal' : 'pendingOffer' : policy.reason || (!candidate.eligibleCount ? 'emptyPool' : '');
    return [action, { ...policy, disabled: spinning || offerBusy || Boolean(buildMode?.busy) || Boolean(fateBlocked) || !policy.available || !candidate.eligibleCount, reason }];
  }));
}
function buildIsFull() { return session.preferences.mode === 'build' && activeHistory().length >= DEFAULT_INVENTORY_SLOTS; }
function renderViewPreferences() {
  $('#curse-chance').value = Math.round(session.preferences.curseChance * 100);
  $('#curse-chance-value').textContent = `${Math.round(session.preferences.curseChance * 100)}%`;
  $('#pairs-enabled').checked = session.preferences.pairsEnabled;
  $('#catalog').hidden = !session.preferences.catalogVisible;
  $('#catalog-toggle-button').textContent = t(session.preferences.catalogVisible ? 'hideCatalog' : 'showCatalog');
  $('#catalog-toggle-button').setAttribute('aria-expanded', String(session.preferences.catalogVisible));
  for (const kind of ['music', 'sound', 'ui', 'voice']) {
    const value = Math.round(session.preferences[`${kind}Volume`] * 100);
    $(`#${kind}-volume`).value = value;
    $(`#${kind}-volume-value`).textContent = `${value}%`;
  }
  const uiMute = $('#ui-sound-button');
  uiMute.setAttribute('aria-pressed', String(session.preferences.uiSound));
  uiMute.setAttribute('aria-label', t(session.preferences.uiSound ? 'uiSoundOff' : 'uiSoundOn'));
  uiMute.title = t(session.preferences.uiSound ? 'uiSoundOff' : 'uiSoundOn');
  uiMute.querySelector('span').textContent = t(session.preferences.uiSound ? 'uiSoundOff' : 'uiSoundOn');
  $('#sound-style').value = session.preferences.soundStyle;
  const trackSelect = $('#music-track');
  trackSelect.replaceChildren(...MUSIC_TRACKS.map(track => {
    const option = document.createElement('option'); option.value = track.id;
    option.textContent = session.preferences.language === 'ru' ? track.localizedName : track.name;
    return option;
  }));
  trackSelect.value = session.preferences.musicTrack;
  const voiceMute = $('#voice-button');
  voiceMute.setAttribute('aria-pressed', String(session.preferences.voices));
  voiceMute.setAttribute('aria-label', t(session.preferences.voices ? 'voiceOff' : 'voiceOn'));
  voiceMute.title = t(session.preferences.voices ? 'voiceOff' : 'voiceOn');
  voiceMute.querySelector('span').textContent = t(session.preferences.voices ? 'voiceOff' : 'voiceOn');
  $$('button[data-mode]').forEach(button => {
    const active = button.dataset.mode === session.preferences.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.disabled = spinning || offerBusy || Boolean(buildMode?.busy);
  });
}
function activateMode(mode) {
  if (spinning || offerBusy || buildMode?.busy || !['roulette', 'build'].includes(mode)) return;
  session.preferences.mode = mode;
  document.body.dataset.mode = mode;
  updateHeroTheme();
  const inBuild = mode === 'build';
  if (!inBuild) audio.stopHeroVoice();
  const host = inBuild ? $('#build-wheel-host') : $('#roulette-mode');
  host.append($('.playground'));
  $('#roulette-mode').hidden = inBuild;
  $('#build-mode').hidden = !inBuild;
  hideWheelHover();
  rotation = 0;
  save();
  render();
  if (inBuild) queueMicrotask(() => continuePendingFates());
}
function localizedError(error) {
  const message = error?.message || String(error);
  const key = Object.keys(messages.ru).find(key => key.startsWith('error') && (message.endsWith(messages.ru[key]) || message.endsWith(messages.en[key])));
  return key ? t(key) : message;
}
function applyLanguage() {
  document.documentElement.lang = session.preferences.language;
  document.title = t('title');
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n, { tier: el.dataset.i18nTier }); });
  $$('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  for (const [attribute, dataKey] of [['aria-label', 'i18nLabel'], ['title', 'i18nTitle'], ['placeholder', 'i18nPlaceholder']]) {
    $$(`[data-${dataKey.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}]`).forEach(el => el.setAttribute(attribute, t(el.dataset[dataKey])));
  }
  $('#language-button').textContent = session.preferences.language.toUpperCase();
  $('#language-button').title = t('languageSwitch');
  $('#language-button').setAttribute('aria-label', t('languageSwitch'));
  const metadata = { version: catalog.clientVersion, date: new Date(catalog.gameVersionDate || catalog.updatedAt).toLocaleDateString(locale()), standard: catalog.standardCount, legendary: catalog.legendaryCount };
  $('#catalog-source').textContent = t('catalogSource', metadata);
  $('#legendary-note').textContent = t('legendaryNote', metadata);
  renderViewPreferences();
  buildMode?.render({ spinning });
  if (hoveredIndex >= 0) renderHoverCard();
}
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
function renderZoomControls() {
  const factor = session.preferences.zoomFactor;
  const select = $('#zoom-select');
  select.querySelector('[data-custom-zoom]')?.remove();
  if (!ZOOM_LEVELS.includes(factor)) {
    const option = new Option(`${Math.round(factor * 100)}%`, String(factor));
    option.dataset.customZoom = 'true';
    select.add(option);
  }
  select.value = String(factor);
  $('#zoom-out-button').disabled = factor <= ZOOM_LEVELS[0];
  $('#zoom-in-button').disabled = factor >= ZOOM_LEVELS.at(-1);
}
async function applyZoom(value, { persist = true } = {}) {
  const previous = session.preferences.zoomFactor;
  const factor = normalizeZoomFactor(value);
  const request = ++zoomRequest;
  session.preferences.zoomFactor = factor;
  renderZoomControls();
  if (persist) save();
  try {
    if (window.deadlock?.setZoomFactor) await window.deadlock.setZoomFactor(factor);
    else document.documentElement.style.zoom = String(factor);
  } catch {
    if (request !== zoomRequest) return;
    session.preferences.zoomFactor = previous;
    renderZoomControls();
    save();
    toast(t('zoomFailed'));
  }
}
function stepZoom(direction) {
  const current = session.preferences.zoomFactor;
  const next = direction > 0 ? ZOOM_LEVELS.find(factor => factor > current + .001) : [...ZOOM_LEVELS].reverse().find(factor => factor < current - .001);
  if (next !== undefined) applyZoom(next);
}
function getDistribution() { return distributionForDraw(viewSession(), items); }
function setSpecialRule(key, value) {
  if (spinning || offerBusy || buildMode?.busy) return;
  session.preferences[key] = value;
  save(); render();
}
function updateSettings(mutator) {
  if (spinning || offerBusy || buildMode?.busy) return;
  mutator(session.settings);
  session.settings = normalizeSettings(session.settings);
  save();
  rotation = 0;
  render();
}
function updateBuildSettings(mutator) {
  if (spinning || offerBusy || buildMode?.busy) return;
  mutator(session.build);
  session.build = createBuildState(session.build);
  save(); rotation = 0; render();
}
function toggleArray(array, value) {
  const index = array.indexOf(value);
  if (index === -1) array.push(value); else array.splice(index, 1);
}
function weightControl(kind, key, value) {
  const name = kind === 'categoryWeights' ? t(key) : kind === 'tierWeights' ? key === 5 ? t('legendary') : `T${key}` : itemById.has(String(key)) ? itemName(itemById.get(String(key))) : key;
  return `<div class="weight-stepper"><button data-step="-1" data-kind="${kind}" data-key="${key}" aria-label="${escape(t('decreaseWeight', { name }))}">−</button><input type="number" min="0" max="100" step="1" value="${value}" data-kind="${kind}" data-key="${key}" aria-label="${escape(t('weight', { name }))}"><button data-step="1" data-kind="${kind}" data-key="${key}" aria-label="${escape(t('increaseWeight', { name }))}">+</button></div>`;
}
function renderControls() {
  const enabledTiers = session.preferences.mode === 'build' ? session.build.enabledTiers : session.settings.enabledTiers;
  const hidden = secretContext();
  $('#category-controls').innerHTML = Object.entries(CATEGORY).map(([key, cat]) => `<button class="category-toggle" data-toggle-category="${key}" aria-pressed="${session.settings.enabledCategories.includes(key)}"><span class="category-glyph">${cat.glyph}</span><span class="category-name">${t(key)}<small>${hidden ? '—' : t('totalChance', { chance: percent(distribution.byCategory[key]) })}</small></span><span class="category-check">✓</span></button>`).join('');
  $$('#category-controls .category-toggle').forEach(el => el.style.setProperty('--category-color', CATEGORY[el.dataset.toggleCategory].color));
  $('#tier-controls').innerHTML = [1, 2, 3, 4, 5].filter(tier => items.some(item => item.tier === tier)).map(tier => `<div class="tier-row"><button class="tier-enable" data-toggle-tier="${tier}" aria-pressed="${enabledTiers.includes(tier)}" title="${tier === 5 ? t('legendaryTooltip') : t('toggleTier', { tier })}"><span class="tier-dot"></span>${tier === 5 ? 'LEG' : `T${tier}`}</button><span class="tier-chance">${hidden ? '—' : percent(distribution.byTier[tier])}</span>${weightControl('tierWeights', tier, session.settings.tierWeights[tier])}</div>`).join('');
  $('#category-weights').innerHTML = Object.entries(CATEGORY).map(([key]) => `<div class="category-weight-row"><span>${t(key)}</span>${weightControl('categoryWeights', key, session.settings.categoryWeights[key])}</div>`).join('');
  const patterns = { classic: [4, 3, 2, 1], equal: [1, 1, 1, 1], luxury: [1, 2, 3, 4] };
  $$('.preset').forEach(button => button.classList.toggle('active', patterns[button.dataset.preset].every((weight, index) => session.settings.tierWeights[index + 1] === weight)));
}
function renderStats() {
  renderZoomControls();
  renderViewPreferences();
  for (const action of ['reroll', 'upgrade', 'downgrade']) {
    const availability = itemActionAvailability(false)[action];
    const button = $(`#${action}-button`);
    button.disabled = availability.disabled || session.preferences.mode !== 'roulette';
    button.dataset.spent = String(session.itemActions.usedActions.includes(action));
    button.textContent = `${t(action)} · ${button.dataset.spent === 'true' ? '0' : '1'}/1`;
    button.title = t(availability.reason === 'cursed' ? 'cursedItem' : availability.reason === 'used' ? 'actionSpent' : availability.reason === 'modified' ? 'itemModified' : availability.reason === 'missing-item' ? 'actionNeedsItem' : availability.reason === 'emptyPool' ? 'noAvailable' : `${action}Hint`);
  }
  $('.build-inventory-panel')?.classList.toggle('is-complete', session.build.history.length === DEFAULT_INVENTORY_SLOTS && !spinning);
  $('#drawn-count').textContent = activeHistory().length;
  const maximum = session.preferences.mode === 'build' ? DEFAULT_INVENTORY_SLOTS : session.preferences.pairsEnabled ? tickets.length : items.length;
  $('#total-count').textContent = maximum;
  $('#session-progress').style.width = `${activeHistory().length / maximum * 100}%`;
  $('#pool-count').textContent = distribution.eligibleCount;
  $('[data-i18n="poolItems"]').textContent = t(session.preferences.mode === 'build' ? 'poolAvailable' : 'poolItems');
  $('#ritual-label').textContent = t('ritual', { number: String(activeHistory().length + 1).padStart(3, '0') });
  $('#wheel-center-count').textContent = t('itemCount', { count: distribution.eligibleCount });
  $('#spin-button').disabled = spinning || offerBusy || buildMode?.busy || !distribution.eligibleCount || (session.preferences.mode === 'build' && (!session.build.heroId || session.build.fate?.totalLocked || session.build.fate?.pendingArchmother || session.build.fate?.pendingChicken || session.build.fate?.pendingKing));
  $('#spin-button span').textContent = t(spinning ? 'spinning' : buildIsFull() && !distribution.eligibleCount ? 'buildFull' : 'spin');
  $('#spin-button').classList.toggle('is-spinning', spinning);
  $('.wheel-stage').classList.toggle('spinning', spinning);
  $('#wheel-empty').hidden = distribution.eligibleCount > 0 || spinning;
  if (!distribution.eligibleCount) {
    const poolBeforeDraws = calculateProbabilities(items, session.settings, []);
    $('#empty-reason').textContent = t(poolBeforeDraws.eligibleCount ? 'exhausted' : 'emptyPool');
  }
  $('#sound-button').setAttribute('aria-pressed', String(session.preferences.sound));
  $('#sound-button').setAttribute('aria-label', t(session.preferences.sound ? 'soundOff' : 'soundOn'));
  $('#sound-button').title = t(session.preferences.sound ? 'soundOff' : 'soundOn');
  $('#music-button').setAttribute('aria-pressed', String(session.preferences.music));
  $('#music-button').setAttribute('aria-label', t(session.preferences.music ? 'musicOff' : 'musicOn'));
  $('#music-button').title = t(session.preferences.music ? 'musicOff' : 'musicOn');
  $('#speed-button').setAttribute('aria-pressed', String(session.preferences.quick));
  $('#speed-button').setAttribute('aria-label', t(session.preferences.quick ? 'quickOff' : 'quickOn'));
  $('#speed-button').title = t(session.preferences.quick ? 'quickOff' : 'quickOn');
  $('#reset-button').disabled = spinning || offerBusy || Boolean(buildMode?.busy);
  $('#import-button').disabled = spinning || offerBusy || Boolean(buildMode?.busy);
  $('#reset-button').lastChild.textContent = ` ${t(session.preferences.mode === 'build' ? 'resetBuildItems' : 'reset')}`;
  $('#reset-dialog p').textContent = t(session.preferences.mode === 'build' ? 'buildResetCopy' : 'resetCopy');
}
function buildWheel(entries) {
  let angle = 0;
  return entries.map(entry => {
    const start = angle;
    angle += entry.probability * TAU;
    return { ...entry, start, end: angle, midpoint: (start + angle) / 2 };
  });
}
function drawWheel() {
  const size = canvas.width;
  const center = size / 2;
  const outer = size * .447;
  const inner = size * .182;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(center, center);
  // Fixed brass rings and small ornaments anchor the moving wheel.
  [outer + 16, outer + 8, inner - 9].forEach((radius, index) => {
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.strokeStyle = index === 1 ? '#b49c6150' : '#b49c6128'; ctx.lineWidth = index === 1 ? 3 : 1.5; ctx.stroke();
  });
  for (let index = 0; index < 72; index++) {
    const a = index / 72 * TAU;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * (outer + 21), Math.sin(a) * (outer + 21));
    ctx.lineTo(Math.cos(a) * (outer + (index % 6 === 0 ? 29 : 24)), Math.sin(a) * (outer + (index % 6 === 0 ? 29 : 24)));
    ctx.strokeStyle = index % 6 === 0 ? '#a9956560' : '#a9956525'; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.rotate(rotation - Math.PI / 2);
  if (!wheelEntries.length) {
    ctx.beginPath(); ctx.arc(0, 0, outer, 0, TAU); ctx.fillStyle = '#1d2b1e'; ctx.fill();
  }
  wheelEntries.forEach((entry, index) => {
    const { item, start, end, midpoint } = entry;
    const [r, g, b] = CATEGORY[item.category].rgb;
    const factor = [.37, .46, .56, .67, .76][item.tier - 1] + (index % 2 ? .028 : 0);
    ctx.beginPath();
    ctx.arc(0, 0, outer, start, end);
    ctx.arc(0, 0, inner, end, start, true);
    ctx.closePath();
    ctx.fillStyle = `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`;
    ctx.fill();
    ctx.strokeStyle = '#111e17'; ctx.lineWidth = wheelEntries.length > 80 ? 1.8 : 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, outer - 4, start + Math.min(.002, (end - start) / 8), end - Math.min(.002, (end - start) / 8)); ctx.strokeStyle = CATEGORY[item.category].color + '9a'; ctx.lineWidth = 5; ctx.stroke();
    const arc = end - start;
    if (arc > .1) {
      ctx.save(); ctx.rotate(midpoint);
      const image = imageCache.get(item.id);
      const imageSize = Math.min(54, arc * outer * .65);
      if (image?.complete && image.naturalWidth) {
        ctx.save(); ctx.translate(outer - 73, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(image, -imageSize / 2, -imageSize / 2, imageSize, imageSize); ctx.restore();
      }
      if (arc > .23) {
        ctx.fillStyle = '#e6e4ce'; ctx.font = `${Math.min(21, 15 + arc * 8)}px Segoe UI`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        const name = itemName(item);
        ctx.fillText(name.length > 19 ? `${name.slice(0, 18)}…` : name, outer - 115, 0, outer - inner - 125);
      }
      ctx.restore();
    } else if (arc > .015) {
      ctx.beginPath(); ctx.arc(Math.cos(midpoint) * (outer - 20), Math.sin(midpoint) * (outer - 20), Math.min(2.5, arc * outer / 6), 0, TAU); ctx.fillStyle = CATEGORY[item.category].color + 'bb'; ctx.fill();
    }
  });
  if (!spinning && hoveredIndex >= 0 && wheelEntries[hoveredIndex]) {
    const entry = wheelEntries[hoveredIndex];
    const halfArc = Math.max((entry.end - entry.start) / 2, .052);
    ctx.beginPath();
    ctx.arc(0, 0, outer + 15, entry.midpoint - halfArc, entry.midpoint + halfArc);
    ctx.arc(0, 0, inner, entry.midpoint + halfArc, entry.midpoint - halfArc, true);
    ctx.closePath();
    ctx.fillStyle = CATEGORY[entry.item.category].color + 'dc';
    ctx.fill(); ctx.strokeStyle = '#efe1b7'; ctx.lineWidth = 3; ctx.stroke();
    const image = imageCache.get(entry.item.id);
    if (image?.complete && image.naturalWidth) {
      ctx.save(); ctx.rotate(entry.midpoint); ctx.translate(outer - 73, 0); ctx.rotate(Math.PI / 2);
      ctx.drawImage(image, -29, -29, 58, 58); ctx.restore();
    }
  }
  ctx.restore();
}
function hideWheelHover() {
  hoveredIndex = -1;
  $('#wheel-hover-card').hidden = true;
}
function renderHoverCard() {
  const entry = wheelEntries[hoveredIndex];
  if (!entry) return hideWheelHover();
  const item = entry.item;
  const card = $('#wheel-hover-card');
  card.style.setProperty('--hover-color', CATEGORY[item.category].color);
  card.dataset.itemId = item.id;
  card.innerHTML = `${iconHTML(item)}<strong>${escape(itemName(item))}</strong><small>${escape(otherName(item))}</small><small>${t(item.category)} · ${item.tier === 5 ? 'LEG' : `T${item.tier}`}</small><div class="hover-meta">${t('slotChance')}: ${percent(entry.probability)}</div>`;
  card.hidden = false;
}
function warmImages() {
  function redrawPairs() {
    for (const ticket of tickets.filter(entry => entry.combo)) {
      if (imageCache.has(ticket.id)) continue;
      const parts = ticket.components.map(item => imageCache.get(item.id));
      if (!parts.every(image => image?.complete && image.naturalWidth)) continue;
      const pair = document.createElement('canvas'); pair.width = 128; pair.height = 88;
      const context = pair.getContext('2d');
      context.drawImage(parts[0], 0, 12, 62, 62); context.drawImage(parts[1], 66, 12, 62, 62);
      context.fillStyle = '#edcf90'; context.font = '20px Georgia'; context.textAlign = 'center'; context.fillText('+', 64, 51);
      const image = new Image(); image.onload = () => { if (!spinning) drawWheel(); }; image.src = pair.toDataURL(); imageCache.set(ticket.id, image);
    }
    if (!spinning) drawWheel();
  }
  for (const item of items) {
    if (!item.icon) continue;
    const img = new Image();
    imageCache.set(item.id, img);
    img.onload = redrawPairs;
    img.src = iconURL(item);
  }
}
function renderResult(entry = currentResult(), animate = false) {
  const panel = $('.result-panel');
  panel.classList.toggle('has-result', Boolean(entry));
  if (!entry) {
    $('#result-content').innerHTML = `<div class="empty-result-art">✧<span>?</span></div><h3>${t('resultEmpty')}</h3><p>${t('resultEmptyCopy')}</p>`;
    return;
  }
  const item = itemById.get(entry.itemId);
  if (!item) return;
  const sealed = session.preferences.mode === 'build' && getLatestBuildEntries(viewSession().build).some(entry => entryIsSealed(entry));
  if (sealed) {
    panel.style.setProperty('--result-color', '#bd94c8');
    $('#result-content').innerHTML = `<div class="empty-result-art sealed-result-art">♛</div><h3>${t('sealedItem')}</h3><p>${t('sealedItemHint')}</p><div class="result-proof">${t('sealedByKing')}</div>`;
    return;
  }
  panel.style.setProperty('--result-color', CATEGORY[item.category].color);
  $('#result-content').innerHTML = `<div class="result-image-wrap">${iconHTML(item)}</div><div class="result-category">${t(`${item.category}Upper`)}</div><h3 class="result-name" title="${escape(otherName(item))}">${escape(itemName(item))}</h3><p>${escape(otherName(item))}</p><div class="result-meta"><span class="tier-badge">${item.tier === 5 ? t('legendaryUpper') : t('tierUpper', { tier: item.tier })}</span><span class="soul-dot">◈</span><span>${item.tier === 5 ? 'Street Brawl' : t('souls', { cost: currency(item.cost) })}</span></div><div class="result-probability">${t('resultChance')} <strong>${percent(entry.probability)}</strong></div><div class="result-proof">${t('excludedUntilReset')}</div>`;
  if (entry.consumed === false) $('#result-content .result-proof').textContent = t('rerollAvailable');
  if (entry.cursed) { $('#result-content .result-proof').textContent = t('cursedItem'); $('#result-content .result-proof').classList.add('is-cursed'); }
  if (item.combo) $('#result-content .result-category').textContent = t('pairsEnabled');
  if (animate) { panel.classList.remove('reveal'); requestAnimationFrame(() => panel.classList.add('reveal')); }
}
function renderHistory() {
  const history = visibleHistory();
  $('#history-count').textContent = String(history.length).padStart(2, '0');
  $('#history-list').innerHTML = history.length ? [...history].reverse().map((entry, index) => {
    const item = itemById.get(entry.itemId);
    const time = new Date(entry.time).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hour12: false });
    const badges = fateBadgesHTML(entry, session.preferences.language, { sealed: entryIsSealed(entry), compact: true });
    if (entryIsSealed(entry)) return `<div class="history-entry is-sealed" title="${escape(t('sealedItemHint'))}"><span class="history-number">${String(history.length - index).padStart(2, '0')}</span><span class="history-icon history-seal" aria-hidden="true">♛${badges}</span><span class="history-copy"><strong>${t('sealedItem')}</strong><small>${t('sealedByKing')}</small></span><span class="history-time">${escape(time)}</span></div>`;
    return `<div class="history-entry${entry.cursed ? ' is-cursed' : ''}" data-item="${item.id}" title="${escape(entry.cursed ? t('cursedItem') : otherName(item))}"><span class="history-number">${String(history.length - index).padStart(2, '0')}</span><span class="history-icon">${iconHTML(item)}${entry.cursed ? '<b class="history-lock" aria-label="Locked">🔒</b>' : ''}${badges}</span><span class="history-copy"><strong>${escape(itemName(item))}</strong><small>${t(item.category)} · ${item.tier === 5 ? 'LEG' : `T${item.tier}`} · ${percent(entry.probability)}</small></span><span class="history-time">${escape(time)}</span></div>`;
  }).join('') : `<p class="history-empty">${t('historyEmpty')}</p>`;
  $$('.history-entry').forEach(el => el.style.setProperty('--category-color', el.dataset.item ? CATEGORY[itemById.get(el.dataset.item).category].color : '#b495c4'));
}
function renderCatalog() {
  const search = $('#search').value.toLocaleLowerCase(locale()).trim();
  const tier = $('#catalog-tier').value;
  const status = $('#catalog-status').value;
  const hidden = secretContext();
  const drawn = new Set(visibleHistory().filter(entry => !entryIsSealed(entry)).map(entry => entry.itemId));
  const available = new Map(hidden ? [] : distribution.items.map(entry => [entry.item.id, entry]));
  const excluded = new Set(session.settings.excludedIds);
  const filtered = items.filter(item => (catalogCategory === 'all' || item.category === catalogCategory)
    && (tier === 'all' || item.tier === Number(tier))
    && (!search || `${item.name} ${item.nameRu || ''}`.toLocaleLowerCase(locale()).includes(search))
    && (status === 'all' || status === 'drawn' && drawn.has(item.id) || status === 'excluded' && excluded.has(item.id) || status === 'available' && (hidden ? !drawn.has(item.id) && !excluded.has(item.id) : available.has(item.id))));
  $('#catalog-count').textContent = `${filtered.length} / ${items.length}`;
  $('#catalog-grid').innerHTML = filtered.length ? filtered.map(item => {
    const isDrawn = drawn.has(item.id), isExcluded = excluded.has(item.id);
    return `<button class="catalog-card${isDrawn ? ' is-drawn' : ''}${isExcluded ? ' is-excluded' : ''}" data-item="${item.id}" title="${escape(itemName(item))} / ${escape(otherName(item))}${isDrawn ? ` · ${t('alreadyDrawn')}` : isExcluded ? ` · ${t('itemExcluded')}` : ''}"><span class="catalog-icon">${iconHTML(item)}</span><span class="catalog-copy"><strong>${escape(itemName(item))}</strong><small><b>${item.tier === 5 ? 'LEG' : `T${item.tier}`}</b> ${item.tier === 5 ? 'Street Brawl' : `${currency(item.cost)} ◈`}${available.has(item.id) ? ` · ${percent(available.get(item.id).probability)}` : ''}</small></span><span class="catalog-state">${isDrawn ? '✓' : isExcluded ? '×' : ''}</span></button>`;
  }).join('') : `<div class="catalog-no-results">${t('noResults')}</div>`;
  $$('.catalog-card').forEach(el => { el.style.setProperty('--category-color', CATEGORY[itemById.get(el.dataset.item).category].color); el.disabled = spinning; });
}
function render({ preserveWheel = false, preserveResult = false, beforeHistory, beforePurchasePlan } = {}) {
  if (!buildMode?.busy) updateHeroTheme();
  distribution = getDistribution();
  renderControls(); renderStats(); renderHistory(); renderCatalog();
  if (!preserveResult) renderResult();
  if (!preserveWheel) { hideWheelHover(); wheelEntries = buildWheel(distribution.items); }
  drawWheel();
  buildMode?.render({ spinning, beforeHistory, beforePurchasePlan });
}
function renderChoosing() {
  $('#result-content').innerHTML = `<div class="empty-result-art">✦</div><h3>${t('choosing')}</h3><p>${t('choosingCopy')}</p>`;
}
function setControlsDisabled(disabled) {
  $$('.controls button,.controls input,.catalog-card,#import-button').forEach(el => el.disabled = disabled);
  $$('button[data-mode]').forEach(el => el.disabled = disabled);
}
async function animateWheelStep(step) {
  const selected = wheelEntries.find(entry => entry.item.id === step.ticket.id);
  const from = rotation;
  const landingAngle = selected.start + (selected.end - selected.start) * (.25 + randomUnitInterval() * .5);
  const desired = (TAU - landingAngle) % TAU;
  const delta = ((desired - from % TAU) + TAU) % TAU;
  const quick = session.preferences.quick || prefersReducedMotion;
  const to = from + (quick ? 2 : 7) * TAU + delta;
  const duration = prefersReducedMotion ? 120 : quick ? 950 : 5100;
  const started = performance.now();
  let previousRotation = from;
  lastTick = -Infinity;
  await new Promise(resolve => {
    function frame(now) {
      const progress = Math.min(1, (now - started) / duration);
      rotation = from + (to - from) * (1 - (1 - progress) ** 5);
      drawWheel();
      const crossings = countBoundaryCrossings(previousRotation, rotation, wheelEntries);
      previousRotation = rotation;
      if (crossings > 0 && now - lastTick >= 55) { audio.tick(); lastTick = now; }
      if (progress < 1) requestAnimationFrame(frame); else resolve();
    }
    requestAnimationFrame(frame);
  });
  rotation %= TAU;
  audio.impact('item', step.ticket.category);
}

async function curseAccent() {
  audio.curse();
  if (session.preferences.mode === 'build' && buildMode?.flashCurse) return buildMode.flashCurse();
  const veil = document.createElement('div'); veil.className = 'curse-veil';
  veil.innerHTML = `<span>⌁</span><strong>${escape(t('curseTriggered'))}</strong><small>${escape(t('curseDescription'))}</small>`;
  effectLayer.append(veil);
  const timing = curseTiming({ quick: session.preferences.quick, reducedMotion: prefersReducedMotion });
  veil.dataset.reducedMotion = String(prefersReducedMotion);
  void veil.offsetWidth;
  try {
    for (const phase of ['appear', 'hold', 'disappear']) {
      veil.style.setProperty('--curse-phase-ms', `${timing[phase]}ms`);
      veil.dataset.phase = phase;
      await new Promise(resolve => setTimeout(resolve, timing[phase]));
    }
  } finally { veil.remove(); }
}

async function playDrawPlan(plan) {
  const inBuild = session.preferences.mode === 'build';
  const previous = session;
  session = plan.session;
  if (!save()) { session = previous; return false; }
  spinning = true; audio.unlock(); hideWheelHover(); setControlsDisabled(true);
  let firstDraw = true, fullRerollOmen = false;
  try {
    const timeline = plan.timeline || plan.steps.map(step => ({ type: 'draw', step }));
    for (const presentation of timeline) {
      if (presentation.type === 'event') {
        const { event } = presentation;
        visualSession = event.before; pendingVisibleHistory = null;
        render({ beforeHistory: event.before.build.history, beforePurchasePlan: event.before.build.purchasePlan });
        await buildMode?.showFateEvent(event, { onSound: kind => audio.fate(kind), onConfirm: () => confirmChicken(event.id) });
        visualSession = event.after;
        render({ beforeHistory: event.after.build.history, beforePurchasePlan: event.after.build.purchasePlan });
        continue;
      }
      const { step } = presentation;
      if (step.cursed && (!step.fullReroll || !fullRerollOmen)) {
        await curseAccent();
        if (step.fullReroll) fullRerollOmen = true;
      }
      visualSession = step.after;
      pendingVisibleHistory = inBuild ? step.before.build.history : step.before.history;
      distribution = step.distribution;
      wheelEntries = buildWheel(distribution.items);
      renderControls(); renderStats(); renderHistory(); renderCatalog(); renderChoosing();
      buildMode?.render({ spinning, beforeHistory: inBuild ? step.before.build.history : undefined,
        beforePurchasePlan: inBuild ? step.before.build.purchasePlan : undefined });
      const sealed = inBuild && getLatestBuildEntries(step.after.build).some(entry => isBuildEntrySealed(step.after.build, entry, items));
      if (inBuild) {
        const reveal = step.archmotherSelected ? buildMode.revealArchmotherGift : buildMode.animateItem;
        await reveal({ winner: step.ticket, candidates: step.distribution.items,
          beforeHistory: step.before.build.history, beforePurchasePlan: step.before.build.purchasePlan,
          latestDrawId: step.entry.drawId, scroll: firstDraw, cursed: step.cursed, sealed, fastReveal: Boolean(step.fullReroll),
          onTick: () => audio.tick(), onImpact: () => audio.impact('item', sealed ? 'spirit' : step.ticket.category) });
      } else await animateWheelStep(step);
      firstDraw = false;
      pendingVisibleHistory = null;
      renderHistory(); renderCatalog(); renderResult(step.entry, !inBuild);
      audio.victory();
      if (inBuild) {
        if (!sealed) buildMode?.showInventoryChanges?.(step.changes);
        resultAccents($('#build-item-scanner'), sealed || step.cursed ? '#ca6ae9' : CATEGORY[step.ticket.category].color);
      }
    }
  } finally {
    visualSession = null; pendingVisibleHistory = null; spinning = false;
    setControlsDisabled(false);
    render({ preserveWheel: !inBuild, preserveResult: true }); renderResult();
    if (inBuild && buildIsFull()) revealCompleteBuild();
    $('#history-list').scrollTop = 0;
  }
  const shortage = plan.events?.find(event => event.type === 'chicken-limited-pool');
  if (shortage) toast(t('chickenLimitedPool', { count: shortage.slotCount }));
  else if (plan.curseUnavailable) toast(t('curseNoRoom'));
  return true;
}

function confirmChicken(eventId) {
  const previous = session.build;
  session.build = acknowledgeBuildChicken(previous, eventId);
  if (!save()) { session.build = previous; return false; }
  return true;
}

async function resumePendingChicken() {
  if (spinning || offerBusy || buildMode?.busy || session.preferences.mode !== 'build') return;
  const record = getPendingChickenEvent(session.build, items);
  if (!record) return;
  spinning = true; audio.unlock(); setControlsDisabled(true); render();
  try {
    await buildMode.showFateEvent({ ...record, type: 'chicken', journalReplay: true, before: structuredClone(session), after: structuredClone(session) },
      { onSound: kind => audio.fate(kind), onConfirm: () => confirmChicken(record.id) });
  } finally {
    spinning = false; setControlsDisabled(false); render();
  }
  await continuePendingFates();
}

async function continuePendingFates() {
  if (spinning || offerBusy || buildMode?.busy || session.preferences.mode !== 'build') return;
  if (session.build.fate.pendingChicken) return resumePendingChicken();
  if (session.build.fate.pendingKing) return continueKingContract();
  if (session.build.fate.pendingArchmother) return continueArchmotherOffer();
}

async function continueKingContract() {
  if (spinning || offerBusy || buildMode?.busy || session.preferences.mode !== 'build' || !session.build.fate.pendingKing) return;
  offerBusy = true; audio.unlock(); setControlsDisabled(true); renderStats();
  let choice;
  try { choice = await buildMode.showKingOffer(session.build.fate.pendingKing); }
  finally { offerBusy = false; setControlsDisabled(false); renderStats(); }
  if (!choice) return;
  let plan;
  try { plan = planResolveKingContract(session, items, choice); }
  catch (error) { console.error('Royal contract failed', error); toast(t('randomFailed')); return; }
  if (plan && await playDrawPlan(plan)) await continuePendingFates();
}

async function continueArchmotherOffer({ announce = true } = {}) {
  if (spinning || offerBusy || buildMode?.busy || session.preferences.mode !== 'build' || !session.build.fate.pendingArchmother) return;
  offerBusy = true; audio.unlock(); setControlsDisabled(true); renderStats();
  if (announce) audio.fate('archmother');
  let chosen;
  try { chosen = await buildMode.showArchmotherOffer(session.build.fate.pendingArchmother); }
  finally { offerBusy = false; setControlsDisabled(false); renderStats(); }
  if (!chosen) return;
  let plan;
  try { plan = resolveArchmotherOffer(session, items, chosen); }
  catch (error) { console.error('Archmother choice failed', error); toast(t('randomFailed')); return; }
  if (plan && await playDrawPlan(plan)) await continuePendingFates();
}

async function spin(action = 'draw') {
  if (spinning || offerBusy || buildMode?.busy || document.querySelector('dialog[open]')) return;
  const inBuild = session.preferences.mode === 'build';
  if (inBuild && !session.build.heroId) { toast(t('buildMissingHero')); return; }
  if (inBuild && session.build.fate.pendingChicken) return resumePendingChicken();
  if (inBuild && session.build.fate.pendingKing) return continueKingContract();
  if (inBuild && session.build.fate.pendingArchmother) return continueArchmotherOffer();
  let plan;
  try { plan = inBuild ? planBuildFateDraw(session, items, action) : planDrawSequence(session, items, action); }
  catch (error) { console.error('Draw sequence failed', error); toast(t('randomFailed')); return; }
  if (!plan) { toast(t('noAvailable')); return; }
  if (await playDrawPlan(plan)) await continuePendingFates();
}

function openItem(id) {
  if (spinning || offerBusy) return;
  const item = itemById.get(id); if (!item) return;
  focusedItemId = id;
  const drawn = drawnIds().has(id), excluded = session.settings.excludedIds.includes(id);
  const entry = distribution.items.find(candidate => candidate.item.id === id);
  const detail = secretContext() ? t('sealedCatalogHint') : drawn ? t('drawnDetail') : excluded ? t('excludedDetail') : entry ? t('chanceDetail', { chance: percent(entry.probability), weight: currency(entry.weight) }) : t('inactiveDetail');
  const rawDescription = session.preferences.language === 'en' ? item.description : item.descriptionRu || item.description;
  const description = new DOMParser().parseFromString(rawDescription || '', 'text/html').body.textContent;
  $('#item-detail').innerHTML = `<div class="item-dialog-heading"><span class="catalog-icon">${iconHTML(item)}</span><div><div class="eyebrow">${t(`${item.category}Upper`)} · ${item.tier === 5 ? t('legendaryUpper') : `T${item.tier}`}${item.active ? ` · ${t('active')}` : ''}</div><h2>${escape(itemName(item))}</h2><p>${escape(otherName(item))}</p></div></div><p>${escape(description || t('noDescription'))}</p><div class="item-detail-row"><span>${t(item.tier === 5 ? 'gameMode' : 'componentCost')}</span><strong>${item.tier === 5 ? 'Street Brawl' : `${currency(item.cost)} ◈`}</strong></div><div class="item-detail-row"><span>${t('itemMultiplier')}</span>${weightControl('itemWeights', item.id, session.settings.itemWeights[item.id] ?? 1)}</div><p>${detail}</p><div class="item-detail-actions"><button class="secondary-button" id="exclude-item">${t(excluded ? 'returnItem' : 'excludeItem')}</button><button class="primary-button" data-close>${t('done')}</button></div>`;
  $('#item-detail').style.setProperty('--category-color', CATEGORY[item.category].color);
  if (!$('#item-dialog').open) $('#item-dialog').showModal();
}
function exportSession() {
  const text = serializeSession(session);
  if (window.deadlock) return window.deadlock.exportJSON(text, session.preferences.language).then(name => { if (name) toast(t('sessionSaved', { name })); }).catch(error => toast(localizedError(error)));
  const blob = new Blob([text], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `deadlock-session-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function importSession(text) {
  if (spinning || buildMode?.busy) return;
  try {
    const imported = parseSessionJSON(text, items); audio.stopHeroVoice(); session = imported; save(); rotation = 0;
    applyLanguage(); audio.setPreferences(session.preferences); activateMode(session.preferences.mode);
    applyZoom(session.preferences.zoomFactor, { persist: false }); toast(t('sessionLoaded'));
  } catch(error) { toast(t('importFailed', { error: localizedError(error) })); }
}

document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  if (button.hasAttribute('data-close')) { button.closest('dialog')?.close(); return; }
  if (button.dataset.mode) return activateMode(button.dataset.mode);
  if (button.dataset.toggleCategory) return updateSettings(settings => toggleArray(settings.enabledCategories, button.dataset.toggleCategory));
  if (button.dataset.toggleTier) {
    if (session.preferences.mode === 'build') return updateBuildSettings(build => toggleArray(build.enabledTiers, Number(button.dataset.toggleTier)));
    return updateSettings(settings => toggleArray(settings.enabledTiers, Number(button.dataset.toggleTier)));
  }
  if (button.dataset.step) {
    updateSettings(settings => { const key = button.dataset.key, kind = button.dataset.kind; settings[kind][key] = Math.min(100, Math.max(0, (settings[kind][key] ?? 1) + Number(button.dataset.step))); });
    if (button.closest('#item-dialog')) { $('#item-dialog').close(); openItem(focusedItemId); }
    return;
  }
  if (button.dataset.preset) {
    const values = { classic: [4, 3, 2, 1], equal: [1, 1, 1, 1], luxury: [1, 2, 3, 4] }[button.dataset.preset];
    return updateSettings(settings => values.forEach((weight, index) => { settings.tierWeights[index + 1] = weight; }));
  }
  if (button.closest('#catalog-categories')) {
    catalogCategory = button.dataset.category; $$('#catalog-categories button').forEach(el => el.classList.toggle('active', el === button)); renderCatalog(); return;
  }
  if (button.classList.contains('catalog-card')) return openItem(button.dataset.item);
  if (button.id === 'exclude-item') {
    updateSettings(settings => toggleArray(settings.excludedIds, focusedItemId)); $('#item-dialog').close(); openItem(focusedItemId);
  }
});
document.addEventListener('change', event => {
  const input = event.target;
  if (input.matches('.weight-stepper input')) {
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) { input.value = session.settings[input.dataset.kind][input.dataset.key] ?? 1; return; }
    updateSettings(settings => { settings[input.dataset.kind][input.dataset.key] = Math.min(100, Math.max(0, value)); });
    if (input.closest('#item-dialog')) { $('#item-dialog').close(); openItem(focusedItemId); }
  }
});
$('#spin-button').addEventListener('click', () => spin());
for (const action of ['reroll', 'upgrade', 'downgrade']) $(`#${action}-button`).addEventListener('click', () => spin(action));
$('#catalog-toggle-button').addEventListener('click', () => { session.preferences.catalogVisible = !session.preferences.catalogVisible; save(); renderViewPreferences(); });
$('#curse-chance').addEventListener('input', event => setSpecialRule('curseChance', Number(event.target.value) / 100));
$('#pairs-enabled').addEventListener('change', event => setSpecialRule('pairsEnabled', event.target.checked));
for (const kind of ['music', 'sound', 'ui', 'voice']) {
  $(`#${kind}-volume`).addEventListener('input', event => {
    session.preferences[`${kind}Volume`] = Math.min(1, Math.max(0, Number(event.target.value) / 100));
    $(`#${kind}-volume-value`).textContent = `${event.target.value}%`;
    audio.setPreferences(session.preferences);
    save();
  });
}
$('#sound-style').addEventListener('change', event => { session.preferences.soundStyle = event.target.value; audio.setPreferences(session.preferences); save(); });
$('#music-track').addEventListener('change', event => { session.preferences.musicTrack = event.target.value; audio.setPreferences(session.preferences); audio.unlock(); save(); });
$('#sound-preview').addEventListener('click', () => { if (!audio.preview(session.preferences.soundStyle)) toast(t('soundPreviewMuted')); });
$('#voice-button').addEventListener('click', () => {
  session.preferences.voices = !session.preferences.voices;
  audio.setPreferences(session.preferences); save(); renderViewPreferences();
});
document.addEventListener('click', event => { if (!event.target.closest('#audio-settings')) $('#audio-settings').open = false; });
canvas.addEventListener('pointermove', event => {
  if (spinning) return;
  const bounds = canvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width * canvas.width - canvas.width / 2;
  const y = (event.clientY - bounds.top) / bounds.height * canvas.height - canvas.height / 2;
  const index = slotAtPoint(wheelEntries, rotation, x, y, canvas.width * .182, canvas.width * .447);
  if (index !== hoveredIndex) {
    hoveredIndex = index;
    if (index >= 0) renderHoverCard(); else hideWheelHover();
    drawWheel();
  }
  if (index >= 0) {
    const card = $('#wheel-hover-card');
    card.style.left = `${Math.max(8, Math.min(bounds.width - card.offsetWidth - 8, event.clientX - bounds.left + 14))}px`;
    card.style.top = `${Math.max(8, Math.min(bounds.height - card.offsetHeight - 8, event.clientY - bounds.top + 14))}px`;
  }
});
canvas.addEventListener('pointerleave', () => { hideWheelHover(); drawWheel(); });
$('#zoom-out-button').addEventListener('click', () => stepZoom(-1));
$('#zoom-in-button').addEventListener('click', () => stepZoom(1));
$('#zoom-select').addEventListener('change', event => applyZoom(Number(event.target.value)));
$('#reset-button').addEventListener('click', () => $('#reset-dialog').showModal());
$('#confirm-reset').addEventListener('click', () => {
  if (spinning || buildMode?.busy) return;
  if (session.preferences.mode === 'build') {
    session.build = createBuildState({ ...session.build, history: [], purchasePlan: [], itemActions: createItemActionState(), discardedItemIds: [], consumedTicketIds: [], latestDrawId: null, inventoryUndo: [], nextAcquiredOrder: 0, fate: {} });
  } else { session.history = []; session.rouletteResult = null; session.itemActions = createItemActionState(); }
  save(); rotation = 0; render(); $('#reset-dialog').close(); toast(t('sessionReset'));
});
$('#sound-button').addEventListener('click', () => { session.preferences.sound = !session.preferences.sound; audio.setPreferences(session.preferences); audio.unlock(); save(); renderStats(); if (session.preferences.sound) audio.tick(); });
$('#music-button').addEventListener('click', () => { session.preferences.music = !session.preferences.music; audio.setPreferences(session.preferences); audio.unlock(); save(); renderStats(); });
$('#ui-sound-button').addEventListener('click', () => {
  session.preferences.uiSound = !session.preferences.uiSound;
  audio.setPreferences(session.preferences); save(); renderViewPreferences();
  if (session.preferences.uiSound) audio.ui('toggle');
});
$('#language-button').addEventListener('click', () => {
  session.preferences.language = session.preferences.language === 'en' ? 'ru' : 'en';
  save(); applyLanguage();
  // Keep the existing sectors and rotation, including while the wheel is moving.
  renderControls(); renderStats(); renderHistory(); renderCatalog(); drawWheel();
  if (spinning) { renderChoosing(); setControlsDisabled(true); } else renderResult();
  if ($('#item-dialog').open) openItem(focusedItemId);
});
$('#speed-button').addEventListener('click', () => { session.preferences.quick = !session.preferences.quick; save(); renderStats(); toast(t(session.preferences.quick ? 'quickEnabled' : 'quickDisabled')); });
$('#fullscreen-button').addEventListener('click', async () => {
  try { if (window.deadlock) await window.deadlock.toggleFullscreen(); else if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { toast(t('fullscreenFailed')); }
});
$('#help-button').addEventListener('click', () => $('#help-dialog').showModal());
$('#weights-help').addEventListener('click', () => $('#help-dialog').showModal());
$('#search').addEventListener('input', renderCatalog);
$('#catalog-tier').addEventListener('change', renderCatalog);
$('#catalog-status').addEventListener('change', renderCatalog);
$('#export-button').addEventListener('click', exportSession);
$('#import-button').addEventListener('click', async () => {
  if (spinning) return;
  if (!window.deadlock) return $('#import-file').click();
  try { const text = await window.deadlock.importJSON(session.preferences.language); if (text) importSession(text); } catch(error) { toast(localizedError(error)); }
});
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 2 * 1024 * 1024) toast(t('sessionTooLarge')); else importSession(await file.text());
  event.target.value = '';
});
document.addEventListener('keydown', event => {
  if (event.ctrlKey && !event.altKey && !event.metaKey) {
    if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') { event.preventDefault(); stepZoom(1); return; }
    if (event.key === '-' || event.code === 'NumpadSubtract') { event.preventDefault(); stepZoom(-1); return; }
    if (event.key === '0' || event.code === 'Numpad0') { event.preventDefault(); applyZoom(1); return; }
  }
  const editable = event.target.closest('input,textarea,select,[contenteditable=true]');
  if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); session.preferences.catalogVisible = true; save(); renderViewPreferences(); $('#search').focus(); $('#search').scrollIntoView({ block: 'center' }); }
  if (event.code === 'Space' && !editable && !event.repeat && !document.querySelector('dialog[open]') && !event.target.closest('button,summary')) { event.preventDefault(); spin(); }
});
document.addEventListener('wheel', event => {
  if (!event.ctrlKey || !event.deltaY) return;
  event.preventDefault();
  if (event.deltaY < 0) stepZoom(1); else stepZoom(-1);
}, { passive: false });
$$('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
}));
document.addEventListener('error', event => { if (event.target instanceof HTMLImageElement) event.target.hidden = true; }, true);
window.addEventListener('deadlock-audio-error', () => toast(t('musicFailed')));
buildMode = createBuildMode({
  root: $('#build-mode'), heroes: heroCatalog.heroes, items, rules: heroCatalog.rules,
  getState: () => viewSession().build, getLanguage: () => session.preferences.language, getQuick: () => session.preferences.quick,
  getContracts: () => session.contracts,
  getBuildDistribution: () => calculateBuildDistribution(items, session.settings, viewSession().build, { pairsEnabled: session.preferences.pairsEnabled }),
  getCurseChance: () => session.preferences.curseChance * 100,
  onCurseChanceChange: value => setSpecialRule('curseChance', Math.min(1, Math.max(0, Number(value) / 100))),
  getPairsEnabled: () => session.preferences.pairsEnabled,
  onPairsEnabledChange: value => setSpecialRule('pairsEnabled', Boolean(value)),
  getFatePreferences: () => ({ chickenChance: session.preferences.chickenChance, archmotherChance: session.preferences.archmotherChance, hiddenKingChance: session.preferences.hiddenKingChance }),
  onFatePreferenceChange: (key, value) => setSpecialRule(key, Math.min(1, Math.max(0, Number(value)))),
  async onRevealNextPurchase() {
    if (spinning || offerBusy || buildMode?.busy) return false;
    const opening = getNextSealedPurchase(session.build, items);
    const previous = session.build;
    session.build = revealNextSealedPurchase(session.build, items);
    if (!save()) { session.build = previous; return false; }
    render(); audio.fate('reveal');
    if (opening?.kingOrigin) await buildMode.flashRoyalReveal?.(opening, { onSound: kind => audio.fate(kind) });
    return true;
  },
  onChooseArchmother: () => continueArchmotherOffer(),
  async onRequestNewspaper({ build = session.build, contract = null } = {}) {
    if (spinning || offerBusy || buildMode?.busy || !build.heroId) return;
    const hero = heroCatalog.heroes.find(hero => hero.id === build.heroId);
    try { await showBuildNewspaper({ build: structuredClone(build), hero, items, art: getHeroArt(hero), language: session.preferences.language, contract }); }
    catch (error) { console.error('Newspaper failed', error); toast(t('newspaperFailed')); }
  },
  getItemCandidates: () => getDistribution().items.map(entry => entry.item),
  getArchmotherCandidates: () => calculateBuildDistribution(items, session.settings, { ...viewSession().build,
    fate: { ...viewSession().build.fate, pendingArchmother: null, pendingChicken: null } }, { pairsEnabled: false }).items.map(entry => entry.item),
  onArchmotherTick: ({ landed }) => landed ? audio.impact('item', 'spirit') : audio.tick(),
  getKingAvailability: () => getKingContractAvailability(session, items),
  onChooseKing: () => continueKingContract(),
  commit(mutator) {
    mutator(session.build); session.build = createBuildState(session.build); save();
    if (session.preferences.mode === 'build' && !spinning) {
      distribution = getDistribution(); renderControls(); renderStats(); renderCatalog();
      setControlsDisabled(Boolean(buildMode?.busy));
    }
  },
  onHeroBusyChange() {
    if (buildMode?.busy) { audio.unlock(); audio.stopHeroVoice(); }
    renderStats(); setControlsDisabled(spinning || Boolean(buildMode?.busy));
  },
  onHeroTick: () => audio.tick(),
  onHeroImpact: () => audio.impact('hero'),
  onHeroReveal(hero) { updateHeroTheme(hero); audio.victory(); audio.playHeroVoice(hero.id); resultAccents($('#build-hero-card'), getHeroArt(hero)?.color || '#c8ace1'); },
  onAbilityReveal(ability, index) { audio.abilityImpact(index); },
  onRequestItemSpin: spin,
  onRequestItemAction: action => spin(action),
  getItemActionAvailability: () => itemActionAvailability(true),
  async onExportPoster() {
    if (spinning || buildMode?.busy || !session.build.heroId) return;
    const hero = heroCatalog.heroes.find(hero => hero.id === session.build.heroId);
    try { await showContractPoster({ build: structuredClone(session.build), hero, items, art: getHeroArt(hero), language: session.preferences.language }); }
    catch { toast(t('posterFailed')); }
  },
  onUndoBuildItem() {
    if (spinning || buildMode?.busy || !session.build.history.length) return false;
    const previous = session.build;
    const restored = undoBuildDraw(session.build);
    if (!restored) { toast(t('cursedItem')); return false; }
    session.build = restored;
    if (!save()) { session.build = previous; return false; }
    effectLayer.querySelectorAll('.contract-seal').forEach(seal => seal.remove());
    render(); audio.ui('close'); toast(t('buildItemUndone'));
    return true;
  },
  onUpdateContract(id, review) {
    if (spinning || buildMode?.busy || !session.contracts.some(contract => contract.id === id)) return false;
    const previous = session.contracts;
    session.contracts = updateContractReview(session.contracts, id, review);
    if (!save()) { session.contracts = previous; return false; }
    buildMode.render(); audio.ui('success'); toast(t('contractReviewSaved'));
    return true;
  },
  onSaveContract(name, { rating = 0, comment = '' } = {}) {
    if (spinning || buildMode?.busy || !session.build.heroId) return false;
    const previousContracts = session.contracts;
    const previousName = session.build.name;
    try {
      const hero = heroCatalog.heroes.find(hero => String(hero.id) === session.build.heroId);
      const fallbackName = `${session.preferences.language === 'ru' ? hero?.nameRu || hero?.name : hero?.name} · ${new Date().toLocaleDateString(locale())}`;
      session.contracts = saveContract(session.contracts, session.build, normalizeContractName(name) || fallbackName, { id: crypto.randomUUID(), savedAt: Date.now(), rating, comment });
      session.build.name = session.contracts[0].name;
      if (!save()) { session.contracts = previousContracts; session.build.name = previousName; return false; }
      buildMode.render();
      toast(t('contractSaved', { name: session.build.name }));
      audio.ui('success'); resultAccents($('#build-contract-save'), '#dfc28b');
      return true;
    } catch { toast(t('contractLimit')); return false; }
  },
  onLoadContract(id) {
    if (spinning || buildMode?.busy) return false;
    const contract = session.contracts.find(contract => contract.id === id);
    if (!contract) return false;
    if (!heroCatalog.heroes.some(hero => hero.id === contract.build.heroId)) { toast(t('contractUnavailable')); return false; }
    const previousBuild = session.build;
    session.build = createSession({ ...session, build: replayContract(contract, session.build) }, items).build;
    if (!save()) { session.build = previousBuild; return false; }
    audio.stopHeroVoice();
    rotation = 0; render();
    $('#build-mode').scrollIntoView({ behavior: prefersReducedMotion ? 'instant' : 'smooth', block: 'start' });
    toast(t('contractLoaded', { name: contract.name }));
    queueMicrotask(() => continuePendingFates());
    return true;
  },
  onDeleteContract(id) {
    if (spinning || buildMode?.busy) return false;
    const previousContracts = session.contracts;
    session.contracts = session.contracts.filter(contract => contract.id !== id);
    if (!save()) { session.contracts = previousContracts; return false; }
    buildMode.render();
    return true;
  },
  onNewBuild() {
    if (spinning || buildMode?.busy) return;
    audio.stopHeroVoice();
    effectLayer.querySelectorAll('.contract-seal').forEach(seal => seal.remove());
    session.build = createBuildState({ excludedHeroIds: session.build.excludedHeroIds, enabledTiers: session.build.enabledTiers, dynamicWeights: session.build.dynamicWeights });
    save(); rotation = 0; render();
  },
});
applyLanguage(); audio.setPreferences(session.preferences);
activateMode(session.preferences.mode); warmImages();
applyZoom(session.preferences.zoomFactor, { persist: false });
if (storageFailed) toast(t('storageDamaged'));
