import test from 'node:test';
import assert from 'node:assert/strict';
import { FATE_PRESENTATION, FATE_COLORS, FATE_ICONS, getEntryFateBadges, fateBadgeHTML, fateBadgesHTML, createFateBadgeSVG, prepareFateBadgeImages } from '../src/fate-presentation.js';

test('shared patron accents and SVG paths match verified local Valve definitions', () => {
  assert.equal(FATE_COLORS.archmother, '#4D75C3'); assert.equal(FATE_COLORS.king, '#D4860B');
  assert.equal(FATE_PRESENTATION.archmother.brightColor, '#BDCBFF'); assert.equal(FATE_PRESENTATION.king.brightColor, '#FBDCA0');
  assert.equal(FATE_PRESENTATION.archmother.glowColor, '#84ADF6'); assert.equal(FATE_PRESENTATION.king.glowColor, '#FFC21A');
  assert.match(FATE_ICONS.king, /M0 167L120\.746 328\.984L237 107/);
  assert.match(FATE_ICONS.archmother, /M231\.331 0C241\.577/);
  for (const svg of Object.values(FATE_ICONS)) { assert.match(svg, /currentColor/); assert.doesNotMatch(svg, /<script|onload|<image|style=/); }
});

test('provenance badges use only explicit persistent booleans, including revealed royal rewards', () => {
  assert.deepEqual(getEntryFateBadges({ cursed: true }), []);
  assert.deepEqual(getEntryFateBadges({ archmotherOrigin: 'true', chickenOrigin: 1, fate: { kingActive: true } }), []);
  const entry = { itemId: 'hidden-item-id', name: 'Secret item name', archmotherOrigin: true, chickenOrigin: true, kingOrigin: true, sealed: true };
  assert.deepEqual(getEntryFateBadges(entry).map(badge => badge.kind), ['archmother', 'chicken', 'king']);
  assert.match(getEntryFateBadges(entry, { sealed: false, language: 'en' }).at(-1).label, /revealed/);
  assert.deepEqual(getEntryFateBadges({ kingOrigin: true, sealed: false }).map(badge => badge.kind), ['king']);
  const markup = fateBadgesHTML(entry, 'ru', { compact: true, sealed: true });
  assert.equal(markup, fateBadgeHTML(entry, 'ru', { compact: true, sealed: true }));
  assert.match(markup, /fate-badges is-compact/); assert.match(markup, /data-fate-origin="archmother"/);
  assert.ok(!markup.includes(entry.itemId) && !markup.includes(entry.name)); assert.ok(!markup.includes('style='));
  assert.match(markup, /Дар Архиматери/);
});

test('an impostor badge cannot appear until the authoritative caller confirms reveal', () => {
  const entry = { sealed: true, kingOrigin: true, kingImpostor: true };
  assert.deepEqual(getEntryFateBadges(entry, { sealed: true }).map(badge => badge.kind), ['king']);
  assert.doesNotMatch(fateBadgeHTML(entry, 'en', { sealed: true }), /Impostor|impostor/);
  assert.deepEqual(getEntryFateBadges(entry, { sealed: false }).map(badge => badge.kind), ['king', 'impostor']);
  assert.match(fateBadgeHTML(entry, 'en', { sealed: false }), /Impostor/);
});

test('standalone badge documents carry the SVG namespace and resolve their canvas palette', async t => {
  assert.equal(createFateBadgeSVG('unknown'), null);
  for (const kind of Object.keys(FATE_PRESENTATION)) for (const print of [false, true]) {
    const svg = createFateBadgeSVG(kind, { print });
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="64" height="64" /);
    assert.equal((svg.match(/xmlns=/g) || []).length, 1);
    assert.match(svg, /<\/svg>$/);
    assert.ok(svg.includes(print ? FATE_PRESENTATION[kind].printColor : FATE_PRESENTATION[kind].brightColor));
    assert.doesNotMatch(svg, /currentColor|var\(/);
  }
  const originalImage = globalThis.Image;
  class StandaloneSVGImage {
    width = 64; height = 64;
    set src(value) {
      const svg = decodeURIComponent(value.slice('data:image/svg+xml;charset=utf-8,'.length));
      // This reproduces the regression boundary: an unnamespaced XML root is not an SVG Image document.
      const valid = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /.test(svg) && svg.endsWith('</svg>');
      queueMicrotask(() => valid ? this.onload?.() : this.onerror?.());
    }
  }
  globalThis.Image = StandaloneSVGImage;
  t.after(() => { if (originalImage === undefined) delete globalThis.Image; else globalThis.Image = originalImage; });
  for (const print of [false, true]) {
    const images = await prepareFateBadgeImages({ print });
    assert.equal(images.size, Object.keys(FATE_PRESENTATION).length);
    assert.ok([...images.values()].every(image => image && image.width === 64 && image.height === 64), 'Every provenance glyph is a loadable standalone SVG document');
  }
});
