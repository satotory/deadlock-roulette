/** Opt-in desktop integration check: node scripts/ui-smoke.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { calculateProbabilities } from '../src/roulette.js';
import { parseSessionJSON } from '../src/session.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundledModules = process.env.CODEX_NODE_MODULES
  || path.join(root, 'node_modules');
const localRequire = createRequire(import.meta.url);
let playwright;
try { playwright = localRequire('playwright'); }
catch { playwright = createRequire(path.join(bundledModules, '..', '_smoke-resolver.cjs'))('playwright'); }
const electronPath = process.env.DEADLOCK_ELECTRON_BINARY
  || [path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), path.join(root, 'dist', 'win-unpacked', 'Deadlock Roulette.exe')].find(existsSync);
if (!electronPath) throw new Error('An Electron binary is unavailable. Run npm install or npm run build before this opt-in check.');

const port = Number(process.env.DEADLOCK_SMOKE_PORT || 9228);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Valid debug port required');
// Every run owns a fresh profile. Never delete a real user's history to test a reset.
const profile = path.join(root, '.smoke-profile', `run-${Date.now()}-${process.pid}`);
const artifacts = path.join(root, 'artifacts');
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(artifacts, { recursive: true });
const catalog = JSON.parse(await fs.readFile(path.join(root, 'assets', 'items.json'), 'utf8'));
const STORAGE_KEY = 'deadlock-roulette.session.v1';
const TAU = Math.PI * 2;
let application;
let browser;
let page;
const logs = [];
const rendererErrors = [];
const successfulChecks = [];
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function check(label) {
  successfulChecks.push(label);
  console.log(`PASS ${label}`);
}

async function launch() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  application = spawn(electronPath, [root, '--smoke-test', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'], {
    cwd: root,
    windowsHide: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let spawnError;
  application.once('error', error => { spawnError = error; });
  for (const stream of [application.stdout, application.stderr]) {
    stream.on('data', buffer => logs.push(buffer.toString()));
  }
  const deadline = Date.now() + 30_000;
  let connected = false;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (application.exitCode !== null) throw new Error(`Electron exited early (${application.exitCode}). ${logs.join('')}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { connected = true; break; }
    } catch { /* Chromium's local debug listener is still starting. */ }
    await delay(150);
  }
  assert.ok(connected, `Electron CDP listener did not start. ${logs.join('')}`);
  browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  assert.ok(context, 'Electron default browser context exists');
  page = context.pages().find(candidate => candidate.url().endsWith('/src/index.html')) || context.pages()[0];
  assert.ok(page, 'Electron application page exists');
  page.on('pageerror', error => rendererErrors.push(error.message));
  await page.addInitScript(() => {
    // Observe the first wheel-level rotation, independent of the app's module scope.
    // Nested icon rotations occur at deeper save/restore levels and are ignored.
    const prototype = CanvasRenderingContext2D.prototype;
    const save = prototype.save;
    const restore = prototype.restore;
    const rotate = prototype.rotate;
    const depths = new WeakMap();
    prototype.save = function (...args) { depths.set(this, (depths.get(this) || 0) + 1); return save.apply(this, args); };
    prototype.restore = function (...args) { depths.set(this, Math.max(0, (depths.get(this) || 0) - 1)); return restore.apply(this, args); };
    prototype.rotate = function (angle) {
      if (this.canvas.id === 'wheel' && depths.get(this) === 1) window.__smokeRotation = angle + Math.PI / 2;
      return rotate.call(this, angle);
    };
  });
  await page.reload({ waitUntil: 'load' });
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.waitForFunction(() => document.querySelector('#pool-count')?.textContent !== '—'
    && document.querySelectorAll('.catalog-card').length > 0, undefined, { timeout: 15_000 });
}

async function stop() {
  if (page && !page.isClosed()) {
    await Promise.race([page.evaluate(() => window.close()).catch(() => {}), delay(1500)]);
  }
  const child = application;
  const deadline = Date.now() + 5000;
  while (child && child.exitCode === null && Date.now() < deadline) await delay(50);
  if (child && child.exitCode === null) child.kill();
  if (browser) await Promise.race([browser.close().catch(() => {}), delay(1500)]);
  browser = null;
  page = null;
  application = null;
}

async function readSession() {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), STORAGE_KEY);
}

