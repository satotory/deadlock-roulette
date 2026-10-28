import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_EXTENSIONS = new Set(['.js', '.css', '.html']);
const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.mp3', '.wav', '.ogg', '.woff', '.woff2', '.ttf', '.otf']);
const LINKS = Object.freeze({
  releaseURL: 'https://github.com/satotory/deadlock-roulette/releases/latest',
  downloadURL: 'https://github.com/satotory/deadlock-roulette/releases/latest/download/Deadlock.Roulette.exe',
  webURL: 'https://satotory.github.io/deadlock-roulette/',
});

/** Publish only renderer code and bundled media, never desktop code or local runtime data. */
export async function buildWeb({ root = PROJECT_ROOT } = {}) {
  root = await fs.realpath(path.resolve(root));
  const output = path.join(root, 'web-dist');
  const packageJSON = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(packageJSON.version || '')) throw new Error('A valid app version is required.');
  await Promise.all(['index.html', 'src/index.html'].map(file => fs.access(path.join(root, file))));
  // The generated target is a single named child of the resolved checkout, not a caller-supplied deletion path.
  const existing = await fs.lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (existing?.isSymbolicLink() || existing && !existing.isDirectory()) throw new Error('web-dist must be an ordinary generated directory.');
  if (path.dirname(output) !== root || path.basename(output) !== 'web-dist') throw new Error('Refusing an unsafe web output path.');
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  let files = 0;
  async function copyRuntime(relative, extensions) {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Runtime files cannot be symbolic links: ${file}`);
      if (entry.isDirectory()) await copyRuntime(file, extensions);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        await fs.mkdir(path.dirname(path.join(output, file)), { recursive: true });
        await fs.copyFile(path.join(root, file), path.join(output, file)); files++;
      }
    }
  }
  await copyRuntime('src', SOURCE_EXTENSIONS);
  await copyRuntime('assets', ASSET_EXTENSIONS);
  await fs.copyFile(path.join(root, 'index.html'), path.join(output, 'index.html'));
  await fs.writeFile(path.join(output, '.nojekyll'), '');
  const manifest = { version: packageJSON.version, ...LINKS };
  await fs.writeFile(path.join(output, 'version.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { output, version: packageJSON.version, files: files + 3, ...LINKS };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await buildWeb()));
}
