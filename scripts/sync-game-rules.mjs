// Derive recipes and charge compatibility from current game asset properties.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEM_COMBOS } from '../src/item-combos.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.build-cache', 'game-rules');
await fs.mkdir(cache, { recursive: true });
const endpoint = 'https://api.deadlock-api.com/v1/assets';
const offline = process.argv.includes('--offline');
async function source(kind) {
  const filename = path.join(cache, `${kind}.json`);
  if (offline) return JSON.parse(await fs.readFile(filename, 'utf8'));
  const response = await fetch(`${endpoint}/${kind}?language=english`, { signal: AbortSignal.timeout(45000) });
  assert.ok(response.ok, `${kind}: HTTP ${response.status}`);
  const data = await response.json();
  await fs.writeFile(filename, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}
const [items, heroes] = await Promise.all([source('items'), source('heroes')]);
assert.ok(Array.isArray(items) && Array.isArray(heroes));
if (process.argv.includes('--inspect')) {
  console.log(JSON.stringify({
    recipes: items.filter(item => item.shopable && item.component_items?.length).map(item => ({ id: String(item.id), name: item.name, component_items: item.component_items })),
    chargeItems: items.filter(item => item.shopable && /charge|rush/i.test(item.name)).map(item => ({ id: String(item.id), name: item.name, description: item.description, properties: item.properties })),
    chargeAbilities: items.filter(item => item.type === 'ability' && (Object.keys(item.properties ?? {}).some(key => /charge/i.test(key)) || /charge/i.test(JSON.stringify(item.upgrades)))).map(item => ({ id: String(item.id), name: item.name, class_name: item.class_name, heroes: item.heroes, properties: item.properties, upgrades: item.upgrades })),
  }, null, 2));
  process.exit(0);
}
// Export generation below intentionally rejects a changed catalog rather than
// replacing the personal app's validated item and hero snapshots implicitly.
const catalog = JSON.parse(await fs.readFile(path.join(root, 'assets/items.json'), 'utf8'));
const heroCatalog = JSON.parse(await fs.readFile(path.join(root, 'assets/heroes.json'), 'utf8'));
const byClass = new Map(items.map(item => [item.class_name, item]));
const byId = new Map(items.map(item => [String(item.id), item]));
const localIds = new Set(catalog.items.map(item => item.id));
const localById = new Map(catalog.items.map(item => [item.id, item]));
const combos = ITEM_COMBOS.map(combo => {
  const pair = combo.itemIds.map(id => localById.get(id));
  assert.ok(pair.length === 2 && pair.every(Boolean), `Unknown combo item: ${combo.id}`);
  return { ...combo, name: pair.map(item => item.name).join(' + '), nameRu: pair.map(item => item.nameRu).join(' + ') };
});
const components = {};
for (const item of catalog.items) {
  const live = byId.get(item.id);
  assert.ok(live && live.class_name === item.className, `Unknown snapshot item: ${item.name}`);
  const parents = (live.component_items ?? []).map(name => byClass.get(name));
  assert.ok(parents.every(parent => parent && localIds.has(String(parent.id))), `Missing catalog component for ${item.name}`);
  if (parents.length) components[item.id] = parents.map(parent => String(parent.id));
}
const chargeNames = ['Extra Charge', 'Rapid Recharge', 'Recharging Rush'];
const chargeItems = chargeNames.map(name => {
  const item = items.find(candidate => candidate.name === name && localIds.has(String(candidate.id)));
  assert.ok(item, `Missing charge item: ${name}`);
  return String(item.id);
});
const chargeGrantItems = catalog.items.filter(item => Number(byId.get(item.id)?.properties?.EnableAbilityCharges?.value) > 0).map(item => item.id);
const capabilities = {}, evidence = [];
for (const hero of heroCatalog.heroes) {
  const abilities = hero.abilities.map(ability => {
    const live = byClass.get(ability.className);
    assert.ok(live, `Missing ability: ${hero.name}/${ability.name}`);
    const baseCharges = Number(live.properties?.AbilityCharges?.value ?? 0);
    const upgradeCharges = (live.upgrades ?? []).flatMap((upgrade, index) =>
      (upgrade.property_upgrades ?? []).filter(property => property.name === 'AbilityCharges' && Number(property.bonus) > 0)
        .map(property => ({ rank: index + 1, bonus: Number(property.bonus) })));
    return { slot: ability.slot, name: ability.name, className: ability.className, baseCharges, upgradeCharges };
  });
  capabilities[hero.id] = abilities.some(ability => ability.baseCharges > 0 || ability.upgradeCharges.length > 0);
  evidence.push({ id: hero.id, name: hero.name, charged: capabilities[hero.id], abilities: abilities.filter(ability => ability.baseCharges > 0 || ability.upgradeCharges.length) });
}
const js = `// Current game recipes and numeric charge properties; see docs/game-rules-sources.md.\nexport { ITEM_COMBOS } from './item-combos.js';\nexport const ITEM_COMPONENTS = Object.freeze(${JSON.stringify(components, null, 2)});\nfor (const parents of Object.values(ITEM_COMPONENTS)) Object.freeze(parents);\nexport const ITEM_UPGRADE_PARENTS = ITEM_COMPONENTS;\nexport const CHARGE_ITEM_IDS = Object.freeze(${JSON.stringify(chargeItems)});\nexport const CHARGE_GRANT_ITEM_IDS = Object.freeze(${JSON.stringify(chargeGrantItems)});\nexport const HERO_CHARGE_CAPABILITIES = Object.freeze(${JSON.stringify(capabilities, null, 2)});\nexport function heroHasChargeAbility(hero) {\n  return HERO_CHARGE_CAPABILITIES[String(typeof hero === 'object' && hero !== null ? hero.id : hero)] === true;\n}\n/** True only for an actual transitive recipe ancestor, never by name similarity. */\nexport function isUpgradeOf(candidate, ancestor) {\n  const target = String(typeof candidate === 'object' && candidate !== null ? candidate.id : candidate);\n  const source = String(typeof ancestor === 'object' && ancestor !== null ? ancestor.id : ancestor);\n  if (target === source) return false;\n  const visited = new Set();\n  function visit(id) {\n    if (visited.has(id)) return false;\n    visited.add(id);\n    return (ITEM_COMPONENTS[id] || []).some(parent => parent === source || visit(parent));\n  }\n  return visit(target);\n}\n`;
await fs.writeFile(path.join(root, 'src/game-item-rules.js'), js);
await fs.writeFile(path.join(root, 'src/item-combos.js'), `// Curated app bundles based on current item effects, not official game recipes.\nexport const ITEM_COMBOS = Object.freeze(${JSON.stringify(combos, null, 2)}.map(combo => Object.freeze({ ...combo, itemIds: Object.freeze(combo.itemIds) })));\n`);
const sourceMetadata = {
  updatedAt: new Date().toISOString(),
  itemSource: `${endpoint}/items?language=english`, heroSource: `${endpoint}/heroes?language=english`,
  recipeField: 'component_items (class names resolved against the current item definitions)',
  chargeFields: ['properties.AbilityCharges.value > 0', 'upgrades[].property_upgrades[name=AbilityCharges].bonus > 0'],
  chargeItems: chargeItems.map(id => ({ id, name: byId.get(id).name })),
  chargeGrantItems: chargeGrantItems.map(id => ({ id, name: byId.get(id).name, enableCharges: byId.get(id).properties.EnableAbilityCharges.value })),
  recipes: Object.entries(components).map(([id, parents]) => ({ id, name: byId.get(id).name, parents: parents.map(parent => ({ id: parent, name: byId.get(parent).name })) })),
  heroes: evidence,
};
await fs.writeFile(path.join(cache, 'verified-source.json'), `${JSON.stringify(sourceMetadata, null, 2)}\n`);
const docs = `# Item recipes and charge compatibility\n\nVerified ${sourceMetadata.updatedAt}. Current parsed Source 2 definitions from [Deadlock Assets API items](${sourceMetadata.itemSource}) and [heroes](${sourceMetadata.heroSource}); resolved against the app's existing ${catalog.items.length} items and ${heroCatalog.heroes.length} heroes. The synchronization script preserves those snapshots and rejects unknown components. Run \`node scripts/sync-game-rules.mjs\`; cached repeat uses \`--offline\`. Raw evidence is in \`.build-cache/game-rules/verified-source.json\`.\n\nRecipe parents come from the actual \`component_items\` field. Transitive recipe lookup handles multi-step upgrades and recipes with two components. A candidate is never treated as an upgrade just because of its name. ${Object.keys(components).length} items have recipes.\n\nCharge compatibility checks only the selected hero's four signature abilities. Positive numeric \`AbilityCharges\` at base rank or a positive \`AbilityCharges\` rank upgrade qualifies. It does not inspect names such as Shoulder Charge, Charged Shot, charge-up timers, or generic movement skills. All four ranks are eventually present in a complete generated skill plan, so abilities that gain charges after an upgrade also qualify.\n\nOnly Extra Charge, Rapid Recharge and Recharging Rush require an existing charged ability. Omnicharge Signet has \`EnableAbilityCharges=1\` and explicitly adds charges to ordinary abilities; keeping it allows a noncharge hero to gain charge compatibility after drawing it. Cultist Sacrifice has useful soul/buff effects without charge abilities. Mystic Burst, Tankbuster, Quicksilver Reload and Mercurial Magnum use their own charge-up timers and are not charge-dependent. Refresher resets ordinary cooldowns too. These remain eligible.\n\n| Hero | Charged signature abilities (base charges / rank granting charges) |\n| --- | --- |\n${evidence.map(hero => `| ${hero.name} | ${hero.abilities.length ? hero.abilities.map(ability => `${ability.name}: ${ability.baseCharges}${ability.upgradeCharges.map(upgrade => `; rank ${upgrade.rank} +${upgrade.bonus}`).join('')}`).join(' · ') : 'None'} |`).join('\n')}\n\n# Curated double items\n\nThe ${combos.length} pairs in \`src/item-combos.js\` are app-specific combinations, not a claim that these are official Street Brawl bundles. Pairings are inferred from the actual item descriptions and attributes in the same snapshot. The descriptions explain their purpose without promising a special game interaction. The pairs keep the two ordinary tickets available separately. Recipe ancestors and descendants are never paired together.\n`;
await fs.writeFile(path.join(root, 'docs/game-rules-sources.md'), docs);
console.log(JSON.stringify({ recipeItems: Object.keys(components).length, heroes: heroCatalog.heroes.length, chargedHeroes: evidence.filter(hero => hero.charged).map(hero => hero.name), chargeItems, chargeGrantItems }, null, 2));
