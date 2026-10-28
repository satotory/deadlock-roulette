// Extract original short hero-selection lines from an installed Deadlock VPK.
// The game installation is opened read-only. Output is local to this app.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import catalog from '../src/hero-data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const game = path.resolve(process.argv.find(argument => !argument.startsWith('-') && argument !== process.argv[0] && argument !== process.argv[1]) || 'C:/Program Files (x86)/Steam/steamapps/common/Deadlock/game/citadel');
const directory = await fs.readFile(path.join(game, 'pak01_dir.vpk'));
assert.equal(directory.readUInt32LE(0), 0x55aa1234);
const version = directory.readUInt32LE(4);
assert.ok(version === 1 || version === 2);
const headerSize = version === 2 ? 28 : 12;
const treeEnd = headerSize + directory.readUInt32LE(8);
let cursor = headerSize;
function string() {
  const end = directory.indexOf(0, cursor);
  assert.ok(end >= cursor && end < treeEnd);
  const value = directory.toString('utf8', cursor, end);
  cursor = end + 1;
  return value;
}
const entries = [];
for (let extension; (extension = string());) {
  for (let folder; (folder = string());) {
    for (let filename; (filename = string());) {
      assert.ok(cursor + 18 <= treeEnd);
      const entry = {
        path: `${folder === ' ' ? '' : `${folder}/`}${filename}.${extension}`,
        crc32: directory.readUInt32LE(cursor),
        preloadSize: directory.readUInt16LE(cursor + 4),
        archive: directory.readUInt16LE(cursor + 6),
        offset: directory.readUInt32LE(cursor + 8),
        size: directory.readUInt32LE(cursor + 12),
      };
      assert.equal(directory.readUInt16LE(cursor + 16), 0xffff);
      cursor += 18;
      assert.ok(cursor + entry.preloadSize <= treeEnd);
      entry.preload = directory.subarray(cursor, cursor + entry.preloadSize);
      cursor += entry.preloadSize;
      if (extension === 'vsnd_c' && folder.startsWith('sounds/vo/')) entries.push(entry);
    }
  }
}
const selected = catalog.heroes.map(hero => {
  const className = hero.className.replace(/^hero_/, '');
  const candidates = entries.filter(entry => entry.path.startsWith(`sounds/vo/${className}/`) && /(?:_select_\d+|_hero_anim_intro_\d+|_respawn_\d+)\.vsnd_c$/.test(entry.path));
  const priority = entry => entry.path.includes('_select_') ? 0 : entry.path.includes('_hero_anim_intro_') ? 1 : 2;
  candidates.sort((left, right) => priority(left) - priority(right) || left.path.localeCompare(right.path));
  assert.ok(candidates.length, `Missing selection/intro voice for ${hero.name}`);
  return { hero, entry: candidates[0], candidates, alternatives: candidates.length };
});
if (process.argv.includes('--inspect')) {
  console.log(JSON.stringify(selected.map(({ hero, entry, alternatives }) => ({ id: hero.id, name: hero.name, resource: entry.path, alternatives })), null, 2));
  process.exit(0);
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
const output = path.join(root, 'assets', 'voices');
await fs.mkdir(output, { recursive: true });
const manifest = {};
const sources = [];
function mp3Duration(audio) {
  let offset = 0;
  let duration = 0;
  while (offset + 4 <= audio.length) {
    const header = audio.readUInt32BE(offset);
    const version = (header >>> 19) & 3;
    const layer = (header >>> 17) & 3;
    const bitrateIndex = (header >>> 12) & 15;
    const rateIndex = (header >>> 10) & 3;
    if ((header >>> 21) !== 0x7ff || version === 1 || layer !== 1 || !bitrateIndex || bitrateIndex === 15 || rateIndex === 3) break;
    const kbps = (version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitrateIndex];
    const rate = [44100, 48000, 32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const samples = version === 3 ? 1152 : 576;
    const size = Math.floor((version === 3 ? 144000 : 72000) * kbps / rate) + ((header >>> 9) & 1);
    if (offset + size > audio.length) break;
    duration += samples / rate;
    offset += size;
  }
  assert.equal(offset, audio.length, 'Complete MPEG Layer III frame sequence required');
  return duration;
}

async function readSound(entry, hero) {
  const archiveName = entry.archive === 0x7fff ? 'pak01_dir.vpk' : `pak01_${String(entry.archive).padStart(3, '0')}.vpk`;
  const archive = await fs.open(path.join(game, archiveName), 'r');
  const body = Buffer.alloc(entry.size);
  try {
    const offset = entry.offset + (entry.archive === 0x7fff ? treeEnd : 0);
    assert.ok(offset + entry.size <= (await archive.stat()).size);
    const { bytesRead } = await archive.read(body, 0, body.length, offset);
    assert.equal(bytesRead, body.length);
  } finally { await archive.close(); }
  const resource = Buffer.concat([entry.preload, body]);
  let crc = 0xffffffff;
  for (const byte of resource) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  assert.equal((crc ^ 0xffffffff) >>> 0, entry.crc32, `${hero.name}: archive CRC32`);
  assert.equal(resource.readUInt16LE(4), 12, `${hero.name}: Source 2 resource version`);
  const streamOffset = resource.readUInt32LE(0);
  assert.ok(streamOffset >= 16 && streamOffset < resource.length);
  const audio = resource.subarray(streamOffset);
  const isMP3 = audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0;
  const isOgg = audio.toString('ascii', 0, 4) === 'OggS';
  assert.ok(isMP3 || isOgg, `${hero.name}: unsupported stream signature ${audio.subarray(0, 16).toString('hex')}`);
  return { audio, archiveName, extension: isMP3 ? 'mp3' : 'ogg', duration: isMP3 ? mp3Duration(audio) : null };
}

for (const { hero, candidates } of selected) {
  let chosen;
  // Keep a whole original line; prefer a short phrase over a lengthy speech.
  for (const entry of candidates) {
    const candidate = { entry, ...await readSound(entry, hero) };
    if (!chosen || candidate.duration < chosen.duration) chosen = candidate;
    if (candidate.duration === null || (candidate.duration >= .65 && candidate.duration <= 6)) {
      chosen = candidate;
      break;
    }
  }
  const { entry, audio, archiveName, extension, duration } = chosen;
  const filename = `${hero.id}.${extension}`;
  await fs.writeFile(path.join(output, filename), audio);
  manifest[hero.id] = { path: `assets/voices/${filename}`, kind: entry.path.includes('_select_') ? 'select' : entry.path.includes('_intro_') ? 'intro' : 'respawn' };
  sources.push({ id: hero.id, hero: hero.name, resource: entry.path, archive: archiveName, file: filename, duration, bytes: audio.length, sha256: createHash('sha256').update(audio).digest('hex') });
}
await fs.writeFile(path.join(root, 'src', 'hero-voices.js'), `// Original hero voice lines from the local Deadlock installation.\nexport default ${JSON.stringify(manifest, null, 2)};\n`);
await fs.writeFile(path.join(output, 'source.json'), `${JSON.stringify({ copyright: 'Valve Corporation', description: 'Unmodified original hero-selection/intro lines, extracted from the local Steam installation for this personal app. Each source archive CRC32 was verified.', sources }, null, 2)}\n`);
console.log(JSON.stringify({ heroes: sources.length, bytes: sources.reduce((sum, source) => sum + source.bytes, 0), sources: sources.map(({ hero, resource, duration, bytes }) => ({ hero, resource, duration, bytes })) }, null, 2));
