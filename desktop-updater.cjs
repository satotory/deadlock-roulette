'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const core = require('./update-core.cjs');

const METADATA_TIMEOUT = 15_000;
const DOWNLOAD_TIMEOUT = 10 * 60_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function safeError(error) {
  if (error instanceof core.UpdateError) return { code: error.code, message: error.message };
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return { code: 'network-timeout', message: 'The update request timed out. Try again later.' };
  if (['EACCES', 'EPERM', 'EROFS'].includes(error?.code)) return { code: 'not-writable', message: 'The application folder is not writable. Move the portable app to a folder you own, or download the release manually.' };
  if (error?.code === 'ENOSPC') return { code: 'disk-space', message: 'There is not enough free space to download this update.' };
  return { code: 'network', message: 'The update could not be completed. Your installed application has not been replaced.' };
}

async function fetchTrusted(url, { kind = 'asset', maxBytes, signal, fetchImpl = globalThis.fetch } = {}) {
  const initialURL = url;
  let destination = url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!core.isPermittedRequest(destination, { initialURL, kind, redirect: redirects > 0 })) throw new core.UpdateError('invalid-release', 'An update redirect outside GitHub was rejected.');
    const response = await fetchImpl(destination, { redirect: 'manual', signal, headers: { 'User-Agent': 'Deadlock-Roulette-Updater', Accept: kind === 'metadata' ? 'application/vnd.github+json' : 'application/octet-stream' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel?.();
      const location = response.headers.get('location');
      if (!location || redirects === 5) throw new core.UpdateError('invalid-release', 'The update has too many redirects.');
      destination = new URL(location, destination).href;
      continue;
    }
    if (response.status === 403 || response.status === 429) { await response.body?.cancel?.(); throw new core.UpdateError('rate-limit', 'GitHub is limiting update checks. Try again later.'); }
    if (response.status === 404) { await response.body?.cancel?.(); throw new core.UpdateError('release-missing', 'A published update could not be found.'); }
    if (response.status !== 200 || !response.body) { await response.body?.cancel?.(); throw new core.UpdateError('network', 'GitHub could not provide the update.'); }
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { await response.body.cancel(); throw new core.UpdateError('download-size', 'The update response is larger than expected.'); }
    return response;
  }
  throw new core.UpdateError('invalid-release', 'The update has too many redirects.');
}

async function responseText(response, maxBytes) {
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new core.UpdateError('download-size', 'The update metadata is larger than expected.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function downloadVerified(candidate, target, { signal, fetchImpl, onProgress = () => {} } = {}) {
  const response = await fetchTrusted(candidate.assetURL, { signal, fetchImpl, maxBytes: candidate.size });
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) !== candidate.size) { await response.body.cancel(); throw new core.UpdateError('download-size', 'The executable size does not match this release.'); }
  const file = await fs.open(target, 'wx', 0o600);
  const digest = crypto.createHash('sha256');
  let bytes = 0, head = Buffer.alloc(0), lastProgress = -1, verified = false;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > candidate.size || bytes > core.MAX_DOWNLOAD_BYTES) throw new core.UpdateError('download-size', 'The executable is larger than expected.');
      const buffer = Buffer.from(chunk); digest.update(buffer);
      if (head.length < 4096) head = Buffer.concat([head, buffer.subarray(0, 4096 - head.length)]);
      // FileHandle.write may write fewer bytes than requested.
      let written = 0;
      while (written < buffer.length) { const result = await file.write(buffer, written, buffer.length - written); if (!result.bytesWritten) throw new Error('Update write stopped.'); written += result.bytesWritten; }
      const progress = Math.floor(bytes / candidate.size * 100);
      if (progress !== lastProgress) { lastProgress = progress; onProgress(progress); }
    }
    await file.sync();
    if (bytes !== candidate.size) throw new core.UpdateError('download-size', 'The update download is incomplete.');
    if (digest.digest('hex') !== candidate.digest) throw new core.UpdateError('checksum-mismatch', 'The downloaded executable did not match its SHA-256 checksum. The current application was not changed.');
    if (!core.isPEHeader(head)) throw new core.UpdateError('invalid-executable', 'The downloaded file is not a Windows executable.');
    verified = true;
    return bytes;
  } finally { await file.close(); if (!verified) await fs.unlink(target).catch(() => {}); }
}