async function assertPool() {
  const saved = await readSession();
  const expected = calculateProbabilities(catalog.items, saved.settings, saved.history.map(entry => entry.itemId)).eligibleCount;
  const actual = Number(await page.locator('#pool-count').innerText());
  assert.equal(actual, expected, 'DOM pool count matches domain distribution');
  return expected;
}

async function setTierWeight(tier, value) {
  const input = page.locator(`#tier-controls input[data-kind="tierWeights"][data-key="${tier}"]`);
  await input.fill(String(value));
  await input.press('Tab');
  await page.waitForFunction(({ key, tier, value }) => JSON.parse(localStorage.getItem(key)).settings.tierWeights[tier] === value,
    { key: STORAGE_KEY, tier, value });
}

async function importViaFileInput(json) {
  await page.locator('#import-file').setInputFiles({ name: 'smoke-session.json', mimeType: 'application/json', buffer: Buffer.from(json) });
}

async function screenshot(filename) {
  // Electron's hidden smoke window may not satisfy Playwright's screenshot RAF
  // stabilization. CDP capture is sufficient for a static, fully rendered page.
  const cdp = await page.context().newCDPSession(page);
  let timeout;
  try {
    const captured = await Promise.race([
      cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Hidden-window screenshot did not produce a frame within 15 seconds.')), 15_000); }),
    ]);
    await fs.writeFile(path.join(artifacts, filename), Buffer.from(captured.data, 'base64'));
  } finally { clearTimeout(timeout); await cdp.detach().catch(() => {}); }
}

