import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../src/catalog-data.js';
import { ITEM_COMBOS } from '../src/item-combos.js';
import { createNewspaperArticle, escapeNewspaperHTML, newspaperAssetPath } from '../src/newspaper-core.js';
import { renderNewspaperMarkup, renderNewspaperPNG } from '../src/newspaper.js';

const items = catalog.items, byName = name => items.find(item => item.name === name);
const hero = { id: 13, name: 'Haze', nameRu: 'Хейз', className: 'hero_haze', portrait: 'assets/heroes/13.png' };
const entry = (item, index = 0, extra = {}) => ({ itemId: item.id, drawId: `draw-${index}`, time: index + 1, probability: .1, weight: 1, ...extra });
const buildFor = list => { const history = list.map((item, index) => entry(item, index)); return { history, purchasePlan: structuredClone(history), fate: {} }; };
const newspaper = (build, extra = {}) => createNewspaperArticle({ build, hero, items, ...extra });

test('newspaper content is deterministic and read-only, with a composition-stable issue in both languages', () => {
  const build = buildFor([byName('Mystic Shot'), byName('Express Shot')]);
  const before = structuredClone(build);
  const article = newspaper(build, { contract: { id: 'old-save', name: 'First game', rating: 4, comment: 'Great fun' } });
  assert.deepEqual(newspaper(build, { contract: { id: 'old-save', name: 'First game', rating: 4, comment: 'Great fun' } }), article);
  assert.deepEqual(build, before);
  const reviewed = newspaper(build, { language: 'en', contract: { id: 'new-save', createdAt: 8.6e15, name: 'Renamed', rating: 2, comment: 'Needs work' } });
  assert.equal(reviewed.issue, article.issue);
  assert.equal(reviewed.seed, article.seed);
  assert.equal(reviewed.review.rating, 2);
  assert.equal(reviewed.review.comment, 'Needs work');
  assert.equal(article.review.stars, '★★★★☆');
  assert.match(article.columns[1].title, /фантазия/);
  assert.match(reviewed.columns[1].body, /imaginary/);
  assert.doesNotMatch(JSON.stringify(article), /K\/D|win rate|победил|уничтожил|матч выигран/i);
});

test('headlines reflect actual composition and fate flags rather than hero names or invented match results', () => {
  const vitality = items.filter(item => item.category === 'vitality').slice(0, 4);
  assert.equal(newspaper(buildFor(vitality)).topic, 'haze_vitality');
  assert.equal(newspaper(buildFor([]), { hero: { id: 999, name: 'Secret King', className: 'hero_solomon' } }).topic, 'empty');
  const king = buildFor([byName('Mystic Shot')]); king.fate.kingActive = true;
  assert.equal(newspaper(king).topic, 'king');
  const chicken = buildFor([byName('Mystic Shot')]); chicken.fate = { chickenUsed: true, totalLocked: true };
  const paper = newspaper(chicken, { language: 'en' });
  assert.equal(paper.topic, 'chicken');
  assert.deepEqual(paper.fateFacts.find(fact => fact.label === 'Inventory status'), { label: 'Inventory status', value: 'All inventory locked' });
  assert.equal(paper.traits.totalLocked, true);
  const cursed = buildFor([byName('Mystic Shot')]); cursed.history[0].cursed = true;
  assert.equal(newspaper(cursed).topic, 'cursed');
  assert.equal(newspaper(cursed, { hero: { id: 69, name: 'The Doorman', className: 'hero_doorman' } }).topic, 'doorman_curse');
});

