// Reuse the game's original Cursed Relic cast for the app's curse rule.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { openLocalVpk, resourceBlock, readKv3V5, extractSoundStream } from './local-vpk.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vpk = await openLocalVpk(process.argv[2]);
const definition = 'soundevents/mods/tech.vsndevts_c';
const { resource: eventResource } = await vpk.read(definition);
const eventName = 'Mods.Tech.Glitch.Cast';
const event = readKv3V5(resourceBlock(eventResource))[eventName];
assert.ok(event && typeof event.vsnd_files === 'string');
const resourcePath = `${event.vsnd_files}_c`;
const { resource, archiveName } = await vpk.read(resourcePath);
const { audio, extension } = extractSoundStream(resource);
assert.equal(extension, 'mp3');
const output = 'assets/audio/curse.mp3';
await fs.writeFile(path.join(root, output), audio);
const source = {
  copyright: 'Valve Corporation',
  description: 'Original Cursed Relic cast, unmodified MPEG stream from the user local game installation. VPK CRC32 verified; the app curse is a separate custom rule.',
  soundeventResource: definition, soundevent: eventName,
  resource: resourcePath, archive: archiveName, file: output,
  duration: event.vsnd_duration, bytes: audio.length,
  sha256: createHash('sha256').update(audio).digest('hex'),
};
await fs.writeFile(path.join(root, 'assets/audio/curse-source.json'), `${JSON.stringify(source, null, 2)}\n`);
console.log(JSON.stringify(source, null, 2));
