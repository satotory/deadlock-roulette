// Research/cache additional authentic in-game full-body renders. No manifest edits.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import catalog from '../src/hero-data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'assets/hero-art/extra');
const research = path.join(root, '.build-cache/hero-art-extra');
await fs.mkdir(output, { recursive: true });
await fs.mkdir(research, { recursive: true });
const missing = new Set(['Abrams', 'Bebop', 'Celeste', 'Deadman Danny', 'Graves', 'Holliday', 'Infernus', 'Lady Geist', 'McGinnis', 'Paige', 'Pocket', 'Rat King', 'Shiv', 'Silver', 'Solomon', 'Venator', 'Victor', 'Wraith', 'Yamato']);
const heroes = catalog.heroes.filter(hero => missing.has(hero.name));
const requested = process.argv.find(argument => argument.startsWith('--id='))?.slice(5);
const directSource = process.argv.find(argument => argument.startsWith('--source='))?.slice(9);
if (process.argv.includes('--sheet')) {
  const require = createRequire(import.meta.url);
  const sharp = require(process.env.DEADLOCK_SHARP_MODULE || 'sharp');
  const overlays = [];
  for (const [index, hero] of heroes.entries()) {
    const left = index % 5 * 320, top = Math.floor(index / 5) * 350;
    const image = await sharp(path.join(output, `${hero.id}.webp`)).resize(320, 320, { fit: 'contain', background: '#16181c' }).png().toBuffer();
    overlays.push({ input: image, left, top });
    overlays.push({ input: Buffer.from(`<svg width="320" height="30"><rect width="320" height="30" fill="#121416"/><text x="12" y="21" fill="#e5d2ad" font-family="Segoe UI" font-size="17">${hero.id} · ${hero.name}</text></svg>`), left, top: top + 320 });
  }
  const file = path.join(research, 'contact-sheet.png');
  await sharp({ create: { width: 1600, height: 1400, channels: 4, background: '#16181c' } }).composite(overlays).png().toFile(file);
  console.log(file); process.exit(0);
}
if (process.argv.includes('--labs')) {
  const require = createRequire(import.meta.url);
  const sharp = require(process.env.DEADLOCK_SHARP_MODULE || 'sharp');
  const selected = heroes.filter(hero => !requested || hero.id === requested);
  const sources = [];
  async function download(hero) {
    const slug = hero.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const page = `https://deadlocklabs.gg/heroes/${slug}/`;
    const pageResponse = await fetch(page, { signal: AbortSignal.timeout(20_000) });
    const html = await pageResponse.text();
    await fs.writeFile(path.join(research, `${hero.id}-labs.html`), html);
    const paths = [...new Set([...html.matchAll(/(?:url=|["'])((?:%2F|\/)heroes(?:%2F|\/)renders(?:%2F|\/)[^"'<>\s&?]+\.webp)/g)].map(match => decodeURIComponent(match[1])))];
    const candidates = [
      ...paths,
      `/heroes/renders/${hero.name}.webp`,
      `/heroes/renders/${hero.name.replaceAll(' ', '_')}.webp`,
      `/heroes/renders/${hero.name.replaceAll(' ', '')}.webp`,
    ];
    for (const candidate of [...new Set(candidates)]) {
      const source = new URL(candidate, page).href;
      const response = await fetch(source, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(bytes).metadata();
      if (metadata.width < 500 || metadata.height < 500) continue;
      const file = `assets/hero-art/extra/${hero.id}.webp`;
      await fs.writeFile(path.join(root, file), bytes);
      const result = { id: hero.id, hero: hero.name, page, source, file, width: metadata.width, height: metadata.height, alpha: metadata.hasAlpha, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      await fs.writeFile(path.join(output, `${hero.id}-source.json`), `${JSON.stringify(result, null, 2)}\n`);
      sources.push(result);
      console.log(JSON.stringify(result));
      return;
    }
    throw new Error(`${hero.name}: no genuine selection render found`);
  }
  const failures = [];
  for (let index = 0; index < selected.length; index += 4) {
    const chunk = selected.slice(index, index + 4);
    const outcomes = await Promise.allSettled(chunk.map(download));
    outcomes.forEach((outcome, index) => { if (outcome.status === 'rejected') { failures.push({ id: chunk[index].id, hero: chunk[index].name, error: outcome.reason.message }); console.error(JSON.stringify(failures.at(-1))); } });
  }
  await fs.writeFile(path.join(output, 'sources.json'), `${JSON.stringify({ copyright: 'Valve Corporation', description: 'Original game hero selection poses mirrored by the Deadlock Labs gallery. Complete downloaded files, no generated or invented character content.', sources, failures }, null, 2)}\n`);
  console.log(JSON.stringify({ successful: sources.length, missing: failures }));
  process.exit(failures.length ? 1 : 0);
}
if (requested && directSource) {
  const response = await fetch(directSource, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Direct asset: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const extension = new URL(directSource).pathname.endsWith('.png') ? 'png' : 'webp';
  await fs.writeFile(path.join(output, `${requested}.${extension}`), bytes);
  console.log(JSON.stringify({ id: requested, source: directSource, type: response.headers.get('content-type'), bytes: bytes.length }));
  process.exit(0);
}
for (const hero of heroes.filter(hero => !requested || hero.id === requested)) {
  const slug = hero.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const url = `https://deadlockskins.gg/items/default-${slug}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const html = await response.text();
  await fs.writeFile(path.join(research, `${hero.id}-page.html`), html);
  const images = [...new Set([...html.matchAll(/https:\/\/assets\.deadlockskins\.gg\/[^\s"<>\\]+/g)].map(match => match[0]))];
  console.log(JSON.stringify({ id: hero.id, hero: hero.name, status: response.status, bytes: html.length, images: images.slice(0, 10) }));
  if (process.argv.includes('--download') && response.ok) {
    const thumbnail = images.find(image => /\/thumb\/[^/]+\/revisions\/[a-f0-9]+\/\d+\.webp/.test(image));
    if (!thumbnail) continue;
    const result = await fetch(thumbnail, { signal: AbortSignal.timeout(30_000) });
    if (!result.ok) throw new Error(`${hero.name} thumbnail: HTTP ${result.status}`);
    const bytes = Buffer.from(await result.arrayBuffer());
    await fs.writeFile(path.join(output, `${hero.id}.webp`), bytes);
    await fs.writeFile(path.join(output, `${hero.id}-source.json`), JSON.stringify({ id: hero.id, hero: hero.name, page: url, source: thumbnail, bytes: bytes.length }, null, 2));
    console.log(JSON.stringify({ saved: hero.id, source: thumbnail, bytes: bytes.length }));
  }
}