test('only a real trusted two-item bundle is reported as a pair', () => {
  const combo = ITEM_COMBOS.find(value => value.name === 'Mystic Shot + Express Shot');
  assert.ok(combo);
  const build = buildFor(combo.itemIds.map(id => items.find(item => item.id === id)));
  build.history.forEach(step => { step.comboOrigin = combo.id; });
  const paper = newspaper(build, { language: 'en' });
  assert.equal(paper.traits.pairs, 1);
  assert.ok(paper.itemStrip.every(item => item.pair));
  assert.equal(paper.topic, 'pairs');
  assert.match(paper.columns[0].body, /Mystic Shot \+ Express Shot/);
  build.history[1].comboOrigin = 'combo:invented';
  assert.equal(newspaper(build).traits.pairs, 0);
  build.history[1].comboOrigin = combo.id;
  build.history[1].itemId = byName('Torment Pulse').id;
  assert.equal(newspaper(build).traits.pairs, 0);
});

test('upgrade purchases keep the real component and link it in the purchase chronicle', () => {
  const base = byName('Mystic Vulnerability'), upgrade = byName('Escalating Exposure');
  const build = { history: [entry(upgrade, 1)], purchasePlan: [entry(base, 0), entry(upgrade, 1, { upgradeFromIds: [base.id] })], fate: {} };
  const paper = newspaper(build, { language: 'en' });
  assert.equal(paper.itemStrip.length, 1);
  assert.deepEqual(paper.purchaseSteps.map(step => step.itemId), [base.id, upgrade.id]);
  assert.equal(paper.purchaseSteps[0].component, true);
  assert.deepEqual(paper.purchaseSteps[1].upgradeFrom, [base.name]);
  assert.deepEqual(paper.facts.find(fact => fact.label === 'Upgrade purchases'), { label: 'Upgrade purchases', value: '1' });
  assert.match(renderNewspaperMarkup(paper), /is-component/);
  assert.match(renderNewspaperMarkup(paper), /is-upgrade/);
});

test('King parcels expose no identity, image path, category, tier or recipe metadata before reveal', () => {
  const secret = byName('Escalating Exposure'), base = byName('Mystic Vulnerability');
  const build = { history: [entry(secret, 1, { sealed: true, cursed: true })], purchasePlan: [entry(base, 0, { sealed: true }), entry(secret, 1, { sealed: true, upgradeFromIds: [base.id] })], fate: { kingActive: true } };
  const paper = newspaper(build, { language: 'en', contract: { name: `${secret.name}: ${secret.id}`, comment: `${secret.nameRu}, ${secret.icon}, ${secret.className}` } });
  assert.equal(paper.traits.known, 0);
  assert.equal(paper.traits.spirit, 0);
  assert.equal(paper.itemStrip[0].tier, null);
  assert.equal(paper.itemStrip[0].cost, null);
  assert.equal(paper.itemStrip[0].category, null);
  assert.equal(paper.itemStrip[0].icon, null);
  assert.equal(paper.traits.cursed, 1, 'The already public curse lock remains a fact without identifying its parcel');
  assert.ok(!('itemId' in paper.itemStrip[0]));
  assert.deepEqual(paper.purchaseSteps[1].upgradeFrom, []);
  const output = JSON.stringify(paper) + renderNewspaperMarkup(paper, { hero });
  for (const item of [secret, base]) for (const value of [item.id, item.name, item.nameRu, item.className, item.icon]) assert.ok(!output.includes(value), `Secret leaked: ${value}`);
  assert.match(output, /SEALED/);
  assert.match(renderNewspaperMarkup(paper), /is-secret/);
});

test('changing an unrevealed parcel cannot alter the seed or published headline', () => {
  const first = byName('Mystic Shot'), second = byName('Spirit Resilience');
  const sealed = item => { const build = buildFor([item]); build.history[0].sealed = true; build.purchasePlan[0].sealed = true; build.fate.kingActive = true; return build; };
  const a = newspaper(sealed(first)), b = newspaper(sealed(second));
  assert.deepEqual(a, b);
});

