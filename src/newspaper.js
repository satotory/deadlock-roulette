import { createNewspaperArticle, escapeNewspaperHTML, newspaperAssetPath } from './newspaper-core.js';
import { FATE_PRESENTATION, fateBadgeHTML, drawFateBadges, prepareFateBadgeImages } from './fate-presentation.js';
import { exportPNG } from './file-export.js';

const INK = '#28251f', MUTED = '#716352', PAPER = '#e9dec4', RED = '#803b32';
const imageCache = new Map();
const h = escapeNewspaperHTML;
const assetURL = path => new URL(`../${path}`, import.meta.url).href;
const lockSVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const UI = {
  ru: { title: 'Свежая полоса', subtitle: 'Твой контракт стал городской легендой. Газета берёт факты из билда, а слухи — из редакционного воображения.', close: 'Закрыть', save: '↓ Сохранить газету PNG', preparing: 'Набираем полосу…', ready: 'Личный выпуск · PNG', failed: 'Не удалось подготовить PNG. Закрой газету и открой её снова.', saveFailed: 'Не удалось сохранить газету. Выбери другую папку и попробуй ещё раз.', saved: 'Газета сохранена', items: 'ВЕЩЕСТВЕННЫЕ ДОКАЗАТЕЛЬСТВА', route: 'ХРОНИКА ЗАКУПОК', review: 'СЛОВО ВЛАДЕЛЬЦА', editor: 'Из редакции', classified: 'Содержимое под печатью', slot: 'Слот', step: 'Шаг', allLocked: 'ПОЛНЫЙ ЗАПРЕТ ИЗМЕНЕНИЙ', signature: 'RANDOM / PRIVATE ARCHIVE' },
  en: { title: 'Fresh off the press', subtitle: 'Your contract became a city legend. The paper takes its facts from the build, and its rumours from editorial imagination.', close: 'Close', save: '↓ Save newspaper PNG', preparing: 'Setting the type…', ready: 'Private edition · PNG', failed: 'Could not prepare the PNG. Close the newspaper and open it again.', saveFailed: 'Could not save the newspaper. Choose another folder and try again.', saved: 'Newspaper saved', items: 'MATERIAL EVIDENCE', route: 'PURCHASE CHRONICLE', review: 'THE OWNER SPEAKS', editor: 'From the newsroom', classified: 'Contents under seal', slot: 'Slot', step: 'Step', allLocked: 'NO INVENTORY ALTERATIONS', signature: 'RANDOM / PRIVATE ARCHIVE' },
};

function safeArt({ hero, art } = {}) {
  const portrait = newspaperAssetPath(art?.image) || newspaperAssetPath(hero?.portrait);
  return { portrait, background: newspaperAssetPath(art?.background) || portrait, render: newspaperAssetPath(art?.render) };
}
function imageMarkup(path, alt, className = '') {
  const safe = newspaperAssetPath(path);
  return safe ? `<img class="${h(className)}" src="${h(assetURL(safe))}" alt="${h(alt)}" loading="eager" decoding="async">` : '';
}
function itemMarkup(item, article, route = false) {
  const copy = UI[article.language];
  const badges = [item.cursed ? `<span class="gazette-lock" title="${h(article.labels.lock)}">${lockSVG}</span>` : '', item.pair ? `<span class="gazette-pair" title="${h(article.labels.pair)}">◇◇</span>` : ''].join('');
  const details = item.secret ? copy.classified : [item.tier ? `T${item.tier}` : '', item.cost !== null ? `${Number(item.cost).toLocaleString(article.language === 'ru' ? 'ru-RU' : 'en-US')} ${article.labels.price}` : ''].filter(Boolean).join(' · ');
  return `<li class="gazette-item${item.secret ? ' is-secret' : ''}${item.component ? ' is-component' : ''}${item.upgradeFrom.length ? ' is-upgrade' : ''}" data-newspaper-${route ? 'step' : 'slot'}="${item.number}">
    <span class="gazette-item-number">${String(item.number).padStart(2, '0')}</span>
    <span class="gazette-item-art">${item.secret ? `<span class="gazette-parcel">${lockSVG}</span>` : imageMarkup(item.icon, item.name)}${badges}${fateBadgeHTML(item, article.language, { sealed: item.secret, compact: route })}</span>
    <span class="gazette-item-text"><strong>${h(item.name)}</strong><small>${h(details)}</small>${route && item.upgradeFrom.length ? `<small class="gazette-recipe">↗ ${h(item.upgradeFrom.join(' + '))}</small>` : route && item.component ? `<small class="gazette-recipe">${h(article.labels.component)}</small>` : ''}</span>
  </li>`;
}
function factsMarkup(facts) {
  return `<dl>${facts.map(fact => `<div><dt>${h(fact.label)}</dt><dd>${h(fact.value)}</dd></div>`).join('')}</dl>`;
}
function journalMarkup(article) {
  if (!article.journal.length) return '';
  return `<section class="gazette-journal"><h4 class="gazette-section-heading"><span>${h(article.labels.journal)}</span><small>${article.journal.length}</small></h4>${article.journal.map(event => `<article class="gazette-journal-event" data-newspaper-event-kind="${event.kind}"><header><h5>${h(event.title)}</h5><p>${h(event.detail)}</p></header>${event.entries.length ? `<ol class="gazette-journal-items">${event.entries.map(entry => itemMarkup(entry, article, true)).join('')}</ol>` : ''}</article>`).join('')}</section>`;
}

