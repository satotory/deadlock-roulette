// Fetch complete original hero loading-screen artwork and cache it for offline use.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import catalog from '../src/hero-data.js';
import previousArt from '../src/hero-art.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const sharp = require(process.env.DEADLOCK_SHARP_MODULE || 'sharp');
const response = await fetch('https://api.deadlock-api.com/v1/assets/heroes?language=english', { signal: AbortSignal.timeout(45_000) });
if (!response.ok) throw new Error(`Hero metadata: HTTP ${response.status}`);
const metadata = new Map((await response.json()).map(hero => [String(hero.id), hero]));
const output = path.join(root, 'assets', 'hero-art');
const research = path.join(root, '.build-cache', 'hero-art');
await fs.mkdir(output, { recursive: true });
await fs.mkdir(research, { recursive: true });
const manifest = {};
const sources = [];
if (process.argv.includes('--download-renders')) {
  const html = await fs.readFile(path.join(research,'drive-renders.html'),'utf8');
  const entries = [...html.matchAll(/\[\[null,"([^"]+)"\],null,null,null,"([^"]+)"/g)];
  const files = entries.map((entry,index) => { const text = html.slice(entry.index, entries[index + 1]?.index || entry.index + 5000); return { id: entry[1], mime: entry[2], name: (text.match(/\[\[\["([^"]+)",null,1\]\]\]/)?.[1] || '').replaceAll('\\u0026','&') }; }).filter(file => file.mime === 'image/png' && !file.name.includes('_Alt'));
  const existingArt = (await import('../src/hero-art.js')).default;
  const existingSources = JSON.parse(await fs.readFile(path.join(output,'source.json'),'utf8')).sources;
  const normalize = name => name.toLowerCase().replace(/^the /,'').replace(/[^a-z0-9]/g,'');
  await fs.mkdir(path.join(output,'characters'),{recursive:true});
  const renderSources = [];
  for (let start=0;start<files.length;start+=3) {
    const results = await Promise.allSettled(files.slice(start,start+3).map(async file => {
      const hero = catalog.heroes.find(hero => normalize(hero.name) === normalize(file.name.replace(/\.png$/,'')));
      if (!hero) throw new Error(`Unknown render ${file.name}`);
      const url = `https://drive.google.com/uc?export=download&id=${file.id}`;
      const response = await fetch(url,{signal:AbortSignal.timeout(60_000)});
      if (!response.ok) throw new Error(`${hero.name} render HTTP ${response.status}`);
      const source=Buffer.from(await response.arrayBuffer());
      const metadata=await sharp(source).metadata();
      if (metadata.width<500 || metadata.height<500 || !metadata.hasAlpha) throw new Error(`Invalid full character render: ${hero.name}`);
      const bytes=await sharp(source).resize({width:1200,height:1400,fit:'inside',withoutEnlargement:true}).webp({quality:90,effort:5}).toBuffer();
      const target=`assets/hero-art/characters/${hero.id}.webp`;
      await fs.writeFile(path.join(root,target),bytes);
      existingArt[hero.id].render=target;
      existingArt[hero.id].fullBody=true;
      existingArt[hero.id].renderSource=`https://drive.google.com/file/d/${file.id}/view`;
      renderSources.push({id:hero.id,hero:hero.name,url:existingArt[hero.id].renderSource,originalName:file.name,originalWidth:metadata.width,originalHeight:metadata.height,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
      console.log(`${hero.name}: original full body ${metadata.width}x${metadata.height} => ${bytes.length} bytes`);
    }));
    for(const result of results) if(result.status==='rejected') console.log('RENDER FAILED:',result.reason.message);
  }
  for (const hero of catalog.heroes) {
    const art=existingArt[hero.id];
    art.background=art.background||art.image;
    art.image=art.render||hero.portrait;
    art.fullBody=Boolean(art.render);
  }
  await fs.writeFile(path.join(root,'src','hero-art.js'),`// Complete original hero backgrounds and authentic in-game renders cached offline.\nexport default ${JSON.stringify(existingArt,null,2)};\n`);
  await fs.writeFile(path.join(output,'source.json'),`${JSON.stringify({copyright:'Valve Corporation',description:'Original loading-screen layers from assets API; transparent in-game full-body renders from the public Deadlock Graphical Library by Lovely, linked on Valve forums. Assets are resized without cropping for offline use.',renderLibrary:'https://forums.playdeadlock.com/resources/deadlock-graphical-library.30/',sources:existingSources,renders:renderSources},null,2)}\n`);
  console.log(JSON.stringify({backgrounds:catalog.heroes.length,fullRenders:renderSources.length,missing:catalog.heroes.filter(hero=>!existingArt[hero.id].render).map(hero=>hero.name)}));
  process.exit(0);
}
if (process.argv.includes('--inspect-drive')) {
  const archiveResponse = await fetch('https://valvearchive.com/Games/Deadlock/Art/', { signal: AbortSignal.timeout(45_000) });
  const archiveHtml = await archiveResponse.text();
  await fs.writeFile(path.join(research,'archive.html'), archiveHtml);
  console.log('Valve art archive', archiveResponse.status, [...archiveHtml.matchAll(/href="([^"]+)"/g)].map(match => match[1]));
  const id = process.argv.find(value => value.startsWith('--drive='))?.slice(8) || '1m-vTnqd4oC1Vu9WIn0X03bIZWH1cLnfX';
  const response = await fetch(`https://drive.google.com/drive/folders/${id}`, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`Drive folder HTTP ${response.status}`);
  const html = await response.text();
  await fs.writeFile(path.join(research,'drive-renders.html'), html);
  const entries = [...html.matchAll(/\[\[null,"([^"]+)"\],null,null,null,"([^"]+)"/g)];
  console.log(JSON.stringify(entries.map((entry,index) => { const text = html.slice(entry.index, entries[index + 1]?.index || entry.index + 5000); return { id: entry[1], mime: entry[2], name: text.match(/\[\[\["([^"]+)",null,1\]\]\]/)?.[1] }; }), null, 2));
  process.exit(0);
}
const wikiTitles = catalog.heroes.map(hero => `File:${hero.name.replaceAll(' ', '_')}_Render.png`);
const wikiURL = new URL('https://deadlock.wiki/api.php');
wikiURL.search = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|size', titles: wikiTitles.join('|') });
const wikiResponse = await fetch(wikiURL, { signal: AbortSignal.timeout(45_000), headers: { 'User-Agent': 'DeadlockRoulette/1.5 (personal offline artwork cache)' } });
const wikiPages = wikiResponse.ok ? Object.values((await wikiResponse.json()).query?.pages || {}) : [];
if (process.argv.includes('--inspect-renders')) {
  for (const url of ['https://deadlock.wiki/images/7/7f/The_Doorman_Render.png','https://imgur.com/gallery/deadlock-heroes-game-render-Rd9y3tr','https://drive.google.com/drive/folders/1PvXmXNP9MLTSjOmg7fUGChsqaE3hxyh7']) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' } });
      const data = Buffer.from(await response.arrayBuffer());
      console.log('Render host: ', url, response.status, response.headers.get('content-type'),data.length);
      if (response.ok) await fs.writeFile(path.join(research, url.includes('imgur') ? 'imgur.html' : url.includes('drive') ? 'drive.html' : 'doorman.png'), data);
    } catch (error) { console.log(url, error.message); }
  }
  if (wikiPages.length) console.log(JSON.stringify(wikiPages, null, 2));
  else for (const hero of catalog.heroes.filter(hero => ['69','6','80','85'].includes(hero.id))) {
    const filename = `${hero.name.replaceAll(' ', '_')}_Render.png`;
    const hash = createHash('md5').update(filename).digest('hex');
    const url = `https://deadlock.wiki/images/${hash[0]}/${hash.slice(0, 2)}/${encodeURIComponent(filename)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    console.log(JSON.stringify({ hero: hero.name, url, status: response.status, type: response.headers.get('content-type'), length: response.headers.get('content-length') }));
  }
  process.exit(0);
}

function dominantColor({ data, info }) {
  // Saturated artwork pixels outweigh dark loading-screen margins and skin highlights.
  const buckets = new Map();
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const [r, g, b] = data.subarray(offset, offset + 3);
    if (info.channels === 4 && data[offset + 3] < 180) continue;
    const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b);
    if (maximum < 48 || minimum > 215 || maximum - minimum < 24) continue;
    const key = [r, g, b].map(channel => Math.min(7, Math.floor(channel / 32))).join(',');
    const weight = ((maximum - minimum) / maximum) ** 2;
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += weight;
    bucket.r += r * weight; bucket.g += g * weight; bucket.b += b * weight;
    buckets.set(key, bucket);
  }
  const bucket = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  if (!bucket) {
    const totals=[0,0,0]; let count=0;
    for(let offset=0;offset<data.length;offset+=info.channels) {
      if(info.channels===4 && data[offset+3]<180 || Math.max(...data.subarray(offset,offset+3))<55) continue;
      totals.forEach((_,index)=>totals[index]+=data[offset+index]); count++;
    }
    return count ? `#${totals.map(channel=>Math.round(channel/count).toString(16).padStart(2,'0')).join('')}` : '#899195';
  }
  return `#${[bucket.r, bucket.g, bucket.b].map(channel => Math.round(channel / bucket.count).toString(16).padStart(2, '0')).join('')}`;
}

async function fetchHero(hero) {
  const meta = metadata.get(hero.id);
  const url = meta?.images?.background_image_webp || meta?.images?.background_image;
  if (!url) throw new Error(`Missing complete background for ${hero.name}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`${hero.name} background: HTTP ${response.status}`);
  const source = Buffer.from(await response.arrayBuffer());
  const original = await sharp(source).metadata();
  const bytes = await sharp(source).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88, effort: 5 }).toBuffer();
  const result = await sharp(bytes).metadata();
  const sample = await sharp(bytes).resize(96, 96, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const color = dominantColor(sample);
  await fs.writeFile(path.join(output, `${hero.id}.webp`), bytes);
  manifest[hero.id] = { ...(previousArt[hero.id] || {}), image: previousArt[hero.id]?.render || hero.portrait, background: `assets/hero-art/${hero.id}.webp`, color, width: result.width, height: result.height, source: url };
  sources.push({ id: hero.id, hero: hero.name, source: url, originalWidth: original.width, originalHeight: original.height, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  console.log(`${hero.name}: ${original.width}x${original.height}, ${bytes.length} bytes, ${color}`);
}

// Six concurrent image downloads, independent of one another.
for (let index = 0; index < catalog.heroes.length; index += 6) {
  const outcomes = await Promise.allSettled(catalog.heroes.slice(index, index + 6).map(fetchHero));
  for (const result of outcomes) if (result.status === 'rejected') throw result.reason;
}
await fs.writeFile(path.join(root, 'src', 'hero-art.js'), `// Original complete Deadlock hero backgrounds, cached for offline use.\nexport default ${JSON.stringify(manifest, null, 2)};\n`);
const previousSources=JSON.parse(await fs.readFile(path.join(output,'source.json'),'utf8'));
await fs.writeFile(path.join(output, 'source.json'), `${JSON.stringify({ ...previousSources, copyright: 'Valve Corporation', description: 'Complete original game selection artwork, with uncropped authentic hero poses from the Graphical Library and Deadlock Labs gallery, plus original game loading-screen backgrounds. The theme color is measured from artwork pixels.', sources }, null, 2)}\n`);
console.log(JSON.stringify({ heroes: sources.length, bytes: sources.reduce((sum, source) => sum + source.bytes, 0) }));