test('an imported revealed upgrade cannot expose a still sealed recipe base in facts, attributes or seed parents', () => {
  const base = byName('Mystic Vulnerability'), upgrade = byName('Escalating Exposure');
  const build = { history: [entry(upgrade, 1, { sealed: true })], purchasePlan: [entry(base, 0, { sealed: true }), entry(upgrade, 1, { sealed: true, upgradeFromIds: [base.id] })], fate: { kingActive: true, revealedPurchaseKeys: [`draw-1:${upgrade.id}`] } };
  const paper = newspaper(build, { language: 'en' });
  assert.equal(paper.itemStrip[0].name, upgrade.name);
  assert.equal(paper.purchaseSteps[0].secret, true);
  assert.deepEqual(paper.purchaseSteps[1].upgradeFromItemIds, []);
  assert.deepEqual(paper.purchaseSteps[1].upgradeFrom, []);
  assert.equal(paper.traits.sealedSlots, 0);
  assert.deepEqual(paper.fateFacts.find(fact => fact.label === 'Unrevealed purchases'), { label: 'Unrevealed purchases', value: '1' });
  const output = JSON.stringify(paper) + renderNewspaperMarkup(paper);
  for (const value of [base.id, base.name, base.nameRu, base.icon]) assert.ok(!output.includes(value));
});

test('persistent manual reveal, including a known retargeted bundle half, controls paper visibility', () => {
  const item = byName('Mystic Shot'), build = buildFor([item]);
  build.history[0].sealed = true; build.purchasePlan[0].sealed = true;
  build.fate = { kingActive: true, revealedPurchaseKeys: [`draw-0:${item.id}`] };
  assert.equal(newspaper(build).itemStrip[0].name, item.nameRu);
  assert.equal(newspaper(build).itemStrip[0].secret, false);
  assert.ok(renderNewspaperMarkup(newspaper(build)).includes(item.icon));
  const owned = buildFor([item]);
  owned.history[0] = entry(item, 12, { sealed: true });
  owned.fate.kingActive = true;
  assert.equal(newspaper(owned).itemStrip[0].secret, false, 'The original known purchase remains public after its physical slot is retargeted');
});

test('pending offer candidates are not recorded as purchases or published by the newspaper', () => {
  const offered = [byName('Mystic Shot'), byName('Torment Pulse'), byName('Spirit Resilience')];
  const build = buildFor([]); build.fate.pendingArchmother = { id: 'private-offer', itemIds: offered.map(item => item.id), createdAt: 1 };
  const article = newspaper(build, { language: 'en' });
  assert.equal(article.purchaseSteps.length, 0);
  assert.deepEqual(article.fateFacts.find(fact => fact.label === 'Archmother'), { label: 'Archmother', value: 'An offer awaits your choice' });
  const text = JSON.stringify(article) + renderNewspaperMarkup(article);
  for (const item of offered) { assert.ok(!text.includes(item.id)); assert.ok(!text.includes(item.name)); }
});

test('a completed Archmother gift remains a factual event even after the gifted item is gone', () => {
  const build = buildFor([]), before = newspaper(build, { language: 'en' });
  build.fate.archmotherUsed = true;
  const paper = newspaper(build, { language: 'en' });
  assert.equal(paper.topic, 'archmother');
  assert.equal(paper.traits.archmother, true);
  assert.notEqual(paper.seed, before.seed);
  assert.deepEqual(paper.fateFacts.find(fact => fact.label === 'Archmother'), { label: 'Archmother', value: 'Gift accepted' });
  assert.equal(paper.purchaseSteps.length, 0, 'A consumed event does not invent a surviving gift or receipt');
  assert.match(paper.columns[1].body, /imaginary accountant/);
  build.fate.chickenUsed = true;
  const afterChicken = newspaper(build, { language: 'en' });
  assert.equal(afterChicken.topic, 'chicken');
  assert.equal(afterChicken.traits.archmother, true);
  assert.ok(afterChicken.fateFacts.some(fact => fact.value === 'Gift accepted'));
});

