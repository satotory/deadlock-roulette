const MAX_PNG_BYTES = 12 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Keep a generated filename portable without interpreting a build name as a path. */
export function pngFilename(name = 'Deadlock Build') {
  let stem = String(name || 'Deadlock Build').replace(/\.png$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().replace(/[. ]+$/, '');
  stem = Array.from(stem).slice(0, 120).join('');
  if (!stem) stem = 'Deadlock Build';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `Deadlock-${stem}`;
  return `${stem}.png`;
}

/** The browser follows the same image size and PNG envelope as the desktop bridge. */
export function pngDataURLToBlob(dataURL, runtime = globalThis) {
  if (typeof dataURL !== 'string' || dataURL.length > MAX_PNG_BYTES * 4 / 3 + 64 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataURL)) {
    throw new TypeError('Expected a PNG image of at most 12 MB.');
  }
  const encoded = dataURL.slice('data:image/png;base64,'.length);
  let decoded;
  try { decoded = runtime.atob(encoded); } catch { throw new TypeError('The PNG data is not valid base64.'); }
  const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  if (bytes.length < 45 || bytes.length > MAX_PNG_BYTES || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte) ||
      String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR' || view.getUint32(8) !== 13 ||
      String.fromCharCode(...bytes.subarray(bytes.length - 8, bytes.length - 4)) !== 'IEND' || view.getUint32(bytes.length - 12) !== 0) {
    throw new TypeError('The PNG image is incomplete.');
  }
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 4096 || height > 4096 || width * height > 12_000_000) throw new RangeError('The PNG dimensions are too large.');
  return new runtime.Blob([bytes], { type: 'image/png' });
}

/** Use the native save dialog on Windows, or an actual file download in the browser. */
export async function exportPNG(dataURL, name, language = 'ru', runtime = globalThis) {
  if (runtime.deadlock?.exportPNG) return runtime.deadlock.exportPNG(dataURL, name, language);
  const blob = pngDataURLToBlob(dataURL, runtime), filename = pngFilename(name);
  const url = runtime.URL.createObjectURL(blob);
  let anchor;
  try {
    anchor = runtime.document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.rel = 'noopener'; anchor.hidden = true;
    runtime.document.body.append(anchor); anchor.click();
  } catch (error) {
    runtime.URL.revokeObjectURL(url);
    throw error;
  } finally { anchor?.remove(); }
  // Revoke after the browser has accepted the download, rather than during the click.
  runtime.setTimeout(() => runtime.URL.revokeObjectURL(url), 1000);
  return filename;
}
