// Extract the original main-menu MP3 from a locally installed copy of Deadlock.
// Usage: node scripts/extract-menu-music.mjs [path/to/Deadlock/game/citadel]
// VPK format: https://developer.valvesoftware.com/wiki/VPK_(file_format)
// Source 2 sound stream: https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/ValveResourceFormat/Resource/ResourceTypes/Sound.cs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const game = path.resolve(process.argv[2] || 'C:/Program Files (x86)/Steam/steamapps/common/Deadlock/game/citadel');
const resourcePath = 'sounds/music/music_menu_lp.vsnd_c';
const directory = await fs.readFile(path.join(game, 'pak01_dir.vpk'));
assert.equal(directory.readUInt32LE(0), 0x55aa1234, 'Valid VPK signature required');
const version = directory.readUInt32LE(4);
assert.ok(version === 1 || version === 2, 'Supported VPK header required');
const headerSize = version === 2 ? 28 : 12;
const treeEnd = headerSize + directory.readUInt32LE(8);
assert.ok(treeEnd <= directory.length, 'VPK tree must fit the directory file');
let cursor = headerSize;
let entry;
function string() {
  const end = directory.indexOf(0, cursor);
  assert.ok(end >= cursor && end < treeEnd, 'Terminated VPK tree string required');
  const value = directory.toString('utf8', cursor, end);
  cursor = end + 1;
  return value;
}
for (let extension; (extension = string());) {
  for (let folder; (folder = string());) {
    for (let filename; (filename = string());) {
      assert.ok(cursor + 18 <= treeEnd, 'Complete VPK entry required');
      const candidate = {
        path: `${folder === ' ' ? '' : `${folder}/`}${filename}.${extension}`,
        crc32: directory.readUInt32LE(cursor),
        preloadSize: directory.readUInt16LE(cursor + 4),
        archive: directory.readUInt16LE(cursor + 6),
        offset: directory.readUInt32LE(cursor + 8),
        size: directory.readUInt32LE(cursor + 12),
      };
      assert.equal(directory.readUInt16LE(cursor + 16), 0xffff, 'VPK entry terminator required');
      cursor += 18;
      assert.ok(cursor + candidate.preloadSize <= treeEnd, 'Preloaded bytes must fit the VPK tree');
      candidate.preload = directory.subarray(cursor, cursor + candidate.preloadSize);
      cursor += candidate.preloadSize;
      if (candidate.path === resourcePath) entry = candidate;
    }
  }
}
assert.ok(entry, `Missing local resource: ${resourcePath}`);
const archiveName = entry.archive === 0x7fff ? 'pak01_dir.vpk' : `pak01_${String(entry.archive).padStart(3, '0')}.vpk`;
const archive = await fs.open(path.join(game, archiveName), 'r');
const body = Buffer.alloc(entry.size);
try {
  const offset = entry.offset + (entry.archive === 0x7fff ? treeEnd : 0);
  assert.ok(offset + entry.size <= (await archive.stat()).size, 'Sound must fit the local VPK archive');
  const { bytesRead } = await archive.read(body, 0, body.length, offset);
  assert.equal(bytesRead, body.length, 'Complete sound resource required');
} finally { await archive.close(); }
const resource = Buffer.concat([entry.preload, body]);
const table = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
let crc = 0xffffffff;
for (const byte of resource) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
assert.equal((crc ^ 0xffffffff) >>> 0, entry.crc32, 'Extracted resource must match its archive CRC32');
assert.equal(resource.readUInt16LE(4), 12, 'Source 2 resource header required');
const streamOffset = resource.readUInt32LE(0);
assert.ok(streamOffset >= 16 && streamOffset < resource.length, 'Valid Source 2 audio stream offset required');
const audio = resource.subarray(streamOffset);
assert.ok(audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0, 'MP3 frame sync required');
const output = path.join(root, 'assets', 'audio');
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'menu.mp3'), audio);
const provenance = {
  description: 'Original Deadlock standard main-menu loop, extracted from the local Steam installation for this personal application.',
  copyright: 'Valve Corporation',
  resource: resourcePath,
  archive: archiveName,
  extraction: 'Unmodified MPEG audio stream following the Source 2 compiled resource data; archive CRC32 verified.',
  bytes: audio.length,
  sha256: createHash('sha256').update(audio).digest('hex'),
};
await fs.writeFile(path.join(output, 'source.json'), `${JSON.stringify(provenance, null, 2)}\n`);
console.log(JSON.stringify(provenance, null, 2));
