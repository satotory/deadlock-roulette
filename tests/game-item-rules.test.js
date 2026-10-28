import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ITEM_COMPONENTS, ITEM_UPGRADE_PARENTS, CHARGE_ITEM_IDS, CHARGE_GRANT_ITEM_IDS, HERO_CHARGE_CAPABILITIES, heroHasChargeAbility, isUpgradeOf } from '../src/game-item-rules.js';
import { ITEM_COMBOS } from '../src/item-combos.js';

const items = JSON.parse(readFileSync(new URL('../assets/items.json', import.meta.url))).items;
const heroes = JSON.parse(readFileSync(new URL('../assets/heroes.json', import.meta.url))).heroes;
const byId = new Map(items.map(item => [item.id, item]));
const named = name => items.find(item => item.name === name).id;

test('recipe chains use actual components including multi-step and two-component upgrades', () => {
  assert.equal(ITEM_COMPONENTS, ITEM_UPGRADE_PARENTS);
  assert.equal(Object.keys(ITEM_COMPONENTS).length, 62);
  for (const [id, parents] of Object.entries(ITEM_COMPONENTS)) {
    assert.ok(byId.has(id));
    assert.ok(parents.length > 0 && Object.isFrozen(parents));
    assert.ok(parents.every(parent => byId.has(parent)));
    assert.equal(isUpgradeOf(id, id), false);
    for (const parent of parents) {
      assert.equal(isUpgradeOf(id, parent), true);
      assert.equal(isUpgradeOf(parent, id), false, 'Recipes are acyclic');
    }
  }
  assert.equal(isUpgradeOf(named('Escalating Exposure'), named('Mystic Vulnerability')), true);
  assert.equal(isUpgradeOf(named('Crippling Headshot'), named('Weakening Headshot')), true);
  assert.equal(isUpgradeOf(named('Transcendent Cooldown'), named('Compress Cooldown')), true);
  assert.equal(isUpgradeOf(named('Leech'), named('Bullet Lifesteal')), true);
  assert.equal(isUpgradeOf(named('Leech'), named('Spirit Lifesteal')), true);
  assert.equal(isUpgradeOf(named('Spirit Resilience'), named('Bullet Resilience')), false);
  assert.equal(isUpgradeOf('unknown', 'unknown-parent'), false);
});

test('charge compatibility checks all signature upgrades without confusing names or charge-up timers', () => {
  assert.deepEqual(new Set(Object.keys(HERO_CHARGE_CAPABILITIES)), new Set(heroes.map(hero => hero.id)));
  assert.equal(heroHasChargeAbility(heroes.find(hero => hero.name === 'Abrams')), false, 'Shoulder Charge does not imply ability charges');
  assert.equal(heroHasChargeAbility(heroes.find(hero => hero.name === 'Haze')), true, 'Smoke Bomb receives charges from rank two');
  assert.equal(heroHasChargeAbility(heroes.find(hero => hero.name === 'Lady Geist')), true, 'Life Drain receives charges from rank three');
  assert.equal(heroHasChargeAbility(heroes.find(hero => hero.name === 'Yamato')), true, 'Flying Slash receives charges from rank three');
  assert.equal(heroHasChargeAbility(heroes.find(hero => hero.name === 'Seven').id), true);
  assert.equal(heroHasChargeAbility('unknown'), false);
  assert.equal(heroHasChargeAbility(null), false);
  assert.deepEqual(new Set(CHARGE_ITEM_IDS), new Set(['Extra Charge', 'Rapid Recharge', 'Recharging Rush'].map(named)));
  assert.deepEqual(CHARGE_GRANT_ITEM_IDS, [named('Omnicharge Signet')]);
  assert.equal(CHARGE_ITEM_IDS.includes(named('Mystic Burst')), false);
  assert.equal(CHARGE_ITEM_IDS.includes(named('Quicksilver Reload')), false);
  assert.equal(CHARGE_ITEM_IDS.includes(named('Cultist Sacrifice')), false);
});

test('curated double tickets are distinct and keep every component as an ordinary catalog ticket', () => {
  assert.equal(ITEM_COMBOS.length, 20);
  assert.equal(new Set(ITEM_COMBOS.map(combo => combo.id)).size, ITEM_COMBOS.length);
  const pairs = new Set();
  for (const combo of ITEM_COMBOS) {
    assert.ok(combo.id.startsWith('combo:') && !byId.has(combo.id));
    assert.equal(combo.itemIds.length, 2);
    assert.ok(combo.itemIds.every(id => byId.has(id)));
    assert.ok(Object.isFrozen(combo) && Object.isFrozen(combo.itemIds));
    assert.notEqual(combo.itemIds[0], combo.itemIds[1]);
    assert.equal(isUpgradeOf(...combo.itemIds), false);
    assert.equal(isUpgradeOf(...combo.itemIds.toReversed()), false);
    const key = combo.itemIds.toSorted().join(':');
    assert.equal(pairs.has(key), false);
    pairs.add(key);
    assert.equal(combo.name, combo.itemIds.map(id => byId.get(id).name).join(' + '));
    assert.equal(combo.nameRu, combo.itemIds.map(id => byId.get(id).nameRu).join(' + '));
    assert.ok(combo.description && combo.descriptionRu);
  }
});
