// Native first-visit and header checks use an isolated profile and the real production UI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv.includes('--source');
const executable = source ? path.join(root, 'node_modules/electron/dist/electron.exe') : process.env.DEADLOCK_SMOKE_EXE || path.join(root, 'dist/Deadlock Roulette.exe');
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const profile = path.join(root, '.smoke-data', `polish-${Date.now()}`);
const port = 15000 + process.pid % 1000;
const storageKey = 'deadlock-roulette.session.v1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
await fs.mkdir(profile, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [...(source ? [root] : []), '--smoke-test', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], { cwd: root, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
const logs = [], failures = [];
child.stdout.on('data', chunk => logs.push(String(chunk))); child.stderr.on('data', chunk => logs.push(String(chunk)));
let exited = false, spawnError, exitDetails, socket, nextId = 1;
child.on('error', error => { spawnError = error; }); child.on('exit', (code, signal) => { exited = true; exitDetails = { code, signal }; });
const pending = new Map();
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (socket?.readyState !== WebSocket.OPEN) { reject(new Error(`No Chromium connection for ${method}`)); return; }
    const id = nextId++, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails)); return result.result.value;
}
async function until(expression, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(60); }
  throw new Error(`UI did not reach: ${expression}`);
}
const state = () => evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}) || '{}')`);
function gameplay(snapshot) {
  const copy = structuredClone(snapshot); delete copy.preferences.mode; delete copy.preferences.zoomFactor; delete copy.preferences.language;
  return copy;
}
async function key(key, code, windowsVirtualKeyCode) {
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
}
async function assertGeometry() {
  await evaluate("Promise.all([...document.querySelector('.guide-card').getAnimations(),...document.querySelector('.guide-spotlight').getAnimations()].map(animation=>animation.finished.catch(()=>{}))).then(()=>true)");
  const rects = await evaluate(`(() => { const box=element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}; const overlay=document.querySelector('#guide-overlay');return {width:innerWidth,height:innerHeight,card:box(overlay.querySelector('.guide-card')),spot:overlay.querySelector('.guide-spotlight').hidden?null:box(overlay.querySelector('.guide-spotlight'))};})()`);
  assert.ok(rects.spot, 'Each guide step highlights an actual visible application control');
  for (const [label, rect] of Object.entries({ card: rects.card, spotlight: rects.spot })) {
    if (!rect) continue;
    assert.ok(rect.left >= -1 && rect.top >= -1 && rect.right <= rects.width + 1 && rect.bottom <= rects.height + 1, `${label} stays in the viewport: ${JSON.stringify(rects)}`);
    assert.ok(rect.width > 5 && rect.height > 5, `${label} is visible`);
  }
}
async function setScale(value) {
  await evaluate(`document.querySelector('#zoom-select').value=${JSON.stringify(String(value))};document.querySelector('#zoom-select').dispatchEvent(new Event('change',{bubbles:true}))`);
  await until(`Math.abs((parseFloat(document.querySelector('#zoom-select').value)||0)-${value})<.001`);
  await sleep(100);
}

try {
  let page;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(entry => entry.type === 'page' && entry.url.includes('index.html')); if (page) break; } catch { /* Wait for the runtime. */ }
    if (exited) throw new Error(`Application exited before rendering (${JSON.stringify(exitDetails)}): ${logs.join('').slice(-3000)}`);
    await sleep(100);
  }
  assert.ok(page, 'The app should load its own renderer');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const job = pending.get(message.id); if (!job) return; pending.delete(message.id); clearTimeout(job.timer); if (message.error) job.reject(new Error(message.error.message)); else job.resolve(message.result); }
    else if (message.method === 'Runtime.exceptionThrown') failures.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') failures.push(message.params.entry.text);
  });
  socket.addEventListener('close', () => { for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('The app closed its Chromium connection.')); } pending.clear(); });
  await call('Runtime.enable'); await call('Log.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await until("Number(document.querySelector('#total-count')?.textContent)>0 && document.querySelector('#guide-welcome-dialog')?.open");
  const initial = await state();
  assert.equal(await evaluate('window.deadlock.getVersion()'), version);
  assert.equal(initial.preferences.mode, 'roulette');
  assert.equal(initial.preferences.language, 'en', 'A fresh profile starts in English');
  assert.equal(initial.preferences.musicVolume, .01, 'New profiles start with music at one percent');
  assert.equal(initial.preferences.curseChance, 0, 'New profiles start with curses disabled');
  assert.equal(await evaluate("import('./audio.js').then(({audio})=>audio.state.musicVolume)"), .01, 'The initial audio channel uses the saved quiet default');
  assert.equal(await evaluate("document.querySelector('#guide-welcome-dialog').lang"), 'en');
  await evaluate("document.querySelector('#guide-start').click()");
  await until("!document.querySelector('#guide-overlay').hidden && document.querySelector('#guide-overlay').dataset.guideStep==='modes' && !document.querySelector('[data-guide-next]').disabled");
  await assertGeometry();
  await key(' ', 'Space', 32);
  assert.deepEqual(gameplay(await state()), gameplay(initial), 'Space does not spin or spend a charge during a guide');
  const steps = await evaluate("import('./guide.js').then(({GUIDE_STEPS})=>GUIDE_STEPS.map(step=>step.id))");
  assert.deepEqual(steps, ['modes', 'weights', 'tiers', 'wheel', 'draw', 'catalogue', 'comfort', 'hero', 'route', 'skills', 'balance', 'events', 'archive', 'links']);
  await evaluate("document.querySelector('[data-guide-next]').click()");
  await until("document.querySelector('#guide-overlay').dataset.guideStep==='weights' && !document.querySelector('[data-guide-next]').disabled");
  await evaluate("document.querySelector('[data-guide-back]').click()");
  await until("document.querySelector('#guide-overlay').dataset.guideStep==='modes' && !document.querySelector('[data-guide-next]').disabled");
  const visited = [];
  for (let index = 0; index < steps.length; index++) {
    await until(`document.querySelector('#guide-overlay').dataset.guideStep===${JSON.stringify(steps[index])} && !document.querySelector('[data-guide-next]').disabled`);
    assert.ok(await evaluate("document.querySelector('#guide-title').textContent.length>3 && document.querySelector('#guide-description').textContent.length>20"));
    await assertGeometry(); visited.push(steps[index]);
    await evaluate("document.querySelector('[data-guide-next]').click()");
  }
  await until("document.querySelector('#guide-overlay').hidden");
  assert.equal(await evaluate('document.body.dataset.mode'), initial.preferences.mode, 'Finishing restores the starting mode');
  assert.deepEqual(gameplay(await state()), gameplay(initial), 'The complete guide does not draw or alter anything');
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('deadlock-roulette.guide.v1')).completed"), true);

  // Populate both modes through the real controls. Replay must preserve real results
  // and spent actions, rather than merely preserving an empty first-visit session.
  await evaluate(`{
    document.querySelector('#speed-button').click();
    const curse=document.querySelector('#curse-chance');curse.value='0';curse.dispatchEvent(new Event('input',{bubbles:true}));
    const pairs=document.querySelector('#pairs-enabled');pairs.checked=false;pairs.dispatchEvent(new Event('change',{bubbles:true}));
    for(const name of ['chickenChance','archmotherChance','hiddenKingChance']){const slider=document.querySelector('#build-'+name);slider.value='0';slider.dispatchEvent(new Event('input',{bubbles:true}));}
    document.querySelector('#spin-button').click();
  }`);
  await until("JSON.parse(localStorage.getItem('deadlock-roulette.session.v1')).history.length===1 && !document.querySelector('#reroll-button').disabled");
  await evaluate("document.querySelector('#reroll-button').click()");
  await until("JSON.parse(localStorage.getItem('deadlock-roulette.session.v1')).itemActions.usedActions.includes('reroll') && !document.querySelector('#spin-button').disabled");
  await evaluate("document.querySelector('button[data-mode=build]').click();document.querySelector('#build-hero-random').click()");
  await until("JSON.parse(localStorage.getItem('deadlock-roulette.session.v1')).build.heroId && !document.querySelector('#build-hero-random').disabled");
  await evaluate("document.querySelector('#build-item-random').click()");
  await until("JSON.parse(localStorage.getItem('deadlock-roulette.session.v1')).build.history.length===1 && !document.querySelector('#build-reroll-button').disabled");
  await evaluate("document.querySelector('#build-reroll-button').click()");
  await until("JSON.parse(localStorage.getItem('deadlock-roulette.session.v1')).build.itemActions.usedActions.includes('reroll') && !document.querySelector('#build-item-random').disabled");
  await evaluate("document.querySelector('button[data-mode=build]').click();document.querySelector('#language-button').click()");
  assert.equal(await evaluate('document.documentElement.lang'), 'ru');
  const beforeReplay = await state();
  for (const scale of [1.25, 2]) {
    await setScale(scale);
    await evaluate("document.querySelector('#guide-button').click()");
    await until("!document.querySelector('#guide-overlay').hidden && !document.querySelector('[data-guide-next]').disabled");
    assert.equal(await evaluate("document.querySelector('#guide-overlay').lang"), 'ru');
    assert.equal(await evaluate("document.querySelector('#guide-title').textContent"), 'Два способа довериться случаю');
    await key(' ', 'Space', 32);
    for (let index = 0; index < steps.length; index++) {
      await until(`document.querySelector('#guide-overlay').dataset.guideStep===${JSON.stringify(steps[index])} && !document.querySelector('[data-guide-next]').disabled`);
      await assertGeometry();
      if (index < steps.length - 1) await evaluate("document.querySelector('[data-guide-next]').click()");
    }
    await key('Escape', 'Escape', 27);
    await until("document.querySelector('#guide-overlay').hidden && document.body.dataset.mode==='build'");
    assert.deepEqual(gameplay(await state()), gameplay(beforeReplay), 'Skipping restores the original build mode and all game state');
  }
  await setScale(1);
  await evaluate("document.querySelector('#language-button').click()");
  assert.equal(await evaluate('document.documentElement.lang'), 'en');
  await evaluate("document.querySelector('#guide-button').click()");
  await until("!document.querySelector('#guide-overlay').hidden && !document.querySelector('[data-guide-next]').disabled");
  assert.equal(await evaluate("document.querySelector('#guide-overlay').lang"), 'en');
  await evaluate("document.querySelector('[data-guide-skip]').click()");
  await until("document.querySelector('#guide-overlay').hidden && document.body.dataset.mode==='build'");
  assert.equal(await evaluate("document.querySelector('#github-link').href"), 'https://github.com/satotory/deadlock-roulette');
  assert.equal(await evaluate("document.querySelector('#share-button').title"), 'Share this app');
  assert.equal(await evaluate("document.querySelector('#share-link-value').value"), 'https://satotory.github.io/deadlock-roulette/');
  assert.equal(await evaluate("/offline|офлайн/i.test(document.body.innerText)"), false, 'No offline branding is displayed');
  await evaluate("document.querySelector('#update-button').click()");
  await until("document.querySelector('#app-update-dialog').open");
  if (source) assert.equal(await evaluate("document.querySelector('[data-update-install]').hidden"), true, 'Development never offers to replace an executable');
  assert.ok(await evaluate("document.querySelector('[data-update-copy]').textContent.length>15"));
  assert.equal(await evaluate("document.querySelector('[data-update-releases]').href"), 'https://github.com/satotory/deadlock-roulette/releases/latest');
  await evaluate("document.querySelector('[data-update-close]').click()");
  await until("!document.querySelector('#app-update-dialog').open");
  const malformed = await evaluate("import('./app-updates.js').then(({parseWebRelease,safeUpdateState})=>{let rejected=false;try{parseWebRelease({version:'bad',releaseURL:'https://untrusted.example'})}catch{rejected=true}const state=safeUpdateState({status:'unknown',currentVersion:'bad',canInstall:'true',releaseURL:'https://untrusted.example'});return {rejected,status:state.status,canInstall:state.canInstall,releaseURL:state.releaseURL}})");
  assert.deepEqual(malformed, { rejected: true, status: 'error', canInstall: false, releaseURL: 'https://github.com/satotory/deadlock-roulette/releases/latest' });
  assert.equal(failures.length, 0, failures.join('\n'));
  const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(path.join(root, '.smoke-data', `polish-${source ? 'source' : 'portable'}.png`), Buffer.from(shot.data, 'base64'));
  const report = { status: 'pass', runtime: source ? 'source' : 'portable', version, defaults: { language: initial.preferences.language, musicVolume: initial.preferences.musicVolume, curseChance: initial.preferences.curseChance }, welcome: true, steps: visited, spaceBlocked: true, backAndNext: true, replayAndEscape: true, language: true, scaledGeometry: [125, 200], modeRestored: true, gameplayPreserved: true, publicLinks: true, updateDialog: true, malformedMetadata: true, noOfflineBranding: true, profile };
  await fs.writeFile(path.join(root, '.smoke-data', `polish-${source ? 'source' : 'portable'}-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(logs.join('').slice(-2500)); throw error; }
finally {
  if (socket?.readyState === WebSocket.OPEN) await evaluate('window.close()').catch(() => {});
  socket?.close();
  if (!exited) await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(3000)]);
  if (!exited) child.kill();
}
