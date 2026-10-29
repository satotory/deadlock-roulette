'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const core = require('../update-core.cjs');
const updater = require('../desktop-updater.cjs');

const assetURL = (version = '1.10.0', filename = 'Deadlock.Roulette.exe') => `${core.PROJECT_URL}/releases/download/v${version}/${filename}`;
function binary(label = 'new') { const bytes = Buffer.alloc(65536); bytes.write('MZ'); bytes.writeUInt32LE(128, 0x3c); bytes.write('PE\0\0', 128); bytes.write(label, 512); return bytes; }
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function release(bytes = binary(), changes = {}) {
  return { tag_name: 'v1.10.0', draft: false, prerelease: false, assets: [{ name: 'Deadlock.Roulette.exe', state: 'uploaded', size: bytes.length, browser_download_url: assetURL(), digest: `sha256:${hash(bytes)}` }], ...changes };
}
async function fixture(t) {
  const fixtureRoot = path.resolve(__dirname, '..', '.smoke-data');
  await fs.mkdir(fixtureRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(fixtureRoot, 'deadlock-updater-'));
  assert.equal(path.dirname(directory), fixtureRoot);
  t.after(async () => { assert(path.basename(directory).startsWith('deadlock-updater-')); assert.equal(path.dirname(directory), fixtureRoot); await fs.rm(directory, { recursive: true, force: true }); });
  const target = path.join(directory, "Deadlock player's app.exe"), userData = path.join(directory, 'separate profile');
  await fs.mkdir(userData);
  await fs.writeFile(target, binary('old'));
  await fs.writeFile(path.join(userData, 'session.json'), '{"hero":"Haze","items":[1,2,3]}');
  return { directory, target, userData };
}
function fetchFixture(data, bytes = binary(), calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    if (url === core.RELEASE_API) return new Response(JSON.stringify(data), { status: 200 });
    if (url === assetURL()) return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
    if (url === assetURL('1.10.0', 'SHA256SUMS.txt')) return new Response(`${hash(bytes)}  Deadlock.Roulette.exe\n`, { status: 200 });
    throw new Error('An unexpected network destination was requested.');
  };
}

test('stable release versions compare numerically and reject prerelease or malformed tags', () => {
  assert.equal(core.compareVersions('1.10.0', '1.9.99'), 1);
  assert.equal(core.compareVersions('v1.10.0', '1.10.0'), 0);
  assert.equal(core.compareVersions('1.2.9', '1.10.0'), -1);
  for (const bad of ['1.10.0-rc.1', 'latest', 'v01.10.0', '1.10', '1.2.3.4', {}, null]) assert.equal(core.normalizeVersion(bad), null);
  for (const changes of [{ draft: true }, { prerelease: true }, { tag_name: 'v1.11.0-beta' }]) assert.throws(() => core.describeRelease(release(binary(), changes), '1.9.0'), { code: 'invalid-release' });
});

test('release selection is fixed to this repository, supported Windows asset and a SHA-256', () => {
  const result = core.describeRelease(release(), '1.9.0');
  assert.equal(result.latestVersion, '1.10.0'); assert.equal(result.newer, true); assert.equal(result.assetURL, assetURL());
  assert.equal(core.describeRelease(release(binary(), { assets: [] }), '1.10.0').newer, false);
  const base = release();
  for (const value of ['https://github.com/another/project/releases/download/v1.10.0/Deadlock.Roulette.exe', 'http://github.com/satotory/deadlock-roulette/releases/download/v1.10.0/Deadlock.Roulette.exe', 'https://github.com.evil.test/satotory/deadlock-roulette/releases/download/v1.10.0/Deadlock.Roulette.exe', assetURL() + '?redirect=bad']) {
    assert.throws(() => core.describeRelease({ ...base, assets: [{ ...base.assets[0], browser_download_url: value }] }, '1.9.0'), { code: 'invalid-release' });
  }
  assert.throws(() => core.describeRelease({ ...base, assets: [{ ...base.assets[0], digest: null }] }, '1.9.0'), { code: 'checksum-missing' });
  assert.throws(() => core.describeRelease({ ...base, assets: [{ ...base.assets[0], size: core.MAX_DOWNLOAD_BYTES + 1 }] }, '1.9.0'), { code: 'asset-missing' });
  assert.throws(() => core.describeRelease({ ...base, assets: [{ ...base.assets[0], name: 'arbitrary.exe' }] }, '1.9.0'), { code: 'asset-missing' });
});

