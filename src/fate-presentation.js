// Actual Valve Panorama team icon paths from the user's local game. See docs/fate-presentation-sources.md.
export const ARCHMOTHER_SVG = "<svg viewBox=\"0 0 458 599\" fill=\"none\" aria-hidden=\"true\">\n<path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M231.331 0C241.577 0 249.884 8.29512 249.884 18.5277V23.1505C249.549 24.2964 249.368 25.5083 249.368 26.7622V279.974C249.368 287.08 255.137 292.84 262.252 292.84C269.368 292.84 275.136 287.08 275.136 279.974V43.576C277.063 35.6976 284.176 29.8501 292.659 29.8501C302.62 29.8501 310.696 37.9148 310.696 47.8632V316.878L320.65 332.287C321.061 331.962 321.481 331.373 321.89 330.458C322.411 329.292 322.872 327.699 323.291 325.729C324.128 321.792 324.774 316.453 325.42 310.253C326.709 297.875 327.992 282.112 330.804 267.525C333.329 254.426 337.279 242.374 342.129 233.533C344.554 229.113 347.214 225.475 350.054 222.911C352.893 220.347 355.94 218.833 359.123 218.73C361.132 218.556 364.097 219.106 366.569 221.305C369.066 223.527 370.993 227.37 370.993 233.655V358.705L371 359.486C370.989 363.546 370.258 369.85 368.095 376.552C365.788 383.702 361.84 391.34 355.362 397.183C347.36 404.401 330.143 418.772 315.752 438.724C301.363 458.674 289.841 484.152 293.171 513.57L293.213 513.949L292.864 514.101C269.511 524.218 215.544 551.738 186.344 580.898C179.008 588.223 173.026 592.93 168.168 595.701C163.318 598.469 159.536 599.336 156.628 598.889C153.69 598.436 151.736 596.657 150.533 594.365C149.339 592.089 148.874 589.292 148.874 586.71V502.306C148.874 494.205 145.836 478.093 127.412 462.556C115.797 452.761 105.561 442.547 98.2367 428.889C90.9096 415.226 86.5154 398.155 86.5154 374.671V270.942C86.1793 269.547 86 268.091 86 266.593V106.019C86 95.7869 94.3064 87.4918 104.553 87.4918C113.299 87.4918 120.63 93.5356 122.59 101.669V283.062C122.59 290.168 128.359 295.928 135.474 295.928C142.59 295.928 148.358 290.168 148.358 283.062V35.7928C150.318 27.6594 157.65 21.6156 166.396 21.6156C175.142 21.6156 182.473 27.6594 184.433 35.7928V281.518C184.433 289.476 190.894 295.928 198.863 295.928C206.833 295.928 213.293 289.476 213.293 281.518V28.3062C213.293 26.9808 213.114 25.6974 212.778 24.4784V18.5277C212.778 8.29512 221.084 0 231.331 0ZM215.803 339.674C205.024 339.674 196.287 348.779 196.287 360.011C196.287 367.893 200.59 374.728 206.883 378.103L197.023 428.233C196.398 431.413 198.836 434.371 202.08 434.371H230.489C233.768 434.371 236.213 431.355 235.53 428.153L224.841 378.037C231.068 374.64 235.318 367.843 235.318 360.011C235.318 348.779 226.581 339.674 215.803 339.674Z\" fill=\"currentColor\"/>\n</svg>";
export const KING_SVG = "<svg viewBox=\"0 0 458 599\" fill=\"none\" aria-hidden=\"true\">\n<path d=\"M0 167L120.746 328.984L237 107L333.827 328.984L458 107L438 492H0V167Z\" fill=\"currentColor\"/>\n</svg>";

