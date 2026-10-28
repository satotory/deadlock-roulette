/** Opt-in isolated desktop zoom check: node scripts/zoom-smoke.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundledModules = process.env.CODEX_NODE_MODULES
  || path.join(root, 'node_modules');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = createRequire(path.join(bundledModules, '..', '_zoom-smoke-resolver.cjs'))('playwright'); }
const electronPath = process.env.DEADLOCK_ELECTRON_BINARY
  || [path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), path.join(root, 'dist', 'win-unpacked', 'Deadlock Roulette.exe')].find(existsSync);
if (!electronPath) throw new Error('An Electron binary is unavailable. Run npm install before this opt-in check.');

const port = Number(process.env.DEADLOCK_ZOOM_SMOKE_PORT || 9230);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Valid debug port required');
// A fresh profile ensures checks never touch the user's history or preferences.
const profile = path.join(root, '.smoke-profile', `zoom-${Date.now()}-${process.pid}`);
const artifacts = path.join(root, 'artifacts');
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(artifacts, { recursive: true });
const STORAGE_KEY = 'deadlock-roulette.session.v1';
const levels = [0.75, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];
const checks = [];
const rendererErrors = [];
const logs = [];
const layouts = [];
const screenshots = [];
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let application;
let browser;
let page;
let baselineDPR;

function check(label) {
  checks.push(label);
  console.log(`PASS ${label}`);
}

async function launch() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  application = spawn(electronPath, [root, '--smoke-test', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'], {
    cwd: root, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let spawnError;
  application.once('error', error => { spawnError = error; });
  for (const stream of [application.stdout, application.stderr]) stream.on('data', buffer => logs.push(buffer.toString()));
  const deadline = Date.now() + 30_000;
  let connected = false;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (application.exitCode !== null) throw new Error(`Electron exited early (${application.exitCode}). ${logs.join('')}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { connected = true; break; }
    } catch { /* Wait for the local debug listener to be ready. */ }
    await delay(150);
  }
  assert.ok(connected, `Electron CDP listener did not start. ${logs.join('')}`);
  browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  assert.ok(context, 'Electron default browser context exists');
  page = context.pages().find(candidate => candidate.url().endsWith('/src/index.html')) || context.pages()[0];
  assert.ok(page, 'Electron application page exists');
  page.on('pageerror', error => rendererErrors.push(error.message));
  await page.setViewportSize({ width: 2560, height: 1440 });
  await ready();
}

async function ready() {
  await page.waitForFunction(() => document.querySelectorAll('.catalog-card').length > 0
    && document.querySelector('#zoom-select')?.options.length > 0, undefined, { timeout: 15_000 });
}

async function stop() {
  if (page && !page.isClosed()) await Promise.race([page.evaluate(() => window.close()).catch(() => {}), delay(1500)]);
  const child = application;
  const deadline = Date.now() + 5000;
  while (child && child.exitCode === null && Date.now() < deadline) await delay(50);
  if (child && child.exitCode === null) child.kill();
  if (browser) await Promise.race([browser.close().catch(() => {}), delay(1500)]);
  browser = null;
  page = null;
  application = null;
}

async function saved() {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), STORAGE_KEY);
}

async function assertZoom(factor) {
  await page.waitForFunction(({ key, factor, baselineDPR }) => {
    const savedFactor = JSON.parse(localStorage.getItem(key) || '{}').preferences?.zoomFactor;
    return Number(document.querySelector('#zoom-select')?.value) === factor
      && savedFactor === factor
      && Math.abs(window.devicePixelRatio / baselineDPR - factor) < 0.02;
  }, { key: STORAGE_KEY, factor, baselineDPR }, { timeout: 10_000 });
}

async function selectZoom(factor) {
  const option = await page.locator('#zoom-select option').evaluateAll((options, factor) =>
    options.find(option => Number(option.value) === factor)?.value, factor);
  assert.ok(option, `Zoom option exists for ${factor}`);
  await page.locator('#zoom-select').selectOption(option);
  await assertZoom(factor);
}

async function keyboard(key, factor) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(key);
  await assertZoom(factor);
}

async function screenshot(filename) {
  const cdp = await page.context().newCDPSession(page);
  let timeout;
  try {
    const capture = await Promise.race([
      cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Hidden-window screenshot timed out.')), 15_000); }),
    ]);
    await fs.writeFile(path.join(artifacts, filename), Buffer.from(capture.data, 'base64'));
    screenshots.push(filename);
  } finally { clearTimeout(timeout); await cdp.detach().catch(() => {}); }
}