test('checksum fallback accepts only the exact executable name and rejects conflicting entries', () => {
  const digest = hash(binary()), other = hash(binary('other'));
  assert.equal(core.parseChecksumFile(`\uFEFF${digest.toUpperCase()} *Deadlock.Roulette.exe\r\n`, 'Deadlock.Roulette.exe'), digest);
  assert.equal(core.parseChecksumFile(`${digest}  Deadlock Roulette.exe\n`, 'Deadlock Roulette.exe'), digest);
  assert.throws(() => core.parseChecksumFile(`${digest}  ../Deadlock.Roulette.exe`, 'Deadlock.Roulette.exe'), { code: 'checksum-missing' });
  assert.throws(() => core.parseChecksumFile(`${digest}  Deadlock.Roulette.exe\n${other}  Deadlock.Roulette.exe`, 'Deadlock.Roulette.exe'), { code: 'checksum-mismatch' });
});

test('only a packaged Windows portable path can be replaced', () => {
  const options = { platform: 'win32', isPackaged: true, pathImpl: path.win32, env: { PORTABLE_EXECUTABLE_FILE: 'C:\\Users\\player\\Downloads\\Deadlock.exe', PORTABLE_EXECUTABLE_DIR: 'C:\\Users\\player\\Downloads' } };
  assert.equal(core.portableTarget(options).supported, true);
  assert.equal(core.portableTarget({ ...options, isPackaged: false }).reason, 'development');
  assert.equal(core.portableTarget({ ...options, platform: 'linux' }).reason, 'windows-only');
  for (const value of ['relative.exe', '\\\\server\\share\\Deadlock.exe', 'C:\\Windows\\bad.txt', 'C:\\Users\\player\\bad.exe\n']) assert.equal(core.portableTarget({ ...options, env: { PORTABLE_EXECUTABLE_FILE: value } }).supported, false);
  assert.equal(core.portableTarget({ ...options, env: { ...options.env, PORTABLE_EXECUTABLE_DIR: 'C:\\another-folder' } }).supported, false);
});

test('update requests reject foreign redirects, metadata redirects and HTTP failures', async () => {
  const calls = [];
  await assert.rejects(updater.fetchTrusted(assetURL(), { maxBytes: 100, fetchImpl: async url => { calls.push(url); return new Response(null, { status: 302, headers: { location: 'https://evil.example/update.exe' } }); } }), { code: 'invalid-release' });
  assert.equal(calls.length, 1, 'A foreign host is never contacted.');
  await assert.rejects(updater.fetchTrusted(core.RELEASE_API, { kind: 'metadata', maxBytes: 100, fetchImpl: async () => new Response(null, { status: 302, headers: { location: core.RELEASE_API } }) }), { code: 'invalid-release' });
  await assert.rejects(updater.fetchTrusted(core.RELEASE_API, { kind: 'metadata', maxBytes: 100, fetchImpl: async () => new Response('', { status: 403 }) }), { code: 'rate-limit' });
  assert.equal(core.isPermittedRequest('https://github.com/evil/project/file', { initialURL: 'https://github.com/evil/project/file' }), false);
  assert.equal(core.isPermittedRequest('https://release-assets.githubusercontent.com/signed/file?token=temporary', { initialURL: assetURL(), redirect: true }), true);
});

test('verified downloads enforce size, hash and PE format without replacing the installed app', async t => {
  const f = await fixture(t), original = await fs.readFile(f.target), bytes = binary();
  const candidate = core.describeRelease(release(bytes), '1.9.0');
  for (const [suffix, changed, expectedCode] of [['hash', { digest: '0'.repeat(64) }, 'checksum-mismatch'], ['size', { size: bytes.length + 1 }, 'download-size']]) {
    const staged = path.join(f.directory, suffix + '.tmp');
    await assert.rejects(updater.downloadVerified({ ...candidate, ...changed }, staged, { fetchImpl: fetchFixture(release(bytes), bytes) }), { code: expectedCode });
    await assert.rejects(fs.access(staged)); assert.deepEqual(await fs.readFile(f.target), original);
  }
  const text = Buffer.alloc(65536, 65), staged = path.join(f.directory, 'not-pe.tmp');
  await assert.rejects(updater.downloadVerified({ ...candidate, digest: hash(text) }, staged, { fetchImpl: fetchFixture(release(text), text) }), { code: 'invalid-executable' });
  await assert.rejects(fs.access(staged));
  const valid = path.join(f.directory, 'valid.tmp'), progress = [];
  assert.equal(await updater.downloadVerified(candidate, valid, { fetchImpl: fetchFixture(release(bytes), bytes), onProgress: value => progress.push(value) }), bytes.length);
  assert.deepEqual(await fs.readFile(valid), bytes); assert.equal(progress.at(-1), 100); assert.deepEqual(await fs.readFile(f.target), original);
});

