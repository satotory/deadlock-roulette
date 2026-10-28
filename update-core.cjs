'use strict';

const path = require('node:path');

const REPOSITORY = 'satotory/deadlock-roulette';
const PROJECT_URL = `https://github.com/${REPOSITORY}`;
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RELEASES_URL = `${PROJECT_URL}/releases/latest`;
const WEB_URL = 'https://satotory.github.io/deadlock-roulette/';
const EXECUTABLE_NAMES = Object.freeze(['Deadlock.Roulette.exe', 'Deadlock Roulette.exe']);
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_CHECKSUM_BYTES = 64 * 1024;
const REDIRECT_HOSTS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com']);

class UpdateError extends Error {
  constructor(code, message) { super(message); this.name = 'UpdateError'; this.code = code; }
}
function fail(code, message) { throw new UpdateError(code, message); }
function versionParts(value) {
  if (typeof value !== 'string' || value.length > 32) return null;
  const match = /^v?(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}
function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  if (!a || !b) fail('invalid-release', 'The release has an unsupported version.');
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}
function normalizeVersion(value) { const parts = versionParts(value); return parts ? parts.join('.') : null; }
function checkedURL(value) {
  let url;
  try { url = new URL(value); } catch { fail('invalid-release', 'The release contains an invalid URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) fail('invalid-release', 'An insecure update URL was rejected.');
  return url;
}
function validateAssetURL(value, tag, filename) {
  const url = checkedURL(value);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { fail('invalid-release', 'The release contains an invalid asset path.'); }
  if (url.hostname !== 'github.com' || url.search || pathname !== `/${REPOSITORY}/releases/download/${tag}/${filename}`) fail('invalid-release', 'The update does not belong to this project.');
  return url.href;
}
function isPermittedRequest(value, { initialURL, kind = 'asset', redirect = false } = {}) {
  try {
    const url = checkedURL(value);
    if (kind === 'metadata') return url.href === RELEASE_API && !redirect;
    if (url.href === initialURL && url.hostname === 'github.com') {
      const pathname = decodeURIComponent(url.pathname);
      const prefix = `/${REPOSITORY}/releases/download/`;
      if (!pathname.startsWith(prefix)) return false;
      const parts = pathname.slice(prefix.length).split('/');
      if (parts.length !== 2 || !versionParts(parts[0]) || ![...EXECUTABLE_NAMES, 'SHA256SUMS.txt'].includes(parts[1])) return false;
      return validateAssetURL(url.href, parts[0], parts[1]) === url.href;
    }
    return redirect && REDIRECT_HOSTS.has(url.hostname);
  } catch { return false; }
}
function parseDigest(value) {
  const match = typeof value === 'string' && /^sha256:([a-f0-9]{64})$/i.exec(value);
  return match ? match[1].toLowerCase() : null;
}
function parseChecksumFile(text, filename) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_CHECKSUM_BYTES) fail('checksum-missing', 'The checksum file is invalid.');
  let result = null;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (!match || match[2] !== filename) continue;
    const digest = match[1].toLowerCase();
    if (result && result !== digest) fail('checksum-mismatch', 'The release has conflicting checksums.');
    result = digest;
  }
  if (!result) fail('checksum-missing', 'The release does not include a checksum for its executable.');
  return result;
}
function describeRelease(data, currentVersion) {
  if (!data || typeof data !== 'object' || data.draft !== false || data.prerelease !== false || !versionParts(data.tag_name)) fail('invalid-release', 'Only stable releases from this project can be installed.');
  const latestVersion = normalizeVersion(data.tag_name);
  const common = { latestVersion, tag: data.tag_name, releaseURL: `${PROJECT_URL}/releases/tag/${data.tag_name}`, newer: compareVersions(latestVersion, currentVersion) > 0 };
  if (!common.newer) return common;
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const asset = EXECUTABLE_NAMES.map(name => assets.find(candidate => candidate?.name === name && candidate.state === 'uploaded')).find(Boolean);
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size < 64 * 1024 || asset.size > MAX_DOWNLOAD_BYTES) fail('asset-missing', 'A supported Windows executable is not available in this release.');
  const assetURL = validateAssetURL(asset.browser_download_url, data.tag_name, asset.name);
  const checksum = assets.find(candidate => candidate?.name === 'SHA256SUMS.txt' && candidate.state === 'uploaded');
  const digest = parseDigest(asset.digest);
  let checksumURL = null;
  if (checksum) {
    if (!Number.isSafeInteger(checksum.size) || checksum.size < 1 || checksum.size > MAX_CHECKSUM_BYTES) fail('checksum-missing', 'The checksum file is invalid.');
    checksumURL = validateAssetURL(checksum.browser_download_url, data.tag_name, checksum.name);
  }
  if (!digest && !checksumURL) fail('checksum-missing', 'This release has no SHA-256 checksum. It cannot be installed automatically.');
  return { ...common, assetName: asset.name, assetURL, size: asset.size, digest, checksumURL };
}
function portableTarget({ platform = process.platform, isPackaged, env = process.env, pathImpl = path }) {
  if (platform !== 'win32') return { supported: false, reason: 'windows-only' };
  if (!isPackaged) return { supported: false, reason: 'development' };
  const value = env?.PORTABLE_EXECUTABLE_FILE;
  if (typeof value !== 'string' || !value || !pathImpl.isAbsolute(value) || /^\\\\|^\/\//.test(value) || /[\u0000-\u001f"]/u.test(value) || pathImpl.extname(value).toLowerCase() !== '.exe') return { supported: false, reason: 'not-portable' };
  const target = pathImpl.resolve(value), directory = pathImpl.dirname(target);
  if (env.PORTABLE_EXECUTABLE_DIR && pathImpl.resolve(env.PORTABLE_EXECUTABLE_DIR).toLowerCase() !== directory.toLowerCase()) return { supported: false, reason: 'not-portable' };
  return { supported: true, target, directory, reason: null };
}
function isPEHeader(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 64 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) return false;
  const offset = buffer.readUInt32LE(0x3c);
  return offset >= 64 && offset + 4 <= buffer.length && buffer.subarray(offset, offset + 4).equals(Buffer.from([0x50, 0x45, 0, 0]));
}

module.exports = { REPOSITORY, PROJECT_URL, WEB_URL, RELEASE_API, RELEASES_URL, EXECUTABLE_NAMES, MAX_DOWNLOAD_BYTES, MAX_METADATA_BYTES, MAX_CHECKSUM_BYTES, UpdateError, compareVersions, normalizeVersion, versionParts, parseDigest, parseChecksumFile, validateAssetURL, isPermittedRequest, describeRelease, portableTarget, isPEHeader };