async function inspectLayout(factor) {
  const metrics = await page.evaluate(() => {
    const zoomControls = ['zoom-out-button', 'zoom-select', 'zoom-in-button'].map(id => {
      const element = document.getElementById(id);
      const rect = element.getBoundingClientRect();
      return { id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    });
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      dpr: window.devicePixelRatio,
      zoomControls,
    };
  });
  layouts.push({ factor, ...metrics });
  assert.ok(metrics.scrollWidth <= metrics.innerWidth + 1, `No document overflow at ${factor * 100}%: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.bodyScrollWidth <= metrics.innerWidth + 1, `No body overflow at ${factor * 100}%`);
  for (const rect of metrics.zoomControls) {
    assert.ok(rect.width > 0 && rect.height > 0, `${rect.id} remains visible at ${factor * 100}%`);
    assert.ok(rect.left >= -1 && rect.right <= metrics.innerWidth + 1, `${rect.id} remains in horizontal viewport at ${factor * 100}%`);
  }
  return metrics;
}

try {
  await launch();
  baselineDPR = await page.evaluate(() => window.devicePixelRatio);
  assert.equal(Number(await page.locator('#zoom-select').inputValue()), 1, 'Fresh profile starts at 100%');
  assert.equal((await saved()).history.length, 0);
  assert.deepEqual(await page.locator('#zoom-select option').evaluateAll(options => options.map(option => Number(option.value))), levels);
  assert.equal(await page.locator('#zoom-out-button').isEnabled(), true);
  assert.equal(await page.locator('#zoom-in-button').isEnabled(), true);
  check('zoom controls and all eight supported scale levels are available');

  await page.locator('#speed-button').click();
  await page.locator('#spin-button').click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').history?.length === 1
    && !document.querySelector('#spin-button').disabled, STORAGE_KEY, { timeout: 15_000 });
  const draw = (await saved()).history;
  for (const factor of levels) await selectZoom(factor);
  assert.deepEqual((await saved()).history, draw);
  assert.equal(await page.locator('#zoom-in-button').isDisabled(), true, 'Plus disabled at upper bound');
  await selectZoom(0.75);
  assert.equal(await page.locator('#zoom-out-button').isDisabled(), true, 'Minus disabled at lower bound');
  check('all scale choices change native renderer pixel ratio and preserve the existing draw');

  await selectZoom(1.25);
  await page.locator('#zoom-in-button').click();
  await assertZoom(1.5);
  await page.locator('#zoom-out-button').click();
  await assertZoom(1.25);
  await keyboard('Control+=', 1.5);
  await keyboard('Control+-', 1.25);
  await keyboard('Control+0', 1);
  check('plus/minus controls and Ctrl+plus, Ctrl+minus, Ctrl+0 update scale and its saved value');

  await page.keyboard.down('Control');
  try { await page.mouse.wheel(0, -120); }
  finally { await page.keyboard.up('Control'); }
  await assertZoom(1.1);
  await page.keyboard.down('Control');
  try { await page.mouse.wheel(0, 120); }
  finally { await page.keyboard.up('Control'); }
  await assertZoom(1);
  check('Ctrl+mouse wheel adjusts scale in both directions');

  for (const factor of [1.5, 2]) {
    await selectZoom(factor);
    await inspectLayout(factor);
    await page.evaluate(() => window.scrollTo(0, 0));
    await screenshot(`zoom-${factor * 100}-2560x1440.png`);
  }
  check('2560×1440 layout at 150% and 200% stays within the viewport; screenshots saved');

  await selectZoom(1.5);
  await page.reload({ waitUntil: 'load' });
  await ready();
  await assertZoom(1.5);
  assert.deepEqual((await saved()).history, draw);
  check('page reload restores the chosen scale and draw history');

  await stop();
  await launch();
  await assertZoom(1.5);
  assert.deepEqual((await saved()).history, draw);
  assert.equal(Number(await page.locator('#drawn-count').innerText()), 1);
  assert.equal(Number(await page.locator('#pool-count').innerText()), 155);
  check('complete Electron restart restores native scale, history and no-repeat pool');

  await page.locator('#reset-button').click();
  await page.locator('#confirm-reset').click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).history.length === 0, STORAGE_KEY);
  await assertZoom(1.5);
  assert.equal(Number(await page.locator('#pool-count').innerText()), 156);
  check('resetting roulette history preserves the chosen scale');

  assert.deepEqual(rendererErrors, [], 'No uncaught renderer errors');
  await fs.writeFile(path.join(artifacts, 'zoom-smoke-report.json'), JSON.stringify({
    passed: true, checks, rendererErrors, profile, baselineDPR, physicalViewport: { width: 2560, height: 1440 }, layouts, screenshots,
  }, null, 2));
  console.log(`Zoom smoke passed. Screenshots: ${artifacts}`);
} catch (error) {
  if (page && !page.isClosed()) await screenshot('zoom-smoke-failure.png').catch(() => {});
  await fs.writeFile(path.join(artifacts, 'zoom-smoke-report.json'), JSON.stringify({
    passed: false, checks, error: error.stack, rendererErrors, profile, baselineDPR, layouts, screenshots, electronLogs: logs.join('').slice(-10_000),
  }, null, 2));
  throw error;
} finally {
  await stop();
}
