// Personal app assets from the user's installed Deadlock. Game files are read-only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { openLocalVpk, resourceBlock, readKv3V5, extractSoundStream } from './local-vpk.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vpk = await openLocalVpk(process.argv[2]);
const { resource: musicResource } = await vpk.read('soundevents/music.vsndevts_c');
const musicEvents = readKv3V5(resourceBlock(musicResource));
const { resource: uiResource } = await vpk.read('soundevents/ui.vsndevts_c');
const uiEvents = readKv3V5(resourceBlock(uiResource));
const tracks = [
  { id: 'title', name: 'Title • current menu', localizedName: 'Title • новое меню', event: 'Music.Title', field: 'vsnd_files' },
  { id: 'hideout', name: 'The Hideout', localizedName: 'Убежище', event: 'Music.Hideout', field: 'vsnd_files_play_base' },
  { id: 'brawl', name: 'Street Brawl • draft', localizedName: 'Street Brawl • драфт', event: 'Music.Brawl.Draft', field: 'vsnd_files_draft' },
  { id: 'search', name: 'Searching for a match', localizedName: 'Поиск матча', event: 'Music.Hideout.Search', field: 'vsnd_files' },
  { id: 'postgame', name: 'Post Match', localizedName: 'После матча', event: 'Music.PostGame', field: 'vsnd_files' },
  { id: 'classic', name: 'Classic main menu', localizedName: 'Классическое меню', event: 'Music.MainMenu', field: 'vsnd_files' },
];
const sources = [];
async function extract(resourcePath, destination, metadata) {
  const { resource, archiveName } = await vpk.read(resourcePath);
  const { audio, extension } = extractSoundStream(resource);
  assert.equal(extension, 'mp3', 'All selected current assets must be MPEG audio');
  const filename = `${destination}.mp3`;
  await fs.mkdir(path.dirname(path.join(root, filename)), { recursive: true });
  await fs.writeFile(path.join(root, filename), audio);
  sources.push({ ...metadata, resource: resourcePath, archive: archiveName, file: filename, bytes: audio.length, sha256: createHash('sha256').update(audio).digest('hex') });
  return filename;
}
const manifest = [];
for (const track of tracks) {
  const event = musicEvents[track.event];
  assert.ok(event, track.event);
  const resourcePath = event[track.field][0] + '_c';
  const destination = track.id === 'classic' ? 'assets/audio/menu' : `assets/audio/music/${track.id}`;
  const filename = await extract(resourcePath, destination, { kind: 'music', id: track.id, soundevent: track.event, field: track.field, duration: event.vsnd_duration });
  manifest.push({ id: track.id, name: track.name, localizedName: track.localizedName, path: filename, duration: event.vsnd_duration });
}
const landing = uiEvents['Base.UI.ItemDraft.Appear'];
assert.ok(landing);
for (let index = 0; index < landing['track_2.track_vsnd_files'].length; index++) {
  await extract(landing['track_2.track_vsnd_files'][index] + '_c', `assets/audio/street-brawl/shot-${index + 1}`, { kind: 'item-landing-base', soundevent: 'Base.UI.ItemDraft.Appear', field: 'track_2.track_vsnd_files' });
}
for (const category of ['Weapon', 'Vitality', 'Spirit']) {
  const soundevent = `UI.ItemDraft.Appear.${category}`;
  const event = uiEvents[soundevent];
  assert.equal(event.base, 'Base.UI.ItemDraft.Appear');
  await extract(event.vsnd_files + '_c', `assets/audio/street-brawl/${category.toLowerCase()}`, { kind: 'item-landing-category', category: category.toLowerCase(), soundevent, duration: event.vsnd_duration });
}
const provenance = {
  copyright: 'Valve Corporation',
  description: 'Original unmodified MPEG audio from the current local Deadlock installation for this personal offline app. VPK CRC32 verified. Soundevent paths decoded from the game resource, not guessed from filenames.',
  soundeventResources: ['soundevents/music.vsndevts_c', 'soundevents/ui.vsndevts_c'],
  sources,
};
await fs.writeFile(path.join(root, 'assets/audio/current-source.json'), `${JSON.stringify(provenance, null, 2)}\n`);
await fs.writeFile(path.join(root, 'src/music-tracks.js'), `// Original tracks, verified against the current local game soundevents.\nexport const MUSIC_TRACKS = Object.freeze(${JSON.stringify(manifest, null, 2)}.map(track => Object.freeze(track)));\nexport const DEFAULT_MUSIC_TRACK = 'title';\nexport function normalizeMusicTrack(value) {\n  return MUSIC_TRACKS.some(track => track.id === value) ? value : DEFAULT_MUSIC_TRACK;\n}\nexport function getMusicTrack(value) {\n  return MUSIC_TRACKS.find(track => track.id === normalizeMusicTrack(value));\n}\n`);
console.log(JSON.stringify({ tracks: manifest, landingSamples: sources.filter(source => source.kind !== 'music').length, bytes: sources.reduce((sum, source) => sum + source.bytes, 0) }, null, 2));
