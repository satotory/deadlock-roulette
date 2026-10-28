// Assemble verified, already downloaded artwork; no network access or game writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import heroArt from '../src/hero-art.js';
import catalog from '../src/hero-data.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const sharp = require(process.env.DEADLOCK_SHARP_MODULE || 'sharp');
const sourceFile = path.join(root,'assets/hero-art/source.json');
const provenance = JSON.parse(await fs.readFile(sourceFile,'utf8'));
const extra = JSON.parse(await fs.readFile(path.join(root,'assets/hero-art/extra/sources.json'),'utf8'));
for (const source of extra.sources) {
  const art = heroArt[source.id];
  if (!art) throw new Error(`Unknown hero render ${source.id}`);
  art.render = source.file;
  art.image = source.file;
  art.fullBody = true;
  art.renderSource = source.source;
  art.renderWidth = source.width;
  art.renderHeight = source.height;
}
for (const hero of catalog.heroes) {
  const art = heroArt[hero.id];
  if (!art?.background || !art.render || !art.fullBody) throw new Error(`Incomplete artwork: ${hero.name}`);
  for (const asset of [art.background,art.render]) await fs.access(path.join(root,asset));
  if (art.color === '#af91bf') {
    const {data,info}=await sharp(path.join(root,art.background)).resize(64,64,{fit:'inside'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const totals=[0,0,0]; let count=0;
    for(let offset=0;offset<data.length;offset+=info.channels) {
      if(data[offset+3]<180 || Math.max(...data.subarray(offset,offset+3))<55) continue;
      totals.forEach((_,index)=>totals[index]+=data[offset+index]); count++;
    }
    if(count) art.color=`#${totals.map(channel=>Math.round(channel/count).toString(16).padStart(2,'0')).join('')}`;
  }
}
provenance.description='Original complete hero selection artwork for all 41 heroes: original loading-screen background layers from the game assets API, and authentic complete in-game hero selection poses from the public Deadlock Graphical Library or the Deadlock Labs gallery. Cached locally without cropping; no invented or generated character artwork.';
provenance.renders=[...(provenance.renders||[]).filter(source=>!extra.sources.some(extraSource=>extraSource.id===source.id)),...extra.sources];
await fs.writeFile(path.join(root,'src/hero-art.js'),`// Original complete loading-screen backgrounds and selection poses for all 41 heroes.\nexport default ${JSON.stringify(heroArt,null,2)};\n`);
await fs.writeFile(sourceFile,`${JSON.stringify(provenance,null,2)}\n`);
const scratch = path.join(root,'.build-cache/hero-art');
await fs.mkdir(scratch,{recursive:true});
for (const filename of ['archive.html','drive-renders.html','drive.html']) {
  const source=path.resolve(root,'assets/hero-art',filename),target=path.resolve(scratch,filename);
  if (!source.startsWith(`${root}${path.sep}`) || !target.startsWith(`${root}${path.sep}`)) throw new Error('Unsafe research path');
  try { await fs.rename(source,target); } catch(error) { if(error.code!=='ENOENT') throw error; }
}
console.log(JSON.stringify({heroes:Object.keys(heroArt).length,complete:catalog.heroes.every(hero=>heroArt[hero.id].background&&heroArt[hero.id].render),colors:Object.fromEntries(catalog.heroes.filter(hero=>['60','66','78','69'].includes(hero.id)).map(hero=>[hero.name,heroArt[hero.id].color]))}));