/** Only the already masked article is allowed into paper text, attributes or item images. */
export function renderNewspaperMarkup(article, options = {}) {
  const copy = UI[article.language], art = safeArt(options);
  const photo = `${imageMarkup(art.background, article.labels.photo, 'gazette-photo-background')}${art.render ? imageMarkup(art.render, article.heroName, 'gazette-photo-render') : ''}`;
  return `<article class="gazette-paper" lang="${article.language}" data-newspaper-topic="${h(article.topic)}">
    <div class="gazette-edition"><span>${h(article.edition)}</span><span>${h(article.issueLabel)} № ${h(article.issue)}</span><span>${h(article.personal)}</span></div>
    <header class="gazette-masthead"><span aria-hidden="true">✦</span><h2>${h(article.masthead)}</h2><span aria-hidden="true">✦</span></header>
    <div class="gazette-underhead"><span>${h(article.subtitle)}</span><span>DEADLOCK / 01</span></div>
    <div class="gazette-headline-block"><p class="gazette-kicker">${h(article.kicker)}</p><h3 class="gazette-headline">${h(article.headline)}</h3><p class="gazette-lede">${h(article.lede)}</p></div>
    <div class="gazette-feature">
      <figure class="gazette-photo">${photo || '<span class="gazette-photo-empty">✦</span>'}<span class="gazette-halftone" aria-hidden="true"></span><figcaption><span>${h(article.labels.photo)}</span><strong>${h(article.heroName)}</strong>${article.contractName ? `<small>${h(article.contractName)}</small>` : ''}</figcaption></figure>
      <div class="gazette-report">
        <div class="gazette-columns">${article.columns.map(column => `<section><h4>${h(column.title)}</h4><p>${h(column.body)}</p></section>`).join('')}</div>
        <div class="gazette-records"><section><h4>${h(article.labels.facts)}</h4>${factsMarkup(article.facts)}</section><section class="gazette-fate"><h4>${h(article.labels.fate)}</h4>${factsMarkup(article.fateFacts)}</section></div>
        ${article.traits.totalLocked ? `<p class="gazette-red-stamp">${h(copy.allLocked)}</p>` : ''}
      </div>
    </div>
    <section class="gazette-evidence"><h4 class="gazette-section-heading"><span>${h(copy.items)}</span><small>${article.itemStrip.length} / 12</small></h4><ol class="gazette-items">${article.itemStrip.map(item => itemMarkup(item, article)).join('')}</ol></section>
    <section class="gazette-route"><h4 class="gazette-section-heading"><span>${h(copy.route)}</span><small>${article.purchaseSteps.length}</small></h4>${article.purchaseSteps.length ? `<ol class="gazette-purchases">${article.purchaseSteps.map(item => itemMarkup(item, article, true)).join('')}</ol>` : `<p class="gazette-empty">${h(article.labels.routeEmpty)}</p>`}</section>
    ${journalMarkup(article)}
    <section class="gazette-review"><div><h4>${h(copy.review)}</h4><p>${h(article.review.title)}</p><div class="gazette-stars" aria-label="${article.review.rating} / 5">${h(article.review.stars)}</div></div><blockquote>${h(article.review.text)}</blockquote><span class="gazette-review-stamp">${h(copy.editor)}<br>✦ ${h(article.issue.slice(-4))} ✦</span></section>
    <footer class="gazette-footer"><span>${h(article.footer)}</span><strong>${h(copy.signature)}</strong></footer>
  </article>`;
}

