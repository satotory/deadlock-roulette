import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_GAME = 'C:/Program Files (x86)/Steam/steamapps/common/Deadlock/game/citadel';

/** Read-only VPK index and resources, including CRC verification. */
export async function openLocalVpk(game = DEFAULT_GAME) {
  const directory = await fs.readFile(path.join(game, 'pak01_dir.vpk'));
  assert.equal(directory.readUInt32LE(0), 0x55aa1234);
  const version = directory.readUInt32LE(4);
  assert.ok(version === 1 || version === 2);
  const headerSize = version === 2 ? 28 : 12;
  const treeEnd = headerSize + directory.readUInt32LE(8);
  assert.ok(treeEnd <= directory.length);
  let cursor = headerSize;
  const entries = new Map();
  function string() {
    const end = directory.indexOf(0, cursor);
    assert.ok(end >= cursor && end < treeEnd);
    const value = directory.toString('utf8', cursor, end);
    cursor = end + 1;
    return value;
  }
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
        entries.set(entry.path, entry);
      }
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    return crc >>> 0;
  });
  async function read(resourcePath) {
    const entry = entries.get(resourcePath);
    assert.ok(entry, `Missing local VPK resource: ${resourcePath}`);
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
    assert.equal((crc ^ 0xffffffff) >>> 0, entry.crc32, `${resourcePath}: archive CRC32`);
    return { resource, archiveName, entry };
  }
  return { game, entries, read };
}

export function extractSoundStream(resource) {
  assert.equal(resource.readUInt16LE(4), 12, 'Source 2 resource header required');
  const streamOffset = resource.readUInt32LE(0);
  assert.ok(streamOffset >= 16 && streamOffset < resource.length);
  const audio = resource.subarray(streamOffset);
  const isMP3 = audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0;
  const isOgg = audio.toString('ascii', 0, 4) === 'OggS';
  const isWave = audio.toString('ascii', 0, 4) === 'RIFF';
  assert.ok(isMP3 || isOgg || isWave, `Unsupported audio stream: ${audio.subarray(0, 16).toString('hex')}`);
  return { audio, extension: isMP3 ? 'mp3' : isOgg ? 'ogg' : 'wav' };
}

export function resourceBlock(resource, name = 'DATA') {
  const directory = 8 + resource.readUInt32LE(8);
  for (let index = 0; index < resource.readUInt32LE(12); index++) {
    const position = directory + index * 12;
    if (resource.toString('ascii', position, position + 4) !== name) continue;
    const offset = position + 4 + resource.readUInt32LE(position + 4);
    return resource.subarray(offset, offset + resource.readUInt32LE(position + 8));
  }
  throw new Error(`Missing resource block: ${name}`);
}

function decodeLz4(input, size) {
  const output = Buffer.alloc(size);
  let source = 0, target = 0;
  while (source < input.length) {
    const token = input[source++];
    let literals = token >>> 4;
    if (literals === 15) { let extra; do { extra = input[source++]; literals += extra; } while (extra === 255); }
    assert.ok(source + literals <= input.length && target + literals <= size);
    input.copy(output, target, source, source + literals);
    source += literals; target += literals;
    if (source === input.length) break;
    assert.ok(source + 2 <= input.length);
    const distance = input.readUInt16LE(source); source += 2;
    assert.ok(distance > 0 && distance <= target);
    let length = (token & 15) + 4;
    if ((token & 15) === 15) { let extra; do { extra = input[source++]; length += extra; } while (extra === 255); }
    assert.ok(target + length <= size);
    for (let index = 0; index < length; index++) { output[target] = output[target - distance]; target++; }
  }
  assert.equal(target, size);
  return output;
}

/** Minimal bounded KV3 v5 reader for local soundevent metadata, without blobs.
 * Layout reference: ValveResourceFormat/Resource/ResourceTypes/BinaryKV3.cs.
 */
