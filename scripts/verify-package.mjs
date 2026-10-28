import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import heroVoices from '../src/hero-voices.js';
import heroArt from '../src/hero-art.js';
import heroCatalog from '../src/hero-data.js';
import { MUSIC_TRACKS } from '../src/music-tracks.js';
import { STREET_BRAWL_AUDIO } from '../src/sound-palette.js';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archive = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
const required = ['main.cjs', 'preload.cjs', 'desktop-updater.cjs', 'update-core.cjs'];

async function enumerate(directory) {
  for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await enumerate(relative);
    else if (!relative.endsWith('-raw.json')) required.push(relative);
  }
}

await enumerate('src');
await enumerate('assets');
for (const hero of heroCatalog.heroes) {
  const art = heroArt[hero.id];
  assert.ok(art?.background && required.includes(art.background), `Hero loading background absent: ${hero.name}`);
  assert.ok(art?.image && required.includes(art.image), `Hero poster image absent: ${hero.name}`);
  if (art.fullBody) assert.ok(art.render && required.includes(art.render), `Full hero render absent: ${hero.name}`);
}
for (const track of MUSIC_TRACKS) assert.ok(required.includes(track.path), `Music track absent: ${track.id}`);
for (const sound of [...STREET_BRAWL_AUDIO.shots, ...Object.values(STREET_BRAWL_AUDIO.layers)]) assert.ok(required.includes(sound), `Street Brawl sound absent: ${sound}`);
for (const [heroId, voice] of Object.entries(heroVoices)) {
  assert.ok(required.includes(voice.path), `Selected hero voice is absent from package inputs: ${heroId}`);
}
for (const relative of required) {
  const expected = await fs.readFile(path.join(root, relative));
  const packaged = asar.extractFile(archive, path.normalize(relative));
  assert.equal(Buffer.compare(expected, packaged), 0, `Final packaged file differs from source: ${relative}`);
}
const { version } = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
assert.equal(version, JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version);
await fs.access(process.env.DEADLOCK_SMOKE_EXE || path.join(root, 'dist', 'Deadlock Roulette.exe'));
console.log(`Verified portable release ${version}: ${required.length} packaged files match current source, including all icons and ${Object.keys(heroVoices).length} original hero voice lines.`);
