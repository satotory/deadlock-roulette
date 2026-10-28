import { writeFile, mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const endpoint = 'https://api.deadlock-api.com/v1/assets/items';
const steamEndpoint = 'https://api.deadlock-api.com/v1/assets/steam-info';
const allowedCategories = new Set(['weapon', 'vitality', 'spirit']);
const refreshIcons = process.argv.includes('--refresh-icons');
const skipIcons = process.argv.includes('--no-icons');

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000), headers: { 'User-Agent': 'DeadlockRoulette/1.0 (personal offline catalog)' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function isCatalogItem(item) {
  return item.type === 'upgrade' && item.shopable === true && item.disabled !== true &&
    allowedCategories.has(item.item_slot_type) && Number.isInteger(item.item_tier) &&
    item.item_tier >= 1 && item.item_tier <= 5 && Number.isFinite(item.cost) && item.cost > 0;
}

function stripMarkup(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

function description(item) {
  const sections = item.description;
  if (typeof sections === 'string') return stripMarkup(sections);
  if (!sections || typeof sections !== 'object') return '';
  return [...new Set(Object.values(sections).filter(value => typeof value === 'string').map(stripMarkup).filter(Boolean))].join(' ');
}

async function existingIcon(file) {
  try {
    const bytes = await readFile(file);
    return validPng(bytes);
  } catch {
    return false;
  }
}

function validPng(bytes) {
  return bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

const [english, russian, steam] = await Promise.all([
  getJson(`${endpoint}?language=english`),
  getJson(`${endpoint}?language=russian`),
  getJson(steamEndpoint),
]);
if (!Array.isArray(english) || !Array.isArray(russian)) throw new Error('Unexpected catalog response.');
const shop = english.filter(isCatalogItem);
if (shop.filter(item => item.item_tier <= 4).length < 100) throw new Error('Suspiciously small catalog; the existing snapshot was preserved.');
const idSet = new Set(shop.map(item => String(item.id)));
if (idSet.size !== shop.length) throw new Error('Duplicate catalog IDs; the existing snapshot was preserved.');
const byClassName = new Map(english.map(item => [item.class_name, item]));
const byRussianId = new Map(russian.map(item => [String(item.id), item]));
const fullCostCache = new Map();

function fullCost(item, ancestors = new Set()) {
  if (fullCostCache.has(item.class_name)) return fullCostCache.get(item.class_name);
  if (ancestors.has(item.class_name)) throw new Error(`Cyclic component path: ${item.class_name}`);
  const branch = new Set([...ancestors, item.class_name]);
  let cost = item.cost;
  for (const componentName of item.component_items ?? []) {
    const component = byClassName.get(componentName);
    if (!component || !Number.isFinite(component.cost)) throw new Error(`Missing component: ${componentName}`);
    cost += fullCost(component, branch);
  }
  fullCostCache.set(item.class_name, cost);
  return cost;
}

if (process.argv.includes('--inspect')) {
  const counts = key => Object.fromEntries([...new Set(shop.map(i => i[key]))].map(value => [String(value), shop.filter(i => i[key] === value).length]));
  console.log(JSON.stringify({ totalDefinitions: english.length, catalogItems: shop.length, tiers: counts('item_tier'), categories: counts('item_slot_type'), steam, legendaryItems: shop.filter(i => i.item_tier === 5).map(i => ({id:String(i.id),name:i.name,nameRu:byRussianId.get(String(i.id))?.name,category:i.item_slot_type})), costExamples: shop.filter(i => (i.component_items ?? []).length).slice(0,3).map(i => ({name:i.name,baseCost:i.cost,cost:fullCost(i)})) }, null, 2));
  process.exit(0);
}

await mkdir(path.join(root, 'assets', 'icons'), { recursive: true });
await mkdir(path.join(root, 'docs'), { recursive: true });
await mkdir(path.join(root, 'src'), { recursive: true });

let downloadCount = 0;
let cachedCount = 0;
let nextItem = 0;
const errors = [];
const iconPaths = new Map();

async function processIcon(item) {
  const relative = `assets/icons/${item.id}.png`;
  const target = path.join(root, relative);
  const cached = await existingIcon(target);
  if (cached && (!refreshIcons || skipIcons)) {
    cachedCount += 1;
    iconPaths.set(String(item.id), relative);
    return;
  }
  if (skipIcons) {
    iconPaths.set(String(item.id), null);
    return;
  }
  const candidates = [...new Set([item.shop_image, item.image].filter(Boolean))];
  let lastError;
  for (const source of candidates) {
    try {
      const url = new URL(source);
      if (url.protocol !== 'https:' || !['assets-bucket.deadlock-api.com', 'assets.deadlock-api.com'].includes(url.hostname)) {
        throw new Error(`Unexpected icon host: ${url.hostname}`);
      }
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!validPng(bytes)) throw new Error('Icon is not a PNG.');
      await writeFile(`${target}.tmp`, bytes);
      await rename(`${target}.tmp`, target);
      iconPaths.set(String(item.id), relative);
      downloadCount += 1;
      return;
    } catch (error) {
      lastError = error;
    }
  }
  if (cached) {
    console.warn(`Using cached icon for ${item.name}: ${lastError?.message}`);
    cachedCount += 1;
    iconPaths.set(String(item.id), relative);
    return;
  }
  errors.push(`${item.name}: ${lastError?.message ?? 'No icon URL'}`);
}

console.log(`Build ${steam.client_version}: ${shop.length} items. Downloading offline icons…`);
await Promise.all(Array.from({ length: 8 }, async () => {
  while (nextItem < shop.length) {
    const item = shop[nextItem++];
    await processIcon(item);
  }
}));
if (errors.length) throw new Error(`Could not download ${errors.length} icons; existing catalog preserved:\n${errors.join('\n')}`);

const categoryOrder = { weapon: 0, vitality: 1, spirit: 2 };
const items = shop.map(item => {
  const ru = byRussianId.get(String(item.id));
  const nameRu = ru?.name && !ru.name.startsWith('upgrade_') ? ru.name : item.name;
  return {
    id: String(item.id),
    name: item.name,
    nameRu,
    className: item.class_name,
    category: item.item_slot_type,
    tier: item.item_tier,
    cost: fullCost(item),
    baseCost: item.cost,
    icon: iconPaths.get(String(item.id)) ?? null,
    description: description(item),
    descriptionRu: description(ru ?? {}),
    active: item.is_active_item === true,
    legendary: item.item_tier === 5,
    corruptible: Boolean(item.corrupted_info),
  };
}).sort((a, b) => a.tier - b.tier || categoryOrder[a.category] - categoryOrder[b.category] || a.name.localeCompare(b.name, 'en'));

const countByTier = Object.fromEntries([1, 2, 3, 4, 5].map(tier => [tier, items.filter(item => item.tier === tier).length]));
const countByCategory = Object.fromEntries([...allowedCategories].map(category => [category, items.filter(item => item.category === category).length]));
const standardCount = items.filter(item => item.tier <= 4).length;
const legendaryCount = items.filter(item => item.tier === 5).length;
const updatedAt = new Date().toISOString();
const catalog = {
  schemaVersion: 1,
  updatedAt,
  source: `${endpoint}?language=english`,
  localizationSource: `${endpoint}?language=russian`,
  sourceDocumentation: 'https://api.deadlock-api.com/docs',
  clientVersion: steam.client_version,
  gameVersionDate: steam.version_datetime,
  standardCount,
  legendaryCount,
  countByTier,
  countByCategory,
  notes: [
    'T1–T4 are standard shop items; T5 are Legendary Street Brawl items and should be disabled by default.',
    'Included only upgrade definitions with shopable=true, disabled!=true, a recognized category, positive cost, and tier 1–5.',
    'Cost includes all recursively required components; baseCost is the raw upgrade price from the game files.',
    'Corrupted item effects are variations of existing T3/T4 entries, not separate item IDs in this source.',
  ],
  items,
};

const tableRows = [1, 2, 3, 4, 5].map(tier => `| T${tier}${tier === 5 ? ' · Legendary' : ''} | ${[...allowedCategories].map(category => items.filter(item => item.tier === tier && item.category === category).length).join(' | ')} | ${countByTier[tier]} |`).join('\n');
const sourceDoc = `# Источники каталога предметов\n\nСнимок: ${updatedAt}. Версия клиента: **${steam.client_version}**, дата игровых файлов: ${steam.version_datetime}.\n\nВ каталоге **${standardCount} обычных предметов T1–T4** и **${legendaryCount} Legendary-предметов Street Brawl (T5)**. Legendary сохранены отдельно и по умолчанию исключены из рулетки.\n\n| Тир | Ган / Weapon | ХП / Vitality | Спирит / Spirit | Всего |\n| --- | ---: | ---: | ---: | ---: |\n${tableRows}\n\n## Прямые источники\n\n- [Определения предметов из игровых KV3-файлов](https://api.deadlock-api.com/v1/assets/items?language=english).\n- [Русская локализация тех же определений](https://api.deadlock-api.com/v1/assets/items?language=russian).\n- [Манифест версии игры steam.inf](https://api.deadlock-api.com/v1/assets/steam-info).\n- [Документация Deadlock API](https://api.deadlock-api.com/docs).\n\nDeadlock API — общественный проект, который разбирает игровые файлы Valve. Он не является сервисом Valve. Названия, категории, тиры, цены и иконки здесь взяты из его прямого ответа, а не собраны по памяти.\n\n## Правила включения\n\nБерутся только записи type=upgrade, shopable=true, disabled не равен true, item_slot_type равен weapon/vitality/spirit, тир 1–5 и положительная числовая цена. Способности героев, оружие героев, удалённые и недоступные shopable=false предметы исключены. Всего исходный ответ содержит ${english.length} определений; после фильтрации осталось ${items.length}.\n\nT5 входят в игровые определения как Legendary и относятся к Street Brawl. Это дополнительные записи сверх стандартного магазина T1–T4. Цена 9999 у T5 — техническое значение из API, а не обещание доступности в обычном магазине. Статус режима также подтверждается обсуждениями на форуме игры: [Infinite Rounds в Street Brawl](https://forums.playdeadlock.com/threads/lost-my-legendary-item-due-to-bug-57684618.107744/).\n\nВ API corrupted_info хранит усиленные эффекты обычного предмета, а не самостоятельный идентификатор покупки. Поэтому искажённые версии не дублируют T3/T4 в пуле; у исходных предметов сохранён флаг corruptible.\n\nПоле cost — полная стоимость предмета со всеми компонентами. Поле baseCost — цена самого улучшения из исходной записи. Например, Capacitor: 6400 + Tesla Bullets 3200 = 9600.\n\nИконки PNG загружены из shop_image (при отсутствии — image) в assets/icons и доступны без интернета. Описания очищены от HTML и встроенных SVG. Все IDs в JSON представлены строками для безопасного сравнения и сохранения состояния.\n\n## Обновление\n\nИз корня проекта:\n\n\`\`\`powershell\nnode scripts/sync-items.mjs\n\`\`\`\n\nНужен интернет. По умолчанию существующие корректные PNG используются повторно. Для повторной загрузки всех иконок добавьте --refresh-icons. --inspect выводит сводку из живого API без изменения файлов. При ошибке загрузки или некорректном каталоге существующий JSON сохраняется. Обновление не выполняется при каждом запуске приложения: поставляемый снимок работает полностью автономно.\n`;
const catalogJson = JSON.stringify(catalog, null, 2);
await writeFile(path.join(root, 'assets', 'items.json.tmp'), `${catalogJson}\n`, 'utf8');
await writeFile(path.join(root, 'src', 'catalog-data.js.tmp'), `// Generated by scripts/sync-items.mjs; update the source snapshot through that script.\nexport default ${catalogJson};\n`, 'utf8');
await rename(path.join(root, 'assets', 'items.json.tmp'), path.join(root, 'assets', 'items.json'));
await rename(path.join(root, 'src', 'catalog-data.js.tmp'), path.join(root, 'src', 'catalog-data.js'));
const moduleNote = '\n## Данные для интерфейса\n\nСкрипт одним запуском создаёт assets/items.json и src/catalog-data.js с одинаковым объектом каталога. Интерфейс импортирует ESM-модуль, чтобы запуск через file: не зависел от fetch локального JSON. Не редактируйте сгенерированный модуль вручную; обновляйте данные этой командой.\n';
await writeFile(path.join(root, 'docs', 'catalog-sources.md'), sourceDoc + moduleNote, 'utf8');
console.log(JSON.stringify({clientVersion:steam.client_version,standardCount,legendaryCount,countByTier,countByCategory,downloadCount,cachedCount,missingIcons:items.filter(item => !item.icon).length}, null, 2));