test('a fate journal preserves real dice, gifts and sacrificed purchases while removed seals stay anonymous', () => {
  const removed = byName('Escalating Exposure'), gift = byName('Extra Charge'), sacrifice = byName('Mystic Vulnerability');
  const build = buildFor([byName('Mystic Shot')]);
  build.fate = { journal: [
    { id: 'chicken-event', kind: 'chicken', time: 20, die: 7, removedEntries: [entry(removed, 10, { sealed: true })] },
    { id: 'mother-event', kind: 'archmother', time: 21, offerId: 'mother-offer', chosenEntry: entry(gift, 11, { archmotherOrigin: true, sealed: true }) },
    { id: 'king-event', kind: 'hidden-king', time: 22, mode: 'exchange', sacrificedEntries: [entry(sacrifice, 12)] },
  ], kingMode: 'exchange' };
  const paper = newspaper(build, { language: 'en' });
  assert.deepEqual(paper.journal.map(event => event.kind), ['chicken', 'archmother', 'king']);
  assert.equal(paper.journal[0].die, 7);
  assert.match(paper.journal[0].detail, /Pecked away: 1/);
  assert.equal(paper.journal[0].entries[0].secret, true);
  assert.equal(paper.journal[1].entries[0].secret, true);
  assert.equal(paper.journal[1].entries[0].archmotherOrigin, true);
  assert.equal(paper.journal[2].entries[0].name, sacrifice.name);
  const markup = renderNewspaperMarkup(paper);
  assert.match(markup, /data-newspaper-event-kind="archmother"/);
  assert.match(markup, /data-fate-origin="archmother"/);
  for (const item of [removed, gift]) for (const value of [item.id, item.name, item.icon]) assert.ok(!(JSON.stringify(paper) + markup).includes(value));
  build.fate.revealedPurchaseKeys = [`draw-10:${removed.id}`, `draw-11:${gift.id}`];
  const revealed = newspaper(build, { language: 'en' });
  assert.equal(revealed.journal[0].entries[0].secret, true, 'Removed-item snapshot masks cannot change later');
  assert.equal(revealed.journal[1].entries[0].secret, false, 'An actually revealed gift keeps its known identity in the record');
});

test('a new public copy of an old removed sealed item remains readable without identifying the old parcel', () => {
  const item = byName('Mystic Shot'), build = buildFor([item]);
  build.fate.journal = [{ id: 'old-chicken', kind: 'chicken', time: 2, die: 12, removedEntries: [entry(item, 10, { sealed: true })] }];
  const paper = newspaper(build, { language: 'en' });
  assert.equal(paper.itemStrip[0].name, item.name);
  assert.equal(paper.journal[0].entries[0].name, 'SEALED');
  assert.ok(!('itemId' in paper.journal[0].entries[0]));
});

test('royal deal and decree facts never publish the queued impostor identities or future fake flags', () => {
  const queued = [byName('Escalating Exposure'), byName('Spirit Resilience'), byName('Extra Charge')];
  const build = buildFor([byName('Mystic Shot')]);
  build.fate = { kingActive: true, kingMode: 'impostor', kingImpostorQueue: queued.map((item, index) => entry(item, index + 30, { sealed: true, kingOrigin: true, kingImpostor: index === 1 })) };
  const paper = newspaper(build, { language: 'en' });
  assert.equal(paper.kingSummary, 'Impostor');
  const output = JSON.stringify(paper) + renderNewspaperMarkup(paper);
  for (const item of queued) for (const value of [item.id, item.name, item.icon]) assert.ok(!output.includes(value));
  assert.ok(!output.includes('kingImpostor'));
  build.fate = { kingActive: true, kingMode: 'decree', kingEdict: 'spirit' };
  const decree = newspaper(build, { language: 'en' });
  assert.equal(decree.kingSummary, 'Decree · Spirit weight ×6');
  assert.ok(decree.fateFacts.some(fact => fact.value === 'Spirit weight ×6'));
});

