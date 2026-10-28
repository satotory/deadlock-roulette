import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildWeb } from '../scripts/build-web.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deadlock-web-'));
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('deadlock-web-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = {
    'package.json': JSON.stringify({ version: '1.10.0' }),
    'index.html': '<meta http-equiv="refresh" content="0;url=./src/index.html">',
    'src/index.html': '<script type="module" src="./app.js"></script>',
    'src/app.js': 'import "./core.js";', 'src/core.js': 'export const test = true;',
    'src/style.css': 'body{}', 'src/private.json': '{"doNotPublish":true}',
    'src/.local-secret.js': 'doNotPublish',
    'assets/items/a.png': 'media', 'assets/audio/a.mp3': 'media',
    'assets/source.json': 'private metadata', 'assets/items-raw.json': 'raw metadata',
    'main.cjs': 'desktop-only', 'preload.cjs': 'desktop-only',
    '.publish/token.txt': 'never-copy', '.smoke-data/session.json': 'never-copy',
    'node_modules/secret.js': 'never-copy', 'dist/Deadlock Roulette.exe': 'never-copy',
  };
  for (const [file, data] of Object.entries(files)) { const filename = path.join(root, file); await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, data); }
  return root;
}

test('web artifact contains only renderer code and media and preserves subdirectory-relative paths', async t => {
  const root = await fixture(t), result = await buildWeb({ root });
  assert.equal(result.output, path.join(root, 'web-dist'));
  assert.equal(result.version, '1.10.0');
  for (const file of ['index.html', '.nojekyll', 'src/index.html', 'src/app.js', 'src/core.js', 'src/style.css', 'assets/items/a.png', 'assets/audio/a.mp3']) await fs.access(path.join(result.output, file));
  for (const file of ['package.json', 'main.cjs', 'preload.cjs', 'src/private.json', 'src/.local-secret.js', 'assets/source.json', 'assets/items-raw.json', '.publish', '.smoke-data', 'node_modules', 'dist']) {
    await assert.rejects(fs.access(path.join(result.output, file)), error => error.code === 'ENOENT', `Private file copied: ${file}`);
  }
  assert.equal(await fs.readFile(path.join(result.output, 'src/app.js'), 'utf8'), 'import "./core.js";');
  const manifest = JSON.parse(await fs.readFile(path.join(result.output, 'version.json'), 'utf8'));
  assert.equal(manifest.version, '1.10.0');
  assert.equal(manifest.webURL, 'https://satotory.github.io/deadlock-roulette/');
  assert.equal(manifest.releaseURL, 'https://github.com/satotory/deadlock-roulette/releases/latest');
});

test('rebuilding regenerates only the named web output and removes stale public files', async t => {
  const root = await fixture(t), first = await buildWeb({ root });
  await fs.writeFile(path.join(first.output, 'stale-secret.txt'), 'must disappear');
  await fs.writeFile(path.join(root, 'keep-user-file.txt'), 'keep');
  await buildWeb({ root });
  await assert.rejects(fs.access(path.join(first.output, 'stale-secret.txt')), error => error.code === 'ENOENT');
  assert.equal(await fs.readFile(path.join(root, 'keep-user-file.txt'), 'utf8'), 'keep');
});

test('a non-directory web output and invalid package version are refused without removing files', async t => {
  const root = await fixture(t), output = path.join(root, 'web-dist');
  await fs.writeFile(output, 'an existing ordinary file');
  await assert.rejects(buildWeb({ root }), /ordinary generated directory/);
  assert.equal(await fs.readFile(output, 'utf8'), 'an existing ordinary file');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: 'https://untrusted.example' }));
  await assert.rejects(buildWeb({ root }), /valid app version/);
  assert.equal(await fs.readFile(output, 'utf8'), 'an existing ordinary file');
});
