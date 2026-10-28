import { getBuildPurchasePlan } from './build-purchase-plan.js';
import { createNewspaperArticle, newspaperAssetPath } from './newspaper-core.js';
import { FATE_PRESENTATION, drawFateBadges, prepareFateBadgeImages } from './fate-presentation.js';
import { exportPNG } from './file-export.js';

const CATEGORY = { weapon: '#df9b55', vitality: '#a2ca82', spirit: '#bea0db' };
const assetURL = path => new URL(`../${path}`, import.meta.url).href;
const imageCache = new Map(), alphaCache = new WeakMap();
function loadImage(path) {
  if (!imageCache.has(path)) imageCache.set(path, new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = assetURL(path);
  }));
  return imageCache.get(path);
}
function rounded(ctx, x, y, w, h, radius, fill, stroke) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}
function text(ctx, value, x, y, size = 22, color = '#efe7db', maxWidth, serif = false) {
  ctx.fillStyle = color; ctx.font = `${size}px ${serif ? 'Georgia' : 'Segoe UI'}, sans-serif`;
  const label = String(value ?? ''); let clipped = label;
  if (maxWidth) while (clipped.length && ctx.measureText(clipped + (clipped === label ? '' : '…')).width > maxWidth) clipped = clipped.slice(0, -1);
  ctx.fillText(clipped + (clipped === label ? '' : '…'), x, y);
}
function wrappedText(ctx, value, x, y, width, size = 20, color = '#dfd5e7', maximum = 2) {
  let fitted = size; ctx.font = `${fitted}px Segoe UI, sans-serif`;
  const words = String(value ?? '').split(/\s+/), longest = words.reduce((a, b) => ctx.measureText(a).width > ctx.measureText(b).width ? a : b, '');
  while (fitted > 14 && ctx.measureText(longest).width > width) ctx.font = `${--fitted}px Segoe UI, sans-serif`;
  const lines = []; let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  lines.slice(0, maximum).forEach((line, index) => text(ctx, line + (index === maximum - 1 && lines.length > maximum ? '…' : ''), x, y + index * (fitted + 6), fitted, color, width));
}
function cover(ctx, image, x, y, w, h) {
  const scale = Math.max(w / image.width, h / image.height);
  ctx.drawImage(image, x + (w - image.width * scale) / 2, y + (h - image.height * scale) / 2, image.width * scale, image.height * scale);
}

/** Geometry stays inside the trusted PNG envelope even for a maximum imported route. */
export function getContractPosterLayout(purchaseCount = 0) {
  const count = Number.isFinite(purchaseCount) ? Math.max(0, Math.min(512, Math.trunc(purchaseCount))) : 0;
  const width = 2600, rightX = 1148, rightWidth = 1398, itemSize = 220, itemPitch = 235, itemTop = 238, itemRowPitch = 286;
  const purchaseColumns = count > 240 ? 8 : count > 96 ? 6 : 4, purchaseRows = Math.ceil(count / purchaseColumns);
  const purchaseRowPitch = purchaseRows ? Math.min(78, Math.floor((4096 - 1478) / purchaseRows)) : 78;
  const purchaseHeight = purchaseRows ? purchaseRows * purchaseRowPitch : 38;
  const purchaseTop = 874, skillsHeading = purchaseTop + purchaseHeight + 48, skillsTop = skillsHeading + 70;
  const skillRowPitch = 82, footerY = skillsTop + 4 * skillRowPitch + 104, height = footerY + 54;
  return { width, height, rightX, rightWidth, hero: { x: 54, y: 54, width: 1040, height: height - 108 }, itemSize, itemPitch, itemTop, itemRowPitch,
    purchaseColumns, purchaseRows, purchaseRowPitch, purchaseHeight, purchaseTop, purchaseHeading: 842, skillsHeading, skillsTop, skillRowPitch, footerY };
}