/** Fixed helper code; path data enters only as base64 JSON, never as PowerShell source. */
function createInstallScript(config, { testLaunch = null, attempts = 120 } = {}) {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 120) throw new TypeError('Invalid helper retry limit.');
  if (!UUID.test(config.nonce) || config.targetVersion !== core.normalizeVersion(config.targetVersion) || !Number.isSafeInteger(config.parentPid) || config.parentPid < 0 || !/^[a-f0-9]{64}$/i.test(config.digest)) throw new TypeError('Invalid helper configuration.');
  for (const key of ['target', 'directory', 'staged', 'backup', 'failed', 'userData', 'statusFile', 'healthFile', 'pendingFile', 'lastSuccessFile']) {
    if (typeof config[key] !== 'string' || !path.isAbsolute(config[key]) || /^\\\\|^\/\//.test(config[key]) || /[\u0000-\u001f"]/u.test(config[key])) throw new TypeError('Invalid helper path.');
  }
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const name = path.basename(config.target), updates = path.join(config.userData, 'updates');
  if (path.extname(name).toLowerCase() !== '.exe' || !same(path.dirname(config.target), config.directory)
    || !same(config.staged, path.join(config.directory, `.${name}.update-${config.nonce}.tmp`))
    || !same(config.backup, path.join(config.directory, `.${name}.previous-${config.nonce}.exe`))
    || !same(config.failed, path.join(config.directory, `.${name}.failed-${config.nonce}.exe`))
    || !same(config.statusFile, path.join(updates, `${config.nonce}.status.json`))
    || !same(config.healthFile, path.join(updates, `${config.nonce}.healthy.json`))
    || !same(config.pendingFile, path.join(updates, 'pending.json'))
    || !same(config.lastSuccessFile, path.join(updates, 'last-success.json'))) throw new TypeError('Update paths must stay in their managed folders.');
  const data = Buffer.from(JSON.stringify(config)).toString('base64');
  const launch = testLaunch || String.raw`
  $arg = '--user-data-dir="' + [regex]::Replace($c.userData, '(\\+)$', '$1$1') + '"'
  $script:launched = Start-Process -FilePath $c.target -ArgumentList $arg -PassThru
`;
  return String.raw`
$ErrorActionPreference = 'Stop'
$c = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
$replaced = $false
$pathsValidated = $false
$launched = $null
function Same-Path([string]$a, [string]$b) { return [String]::Equals([IO.Path]::GetFullPath($a), [IO.Path]::GetFullPath($b), [StringComparison]::OrdinalIgnoreCase) }
function Get-Sha256([string]$file) {
  $stream = [IO.File]::OpenRead($file)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose(); $sha.Dispose() }
}
function Write-State([string]$phase, [string]$code = '') {
  $record = @{ phase=$phase; code=$code; nonce=$c.nonce; targetVersion=$c.targetVersion; at=[DateTime]::UtcNow.ToString('o'); detail=$script:lastFailure } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($c.statusFile, $record, (New-Object Text.UTF8Encoding($false)))
}
function Relaunch-App {
${launch}
}
function Replace-With-Retry([string]$source, [string]$destination, [string]$backup) {
  for ($attempt=0; $attempt -lt ${attempts}; $attempt++) {
    try { [IO.File]::Replace($source, $destination, $backup, $true); return } catch { if ($attempt -eq ${attempts - 1}) { throw }; Start-Sleep -Milliseconds 500 }
  }
}
try {
  $directory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($c.target))
  $name = [IO.Path]::GetFileName($c.target)
  if ($c.nonce -notmatch '^[a-f0-9-]{36}$' -or [IO.Path]::GetExtension($name) -ne '.exe') { throw 'Invalid target' }
  if (!(Same-Path $directory $c.directory) -or !(Same-Path $c.staged (Join-Path $directory ('.' + $name + '.update-' + $c.nonce + '.tmp'))) -or !(Same-Path $c.backup (Join-Path $directory ('.' + $name + '.previous-' + $c.nonce + '.exe'))) -or !(Same-Path $c.failed (Join-Path $directory ('.' + $name + '.failed-' + $c.nonce + '.exe')))) { throw 'Invalid update paths' }
  $pathsValidated = $true
  if (!(Test-Path -LiteralPath $c.target -PathType Leaf) -or !(Test-Path -LiteralPath $c.staged -PathType Leaf)) { throw 'Missing executable' }
  if ((Get-Sha256 $c.staged) -ne $c.digest) { throw 'Checksum mismatch' }
  Write-State 'ready'
  if ($c.parentPid -gt 0) {
    $parent = Get-Process -Id $c.parentPid -ErrorAction SilentlyContinue
    if ($parent -and !$parent.WaitForExit(60000)) { throw 'The application did not close' }
  }
  if ((Get-Sha256 $c.staged) -ne $c.digest) { throw 'Checksum mismatch' }
  Replace-With-Retry $c.staged $c.target $c.backup
  $replaced = $true
  Write-State 'launching'
  Relaunch-App
  $healthy = $false
  for ($attempt=0; $attempt -lt ${attempts}; $attempt++) {
    if (Test-Path -LiteralPath $c.healthFile -PathType Leaf) {
      try { $health = Get-Content -LiteralPath $c.healthFile -Raw | ConvertFrom-Json; if ($health.nonce -eq $c.nonce -and $health.version -eq $c.targetVersion) { $healthy=$true; break } } catch { }
    }
    Start-Sleep -Milliseconds 500
  }
  if (!$healthy) { throw 'The new application did not finish starting' }
  Write-State 'completed'
  if ($c.lastSuccessFile) {
    try {
      $previous = Get-Content -LiteralPath $c.lastSuccessFile -Raw -ErrorAction Stop | ConvertFrom-Json
      $previousName = [IO.Path]::GetFileName($previous.backup)
      if ((Same-Path $previous.target $c.target) -and (Same-Path ([IO.Path]::GetDirectoryName($previous.backup)) $directory) -and $previousName.StartsWith('.' + $name + '.previous-') -and $previousName -match '\.previous-[a-f0-9-]{36}\.exe$' -and !(Same-Path $previous.backup $c.backup)) {
        $previousInfo = Get-Item -LiteralPath $previous.backup -ErrorAction SilentlyContinue
        if ($previousInfo -and !($previousInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Remove-Item -LiteralPath $previous.backup -Force }
      }
    } catch { }
    [IO.File]::WriteAllText($c.lastSuccessFile, (@{target=$c.target;backup=$c.backup;version=$c.targetVersion;nonce=$c.nonce} | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
  }
  if ($c.pendingFile -and (Test-Path -LiteralPath $c.pendingFile -PathType Leaf)) { Remove-Item -LiteralPath $c.pendingFile -Force }
} catch {
  $script:lastFailure = $_.Exception.Message
  $code = if ($replaced) { 'launch-failed' } else { 'replace-failed' }
  if ($replaced) {
    try {
      if ($launched) {
        $launched.Refresh()
        if (!$launched.HasExited) { & (Join-Path $env:SystemRoot 'System32/taskkill.exe') /PID $launched.Id /T /F 2>$null | Out-Null }
      }
      Replace-With-Retry $c.backup $c.target $c.failed
      if (Test-Path -LiteralPath $c.failed -PathType Leaf) { Remove-Item -LiteralPath $c.failed -Force }
      Write-State 'rolled-back' $code
      try { Relaunch-App } catch { }
    } catch { Write-State 'recovery-failed' 'recovery-failed' }
  } else { Write-State 'failed' $code; if ($pathsValidated) { try { Relaunch-App } catch { } } }
} finally {
  if ($pathsValidated -and (Test-Path -LiteralPath $c.staged -PathType Leaf)) { Remove-Item -LiteralPath $c.staged -Force -ErrorAction SilentlyContinue }
}
`;
}

