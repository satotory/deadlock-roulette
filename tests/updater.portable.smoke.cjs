'use strict';

// Explicit integration smoke only. Never install onto dist or a user's executable.
// Preserve a 1.9.0 copy in .smoke-data/updater-real-UUID before rebuilding, then run:
// node tests/updater.portable.smoke.cjs --run --fixture <absolute fixture directory>
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { once } = require('node:events');
const { createDesktopUpdater } = require('../desktop-updater.cjs');
const core = require('../update-core.cjs');
const root = path.resolve(__dirname, '..');
const fixtureRoot = path.join(root, '.smoke-data');
const oldDigest = '5ec20b506875ded1ece539e6f653c41cbea871de2e78c0a664ed134444087f4f';
const storageKey = 'deadlock-roulette.session.v1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const argument = name => process.argv[process.argv.indexOf(name) + 1];
async function digest(file) { const sha = crypto.createHash('sha256'); for await (const chunk of fsSync.createReadStream(file)) sha.update(chunk); return sha.digest('hex'); }
function fixturePaths(directory) {
  directory = path.resolve(directory);
  assert.equal(path.dirname(directory).toLowerCase(), fixtureRoot.toLowerCase(), 'Only a fixture directly inside .smoke-data is allowed.');
  assert.match(path.basename(directory), /^updater-real-[a-f0-9-]{36}$/i);
  return { directory, target: path.join(directory, 'Deadlock Roulette.exe'), profile: path.join(directory, 'isolated profile'), worker: path.join(directory, 'worker.json') };
}
async function json(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
async function waitFor(fn, ms = 90_000) { const deadline = Date.now() + ms; while (Date.now() < deadline) { const result = await fn(); if (result) return result; await sleep(250); } throw new Error('Portable update smoke timed out.'); }

async function launchDebug(p, port) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(p.target, ['--smoke-test', `--user-data-dir=${p.profile}`, `--remote-debugging-port=${port}`], { cwd: root, windowsHide: true, stdio: 'ignore', env });
  let exited = false, launchError; child.once('exit', () => { exited = true; }); child.once('error', error => { launchError = error; });
  const page = await waitFor(async () => {
    if (launchError) throw launchError;
    if (exited) throw new Error('Fixture portable closed before its UI loaded.');
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json()).find(entry => entry.type === 'page' && entry.url.includes('index.html')); } catch { return null; }
  });
  const socket = new WebSocket(page.webSocketDebuggerUrl); await once(socket, 'open');
  let id = 0; const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id); if (!request) return;
    clearTimeout(request.timer); pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  function call(method, params) { return new Promise((resolve, reject) => { const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(new Error(`Timed out: ${method}`)); }, 15_000); pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params })); }); }
  async function evaluate(expression) { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails)); return result.result.value; }
  await waitFor(() => evaluate("Boolean(window.deadlock && Number(document.querySelector('#total-count')?.textContent) > 0)"));
  return { evaluate, call, async close() { await evaluate('window.close()').catch(() => {}); await waitFor(async () => exited, 15_000); socket.close(); } };
}

async function worker(p, nextFile) {
  const next = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
  const size = (await fs.stat(nextFile)).size, sha = await digest(nextFile);
  const exeURL = `${core.PROJECT_URL}/releases/download/v${next}/Deadlock.Roulette.exe`;
  const sumURL = `${core.PROJECT_URL}/releases/download/v${next}/SHA256SUMS.txt`;
  const checksum = `${sha}  Deadlock.Roulette.exe\n`;
  let saved = null;
  const instance = createDesktopUpdater({ version: '1.9.0', isPackaged: true, platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: p.target, PORTABLE_EXECUTABLE_DIR: p.directory }, userData: p.profile,
    fetchImpl: async url => {
      if (url === core.RELEASE_API) return new Response(JSON.stringify({ tag_name: `v${next}`, draft: false, prerelease: false, assets: [
        { name: 'Deadlock.Roulette.exe', state: 'uploaded', size, digest: `sha256:${sha}`, browser_download_url: exeURL },
        { name: 'SHA256SUMS.txt', state: 'uploaded', size: checksum.length, browser_download_url: sumURL },
      ] }), { status: 200 });
      if (url === sumURL) return new Response(checksum);
      if (url === exeURL) return new Response(Readable.toWeb(fsSync.createReadStream(nextFile)), { headers: { 'content-length': String(size) } });
      throw new Error('Unexpected update network request.');
    },
    onState(state) { saved = state; },
    quit() { const pending = JSON.parse(fsSync.readFileSync(path.join(p.profile, 'updates/pending.json'), 'utf8')); fsSync.writeFileSync(p.worker, JSON.stringify({ final: saved, next, sha, pending, parentPid: process.pid })); process.exit(0); },
  });
  assert.equal((await instance.checkForUpdates()).status, 'available');
  const result = await instance.installUpdate();
  if (result.status !== 'installing') { await fs.writeFile(p.worker, JSON.stringify({ final: result })); throw new Error(JSON.stringify(result)); }
}

