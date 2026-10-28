import { writeFile, mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const endpoint = 'https://api.deadlock-api.com/v1/assets';
const inspect = process.argv.includes('--inspect');
const refresh = process.argv.includes('--refresh-icons');
async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000), headers: { 'User-Agent': 'DeadlockRoulette/1.1 (personal offline catalog)' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

const [english, russian, itemsEn, itemsRu, steam] = await Promise.all([
  getJson(`${endpoint}/heroes?language=english`),
  getJson(`${endpoint}/heroes?language=russian`),
  getJson(`${endpoint}/items?language=english`),
  getJson(`${endpoint}/items?language=russian`),
  getJson(`${endpoint}/steam-info`),
]);

const flagNames = ['player_selectable', 'development_state', 'disabled', 'in_development', 'needs_testing', 'assigned_players_only', 'prerelease_only', 'limited_testing'];
const active = english.filter(hero => hero.player_selectable === true && hero.development_state === 'release' && hero.disabled !== true && hero.in_development !== true && hero.needs_testing !== true && hero.prerelease_only !== true && hero.assigned_players_only !== true && hero.limited_testing !== true);
if (inspect) {
  const hero = active[0];
  console.log(JSON.stringify({count:active.length,steam,active:active.map(hero=>`${hero.id}:${hero.name}`),excluded:english.filter(hero=>!active.includes(hero)).map(hero=>({id:hero.id,name:hero.name,flags:flagNames.map(key=>hero[key])})),sample:{id:hero.id,name:hero.name,images:hero.images,items:hero.items,item_slot_info:hero.item_slot_info,level_info:hero.level_info},abilities:itemsEn.filter(item=>item.type==='ability' && (item.heroes??[]).includes(hero.id)).map(item=>({id:item.id,class_name:item.class_name,name:item.name,ability_type:item.ability_type,start_trained:item.start_trained,image:item.image,upgrade_keys:Object.keys(item.upgrades??{}),keys:Object.keys(item)}))}));
  process.exit(0);
}

if (!Array.isArray(english) || !Array.isArray(russian) || active.length < 30) throw new Error('Unexpected or suspicious hero catalog; existing snapshot preserved.');
const localizedHeroes = new Map(russian.map(hero => [String(hero.id), hero]));
const abilitiesEn = new Map(itemsEn.map(item => [item.class_name, item]));
const abilitiesRu = new Map(itemsRu.map(item => [item.class_name, item]));
const downloads = [];
function stripMarkup(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ').replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
function imagePath(relative, sources, name) {
  const urls = [...new Set(sources.filter(url => typeof url === 'string' && url.endsWith('.png')))];
  if (!urls.length) throw new Error(`No portrait/ability icon for ${name}; snapshot preserved.`);
  downloads.push({ relative, urls, name });
  return relative;
}
const heroes = active.map(hero => {
  const ru = localizedHeroes.get(String(hero.id));
  const abilities = [1, 2, 3, 4].map(slot => {
    const key = hero.items?.[`signature${slot}`];
    const ability = abilitiesEn.get(key);
    const localized = abilitiesRu.get(key);
    if (!ability || ability.type !== 'ability' || !ability.name || (ability.upgrades??[]).length !== 3) throw new Error(`Missing signature${slot} for ${hero.name}; snapshot preserved.`);
    return {
      id: String(ability.id), slot, name: ability.name, nameRu: localized?.name || ability.name,
      className: key,
      icon: imagePath(`assets/heroes/abilities/${ability.id}.png`, [ability.image], `${hero.name}: ${ability.name}`),
      description: stripMarkup(ability.description?.desc),
      descriptionRu: stripMarkup(localized?.description?.desc),
      ultimate: ability.ability_type === 'ultimate',
    };
  });
  return {
    id: String(hero.id), name: hero.name, nameRu: ru?.name || hero.name, className: hero.class_name,
    portrait: imagePath(`assets/heroes/${hero.id}.png`, [hero.images?.icon_hero_card, hero.images?.top_bar_vertical_image, hero.images?.icon_image_small], hero.name),
    description: stripMarkup(hero.description?.playstyle ?? ''),
    descriptionRu: stripMarkup(ru?.description?.playstyle ?? ''),
    abilities,
  };
}).sort((a, b) => a.name.localeCompare(b.name, 'en'));
if (new Set(heroes.map(hero => hero.id)).size !== heroes.length) throw new Error('Duplicate hero IDs; snapshot preserved.');
const progression = Object.entries(active[0].level_info).map(([level, row]) => ({level:Number(level), souls:row.required_gold, currencies:row.bonus_currencies??[]}));
const abilityPoints = progression.reduce((sum, row) => sum + row.currencies.filter(currency => currency === 'EAbilityPoints').length, 0);
const unlocks = progression.filter(row => row.currencies.includes('EAbilityUnlocks'));
if (abilityPoints !== 32 || unlocks.length !== 4) throw new Error('Progression rules changed; inspect and update rules before synchronization.');
for (const hero of active) {
  if (JSON.stringify(hero.level_info) !== JSON.stringify(active[0].level_info)) throw new Error(`Hero progression differs for ${hero.name}; explicit handling is required.`);
}
const rules = {
  inventorySlots: 12, baseInventorySlots: 9, flexInventorySlots: 3,
  upgradeCosts: [1, 2, 5], abilityPoints,
  unlockSoulThresholds: unlocks.map(row => row.souls),
  unlockLevels: unlocks.map(row => row.level),
  ultimateUnlock: { slot: 4, level: unlocks[3].level, souls: unlocks[3].souls },
  maxHeroLevel: progression.at(-1).level,
  maxHeroSouls: progression.at(-1).souls,
  source: 'https://forums.playdeadlock.com/threads/11-21-2025-update.90383/',
};
await mkdir(path.join(root, 'assets', 'heroes', 'abilities'), { recursive: true });
await mkdir(path.join(root, 'docs'), { recursive: true });
await mkdir(path.join(root, 'src'), { recursive: true });
function validPng(bytes) {
  return bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}
let next = 0;
let downloaded = 0;
let cached = 0;
const errors = [];
console.log(`Build ${steam.client_version}: ${heroes.length} playable heroes, ${heroes.length * 4} signature abilities. Downloading offline portraits and icons…`);
await Promise.all(Array.from({length:8}, async () => {
  while (next < downloads.length) {
    const entry = downloads[next++];
    const target = path.join(root, entry.relative);
    if (!refresh) {
      try { if (validPng(await readFile(target))) { cached++; continue; } } catch {}
    }
    let success = false;
    let lastError;
    for (const url of entry.urls) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
          if (!response.ok) throw new Error(`${response.status}: ${url}`);
          const bytes = Buffer.from(await response.arrayBuffer());
          if (!validPng(bytes)) throw new Error(`Not a PNG: ${url}`);
          await writeFile(`${target}.tmp`, bytes);
          await rename(`${target}.tmp`, target);
          downloaded++;
          success = true;
          break;
        } catch (error) { lastError = error; }
      }
      if (success) break;
    }
    if (!success) errors.push(`${entry.name}: ${lastError?.message}`);
  }
}));
if (errors.length) throw new Error(`Missing ${errors.length} assets; existing catalog preserved.\n${errors.join('\n')}`);
const updatedAt = new Date().toISOString();
const catalog = {
  schemaVersion: 1, updatedAt, source: `${endpoint}/heroes?language=english`,
  localizationSource: `${endpoint}/heroes?language=russian`, abilitySource: `${endpoint}/items?language=english`,
  clientVersion: steam.client_version, gameVersionDate: steam.version_datetime,
  heroes, rules,
  excludedHeroes: english.filter(hero=>!active.includes(hero)).map(hero=>({id:String(hero.id), name:hero.name, playerSelectable:hero.player_selectable, disabled:hero.disabled===true, prereleaseOnly:hero.prerelease_only===true, developmentState:hero.development_state??null, inDevelopment:hero.in_development===true, needsTesting:hero.needs_testing===true, assignedPlayersOnly:hero.assigned_players_only===true, limitedTesting:hero.limited_testing===true})),
};
const json = JSON.stringify(catalog, null, 2);
await writeFile(path.join(root, 'assets', 'heroes.json.tmp'), `${json}\n`, 'utf8');
await writeFile(path.join(root, 'src', 'hero-data.js.tmp'), `// Generated by scripts/sync-heroes.mjs. Offline, localized playable hero catalog.\nexport default ${json};\n`, 'utf8');
await rename(path.join(root, 'assets', 'heroes.json.tmp'), path.join(root, 'assets', 'heroes.json'));
await rename(path.join(root, 'src', 'hero-data.js.tmp'), path.join(root, 'src', 'hero-data.js'));
await writeFile(path.join(root, 'docs', 'hero-sources.md'), `# Каталог героев и правила случайного билда\n\nСнимок: ${updatedAt}; игровые файлы клиента **${steam.client_version}** (${steam.version_datetime}). Доступны **${heroes.length} героев** и **${heroes.length * 4} основных способностей**, с английскими и русскими названиями и локальными PNG.\n\n## Прямые источники игровых данных\n\n- [Герои из игровых KV3-файлов](https://api.deadlock-api.com/v1/assets/heroes?language=english).\n- [Русская локализация героев](https://api.deadlock-api.com/v1/assets/heroes?language=russian).\n- [Способности и их изображения](https://api.deadlock-api.com/v1/assets/items?language=english).\n- [Русская локализация способностей](https://api.deadlock-api.com/v1/assets/items?language=russian).\n- [Версия клиента steam.inf](https://api.deadlock-api.com/v1/assets/steam-info).\n\nDeadlock API — общественный парсер игровых файлов Valve. В приложение включены только герои с player_selectable=true, development_state=release и без disabled/in_development/needs_testing/prerelease_only/assigned_players_only/limited_testing. Отключённые прототипы и ещё не выпущенные Violet и Nurse Harrow исключены; полный список исключений и исходные флаги сохранён в assets/heroes.json. Слот способности берётся из hero.items.signature1…signature4, а не из порядка произвольного массива API.\n\n## Проверенные правила\n\n- **12 универсальных слотов**: 9 базовых и 3 открываемых, по одному за каждого вражеского Walker. [Официальное обновление Valve от 21 ноября 2025](https://forums.playdeadlock.com/threads/11-21-2025-update.90383/) установило эти количества и добавило уровни для покупки всех улучшений.\n- Четыре способности, у каждой три улучшения со стоимостью **1, 2, 5 AP**, всего **32 AP**. Порядок каждой способности должен оставаться T1 → T2 → T3.\n- hero.level_info актуального клиента содержит **36 уровней**: четыре открытия и **32 выдачи AP**. Внутренние required_gold пороги открытия: **${rules.unlockSoulThresholds.join(', ')}**, уровни **${rules.unlockLevels.join(', ')}**. Это raw значения API; они отражают заработанные души и могут отличаться от старых таблиц, считающих стартовые 600 душ.\n- Первые три открытия расходуются на обычные способности 1–3, в случайном порядке; **ультимейт 4 открывается четвёртым**, на уровне 8. План улучшений — последовательность расходования AP после открытия соответствующего навыка: при необходимости сначала нужно накопить очки или дождаться открытия.\n\n## Обновление\n\n\`\`\`powershell\nnode scripts/sync-heroes.mjs\n\`\`\`\n\n--inspect показывает живые флаги и структуру без записи каталога, --refresh-icons повторно загружает PNG. Скрипт проверяет четыре способности и три улучшения для каждого героя, единые 32 AP и четыре открытия. При неполной структуре или недоступных изображениях существующий каталог сохраняется. Во время обычного запуска приложения интернет не требуется.\n`, 'utf8');
console.log(JSON.stringify({clientVersion:steam.client_version,heroes:heroes.length,abilities:heroes.length*4,downloaded,cached,rules,excluded:catalog.excludedHeroes.length}));