function spawnInstallHelper(config, dependencies = {}) {
  const systemRoot = dependencies.systemRoot || process.env.SystemRoot || 'C:\\Windows';
  const executable = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = Buffer.from((dependencies.createScript || createInstallScript)(config), 'utf16le').toString('base64');
  // Start-Process gives the hidden helper an independent Windows console. Node's
  // detached console can exit without evaluating PowerShell, while a directly
  // attached console can be closed together with a console application's parent.
  if (encoded.length > 30_000) throw new core.UpdateError('apply-failed', 'The update helper path is too long. Download this release manually.');
  const executableData = Buffer.from(executable).toString('base64');
  // Pass the already encoded fixed script in a private child environment variable
  // so the bootstrap itself stays well below Windows' command-line length limit.
  const variable = 'DEADLOCK_ROULETTE_UPDATE_SCRIPT';
  const bootstrap = `$ErrorActionPreference='Stop';$encoded=$env:${variable};Remove-Item -LiteralPath 'Env:\\${variable}';if([string]::IsNullOrEmpty($encoded)){throw 'Missing helper'};$executable=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${executableData}'));Start-Process -FilePath $executable -ArgumentList ('-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand '+$encoded) -WindowStyle Hidden | Out-Null`;
  const child = (dependencies.spawn || spawn)(executable, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore', env: { ...process.env, [variable]: encoded } });
  child.unref();
  return child;
}

function createDesktopUpdater(options) {
  const version = core.normalizeVersion(options.version) || '0.0.0';
  const support = core.portableTarget({ platform: options.platform, isPackaged: options.isPackaged, env: options.env });
  const directory = path.join(options.userData, 'updates');
  const pendingFile = path.join(directory, 'pending.json');
  let state = { status: 'idle', currentVersion: version, latestVersion: null, progress: 0, releaseURL: core.RELEASES_URL, error: null, canInstall: support.supported, reason: support.reason };
  let candidate = null, checkPromise = null, installPromise = null, controller = null, disposed = false;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const setState = changes => { state = { ...state, ...changes }; if (!disposed) options.onState?.({ ...state }); return { ...state }; };
  const getState = () => ({ ...state });
  async function checkForUpdates() {
    if (checkPromise) return checkPromise;
    if (installPromise || disposed || ['ready', 'installing'].includes(state.status)) return getState();
    checkPromise = (async () => {
      candidate = null;
      setState({ status: 'checking', progress: 0, error: null });
      const timeout = AbortSignal.timeout(METADATA_TIMEOUT);
      try {
        const response = await fetchTrusted(core.RELEASE_API, { kind: 'metadata', maxBytes: core.MAX_METADATA_BYTES, signal: timeout, fetchImpl });
        let json;
        try { json = JSON.parse(await responseText(response, core.MAX_METADATA_BYTES)); } catch (error) { if (error instanceof core.UpdateError) throw error; throw new core.UpdateError('invalid-release', 'The release response is invalid.'); }
        const release = core.describeRelease(json, version);
        candidate = release.newer ? release : null;
        return setState({ status: release.newer ? 'available' : 'current', latestVersion: release.latestVersion, releaseURL: release.releaseURL, progress: 0, error: null, canInstall: support.supported && release.newer, reason: support.reason });
      } catch (error) { return setState({ status: 'error', error: safeError(error), canInstall: false }); }
      finally { checkPromise = null; }
    })();
    return checkPromise;
  }
  async function markHealthy() {
    let pending;
    try { const bytes = await fs.readFile(pendingFile); if (bytes.length > 16 * 1024) return; pending = JSON.parse(bytes.toString('utf8')); } catch { return; }
    if (!pending || !UUID.test(pending.nonce) || !core.normalizeVersion(pending.targetVersion)) return;
    const healthFile = path.join(directory, `${pending.nonce}.healthy.json`), statusFile = path.join(directory, `${pending.nonce}.status.json`);
    if (pending.targetVersion === version && support.supported && pending.target === support.target) {
      await fs.writeFile(healthFile, JSON.stringify({ nonce: pending.nonce, version }), { mode: 0o600 });
      setState({ status: 'current', latestVersion: version, updated: true, error: null, canInstall: false });
      return;
    }
    try {
      const status = JSON.parse(await fs.readFile(statusFile, 'utf8'));
      if (status.nonce === pending.nonce && ['rolled-back', 'failed', 'recovery-failed'].includes(status.phase)) setState({ status: 'error', latestVersion: pending.targetVersion, canInstall: false, error: { code: status.phase === 'rolled-back' ? 'rolled-back' : 'apply-failed', message: status.phase === 'rolled-back' ? 'The update could not start. The previous application was restored.' : 'The update could not be installed. The previous executable is retained.' } });
    } catch { /* A helper may still be waiting for its first launch. */ }
  }
  async function installUpdate() {
    if (installPromise) return installPromise;
    if (!support.supported) return setState({ status: 'unsupported', canInstall: false, reason: support.reason, error: null });
    if (!candidate?.newer || state.status !== 'available') return getState();
    const selected = { ...candidate };
    installPromise = (async () => {
      let staged;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), DOWNLOAD_TIMEOUT);
      try {
        const stat = await fs.lstat(support.target);
        if (!stat.isFile() || stat.isSymbolicLink() || path.resolve(await fs.realpath(support.target)).toLowerCase() !== support.target.toLowerCase()) throw new core.UpdateError('not-portable', 'The portable executable path could not be verified.');
        await fs.access(support.directory, require('node:fs').constants.W_OK);
        if (selected.checksumURL) {
          const response = await fetchTrusted(selected.checksumURL, { maxBytes: core.MAX_CHECKSUM_BYTES, signal: controller.signal, fetchImpl });
          const checksum = core.parseChecksumFile(await responseText(response, core.MAX_CHECKSUM_BYTES), selected.assetName);
          if (selected.digest && selected.digest !== checksum) throw new core.UpdateError('checksum-mismatch', 'The release metadata and checksum file disagree.');
          selected.digest = checksum;
        }
        const nonce = crypto.randomUUID(), name = path.basename(support.target);
        staged = path.join(support.directory, `.${name}.update-${nonce}.tmp`);
        setState({ status: 'downloading', progress: 0, error: null, canInstall: false });
        await downloadVerified(selected, staged, { signal: controller.signal, fetchImpl, onProgress: progress => setState({ progress }) });
        if (disposed || controller.signal.aborted) throw new core.UpdateError('cancelled', 'The update was cancelled.');
        await fs.mkdir(directory, { recursive: true });
        const config = { nonce, parentPid: process.pid, target: support.target, directory: support.directory, staged, backup: path.join(support.directory, `.${name}.previous-${nonce}.exe`), failed: path.join(support.directory, `.${name}.failed-${nonce}.exe`), userData: options.userData, targetVersion: selected.latestVersion, digest: selected.digest, statusFile: path.join(directory, `${nonce}.status.json`), healthFile: path.join(directory, `${nonce}.healthy.json`), pendingFile, lastSuccessFile: path.join(directory, 'last-success.json') };
        await fs.writeFile(pendingFile, JSON.stringify({ nonce, targetVersion: config.targetVersion, target: config.target, createdAt: new Date().toISOString() }), { mode: 0o600 });
        setState({ status: 'ready', progress: 100 });
        let launchError;
        const child = (options.spawnHelper || spawnInstallHelper)(config);
        child?.once?.('error', error => { launchError = error; });
        let ready = false;
        for (let attempt = 0; attempt < 300; attempt++) {
          if (launchError) throw launchError;
          try { const status = JSON.parse(await fs.readFile(config.statusFile, 'utf8')); if (status.nonce === nonce) { if (status.phase === 'ready') { ready = true; break; } if (['failed', 'rolled-back', 'recovery-failed'].includes(status.phase)) throw new core.UpdateError('apply-failed', 'The update helper could not start.'); } } catch (error) { if (error instanceof core.UpdateError) throw error; }
          await delay(100);
        }
        if (!ready) throw new core.UpdateError('apply-failed', 'The update helper did not start. The current application was not replaced.');
        setState({ status: 'installing', progress: 100, error: null });
        clearTimeout(timeout);
        setTimeout(() => options.quit?.(), 200);
        staged = null; // The validated helper now owns this file.
        return getState();
      } catch (error) { return setState({ status: 'error', error: safeError(error), canInstall: false }); }
      finally { clearTimeout(timeout); controller = null; if (staged) await fs.unlink(staged).catch(() => {}); installPromise = null; }
    })();
    return installPromise;
  }
  function dispose() { disposed = true; if (state.status !== 'installing') controller?.abort(); }
  return { getState, checkForUpdates, installUpdate, markHealthy, dispose };
}

module.exports = { createDesktopUpdater, fetchTrusted, responseText, downloadVerified, createInstallScript, spawnInstallHelper, safeError };