/** Ignore alpha padding around an original render without modifying the bundled image. */
export function findVisibleAlphaBounds(data, width, height, threshold = 24) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] >= threshold) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < left ? { x: 0, y: 0, width, height } : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
function imageBounds(image) {
  if (alphaCache.has(image)) return alphaCache.get(image);
  let bounds = { x: 0, y: 0, width: image.width, height: image.height };
  try {
    const probe = document.createElement('canvas'), ratio = Math.min(1, 512 / Math.max(image.width, image.height));
    probe.width = Math.max(1, Math.round(image.width * ratio)); probe.height = Math.max(1, Math.round(image.height * ratio));
    const context = probe.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0, probe.width, probe.height);
    const box = findVisibleAlphaBounds(context.getImageData(0, 0, probe.width, probe.height).data, probe.width, probe.height);
    bounds = { x: box.x / ratio, y: box.y / ratio, width: box.width / ratio, height: box.height / ratio };
  } catch { /* Full-source cropping remains usable when an optional alpha probe is unavailable. */ }
  alphaCache.set(image, bounds); return bounds;
}
function heroCover(ctx, image, x, y, w, h) {
  const source = imageBounds(image), scale = Math.max(w / source.width, h / source.height);
  // Fill the tall panel; the rightward focal point keeps Venator's face in frame.
  ctx.drawImage(image, source.x, source.y, source.width, source.height, x + (w - source.width * scale) * .64, y, source.width * scale, source.height * scale);
}
function drawLock(ctx, x, y, scale = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  rounded(ctx, 0, 0, 27, 29, 5, '#251c2be8', '#d5a5cd99'); ctx.strokeStyle = '#edc7e9'; ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.roundRect(6, 12, 15, 11, 2); ctx.stroke(); ctx.beginPath(); ctx.arc(13.5, 11, 4.3, Math.PI, 0); ctx.lineTo(17.8, 13); ctx.stroke();
  ctx.fillStyle = '#edc7e9'; ctx.fillRect(12.5, 16, 2, 4); ctx.restore();
}
function drawSealed(ctx, x, y, w, h) {
  const king = FATE_PRESENTATION.king;
  rounded(ctx, x, y, w, h, 8, king.darkColor + '88', king.color + '99');
  ctx.save(); ctx.strokeStyle = king.brightColor; ctx.lineWidth = Math.max(1.4, w / 65); ctx.strokeRect(x + w * .22, y + h * .22, w * .56, h * .58);
  ctx.beginPath(); ctx.moveTo(x + w * .32, y + h * .19); ctx.lineTo(x + w * .38, y + h * .08); ctx.lineTo(x + w * .5, y + h * .17); ctx.lineTo(x + w * .62, y + h * .08); ctx.lineTo(x + w * .68, y + h * .19); ctx.stroke();
  text(ctx, '?', x + w * .37, y + h * .65, w * .36, king.brightColor); ctx.restore();
}