function loadImage(path) {
  if (!imageCache.has(path)) imageCache.set(path, new Promise(resolve => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = assetURL(path);
  }));
  return imageCache.get(path);
}
function font(ctx, size, { bold = false, serif = true, italic = false } = {}) {
  ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${serif ? 'Georgia, "Times New Roman"' : '"Segoe UI"'}, serif`;
}
function linesFor(ctx, value, width, size, options = {}) {
  font(ctx, size, options);
  const result = [];
  for (const paragraph of String(value ?? '').split('\n')) {
    let line = '';
    for (const original of paragraph.split(/\s+/)) {
      let word = original;
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > width) { result.push(line); line = ''; }
      while (ctx.measureText(word).width > width && word.length > 1) {
        let end = 1;
        while (end < word.length && ctx.measureText(word.slice(0, end + 1)).width <= width) end++;
        result.push(word.slice(0, end)); word = word.slice(end);
      }
      line = line ? `${line} ${word}` : word;
    }
    result.push(line);
  }
  return result;
}
function paragraph(ctx, value, x, y, width, size, options = {}) {
  const lines = linesFor(ctx, value, width, size, options);
  const maximum = options.maxLines || lines.length;
  lines.slice(0, maximum).forEach((line, index) => {
    if (index === maximum - 1 && lines.length > maximum) line = clip(ctx, `${line}…`, width);
    ctx.fillStyle = options.color || INK; ctx.fillText(line, x, y + index * (options.lineHeight || size * 1.34));
  });
  return Math.min(maximum, lines.length) * (options.lineHeight || size * 1.34);
}
function clip(ctx, value, width) {
  const source = String(value ?? ''); let text = source;
  while (text.length && ctx.measureText(text + (text === source ? '' : '…')).width > width) text = text.slice(0, -1);
  return text + (text === source ? '' : '…');
}
function write(ctx, value, x, y, size = 24, options = {}) {
  font(ctx, size, options); ctx.fillStyle = options.color || INK;
  ctx.fillText(options.width ? clip(ctx, value, options.width) : String(value ?? ''), x, y);
}
function rule(ctx, x, y, width, heavy = false) {
  ctx.fillStyle = INK; ctx.fillRect(x, y, width, heavy ? 3 : 1);
  if (heavy) ctx.fillRect(x, y + 7, width, 1);
}
function cover(ctx, image, x, y, width, height) {
  if (!image) return;
  const scale = Math.max(width / image.width, height / image.height);
  ctx.drawImage(image, x + (width - image.width * scale) / 2, y + (height - image.height * scale) / 2, image.width * scale, image.height * scale);
}
function contain(ctx, image, x, y, width, height) {
  if (!image) return;
  const scale = Math.min(width / image.width, height / image.height);
  ctx.drawImage(image, x + (width - image.width * scale) / 2, y + (height - image.height * scale) / 2, image.width * scale, image.height * scale);
}
function drawLock(ctx, x, y, size = 28) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 24, size / 24); ctx.strokeStyle = RED; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.rect(5, 10, 14, 11); ctx.stroke(); ctx.beginPath(); ctx.arc(12, 7, 5, Math.PI, 0); ctx.lineTo(17, 10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(12, 14); ctx.lineTo(12, 18); ctx.stroke(); ctx.restore();
}
function drawItem(ctx, item, x, y, width, height, loaded, article, small = false, badgeImages) {
  ctx.strokeStyle = item.upgradeFrom.length ? '#927548' : '#86796366'; ctx.lineWidth = 1; ctx.strokeRect(x, y, width, height);
  const pictureSize = small ? 45 : 70, px = x + (small ? 32 : 16), py = y + (small ? 12 : 24);
  write(ctx, String(item.number).padStart(2, '0'), x + 9, y + 18, small ? 14 : 16, { serif: false, color: MUTED });
  if (item.secret) { ctx.fillStyle = '#b9a88744'; ctx.fillRect(px, py, pictureSize, pictureSize); drawLock(ctx, px + pictureSize / 2 - 16, py + pictureSize / 2 - 17, 32); }
  else { ctx.save(); ctx.filter = 'grayscale(1) sepia(.38) contrast(1.15)'; contain(ctx, loaded.get(item.icon), px, py, pictureSize, pictureSize); ctx.restore(); }
  if (item.cursed) { ctx.fillStyle = PAPER; ctx.fillRect(px + pictureSize - 23, py - 2, 25, 29); drawLock(ctx, px + pictureSize - 23, py - 2, 25); }
  if (item.pair && !small) write(ctx, '◇◇', x + width - 46, y + 20, 16, { color: RED });
  if (badgeImages) drawFateBadges(ctx, item, x + 7, y + height - (small ? 18 : 23), small ? 15 : 20, badgeImages, { language: article.language, sealed: item.secret });
  const tx = small ? x + 89 : x + 101, ty = y + (small ? 28 : 47), tw = width - (small ? 99 : 111);
  let nameSize = 17;
  font(ctx, nameSize, { bold: true });
  const longestWord = String(item.name).split(/\s+/).reduce((longest, word) => ctx.measureText(word).width > ctx.measureText(longest).width ? word : longest, '');
  while (nameSize > 12 && ctx.measureText(longestWord).width > tw) font(ctx, --nameSize, { bold: true });
  paragraph(ctx, item.name, tx, ty, tw, nameSize, { bold: true, maxLines: 2, lineHeight: small ? 20 : 22 });
  if (item.secret) write(ctx, UI[article.language].classified, tx, y + height - 13, small ? 11 : 14, { color: MUTED, width: tw });
  else {
    const meta = [item.tier ? `T${item.tier}` : '', !small && item.cost !== null ? `${item.cost.toLocaleString(article.language === 'ru' ? 'ru-RU' : 'en-US')} ${article.labels.price}` : ''].filter(Boolean).join(' · ');
    write(ctx, meta, tx, y + height - 13, small ? 13 : 15, { color: MUTED, width: tw });
    if (small && item.upgradeFrom.length) write(ctx, `↗ ${item.upgradeFrom.join(' + ')}`, x + 8, y + height - 5, 11, { color: RED, width: width - 16 });
  }
}
function drawFacts(ctx, facts, x, y, width, heading) {
  write(ctx, heading, x, y, 28, { bold: true }); rule(ctx, x, y + 13, width);
  facts.forEach((fact, index) => {
    const lineY = y + 52 + index * 37;
    write(ctx, fact.label, x, lineY, 21, { color: MUTED, width: width * .61 });
    let valueSize = /^[\d /]+$/.test(String(fact.value)) ? 20 : 17;
    font(ctx, valueSize, { bold: true });
    while (valueSize > 13 && ctx.measureText(String(fact.value)).width > width * .37) font(ctx, --valueSize, { bold: true });
    const value = clip(ctx, fact.value, width * .37);
    write(ctx, value, x + width - ctx.measureText(value).width, lineY, valueSize, { bold: true });
    rule(ctx, x, lineY + 10, width);
  });
}

/** A private, deterministic print. Hidden item paths are never requested by the renderer. */
export async function renderNewspaperPNG(options, preparedArticle) {
  const article = preparedArticle || createNewspaperArticle(options), copy = UI[article.language], art = safeArt(options);
  const paths = [...new Set([art.background, art.render, ...article.itemStrip.map(item => item.icon), ...article.purchaseSteps.map(item => item.icon), ...article.journal.flatMap(event => event.entries.map(item => item.icon))].filter(Boolean))];
  const loaded = new Map(await Promise.all(paths.map(async path => [path, await loadImage(path)])));
  const badgeImages = await prepareFateBadgeImages({ print: true });
  await document.fonts?.ready;
  const canvas = document.createElement('canvas'); canvas.width = 1800;
  const ctx = canvas.getContext('2d'), left = 65, width = 1670;
  const headlineLines = linesFor(ctx, article.headline, width - 14, 73, { bold: true }).length;
  const ledeLines = linesFor(ctx, article.lede, width, 26).length;
  const commentLines = linesFor(ctx, article.review.text, 1190, 26, { italic: true }).length;
  const featureY = 430 + headlineLines * 86 + ledeLines * 35;
  const itemY = featureY + Math.max(615, article.fateFacts.length * 37 + 382);
  const itemRows = Math.ceil(article.itemStrip.length / 6), itemHeight = itemRows * 132;
  const routeY = itemY + 80 + itemHeight;
  const routeColumns = article.purchaseSteps.length > 240 ? 8 : 6;
  const routeRows = Math.ceil(article.purchaseSteps.length / routeColumns);
  const reviewHeight = Math.max(195, commentLines * 36 + 90);
  const journalColumns = article.journal.length > 3 ? 4 : 3, journalRows = Math.ceil(article.journal.length / journalColumns);
  const journalCardHeight = journalRows ? Math.min(244, Math.max(108, Math.floor((4096 - routeY - reviewHeight - 320 - routeRows * 18) / journalRows))) : 0;
  const journalHeight = journalRows ? 74 + journalRows * journalCardHeight : 0;
  // Imported routes are bounded by the same 4096px trusted export limit as match posters.
  const routeRowHeight = routeRows ? Math.min(90, Math.max(18, Math.floor((4096 - routeY - reviewHeight - journalHeight - 230) / routeRows))) : 0;
  const routeHeight = routeRows ? routeRows * routeRowHeight : 48;
  const journalY = routeY + 90 + routeHeight, reviewY = journalY + journalHeight;
  canvas.height = Math.min(4096, Math.ceil(reviewY + reviewHeight + 95));
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const stain = ctx.createRadialGradient(175, 180, 15, 950, canvas.height / 2, canvas.height);
  stain.addColorStop(0, '#fff6d958'); stain.addColorStop(1, '#96764930'); ctx.fillStyle = stain; ctx.fillRect(0, 0, 1800, canvas.height);
  let noise = article.seed || 1;
  ctx.fillStyle = '#4734210b';
  for (let index = 0; index < 13000; index++) { noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0; const x = noise % 1800; noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0; ctx.fillRect(x, noise % canvas.height, 1 + (noise % 2), 1); }
  ctx.strokeStyle = '#5b4b36'; ctx.lineWidth = 2; ctx.strokeRect(28, 28, 1744, canvas.height - 56); ctx.lineWidth = 1; ctx.strokeRect(36, 36, 1728, canvas.height - 72);
  write(ctx, article.edition.toUpperCase(), left, 78, 18, { serif: false });
  write(ctx, `${article.issueLabel} № ${article.issue}`, 776, 78, 18, { serif: false });
  font(ctx, 18, { serif: false }); write(ctx, article.personal.toUpperCase(), 1735 - ctx.measureText(article.personal.toUpperCase()).width, 78, 18, { serif: false });
  rule(ctx, left, 95, width, true);
  let mastheadSize = article.language === 'ru' ? 89 : 85;
  font(ctx, mastheadSize, { bold: true }); while (ctx.measureText(article.masthead).width > width - 135) font(ctx, --mastheadSize, { bold: true });
  ctx.fillStyle = INK; ctx.fillText(article.masthead, 900 - ctx.measureText(article.masthead).width / 2, 194);
  write(ctx, '✦', left + 5, 184, 48); write(ctx, '✦', 1679, 184, 48);
  rule(ctx, left, 212, width, true);
  write(ctx, article.subtitle, left, 247, 22); write(ctx, 'DEADLOCK / 01', 1536, 247, 18, { serif: false });
  write(ctx, article.kicker, left, 293, 20, { color: RED, serif: false, bold: true });
  paragraph(ctx, article.headline, left, 372, width - 14, 73, { bold: true, lineHeight: 86 });
  paragraph(ctx, article.lede, left, 385 + headlineLines * 86, width, 26, { lineHeight: 35 });
  rule(ctx, left, featureY - 20, width);
  const photoW = 570, photoH = 555;
  ctx.save(); ctx.beginPath(); ctx.rect(left, featureY, photoW, photoH); ctx.clip(); ctx.fillStyle = '#6b6255'; ctx.fillRect(left, featureY, photoW, photoH);
  ctx.filter = 'grayscale(1) sepia(.4) contrast(1.28)'; cover(ctx, loaded.get(art.background), left, featureY, photoW, photoH);
  if (art.render) contain(ctx, loaded.get(art.render), left - 30, featureY - 10, photoW + 60, photoH + 30);
  ctx.filter = 'none'; ctx.globalAlpha = .2; ctx.fillStyle = INK;
  for (let y = featureY; y < featureY + photoH; y += 5) for (let x = left; x < left + photoW; x += 5) { ctx.beginPath(); ctx.arc(x, y, .7, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
  const shade = ctx.createLinearGradient(0, featureY + 310, 0, featureY + photoH); shade.addColorStop(0, '#1c171000'); shade.addColorStop(1, '#1c1710ed'); ctx.fillStyle = shade; ctx.fillRect(left, featureY, photoW, photoH);
  write(ctx, article.labels.photo.toUpperCase(), left + 25, featureY + photoH - 123, 16, { color: '#e9dec4', serif: false });
  write(ctx, article.heroName, left + 25, featureY + photoH - 56, 59, { bold: true, color: '#f5ecd8', width: photoW - 50 });
  if (article.contractName) write(ctx, article.contractName, left + 25, featureY + photoH - 24, 21, { color: '#e9dec4', width: photoW - 50 });
  ctx.restore(); ctx.strokeStyle = INK; ctx.strokeRect(left, featureY, photoW, photoH);
  const rightX = 680, columnW = 498;
  article.columns.forEach((column, index) => {
    const x = rightX + index * 556; write(ctx, column.title, x, featureY + 30, 28, { bold: true }); rule(ctx, x, featureY + 45, columnW);
    paragraph(ctx, column.body, x, featureY + 81, columnW, 24, { lineHeight: 32, maxLines: 7, italic: index === 1 });
  });
  drawFacts(ctx, article.facts, rightX, featureY + 300, columnW, article.labels.facts);
  drawFacts(ctx, article.fateFacts, rightX + 556, featureY + 300, columnW, article.labels.fate);
  if (article.traits.totalLocked) { ctx.save(); ctx.translate(left + 290, featureY + 290); ctx.rotate(-.13); ctx.strokeStyle = RED; ctx.lineWidth = 4; ctx.strokeRect(-224, -29, 448, 56); write(ctx, copy.allLocked, -210, 9, 20, { bold: true, serif: false, color: RED, width: 420 }); ctx.restore(); }
  rule(ctx, left, itemY, width, true); write(ctx, copy.items, left, itemY + 44, 25, { bold: true }); write(ctx, `${article.itemStrip.length} / 12`, 1635, itemY + 44, 23);
  article.itemStrip.forEach((item, index) => drawItem(ctx, item, left + index % 6 * 280, itemY + 66 + Math.floor(index / 6) * 132, 270, 118, loaded, article, false, badgeImages));
  rule(ctx, left, routeY, width, true); write(ctx, copy.route, left, routeY + 43, 25, { bold: true }); write(ctx, article.purchaseSteps.length, 1660, routeY + 43, 23);
  if (!routeRows) paragraph(ctx, article.labels.routeEmpty, left, routeY + 81, width, 24, { color: MUTED });
  article.purchaseSteps.forEach((item, index) => {
    const stepWidth = 1680 / routeColumns;
    const x = left + index % routeColumns * stepWidth, y = routeY + 65 + Math.floor(index / routeColumns) * routeRowHeight;
    if (routeRowHeight >= 70) drawItem(ctx, item, x, y, stepWidth - 10, routeRowHeight - 8, loaded, article, true, badgeImages);
    else { write(ctx, `${String(item.number).padStart(2, '0')}  ${item.secret ? '◆ ' : ''}${item.name}`, x + 3, y + routeRowHeight - 7, Math.max(11, Math.min(17, routeRowHeight - 8)), { width: stepWidth - 17, color: item.secret ? RED : INK }); }
  });
  if (journalRows) {
    rule(ctx, left, journalY, width, true); write(ctx, article.labels.journal.toUpperCase(), left, journalY + 43, 25, { bold: true });
    article.journal.forEach((event, index) => {
      const cardWidth = width / journalColumns, x = left + index % journalColumns * cardWidth, y = journalY + 65 + Math.floor(index / journalColumns) * journalCardHeight;
      const eventColor = FATE_PRESENTATION[event.kind].printColor;
      ctx.strokeStyle = '#86796366'; ctx.strokeRect(x, y, cardWidth - 12, journalCardHeight - 12);
      const glyph = badgeImages.get(event.kind); if (glyph) ctx.drawImage(glyph, x + 10, y + 12, 27, 27);
      write(ctx, event.title, x + 45, y + 28, journalColumns === 3 ? 22 : 18, { bold: true, color: eventColor, width: cardWidth - 65 });
      write(ctx, event.detail, x + 12, y + 54, 17, { color: MUTED, width: cardWidth - 35 });
      const entryColumns = 6, entryWidth = (cardWidth - 28) / entryColumns, entryRows = Math.ceil(event.entries.length / entryColumns), entryHeight = entryRows ? Math.min(78, (journalCardHeight - 76) / entryRows) : 0;
      event.entries.forEach((item, itemIndex) => {
        const ex = x + 12 + itemIndex % entryColumns * entryWidth, ey = y + 70 + Math.floor(itemIndex / entryColumns) * entryHeight, picture = Math.min(33, entryHeight - 25);
        if (entryHeight < 56) { write(ctx, item.name, ex, ey + Math.min(14, entryHeight - 2), 10, { width: entryWidth - 7, color: item.secret ? eventColor : INK }); return; }
        if (item.secret) drawLock(ctx, ex + 2, ey + 1, Math.max(16, picture));
        else if (loaded.get(item.icon) && picture > 0) { ctx.save(); ctx.filter = 'grayscale(1) sepia(.3)'; contain(ctx, loaded.get(item.icon), ex, ey, picture, picture); ctx.restore(); }
        paragraph(ctx, item.name, ex, ey + Math.max(18, picture) + 13, entryWidth - 7, journalColumns === 3 ? 12 : 10, { maxLines: 2, lineHeight: 13, color: item.secret ? eventColor : INK });
      });
    });
  }
  rule(ctx, left, reviewY, width, true); write(ctx, copy.review, left, reviewY + 43, 24, { bold: true });
  write(ctx, article.review.title, left, reviewY + 79, 21, { color: MUTED });
  write(ctx, article.review.stars, left, reviewY + 139, 47, { color: RED });
  paragraph(ctx, article.review.text, 500, reviewY + 78, 1190, 26, { italic: true, lineHeight: 36 });
  rule(ctx, left, canvas.height - 90, width);
  write(ctx, article.footer, left, canvas.height - 54, 19, { width: 1180 });
  write(ctx, copy.signature, 1305, canvas.height - 54, 17, { serif: false, bold: true, width: 430 });
  return canvas.toDataURL('image/png');
}

let dialog, generation = 0;
/** Opens a read-only newspaper; export uses the native save dialog or a browser download. */
export async function showBuildNewspaper(options) {
  const article = createNewspaperArticle(options), copy = UI[article.language], token = ++generation;
  if (!dialog) {
    dialog = document.createElement('dialog'); dialog.id = 'build-newspaper-dialog'; dialog.className = 'modal gazette-modal';
    dialog.innerHTML = '<div class="gazette-modal-toolbar"><div><h2></h2><p></p></div><button class="secondary-button" data-newspaper-close type="button"></button></div><div id="build-newspaper-paper"></div><div class="gazette-modal-actions"><p id="build-newspaper-status" role="status"></p><button class="primary-button" id="build-newspaper-save" type="button"></button></div>';
    document.body.append(dialog);
    dialog.querySelector('[data-newspaper-close]').onclick = () => dialog.close();
    dialog.onclick = event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } };
  }
  dialog.querySelector('h2').textContent = copy.title;
  dialog.querySelector('.gazette-modal-toolbar p').textContent = copy.subtitle;
  dialog.querySelector('[data-newspaper-close]').textContent = copy.close;
  dialog.querySelector('#build-newspaper-paper').innerHTML = renderNewspaperMarkup(article, options);
  const save = dialog.querySelector('#build-newspaper-save'), status = dialog.querySelector('#build-newspaper-status');
  save.textContent = copy.save; save.disabled = true; status.textContent = copy.preparing;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0; dialog.querySelector('[data-newspaper-close]').focus({ preventScroll: true });
  try {
    const dataURL = await renderNewspaperPNG(options, article);
    if (token !== generation) return dataURL;
    save.disabled = false; status.textContent = `${copy.ready} · 1800 px`;
    save.onclick = async () => {
      save.disabled = true;
      try {
        const name = await exportPNG(dataURL, `gazette-${article.heroName}-${article.issue}`, article.language);
        if (token === generation && name) status.textContent = `${copy.saved}: ${name}`;
      } catch { if (token === generation) status.textContent = copy.saveFailed; }
      finally { if (token === generation) save.disabled = false; }
    };
    return dataURL;
  } catch (error) { if (token === generation) status.textContent = copy.failed; throw error; }
}
