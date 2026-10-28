// Exercise the portable executable, or its source runtime, via local Chromium CDP.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const sourceMode = process.argv.includes('--source');
const rulesOnly = process.argv.includes('--rules-only');
const executable = sourceMode
  ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(root, 'dist', 'Deadlock Roulette.exe');
const profile = path.join(root, '.smoke-data', `profile-${Date.now()}`);
const screenshot = path.join(root, '.smoke-data', 'desktop-result.png');
const buildScreenshot = path.join(root, '.smoke-data', 'desktop-build.png');
const nativeBuildScreenshot = path.join(root, '.smoke-data', 'desktop-build-native.png');
const contractPreviewScreenshot = path.join(root, '.smoke-data', 'desktop-contract-preview.png');
const contractPosterScreenshot = path.join(root, '.smoke-data', 'desktop-contract-poster.png');
const screenshot2K = path.join(root, '.smoke-data', 'desktop-2k.png');
const port = 9300 + process.pid % 500;
const processLogPath = path.join(root, '.smoke-data', 'native-process.log');
let launchCount = 0;
let phase = 'initialization';
function mark(name, details = {}) {
  phase = name;
  const line = JSON.stringify({ phase, ...details });
  console.log(line);
  fs.appendFile(processLogPath, `${new Date().toISOString()} ${line}\n`).catch(() => {});
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function assertNoErrors(failures) {
  const details = [...new Set(failures)].slice(0, 3).join('\n');
  assert.equal(failures.length, 0, `The bundled UI should run without JavaScript or resource errors.\n${details}`);
}
await fs.mkdir(profile, { recursive: true });
await fs.access(executable);

async function launch() {
  const debugPort = port + ++launchCount * 503;
  mark('launch', { launch: launchCount, port: debugPort, profile });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [
    ...(sourceMode ? [root] : []),
    '--smoke-test', `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`,
  ], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  const processLog = createWriteStream(processLogPath, { flags: 'a' });
  child.stdout.pipe(processLog, { end: false }); child.stderr.pipe(processLog, { end: false });
  child.once('close', () => processLog.end());
  let exited = false;
  let spawnError;
  child.once('error', error => { spawnError = error; });
  let exitDetails;
  child.on('exit', (code, signal) => { exited = true; exitDetails = { code, signal, pid: child.pid }; mark('process-exit', exitDetails); });
  let page;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((entry) => entry.type === 'page' && entry.url.includes('index.html'));
      if (page) break;
    } catch { /* The portable launcher may still be extracting its runtime. */ }
    if (exited) throw new Error('Portable executable exited before the UI loaded.');
    await sleep(200);
  }
  assert.ok(page, 'Packaged application should expose its loaded UI');
  mark('target-ready', { pid: child.pid, port: debugPort, target: page.id });
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const pending = new Map();
  const eventWaiters = new Map();
  const failures = [];
  let connectionDiagnostics = Promise.resolve();
  let nextId = 1;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const promise = pending.get(message.id);
      if (!promise) return;
      pending.delete(message.id);
      clearTimeout(promise.timeout);
      if (message.error) promise.reject(new Error(message.error.message));
      else promise.resolve(message.result);
    } else {
      for (const waiter of eventWaiters.get(message.method) || []) { clearTimeout(waiter.timeout); waiter.resolve(message.params); }
      eventWaiters.delete(message.method);
      if (message.method === 'Runtime.exceptionThrown') failures.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') failures.push(message.params.entry.text);
    }
  });
  socket.addEventListener('close', event => {
    const interruptedPhase = phase;
    mark('debug-socket-close', { code: event.code, reason: event.reason, during: interruptedPhase, exited, exitDetails, pending: [...pending.values()].map(promise => promise.method) });
    connectionDiagnostics = fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(1500) })
      .then(response => response.json()).then(targets => mark('post-disconnect-targets', { targets: targets.map(target => ({ id: target.id, type: target.type, url: target.url })) }))
      .catch(error => mark('post-disconnect-endpoint', { error: error.message }));
    for (const promise of pending.values()) {
      clearTimeout(promise.timeout);
      promise.reject(new Error(`Application closed its debugging connection during ${interruptedPhase}; process ${child.pid}, port ${debugPort}, exit ${JSON.stringify(exitDetails || null)}.`));
    }
    pending.clear();
    for (const waiters of eventWaiters.values()) for (const waiter of waiters) { clearTimeout(waiter.timeout); waiter.reject(new Error('Application closed before its navigation completed.')); }
    eventWaiters.clear();
  });
  socket.addEventListener('error', event => mark('debug-socket-error', { message: event.message, error: event.error?.message, stack: event.error?.stack }));
  function call(method, params = {}) {
    if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`Application debugging connection is unavailable for ${method}.`));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chromium command timed out: ${method}`));
      }, 15_000);
      pending.set(id, { resolve, reject, timeout, method });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function until(expression, timeout = 15_000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return;
      await sleep(100);
    }
    throw new Error(`UI did not reach expected state: ${expression}`);
  }
  async function reload() {
    mark('reload-start', { pid: child.pid, port: debugPort });
    // Subscribe before dispatching navigation. Evaluating a readiness condition
    // immediately after Page.reload can otherwise succeed against the old page.
    const marker = `navigation-${nextId}-${Date.now()}`;
    await evaluate(`window.__smokeNavigationMarker = ${JSON.stringify(marker)}`);
    let waiter;
    const loaded = new Promise((resolve, reject) => {
      waiter = { resolve, reject, timeout: setTimeout(() => reject(new Error('Reload did not emit Page.loadEventFired.')), 20000) };
      const waiters = eventWaiters.get('Page.loadEventFired') || [];
      eventWaiters.set('Page.loadEventFired', [...waiters, waiter]);
    });
    // A failed Page.reload must not leave an independently rejecting promise.
    loaded.catch(() => {});
    try {
      await call('Page.reload');
      await loaded;
      await until(`window.__smokeNavigationMarker !== ${JSON.stringify(marker)} && Number(document.querySelector('#total-count')?.textContent) > 0 && (!document.querySelector('button[data-mode=roulette]').disabled || document.querySelector('#build-archmother-dialog')?.open || document.querySelector('#build-king-dialog')?.open || document.querySelector('.fate-effects-layer[data-kind=chicken]:not([hidden])'))`);
      mark('reload-complete', { pid: child.pid, port: debugPort });
    } finally {
      clearTimeout(waiter.timeout);
      const remaining = (eventWaiters.get('Page.loadEventFired') || []).filter(candidate => candidate !== waiter);
      if (remaining.length) eventWaiters.set('Page.loadEventFired', remaining);
      else eventWaiters.delete('Page.loadEventFired');
    }
  }
  await call('Runtime.enable');
  await call('Log.enable');
  await call('Page.enable');
  await until("Number(document.querySelector('#total-count').textContent) > 0 && (!document.querySelector('button[data-mode=roulette]').disabled || document.querySelector('#build-archmother-dialog')?.open || document.querySelector('#build-king-dialog')?.open || document.querySelector('.fate-effects-layer[data-kind=chicken]:not([hidden])'))");
  return {
    call, evaluate, until, reload, failures,
    async close() {
      mark('close-start', { pid: child.pid, port: debugPort, exited });
      if (exited) { socket.close(); return; }
      const closed = new Promise((resolve) => child.once('exit', resolve));
      await connectionDiagnostics;
      await call('Runtime.evaluate', { expression: 'window.close()' }).catch(() => {});
      await Promise.race([closed, sleep(10_000)]);
      socket.close();
      if (!exited) { child.kill(); await Promise.race([closed, sleep(3000)]); }
      mark('close-complete', { pid: child.pid, port: debugPort, exited });
    },
  };
}

let app;
try {
  app = await launch();
  assert.equal(await app.evaluate('window.deadlock.getVersion()'), version);
  assert.equal(await app.evaluate('document.body.dataset.mode'), 'roulette', 'The roulette opens with its green theme');
  const initialDPR = await app.evaluate('window.devicePixelRatio');
  const storageKey = 'deadlock-roulette.session.v1';
  const readSession = () => app.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}) || '{}')`);
  const audioState = () => app.evaluate("import('./audio.js').then(({ audio }) => audio.state)");
  async function assertRasterFateMarks() {
    const marks = await app.evaluate("import('./fate-presentation.js').then(async ({prepareFateBadgeImages})=>Array.from(await prepareFateBadgeImages(),([kind,image])=>({kind,width:image?.naturalWidth||0,height:image?.naturalHeight||0})))");
    assert.equal(marks.length, 5);
    assert.ok(marks.every(mark => mark.width > 0 && mark.height > 0), `Every original and app fate glyph rasterizes for PNG export: ${JSON.stringify(marks)}`);
  }
  const latestBuildGroup = build => build.history.filter(entry => entry.drawId === (build.latestDrawId || build.history.at(-1)?.drawId));
  const latestBuildEntry = build => latestBuildGroup(build)[0];
  const latestBuildTicketId = build => { const entry = latestBuildEntry(build); return entry?.comboOrigin || entry?.ticketId || entry?.itemId; };
  async function purchaseRows(selector = '#build-purchase-plan') {
    return app.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(`${selector} .build-purchase-step`)})).map(step => ({
      itemId: step.dataset.purchaseItemId, number: Number(step.dataset.purchaseStep),
      upgrade: step.classList.contains('is-upgrade'), upgradeFrom: step.dataset.upgradeFrom || '', component: step.classList.contains('is-component'),
      cursed: step.classList.contains('is-cursed'), lock: Boolean(step.querySelector('.build-purchase-lock')),
    }))`);
  }
  async function assertPurchaseRoute(plan, selector = '#build-purchase-plan') {
    const rows = await purchaseRows(selector);
    assert.deepEqual(rows.map(row => row.itemId), plan.map(entry => entry.itemId), 'The purchase route keeps every actual purchase in its recorded order');
    assert.deepEqual(rows.map(row => row.number), plan.map((_, index) => index + 1), 'Purchase route numbering follows the complete plan rather than inventory cell numbers');
    for (const [index, entry] of plan.entries()) {
      if (entry.upgradeFromIds?.length) {
        assert.equal(rows[index].upgrade, true, 'Recipe upgrades have an explicit purchase-route marker');
        assert.ok(entry.upgradeFromIds.every(id => rows[index].upgradeFrom.includes(id)), 'The upgrade marker identifies its actual recipe components');
      }
      if (entry.cursed) assert.equal(rows[index].cursed && rows[index].lock, true, 'Locked purchases retain their curse marker in the route');
      if (plan.some(upgrade => upgrade.upgradeFromIds?.includes(entry.itemId))) assert.equal(rows[index].component, true, 'A consumed component remains visible as an earlier purchase');
    }
    return rows;
  }
  async function assertLockOnIcon(selector = '#build-inventory') {
    const geometry = await app.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(`${selector} .build-item-slot.is-cursed`)})).map(slot => {
      const art = slot.querySelector('.build-slot-art'), image = art?.querySelector('img'), lock = art?.querySelector('.build-item-lock');
      if (!image || !lock) return { valid: false };
      const icon = image.getBoundingClientRect(), badge = lock.getBoundingClientRect();
      return { valid: true, absolute: getComputedStyle(lock).position === 'absolute',
        left: badge.left - icon.left, top: badge.top - icon.top, right: icon.right - badge.right, bottom: icon.bottom - badge.bottom,
        topRight: badge.left + badge.width / 2 >= icon.left + icon.width / 2 && badge.top + badge.height / 2 <= icon.top + icon.height / 2 };
    })`);
    assert.ok(geometry.length > 0, 'The selected context contains at least one cursed item');
    assert.ok(geometry.every(record => record.valid && record.absolute && record.topRight && ['left', 'top', 'right', 'bottom'].every(edge => record[edge] >= -1)), 'Each lock sits over the top-right of its actual item icon');
  }
  let total = await app.evaluate("Number(document.querySelector('#total-count').textContent)");
  let heroIds = await app.evaluate("import('./hero-data.js').then(({ default: catalog }) => catalog.heroes.map(hero => hero.id))");
  let selectedHeroId = '69';
  let reducedMotion = await app.evaluate("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
  let initialRules = await readSession();
  assert.equal(initialRules.preferences.curseChance, .5, 'New sessions default to a fifty-percent curse chance');
  assert.equal(initialRules.preferences.pairsEnabled, true, 'Curated double tickets are initially enabled');
  for (const key of ['chickenChance', 'archmotherChance', 'hiddenKingChance']) assert.equal(initialRules.preferences[key], .1, `${key} defaults to ten percent`);
  await app.evaluate(`{
    const chance = document.querySelector('#curse-chance'); chance.value = '0'; chance.dispatchEvent(new Event('input', { bubbles: true }));
    const pairs = document.querySelector('#pairs-enabled'); pairs.checked = false; pairs.dispatchEvent(new Event('change', { bubbles: true }));
    for (const key of ['chickenChance', 'archmotherChance', 'hiddenKingChance']) {
      const input = document.querySelector('#build-' + key); input.value = '0'; input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }`);
  assert.equal((await readSession()).preferences.curseChance, 0, 'Curse chance can be disabled for the baseline session');
  assert.equal((await readSession()).preferences.pairsEnabled, false, 'Pair tickets can be disabled independently');
  for (const key of ['chickenChance', 'archmotherChance', 'hiddenKingChance']) assert.equal((await readSession()).preferences[key], 0, 'The baseline disables new fate events without changing their default settings');
  async function captureReel(selector) {
    await app.evaluate(`{
      clearInterval(window.__smokeReelTimer);
      window.__smokeReelSamples = [];
      window.__smokeAbilityReveals = [];
      window.__smokeReelTimer = setInterval(() => {
        const reel = document.querySelector(${JSON.stringify(selector)});
        const track = reel?.querySelector('.build-reel-track');
        if (reel?.dataset.state === 'scanning' && track) window.__smokeReelSamples.push({
          time: performance.now(), transform: getComputedStyle(track).transform,
          hasNeighbors: (${JSON.stringify(selector)} === '#build-item-scanner' ? ['previous-2', 'previous', 'next', 'next-2'] : ['previous', 'next']).every(position => {
            const card = reel.querySelector('.build-reel-card[data-reel-position="' + position + '"]');
            const viewport = reel.querySelector('.build-reel-viewport');
            if (!card || !viewport) return false;
            const rect = card.getBoundingClientRect(), box = viewport.getBoundingClientRect();
            return Number(getComputedStyle(card).opacity) > .05 && rect.right > box.left + 3 && rect.left < box.right - 3;
          }),
        });
        if (${JSON.stringify(selector)} === '#build-hero-card') {
          const unlocks = document.querySelector('#build-hero-unlocks');
          if (unlocks && !unlocks.hidden) window.__smokeAbilityReveals.push({
            count: unlocks.querySelectorAll('.build-unlock.is-revealed').length,
            locked: document.querySelector('#build-hero-random').disabled,
          });
        }
      }, 32);
    }`);
  }
  async function assertReel(selector, winnerId, kind, fullDuration = false) {
    const result = await app.evaluate(`{
      clearInterval(window.__smokeReelTimer);
      const reel = document.querySelector(${JSON.stringify(selector)});
      const viewport = reel.querySelector('.build-reel-viewport');
      const box = viewport.getBoundingClientRect();
      const center = reel.querySelector('.build-reel-card[data-reel-position="center"]');
      const centerBox = center?.getBoundingClientRect();
      const centerX = centerBox ? centerBox.left + centerBox.width / 2 : NaN;
      const cards = [...reel.querySelectorAll('.build-reel-card[data-reel-entry-id]')].map(card => {
        const rect = card.getBoundingClientRect();
        return { id: card.dataset.reelEntryId, position: card.dataset.reelPosition, x: rect.left + rect.width / 2, visible: Number(getComputedStyle(card).opacity) > .05 && rect.right > box.left + 3 && rect.left < box.right - 3 && rect.bottom > box.top && rect.top < box.bottom };
      }).filter(card => card.visible);
      ({ state: reel.dataset.state, winner: center?.dataset.reelEntryId, left: cards.filter(card => card.x < centerX - 2), right: cards.filter(card => card.x > centerX + 2), samples: window.__smokeReelSamples || [] });
    }`);
    assert.equal(result.state, 'revealed', `${kind} reel settles before controls unlock`);
    assert.equal(result.winner, winnerId, `${kind} center card agrees with the committed winner`);
    if (kind !== 'Hero') {
      assert.ok(result.left.length >= 2 && result.right.length >= 2, `${kind} reel shows two visible cards on each side of its winner`);
      for (const position of ['previous-2', 'previous', 'next', 'next-2']) assert.ok([...result.left, ...result.right].some(card => card.position === position), `The item reel contains its ${position} neighbor`);
      const positions = Object.fromEntries([...result.left, ...result.right].map(card => [card.position, card.x]));
      assert.ok(Math.abs((positions['previous'] + positions.next) / 2 - (positions['previous-2'] + positions['next-2']) / 2) < 2, 'The five item reel slots are symmetric around the winner');
    }
    if (!reducedMotion) {
      assert.ok(result.samples.some(sample => sample.hasNeighbors), `${kind} reel shows previous and next cards during its selection`);
      assert.ok(new Set(result.samples.map(sample => sample.transform)).size >= 10, `${kind} reel visibly translates between cards`);
      if (fullDuration) assert.ok(result.samples.at(-1).time - result.samples[0].time >= 5500, `${kind} normal reel keeps its long anticipation phase`);
    }
    return result;
  }
  if (!rulesOnly) {
  await app.until("import('./audio.js').then(({ audio }) => audio.state.musicPlaying && audio.state.musicReadyState >= 2 && audio.state.musicDuration > 100)");
  assert.equal((await audioState()).musicTrack, 'title', 'The app starts with the current game menu soundtrack');
  const musicTracks = await app.evaluate("import('./music-tracks.js').then(({ MUSIC_TRACKS }) => MUSIC_TRACKS)");
  assert.ok(musicTracks.length >= 5 && musicTracks.some(track => track.id === 'classic'), 'The soundtrack selector includes multiple current OST tracks and the classic menu');
  assert.deepEqual(await app.evaluate("[...document.querySelector('#music-track').options].map(option => option.value)"), musicTracks.map(track => track.id), 'Every bundled soundtrack is offered by the selector');
  const decodedMusic = await app.evaluate(`import('./music-tracks.js').then(({ MUSIC_TRACKS }) => Promise.all(MUSIC_TRACKS.map(track => new Promise((resolve, reject) => {
    const media = new Audio(new URL('../' + track.path, location.href).href); media.preload = 'metadata'; media.muted = true;
    media.addEventListener('loadedmetadata', () => resolve({ id: track.id, duration: media.duration }), { once: true });
    media.addEventListener('error', () => reject(new Error('Original OST failed to decode: ' + track.id)), { once: true });
  }))))`);
  assert.equal(decodedMusic.length, musicTracks.length);
  assert.ok(decodedMusic.every(track => Number.isFinite(track.duration) && track.duration > 20), 'Every original OST track decodes directly from the portable bundle');
  assert.ok(Math.abs(decodedMusic.find(track => track.id === 'classic').duration - 247.092) < 1, 'The original classic menu music remains available');
  const decodedShots = await app.evaluate(`import('./sound-palette.js').then(({ STREET_BRAWL_AUDIO }) => Promise.all([...STREET_BRAWL_AUDIO.shots, ...Object.values(STREET_BRAWL_AUDIO.layers)].map(path => new Promise((resolve, reject) => {
    const media = new Audio(new URL('../' + path, location.href).href); media.preload = 'metadata'; media.muted = true;
    media.addEventListener('loadedmetadata', () => resolve({ path, duration: media.duration }), { once: true });
    media.addEventListener('error', () => reject(new Error('Original Street Brawl landing failed to decode: ' + path)), { once: true });
  }))))`);
  assert.ok(decodedShots.length >= 8 && decodedShots.every(clip => Number.isFinite(clip.duration) && clip.duration > .02), 'Original Street Brawl shots and all item-category layers decode inside the portable executable');
  const decodedCurse = await app.evaluate(`new Promise((resolve, reject) => {
    const media = new Audio(new URL('../assets/audio/curse.mp3', location.href).href); media.preload = 'metadata'; media.muted = true;
    media.addEventListener('loadedmetadata', () => resolve(media.duration), { once: true });
    media.addEventListener('error', () => reject(new Error('Original curse sound failed to decode')), { once: true });
  })`);
  assert.ok(Math.abs(decodedCurse - 2.425691604614258) < .15, 'The original Cursed Relic cast decodes inside the native application');
  for (const [id, value] of [['music-volume', .37], ['sound-volume', .63], ['ui-volume', .41], ['voice-volume', .53]]) {
    await app.evaluate(`{
      const input = document.querySelector('#${id}');
      const minimum = Number(input.min || 0), maximum = Number(input.max || 100);
      input.value = String(minimum + (maximum - minimum) * ${value});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }`);
  }
  let saved = await readSession();
  assert.equal(saved.preferences.musicVolume, .37, 'Music slider persists its separate volume');
  assert.equal(saved.preferences.soundVolume, .63, 'Wheel slider persists its separate volume');
  assert.equal(saved.preferences.uiVolume, .41, 'Interface slider persists its separate volume');
  assert.equal(saved.preferences.voiceVolume, .53, 'Hero voice slider persists its separate volume');
  let volumeState = await audioState();
  assert.equal(volumeState.musicVolume, .37, 'Music slider changes the actual audio volume');
  assert.equal(volumeState.soundVolume, .63, 'Wheel slider changes the actual audio volume');
  assert.equal(volumeState.uiVolume, .41, 'Interface slider changes its separate audio gain');
  assert.equal(volumeState.voiceVolume, .53, 'Hero voice slider changes its separate audio volume');
  assert.equal(volumeState.uiSoundEnabled, true, 'Interface effects start enabled');
  for (const track of musicTracks) {
    await app.evaluate(`{
      const select = document.querySelector('#music-track'); select.value = ${JSON.stringify(track.id)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }`);
    await app.until(`import('./audio.js').then(({ audio }) => audio.state.musicSource === ${JSON.stringify(track.id)} && audio.state.musicPlaying && audio.state.musicReadyState >= 2)`);
    assert.equal((await readSession()).preferences.musicTrack, track.id, 'Changing the background track saves its selection immediately');
    assert.equal((await audioState()).musicVolume, .37, 'Changing the soundtrack preserves the independent music volume');
  }
  const selectedMusicTrack = 'brawl';
  await app.evaluate("document.querySelector('#music-track').value = 'brawl'; document.querySelector('#music-track').dispatchEvent(new Event('change', { bubbles: true }))");
  await app.until("import('./audio.js').then(({ audio }) => audio.state.musicSource === 'brawl' && audio.state.musicPlaying)");
  await app.evaluate(`import('./audio.js').then(({ audio }) => {
    window.__smokeInterfaceCues = [];
    const originalUI = audio.ui.bind(audio);
    audio.ui = kind => { window.__smokeInterfaceCues.push(kind); return originalUI(kind); };
  })`);
  await app.evaluate("document.querySelector('#ui-sound-button').click()");
  let uiMuted = await audioState();
  assert.equal(uiMuted.uiSoundEnabled, false, 'The interface channel can be muted independently');
  assert.equal(uiMuted.musicEnabled, volumeState.musicEnabled, 'Muting interface effects leaves music unchanged');
  assert.equal(uiMuted.soundEnabled, volumeState.soundEnabled, 'Muting interface effects leaves wheel clicks unchanged');
  assert.equal(await app.evaluate("import('./audio.js').then(({ audio }) => audio.ui('tap'))"), false, 'Muted interface cues do not schedule sound');
  await app.evaluate("window.__smokeInterfaceCues = []; document.querySelector('#ui-sound-button').click()");
  assert.equal((await audioState()).uiSoundEnabled, true);
  assert.ok(await app.evaluate("window.__smokeInterfaceCues.includes('toggle')"), 'Enabling interface feedback produces its audible toggle cue');
  await app.evaluate("document.querySelector('#ui-sound-button').click()");
  await app.evaluate("document.querySelector('#voice-button').click()");
  assert.equal((await readSession()).preferences.voices, false, 'Hero lines can be muted independently');
  assert.equal((await audioState()).voices, false, 'The hero voice switch changes the actual audio channel');
  assert.equal((await audioState()).musicEnabled, volumeState.musicEnabled, 'Muting heroes leaves background music enabled');
  await app.evaluate("document.querySelector('#voice-button').click()");
  assert.equal((await readSession()).preferences.voices, true);
  await app.evaluate(`import('./audio.js').then(({ audio }) => {
    window.__smokeSoundPreviews = [];
    const originalPreview = audio.preview.bind(audio);
    audio.preview = style => { window.__smokeSoundPreviews.push(style); return originalPreview(style); };
  })`);
  const soundStyles = await app.evaluate("[...document.querySelector('#sound-style').options].map(option => option.value)");
  assert.ok(soundStyles.length >= 4 && new Set(soundStyles).size === soundStyles.length, 'Several distinct roulette sounds are offered for comparison');
  for (const style of soundStyles) {
    await app.evaluate(`{
      const select = document.querySelector('#sound-style'); select.value = ${JSON.stringify(style)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#sound-preview').click();
    }`);
    assert.equal((await readSession()).preferences.soundStyle, style, 'Selecting another roulette sound persists it immediately');
    assert.equal((await audioState()).soundStyle, style, 'Selecting another roulette sound changes the audio engine');
  }
  assert.deepEqual(await app.evaluate('window.__smokeSoundPreviews'), soundStyles, 'Every roulette sound can be previewed before playing');
  await app.evaluate("document.querySelector('#sound-style').value = 'streetbrawl'; document.querySelector('#sound-style').dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('#sound-preview').click()");
  await app.until("import('./audio.js').then(({ audio }) => audio.state.lastLandingSource?.startsWith('assets/audio/street-brawl/shot-'))");
  assert.equal((await audioState()).soundEnabled, false, 'Explicitly previewing the original shot keeps the saved wheel mute unchanged');
  await app.evaluate("document.querySelector('#sound-style').value = 'crystal'; document.querySelector('#sound-style').dispatchEvent(new Event('change', { bubbles: true }))");
  await app.evaluate("document.querySelector('#music-button').click(); document.querySelector('#sound-button').click();");
  let sound = await audioState();
  assert.equal(sound.musicEnabled, false);
  assert.equal(sound.musicPlaying, false);
  assert.equal(sound.soundEnabled, true, 'Wheel clicks can play while background music is disabled');
  await app.evaluate("document.querySelector('#music-track').value = 'hideout'; document.querySelector('#music-track').dispatchEvent(new Event('change', { bubbles: true }))");
  assert.equal((await audioState()).musicSource, 'hideout', 'A muted soundtrack selection prepares the selected original file');
  assert.equal((await audioState()).musicPlaying, false, 'Changing a muted soundtrack never starts background playback');
  await app.evaluate("document.querySelector('#music-track').value = 'brawl'; document.querySelector('#music-track').dispatchEvent(new Event('change', { bubbles: true }))");
  await app.evaluate("document.querySelector('#music-button').click(); document.querySelector('#sound-button').click();");
  await app.until("import('./audio.js').then(({ audio }) => audio.state.musicPlaying && !audio.state.soundEnabled)");
  await app.evaluate("document.querySelector('#music-button').click(); document.querySelector('#language-button').click();");
  assert.equal(await app.evaluate('document.documentElement.lang'), 'en');
  assert.equal(await app.evaluate("document.querySelector('#language-button').textContent"), 'EN');
  assert.equal(await app.evaluate("document.querySelector('#search').placeholder"), 'Find an item…');
  async function assertZoom(factor) {
    await app.until(`Number(document.querySelector('#zoom-select').value) === ${factor}
      && JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}) || '{}').preferences?.zoomFactor === ${factor}
      && Math.abs(window.devicePixelRatio / ${initialDPR} - ${factor}) < 0.02`);
  }
  async function selectZoom(factor) {
    await app.evaluate(`document.querySelector('#zoom-select').value = ${JSON.stringify(String(factor))};
      document.querySelector('#zoom-select').dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#zoom-select').blur();`);
    await assertZoom(factor);
  }
  async function zoomKey(key, code, windowsVirtualKeyCode, factor) {
    const params = { key, code, windowsVirtualKeyCode, modifiers: 2 };
    await app.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
    await app.call('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
    await assertZoom(factor);
  }
  await selectZoom(1.5);
  await zoomKey('0', 'Digit0', 48, 1);
  await zoomKey('=', 'Equal', 187, 1.1);
  await zoomKey('-', 'Minus', 189, 1);
  await selectZoom(1.5);
  assert.ok(await app.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2'), 'Scaled application should fit without horizontal overflow');
  await app.evaluate("document.querySelector('#catalog-toggle-button').click()");
  assert.equal(await app.evaluate("document.querySelector('#catalog').hidden"), true, 'Catalog button hides the item list');
  assert.equal((await readSession()).preferences.catalogVisible, false, 'Catalog visibility is saved');
  await app.evaluate("document.querySelector('#catalog-toggle-button').click()");
  assert.equal(await app.evaluate("document.querySelector('#catalog').hidden"), false, 'Catalog button reveals the item list again');
  await app.evaluate(`{
    const wheel = document.querySelector('#wheel');
    const rect = wheel.getBoundingClientRect();
    wheel.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + rect.width * .85, clientY: rect.top + rect.height * .5, bubbles: true }));
  }`);
  assert.ok(await app.evaluate("!document.querySelector('#wheel-hover-card').hidden && document.querySelector('#wheel-hover-card').textContent.trim().length > 2"), 'Hovering a wheel slot displays a readable item preview');
  assert.ok(await app.evaluate(`import('./catalog-data.js').then(({ default: catalog }) => {
    const card = document.querySelector('#wheel-hover-card');
    const item = catalog.items.find(item => item.id === card.dataset.itemId);
    return Boolean(item && card.textContent.includes(document.documentElement.lang === 'en' ? item.name : item.nameRu || item.name));
  })`), 'Wheel preview names the actual item in the hovered slot');
  await app.until("document.querySelector('#wheel-hover-card img')?.naturalWidth > 0");
  await app.evaluate("document.querySelector('#wheel').dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))");
  assert.equal(await app.evaluate("document.querySelector('#wheel-hover-card').hidden"), true, 'Wheel preview hides after the pointer leaves');
  total = await app.evaluate("Number(document.querySelector('#total-count').textContent)");
  assert.ok(total > 100, 'The offline item catalog should load inside the packaged executable');
  assert.equal(await app.evaluate("Number(document.querySelector('#drawn-count').textContent)"), 0);
  await app.evaluate(`import('./audio.js').then(({ audio }) => {
    const prototype = CanvasRenderingContext2D.prototype;
    const originalSave = prototype.save, originalRestore = prototype.restore, originalRotate = prototype.rotate;
    const depths = new WeakMap();
    prototype.save = function(...args) { depths.set(this, (depths.get(this) || 0) + 1); return originalSave.apply(this, args); };
    prototype.restore = function(...args) { depths.set(this, Math.max(0, (depths.get(this) || 0) - 1)); return originalRestore.apply(this, args); };
    prototype.rotate = function(angle) {
      if (this.canvas.id === 'wheel' && depths.get(this) === 1) {
        const rotation = angle + Math.PI / 2;
        if (window.__smokeRotation !== undefined && window.__smokeRotation !== rotation) window.__smokeWheelMoves = (window.__smokeWheelMoves || 0) + 1;
        window.__smokeRotation = rotation;
      }
      return originalRotate.call(this, angle);
    };
    const originalTick = audio.tick.bind(audio);
    window.__smokeTicks = [];
    audio.tick = () => { window.__smokeTicks.push({ time: performance.now(), rotation: window.__smokeRotation }); originalTick(); };
    document.querySelector('#sound-button').click();
    window.__smokeTicks = [];
  })`);
  await app.evaluate("document.querySelector('#sound-style').value = 'streetbrawl'; document.querySelector('#sound-style').dispatchEvent(new Event('change', { bubbles: true }))");
  const previewLandingSource = (await audioState()).lastLandingSource;
  await app.evaluate("document.querySelector('#speed-button').click(); document.querySelector('#spin-button').click();");
  await app.until("Number(document.querySelector('#drawn-count').textContent) === 1 && !document.querySelector('#spin-button').disabled");
  const ticks = await app.evaluate('window.__smokeTicks');
  reducedMotion = await app.evaluate("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
  assert.ok(ticks.length >= (reducedMotion ? 1 : 5), 'The rotating wheel triggers mechanical clicks');
  assert.ok(ticks.every(tick => Number.isFinite(tick.rotation)), 'Clicks follow displayed wheel frames');
  assert.ok(ticks.slice(1).every((tick, index) => tick.rotation !== ticks[index].rotation), 'A stationary wheel never schedules catch-up clicks');
  const duration = ticks.at(-1).time - ticks[0].time;
  if (duration > 300 && ticks.length > 12) {
    const first = ticks.filter(tick => tick.time <= ticks[0].time + duration / 3).length;
    const last = ticks.filter(tick => tick.time >= ticks.at(-1).time - duration / 3).length;
    assert.ok(first > last, 'Mechanical clicks slow down with the wheel near the end');
  }
  assert.notEqual((await audioState()).lastLandingSource, previewLandingSource, 'A roulette landing plays a new original Street Brawl shot');
  await app.evaluate("document.querySelector('#sound-style').value = 'crystal'; document.querySelector('#sound-style').dispatchEvent(new Event('change', { bubbles: true }))");
  await app.evaluate("document.querySelector('#sound-button').click()");
  const beforeReroll = (await readSession()).history;
  await app.evaluate("document.querySelector('#reroll-button').click()");
  assert.deepEqual((await readSession()).history, beforeReroll, 'Reroll never consumes an item or changes the no-repeat pool');
  if (!reducedMotion) assert.equal(await app.evaluate("document.querySelector('#reroll-button').disabled"), true, 'An in-flight preview reroll cannot be clicked twice');
  await app.until("!document.querySelector('#spin-button').disabled");
  saved = await readSession();
  assert.equal(saved.rouletteResult.consumed, false, 'Reroll is explicitly recorded as a preview rather than a consumed draw');
  assert.deepEqual(saved.history, beforeReroll, 'The completed reroll keeps every original draw unchanged');
  assert.deepEqual(saved.itemActions.usedActions, ['reroll'], 'A preview consumes the reroll charge once for this session');
  assert.deepEqual(await app.evaluate("['reroll', 'upgrade', 'downgrade'].map(action => document.querySelector('#' + action + '-button').disabled)"), [true, true, true], 'One modified result cannot accept a second special action');
  const afterPreview = saved;
  await app.evaluate("document.querySelector('#reroll-button').click(); document.querySelector('#upgrade-button').click(); document.querySelector('#downgrade-button').click()");
  assert.deepEqual(await readSession(), afterPreview, 'Disabled result actions cannot consume another charge or redraw a result');
  async function setRouletteTiers(tiers) {
    await app.evaluate(`{
      const tiers = ${JSON.stringify(tiers)};
      for (const tier of [1, 2, 3, 4, 5]) {
        const button = document.querySelector('#tier-controls [data-toggle-tier="' + tier + '"]');
        if (button && (button.getAttribute('aria-pressed') === 'true') !== tiers.includes(tier)) button.click();
      }
    }`);
  }
  for (const [action, sourceTier, expectedTier] of [['upgrade', 1, 2], ['downgrade', 2, 1]]) {
    await setRouletteTiers([sourceTier]);
    await app.evaluate("document.querySelector('#spin-button').click()");
    await app.until("!document.querySelector('#spin-button').disabled");
    await setRouletteTiers([1, 2, 3, 4]);
    const beforeAction = (await readSession()).history;
    assert.equal(await app.evaluate("document.querySelector('#reroll-button').disabled"), true, 'A spent reroll remains disabled on fresh items');
    assert.equal(await app.evaluate(`document.querySelector('#${action}-button').disabled`), false, 'A neighboring enabled tier is available for the displayed item');
    await app.evaluate(`document.querySelector('#${action}-button').click()`);
    assert.equal((await readSession()).history.length, beforeAction.length + 1, 'Tier changes consume their new result exactly once before animation');
    await app.until("!document.querySelector('#spin-button').disabled");
    saved = await readSession();
    const resultTier = await app.evaluate(`import('./catalog-data.js').then(({ default: catalog }) => catalog.items.find(item => item.id === ${JSON.stringify(saved.rouletteResult.itemId)}).tier)`);
    assert.equal(resultTier, expectedTier, 'Upgrade and downgrade draw strictly from the adjacent tier');
    assert.equal(saved.rouletteResult.consumed, true, 'Tier changes record their consumed result');
    assert.deepEqual(saved.history.slice(0, -1), beforeAction, 'Tier changes preserve previous consumed items');
    assert.ok(saved.itemActions.usedActions.includes(action), 'The selected action stays spent for the entire session');
    assert.deepEqual(await app.evaluate("['reroll', 'upgrade', 'downgrade'].map(action => document.querySelector('#' + action + '-button').disabled)"), [true, true, true], 'A tier-changed result cannot be rerolled or tier-changed again');
  }
  assert.equal(new Set((await readSession()).history.map(entry => entry.itemId)).size, 5, 'Normal spins and tier changes never reuse consumed items');
  await app.evaluate("document.querySelector('#spin-button').click()");
  await app.until("!document.querySelector('#spin-button').disabled");
  assert.deepEqual(await app.evaluate("['reroll', 'upgrade', 'downgrade'].map(action => document.querySelector('#' + action + '-button').disabled)"), [true, true, true], 'All spent options stay disabled after subsequent ordinary draws');
  const normalActionSnapshot = (await readSession()).itemActions;
  assert.ok(await app.evaluate("document.querySelector('#wheel').getContext('2d').getImageData(800,550,1,1).data[3] > 0"), 'The wheel should draw visible sectors');
  const shot = await app.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(screenshot, Buffer.from(shot.data, 'base64'));
  await app.call('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false });
  // Offscreen Electron needs a fresh compositor after emulated viewport changes.
  await app.reload();
  await app.until("Number(document.querySelector('#total-count')?.textContent) > 0 && !document.querySelector('button[data-mode=roulette]').disabled");
  await sleep(150);
  assert.ok(await app.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2'), 'The 2K layout should fit at the remembered scale');
  const shot2K = await app.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(screenshot2K, Buffer.from(shot2K.data, 'base64'));
  await app.call('Emulation.clearDeviceMetricsOverride');
  assert.equal(await app.evaluate('window.deadlock.toggleFullscreen()'), true);
  assert.equal(await app.evaluate('window.deadlock.toggleFullscreen()'), false);
  const normalHistory = (await readSession()).history;
  const greenZoomColors = await app.evaluate("({ control: getComputedStyle(document.querySelector('.zoom-control')).backgroundColor, select: getComputedStyle(document.querySelector('#zoom-select')).backgroundColor })");
  await app.evaluate("document.querySelector('button[data-mode=build]').click()");
  assert.equal((await readSession()).preferences.mode, 'build');
  assert.equal(await app.evaluate('document.body.dataset.mode'), 'build', 'Hero builds activate their own background theme');
  if (!reducedMotion) assert.ok(await app.evaluate("parseFloat(getComputedStyle(document.body, '::before').transitionDuration) >= .3"), 'The colored background fades smoothly between workspaces');
  await app.until("Number(getComputedStyle(document.body, '::before').opacity) > .99");
  const lilacZoomColors = await app.evaluate("({ control: getComputedStyle(document.querySelector('.zoom-control')).backgroundColor, select: getComputedStyle(document.querySelector('#zoom-select')).backgroundColor })");
  assert.notEqual(lilacZoomColors.control, greenZoomColors.control, 'The zoom control follows the lilac build theme');
  assert.ok(lilacZoomColors.select !== greenZoomColors.select || lilacZoomColors.select === 'rgba(0, 0, 0, 0)', 'The zoom selector follows its themed control');
  assert.equal(await app.evaluate("document.querySelector('#build-mode').hidden"), false, 'Build mode opens its own hero/inventory workspace');
  heroIds = await app.evaluate("[...document.querySelectorAll('[data-build-hero-id]')].map(element => element.dataset.buildHeroId)");
  assert.ok(heroIds.length >= 20, 'Offline hero catalog loads inside the packaged application');
  assert.ok(await app.evaluate(`import('./hero-art.js').then(({ default: art }) => ${JSON.stringify(heroIds)}.every(id => art[id]?.background?.startsWith('assets/hero-art/') && /^#[a-f0-9]{6}$/i.test(art[id].color)))`), 'Every released hero has a complete offline background and its own color palette');
  const decodedArt = await app.evaluate(`import('./hero-art.js').then(({ default: art }) => Promise.all(${JSON.stringify(heroIds)}.map(id => new Promise((resolve, reject) => {
    const image = new Image(); image.decoding = 'async';
    image.onload = () => resolve({ id, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('Full hero background failed to decode: ' + id));
    image.src = new URL('../' + art[id].background, location.href).href;
  }))))`);
  assert.equal(decodedArt.length, heroIds.length);
  assert.ok(decodedArt.every(image => image.width >= 1000 && image.height >= 500), 'Every full hero artwork decodes at its original large resolution');
  const decodedRenders = await app.evaluate(`import('./hero-art.js').then(({ default: art }) => Promise.all([...new Set(${JSON.stringify(heroIds)}.map(id => art[id].render).filter(Boolean))].map(path => new Promise((resolve, reject) => {
    const image = new Image(); image.decoding = 'async';
    image.onload = () => resolve({ path, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('Original hero character render failed to decode: ' + path));
    image.src = new URL('../' + path, location.href).href;
  }))))`);
  assert.ok(decodedRenders.length > 0 && decodedRenders.every(image => image.width > 0 && image.height > 0), 'All available original full-body character renders decode alongside the complete backgrounds');
  assert.ok(await app.evaluate(`import('./hero-voices.js').then(({ default: voices }) => ${JSON.stringify(heroIds)}.every(id => voices[id]?.path?.startsWith('assets/voices/')))`), 'Every released hero has an original locally bundled voice line');
  const decodedVoices = await app.evaluate(`import('./hero-voices.js').then(({ default: voices }) => Promise.all(${JSON.stringify(heroIds)}.map(id => new Promise((resolve, reject) => {
    const sample = new Audio(new URL('../' + voices[id].path, location.href).href);
    sample.preload = 'metadata'; sample.muted = true;
    sample.addEventListener('loadedmetadata', () => resolve({ id, duration: sample.duration }), { once: true });
    sample.addEventListener('error', () => reject(new Error('Original hero line failed to decode: ' + id)), { once: true });
  }))))`);
  assert.equal(decodedVoices.length, heroIds.length);
  assert.ok(decodedVoices.every(voice => Number.isFinite(voice.duration) && voice.duration > .15), 'Every original hero line decodes from the portable executable');
  console.log(JSON.stringify({ stage: 'hero-voice-decode', count: decodedVoices.length, maxDuration: Math.max(...decodedVoices.map(voice => voice.duration)), longLines: decodedVoices.filter(voice => voice.duration > 8) }));
  await app.evaluate(`import('./audio.js').then(({ audio }) => {
    window.__smokeImpacts = [];
    window.__smokeAudioUnlocks = 0;
    window.__smokeHeroVoices = [];
    const originalImpact = audio.impact.bind(audio);
    const originalUnlock = audio.unlock.bind(audio);
    const originalVoice = audio.playHeroVoice.bind(audio);
    audio.impact = kind => { window.__smokeImpacts.push(kind); return originalImpact(kind); };
    audio.unlock = (...args) => { window.__smokeAudioUnlocks++; return originalUnlock(...args); };
    audio.playHeroVoice = heroId => { window.__smokeHeroVoices.push(String(heroId)); return originalVoice(heroId); };
  })`);
  await app.evaluate("if (JSON.parse(localStorage.getItem('deadlock-roulette.session.v1')).preferences.quick) document.querySelector('#speed-button').click()");
  await captureReel('#build-hero-card');
  const unlocksBeforeHero = await app.evaluate('window.__smokeAudioUnlocks');
  await app.evaluate("document.querySelector('#build-hero-random').click()");
  assert.ok(await app.evaluate(`window.__smokeAudioUnlocks > ${unlocksBeforeHero}`), 'A hero spin unlocks mechanical audio immediately even with interface cues muted');
  if (!reducedMotion) {
    await app.until("document.querySelector('#build-hero-card').dataset.state === 'scanning'", 1500);
    assert.equal(await app.evaluate("document.querySelector('#build-hero-random').disabled"), true, 'A moving hero reel cannot be rerolled');
    assert.equal(await app.evaluate("document.querySelector('button[data-mode=roulette]').disabled"), true, 'The workspace remains locked until the hero reveal finishes');
  }
  await app.until("JSON.parse(localStorage.getItem('deadlock-roulette.session.v1')).build.heroId && !document.querySelector('#build-hero-random').disabled");
  const firstHero = (await readSession()).build.heroId;
  assert.ok(heroIds.includes(firstHero), 'The center hero comes from the enabled catalog');
  await assertReel('#build-hero-card', firstHero, 'Hero', true);
  await app.until("document.querySelector('.build-hero-stage')?.dataset.posterState === 'expanded' && document.querySelector('#build-hero-poster img')?.naturalWidth > 0");
  assert.ok(await app.evaluate(`{
    const stage = document.querySelector('.build-hero-stage');
    const unlocks = document.querySelector('#build-hero-unlocks');
    const art = document.querySelector('#build-hero-poster');
    const stageBox = stage.getBoundingClientRect(), unlockBox = unlocks.getBoundingClientRect();
    stage.contains(unlocks) && Number(getComputedStyle(art).opacity) > .5 && getComputedStyle(unlocks).position === 'absolute'
      && unlockBox.bottom <= stageBox.bottom + 1 && unlockBox.top >= stageBox.top;
  }`), 'The landed hero expands into its full artwork with a compact ability overlay at the bottom');
  assert.ok(await app.evaluate(`import('./hero-art.js').then(({ default: art }) => document.body.style.getPropertyValue('--hero-color').trim() === art[${JSON.stringify(firstHero)}].color)`), 'The selected hero sets the builder background to its dominant artwork color');
  if (!reducedMotion) assert.ok(await app.evaluate("parseFloat(getComputedStyle(document.querySelector('.hero-ambience > i')).transitionDuration) >= .9"), 'Changing heroes crossfades the old and new colored background washes');
  if (!reducedMotion) {
    const abilityReveals = await app.evaluate('window.__smokeAbilityReveals');
    for (const count of [1, 2, 3]) assert.ok(abilityReveals.some(frame => frame.count === count && frame.locked), 'Ability icons reveal one after another while the hero selection remains locked');
  }
  assert.equal(await app.evaluate("document.querySelectorAll('#build-hero-unlocks .build-unlock.is-revealed').length"), 4, 'All four abilities are revealed when the hero controls unlock');
  assert.ok(await app.evaluate("window.__smokeImpacts.includes('hero')"), 'Hero reveal triggers its mechanical impact cue');
  assert.ok(await app.evaluate(`window.__smokeHeroVoices.includes(${JSON.stringify(firstHero)})`), 'The selected hero speaks their own line after landing');
  await app.evaluate("if (!JSON.parse(localStorage.getItem('deadlock-roulette.session.v1')).preferences.quick) document.querySelector('#speed-button').click()");
  await app.evaluate(`document.querySelector('[data-build-skill-index="0"]').click()`);
  assert.deepEqual((await readSession()).build.checkedSkills, [0], 'The previous hero has live upgrade progress before rerolling');
  await app.evaluate("document.querySelector('#build-heroes-none').click()");
  assert.equal(await app.evaluate("document.querySelector('#build-hero-random').disabled"), true, 'Empty hero pool cannot be rolled');
  selectedHeroId = await app.evaluate(`import('./hero-data.js').then(({ default: catalog }) =>
    catalog.heroes.find(hero => /doorman/i.test(hero.name))?.id || ${JSON.stringify(heroIds[0])})`);
  await app.evaluate(`document.querySelector('[data-build-hero-id="${selectedHeroId}"]').click(); document.querySelector('#build-hero-random').click()`);
  if (!reducedMotion) {
    assert.equal(await app.evaluate("[...document.querySelectorAll('#build-skills [data-build-skill-index]')].every(input => input.disabled)"), true, 'The old hero\'s upgrade checks are locked during a reroll');
    assert.equal(await app.evaluate("document.querySelector('#build-contract-save').disabled"), true, 'A changing hero cannot be archived mid-spin');
    const checksBefore = (await readSession()).build.checkedSkills;
    await app.evaluate(`document.querySelector('[data-build-skill-index="0"]').click()`);
    assert.deepEqual((await readSession()).build.checkedSkills, checksBefore, 'Disabled old-hero checkboxes cannot alter the rerolling build');
  }
  await app.until(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).build.heroId === ${JSON.stringify(selectedHeroId)} && !document.querySelector('#build-hero-random').disabled`);
  saved = await readSession();
  assert.equal(saved.build.excludedHeroIds.length, heroIds.length - 1, 'Only explicitly enabled heroes participate');
  assert.equal(saved.build.heroId, selectedHeroId, 'An excluded hero cannot be selected');
  function assertSkillPlan(build) {
    assert.equal(build.skillPlan.length, 12);
    const ranks = [0, 0, 0, 0];
    let cumulativeCost = 0;
    for (const step of build.skillPlan) {
      assert.ok([1, 2, 3, 4].includes(step.slot));
      assert.equal(step.rank, ++ranks[step.slot - 1], 'Each upgrade follows the previous rank of that ability');
      assert.equal(step.cost, [1, 2, 5][step.rank - 1]);
      cumulativeCost += step.cost;
      assert.equal(step.cumulativeCost, cumulativeCost);
    }
    assert.deepEqual(ranks, [3, 3, 3, 3]);
    assert.deepEqual([...build.unlockOrder].sort(), [1, 2, 3, 4]);
    assert.equal(build.unlockOrder[3], 4, 'The ultimate is unlocked after the three regular abilities');
    assert.equal(build.skillPlan[0].slot, build.unlockOrder[0], 'The first upgrade belongs to the first unlocked ability');
  }
  assertSkillPlan(saved.build);
  assert.equal(await app.evaluate("document.querySelectorAll('.build-hero-panel #build-hero-unlocks .build-unlock').length"), 4, 'Compact ability unlocks appear with the selected hero artwork');
  assert.deepEqual(await app.evaluate("[...document.querySelectorAll('#build-hero-unlocks .build-unlock')].map(unlock => Number(unlock.dataset.buildUnlockSlot))"), saved.build.unlockOrder, 'The compact strip preserves the actual generated ability unlock order');
  assert.equal(await app.evaluate("document.querySelectorAll('#build-skill-content .build-unlocks').length"), 0, 'The detailed upgrade table no longer repeats the unlock strip');
  assert.ok(await app.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2'), 'The hero reel and upgrade timeline fit within the scaled workspace');
  assert.equal(await app.evaluate("document.querySelectorAll('#build-skills [data-build-skill-index]').length"), 12, 'All random upgrade steps are displayed');
  assert.deepEqual(await app.evaluate("[...document.querySelectorAll('#build-skills .build-timeline-row')].map(row => Number(row.dataset.buildAbilitySlot))"), [1, 2, 3, 4], 'The timeline gives each ability its own row');
  assert.deepEqual(await app.evaluate("[...document.querySelectorAll('#build-skills .build-timeline-column')].map(column => Number(column.dataset.buildStepIndex))"), Array.from({ length: 12 }, (_, index) => index), 'Upgrade columns read in chronological order from left to right');
  assert.deepEqual(await app.evaluate("[...document.querySelectorAll('#build-skills .build-timeline-row')].map(row => [...row.querySelectorAll('[data-build-skill-index]')].map(input => Number(input.dataset.buildSkillIndex)))"), [1, 2, 3, 4].map(slot => saved.build.skillPlan.flatMap((step, index) => step.slot === slot ? [index] : [])), 'Upgrade markers sit in the row of their actual ability');
  await app.evaluate(`document.querySelector('[data-build-skill-index="0"]').click()`);
  assert.deepEqual((await readSession()).build.checkedSkills, [0], 'Upgrade progress can be checked off');
  const beforeSkillConfirmation = (await readSession()).build;
  await app.evaluate("document.querySelector('#build-skill-random').click()");
  await app.until("document.querySelector('#build-contract-dialog').open");
  assert.deepEqual((await readSession()).build, beforeSkillConfirmation, 'Requesting a new skill order preserves the plan until confirmed');
  await app.evaluate("document.querySelector('#build-confirm-cancel').click()");
  assert.deepEqual((await readSession()).build, beforeSkillConfirmation, 'Canceling a skill shuffle preserves the plan and purchased upgrades');
  await app.evaluate("document.querySelector('#build-skill-random').click(); document.querySelector('#build-confirm-accept').click()");
  await app.until("!document.querySelector('#build-contract-dialog').open");
  assertSkillPlan((await readSession()).build);
  assert.deepEqual((await readSession()).build.checkedSkills, [], 'Regenerating the skill order clears its checkmarks');
  await app.evaluate(`document.querySelector('[data-build-skill-index="0"]').click()`);
  const ordinaryTierSettings = (await readSession()).settings.enabledTiers;
  assert.equal((await readSession()).build.dynamicWeights, true, 'Build tier balancing starts enabled');
  assert.ok(await app.evaluate(`{
    const tiers = document.querySelector('#build-tier-controls').closest('.build-tier-rules');
    const inventory = document.querySelector('.build-inventory-panel');
    !tiers.closest('.build-inventory-panel') && tiers.getBoundingClientRect().top >= inventory.getBoundingClientRect().bottom - 1;
  }`), 'Build tier settings sit below the inventory in their own lower section');
  const startingBuildTiers = (await readSession()).build.enabledTiers;
  for (const tier of startingBuildTiers) await app.evaluate(`document.querySelector('[data-build-toggle-tier="${tier}"]').click()`);
  assert.deepEqual((await readSession()).build.enabledTiers, [], 'Every tier can be excluded specifically from build draws');
  assert.deepEqual((await readSession()).settings.enabledTiers, ordinaryTierSettings, 'Build tier choices leave ordinary roulette filters unchanged');
  assert.equal(await app.evaluate("document.querySelector('#build-item-random').disabled"), true, 'An empty build tier pool disables drawing an item');
  await app.evaluate("document.querySelector('#build-item-random').click()");
  assert.deepEqual((await readSession()).build.history, [], 'A disabled build tier pool cannot commit an item');
  await app.evaluate("document.querySelector('[data-build-toggle-tier=\"1\"]').click()");
  assert.deepEqual((await readSession()).build.enabledTiers, [1], 'A single enabled build tier can be selected for its next draws');
  for (let index = 1; index <= 2; index++) {
    if (index === 1) await app.evaluate("if (JSON.parse(localStorage.getItem('deadlock-roulette.session.v1')).preferences.quick) document.querySelector('#speed-button').click()");
    if (index === 2) await app.evaluate("if (!JSON.parse(localStorage.getItem('deadlock-roulette.session.v1')).preferences.quick) document.querySelector('#speed-button').click()");
    const wheelMovesBefore = await app.evaluate('window.__smokeWheelMoves || 0');
    await captureReel('#build-item-scanner');
    await app.evaluate("document.querySelector('#build-item-random').click()");
    assert.equal((await readSession()).build.history.length, index, 'A build draw is committed before its animation ends');
    assert.ok(await app.evaluate("Boolean(document.querySelector('.build-inventory-panel #build-item-scanner'))"), 'Item selection happens directly beside the inventory');
    if (!reducedMotion) {
      assert.equal(await app.evaluate("document.querySelector('#build-item-random').disabled"), true, 'An in-flight item cannot be drawn twice');
      await app.until("document.querySelector('#build-item-scanner').dataset.state === 'scanning'", 1500);
    }
    await app.until(`{
      const scanner = document.querySelector('#build-item-scanner').getBoundingClientRect();
      scanner.top < window.innerHeight && scanner.bottom > 0;
    }`);
    await app.until(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).build.history.length === ${index} && !document.querySelector('#build-item-random').disabled`);
    assert.equal(await app.evaluate("document.querySelector('#build-item-scanner').dataset.state"), 'revealed', 'The scanner displays the finished draw');
    assert.equal(await app.evaluate("document.querySelector('#build-item-scanner').dataset.itemId"), latestBuildTicketId((await readSession()).build), 'The displayed scanner winner matches the committed inventory ticket');
    await assertReel('#build-item-scanner', latestBuildTicketId((await readSession()).build), 'Item', index === 1);
    assert.ok(await app.evaluate("window.__smokeImpacts.includes('item')"), 'The inventory landing triggers its item impact cue');
    assert.equal(await app.evaluate('window.__smokeWheelMoves || 0'), wheelMovesBefore, 'Build item selection does not spin the offscreen roulette');
  }
  saved = await readSession();
  assert.equal(await app.evaluate("document.querySelector('[data-build-tier-count=\"1\"]').textContent"), '2', 'Tier balancing counts the actual items already in the build');
  const factorAfterTwo = await app.evaluate("document.querySelector('[data-build-tier-factor=\"1\"]').textContent");
  assert.notEqual(factorAfterTwo, '×1', 'Repeated build tiers visibly reduce their effective weight');
  await app.evaluate("document.querySelector('#build-dynamic-weights').click()");
  assert.equal((await readSession()).build.dynamicWeights, false, 'Dynamic tier balancing can be disabled');
  assert.equal(await app.evaluate("document.querySelector('[data-build-tier-factor=\"1\"]').textContent"), '×1', 'Turning off dynamic weights restores the chosen base weights');
  await app.evaluate("document.querySelector('#build-dynamic-weights').click()");
  const undoneItemId = latestBuildEntry(saved.build).itemId;
  const initialUndoSnapshot = saved.build.inventoryUndo.at(-1);
  await app.evaluate("document.querySelector('#build-item-undo').click()");
  assert.deepEqual((await readSession()).build.history, initialUndoSnapshot.history, 'Undo restores the exact previous inventory transaction');
  assert.deepEqual((await readSession()).build.purchasePlan, initialUndoSnapshot.purchasePlan, 'Undo restores the purchase route together with the inventory transaction');
  await assertPurchaseRoute((await readSession()).build.purchasePlan);
  assert.equal(await app.evaluate("document.querySelector('[data-build-tier-count=\"1\"]').textContent"), '1', 'Undo restores the previous dynamic tier count');
  assert.ok(await app.evaluate(`Promise.all([import('./draw-rules.js'), import('./catalog-data.js')]).then(([draw, { default: catalog }]) => {
    const session = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
    const distribution = draw.calculateBuildDistribution(catalog.items, session.settings, session.build);
    return distribution.items.some(entry => entry.item.id === ${JSON.stringify(undoneItemId)});
  })`), 'Undo returns the last item to the eligible build pool');
  await app.evaluate("document.querySelector('#build-item-random').click()");
  await app.until(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).build.history.length === 2 && !document.querySelector('#build-item-random').disabled`);
  saved = await readSession();
  for (const tier of startingBuildTiers.filter(tier => tier !== 1)) await app.evaluate(`document.querySelector('[data-build-toggle-tier="${tier}"]').click()`);
  assert.deepEqual((await readSession()).build.enabledTiers, startingBuildTiers, 'Build tiers can be restored without resetting inventory');
  assert.deepEqual(saved.history, normalHistory, 'Drawing build items preserves the normal roulette history');
  assert.equal(new Set(saved.build.history.map(entry => entry.itemId)).size, 2, 'Build inventory draws have no repeats');
  assert.equal(await app.evaluate("document.querySelectorAll('#build-inventory [data-build-item-id]').length"), 2, 'Drawn build items appear in game-style inventory cells');
  assert.ok(await app.evaluate(`{
    const rect = document.querySelector('#build-inventory [data-build-item-id]').getBoundingClientRect();
    Math.abs(rect.width - rect.height) < 2;
  }`), 'Inventory cells are square');
  const inventoryRows = await app.evaluate(`{
    const slots = [...document.querySelectorAll('#build-inventory .build-item-slot')].map(slot => {
      const rect = slot.getBoundingClientRect();
      return { number: Number(slot.querySelector('.build-slot-index').textContent), x: rect.left, y: rect.top };
    }).sort((left, right) => left.y - right.y);
    [slots.slice(0, 6), slots.slice(6)].map(row => row.sort((left, right) => left.x - right.x).map(slot => slot.number));
  }`);
  assert.deepEqual(inventoryRows, [[1, 3, 5, 7, 9, 11], [2, 4, 6, 8, 10, 12]], 'Inventory progression reads down each pair of slots before moving to the next column');
  assert.deepEqual((await readSession()).build.itemActions.usedActions, [], 'Build actions have their own fresh charges independently of the normal roulette');
  const discardedByActions = [];
  async function setBuildTiers(tiers) {
    await app.evaluate(`{
      const tiers = ${JSON.stringify(tiers)};
      for (const tier of [1, 2, 3, 4, 5]) {
        const button = document.querySelector('[data-build-toggle-tier="' + tier + '"]');
        if (button && (button.getAttribute('aria-pressed') === 'true') !== tiers.includes(tier)) button.click();
      }
    }`);
  }
  async function replaceLastBuildItem(action, expectedTier) {
    const before = (await readSession()).build;
    const original = latestBuildEntry(before);
    assert.equal(await app.evaluate(`document.querySelector('#build-${action}-button').disabled`), false, 'An unused build action is available for an unmodified last slot');
    await app.evaluate(`document.querySelector('#build-${action}-button').click()`);
    const committed = (await readSession()).build;
    assert.ok(committed.history.length <= before.history.length, 'A build action replaces its result without adding an inventory slot; recipes may free one');
    for (const previous of before.history.filter(entry => entry.drawId !== original.drawId)) {
      const preserved = committed.history.find(entry => entry.itemId === previous.itemId);
      if (preserved) assert.deepEqual(preserved, previous, 'Unmerged earlier inventory items keep their exact metadata');
    }
    assert.notEqual(latestBuildEntry(committed).itemId, original.itemId, 'A replacement cannot return its discarded original');
    assert.ok(committed.discardedItemIds.includes(original.itemId), 'The replaced original stays excluded until an explicit reset');
    discardedByActions.push(original.itemId);
    await app.until("!document.querySelector('#build-item-random').disabled");
    saved = await readSession();
    assert.ok(saved.build.itemActions.usedActions.includes(action), 'The chosen build action consumes its charge');
    assert.ok(saved.build.itemActions.modifiedDrawIds.includes(original.drawId) && saved.build.itemActions.modifiedDrawIds.includes(saved.build.latestDrawId), 'Both original and replacement tickets reject further modifications');
    if (expectedTier !== undefined) {
      const actualTier = await app.evaluate(`import('./catalog-data.js').then(({ default: catalog }) => catalog.items.find(item => item.id === ${JSON.stringify(latestBuildEntry(saved.build).itemId)}).tier)`);
      assert.equal(actualTier, expectedTier, 'Build tier changes use exactly the neighboring tier');
    }
    assert.deepEqual(await app.evaluate("['reroll', 'upgrade', 'downgrade'].map(action => document.querySelector('#build-' + action + '-button').disabled)"), [true, true, true], 'The same build slot cannot receive a second special action');
  }
  await setBuildTiers([1]);
  await replaceLastBuildItem('reroll', 1);
  const policyBeforeUndo = (await readSession()).build.itemActions;
  const replacementBeforeUndo = latestBuildEntry((await readSession()).build).itemId;
  const replacementUndoSnapshot = (await readSession()).build.inventoryUndo.at(-1);
  await app.evaluate("document.querySelector('#build-item-undo').click()");
  assert.deepEqual((await readSession()).build.history, replacementUndoSnapshot.history, 'Undoing a replacement restores its original inventory order and metadata');
  assert.deepEqual((await readSession()).build.purchasePlan, replacementUndoSnapshot.purchasePlan, 'Undoing a replacement restores its earlier purchase route without refunding action charges');
  assert.deepEqual((await readSession()).build.itemActions, policyBeforeUndo, 'Undo cannot refund a spent build action');
  assert.ok(await app.evaluate(`Promise.all([import('./draw-rules.js'), import('./catalog-data.js')]).then(([draw, { default: catalog }]) => {
    const session = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
    const pool = draw.calculateBuildDistribution(catalog.items, session.settings, session.build).items;
    return pool.some(entry => entry.item.id === ${JSON.stringify(replacementBeforeUndo)}) && !pool.some(entry => entry.item.id === ${JSON.stringify(discardedByActions[0])});
  })`), 'Undo returns the replacement to the pool while its discarded original remains blocked');
  await app.evaluate("document.querySelector('#build-item-random').click()");
  await app.until("!document.querySelector('#build-item-random').disabled");
  assert.equal((await readSession()).build.history.length, replacementUndoSnapshot.history.length + 1);
  assert.equal(await app.evaluate("document.querySelector('#build-reroll-button').disabled"), true, 'Spent build reroll stays disabled on a newly drawn slot');
  await setBuildTiers([1, 2]);
  await replaceLastBuildItem('upgrade', 2);
  await setBuildTiers([2]);
  await app.evaluate("document.querySelector('#build-item-random').click()");
  await app.until("!document.querySelector('#build-item-random').disabled");
  assert.ok((await readSession()).build.history.length >= 2 && (await readSession()).build.history.length <= 4, 'New draws and recipe upgrades respect real inventory capacity');
  assert.equal(await app.evaluate("document.querySelector('#build-upgrade-button').disabled"), true, 'Spent build upgrade stays disabled on a newly drawn slot');
  await setBuildTiers([1, 2]);
  await replaceLastBuildItem('downgrade', 1);
  await setBuildTiers(startingBuildTiers);
  assert.deepEqual((await readSession()).itemActions, normalActionSnapshot, 'Build modifications leave ordinary roulette charges untouched');
  for (let draws = 0; (await readSession()).build.history.length < 12 && draws < 80; draws++) {
    await app.evaluate("document.querySelector('#build-item-random').click()");
    const committed = (await readSession()).build;
    assert.ok(committed.history.length <= 12, 'Each draw coalesces upgrades before applying the twelve-slot cap');
    await app.until(`{
      const build = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).build;
      const scanner = document.querySelector('#build-item-scanner');
      const latest = build.history.find(entry => entry.drawId === build.latestDrawId);
      scanner.dataset.state === 'revealed' && latest && !document.querySelector('#build-new-button').disabled
        && scanner.dataset.itemId === (latest.comboOrigin || latest.ticketId || latest.itemId);
    }`);
  }
  saved = await readSession();
  assert.equal(saved.build.history.length, 12, 'Repeated valid draws can fill all slots despite recipe merges');
  await assertPurchaseRoute(saved.build.purchasePlan);
  assert.ok(saved.build.purchasePlan.length >= saved.build.history.length, 'A complete inventory retains its earlier component purchases');
  assert.ok(await app.evaluate(`{
    const route = document.querySelector('#build-purchase-plan').getBoundingClientRect();
    const inventory = document.querySelector('#build-inventory').getBoundingClientRect();
    const actions = document.querySelector('.build-inventory-actions').getBoundingClientRect();
    route.top >= inventory.bottom - 1 && route.bottom <= actions.top + 1;
  }`), 'The readable purchase route sits directly below all twelve inventory cells and before Draw');
  assert.equal(new Set(saved.build.history.map(entry => entry.itemId)).size, 12, 'A complete inventory has twelve unique items');
  assert.ok(saved.build.history.every(entry => !saved.build.discardedItemIds.includes(entry.itemId)), 'Discarded originals never reappear unless their transaction was explicitly undone');
  assert.deepEqual(await app.evaluate("['reroll', 'upgrade', 'downgrade'].map(action => document.querySelector('#build-' + action + '-button').disabled)"), [true, true, true], 'All spent build options remain disabled for later inventory slots');
  assert.equal(await app.evaluate("document.querySelectorAll('#build-inventory [data-build-item-id]').length"), 12, 'All twelve final items occupy visible inventory slots');
  assert.ok(await app.evaluate(`Promise.all([import('./draw-rules.js'), import('./build-inventory.js'), import('./catalog-data.js')]).then(([draw, inventory, { default: catalog }]) => {
    const session = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
    return draw.calculateBuildDistribution(catalog.items, session.settings, session.build, { pairsEnabled: false }).items.every(entry => inventory.canApplyBuildTicket(session.build, entry.item, catalog.items).slotCount <= 12);
  })`), 'A full inventory offers only replacements or merges that fit within its real capacity');
  if (!reducedMotion) assert.ok(await app.evaluate("document.querySelector('.contract-seal')?.textContent.includes('12 / 12')"), 'The twelfth landing triggers its contract completion seal');
  await setBuildTiers([]);
  await app.evaluate("document.querySelector('#build-item-random').click(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))");
  assert.equal((await readSession()).build.history.length, 12, 'The mouse and keyboard cannot overfill the twelve-slot inventory');
  await setBuildTiers(startingBuildTiers);
  assert.deepEqual(saved.history, normalHistory, 'Completing a build leaves ordinary roulette progress unchanged');
  const beforePoster = saved.build;
  await assertRasterFateMarks();
  await app.evaluate("document.querySelector('#build-poster-button').click()");
  await app.until("document.querySelector('#contract-poster-dialog')?.open && document.querySelector('#contract-poster-preview')?.naturalWidth === 2600");
  const posterHeight = await app.evaluate("document.querySelector('#contract-poster-preview').naturalHeight");
  assert.ok(posterHeight > 1160 && posterHeight <= 4096, 'The match poster expands to include the full purchase route without losing its skill matrix');
  const posterLength = await app.evaluate("window.__smokePosterPNG = document.querySelector('#contract-poster-preview').src; window.__smokePosterPNG.length");
  const posterChunks = [];
  for (let offset = 0; offset < posterLength; offset += 256 * 1024) posterChunks.push(await app.evaluate(`window.__smokePosterPNG.slice(${offset}, ${offset + 256 * 1024})`));
  const posterDataURL = posterChunks.join('');
  await app.evaluate('delete window.__smokePosterPNG');
  assert.ok(posterDataURL.startsWith('data:image/png;base64,'), 'The match poster is a self-contained local PNG');
  await fs.writeFile(contractPosterScreenshot, Buffer.from(posterDataURL.split(',')[1], 'base64'));
  assert.deepEqual((await readSession()).build, beforePoster, 'Opening the poster never changes the live hero, inventory or skill progress');
  await app.evaluate("document.querySelector('#contract-poster-dialog [data-poster-close]').click()");
  await app.until("!document.querySelector('#contract-poster-dialog').open");
  let contractComment = 'Проверка <img src=x onerror="window.__smokeContractXss=true">\nОчень приятно ★';
  await app.evaluate(`{
    const input = document.querySelector('#build-contract-name');
    input.value = 'Nightfall / Проверка <archive>';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-build-contract-rating="4"]').click();
    const comment = document.querySelector('#build-contract-comment');
    comment.value = ${JSON.stringify(contractComment)};
    comment.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#build-contract-save').click();
  }`);
  await app.until("document.querySelectorAll('#build-contract-gallery [data-build-contract-id]').length === 1");
  const savedContractId = await app.evaluate("document.querySelector('#build-contract-gallery [data-build-contract-id]').dataset.buildContractId");
  assert.equal((await readSession()).contracts[0].name, 'Nightfall / Проверка <archive>', 'Custom contract names are saved with the build');
  assert.equal((await readSession()).contracts[0].rating, 4, 'The selected star rating is saved with the contract');
  assert.equal((await readSession()).contracts[0].comment, contractComment, 'Multiline comments retain their exact text');
  assert.ok(await app.evaluate("document.querySelector('#build-contract-gallery').textContent.includes('Nightfall / Проверка <archive>')"), 'Saved contracts preserve readable custom names without interpreting HTML');
  assert.equal(await app.evaluate("document.querySelector('#build-contract-gallery .build-contract-comment').textContent"), contractComment, 'Archive comments display safely as text');
  assert.equal(await app.evaluate("document.querySelector('#build-contract-gallery .build-contract-comment img') === null && !window.__smokeContractXss"), true, 'Comment markup cannot execute inside the offline app');
  assert.equal(await app.evaluate("document.querySelectorAll('#build-contract-gallery .build-contract-rating .is-lit').length"), 4, 'Saved contracts display exactly their selected star rating');
  const archivedBeforeReview = (await readSession()).contracts[0];
  assert.deepEqual(archivedBeforeReview.build.purchasePlan, (await readSession()).build.purchasePlan, 'Saving a contract keeps its full purchase route including consumed components');
  const liveBeforeReview = (await readSession()).build;
  await app.evaluate(`document.querySelector('[data-build-contract-preview="${savedContractId}"]').click()`);
  await app.until("document.querySelector('#build-contract-dialog').open");
  await assertPurchaseRoute(archivedBeforeReview.build.purchasePlan, '#build-contract-dialog .build-preview-purchase-plan');
  const preview = await app.evaluate("document.querySelector('#build-contract-dialog').textContent");
  assert.ok(preview.includes(archivedBeforeReview.name), 'Archive preview identifies the requested saved contract');
  assert.equal(await app.evaluate("document.querySelectorAll('#build-contract-dialog [data-build-preview-item-id]').length"), 12, 'The archive preview displays all twelve saved item slots');
  assert.equal(await app.evaluate("document.querySelectorAll('.build-preview-skills .build-timeline-row').length"), 4, 'The archive preview displays the complete saved ability timeline');
  assert.equal(await app.evaluate("document.querySelectorAll('.build-preview-skills input[type=checkbox]').length"), 0, 'The archive preview cannot change saved skill progress');
  assert.ok(await app.evaluate(`Promise.all([import('./hero-data.js'), import('./catalog-data.js')]).then(([{ default: heroes }, { default: catalog }]) => {
    const text = document.querySelector('#build-contract-dialog').textContent;
    const hero = heroes.heroes.find(hero => hero.id === ${JSON.stringify(archivedBeforeReview.build.heroId)});
    return Boolean(hero && text.includes(hero.name) && ${JSON.stringify(archivedBeforeReview.build.history.map(entry => entry.itemId))}.every(id => {
      const item = catalog.items.find(item => item.id === id); return item && text.includes(item.name);
    }));
  })`), 'The preview shows the saved hero and every inventory item');
  assert.deepEqual((await readSession()).build, liveBeforeReview, 'Readonly preview preserves the current live build');
  const previewShot = await app.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(contractPreviewScreenshot, Buffer.from(previewShot.data, 'base64'));
  await app.evaluate("document.querySelector('#build-contract-dialog-close').click()");
  await app.until("!document.querySelector('#build-contract-dialog').open");
  await app.evaluate(`document.querySelector('[data-build-contract-edit="${savedContractId}"]').click()`);
  await app.until("document.querySelector('#build-contract-dialog').open");
  contractComment = 'После матча: 5/5 <b>проверка текста</b>\nБез новой копии.';
  await app.evaluate(`{
    document.querySelector('[data-build-contract-edit-rating="5"]').click();
    const comment = document.querySelector('#build-contract-edit-comment');
    comment.value = ${JSON.stringify(contractComment)};
    comment.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#build-contract-edit-save').click();
  }`);
  await app.until("!document.querySelector('#build-contract-dialog').open");
  saved = await readSession();
  assert.equal(saved.contracts.length, 1, 'Reviewing an archived build never creates another copy');
  assert.equal(saved.contracts[0].id, savedContractId, 'Post-match reviews update the same contract id');
  assert.equal(saved.contracts[0].rating, 5, 'Existing saved build ratings can be changed after a match');
  assert.equal(saved.contracts[0].comment, contractComment, 'Existing saved build comments can be changed after a match');
  assert.equal(saved.contracts[0].savedAt, archivedBeforeReview.savedAt, 'Reviews preserve the original archive timestamp');
  assert.equal(saved.contracts[0].name, archivedBeforeReview.name, 'Reviews preserve the saved name');
  assert.deepEqual(saved.contracts[0].build, archivedBeforeReview.build, 'Reviews leave the archived hero, inventory and leveling snapshot unchanged');
  assert.deepEqual(saved.build, liveBeforeReview, 'Post-match reviews leave the currently active build unchanged');
  const exportedContract = await app.evaluate(`Promise.all([import('./session.js'), import('./catalog-data.js')]).then(([{ serializeSession, parseSessionJSON }, { default: catalog }]) => {
    const json = serializeSession(JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})));
    return parseSessionJSON(json, catalog.items).contracts[0];
  })`);
  assert.equal(exportedContract.rating, 5, 'Session JSON export/import retains edited contract ratings');
  assert.equal(exportedContract.comment, contractComment, 'Session JSON export/import retains contract comments');
  const savedContractInventory = (await readSession()).build.history;
  const savedContractPlan = (await readSession()).build.skillPlan;
  await app.evaluate(`document.querySelector('[data-build-contract-load="${savedContractId}"]').click()`);
  saved = await readSession();
  assert.deepEqual(saved.build.checkedSkills, [], 'Replaying a saved contract resets skill progress');
  assert.deepEqual(saved.build.history, savedContractInventory, 'Replaying a saved contract restores its exact inventory');
  assert.deepEqual(saved.build.skillPlan, savedContractPlan, 'The restored contract keeps its exact leveling plan');
  assert.equal(saved.contracts[0].rating, 5, 'Replaying leaves the edited star rating intact');
  assert.equal(saved.contracts[0].comment, contractComment, 'Replaying leaves the saved comment intact');
  assert.equal(await app.evaluate("document.querySelector('#build-contract-comment').value"), contractComment, 'Replayed contracts restore the comment editor');
  assert.equal(await app.evaluate(`document.querySelector('[data-build-contract-rating="5"]').getAttribute('aria-pressed')`), 'true', 'Replayed contracts restore the edited selected stars');
  await app.evaluate(`document.querySelector('[data-build-skill-index="0"]').click()`);
  await app.evaluate("document.querySelector('[data-build-toggle-tier=\"4\"]').click(); document.querySelector('#build-dynamic-weights').click()");
  saved = await readSession();
  assert.deepEqual(saved.build.enabledTiers, [1, 2, 3], 'Build-specific tier choices can be remembered without changing saved contracts');
  assert.equal(saved.build.dynamicWeights, false);
  const buildSnapshot = saved.build;
  await app.evaluate("document.querySelector('#catalog-toggle-button').click()");
  await app.until("document.querySelector('#toast').hidden && !document.querySelector('.contract-seal')", 6000);
  const nativeBuildShot = await app.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(nativeBuildScreenshot, Buffer.from(nativeBuildShot.data, 'base64'));
  console.log(JSON.stringify({ stage: 'native-build-screenshot', path: nativeBuildScreenshot }));
  mark('legacy-build-2k-emulation-start');
  await app.call('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false });
  mark('legacy-build-2k-emulation-complete');
  await app.reload();
  await app.until("Number(document.querySelector('#total-count')?.textContent) > 0 && !document.querySelector('button[data-mode=roulette]').disabled");
  await sleep(150);
  const metrics = await app.call('Page.getLayoutMetrics');
  // CDP's screenshot clip is in device-independent pixels, including page zoom.
  const size = metrics.contentSize || metrics.cssContentSize;
  mark('legacy-build-2k-capture-start', { contentSize: size, cssContentSize: metrics.cssContentSize, captureBeyondViewport: false });
  // The native full-page screenshot above already covers every lower section.
  // A bounded 2K capture avoids Chromium offscreen full-page surface failures
  // at enlarged zoom, while directly checking the user's actual viewport.
  await app.evaluate("document.querySelector('.build-top-grid').scrollIntoView({ block: 'center', behavior: 'instant' })");
  const buildShot = await app.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  mark('legacy-build-2k-captured', { encodedBytes: buildShot.data.length });
  await fs.writeFile(buildScreenshot, Buffer.from(buildShot.data, 'base64'));
  await app.call('Emulation.clearDeviceMetricsOverride');
  assertNoErrors(app.failures);
  await app.close();
  mark('legacy-relaunch-start');
  app = await launch();
  mark('legacy-relaunch-ready');
  await assertZoom(1.5);
  saved = await readSession();
  assert.equal(saved.preferences.mode, 'build', 'Selected workspace persists after relaunch');
  assert.equal(saved.preferences.catalogVisible, false, 'Hidden catalog stays hidden after relaunch');
  assert.equal(await app.evaluate("document.querySelector('#catalog').hidden"), true);
  assert.equal(saved.preferences.musicVolume, .37);
  assert.equal(saved.preferences.musicTrack, selectedMusicTrack, 'The chosen new OST survives a full portable relaunch');
  assert.equal(saved.preferences.soundVolume, .63);
  assert.equal(saved.preferences.uiVolume, .41);
  assert.equal(saved.preferences.voiceVolume, .53);
  assert.equal(saved.preferences.voices, true, 'Hero voice preferences survive a full portable relaunch');
  assert.equal(saved.preferences.soundStyle, 'crystal', 'The selected roulette sound survives a full portable relaunch');
  assert.equal(saved.preferences.uiSound, false, 'Interface mute persists separately from other channels');
  assert.deepEqual(saved.build, buildSnapshot, 'Hero, item inventory, skill order, filters and checkmarks survive relaunch');
  assert.deepEqual(saved.itemActions, normalActionSnapshot, 'Spent ordinary action charges survive a full portable relaunch');
  assert.deepEqual(await app.evaluate("['reroll', 'upgrade', 'downgrade'].map(action => document.querySelector('#build-' + action + '-button').disabled)"), [true, true, true], 'Spent build action buttons remain disabled after reopening the executable');
  assert.equal(await app.evaluate("document.querySelectorAll('#build-contract-gallery [data-build-contract-id]').length"), 1, 'Named contracts survive a full portable relaunch');
  assert.equal(await app.evaluate("document.querySelector('#build-contract-gallery [data-build-contract-id]').dataset.buildContractId"), savedContractId, 'The same saved contract is available after relaunch');
  assert.equal(saved.contracts[0].rating, 5, 'Edited star ratings survive a full portable relaunch');
  assert.equal(saved.contracts[0].comment, contractComment, 'Saved comments survive a full portable relaunch');
  await app.evaluate(`document.querySelector('[data-build-contract-delete="${savedContractId}"]').click()`);
  await app.until("document.querySelectorAll('#build-contract-gallery [data-build-contract-id]').length === 0");
  assert.deepEqual((await readSession()).contracts, [], 'Deleting a contract also removes it from saved state');
  volumeState = await audioState();
  assert.equal(volumeState.musicVolume, .37);
  assert.equal(volumeState.soundVolume, .63);
  assert.equal(volumeState.uiVolume, .41);
  assert.equal(volumeState.voiceVolume, .53);
  assert.equal(volumeState.soundStyle, 'crystal');
  assert.equal(volumeState.uiSoundEnabled, false);
  assert.equal(await app.evaluate('document.documentElement.lang'), 'en', 'Language should persist across portable executable relaunches');
  sound = await audioState();
  assert.equal(sound.musicEnabled, false, 'Music mute should persist across portable executable relaunches');
  assert.equal(sound.musicPlaying, false);
  assert.equal(sound.soundEnabled, false);
  await app.evaluate("document.querySelector('#music-button').click();");
  await app.until("import('./audio.js').then(({ audio }) => audio.state.musicPlaying)");
  const beforeNewConfirmation = (await readSession()).build;
  await app.evaluate("document.querySelector('#build-new-button').click()");
  await app.until("document.querySelector('#build-contract-dialog').open");
  assert.deepEqual((await readSession()).build, beforeNewConfirmation, 'Requesting a new build retains all progress until confirmed');
  await app.evaluate("document.querySelector('#build-confirm-cancel').click()");
  assert.deepEqual((await readSession()).build, beforeNewConfirmation, 'Canceling a new build preserves the selected hero and inventory');
  await app.evaluate("document.querySelector('#build-new-button').click(); document.querySelector('#build-confirm-accept').click()");
  await app.until(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).build.history.length === 0`);
  saved = await readSession();
  assert.equal(saved.build.heroId, null);
  assert.deepEqual(saved.build.skillPlan, []);
  assert.deepEqual(saved.build.itemActions, { usedActions: [], modifiedDrawIds: [] }, 'An explicitly confirmed new build restores its three action charges');
  assert.deepEqual(saved.build.discardedItemIds, [], 'An explicitly confirmed new build clears its discarded-item pool');
  assert.deepEqual(saved.itemActions, normalActionSnapshot, 'Creating a new build leaves ordinary roulette charges untouched');
  assert.deepEqual(saved.history, normalHistory, 'New build preserves ordinary roulette history');
  assert.deepEqual(saved.build.excludedHeroIds, buildSnapshot.excludedHeroIds, 'New build retains enabled hero choices');
  assert.deepEqual(saved.build.enabledTiers, buildSnapshot.enabledTiers, 'New build retains its selected item tiers');
  assert.equal(saved.build.dynamicWeights, buildSnapshot.dynamicWeights, 'New build retains its balancing preference');
  await app.evaluate("document.querySelector('button[data-mode=roulette]').click()");
  assert.equal(await app.evaluate('document.body.dataset.mode'), 'roulette', 'Switching back restores the roulette theme');
  await app.until("Number(getComputedStyle(document.body, '::before').opacity) < .01");
  assert.equal(await app.evaluate("Number(document.querySelector('#drawn-count').textContent)"), normalHistory.length, 'Session should persist across portable executable relaunches');
  await app.evaluate("document.querySelector('#reset-button').click(); document.querySelector('#confirm-reset').click();");
  await app.until("Number(document.querySelector('#drawn-count').textContent) === 0");
  assert.deepEqual((await readSession()).itemActions, { usedActions: [], modifiedDrawIds: [] }, 'Resetting the ordinary session restores its three action charges');
  await assertZoom(1.5);
  }

  // Deterministic native fixtures exercise new rules without depending on luck.
  // Fixtures live only in this isolated smoke profile and use actual catalog IDs.
  async function loadBuildFixture(options = {}) {
    mark('fixture-load-start', { history: options.history || [], allowed: options.allowed, curseChance: options.curseChance ?? 0, pairsEnabled: options.pairsEnabled === true });
    await app.evaluate(`Promise.all([import('./catalog-data.js'), import('./hero-data.js'), import('./build-core.js'), import('./roulette.js')]).then(([{ default: catalog }, { default: heroes }, core, roulette]) => {
      const fixture = ${JSON.stringify(options)};
      const previous = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
      const hero = heroes.heroes.find(hero => hero.id === (fixture.heroId || ${JSON.stringify(selectedHeroId)}));
      const byName = new Map(catalog.items.map(item => [item.name, item]));
      const history = (fixture.history || []).map((name, index) => {
        const item = byName.get(name); if (!item) throw new Error('Unknown fixture item: ' + name);
        return { itemId: item.id, time: index + 1, probability: 1, weight: 1, drawId: 'fixture-' + index, acquiredOrder: index + 1,
          ...(fixture.sealedNames?.includes(name) ? { sealed: true } : {}), ...(fixture.cursedNames?.includes(name) ? { cursed: true } : {}) };
      });
      const allowed = fixture.allowed ? new Set(fixture.allowed.map(name => byName.get(name)?.id)) : null;
      previous.preferences = { ...previous.preferences, mode: 'build', quick: fixture.quick !== false, zoomFactor: fixture.zoomFactor ?? 1,
        curseChance: fixture.curseChance ?? 0, pairsEnabled: fixture.pairsEnabled === true,
        chickenChance: fixture.chickenChance ?? 0, archmotherChance: fixture.archmotherChance ?? 0, hiddenKingChance: fixture.hiddenKingChance ?? 0,
        sound: fixture.sound === true, music: false, uiSound: false, voices: false };
      previous.settings = roulette.normalizeSettings({ ...roulette.DEFAULT_SETTINGS, enabledTiers: fixture.tiers || [1, 2, 3, 4],
        itemWeights: allowed ? Object.fromEntries(catalog.items.map(item => [item.id, allowed.has(item.id) ? 1 : 0])) : {} });
      previous.build = core.createBuildState({ heroId: hero.id, history, enabledTiers: fixture.tiers || [1, 2, 3, 4], dynamicWeights: false,
        ...core.generateSkillPlan(hero, { random: () => .3 }), latestDrawId: history[fixture.latestIndex ?? history.length - 1]?.drawId || null,
        fate: fixture.fate || {} });
      previous.history = []; previous.rouletteResult = null; previous.itemActions = { usedActions: [], modifiedDrawIds: [] };
      previous.contracts = [];
      localStorage.setItem(${JSON.stringify(storageKey)}, JSON.stringify(previous));
    })`);
    await app.reload();
    await app.until("document.body.dataset.mode === 'build' && Boolean(document.querySelector('#build-item-scanner')) && (!document.querySelector('#build-new-button').disabled || document.querySelector('#build-archmother-dialog')?.open || document.querySelector('#build-king-dialog')?.open || document.querySelector('.fate-effects-layer[data-kind=chicken]:not([hidden])'))");
    mark('fixture-load-ready');
    return readSession();
  }
  async function waitBuildLanding() {
    await app.until("document.querySelector('#build-item-scanner').dataset.state === 'revealed' && !document.querySelector('#build-new-button').disabled", 30000);
    return readSession();
  }
  async function captureCurse() {
    await app.evaluate(`import('./audio.js').then(({ audio }) => {
      const original = audio.curse.bind(audio); window.__smokeCurseCalls = 0;
      audio.curse = () => { window.__smokeCurseCalls++; return original(); };
      window.__smokeCurseSamples = []; window.__smokeCurseTiming = { started: null, ended: null };
      const scanner = document.querySelector('#build-item-scanner');
      window.__smokeCurseObserver?.disconnect();
      window.__smokeCurseObserver = new MutationObserver(() => {
        const overlay = scanner.querySelector('.build-curse-flash'), timing = window.__smokeCurseTiming;
        if (overlay && timing.started === null) timing.started = performance.now();
        if (!overlay && timing.started !== null && timing.ended === null) timing.ended = performance.now();
      });
      window.__smokeCurseObserver.observe(scanner, { childList: true, subtree: true });
      clearInterval(window.__smokeCurseTimer);
      window.__smokeCurseTimer = setInterval(() => {
        const overlay = scanner.querySelector('.build-curse-flash');
        window.__smokeCurseSamples.push({ time: performance.now(), state: scanner.dataset.state, cursed: scanner.dataset.cursed,
          omen: Boolean(overlay), phase: overlay?.dataset.phase || '', disabled: document.querySelector('#build-new-button').disabled,
          effects: overlay ? [overlay, ...overlay.querySelectorAll('.build-curse-sigil, .build-curse-sigil i, .build-curse-sigil b')].map(node => ({ animation: getComputedStyle(node).animationName, transform: getComputedStyle(node).transform })) : [],
          actions: ['reroll', 'upgrade', 'downgrade'].every(action => document.querySelector('#build-' + action + '-button').disabled) });
      }, 32);
    })`);
  }
  async function finishCurseCapture(minimum, label, noMotion = false) {
    const capture = await app.evaluate(`{
      clearInterval(window.__smokeCurseTimer); window.__smokeCurseObserver?.disconnect();
      ({ samples: window.__smokeCurseSamples, timing: window.__smokeCurseTiming, calls: window.__smokeCurseCalls });
    }`);
    assert.equal(capture.calls, 1, `${label}: one curse plays exactly one accent`);
    assert.ok(capture.timing.started !== null && capture.timing.ended !== null, `${label}: the curse has a measured appearance and removal`);
    const elapsed = capture.timing.ended - capture.timing.started;
    assert.ok(elapsed >= minimum && elapsed < minimum + 2000, `${label}: the warning stays readable (${elapsed.toFixed(0)} ms)`);
    for (const phase of ['appear', 'hold', 'disappear']) assert.ok(capture.samples.some(sample => sample.omen && sample.phase === phase), `${label}: the curse displays its ${phase} phase`);
    assert.ok(capture.samples.filter(sample => sample.state === 'scanning' || sample.omen).every(sample => sample.disabled && sample.actions), `${label}: interaction remains locked throughout its reels and warning`);
    if (noMotion) {
      const effects = capture.samples.filter(sample => sample.omen).flatMap(sample => sample.effects);
      assert.ok(effects.length && effects.every(effect => effect.animation === 'none'), 'Reduced motion keeps the curse readable without animated sigils');
      const signatures = capture.samples.filter(sample => sample.omen && sample.effects.length).map(sample => JSON.stringify(sample.effects.map(effect => effect.transform)));
      assert.equal(new Set(signatures).size, 1, 'Reduced motion keeps sigil transforms static across all three phases');
    }
    return capture;
  }
  const rulesFixtureScreenshot = path.join(root, '.smoke-data', 'desktop-upgrade-merge.png');
  const pairFixtureScreenshot = path.join(root, '.smoke-data', 'desktop-double-item.png');
  const curseFixtureScreenshot = path.join(root, '.smoke-data', 'desktop-cursed-item.png');
  let fixture = await loadBuildFixture({
    history: ['Mystic Vulnerability', 'Weakening Headshot', 'Escalating Exposure', 'Spirit Resilience', 'Torment Pulse'],
  });
  const idsByName = await app.evaluate("import('./catalog-data.js').then(({ default: catalog }) => Object.fromEntries(catalog.items.map(item => [item.name, item.id])))");
  assert.equal(fixture.build.history.length, 4, 'Opening a legacy build coalesces its owned component and upgrade automatically');
  assert.equal(fixture.build.purchasePlan.length, 5, 'Migration keeps the original base purchase even after its inventory slot is merged');
  await assertPurchaseRoute(fixture.build.purchasePlan);
  assert.ok(fixture.build.purchasePlan.some(entry => entry.itemId === idsByName['Mystic Vulnerability']), 'The old component remains readable in the migrated purchase route');
  assert.equal(fixture.build.history[0].itemId, idsByName['Escalating Exposure'], 'A merged upgrade keeps the earliest component purchase position');
  assert.ok(fixture.build.discardedItemIds.includes(idsByName['Mystic Vulnerability']), 'Merged lower-tier components remain consumed');
  assert.equal(await app.evaluate(`document.querySelectorAll('#build-inventory [data-build-item-id="${idsByName['Mystic Vulnerability']}"]').length`), 0);
  assert.equal(await app.evaluate(`document.querySelectorAll('#build-inventory [data-build-item-id="${idsByName['Escalating Exposure']}"]').length`), 1);
  await fs.writeFile(rulesFixtureScreenshot, Buffer.from((await app.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));

  fixture = await loadBuildFixture({ history: ['Mystic Vulnerability', 'Weakening Headshot'], allowed: ['Escalating Exposure'], tiers: [4] });
  const beforeMerge = fixture.build;
  await app.evaluate("document.querySelector('#build-item-random').click()");
  if (!reducedMotion) await assertPurchaseRoute(beforeMerge.purchasePlan);
  fixture = await waitBuildLanding();
  assert.equal(fixture.build.history.length, beforeMerge.history.length, 'Drawing an upgrade replaces its existing component instead of using an extra slot');
  assert.equal(fixture.build.history[0].itemId, idsByName['Escalating Exposure']);
  assert.equal(latestBuildEntry(fixture.build).itemId, idsByName['Escalating Exposure'], 'The current result follows the upgrade even though it is in the first slot');
  assert.equal(fixture.build.purchasePlan.length, beforeMerge.purchasePlan.length + 1, 'An upgrade appends a purchase instead of erasing its earlier component');
  assert.deepEqual(fixture.build.purchasePlan.slice(0, -1), beforeMerge.purchasePlan, 'The upgrade preserves the earlier purchase steps and metadata');
  assert.equal(fixture.build.purchasePlan.at(-1).itemId, idsByName['Escalating Exposure']);
  assert.ok(fixture.build.purchasePlan.at(-1).upgradeFromIds.includes(idsByName['Mystic Vulnerability']));
  await assertPurchaseRoute(fixture.build.purchasePlan);
  await app.evaluate("document.querySelector('#build-item-undo').click()");
  assert.deepEqual((await readSession()).build.history, beforeMerge.history, 'Undo restores the component and the exact purchase order before a live merge');
  assert.deepEqual((await readSession()).build.purchasePlan, beforeMerge.purchasePlan, 'Undo removes the upgrade purchase and restores the original route');
  await assertPurchaseRoute((await readSession()).build.purchasePlan);

  const fullMergeScreenshot = path.join(root, '.smoke-data', 'desktop-full-inventory-purchase-plan.png');
  await app.call('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false });
  fixture = await loadBuildFixture({
    history: ['Mystic Vulnerability', 'Mystic Shot', 'Weakening Headshot', 'Recharging Rush', 'Spirit Resilience', 'Torment Pulse', 'Bullet Resilience', 'Healbane', 'Return Fire', 'Restorative Locket', 'Active Reload', 'Fleetfoot'],
    allowed: ['Escalating Exposure'], tiers: [4], zoomFactor: 1.5,
  });
  assert.equal(fixture.build.history.length, 12);
  const beforeFullMerge = fixture.build;
  assert.equal(await app.evaluate("document.querySelector('#build-item-random').disabled"), false, 'A full inventory can still roll an upgrade that consumes its owned component');
  await app.evaluate("document.querySelector('#build-item-random').click()");
  fixture = await waitBuildLanding();
  assert.equal(fixture.build.history.length, 12, 'The full-inventory upgrade stays inside the twelve-slot capacity');
  assert.equal(fixture.build.purchasePlan.length, 13, 'The purchase route can grow past twelve steps without adding inventory slots');
  assert.equal(fixture.build.purchasePlan[0].itemId, idsByName['Mystic Vulnerability']);
  assert.equal(fixture.build.purchasePlan.at(-1).itemId, idsByName['Escalating Exposure']);
  await assertPurchaseRoute(fixture.build.purchasePlan);
  const compactScanner = await app.evaluate(`({ viewport: parseFloat(getComputedStyle(document.querySelector('#build-item-scanner .build-reel-viewport')).height), total: document.querySelector('#build-item-scanner').getBoundingClientRect().height })`);
  assert.ok(compactScanner.viewport <= 170 && compactScanner.total <= 240, `The item scanner remains compact: ${JSON.stringify(compactScanner)}`);
  assert.ok(await app.evaluate('document.documentElement.scrollWidth <= innerWidth + 2'), 'The purchase route and compact scanner fit a 2K screen at 150%');
  await app.evaluate("document.querySelector('.build-top-grid').scrollIntoView({ block: 'center', behavior: 'instant' })");
  await fs.writeFile(fullMergeScreenshot, Buffer.from((await app.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
  await app.until("!document.querySelector('.contract-seal') && document.querySelector('#toast').hidden", 7000);
  await fs.writeFile(nativeBuildScreenshot, Buffer.from((await app.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
  await app.evaluate("document.querySelector('#build-purchase-plan').scrollIntoView({ block: 'start', behavior: 'instant' })");
  await fs.writeFile(path.join(root, '.smoke-data', 'desktop-build-route-native.png'), Buffer.from((await app.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
  await app.evaluate("document.querySelector('.build-skill-panel').scrollIntoView({ block: 'center', behavior: 'instant' })");
  await fs.writeFile(path.join(root, '.smoke-data', 'desktop-build-skills-native.png'), Buffer.from((await app.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
  await app.evaluate("document.querySelector('#build-item-undo').click()");
  assert.deepEqual((await readSession()).build.purchasePlan, beforeFullMerge.purchasePlan, 'Undo of a full-inventory merge restores all twelve original purchase steps');
  assert.deepEqual((await readSession()).build.history, beforeFullMerge.history);
  await app.call('Emulation.clearDeviceMetricsOverride');

  const lateHistory = ['Mystic Shot', 'Weakening Headshot', 'Recharging Rush', 'Spirit Resilience', 'Torment Pulse', 'Bullet Resilience'];
  fixture = await loadBuildFixture({ history: lateHistory, allowed: ['Monster Rounds'], tiers: [1] });
  const beforeStarter = fixture.build;
  await app.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 900, deviceScaleFactor: 1, mobile: false });
  // Offscreen Electron needs a fresh compositor after viewport emulation.
  await app.reload();
  await app.evaluate("document.fonts.ready");
  await app.evaluate("window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior: 'instant' })");
  await sleep(100);
  mark('starter-scroll-before', await app.evaluate("({ scroll: window.scrollY, top: document.querySelector('.build-top-grid').getBoundingClientRect().top, height: document.querySelector('.build-top-grid').getBoundingClientRect().height })"));
  await app.evaluate("document.querySelector('#build-item-random').click()");
  await sleep(1500);
  const centeredStages = await app.evaluate(`{
    const rect = document.querySelector('.build-top-grid').getBoundingClientRect();
    const expected = Math.max(0, window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2);
    ({ actual: window.scrollY, expected, horizontal: window.scrollX, innerHeight: window.innerHeight, regionTop: rect.top, regionHeight: rect.height, scanner: document.querySelector('#build-item-scanner').getBoundingClientRect().top });
  }`);
  mark('starter-scroll-geometry', centeredStages);
  assert.ok(Math.abs(centeredStages.actual - centeredStages.expected) < 12, `Draw an item smoothly centers the hero and inventory region in the viewport: ${JSON.stringify(centeredStages)}`);
  if (centeredStages.expected > 15) assert.ok(centeredStages.actual > 15, 'Drawing from the bottom no longer jumps to the top of the document');
  assert.equal(centeredStages.horizontal, 0, 'Centering the stages preserves horizontal alignment');
  fixture = await waitBuildLanding();
  const starterIndex = fixture.build.history.findIndex(entry => entry.itemId === idsByName['Monster Rounds']);
  assert.ok(starterIndex >= 0 && starterIndex <= 4, 'A late T1 item enters one of the first five purchase positions');
  assert.deepEqual(fixture.build.history.filter(entry => entry.itemId !== idsByName['Monster Rounds']), beforeStarter.history, 'Starter insertion shifts existing items without scrambling their purchase order');
  const starterPlanIndex = fixture.build.purchasePlan.findIndex(entry => entry.itemId === idsByName['Monster Rounds']);
  assert.ok(starterPlanIndex >= 0 && starterPlanIndex <= 4, 'The late starter is also inserted among the first five purchase steps');
  assert.deepEqual(fixture.build.purchasePlan.filter(entry => entry.itemId !== idsByName['Monster Rounds']), beforeStarter.purchasePlan, 'Starter insertion preserves the existing purchase sequence');
  await assertPurchaseRoute(fixture.build.purchasePlan);
  assert.equal(latestBuildEntry(fixture.build).itemId, idsByName['Monster Rounds']);
  assert.equal(await app.evaluate("document.querySelector('#build-item-scanner').dataset.itemId"), idsByName['Monster Rounds']);
  await app.evaluate("document.querySelector('#build-item-undo').click()");
  assert.deepEqual((await readSession()).build.history, beforeStarter.history, 'Undo of a starter insertion restores all shifted positions');
  assert.deepEqual((await readSession()).build.purchasePlan, beforeStarter.purchasePlan, 'Undo restores every shifted purchase step');
  await app.call('Emulation.clearDeviceMetricsOverride');

  fixture = await loadBuildFixture({ history: ['Monster Rounds', ...lateHistory], latestIndex: 0, allowed: ['Enduring Speed'], tiers: [1, 2] });
  const olderLastEntry = fixture.build.history.at(-1);
  assert.equal(await app.evaluate("document.querySelector('#build-upgrade-button').disabled"), false, 'Upgrade targets the last rolled T1 even when its visual cell is first');
  await app.evaluate("document.querySelector('#build-upgrade-button').click()");
  fixture = await waitBuildLanding();
  assert.equal(latestBuildEntry(fixture.build).itemId, idsByName['Enduring Speed']);
  assert.ok(!fixture.build.history.some(entry => entry.itemId === idsByName['Monster Rounds']), 'The inserted starter is replaced by the selected special action');
  assert.deepEqual(fixture.build.history.find(entry => entry.itemId === olderLastEntry.itemId), olderLastEntry, 'The item in the last visual slot remains unchanged');

  await loadBuildFixture({ heroId: '6', pairsEnabled: true });
  const incompatibleTickets = await app.evaluate(`Promise.all([import('./draw-rules.js'), import('./game-item-rules.js'), import('./catalog-data.js')]).then(([draw, rules, { default: catalog }]) => {
    const state = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
    return draw.calculateBuildDistribution(catalog.items, state.settings, state.build, { pairsEnabled: true }).items.filter(entry => (entry.item.itemIds || [entry.item.id]).some(id => rules.CHARGE_ITEM_IDS.includes(id))).map(entry => entry.item.id);
  })`);
  assert.deepEqual(incompatibleTickets, [], 'A hero without charged signature abilities receives neither charge items nor charge-dependent pairs');

  fixture = await loadBuildFixture({ allowed: ['Mystic Shot', 'Express Shot'], tiers: [2, 3], pairsEnabled: true });
  const pairDistribution = await app.evaluate(`Promise.all([import('./draw-rules.js'), import('./catalog-data.js')]).then(([draw, { default: catalog }]) => {
    const state = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
    return draw.calculateBuildDistribution(catalog.items, state.settings, state.build, { pairsEnabled: true }).items.map(entry => entry.item.id);
  })`);
  assert.deepEqual(new Set(pairDistribution), new Set([idsByName['Mystic Shot'], idsByName['Express Shot'], 'combo:mystic-express']), 'A pair is an additional draw outcome beside its two ordinary item tickets');
  await app.evaluate(`{
    window.__smokeOriginalRandom = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = values => {
      if (values instanceof Uint32Array && values.length === 2) { values[0] = 0xffffffff; values[1] = 0xffffffff; return values; }
      return window.__smokeOriginalRandom(values);
    };
  }`);
  await captureReel('#build-item-scanner');
  await app.evaluate("document.querySelector('#build-item-random').click()");
  fixture = await waitBuildLanding();
  await app.evaluate("crypto.getRandomValues = window.__smokeOriginalRandom; delete window.__smokeOriginalRandom");
  assert.equal(fixture.build.history.length, 2, 'A double draw fills two real inventory slots');
  assert.deepEqual(new Set(fixture.build.history.map(entry => entry.itemId)), new Set([idsByName['Mystic Shot'], idsByName['Express Shot']]));
  assert.ok(fixture.build.history.every(entry => entry.comboOrigin === 'combo:mystic-express' && entry.drawId === fixture.build.latestDrawId));
  await assertPurchaseRoute(fixture.build.purchasePlan);
  assert.equal(fixture.build.purchasePlan.length, 2, 'Both components of a double drop are shown as separate purchase steps');
  assert.equal(await app.evaluate("document.querySelectorAll('#build-inventory .build-item-combo-mark').length"), 2, 'Both halves carry their double-drop marker');
  assert.equal(await app.evaluate("document.querySelector('#build-item-scanner .build-reel-card[data-reel-position=center] .build-item-scanner-art').querySelectorAll('img').length"), 2, 'The selected pair displays both original item icons together');
  await assertReel('#build-item-scanner', 'combo:mystic-express', 'Pair');
  await fs.writeFile(pairFixtureScreenshot, Buffer.from((await app.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));

  fixture = await loadBuildFixture({ allowed: ['Mystic Shot', 'Weakening Headshot'], tiers: [2], curseChance: 1, sound: true });
  await captureCurse();
  await app.evaluate("document.querySelector('#build-item-random').click()");
  assert.equal((await readSession()).build.history.length, 2, 'A curse and its locked extra result are committed together before either animation finishes');
  fixture = await waitBuildLanding();
  const quickCurse = await finishCurseCapture(1700, 'Quick curse');
  const curseSamples = quickCurse.samples;
  assert.equal(fixture.build.history.filter(entry => entry.cursed).length, 1, 'A hundred-percent curse causes exactly one extra locked item and never recurses');
  assert.equal(latestBuildEntry(fixture.build).cursed, true);
  assert.equal(await app.evaluate("window.__smokeCurseCalls"), 1, 'The curse transition plays its original sound exactly once');
  assert.equal((await audioState()).curseSource, 'assets/audio/curse.mp3');
  if (!reducedMotion) {
    assert.ok(curseSamples.some(sample => sample.state === 'scanning' && sample.cursed !== 'true'), 'The first reel remains a normal selection');
    assert.ok(curseSamples.some(sample => sample.state === 'scanning' && sample.cursed === 'true'), 'The curse runs its second reel with a visible lock treatment');
    assert.ok(curseSamples.some(sample => sample.omen), 'The extra item has its own curse reveal effect');
    assert.ok(curseSamples.filter(sample => sample.state === 'scanning' || sample.omen).every(sample => sample.disabled && sample.actions), 'Interaction stays locked across both reels and the intervening curse reveal');
  }
  assert.equal(await app.evaluate("document.querySelectorAll('#build-inventory .build-item-slot.is-cursed .build-item-lock').length"), 1, 'The extra item keeps a visible lock in the inventory');
  await assertLockOnIcon();
  await assertPurchaseRoute(fixture.build.purchasePlan);
  assert.equal(fixture.build.purchasePlan.filter(entry => entry.cursed).length, 1, 'The purchase route preserves the locked forced purchase');
  assert.equal(await app.evaluate("document.querySelector('#build-item-scanner').dataset.cursed"), 'true');
  assert.deepEqual(await app.evaluate("['reroll', 'upgrade', 'downgrade'].map(action => document.querySelector('#build-' + action + '-button').disabled)"), [true, true, true]);
  assert.equal(await app.evaluate("document.querySelector('#build-item-undo').disabled"), true, 'Undo cannot bypass a cursed item lock');
  const lockedSnapshot = fixture.build;
  await app.evaluate("['reroll', 'upgrade', 'downgrade'].forEach(action => document.querySelector('#build-' + action + '-button').click()); document.querySelector('#build-item-undo').click()");
  assert.deepEqual((await readSession()).build, lockedSnapshot, 'Disabled cursed item actions cannot alter or remove the forced result');
  await fs.writeFile(curseFixtureScreenshot, Buffer.from((await app.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
  const cursedPurchasePlan = fixture.build.purchasePlan;
  await app.evaluate(`{
    const name = document.querySelector('#build-contract-name'); name.value = 'Curse purchase route'; name.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#build-contract-save').click();
  }`);
  const cursedContract = (await readSession()).contracts[0];
  assert.deepEqual(cursedContract.build.purchasePlan, cursedPurchasePlan, 'An archived cursed build preserves its entire purchase route and lock');
  await app.evaluate(`document.querySelector('[data-build-contract-preview="${cursedContract.id}"]').click()`);
  await app.until("document.querySelector('#build-contract-dialog').open");
  await assertPurchaseRoute(cursedPurchasePlan, '#build-contract-dialog .build-preview-purchase-plan');
  await assertLockOnIcon('#build-contract-dialog');
  await app.evaluate("document.querySelector('#build-contract-dialog-close').click()");
  await app.evaluate(`{
    const chance = document.querySelector('#build-curse-chance'); chance.value = '37'; chance.dispatchEvent(new Event('input', { bubbles: true }));
    const pairs = document.querySelector('#build-pairs-enabled'); pairs.checked = true; pairs.dispatchEvent(new Event('change', { bubbles: true }));
  }`);
  assert.equal((await readSession()).preferences.curseChance, .37);
  assert.equal((await readSession()).preferences.pairsEnabled, true);
  assert.equal(await app.evaluate("document.querySelector('#curse-chance').value"), '37', 'Both workspaces reflect the same saved curse chance');
  await app.close(); app = await launch();
  assert.equal((await readSession()).preferences.curseChance, .37, 'The custom curse chance survives a complete native relaunch');
  assert.equal((await readSession()).preferences.pairsEnabled, true);
  assert.equal(await app.evaluate("document.querySelector('#build-curse-chance').value"), '37');
  assert.equal(await app.evaluate("document.querySelector('#build-pairs-enabled').checked"), true);
  assert.equal(await app.evaluate("document.querySelectorAll('#build-inventory .build-item-slot.is-cursed .build-item-lock').length"), 1, 'Cursed item locks survive a complete native relaunch');
  assert.deepEqual((await readSession()).build.purchasePlan, cursedPurchasePlan, 'The complete purchase route survives a native relaunch');
  assert.deepEqual((await readSession()).contracts[0].build.purchasePlan, cursedPurchasePlan, 'Archived purchase routes survive the same relaunch');
  await assertPurchaseRoute(cursedPurchasePlan);
  await assertLockOnIcon();
  await app.evaluate(`document.querySelector('[data-build-contract-load="${cursedContract.id}"]').click()`);
  assert.deepEqual((await readSession()).build.purchasePlan, cursedPurchasePlan, 'Play Again restores the same purchase route instead of deriving it from twelve final items');
  await assertPurchaseRoute(cursedPurchasePlan);
  assert.equal((await audioState()).soundEnabled, true);
  assert.equal((await audioState()).uiSoundEnabled, false);
  assert.equal((await audioState()).musicEnabled, false);
  await app.evaluate("import('./audio.js').then(({ audio }) => audio.curse())");
  await app.evaluate("document.querySelector('#sound-button').click()");
  assert.equal((await audioState()).cursePlaying, false, 'Muting wheel sounds immediately stops the active curse accent');
  assert.equal((await audioState()).uiSoundEnabled, false, 'Wheel mute leaves the interface preference unchanged');
  assert.equal((await audioState()).musicEnabled, false, 'Wheel mute leaves the music preference unchanged');

  // Normal and reduced-motion modes keep the warning readable independently
  // of reel speed. Reduced motion is set before reload so the app sees it too.
  fixture = await loadBuildFixture({ allowed: ['Mystic Shot', 'Weakening Headshot'], tiers: [2], curseChance: 1, quick: false });
  await captureCurse();
  await app.evaluate("document.querySelector('#build-item-random').click()");
  await waitBuildLanding();
  await finishCurseCapture(2700, 'Normal curse');
  await app.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  fixture = await loadBuildFixture({ allowed: ['Mystic Shot', 'Weakening Headshot'], tiers: [2], curseChance: 1, quick: true });
  assert.equal(await app.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), true);
  await captureCurse();
  await app.evaluate("document.querySelector('#build-item-random').click()");
  await waitBuildLanding();
  await finishCurseCapture(1700, 'Reduced-motion curse', true);
  await app.call('Emulation.setEmulatedMedia', { features: [] });

  // Fate cases run through real buttons and durable storage. Only the uniform
  // random inputs are queued; UUIDs, animations and the production core remain native.
  const chickenScreenshot = path.join(root, '.smoke-data', 'desktop-chicken.png');
  const archmotherScreenshot = path.join(root, '.smoke-data', 'desktop-archmother.png');
  const kingScreenshot = path.join(root, '.smoke-data', 'desktop-hidden-king.png');
  const newspaperScreenshot = path.join(root, '.smoke-data', 'desktop-newspaper.png');
  const newspaperPNG = path.join(root, '.smoke-data', 'desktop-newspaper-export.png');
  const chickenHoldScreenshot = path.join(root, '.smoke-data', 'desktop-chicken-hold.png');
  const motherSpinningScreenshot = path.join(root, '.smoke-data', 'desktop-archmother-spinning.png');
  const kingMenuScreenshot = path.join(root, '.smoke-data', 'desktop-king-menu.png');
  const kingExchangeScreenshot = path.join(root, '.smoke-data', 'desktop-king-exchange.png');
  const kingFakeScreenshot = path.join(root, '.smoke-data', 'desktop-king-fake.png');
  const fateInfoScreenshot = path.join(root, '.smoke-data', 'desktop-fate-info.png');
  const widePosterScreenshot = path.join(root, '.smoke-data', 'desktop-contract-poster-wide.png');
  async function queueRandom(values) {
    await app.evaluate(`{
      window.__smokeOriginalFateRandom = crypto.getRandomValues.bind(crypto);
      window.__smokeFateRandomQueue = ${JSON.stringify(values)};
      crypto.getRandomValues = array => {
        if (array instanceof Uint32Array && array.length === 2) {
          const value = window.__smokeFateRandomQueue.length ? window.__smokeFateRandomQueue.shift() : 0;
          const integer = Math.floor(value * 0x20000000000000);
          array[0] = Math.floor(integer / 0x100000000) * 2048;
          array[1] = integer % 0x100000000;
          return array;
        }
        return window.__smokeOriginalFateRandom(array);
      };
    }`);
  }
  async function restoreRandom() {
    await app.evaluate(`{ if (window.__smokeOriginalFateRandom) crypto.getRandomValues = window.__smokeOriginalFateRandom;
      delete window.__smokeOriginalFateRandom; delete window.__smokeFateRandomQueue; }`);
  }
  async function captureFateAudio() {
    await app.evaluate(`import('./audio.js').then(({ audio }) => {
      const original = audio.fate.bind(audio); window.__smokeFateKinds = [];
      audio.fate = kind => { window.__smokeFateKinds.push(kind); return original(kind); };
    })`);
  }
  async function waitFateLanding() {
    await app.until("document.querySelector('#build-item-scanner').dataset.state === 'revealed' && !document.querySelector('#build-new-button').disabled && !document.querySelector('#build-archmother-dialog').open && !document.querySelector('#build-king-dialog').open && !document.querySelector('.fate-effects-layer:not([hidden])')", 90000);
    return readSession();
  }
  async function saveViewport(target) {
    await fs.writeFile(target, Buffer.from((await app.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64'));
  }

  async function watchChickenPresentation() {
    await app.evaluate(`{
      window.__smokeChickenTiming = { rolling: null, ready: null, bursts: 0 };
      window.__smokeChickenObserver?.disconnect();
      const inspect = () => {
        const layer = document.querySelector('.fate-effects-layer[data-kind=chicken]:not([hidden])'); if (!layer) return;
        const timing = window.__smokeChickenTiming;
        if (layer.dataset.state === 'rolling' && timing.rolling === null) timing.rolling = performance.now();
        if (layer.dataset.state === 'ready' && timing.ready === null) timing.ready = performance.now();
        timing.bursts = Math.max(timing.bursts, layer.querySelectorAll('.fate-peck-target.is-pecked > .fate-target-feathers.is-scattered').length);
      };
      window.__smokeChickenObserver = new MutationObserver(inspect);
      window.__smokeChickenObserver.observe(document.body, { attributes: true, childList: true, subtree: true }); inspect();
    }`);
  }
  async function awaitChickenReady() {
    await app.until("document.querySelector('.fate-effects-layer[data-kind=chicken]')?.dataset.state === 'ready' && !document.querySelector('#fate-chicken-continue').disabled && !document.querySelector('#fate-chicken-continue').hidden", 25000);
  }
  async function awaitMotherReady() {
    await app.until("document.querySelectorAll('#build-archmother-dialog .build-archmother-reel[data-archmother-reel-state=landed]').length === 3 && Array.from(document.querySelectorAll('#build-archmother-dialog [data-archmother-choice]')).every(button => !button.disabled)", 15000);
  }
  async function forceTicket(name, tail = []) {
    const fraction = await app.evaluate(`Promise.all([import('./catalog-data.js'),import('./draw-rules.js')]).then(([{default:catalog},rules])=>{
      const state=JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));const item=catalog.items.find(item=>item.name===${JSON.stringify(name)});
      const pool=rules.calculateBuildDistribution(catalog.items,state.settings,state.build,{pairsEnabled:state.preferences.pairsEnabled});
      let cumulative=0;for(const entry of pool.items){if(entry.item.id===item.id)return(cumulative+entry.weight/2)/pool.totalWeight;cumulative+=entry.weight;}
      throw new Error('Requested native fixture ticket is unavailable: '+item.name);
    })`);
    await queueRandom([fraction, ...tail]);
  }
  const pendingKingFixture = { kingActive: true, kingMode: null, pendingKing: { id: 'native-king', stage: 'mode', createdAt: 100 },
    journal: [{ id: 'native-king', kind: 'hidden-king', time: 100 }] };
  const royalHistory = ['Mystic Vulnerability', 'Weakening Headshot', 'Spirit Resilience', 'Spirit Lifesteal', 'Weapon Shielding'];

  mark('fate-info-start');
  await loadBuildFixture();
  for (const kind of ['chicken','archmother','king','curse']) {
    await app.evaluate(`document.querySelector('[data-fate-info=${kind}]').click()`);
    await app.until(`document.querySelector('#build-fate-info-dialog').open && document.querySelector('#build-fate-info-dialog').dataset.fateKind === '${kind}'`);
    assert.ok(await app.evaluate("document.querySelector('#build-fate-info-dialog ol').children.length >= 3"));
    if (kind === 'king') await saveViewport(fateInfoScreenshot);
    await app.evaluate("document.querySelector('#build-fate-info-close').click()");
  }

  mark('fate-chicken-start');
  fixture = await loadBuildFixture({ history: ['Mystic Vulnerability', 'Weakening Headshot', 'Spirit Resilience'],
    allowed: ['Mystic Shot', 'Spirit Lifesteal'], tiers: [2, 3], chickenChance: 1 });
  const beforeChicken = fixture.build;
  await captureFateAudio();
  await watchChickenPresentation();
  await queueRandom([0, 0, 0]); // Selection, event chance, uniform D12=1.
  await app.evaluate("document.querySelector('#build-item-random').click()");
  await restoreRandom();
  assert.equal((await readSession()).build.fate.chickenUsed, true, 'Chicken and its deletion are persisted before the cinematic');
  await awaitChickenReady();
  assert.equal(await app.evaluate("document.querySelector('.fate-die').dataset.result"), '1');
  await saveViewport(chickenScreenshot);
  await saveViewport(chickenHoldScreenshot);
  const chickenTiming = await app.evaluate('window.__smokeChickenTiming');
  assert.ok(chickenTiming.ready - chickenTiming.rolling >= 4500, 'Quick D12 keeps its real suspense for at least 4.5 seconds');
  assert.equal(await app.evaluate("document.querySelectorAll('.fate-peck-target.is-pecked').length"), 0, 'No item loss is presented before Continue');
  assert.ok((await readSession()).build.fate.pendingChicken, 'The required Continue gate is durable');
  await sleep(1400);
  assert.equal(await app.evaluate("document.querySelector('.fate-effects-layer[data-kind=chicken]').dataset.state"), 'ready');
  assert.equal(await app.evaluate("document.querySelectorAll('.fate-peck-target.is-pecked').length"), 0, 'The die holds indefinitely instead of automatically pecking');
  await app.evaluate("document.querySelector('#fate-chicken-continue').click()");
  fixture = await waitFateLanding();
  assert.equal(fixture.build.fate.pendingChicken, null);
  assert.equal(await app.evaluate('window.__smokeChickenTiming.bursts'), 1, 'The removed card emits its own feather burst');
  assert.deepEqual(fixture.build.history, beforeChicken.history, 'D12=1 removes the newly drawn individual item');
  assert.deepEqual(fixture.build.purchasePlan, beforeChicken.purchasePlan, 'Chicken prunes the removed purchase from the final route');
  assert.ok(fixture.build.discardedItemIds.some(id => !beforeChicken.discardedItemIds.includes(id)), 'The pecked item stays excluded from the pool');
  assert.equal(await app.evaluate("window.__smokeFateKinds.filter(kind => kind === 'chicken').length"), 1);
  assert.equal(await app.evaluate("document.querySelectorAll('#build-event-history .build-event-entry[data-event-kind=chicken] .build-event-item').length"), 1);
  assert.equal(await app.evaluate("document.querySelector('.build-fate-setting[data-triggered=true] .build-fate-state>b') !== null"), true, 'The patron has a visible used seal');
  await app.evaluate("document.querySelector('#build-item-random').click()");
  fixture = await waitFateLanding();
  assert.equal(fixture.build.fate.chickenUsed, true);
  assert.equal(await app.evaluate("window.__smokeFateKinds.filter(kind => kind === 'chicken').length"), 1, 'A second ordinary draw cannot summon chicken again');
  await app.evaluate("document.querySelector('#build-item-undo').click()");
  assert.equal((await readSession()).build.fate.chickenUsed, true, 'Undo never refunds the chicken event');

  mark('fate-archmother-start');
  await loadBuildFixture({ allowed: ['Mystic Shot', 'Weakening Headshot', 'Express Shot', 'Spirit Resilience'], tiers: [2, 3], archmotherChance: 1 });
  await queueRandom([0, 0, 0, 0]);
  await app.evaluate("document.querySelector('#build-item-random').click()");
  await restoreRandom();
  await app.until("document.querySelector('#build-archmother-dialog').open", 20000);
  const pendingMother = (await readSession()).build.fate.pendingArchmother;
  assert.equal(pendingMother.itemIds.length, 3);
  assert.equal(new Set(pendingMother.itemIds).size, 3);
  assert.equal((await readSession()).build.fate.archmotherUsed, true, 'The event is spent when the persistent offer is created');
  assert.equal((await readSession()).build.history.length, 0, 'No cancelled ordinary draw is hidden behind the three choices');
  assert.equal(await app.evaluate("document.querySelectorAll('#build-archmother-dialog [data-archmother-choice]').length"), 3);
  assert.equal(await app.evaluate("document.querySelectorAll('#build-archmother-dialog .build-archmother-reel[data-archmother-reel-state=spinning]').length"), 3);
  assert.equal(await app.evaluate("Array.from(document.querySelectorAll('#build-archmother-dialog [data-archmother-choice]')).every(button => button.disabled)"), true);
  await saveViewport(motherSpinningScreenshot);
  await awaitMotherReady();
  await saveViewport(archmotherScreenshot);
  await app.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await app.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await app.evaluate("document.querySelector('#build-archmother-dialog').open"), true, 'Closing the offer cannot reroll or discard its choices');
  assert.deepEqual((await readSession()).build.fate.pendingArchmother, pendingMother);
  assertNoErrors(app.failures);
  await app.close(); app = await launch();
  await app.until("document.querySelector('#build-archmother-dialog').open");
  assert.deepEqual((await readSession()).build.fate.pendingArchmother, pendingMother, 'The same three choices survive a full native restart');
  await awaitMotherReady();
  await app.evaluate(`{
    window.__smokeMotherHorizontalStates=[];window.__smokeMotherDrop=false;
    window.__smokeMotherObserver=new MutationObserver(()=>{
      const scanner=document.querySelector('#build-item-scanner');
      window.__smokeMotherHorizontalStates.push(scanner.dataset.state);
      if(scanner.classList.contains('is-archmother-gift'))window.__smokeMotherDrop=true;
    });
    window.__smokeMotherObserver.observe(document.querySelector('#build-item-scanner'),{attributes:true,childList:true,subtree:true});
  }`);
  await app.evaluate("document.querySelector('#build-archmother-dialog [data-archmother-choice=\"2\"]').click()");
  fixture = await waitFateLanding();
  assert.equal(latestBuildEntry(fixture.build).itemId, pendingMother.itemIds[2], 'The selected gift becomes the actual inventory item');
  assert.equal(fixture.build.fate.pendingArchmother, null);
  assert.equal(fixture.build.fate.archmotherUsed, true);
  assert.equal(latestBuildEntry(fixture.build).archmotherOrigin, true);
  const motherPresentation = await app.evaluate('window.__smokeMotherObserver.disconnect(); ({ states:window.__smokeMotherHorizontalStates, drop:window.__smokeMotherDrop })');
  assert.equal(motherPresentation.states.includes('scanning'), false, 'Selecting a stopped Mother reel does not spin the horizontal item scanner again');
  assert.equal(motherPresentation.drop, true, 'The chosen item drops directly into its inventory slot');
  assert.ok(await app.evaluate("document.querySelector('#build-inventory .fate-badge[data-fate-origin=archmother]') !== null"));
  assert.equal(fixture.build.fate.journal.filter(event => event.kind === 'archmother').length, 1);
  await app.evaluate("document.querySelector('#build-item-random').click()");
  fixture = await waitFateLanding();
  assert.equal(fixture.build.history.length, 2);
  assert.equal(await app.evaluate("document.querySelector('#build-archmother-dialog').open"), false, 'A spent Archmother cannot offer a new choice at 100%');

  mark('fate-king-threshold-menu-start');
  await loadBuildFixture({ history: royalHistory.slice(0, 3), hiddenKingChance: 1 });
  await forceTicket('Spirit Lifesteal', [0]);
  await app.evaluate("document.querySelector('#build-item-random').click()");
  await restoreRandom();
  fixture = await waitFateLanding();
  assert.equal(fixture.build.history.length, 4);
  assert.equal(fixture.build.fate.kingActive, false, 'King cannot arrive before five actual inventory items');
  await forceTicket('Mystic Shot', [0]);
  await app.evaluate("document.querySelector('#build-item-random').click()");
  await restoreRandom();
  await app.until("document.querySelector('#build-king-dialog').open", 20000);
  const kingPending = (await readSession()).build.fate.pendingKing;
  assert.equal((await readSession()).build.history.length, 5);
  assert.equal(kingPending.stage, 'mode');
  assert.equal(await app.evaluate("document.querySelectorAll('#build-king-dialog .build-king-contract').length"), 4);
  assert.equal(await app.evaluate("document.querySelectorAll('#build-king-dialog [data-king-available=true]').length"), 4);
  await saveViewport(kingMenuScreenshot);
  await app.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await app.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await app.evaluate("document.querySelector('#build-king-dialog').open"), true);
  assertNoErrors(app.failures);
  await app.close(); app = await launch();
  await app.until("document.querySelector('#build-king-dialog').open");
  assert.deepEqual((await readSession()).build.fate.pendingKing, kingPending, 'The four-mode menu survives full native restart');
  await app.evaluate("document.querySelector('#build-king-dialog [data-king-mode=exchange]').click()");
  await app.until("document.querySelector('#build-king-dialog').open && document.querySelector('#build-king-dialog').dataset.kingStage === 'sacrifice'");
  const exchangePending = (await readSession()).build.fate.pendingKing;
  assert.equal(exchangePending.stage, 'sacrifice');
  await saveViewport(kingExchangeScreenshot);
  assertNoErrors(app.failures);
  await app.close(); app = await launch();
  await app.until("document.querySelector('#build-king-dialog').open && document.querySelector('#build-king-dialog').dataset.kingStage === 'sacrifice'");
  assert.deepEqual((await readSession()).build.fate.pendingKing, exchangePending, 'A restart cannot cancel the selected sacrifice stage');
  const sacrificeIndex = await app.evaluate("Number(document.querySelector('#build-king-dialog [data-king-sacrifice]').dataset.kingSacrifice)");
  const sacrifice = (await readSession()).build.history[sacrificeIndex];
  await queueRandom([0]);
  await app.evaluate("document.querySelector('#build-king-dialog [data-king-sacrifice]').click()");
  await restoreRandom();
  fixture = await waitFateLanding();
  assert.equal(fixture.build.fate.pendingKing, null);
  assert.equal(fixture.build.fate.kingMode, 'exchange');
  assert.ok(!fixture.build.history.some(entry => entry.itemId === sacrifice.itemId));
  assert.equal(latestBuildEntry(fixture.build).kingOrigin, true);
  assert.equal(latestBuildEntry(fixture.build).sealed, true);
  assert.equal(fixture.build.fate.journal.filter(event => event.kind === 'hidden-king').length, 1);
  assert.equal(fixture.build.fate.journal.find(event => event.kind === 'hidden-king').mode, 'exchange');
  assert.equal(await app.evaluate("document.querySelector('#build-king-deal-banner').dataset.kingMode"), 'exchange');
  await app.evaluate("document.querySelector('#build-item-random').click()");
  fixture = await waitFateLanding();
  assert.equal(await app.evaluate("document.querySelector('#build-king-dialog').open"), false, 'The King cannot return at 100% after making a deal');
  assert.equal(latestBuildEntry(fixture.build).sealed, undefined, 'Exchange seals its reward rather than every future purchase');

  mark('fate-king-treasury-start');
  const treasuryBefore = await loadBuildFixture({ history: royalHistory, fate: pendingKingFixture });
  await queueRandom([0, 0]);
  await app.evaluate("document.querySelector('#build-king-dialog [data-king-mode=treasury]').click()");
  await restoreRandom();
  fixture = await waitFateLanding();
  const treasuryRecord = fixture.build.fate.journal.find(event => event.kind === 'hidden-king');
  assert.deepEqual(treasuryRecord.sacrificedEntries.map(entry => entry.itemId), treasuryBefore.build.history.slice(-3).reverse().map(entry => entry.itemId));
  const royalEntries = fixture.build.history.filter(entry => entry.kingOrigin);
  assert.equal(royalEntries.length, 3);
  assert.ok(royalEntries.every(entry => entry.sealed));
  assert.equal(latestBuildGroup(fixture.build).length, 2);
  const treasurySolo = royalEntries.find(entry => entry.drawId !== fixture.build.latestDrawId);
  const treasuryTier = await app.evaluate(`import('./catalog-data.js').then(({default:catalog})=>catalog.items.find(item=>item.id===${JSON.stringify(treasurySolo.itemId)}).tier)`);
  assert.equal(treasuryTier, 4);
  assert.equal(fixture.build.fate.kingMode, 'treasury');

  mark('fate-king-impostor-start');
  await loadBuildFixture({ history: royalHistory, fate: pendingKingFixture });
  await queueRandom([0, 0, 0, .99]);
  await app.evaluate("document.querySelector('#build-king-dialog [data-king-mode=impostor]').click()");
  await restoreRandom();
  await app.until("!document.querySelector('#build-king-dialog').open && !document.querySelector('#build-new-button').disabled && JSON.parse(localStorage.getItem('deadlock-roulette.session.v1')).build.fate.kingImpostorQueue.length === 3", 20000);
  const royalQueue = (await readSession()).build.fate.kingImpostorQueue;
  assert.equal(royalQueue.filter(entry => entry.kingImpostor).length, 1);
  assert.equal(royalQueue[2].kingImpostor, true);
  const royalQueuedItems = await app.evaluate(`import('./catalog-data.js').then(({default:catalog})=>catalog.items.filter(item=>${JSON.stringify(royalQueue.map(entry => entry.itemId))}.includes(item.id)))`);
  for (const entry of royalQueue) assert.ok(entry.kingImpostor ? royalQueuedItems.find(item => item.id === entry.itemId).tier === 1 : [3,4].includes(royalQueuedItems.find(item => item.id === entry.itemId).tier));
  for (let index = 0; index < 3; index++) {
    await app.evaluate("document.querySelector('#build-item-random').click()");
    fixture = await waitFateLanding();
    assert.equal(latestBuildEntry(fixture.build).itemId, royalQueue[index].itemId);
    assert.equal(fixture.build.fate.kingImpostorQueue.length, 2 - index);
    assert.equal(latestBuildEntry(fixture.build).kingOrigin, true);
    assert.equal(latestBuildEntry(fixture.build).sealed, true);
    assert.equal(await app.evaluate("document.querySelectorAll('.fate-badge[data-fate-origin=impostor], .build-impostor-mark').length"), 0, 'A fake cannot expose its identity while sealed');
  }
  assert.equal(fixture.build.purchasePlan.findIndex(entry => entry.kingImpostor), 7, 'The secret T1 remains in its third royal purchase position');
  const royalMarkup = await app.evaluate("[...document.querySelectorAll('#build-inventory [data-sealed=true], #build-purchase-plan .is-sealed'),document.querySelector('#build-item-scanner')].map(node=>node.outerHTML).join(' ')");
  assert.deepEqual(await app.evaluate("['reroll','upgrade','downgrade'].map(action=>document.querySelector('#build-'+action+'-button').disabled)"), [true,true,true], 'A sealed royal fake cannot expose its tier through action button availability');
  for (const item of royalQueuedItems) assert.ok(!royalMarkup.includes(item.name) && !royalMarkup.includes(item.nameRu) && !royalMarkup.includes(item.icon));
  for (let index = 0; index < 3; index++) {
    await app.evaluate("document.querySelector('#build-reveal-next').click()");
    if (royalQueue[index].kingImpostor) {
      await app.until("document.querySelector('.fate-effects-layer[data-kind=royal-reveal][data-fake=true]:not([hidden]) .fate-counterfeit-stamp') !== null");
      await saveViewport(kingFakeScreenshot);
    }
    await app.until("!document.querySelector('.fate-effects-layer:not([hidden])')");
    if (index < 2) assert.deepEqual(await app.evaluate("['reroll','upgrade','downgrade'].map(action=>document.querySelector('#build-'+action+'-button').disabled)"), [true,true,true]);
  }
  assert.ok(await app.evaluate("document.querySelector('#build-inventory .is-king-impostor .build-impostor-mark') !== null"));
  assert.equal(await app.evaluate("document.querySelectorAll('#build-purchase-plan .fate-badge[data-fate-origin=impostor]').length"), 1);

  mark('fate-king-decree-start');
  const decreeBefore = await loadBuildFixture({ history: royalHistory, fate: pendingKingFixture });
  await queueRandom([0]);
  await app.evaluate("document.querySelector('#build-king-dialog [data-king-mode=decree]').click()");
  await restoreRandom();
  await app.until("!document.querySelector('#build-king-dialog').open && !document.querySelector('#build-new-button').disabled", 20000);
  fixture = await readSession();
  assert.equal(fixture.build.fate.kingMode, 'decree');
  assert.equal(fixture.build.fate.kingEdict, 'spirit');
  assert.equal(await app.evaluate("document.querySelector('#build-king-deal-banner').dataset.kingMode"), 'decree');
  assert.ok(await app.evaluate("document.querySelector('#build-king-deal-banner').textContent.includes('×6')"));
  const decreeWeightCheck = await app.evaluate(`Promise.all([import('./draw-rules.js'),import('./catalog-data.js')]).then(([rules,{default:catalog}])=>{
    const current=JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})),before=${JSON.stringify(decreeBefore)};
    before.build.fate.pendingKing=null;before.build.fate.kingMode='exchange';
    const old=rules.calculateBuildDistribution(catalog.items,before.settings,before.build,{pairsEnabled:false});
    const next=rules.calculateBuildDistribution(catalog.items,current.settings,current.build,{pairsEnabled:false});
    return next.items.every(entry=>entry.weight===old.items.find(candidate=>candidate.item.id===entry.item.id).weight*(entry.item.category==='spirit'?6:1));
  })`);
  assert.equal(decreeWeightCheck, true);
  await app.reload();
  assert.equal((await readSession()).build.fate.kingEdict, 'spirit');
  assert.equal(await app.evaluate("document.querySelector('#build-king-dialog').open"), false);

  mark('fate-hidden-king-legacy-veil-start');
  await loadBuildFixture({ history: ['Mystic Vulnerability', 'Weakening Headshot', 'Spirit Resilience'],
    allowed: ['Mystic Shot', 'Spirit Lifesteal'], tiers: [2, 3], fate: { kingActive: true } });
  await captureFateAudio();
  await app.evaluate("document.querySelector('#build-item-random').click()");
  fixture = await waitFateLanding();
  assert.equal(fixture.build.fate.kingActive, true);
  assert.equal(fixture.build.fate.kingMode, 'veil');
  const hiddenEntry = fixture.build.history.find(entry => entry.sealed);
  assert.ok(hiddenEntry);
  const hiddenItem = await app.evaluate(`import('./catalog-data.js').then(({ default: catalog }) => catalog.items.find(item => item.id === ${JSON.stringify(hiddenEntry.itemId)}))`);
  assert.equal(await app.evaluate("document.querySelectorAll('#build-inventory .build-item-slot[data-sealed=true]').length"), 1);
  assert.equal(await app.evaluate("document.querySelectorAll('#build-purchase-plan .build-purchase-step.is-sealed').length"), 1);
  assert.equal(await app.evaluate("document.querySelector('#build-item-scanner').dataset.sealed"), 'true');
  const secretMarkup = await app.evaluate("[...document.querySelectorAll('#build-inventory [data-sealed=true], #build-purchase-plan .is-sealed'), document.querySelector('#build-item-scanner')].map(node => node.outerHTML).join('\\n')");
  assert.ok(!secretMarkup.includes(hiddenItem.name) && !secretMarkup.includes(hiddenItem.nameRu) && !secretMarkup.includes(hiddenItem.icon), 'Sealed cards do not leak names or original icons through markup, tooltips or image attributes');
  await saveViewport(kingScreenshot);

  mark('fate-newspaper-start');
  await app.evaluate("document.querySelector('#build-newspaper-button').click()");
  await app.until("document.querySelector('#build-newspaper-dialog')?.open && !document.querySelector('#build-newspaper-save').disabled", 20000);
  assert.ok(await app.evaluate("document.querySelector('.gazette-headline').textContent.trim().length > 10"));
  const newspaperTypography = await app.evaluate(`({
    lede: getComputedStyle(document.querySelector('.gazette-lede')).color,
    ledeSize: getComputedStyle(document.querySelector('.gazette-lede')).fontSize,
    editorial: getComputedStyle(document.querySelector('.gazette-columns p')).color,
    kicker: getComputedStyle(document.querySelector('.gazette-kicker')).color,
  })`);
  assert.deepEqual(newspaperTypography, { lede: 'rgb(40, 37, 31)', ledeSize: '15px', editorial: 'rgb(40, 37, 31)', kicker: 'rgb(128, 59, 50)' }, 'The newspaper keeps readable ink colors inside the shared modal');
  assert.equal(await app.evaluate("document.querySelectorAll('#build-newspaper-paper .gazette-items .is-secret').length"), 1);
  assert.equal(await app.evaluate("document.querySelectorAll('#build-newspaper-paper .is-secret img').length"), 0);
  const paperMarkup = await app.evaluate("document.querySelector('#build-newspaper-paper').innerHTML");
  assert.ok(!paperMarkup.includes(hiddenItem.name) && !paperMarkup.includes(hiddenItem.nameRu) && !paperMarkup.includes(hiddenItem.icon), 'The gazette includes only already revealed items');
  await saveViewport(newspaperScreenshot);
  mark('fate-newspaper-png-render');
  const paperPNGMetadata = await app.evaluate(`Promise.all([import('./newspaper.js'), import('./catalog-data.js'), import('./hero-data.js'), import('./hero-art.js')]).then(async ([paper, { default: catalog }, { default: heroes }, { default: art }]) => {
    const state = JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));
    window.__smokeNewspaperPNG = await paper.renderNewspaperPNG({ build: state.build, hero: heroes.heroes.find(hero => hero.id === state.build.heroId), items: catalog.items, art: art[state.build.heroId], language: state.preferences.language });
    return { length: window.__smokeNewspaperPNG.length, header: window.__smokeNewspaperPNG.slice(0, 22) };
  })`);
  assert.equal(paperPNGMetadata.header, 'data:image/png;base64,');
  mark('fate-newspaper-png-transfer', { bytes: paperPNGMetadata.length });
  const paperPNGChunks = [];
  for (let offset = 0; offset < paperPNGMetadata.length; offset += 256 * 1024) {
    paperPNGChunks.push(await app.evaluate(`window.__smokeNewspaperPNG.slice(${offset}, ${offset + 256 * 1024})`));
  }
  const paperPNG = paperPNGChunks.join('');
  await fs.writeFile(newspaperPNG, Buffer.from(paperPNG.split(',')[1], 'base64'));
  await app.evaluate('delete window.__smokeNewspaperPNG');
  await app.evaluate("document.querySelector('#build-newspaper-dialog [data-newspaper-close]').click()");
  const beforeReveal = (await readSession()).build;
  await app.evaluate("document.querySelector('#build-reveal-next').click()");
  const afterReveal = (await readSession()).build;
  assert.deepEqual(afterReveal.history, beforeReveal.history, 'Reveal changes only the mask, never inventory');
  assert.deepEqual(afterReveal.purchasePlan, beforeReveal.purchasePlan, 'The purchase route itself remains unchanged');
  assert.equal(afterReveal.fate.revealedPurchaseKeys.length, 1);
  assert.equal(await app.evaluate("document.querySelectorAll('#build-inventory [data-sealed=true]').length"), 0);
  assert.equal(await app.evaluate("document.querySelector('#build-reveal-next').hidden"), true, 'The button advances through one unrevealed purchase at a time');
  const configuredFateChances = { chickenChance: .17, archmotherChance: .23, hiddenKingChance: .31 };
  await app.evaluate(`{ for (const [key, fraction] of Object.entries(${JSON.stringify(configuredFateChances)})) {
    const input = document.querySelector('#build-' + key); input.value = String(Math.round(fraction * 100)); input.dispatchEvent(new Event('input', { bubbles: true }));
  } }`);
  await app.reload();
  for (const [key, value] of Object.entries(configuredFateChances)) assert.equal((await readSession()).preferences[key], value);
  assert.deepEqual((await readSession()).build.fate.revealedPurchaseKeys, afterReveal.fate.revealedPurchaseKeys);
  assert.equal(await app.evaluate("document.querySelectorAll('#build-inventory [data-sealed=true]').length"), 0, 'Revealed purchases stay visible after reopening');

  mark('fate-anonymous-archmother-start');
  await loadBuildFixture({ allowed: ['Mystic Shot', 'Weakening Headshot', 'Express Shot', 'Spirit Resilience'], tiers: [2, 3],
    archmotherChance: 1, fate: { kingActive: true } });
  await app.evaluate("document.querySelector('#build-item-random').click()");
  await app.until("document.querySelector('#build-archmother-dialog').open", 20000);
  const anonymousPending = (await readSession()).build.fate.pendingArchmother;
  const anonymousMarkup = await app.evaluate("document.querySelector('#build-archmother-dialog').outerHTML");
  assert.equal(await app.evaluate("document.querySelectorAll('#build-archmother-dialog .build-archmother-reel.is-sealed').length"), 3);
  assert.equal(await app.evaluate("document.querySelectorAll('#build-archmother-dialog img').length"), 0);
  const anonymousItems = await app.evaluate(`import('./catalog-data.js').then(({ default: catalog }) => catalog.items.filter(item => ${JSON.stringify(anonymousPending.itemIds)}.includes(item.id)))`);
  for (const item of anonymousItems) assert.ok(!anonymousMarkup.includes(item.name) && !anonymousMarkup.includes(item.nameRu) && !anonymousMarkup.includes(item.icon), 'King keeps each offered item anonymous');
  await awaitMotherReady();
  await app.evaluate("document.querySelector('#build-archmother-dialog [data-archmother-choice=\"0\"]').click()");
  fixture = await waitFateLanding();
  assert.equal(latestBuildEntry(fixture.build).sealed, true);
  assert.equal(fixture.build.fate.archmotherUsed, true);

  mark('fate-d12-lock-start');
  await loadBuildFixture({ history: ['Mystic Vulnerability', 'Weakening Headshot', 'Spirit Resilience'], chickenChance: 1, hiddenKingChance: 1 });
  await queueRandom([0, 0, .999]);
  await app.evaluate("document.querySelector('#build-item-random').click()");
  await restoreRandom();
  const committedD12 = (await readSession()).build;
  assert.equal(committedD12.fate.totalLocked, true, 'The complete D12 replacement is durable before the wipe animation');
  assert.equal(committedD12.history.length, 12);
  assert.ok(committedD12.history.every(entry => entry.cursed && entry.chickenOrigin));
  await awaitChickenReady();
  assert.equal(await app.evaluate("document.querySelector('.fate-die').dataset.result"), '12');
  const pendingD12 = committedD12.fate.pendingChicken;
  assert.ok(pendingD12);
  assertNoErrors(app.failures);
  await app.close(); app = await launch();
  await awaitChickenReady();
  assert.equal(await app.evaluate("document.querySelector('.fate-die').dataset.result"), '12', 'Restart presents the same saved die face');
  assert.deepEqual((await readSession()).build, committedD12, 'Restart cannot reroll the committed D12 inventory or its journal');
  await app.evaluate(`{
    window.__smokeD12ResumeStates=[];
    window.__smokeD12ResumeObserver=new MutationObserver(()=>window.__smokeD12ResumeStates.push(document.querySelector('#build-item-scanner').dataset.state));
    window.__smokeD12ResumeObserver.observe(document.querySelector('#build-item-scanner'),{attributes:true,childList:true,subtree:true});
    document.querySelector('#fate-chicken-continue').click();
  }`);
  fixture = await waitFateLanding();
  assert.deepEqual(fixture.build.history, committedD12.history);
  assert.deepEqual(fixture.build.purchasePlan, committedD12.purchasePlan);
  assert.deepEqual(fixture.build.fate.journal, committedD12.fate.journal);
  assert.equal(fixture.build.fate.pendingChicken, null);
  assert.equal(await app.evaluate("window.__smokeD12ResumeObserver.disconnect();window.__smokeD12ResumeStates.includes('scanning')"), false, 'Resume only confirms and presents pecks rather than replaying all twelve reels');
  assert.equal(fixture.build.fate.chickenUsed, true);
  assert.equal(fixture.build.fate.kingActive, false, 'A locked D12 build cannot waste a future King event');
  assert.equal(await app.evaluate("document.querySelector('#build-fate-locked-banner').hidden"), false);
  assert.equal(await app.evaluate("document.querySelectorAll('#build-inventory .fate-badge[data-fate-origin=chicken]').length"), 12);
  assert.equal(await app.evaluate("document.querySelectorAll('#build-inventory .build-item-slot.is-cursed .build-item-lock').length"), 12);
  await assertLockOnIcon();
  assert.equal(await app.evaluate("document.querySelectorAll('#build-purchase-plan .fate-badge[data-fate-origin=chicken]').length"), fixture.build.purchasePlan.length);
  const immutableButtons = ['#build-item-random', '#build-item-undo', '#build-reroll-button', '#build-upgrade-button', '#build-downgrade-button'];
  assert.deepEqual(await app.evaluate(`${JSON.stringify(immutableButtons)}.map(selector => document.querySelector(selector).disabled)`), [true, true, true, true, true]);
  await app.evaluate(`${JSON.stringify(immutableButtons)}.forEach(selector => document.querySelector(selector).click())`);
  assert.deepEqual((await readSession()).build, fixture.build, 'Disabled D12 controls cannot alter the final locked inventory');
  await app.reload();
  assert.equal((await readSession()).build.fate.totalLocked, true);
  assert.equal(await app.evaluate("document.querySelector('#build-item-random').disabled"), true);
  await app.evaluate("document.querySelector('#build-contract-name').value='D12 patron badges';document.querySelector('#build-contract-save').click()");
  const savedD12 = (await readSession()).contracts[0];
  assert.ok(savedD12.build.history.every(entry => entry.chickenOrigin && entry.cursed));
  await app.evaluate(`document.querySelector('[data-build-contract-preview="${savedD12.id}"]').click()`);
  await app.until("document.querySelector('#build-contract-dialog').open");
  assert.equal(await app.evaluate("document.querySelectorAll('#build-contract-dialog .fate-badge[data-fate-origin=chicken]').length >= 12"), true);
  await app.evaluate("document.querySelector('#build-contract-dialog-close').click();document.querySelector('#build-poster-button').click()");
  await assertRasterFateMarks();
  await app.until("document.querySelector('#contract-poster-dialog')?.open && document.querySelector('#contract-poster-preview')?.naturalWidth === 2600", 20000);
  const widePosterLength = await app.evaluate("window.__smokeWidePoster=document.querySelector('#contract-poster-preview').src;window.__smokeWidePoster.length");
  const widePosterChunks = [];
  for (let offset=0;offset<widePosterLength;offset+=256*1024) widePosterChunks.push(await app.evaluate(`window.__smokeWidePoster.slice(${offset},${offset+256*1024})`));
  await fs.writeFile(widePosterScreenshot,Buffer.from(widePosterChunks.join('').split(',')[1],'base64'));
  await app.evaluate("delete window.__smokeWidePoster;document.querySelector('#contract-poster-dialog [data-poster-close]').click()");
  await app.evaluate("document.querySelector('#reset-button').click(); document.querySelector('#confirm-reset').click()");
  await app.until("Number(document.querySelector('#drawn-count').textContent) === 0");
  const resetFate = (await readSession()).build.fate;
  assert.equal(resetFate.chickenUsed || resetFate.archmotherUsed || resetFate.kingActive || resetFate.totalLocked, false, 'Explicit item reset restores all one-build events');
  assert.equal(resetFate.pendingArchmother, null);
  assert.deepEqual(resetFate.revealedPurchaseKeys, []);
  assertNoErrors(app.failures);
  const report = {
    status: 'pass', runtime: sourceMode ? 'source' : 'portable', suite: rulesOnly ? 'rules-only' : 'full', version,
    catalogItems: await app.evaluate("import('./catalog-data.js').then(({ default: catalog }) => catalog.items.length)"), catalogTickets: await app.evaluate("Promise.all([import('./catalog-data.js'),import('./draw-rules.js')]).then(([{default:catalog},rules])=>rules.createItemTickets(catalog.items).length)"), heroCount: heroIds.length,
    ...(rulesOnly ? {} : {
    spin: true, nonConsumingReroll: true, adjacentTierUpgradeDowngrade: true,
    singleActionPerItem: true, sessionActionCharges: true,
    buildItemActions: true, buildSlotReplacement: true, chargeNonrefundUndo: true,
    persistence: true, reset: true, nativeIPC: true, zoom: true,
    zoomKeyboard: true, zoomPersistence: true, zoomThemes: true,
    originalMenuMusic: true, currentOriginalOST: true, soundtrackSwitchingPersistence: true,
    originalStreetBrawlLanding: true, independentAudioSwitches: true,
    separateVolumePersistence: true, interfaceAudioPersistence: true,
    rouletteSoundPalette: true, soundPreview: true, heroVoices: true,
    heroVoiceDecode: true, heroVoicePreferences: true, fullHeroArtworkDecode: true,
    heroStartAudio: true, heroRerollControlLock: true, speedSyncedClicks: true,
    catalogVisibilityPersistence: true, wheelHover: true, heroFilters: true,
    independentBuildInventory: true, independentBuildTiers: true,
    dynamicTierWeights: true, undoBuildItem: true, completeInventoryCap: true,
    completionSeal: true, validSkillPlan: true, abilityTimeline: true,
    heroAbilityUnlocks: true, sequentialAbilityReveal: true,
    nearbyItemScanner: true, adjacentReelCards: true, longReelMotion: true,
    buildPersistence: true, savedContracts: true, contractRatingComments: true,
    contractPreview: true, postMatchContractReview: true,
    skillShuffleConfirmation: true, newBuildConfirmation: true,
    modeThemes: true, heroArtworkTheme: true, contractPosterPNG: true, languagePersistence: true,
    }),
    recipeMergeMigration: true, liveRecipeMerge: true, transactionUndo: true,
    earlyStarterInsertion: true, stageScrollCentering: true, curatedDoubleTickets: true,
    insertedResultActionTarget: true, chargeHeroCompatibility: true,
    doubleItemRender: true, fiveItemReelCards: true, originalCurseAudio: true,
    curseExtraDraw: true, curseNoRecursion: true, curseLockPersistence: true,
    curseChancePersistence: true, pairTogglePersistence: true,
    persistentPurchaseRoute: true, routeMergePreservesComponents: true,
    routeUndo: true, fullInventoryUpgradeRoute: true,
    routeArchivePreviewPersistence: true, routeReplay: true,
    iconLockOverlay: true, compactItemScanner: true,
    quickReadableCurse: true, normalReadableCurse: true, reducedMotionReadableCurse: true,
    independentFateChancePersistence: true, oneChickenPerBuild: true, chronologicalChickenDeletion: true,
    archmotherThreeChoices: true, archmotherPendingRestart: true, oneArchmotherPerBuild: true,
    legacyKingFutureSeals: true, kingFifthItemThreshold: true, kingFourContracts: true,
    kingModeAndSacrificeRestart: true, kingExchangeTierChange: true, kingTreasuryTripleRewards: true,
    kingPrecommittedImpostor: true, kingFakeRevealPrivacy: true, kingSixfoldDecree: true,
    oneKingPerBuild: true, orderedRevealPersistence: true,
    anonymousKingOffers: true, d12AtomicTwelveLockedItems: true, d12LockPersistenceReset: true,
    newspaperNativeDialogPNG: true, newspaperSecretPrivacy: true, newspaperReadableTypography: true,
    chickenLongSuspense: true, chickenExplicitConfirmation: true, chickenPendingNativeRestart: true,
    perItemFeatherBursts: true, eventHistoryPersistence: true, motherVerticalReels: true,
    motherDirectGiftDrop: true, originBadgesArchive: true, readableWidePoster: true, eventInfoDialogs: true,
    screenshots: [screenshot, screenshot2K, buildScreenshot, nativeBuildScreenshot, contractPreviewScreenshot, contractPosterScreenshot, rulesFixtureScreenshot, pairFixtureScreenshot, curseFixtureScreenshot, fullMergeScreenshot,
      chickenScreenshot, archmotherScreenshot, kingScreenshot, newspaperScreenshot, newspaperPNG,
      chickenHoldScreenshot,motherSpinningScreenshot,kingMenuScreenshot,kingExchangeScreenshot,kingFakeScreenshot,fateInfoScreenshot,widePosterScreenshot],
  };
  const reportPath = path.join(root, '.smoke-data', `desktop-smoke-${sourceMode ? 'source' : 'portable'}-report.json`);
  await fs.writeFile(reportPath, `${JSON.stringify({ ...report, profile, processLog: processLogPath }, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, report: reportPath }, null, 2));
} catch (error) {
  console.error('Native smoke original failure:', error?.stack || error);
  if (app?.failures?.length) console.error('Renderer failures:', JSON.stringify(app.failures));
  throw error;
} finally {
  if (app) await app.close().catch(error => console.error('Native smoke cleanup failure:', error?.stack || error));
}