/** A wide match sheet with a large original hero pose and all twelve upgrade steps. */
export async function renderContractPoster({ build, hero, items, art, language = 'ru' }) {
  if (!hero) throw new TypeError('A poster needs a selected hero.');
  const ru = language !== 'en', article = createNewspaperArticle({ build, hero, items, language }), inventory = article.itemStrip, purchasePlan = getBuildPurchasePlan(build, items);
  const layout = getContractPosterLayout(purchasePlan.length), abilities = hero.abilities || [], abilityBySlot = new Map(abilities.map(ability => [ability.slot, ability]));
  const portraitPath = newspaperAssetPath(art?.image) || newspaperAssetPath(hero.portrait), renderPath = newspaperAssetPath(art?.render) || portraitPath, backgroundPath = newspaperAssetPath(art?.background) || portraitPath;
  const paths = [...new Set([portraitPath, backgroundPath, renderPath, ...inventory.map(item => item.icon), ...article.purchaseSteps.map(item => item.icon), ...abilities.map(ability => newspaperAssetPath(ability.icon))].filter(Boolean))];
  const loaded = new Map(await Promise.all(paths.map(async path => [path, await loadImage(path)]))), badgeImages = await prepareFateBadgeImages();
  const canvas = document.createElement('canvas'); canvas.width = layout.width; canvas.height = layout.height;
  const ctx = canvas.getContext('2d'), accent = art?.color || art?.accent || '#a68abb', H = layout.hero, rightX = layout.rightX, rightWidth = layout.rightWidth;
  ctx.fillStyle = '#111316'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const glow = ctx.createRadialGradient(600, 620, 0, 760, 620, 1850); glow.addColorStop(0, `${accent}66`); glow.addColorStop(1, `${accent}00`); ctx.fillStyle = glow; ctx.fillRect(0, 0, canvas.width, canvas.height);
  rounded(ctx, 32, 32, canvas.width - 64, canvas.height - 64, 20, '#ffffff02', '#d4bc8038');
  ctx.save(); ctx.beginPath(); ctx.roundRect(H.x, H.y, H.width, H.height, 18); ctx.clip();
  cover(ctx, loaded.get(backgroundPath), H.x, H.y, H.width, H.height); ctx.fillStyle = '#10121638'; ctx.fillRect(H.x, H.y, H.width, H.height);
  if (loaded.get(renderPath)) { ctx.save(); ctx.shadowColor = '#090d13bb'; ctx.shadowBlur = 36; heroCover(ctx, loaded.get(renderPath), H.x - 30, H.y + 24, H.width + 60, H.height - 126); ctx.restore(); }
  const heroBottom = H.y + H.height, shade = ctx.createLinearGradient(0, heroBottom - 650, 0, heroBottom);
  shade.addColorStop(0, '#10121600'); shade.addColorStop(.45, '#101216bb'); shade.addColorStop(.8, '#101216f7'); shade.addColorStop(1, '#101216'); ctx.fillStyle = shade; ctx.fillRect(H.x, H.y, H.width, H.height);
  rounded(ctx, H.x + 30, H.y + 29, 280, 48, 6, '#111318bb'); text(ctx, 'DEADLOCK / CONTRACT', H.x + 47, H.y + 61, 22, '#decba2');
  text(ctx, article.heroName, H.x + 42, heroBottom - 331, 76, '#fff0d4', H.width - 84, true);
  text(ctx, ru ? 'ПОРЯДОК ОТКРЫТИЯ' : 'ABILITY UNLOCKS', H.x + 45, heroBottom - 282, 25, '#cdb585');
  (build.unlockOrder || []).forEach((slot, index) => {
    const ability = abilityBySlot.get(slot), x = H.x + 44 + index * 243, y = heroBottom - 258;
    rounded(ctx, x, y, 158, 158, 12, '#101216db', '#d6c09466');
    if (ability?.icon) ctx.drawImage(loaded.get(ability.icon), x + 25, y + 25, 108, 108);
    text(ctx, String(index + 1).padStart(2, '0'), x + 9, y + 24, 19, '#dec694');
    wrappedText(ctx, ru ? ability?.nameRu || ability?.name : ability?.name, x, heroBottom - 70, 222, 21, '#e8deca');
    text(ctx, ['0', '500', '1 400', '3 200'][index] + (ru ? ' душ' : ' souls'), x, heroBottom - 12, 19, '#b6aa94');
  });
  ctx.restore();
  text(ctx, ru ? 'КОНТРАКТ НА МАТЧ' : 'MATCH CONTRACT', rightX, 99, 27, '#d5ba87');
  text(ctx, article.contractName || article.heroName, rightX, 162, 54, '#f1e7d7', rightWidth, true);
  text(ctx, ru ? 'Соблюдай маршрут покупок. Отмечай раскачку в приложении.' : 'Follow the purchase route. Track upgrades in the app.', rightX, 209, 25, '#b5a999', rightWidth);
  text(ctx, `${inventory.length} / 12`, rightX + rightWidth - 122, 99, 28, '#dbc18f');
  for (let index = 0; index < 12; index++) {
    const col = Math.floor(index / 2), row = index % 2, x = rightX + col * layout.itemPitch, y = layout.itemTop + row * layout.itemRowPitch, size = layout.itemSize;
    const item = inventory[index], entry = build.history[index], color = item?.secret ? FATE_PRESENTATION.king.color : item ? CATEGORY[item.category] : '#716b77';
    rounded(ctx, x, y, size, size, 11, `${color}15`, `${color}${item ? '90' : '38'}`); text(ctx, String(index + 1).padStart(2, '0'), x + 12, y + 27, 18, color);
    if (item) {
      if (item.secret) drawSealed(ctx, x + 31, y + 33, size - 62, size - 62);
      else if (loaded.get(item.icon)) ctx.drawImage(loaded.get(item.icon), x + 31, y + 33, size - 62, size - 62);
      if (!item.secret) text(ctx, `T${item.tier}`, x + size - 42, y + 27, 18, color);
      wrappedText(ctx, item.name, x + 2, y + size + 28, size - 4, 21, item.secret ? FATE_PRESENTATION.king.brightColor : '#e6dcca');
      if (item.cursed) drawLock(ctx, x + size - 63, y + 33, 1.15);
      drawFateBadges(ctx, entry, x + 8, y + size - 36, 30, badgeImages, { language, sealed: item.secret });
      if (entry?.comboOrigin && !item.secret) text(ctx, '◇◇', x + 8, y + 58, 20, '#e0c899');
    } else text(ctx, '+', x + size / 2 - 12, y + size / 2 + 12, 40, '#69616b');
    if (index >= 9) text(ctx, 'FLEX', x + size - 50, y + size - 10, 15, '#a99bb7');
  }
  text(ctx, ru ? 'ПОРЯДОК ПОКУПОК' : 'PURCHASE ORDER', rightX, layout.purchaseHeading, 25, '#d9c59e');
  if (article.kingSummary) text(ctx, `♛ ${article.kingSummary}`, rightX + 465, layout.purchaseHeading, 19, FATE_PRESENTATION.king.brightColor, rightWidth - 650);
  text(ctx, `${purchasePlan.length} ${ru ? 'шагов' : 'steps'}`, rightX + rightWidth - 170, layout.purchaseHeading, 21, '#b4a2bb');
  const stepById = new Map(article.purchaseSteps.filter(item => !item.secret).map(item => [item.itemId, item.number]));
  if (!purchasePlan.length) text(ctx, ru ? 'Маршрут начнётся с первого предмета.' : 'The first item starts the route.', rightX, layout.purchaseTop + 20, 23, '#9e919f');
  article.purchaseSteps.forEach((item, index) => {
    const cell = rightWidth / layout.purchaseColumns, x = rightX + index % layout.purchaseColumns * cell, y = layout.purchaseTop + Math.floor(index / layout.purchaseColumns) * layout.purchaseRowPitch, w = cell - 12, height = layout.purchaseRowPitch - 9;
    const color = item.secret ? FATE_PRESENTATION.king.color : CATEGORY[item.category];
    rounded(ctx, x, y, w, height, 7, `${color}0a`, item.upgradeFrom.length ? '#d7b98380' : `${color}50`);
    if (layout.purchaseRowPitch < 62) { text(ctx, `${String(index + 1).padStart(2, '0')}  ${item.name}`, x + 9, y + height - 9, 17, item.secret ? FATE_PRESENTATION.king.brightColor : '#dfd5e7', w - 18); return; }
    text(ctx, String(index + 1).padStart(2, '0'), x + 8, y + 21, 15, '#d9c399');
    if (item.secret) drawSealed(ctx, x + 39, y + 12, 44, 44); else if (loaded.get(item.icon)) ctx.drawImage(loaded.get(item.icon), x + 39, y + 12, 44, 44);
    wrappedText(ctx, item.name, x + 93, y + 27, w - 107, layout.purchaseColumns === 4 ? 20 : 17);
    const parents = item.upgradeFromItemIds.map(id => stepById.get(id)).filter(Boolean);
    if (parents.length) text(ctx, `↗${parents.map(step => String(step).padStart(2, '0')).join('+')}`, x + 8, y + height - 8, 12, '#dfc590', 27);
    if (item.cursed) drawLock(ctx, x + 65, y + 11, .7);
    drawFateBadges(ctx, purchasePlan[index], x + w - 82, y + height - 20, 18, badgeImages, { language, sealed: item.secret });
  });
  text(ctx, ru ? 'РАСКАЧКА · 32 AP' : 'SKILL ORDER · 32 AP', rightX, layout.skillsHeading, 27, '#d6bd8d');
  const matrixLeft = rightX + 167, cell = (rightWidth - 167) / 12;
  (build.skillPlan || []).forEach((step, index) => {
    text(ctx, String(index + 1).padStart(2, '0'), matrixLeft + index * cell + 30, layout.skillsTop - 24, 21, '#c1ad8f');
    text(ctx, `${step.cost} AP`, matrixLeft + index * cell + 19, layout.skillsTop + 4 * layout.skillRowPitch + 35, 20, '#aa9b87');
  });
  abilities.forEach((ability, row) => {
    const y = layout.skillsTop + row * layout.skillRowPitch; rounded(ctx, rightX, y, rightWidth, 73, 8, row % 2 ? '#ffffff08' : '#ffffff03');
    if (ability.icon) ctx.drawImage(loaded.get(ability.icon), rightX + 14, y + 8, 57, 57);
    text(ctx, String(ability.slot), rightX + 99, y + 48, 29, '#dcc396');
    (build.skillPlan || []).forEach((step, index) => {
      if (step.slot !== ability.slot) return;
      const x = matrixLeft + index * cell + 43, cy = y + 36; ctx.save(); ctx.translate(x, cy); ctx.rotate(Math.PI / 4);
      rounded(ctx, -23, -23, 46, 46, 5, step.rank === 3 ? '#dac08c' : `${accent}90`, '#e2ca9660'); ctx.restore();
      text(ctx, step.rank, x - 8, cy + 9, 25, step.rank === 3 ? '#292621' : '#eee1ce');
    });
  });
  text(ctx, 'THE RANDOM CONTRACT ARCHIVE', rightX, layout.footerY, 21, '#796f64'); text(ctx, 'DEADLOCK ROULETTE', rightX + rightWidth - 330, layout.footerY, 21, '#a99572');
  return canvas.toDataURL('image/png');
}

