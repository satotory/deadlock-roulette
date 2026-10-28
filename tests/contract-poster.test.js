import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../src/catalog-data.js';
import { getContractPosterLayout, findVisibleAlphaBounds, renderContractPoster } from '../src/contract-poster.js';

test('wide match poster reserves a large hero and keeps twelve items and skill steps inside the export', () => {
  for (const count of [0, 1, 12, 13, 96, 97, 173, 240, 241, 512]) {
    const layout = getContractPosterLayout(count);
    assert.equal(layout.width, 2600); assert.equal(layout.hero.width, 1040);
    assert.ok(layout.width * layout.height <= 12_000_000 && layout.height <= 4096);
    assert.ok(layout.hero.x + layout.hero.width < layout.rightX);
    assert.ok(layout.rightX + 5 * layout.itemPitch + layout.itemSize <= layout.width - 54);
    assert.ok(layout.itemTop + layout.itemRowPitch + layout.itemSize + 60 < layout.purchaseHeading);
    assert.ok(layout.purchaseTop + layout.purchaseHeight < layout.skillsHeading);
    assert.ok(layout.skillsTop + 4 * layout.skillRowPitch + 35 < layout.footerY);
    assert.equal(layout.purchaseRows * layout.purchaseColumns >= count, true);
  }
  assert.equal(getContractPosterLayout(13).height, 1790);
});

test('alpha bounds remove empty padding while retaining a complete visible pose', () => {
  const data = new Uint8ClampedArray(10 * 8 * 4);
  for (let y = 2; y <= 6; y++) for (let x = 3; x <= 7; x++) data[(y * 10 + x) * 4 + 3] = 255;
  data[3] = 4;
  assert.deepEqual(findVisibleAlphaBounds(data, 10, 8), { x: 3, y: 2, width: 5, height: 5 });
  assert.deepEqual(findVisibleAlphaBounds(new Uint8ClampedArray(10 * 8 * 4), 10, 8), { x: 0, y: 0, width: 10, height: 8 });
});

test('poster canvas requests no sealed item image and paints every skill step on a 2600px sheet', async t => {
  const texts = [], requests = [], canvases = [], imagesDrawn = [];
  const originalImage = globalThis.Image, originalDocument = globalThis.document;
  class FakeImage { width = 100; height = 100; set src(value) { this.path = value; requests.push(value); queueMicrotask(() => this.onload?.()); } }
  const ctx = { font: '20px Segoe UI', measureText(value) { return { width: String(value).length * 9 }; }, fillText(value) { texts.push(String(value)); },
    createRadialGradient() { return { addColorStop() {} }; }, createLinearGradient() { return { addColorStop() {} }; }, drawImage(image) { imagesDrawn.push(image.path); },
    beginPath() {}, roundRect() {}, rect() {}, arc() {}, clip() {}, fillRect() {}, strokeRect() {}, moveTo() {}, lineTo() {}, fill() {}, stroke() {}, save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
  };
  globalThis.Image = FakeImage;
  globalThis.document = { createElement() { const canvas = { width: 0, height: 0, getContext() { return ctx; }, toDataURL() { return 'data:image/png;base64,test'; } }; canvases.push(canvas); return canvas; } };
  t.after(() => { if (originalImage === undefined) delete globalThis.Image; else globalThis.Image = originalImage; if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
  const secret = catalog.items.find(item => item.name === 'Escalating Exposure'), base = catalog.items.find(item => item.name === 'Mystic Vulnerability');
  const meta = (item, index) => ({ itemId: item.id, drawId: `draw-${index}`, time: index + 1, probability: .1, weight: 1, sealed: true, archmotherOrigin: index === 1 });
  const hero = { id: '65', name: 'Venator', portrait: 'assets/heroes/65.png', abilities: [1, 2, 3, 4].map(slot => ({ slot, name: `Ability ${slot}`, icon: `assets/abilities/ability-${slot}.png` })) };
  const build = { history: [meta(secret, 1)], purchasePlan: [meta(base, 0), { ...meta(secret, 1), upgradeFromIds: [base.id] }], unlockOrder: [1, 2, 3, 4], skillPlan: Array.from({ length: 12 }, (_, index) => ({ slot: index % 4 + 1, rank: Math.floor(index / 4) + 1, cost: [1, 2, 5][Math.floor(index / 4)] })), fate: { kingActive: true } };
  await renderContractPoster({ build, hero, items: catalog.items, language: 'en' });
  const sheet = canvases.find(canvas => canvas.width === 2600); assert.ok(sheet); assert.equal(sheet.height, getContractPosterLayout(2).height);
  for (const item of [secret, base]) { assert.ok(!requests.some(value => value.includes(item.icon))); assert.ok(!texts.join('\n').includes(item.name)); }
  assert.equal(texts.filter(text => /^\d AP$/.test(text)).length, 12);
  assert.equal(texts.filter(text => text === 'SEALED').length, 3);
  assert.ok(imagesDrawn.some(path => path.startsWith('data:image/svg+xml') && path.includes('M231.331')), 'The public Mother provenance is painted even on a sealed parcel');
});