test('checking never installs automatically and developer runs cannot apply updates', async t => {
  const f = await fixture(t), calls = [];
  const instance = updater.createDesktopUpdater({ version: '1.9.0', isPackaged: false, platform: 'win32', userData: f.userData, env: {}, fetchImpl: fetchFixture(release(), binary(), calls), spawnHelper() { assert.fail('A developer run must not launch an installer.'); } });
  assert.equal(calls.length, 0, 'Construction never uses the network.');
  const state = await instance.checkForUpdates();
  assert.equal(state.status, 'available'); assert.equal(state.canInstall, false); assert.equal(state.reason, 'development'); assert.equal(calls.length, 1);
  assert.equal((await instance.installUpdate()).status, 'unsupported'); assert.equal(calls.length, 1);
  assert.deepEqual(await fs.readFile(f.target), binary('old'));
});

test('install verifies both published checksums before starting a helper and preserves the session', async t => {
  const f = await fixture(t), bytes = binary(), states = [], calls = [];
  const data = release(bytes);
  data.assets.push({ name: 'SHA256SUMS.txt', state: 'uploaded', size: 88, browser_download_url: assetURL('1.10.0', 'SHA256SUMS.txt') });
  let helper = null, quitCount = 0;
  const instance = updater.createDesktopUpdater({ version: '1.9.0', isPackaged: true, platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: f.target, PORTABLE_EXECUTABLE_DIR: f.directory }, userData: f.userData,
    fetchImpl: fetchFixture(data, bytes, calls), onState: state => states.push(state), quit: () => { quitCount++; },
    spawnHelper(config) { helper = config; fsSync.writeFileSync(config.statusFile, JSON.stringify({ nonce: config.nonce, phase: 'ready' })); return null; },
  });
  assert.equal((await instance.checkForUpdates()).canInstall, true);
  assert.equal(calls.length, 1); assert.equal(helper, null);
  const state = await instance.installUpdate();
  assert.equal(state.status, 'installing'); assert.equal(state.progress, 100); assert.ok(helper);
  assert.equal(calls.length, 3, 'Metadata, sidecar and executable are each requested once.');
  assert.deepEqual(await fs.readFile(f.target), binary('old'), 'Only the post-exit helper may replace this file.');
  assert.deepEqual(await fs.readFile(helper.staged), bytes);
  assert.equal(await fs.readFile(path.join(f.userData, 'session.json'), 'utf8'), '{"hero":"Haze","items":[1,2,3]}');
  assert(states.some(entry => entry.status === 'downloading'));
  assert(!JSON.stringify(states).includes(f.directory), 'Renderer status never contains local paths.');
  await new Promise(resolve => setTimeout(resolve, 250)); assert.equal(quitCount, 1);
});

test('a failed download cannot start the helper or modify application and profile files', async t => {
  const f = await fixture(t), bytes = binary();
  const instance = updater.createDesktopUpdater({ version: '1.9.0', isPackaged: true, platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: f.target }, userData: f.userData,
    fetchImpl: fetchFixture(release(bytes), binary('tampered')), spawnHelper() { assert.fail('A checksum mismatch must not start a helper.'); },
  });
  await instance.checkForUpdates();
  assert.equal((await instance.installUpdate()).error.code, 'checksum-mismatch');
  assert.deepEqual(await fs.readFile(f.target), binary('old'));
  assert.equal(await fs.readFile(path.join(f.userData, 'session.json'), 'utf8'), '{"hero":"Haze","items":[1,2,3]}');
  assert.equal((await fs.readdir(f.directory)).filter(name => name.endsWith('.tmp')).length, 0);
});

test('startup acknowledges only the matching portable version and reports a recorded rollback', async t => {
  const f = await fixture(t), config = helperConfig(f);
  await fs.mkdir(path.dirname(config.statusFile), { recursive: true });
  await fs.writeFile(config.pendingFile, JSON.stringify({ nonce: config.nonce, targetVersion: config.targetVersion, target: config.target }));
  const options = { isPackaged: true, platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: f.target }, userData: f.userData, fetchImpl() { assert.fail('Startup must not fetch or download anything.'); } };
  const restored = updater.createDesktopUpdater({ ...options, version: '1.9.0' });
  await fs.writeFile(config.statusFile, JSON.stringify({ nonce: config.nonce, phase: 'rolled-back' }));
  await restored.markHealthy();
  assert.equal(restored.getState().error.code, 'rolled-back');
  await assert.rejects(fs.access(config.healthFile));
  const updated = updater.createDesktopUpdater({ ...options, version: '1.10.0' });
  await updated.markHealthy();
  assert.equal(updated.getState().updated, true);
  assert.deepEqual(JSON.parse(await fs.readFile(config.healthFile, 'utf8')), { nonce: config.nonce, version: '1.10.0' });
  assert.equal(await fs.readFile(path.join(f.userData, 'session.json'), 'utf8'), '{"hero":"Haze","items":[1,2,3]}');
});