let dialog;
/** Preview before saving; closing never alters the build. */
export async function showContractPoster(options) {
  const ru = options.language !== 'en', dataURL = await renderContractPoster(options);
  if (!dialog) {
    dialog = document.createElement('dialog'); dialog.id = 'contract-poster-dialog'; dialog.className = 'modal poster-modal';
    dialog.innerHTML = '<button class="modal-close" type="button">×</button><div class="poster-modal-heading"><h2></h2><p></p></div><img id="contract-poster-preview" alt=""><div class="modal-actions"><button class="secondary-button" data-poster-close></button><button class="primary-button" id="contract-poster-save"></button></div>';
    document.body.append(dialog); dialog.querySelector('.modal-close').onclick = () => dialog.close(); dialog.querySelector('[data-poster-close]').onclick = () => dialog.close();
    dialog.onclick = event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } };
  }
  dialog.querySelector('h2').textContent = ru ? 'Твой постер матча' : 'Your match poster';
  const layout = getContractPosterLayout(getBuildPurchasePlan(options.build, options.items).length);
  dialog.querySelector('p').textContent = ru ? `Один кадр: герой, маршрут покупок и каждый шаг раскачки. PNG · ${layout.width} × ${layout.height}.` : `One sheet: your hero, purchase route and every upgrade. PNG · ${layout.width} × ${layout.height}.`;
  const preview = dialog.querySelector('img'); preview.src = dataURL; preview.alt = ru ? 'Постер текущего билда' : 'Current build poster'; dialog.querySelector('[data-poster-close]').textContent = ru ? 'Закрыть' : 'Close';
  const save = dialog.querySelector('#contract-poster-save'); save.textContent = ru ? '↓ Сохранить PNG' : '↓ Save PNG'; save.disabled = false;
  save.onclick = async () => { save.disabled = true; try { await exportPNG(dataURL, options.build.name || options.hero.name, options.language); }
    catch { dialog.querySelector('p').textContent = ru ? 'Не удалось сохранить файл. Выбери другую папку и попробуй ещё раз.' : 'Could not save the file. Choose another folder and try again.'; } finally { save.disabled = false; } };
  if (!dialog.open) dialog.showModal(); save.focus(); return dataURL;
}