test('a sealed fake exposes the public royal source but publishes its impostor mark only after manual reveal', () => {
  const item = byName('Mystic Shot'), build = buildFor([item]);
  for (const step of [...build.history, ...build.purchasePlan]) { step.sealed = true; step.kingOrigin = true; step.kingImpostor = true; }
  const masked = newspaper(build, { language: 'en' });
  assert.equal(masked.itemStrip[0].kingOrigin, true);
  assert.ok(!('kingImpostor' in masked.itemStrip[0]));
  assert.doesNotMatch(renderNewspaperMarkup(masked), /data-fate-origin="impostor"/);
  build.fate.revealedPurchaseKeys = [`draw-0:${item.id}`];
  const revealed = newspaper(build, { language: 'en' });
  assert.equal(revealed.itemStrip[0].kingImpostor, true);
  assert.match(renderNewspaperMarkup(revealed), /data-fate-origin="impostor"/);
});

test('imported review and title render as text, while only bundled images become image elements', () => {
  const malicious = '<img src=x onerror="alert(1)"> & <script>bad()</script>';
  const build = buildFor([byName('Mystic Shot')]);
  const article = newspaper(build, { contract: { rating: 99, name: malicious, comment: malicious }, hero: { ...hero, nameRu: malicious } });
  const markup = renderNewspaperMarkup(article, { art: { background: 'javascript:alert(1)', render: 'https://example.com/private.jpg' } });
  assert.equal(article.review.rating, 5);
  assert.match(markup, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.ok(!markup.includes('<script>'));
  assert.ok(!markup.includes('<img src=x'));
  assert.ok(!markup.includes('javascript:'));
  assert.ok(!markup.includes('example.com'));
  assert.equal(escapeNewspaperHTML('a&<>"\''), 'a&amp;&lt;&gt;&quot;&#39;');
  assert.equal(newspaperAssetPath('assets/icons/abc.png'), 'assets/icons/abc.png');
  for (const path of ['assets/../src/app.js', 'assets/../../secret.png', 'C:/secret.png', 'https://example.com/image.png', 'data:image/png;base64,AAA', 'assets/icons/abc.svg']) assert.equal(newspaperAssetPath(path), null);
});

test('PNG paint commands and image requests obey the same secrecy boundary as the dialog', async t => {
  const texts = [], requests = [], canvases = [];
  class FakeImage {
    width = 100; height = 100;
    set src(value) { requests.push(value); queueMicrotask(() => this.onload?.()); }
  }
  const context = {
    font: '20px Georgia', measureText(value) { const size = Number(/(\d+)px/.exec(this.font)?.[1]) || 20; return { width: [...String(value)].length * size * .52 }; },
    fillText(value) { texts.push(String(value)); }, createRadialGradient() { return { addColorStop() {} }; }, createLinearGradient() { return { addColorStop() {} }; },
    fillRect() {}, strokeRect() {}, beginPath() {}, rect() {}, arc() {}, clip() {}, drawImage() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
  };
  const originalImage = globalThis.Image;
  globalThis.Image = FakeImage;
  const originalDocument = globalThis.document;
  globalThis.document = { fonts: { ready: Promise.resolve() }, createElement(name) { assert.equal(name, 'canvas'); const canvas = { width: 0, height: 0, getContext() { return context; }, toDataURL() { return 'data:image/png;base64,test'; } }; canvases.push(canvas); return canvas; } };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalImage === undefined) delete globalThis.Image; else globalThis.Image = originalImage;
  });
  const secret = byName('Escalating Exposure'), build = buildFor([secret]); build.history[0].sealed = true; build.purchasePlan[0].sealed = true; build.fate.kingActive = true;
  const dataURL = await renderNewspaperPNG({ build, hero, items, language: 'en' });
  assert.equal(dataURL, 'data:image/png;base64,test');
  assert.equal(canvases[0].width, 1800);
  assert.ok(canvases[0].height > 1500 && canvases[0].height <= 4096);
  assert.ok(!requests.some(value => value.includes(secret.id)));
  for (const value of [secret.id, secret.name, secret.nameRu, secret.className, secret.icon]) assert.ok(!texts.join('\n').includes(value));
  assert.ok(texts.includes('SEALED'));
});