try {
  await launch();
  assert.equal(await page.locator('.catalog-card').count(), 173);
  assert.equal(Number(await page.locator('#total-count').innerText()), 173);
  assert.equal(Number(await page.locator('#pool-count').innerText()), 156);
  assert.equal(await page.locator('#spin-button').isEnabled(), true);
  await screenshot('screenshot.png');
  check('initial catalog: 173 items, 156 standard items in pool');

  await page.locator('#speed-button').click();
  const drawn = new Set();
  for (let index = 0; index < 6; index++) {
    const before = await readSession();
    const distribution = calculateProbabilities(catalog.items, before.settings, before.history.map(entry => entry.itemId));
    await page.locator('#spin-button').click();
    await page.waitForFunction(() => !document.querySelector('#spin-button').disabled, undefined, { timeout: 10_000 });
    const after = await readSession();
    assert.equal(after.history.length, index + 1);
    const winner = after.history.at(-1);
    assert.ok(!drawn.has(winner.itemId), 'No item may be drawn twice');
    drawn.add(winner.itemId);
    const resultItem = catalog.items.find(item => item.id === winner.itemId);
    assert.equal(await page.locator('.result-name').innerText(), after.preferences.language === 'en' ? resultItem.name : resultItem.nameRu || resultItem.name);
    const selectedIndex = distribution.items.findIndex(entry => entry.item.id === winner.itemId);
    assert.ok(selectedIndex >= 0, 'Winner belonged to pre-spin pool');
    const start = distribution.items.slice(0, selectedIndex).reduce((sum, entry) => sum + entry.probability * TAU, 0);
    const end = start + distribution.items[selectedIndex].probability * TAU;
    const rotation = await page.evaluate(() => window.__smokeRotation);
    assert.ok(Number.isFinite(rotation), 'Canvas rotation observed');
    const pointer = (TAU - rotation % TAU) % TAU;
    assert.ok(pointer > start && pointer < end, `Pointer ${pointer} must land in winner sector [${start}, ${end}]`);
    assert.equal(Number(await page.locator('#pool-count').innerText()), 155 - index);
    await assertPool();
  }
  await screenshot('result.png');
  check('six quick spins: unique results, correct pointer sectors, diminishing pool');
  const sixDrawSession = await readSession();

  await stop();
  await launch();
  const restored = await readSession();
  assert.deepEqual(restored.history, sixDrawSession.history);
  assert.deepEqual(restored.settings, sixDrawSession.settings);
  assert.equal(Number(await page.locator('#drawn-count').innerText()), 6);
  assert.equal(Number(await page.locator('#pool-count').innerText()), 150);
  check('history and no-repeat pool survive a complete Electron restart');

  const eligible = calculateProbabilities(catalog.items, restored.settings, restored.history.map(entry => entry.itemId));
  const excludeId = eligible.items[0].item.id;
  await page.locator(`.catalog-card[data-item="${excludeId}"]`).click();
  await page.locator('#exclude-item').click();
  await page.locator('#item-dialog .primary-button[data-close]').click();
  assert.ok((await readSession()).settings.excludedIds.includes(excludeId));
  assert.equal(await page.locator(`.catalog-card[data-item="${excludeId}"]`).getAttribute('class').then(value => value.includes('is-excluded')), true);
  assert.equal(await assertPool(), 149);
  for (const category of ['vitality', 'spirit']) await page.locator(`[data-toggle-category="${category}"]`).click();
  for (const tier of [2, 3, 4]) await page.locator(`[data-toggle-tier="${tier}"]`).click();
  const filtered = await readSession();
  assert.deepEqual(filtered.settings.enabledCategories, ['weapon']);
  assert.deepEqual(filtered.settings.enabledTiers, [1]);
  await assertPool();
  check('item exclusions and category/tier filters update the actual draw pool');

  for (const tier of [1, 2, 3, 4]) await setTierWeight(tier, 0);
  assert.equal(await assertPool(), 0);
  assert.equal(await page.locator('#spin-button').isDisabled(), true);
  assert.equal(await page.locator('#wheel-empty').isVisible(), true);
  check('zero-weight pool disables spinning and explains the empty state');

  await page.locator('#reset-button').click();
  await page.locator('#confirm-reset').click();
  const reset = await readSession();
  assert.deepEqual(reset.history, []);
  assert.ok(reset.settings.excludedIds.includes(excludeId));
  assert.equal(reset.settings.tierWeights[1], 0);
  assert.equal(Number(await page.locator('#drawn-count').innerText()), 0);
  check('reset clears history while retaining weights and item exclusions');

  for (const [preset, expected] of [['luxury', [1, 2, 3, 4]], ['equal', [1, 1, 1, 1]], ['classic', [4, 3, 2, 1]]]) {
    await page.locator(`[data-preset="${preset}"]`).click();
    const saved = await readSession();
    assert.deepEqual([1, 2, 3, 4].map(tier => saved.settings.tierWeights[tier]), expected);
    await assertPool();
  }
  for (const category of ['vitality', 'spirit']) await page.locator(`[data-toggle-category="${category}"]`).click();
  for (const tier of [2, 3, 4]) await page.locator(`[data-toggle-tier="${tier}"]`).click();
  assert.equal(await assertPool(), 155);
  check('all weight presets and restoring filters work');

  const exported = await page.evaluate(async raw => {
    const { serializeSession } = await import('./session.js');
    return serializeSession(raw);
  }, sixDrawSession);
  assert.deepEqual(parseSessionJSON(exported, catalog.items).history, sixDrawSession.history);
  await importViaFileInput(exported);
  await page.waitForFunction(() => document.querySelector('#drawn-count').textContent === '6');
  assert.deepEqual((await readSession()).history, sixDrawSession.history);
  assert.equal(await assertPool(), 150);
  const beforeBadImport = await readSession();
  await importViaFileInput('{"format":"bad","version":99,"history":[]}');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Не удалось загрузить'));
  assert.deepEqual(await readSession(), beforeBadImport);
  check('browser JSON serialization and file-input import restore state; invalid import leaves it intact');

  assert.deepEqual(rendererErrors, [], 'No uncaught renderer errors');
  await fs.writeFile(path.join(artifacts, 'ui-smoke-report.json'), JSON.stringify({
    passed: true,
    checks: successfulChecks,
    rendererErrors,
    profile,
    catalogCount: catalog.items.length,
    screenshots: ['screenshot.png', 'result.png'],
  }, null, 2));
  console.log(`UI smoke passed. Screenshots: ${artifacts}`);
} catch (error) {
  if (page && !page.isClosed()) await screenshot('ui-smoke-failure.png').catch(() => {});
  await fs.writeFile(path.join(artifacts, 'ui-smoke-report.json'), JSON.stringify({ passed: false, checks: successfulChecks, error: error.stack, rendererErrors, profile, electronLogs: logs.join('').slice(-10000) }, null, 2));
  throw error;
} finally {
  await stop();
}