export function readKv3V5(data) {
  assert.equal(data.readUInt32LE(0), 0x4b563305);
  const compression = data.readUInt32LE(20);
  assert.ok(compression === 0 || compression === 1, 'KV3 metadata supports raw/LZ4 only');
  assert.equal(data.readUInt32LE(56), 0, 'Binary blobs are not supported');
  const size1 = data.readUInt32LE(72), compressed1 = data.readUInt32LE(76);
  const size2 = data.readUInt32LE(80), compressed2 = data.readUInt32LE(84);
  const buffer1 = compression ? decodeLz4(data.subarray(120, 120 + compressed1), size1) : data.subarray(120, 120 + size1);
  const start2 = 120 + (compression ? compressed1 : size1);
  const buffer2 = compression ? decodeLz4(data.subarray(start2, start2 + compressed2), size2) : data.subarray(start2, start2 + size2);
  const align = (offset, bytes) => Math.ceil(offset / bytes) * bytes;
  function lanes(buffer, offset, counts) {
    const result = {};
    for (const bytes of [1, 2, 4, 8]) {
      const count = counts[bytes];
      if (count) offset = align(offset, bytes);
      result[bytes] = { buffer: buffer.subarray(offset, offset + count * bytes), position: 0 };
      offset += count * bytes;
    }
    return { result, offset };
  }
  const auxiliary = lanes(buffer1, 0, { 1: data.readUInt32LE(28), 2: data.readUInt32LE(64), 4: data.readUInt32LE(32), 8: data.readUInt32LE(36) }).result;
  const objectCount = data.readUInt32LE(108);
  const mainLanes = lanes(buffer2, objectCount * 4, { 1: data.readUInt32LE(88), 2: data.readUInt32LE(92), 4: data.readUInt32LE(96), 8: data.readUInt32LE(100) });
  const main = mainLanes.result;
  const types = buffer2.subarray(mainLanes.offset, mainLanes.offset + data.readUInt32LE(40));
  let typeOffset = 0, objectOffset = 0;
  function take(lane, method, size) {
    assert.ok(lane.position + size <= lane.buffer.length, 'KV3 lane bounds');
    const value = lane.buffer[method](lane.position); lane.position += size;
    return value;
  }
  const strings = [];
  const stringCount = take(auxiliary[4], 'readInt32LE', 4);
  for (let index = 0; index < stringCount; index++) {
    const end = auxiliary[1].buffer.indexOf(0, auxiliary[1].position);
    assert.ok(end >= auxiliary[1].position);
    strings.push(auxiliary[1].buffer.toString('utf8', auxiliary[1].position, end));
    auxiliary[1].position = end + 1;
  }
  const integer = () => take(main[4], 'readInt32LE', 4);
  const string = () => strings[integer()] || '';
  function nextType() {
    assert.ok(typeOffset < types.length);
    const value = types[typeOffset++];
    if (value & 0x80) typeOffset++;
    if (value & 0x40) typeOffset++;
    return value & 0x3f;
  }
  function value(type = nextType(), lane = main, depth = 0) {
    assert.ok(depth < 128);
    if (type === 1) return null;
    if (type === 13 || type === 14) return type === 13;
    if ([15, 17, 26].includes(type)) return 0;
    if ([16, 18, 27].includes(type)) return 1;
    if (type === 2) return take(lane[1], 'readUInt8', 1) !== 0;
    if (type === 22) return take(lane[1], 'readInt8', 1);
    if (type === 23) return take(lane[1], 'readUInt8', 1);
    if (type === 20) return take(lane[2], 'readInt16LE', 2);
    if (type === 21) return take(lane[2], 'readUInt16LE', 2);
    if (type === 11) return take(lane[4], 'readInt32LE', 4);
    if (type === 12) return take(lane[4], 'readUInt32LE', 4);
    if (type === 19) return take(lane[4], 'readFloatLE', 4);
    if (type === 3) return Number(take(lane[8], 'readBigInt64LE', 8));
    if (type === 4) return Number(take(lane[8], 'readBigUInt64LE', 8));
    if (type === 5) return take(lane[8], 'readDoubleLE', 8);
    if (type === 6) return string();
    if (type === 8) {
      const length = integer(); assert.ok(length >= 0 && length < 100000);
      return Array.from({ length }, () => value(nextType(), main, depth + 1));
    }
    if ([10, 24, 25].includes(type)) {
      const length = type === 10 ? integer() : take(main[1], 'readUInt8', 1);
      assert.ok(length >= 0 && length < 100000);
      const subtype = nextType();
      return Array.from({ length }, () => value(subtype, type === 25 ? auxiliary : main, depth + 1));
    }
    if (type === 9) {
      assert.ok(objectOffset + 4 <= objectCount * 4);
      const length = buffer2.readInt32LE(objectOffset); objectOffset += 4;
      assert.ok(length >= 0 && length < 100000);
      const result = Object.create(null);
      for (let index = 0; index < length; index++) { const subtype = nextType(), name = string(); result[name] = value(subtype, main, depth + 1); }
      return result;
    }
    throw new Error(`Unsupported KV3 metadata type: ${type}`);
  }
  const result = value();
  assert.equal(typeOffset, types.length, 'KV3 type stream consumed completely');
  return result;
}
