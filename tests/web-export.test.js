import test from 'node:test';
import assert from 'node:assert/strict';
import { exportPNG, pngDataURLToBlob, pngFilename } from '../src/file-export.js';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6C0AAAAAASUVORK5CYII=';

test('browser PNG export retains actual image bytes and checks dimensions and envelope', async () => {
  const blob = pngDataURLToBlob(PIXEL);
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), Buffer.from(PIXEL.split(',')[1], 'base64'));
  assert.throws(() => pngDataURLToBlob('data:text/html;base64,PHNjcmlwdD4='), /Expected a PNG/);
  assert.throws(() => pngDataURLToBlob('data:image/png;base64,AA=='), /incomplete/);
  const image = Buffer.from(PIXEL.split(',')[1], 'base64');
  image.writeUInt32BE(4097, 16);
  assert.throws(() => pngDataURLToBlob(`data:image/png;base64,${image.toString('base64')}`), /dimensions/);
  image.writeUInt32BE(1, 16); image[image.length - 5] = 0;
  assert.throws(() => pngDataURLToBlob(`data:image/png;base64,${image.toString('base64')}`), /incomplete/);
});

test('browser filename never interprets a build title as a directory or Windows device', () => {
  assert.equal(pngFilename('Матч Silver.png'), 'Матч Silver.png');
  assert.equal(pngFilename('../file:with\\path?*'), '..-file-with-path--.png');
  assert.equal(pngFilename('NUL'), 'Deadlock-NUL.png');
  assert.equal(pngFilename('CON.custom'), 'Deadlock-CON.custom.png');
  assert.equal(pngFilename('  ...  '), 'Deadlock Build.png');
  assert.equal(Array.from(pngFilename('🌟'.repeat(200))).length, 124);
});

test('desktop PNG export preserves the native bridge and cancellation result', async () => {
  const calls = [];
  const runtime = { deadlock: { exportPNG(...args) { calls.push(args); return Promise.resolve(null); } } };
  assert.equal(await exportPNG('native-validates-this', 'My build', 'en', runtime), null);
  assert.deepEqual(calls, [['native-validates-this', 'My build', 'en']]);
});

test('browser download uses a PNG Blob, cleans the anchor, and revokes after the download click', async () => {
  const calls = [], scheduled = [];
  const anchor = { click() { calls.push(['click', this.href, this.download]); }, remove() { calls.push(['remove']); } };
  const runtime = {
    Blob, atob,
    document: { createElement(name) { assert.equal(name, 'a'); return anchor; }, body: { append(element) { assert.equal(element, anchor); calls.push(['append']); } } },
    URL: { createObjectURL(blob) { assert.equal(blob.type, 'image/png'); calls.push(['url']); return 'blob:local-png'; }, revokeObjectURL(url) { calls.push(['revoke', url]); } },
    setTimeout(callback, delay) { scheduled.push(callback); assert.equal(delay, 1000); },
  };
  assert.equal(await exportPNG(PIXEL, 'Haze / Match', 'en', runtime), 'Haze - Match.png');
  assert.deepEqual(calls.map(call => call[0]), ['url', 'append', 'click', 'remove']);
  assert.deepEqual(calls[2], ['click', 'blob:local-png', 'Haze - Match.png']);
  scheduled[0]();
  assert.deepEqual(calls.at(-1), ['revoke', 'blob:local-png']);
});

test('browser rejects invalid images before creating a download and cleans up click failures', async () => {
  let urls = 0, revoked = 0, removed = 0;
  const runtime = { Blob, atob,
    document: { createElement() { return { click() { throw new Error('download unavailable'); }, remove() { removed++; } }; }, body: { append() {} } },
    URL: { createObjectURL() { urls++; return 'blob:failed'; }, revokeObjectURL() { revoked++; } },
    setTimeout() { throw new Error('A failed download must not schedule delayed cleanup.'); },
  };
  await assert.rejects(exportPNG('data:text/html;base64,AA==', 'bad', 'en', runtime), /Expected a PNG/);
  assert.equal(urls, 0);
  await assert.rejects(exportPNG(PIXEL, 'valid', 'en', runtime), /download unavailable/);
  assert.deepEqual([urls, revoked, removed], [1, 1, 1]);
});