// Compact app glyphs use the same currentColor contract as the original team marks.
export const CHICKEN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c-2-4-1-8 3-10 0-3 1-5 4-5 1-3 2-3 3-1 2-2 3-1 3 1 3 0 3 2 1 3 2 1 3 3 2 5l-3 1c0 4-3 7-7 7H5Z" fill="currentColor"/><circle cx="16" cy="8" r="1" fill="var(--fate-badge-backdrop,#17212c)"/><path d="m5 11-3-2 1 6m6 5-1 3m6-3 1 3M20 10l3 1-3 1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
export const CURSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';

const presentation = (color, brightColor, darkColor, glowColor, printColor, svg, ru, en) => Object.freeze({ color, brightColor, darkColor, glowColor, printColor, svg, label: Object.freeze({ ru, en }) });
/** Exact team colours from Valve's local Panorama definitions, with material glow tints. */
export const FATE_PRESENTATION = Object.freeze({
  archmother: presentation('#4D75C3', '#BDCBFF', '#243265', '#84ADF6', '#4156A0', ARCHMOTHER_SVG, 'Дар Архиматери', 'Archmother’s gift'),
  king: presentation('#D4860B', '#FBDCA0', '#6F3806', '#FFC21A', '#6F3806', KING_SVG, 'Печать Короля', 'The King’s seal'),
  chicken: presentation('#DBA34F', '#FFE3A5', '#5B361F', '#F5C978', '#80501F', CHICKEN_SVG, 'Куриная перекрутка', 'Chicken reroll'),
  curse: presentation('#C87CDC', '#F2C2FA', '#572761', '#D899EA', '#71366D', CURSE_SVG, 'Проклятый предмет', 'Cursed item'),
  impostor: presentation('#D06A63', '#FFBCAB', '#69332E', '#EF9386', '#803B32', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 10 18H2L12 2Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v5m0 3v1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>', 'Самозванец', 'Impostor'),
});
export const FATE_COLORS = Object.freeze(Object.fromEntries(Object.entries(FATE_PRESENTATION).map(([kind, value]) => [kind, value.color])));
export const FATE_ICONS = Object.freeze(Object.fromEntries(Object.entries(FATE_PRESENTATION).map(([kind, value]) => [kind, value.svg])));

/** Origins are explicit persisted booleans. A build-wide event cannot relabel old purchases. */
export function getEntryFateBadges(entry, { language = 'ru', sealed = entry?.sealed === true, includeCurse = false } = {}) {
  const lang = language === 'en' ? 'en' : 'ru';
  const kinds = [entry?.archmotherOrigin === true ? 'archmother' : null, entry?.chickenOrigin === true ? 'chicken' : null, entry?.kingOrigin === true || entry?.sealed === true ? 'king' : null, !sealed && entry?.kingImpostor === true ? 'impostor' : null, includeCurse && (entry?.cursed === true || entry?.locked === true) ? 'curse' : null].filter(Boolean);
  return kinds.map(kind => {
    const value = FATE_PRESENTATION[kind];
    const label = kind === 'king' && !sealed ? `${value.label[lang]} · ${lang === 'ru' ? 'раскрыто' : 'revealed'}` : value.label[lang];
    return { kind, label, svg: value.svg, color: value.color, brightColor: value.brightColor, printColor: value.printColor };
  });
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
/** Source marks stay public on a sealed parcel. No item identity enters attributes or SVG. */
export function fateBadgeHTML(entry, language = 'ru', options = {}) {
  const badges = getEntryFateBadges(entry, { ...options, language });
  if (!badges.length) return '';
  return `<span class="fate-badges${options.compact ? ' is-compact' : ''}">${badges.map(badge => `<span class="fate-badge" data-fate-origin="${badge.kind}" title="${escape(badge.label)}" aria-label="${escape(badge.label)}" role="img">${badge.svg}</span>`).join('')}</span>`;
}
export const fateBadgesHTML = fateBadgeHTML;

const badgeImageCache = new Map();
/** Inline SVG has an implicit namespace; standalone Image documents need an explicit one. */
export function createFateBadgeSVG(kind, { print = false } = {}) {
  const value = FATE_PRESENTATION[kind];
  if (!value) return null;
  return value.svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" ')
    .replaceAll('currentColor', print ? value.printColor : value.brightColor)
    .replaceAll('var(--fate-badge-backdrop,#17212c)', print ? '#e9dec4' : '#17212c');
}
/** Rasterise only controlled local SVG constants for private canvas exports. */
export async function prepareFateBadgeImages({ print = false } = {}) {
  const loaded = await Promise.all(Object.entries(FATE_PRESENTATION).map(async ([kind, value]) => {
    const key = `${kind}:${print}`;
    if (!badgeImageCache.has(key)) badgeImageCache.set(key, new Promise(resolve => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null);
      const svg = createFateBadgeSVG(kind, { print });
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }));
    return [kind, await badgeImageCache.get(key)];
  }));
  return new Map(loaded);
}
export function drawFateBadges(ctx, entry, x, y, size, images, options = {}) {
  const badges = getEntryFateBadges(entry, options);
  badges.forEach((badge, index) => {
    const image = images.get(badge.kind);
    if (image) ctx.drawImage(image, x + index * (size + 3), y, size, size);
  });
  return badges.length * (size + 3);
}