function closeOnlyFixtureProfile(p) {
  // Profile is encoded data. Never enumerate or stop unrelated app processes.
  const encoded = Buffer.from(p.profile).toString('base64');
  const script = `$profilePath=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); $ids=@(); Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($profilePath,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.Name -in @('Deadlock Roulette.exe','Deadlock.Roulette.exe') } | ForEach-Object { $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if($p -and $p.MainWindowHandle -ne 0) { $ids+=$p.Id; $null=$p.CloseMainWindow() } }; ConvertTo-Json -InputObject @($ids) -Compress`;
  const result = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.error, undefined, result.error?.message); assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim() || '[]');
}

async function run(p, nextFile) {
  assert.equal(await digest(p.target), oldDigest, 'The fixture must be the preserved 1.9.0 portable.');
  assert.notEqual(await digest(nextFile), oldDigest, 'Build 1.10.0 before running this smoke.');
  await fs.mkdir(p.profile, { recursive: true });
  await fs.writeFile(path.join(p.profile, 'session.json'), '{"sentinel":"portable-update-preserves-profile"}');
  const port = 18000 + process.pid % 1000;
  let app = await launchDebug(p, port);
  let baseline;
  try {
    assert.equal(await app.evaluate('window.deadlock.getVersion()'), '1.9.0');
    baseline = await app.evaluate(`Promise.all([import('./session.js'),import('./build-core.js'),import('./catalog-data.js'),import('./hero-data.js')]).then(([sessions,core,{default:catalog},{default:heroes}])=>{
      const hero=heroes.heroes.find(hero=>hero.id==='haze')||heroes.heroes[0];
      const session=sessions.createSession({build:{heroId:hero.id,name:'Portable update test',...core.generateSkillPlan(hero),history:catalog.items.slice(0,3).map((item,index)=>({itemId:item.id,time:1000+index,drawId:'updater-fixture-'+index,acquiredOrder:index+1}))},preferences:{language:'en',mode:'build',zoomFactor:1.25,music:false,sound:false,voices:false,uiSound:false,musicVolume:.17,soundVolume:.39,uiVolume:.21,voiceVolume:.43}},catalog.items);
      localStorage.setItem(${JSON.stringify(storageKey)},JSON.stringify(session));localStorage.setItem('deadlock-roulette.guide.v1',JSON.stringify({offered:true,completed:true}));return session;
    })`);
    assert.equal(baseline.build.history.length, 3);
    await fs.writeFile(path.join(p.directory, 'before-session.json'), JSON.stringify(baseline, null, 2));
  } catch(error) { await app.close(); app = null; throw error; }
  console.log('Old portable profile seeded. Starting actual replacement helper while the old app still holds its launcher.');
  const child = spawn(process.execPath, [__filename, '--worker', '--fixture', p.directory, '--next', nextFile], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let workerLog = ''; child.stdout.on('data', data => { workerLog += data; }); child.stderr.on('data', data => { workerLog += data; });
  try {
    const [exitCode] = await once(child, 'exit'); assert.equal(exitCode, 0, workerLog);
    assert.equal(await digest(p.target), oldDigest, 'The running old portable must still be retained until its window closes.');
  } finally { await app.close(); app = null; }
  const result = await json(p.worker), pending = result.pending;
  const statusFile = path.join(p.profile, 'updates', `${pending.nonce}.status.json`);
  const status = await waitFor(async () => { try { const status = await json(statusFile); if (['failed','rolled-back','recovery-failed'].includes(status.phase)) throw new Error(JSON.stringify(status)); if(status.phase !== 'completed') return null; const success=await json(path.join(p.profile,'updates/last-success.json')); return success.nonce===pending.nonce ? status : null; } catch(error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; } }, 100_000);
  const success = await json(path.join(p.profile, 'updates/last-success.json'));
  assert.equal(await digest(p.target), result.sha); assert.equal(await digest(success.backup), oldDigest);
  assert.equal(await fs.readFile(path.join(p.profile, 'session.json'), 'utf8'), '{"sentinel":"portable-update-preserves-profile"}');
  const closedPids = closeOnlyFixtureProfile(p); assert(closedPids.length > 0, 'The updated app should have a window to close normally.');
  await sleep(2000);
  app = await launchDebug(p, port + 1000);
  try {
    assert.equal(await app.evaluate('window.deadlock.getVersion()'), result.next);
    const restored = await app.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}))`);
    assert.deepEqual(restored, baseline, 'Canonical build, skill plan, inventory and preferences must survive the update.');
    const report = { version: result.next, fixture: p.directory, oldDigest, newDigest: result.sha, helperPhase: status.phase, nativeReplacement: true, actualPortableRelaunch: true, backupPreserved: true, canonicalSessionPreserved: true, profileSentinelPreserved: true, normallyClosedPids: closedPids };
    await fs.writeFile(path.join(p.directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { await app.close(); }
}

if (require.main === module && (process.argv.includes('--run') || process.argv.includes('--worker'))) {
  const directory = argument('--fixture'); if (!directory) throw new Error('An explicit --fixture is required.');
  const p = fixturePaths(directory), nextFile = path.resolve(process.argv.includes('--next') ? argument('--next') : process.env.DEADLOCK_SMOKE_EXE || path.join(root, 'dist/Deadlock Roulette.exe'));
  (process.argv.includes('--worker') ? worker(p, nextFile) : run(p, nextFile)).catch(error => { console.error(error); if(process.argv.includes('--run')) { try { closeOnlyFixtureProfile(p); } catch(cleanupError) { console.error('Fixture-only window cleanup:', cleanupError.message); } } process.exitCode = 1; });
}