function helperConfig(f) {
  const nonce = crypto.randomUUID(), name = path.basename(f.target), updates = path.join(f.userData, 'updates');
  return { nonce, parentPid: 0, target: f.target, directory: f.directory, staged: path.join(f.directory, `.${name}.update-${nonce}.tmp`), backup: path.join(f.directory, `.${name}.previous-${nonce}.exe`), failed: path.join(f.directory, `.${name}.failed-${nonce}.exe`), userData: f.userData, targetVersion: '1.10.0', digest: hash(binary()), statusFile: path.join(updates, `${nonce}.status.json`), healthFile: path.join(updates, `${nonce}.healthy.json`), pendingFile: path.join(updates, 'pending.json'), lastSuccessFile: path.join(updates, 'last-success.json') };
}
test('helper generation rejects paths outside the exact managed folders', async t => {
  const f = await fixture(t), config = helperConfig(f);
  assert.throws(() => updater.createInstallScript({ ...config, staged: path.join(os.tmpdir(), 'someone-else.exe') }), /managed folders/);
  assert.throws(() => updater.createInstallScript({ ...config, statusFile: f.target }), /managed folders/);
  assert.throws(() => updater.createInstallScript({ ...config, targetVersion: 'v1.10.0' }), /Invalid helper/);
  const script = updater.createInstallScript(config);
  assert(!script.includes(f.target), 'Paths are encoded data, never interpolated into shell source.');
  assert(!script.includes('ExecutionPolicy'), 'The updater does not weaken execution policy.');
});

test('production hidden helper spawn executes after its Node parent has exited', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), config = helperConfig(f), marker = path.join(f.directory, 'parent-exited.json'), worker = path.join(f.directory, 'spawn-worker.cjs');
  const moduleFile = path.resolve(__dirname, '..', 'desktop-updater.cjs');
  await fs.writeFile(worker, `const fs=require('node:fs'); const {spawnInstallHelper}=require(${JSON.stringify(moduleFile)}); const config=${JSON.stringify(config)}; config.parentPid=process.pid;
    spawnInstallHelper(config,{createScript(){const file=${JSON.stringify(Buffer.from(marker).toString('base64'))}; return "$file=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+file+"'));[IO.File]::WriteAllText($file+'.ready','ready');$p=Get-Process -Id "+process.pid+" -ErrorAction SilentlyContinue;if($p){$null=$p.WaitForExit(10000)};[IO.File]::WriteAllText($file,'parent-exited')";}});
    const end=Date.now()+8000;setInterval(()=>{if(fs.existsSync(${JSON.stringify(marker + '.ready')}))process.exit(0);if(Date.now()>end)process.exit(2)},50);`);
  const child = spawn(process.execPath, [worker], { windowsHide: true, stdio: 'ignore' });
  const [code] = await once(child, 'exit'); assert.equal(code, 0);
  let written = false;
  for (let attempt = 0; attempt < 60; attempt++) { try { written = await fs.readFile(marker, 'utf8') === 'parent-exited'; if (written) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal(written, true, 'The production spawn options must let PowerShell run after its parent exits.');
  assert.deepEqual(await fs.readFile(f.target), binary('old'));
});

for (const mode of ['success', 'launch-failure', 'checksum-failure']) {
  test(`Windows replacement helper ${mode} preserves the old file or an exact backup and never touches the session`, { skip: process.platform !== 'win32' }, async t => {
    const f = await fixture(t), config = helperConfig(f);
    await fs.mkdir(path.dirname(config.statusFile), { recursive: true });
    await fs.writeFile(config.pendingFile, JSON.stringify({ nonce: config.nonce }));
    await fs.writeFile(config.staged, mode === 'checksum-failure' ? binary('tampered') : binary());
    const testLaunch = mode === 'launch-failure' ? "throw 'Simulated launch failure'" : "[IO.File]::WriteAllText($c.healthFile, (@{nonce=$c.nonce;version=$c.targetVersion} | ConvertTo-Json -Compress))";
    const script = updater.createInstallScript(config, { testLaunch, attempts: 3 });
    const result = spawnSync(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(await fs.readFile(config.statusFile, 'utf8'));
    assert.equal(status.phase, mode === 'success' ? 'completed' : mode === 'launch-failure' ? 'rolled-back' : 'failed', JSON.stringify(status));
    assert.deepEqual(await fs.readFile(f.target), binary(mode === 'success' ? 'new' : 'old'));
    if (mode === 'success') { assert.deepEqual(await fs.readFile(config.backup), binary('old')); await assert.rejects(fs.access(config.pendingFile)); }
    assert.equal(await fs.readFile(path.join(f.userData, 'session.json'), 'utf8'), '{"hero":"Haze","items":[1,2,3]}');
    await assert.rejects(fs.access(config.staged));
  });
}
