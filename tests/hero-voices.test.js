import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import catalog from '../src/hero-data.js';
import voices from '../src/hero-voices.js';

test('each released hero has a verified original local selection voice', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../assets/voices/source.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(voices).length, catalog.heroes.length);
  assert.equal(manifest.sources.length, catalog.heroes.length);
  for (const hero of catalog.heroes) {
    const quote = voices[hero.id];
    assert.ok(quote, `Missing ${hero.name} quote`);
    assert.match(quote.path, /^assets\/voices\/\d+\.mp3$/);
    assert.equal(quote.kind, 'select');
    const original = manifest.sources.find(source => source.id === hero.id);
    assert.ok(original.duration >= .65 && original.duration <= 6, `${hero.name}: use a short whole phrase`);
    assert.ok(original.resource.startsWith(`sounds/vo/${hero.className.replace(/^hero_/, '')}/`));
    const bytes = fs.readFileSync(new URL(`../${quote.path}`, import.meta.url));
    assert.equal(bytes.length, original.bytes);
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1] & 0xe0, 0xe0);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), original.sha256);
  }
});
