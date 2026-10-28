import { isBuildEntrySealed, getBuildFateJournal } from './build-fate.js';
import { getBuildPurchasePlan } from './build-purchase-plan.js';
import { normalizeBuildFate } from './build-fate-state.js';
import { ITEM_COMBOS } from './item-combos.js';

const MAX_STEPS = 512;
const CATEGORIES = ['weapon', 'vitality', 'spirit'];
const COPY = {
  ru: {
    masthead: 'ВЕСТНИК ПЕРЕКРЁСТКА', edition: 'Вечерний выпуск', issue: 'Дело', personal: 'Личный экземпляр',
    kicker: 'ОТДЕЛ ГОРОДСКИХ СЛУХОВ', subtitle: 'Газета твоего билда. Вердикт пишешь ты.',
    secret: 'ЗАПЕЧАТАНО', missing: 'Нет записи', noHero: 'Неизвестный герой',
    facts: 'Опись вещдоков', fiction: 'Редакционная фантазия', fate: 'Следы судьбы', route: 'Маршрут закупок',
    review: 'Вердикт владельца', noReview: 'Вердикт ещё не вынесен. После матча оставь звёзды и комментарий в архиве.',
    noComment: 'Комментарий не добавлен.', inventory: 'Предметов в инвентаре', known: 'Раскрыто предметов',
    weapon: 'Оружие', vitality: 'Живучесть', spirit: 'Спиритизм', secrets: 'Закрытых покупок',
    cursed: 'Проклятых предметов', pairs: 'Связок в составе', upgrades: 'Покупок-улучшений', purchases: 'Шагов покупки',
    king: 'Тайный король', kingActive: 'Подписал контракт', chicken: 'Курочка', chickenUsed: 'Уже использована',
    locks: 'Статус инвентаря', allLocked: 'Весь инвентарь закрыт', archmother: 'Архиматерь', offerPending: 'Предложение ожидает выбора', giftAccepted: 'Дар принят',
    journal: 'Журнал вмешательств', journalEmpty: 'Редакция не получила записей о вмешательствах.', removed: 'Выклевано', sacrificed: 'Отдано Королю', chickenRoll: 'Бросок курицы', kingDeal: 'Сделка Короля', kingEdict: 'Королевский указ', pendingKing: 'Сделка ожидает выбора',
    kingModes: { exchange: 'Королевский обмен', treasury: 'Сокровищница', impostor: 'Самозванец', decree: 'Указ', veil: 'Закрытый архив' },
    kingEdicts: { spirit: 'Вес спиритизма ×6', vitality: 'Вес живучести ×6', 'no-t1': 'T1 запрещён' },
    routeEmpty: 'Закупки пока не начались. Редакция держит место на полосе.',
    photo: 'Фото из личного дела', price: 'душ', component: 'Компонент', upgrade: 'Улучшение', lock: 'Нельзя изменить', pair: 'Выпали вместе',
    footer: 'Дело ведёт Рандом. Финальное слово — за владельцем контракта.',
    headlines: {
      king: ['Тайный король подписал контракт. Печати важнее подписей.', 'В городе новый покровитель. И ни одного запасного ключа.'],
      sealed: ['У {hero} обнаружены посылки. Редакция не знает, что внутри.', 'Закрытая опись: {hero} несёт тайну в инвентаре.'],
      chicken: ['{hero} вызвал курочку. Редакция переписывает полосу.', 'Курочка сработала. У {hero} начинается новая глава.'],
      haze_vitality: ['Хейз устроилась танком. Страховые компании против.', 'У Хейз нашли броню. Винтовка остаётся для приличия.'],
      cursed: ['{hero} прочитал мелкий шрифт. Но уже после подписи.', 'Контракт {hero} заперт. Ключ остался у Рандома.'],
      doorman_curse: ['Швейцар открыл дверь. За ней оказалось ещё одно проклятие.'],
      pairs: ['{hero} нашёл связку. Город лишился чувства безопасности.', 'Два предмета в одном кармане. {hero} просит не задавать вопросов.'],
      archmother: ['Архиматерь одобрила дар. {hero} просит сохранить чек.', 'В деле {hero} появился дар. Редакция ставит отметку о получении.'],
      vitality: ['{hero} пришёл с запасом здоровья. На всякий случай — ещё одним.', 'Броня есть. План есть. У {hero} нет причин спешить.'],
      spirit: ['{hero} повысил духовность. Редакция ищет экзорциста.', 'В контракте {hero} слишком много спиритизма для одной полосы.'],
      weapon: ['{hero} вооружился. Под заголовок пришлось выделить патроны.', 'Оружейный отдел признал контракт {hero} своим любимым чтением.'],
      full: ['Двенадцать предметов. {hero} больше не принимает посылки.', 'Контракт {hero} заполнен. Для сомнений нужен Flex-слот.'],
      empty: ['{hero} заявлен. Предметы пока не дали показаний.'],
      mixed: ['{hero} получил контракт. Рандом отказался от комментариев.', 'Ни одного очевидного плана. У {hero} всё по описи.', 'Контракт {hero} изучают специалисты по странным решениям.'],
    },
    witness: {
      king: '«Печать настоящая. Содержимое я не видел», — говорит воображаемый архивариус.',
      sealed: '«Коробки закрыты. Догадки в опись не принимаем», — настаивает воображаемый курьер.',
      chicken: '«Я слышал кудахтанье. Остальное пусть решает новая опись», — сообщает воображаемый наборщик.',
      haze_vitality: '«Думал, это убийца. По описи — почти сейф», — удивляется воображаемый страховой агент.',
      cursed: '«Подпись была красивой. Условия — не очень», — вздыхает воображаемый нотариус.',
      pairs: '«На вопрос о мотивах ответили: мне выпало», — записал воображаемый репортёр.',
      archmother: '«В графе происхождение написано: подарок. Куда делся чек — неизвестно», — замечает воображаемый бухгалтер.',
      default: '«Мы проверили опись. За тактику редакция не отвечает», — говорит воображаемый дежурный.',
    },
  },
  en: {
    masthead: 'THE CROSSROADS GAZETTE', edition: 'Evening edition', issue: 'Case', personal: 'Private copy',
    kicker: 'CITY RUMOURS DESK', subtitle: 'A newspaper for your build. The verdict is yours.',
    secret: 'SEALED', missing: 'No record', noHero: 'Unknown hero',
    facts: 'Evidence inventory', fiction: 'Editorial fiction', fate: 'Traces of fate', route: 'Purchase route',
    review: 'Owner’s verdict', noReview: 'No verdict yet. Add stars and a comment to the archive after your match.',
    noComment: 'No comment added.', inventory: 'Inventory items', known: 'Revealed items',
    weapon: 'Weapon', vitality: 'Vitality', spirit: 'Spirit', secrets: 'Unrevealed purchases',
    cursed: 'Cursed items', pairs: 'Pairs in the kit', upgrades: 'Upgrade purchases', purchases: 'Purchase steps',
    king: 'The Secret King', kingActive: 'Contract signed', chicken: 'Chicken', chickenUsed: 'Already used',
    locks: 'Inventory status', allLocked: 'All inventory locked', archmother: 'Archmother', offerPending: 'An offer awaits your choice', giftAccepted: 'Gift accepted',
    journal: 'Intervention journal', journalEmpty: 'No interventions have reached the newsroom.', removed: 'Pecked away', sacrificed: 'Given to the King', chickenRoll: 'Chicken roll', kingDeal: 'The King’s deal', kingEdict: 'Royal decree', pendingKing: 'A deal awaits your choice',
    kingModes: { exchange: 'Royal exchange', treasury: 'Treasury', impostor: 'Impostor', decree: 'Decree', veil: 'Sealed archive' },
    kingEdicts: { spirit: 'Spirit weight ×6', vitality: 'Vitality weight ×6', 'no-t1': 'T1 forbidden' },
    routeEmpty: 'Purchasing has not begun. The typesetter is keeping a column open.',
    photo: 'Portrait from the dossier', price: 'souls', component: 'Component', upgrade: 'Upgrade', lock: 'Cannot be altered', pair: 'Dropped together',
    footer: 'Random runs the case. The contract owner has the final word.',
    headlines: {
      king: ['The Secret King signed the contract. Seals outrank signatures.', 'The city has a new patron. And no spare keys.'],
      sealed: ['{hero} carries parcels. The newsroom has no idea what is inside.', 'Closed inventory: {hero} is carrying a secret.'],
      chicken: ['{hero} called the chicken. The typesetter starts again.', 'The chicken has spoken. {hero} begins a new chapter.'],
      haze_vitality: ['Haze took a job as a tank. Insurers object.', 'Armour found on Haze. The rifle appears to be ceremonial.'],
      cursed: ['{hero} read the fine print. After signing it.', '{hero}’s contract is locked. Random kept the key.'],
      doorman_curse: ['The Doorman opened a door. Another curse was waiting behind it.'],
      pairs: ['{hero} found a pair. The city misplaced its sense of safety.', 'Two items in one pocket. {hero} asks for no questions.'],
      archmother: ['The Archmother approved a gift. {hero} asks to keep the receipt.', 'A gift entered {hero}’s case. The newsroom stamps it received.'],
      vitality: ['{hero} brought spare health. And another spare, just in case.', 'Armour acquired. Plan acquired. {hero} sees no reason to hurry.'],
      spirit: ['{hero} raised their spirituality. The newsroom wants an exorcist.', '{hero}’s contract has too much Spirit for one column.'],
      weapon: ['{hero} armed up. The headline required extra ammunition.', 'The weapons desk calls {hero}’s contract essential reading.'],
      full: ['Twelve items. {hero} is accepting no more parcels.', '{hero}’s contract is full. Doubts will need a Flex slot.'],
      empty: ['{hero} is on the record. The items have not testified yet.'],
      mixed: ['{hero} received a contract. Random declined to comment.', 'No obvious plan. {hero} insists it matches the inventory.', 'Experts in unusual decisions are studying {hero}’s contract.'],
    },
    witness: {
      king: '“The seal is real. I have not seen the contents,” says an imaginary archivist.',
      sealed: '“The boxes are closed. Guesses do not belong in the inventory,” insists an imaginary courier.',
      chicken: '“I heard clucking. Let the new inventory settle the rest,” reports an imaginary typesetter.',
      haze_vitality: '“Expected an assassin. The inventory suggests a safe,” says an imaginary insurer.',
      cursed: '“Beautiful signature. Less beautiful terms,” sighs an imaginary notary.',
      pairs: '“When asked about motives, the answer was: it rolled,” wrote an imaginary reporter.',
      archmother: '“The origin field says: gift. Nobody can find the receipt,” observes an imaginary accountant.',
      default: '“The inventory checks out. Tactics are outside our department,” says an imaginary clerk.',
    },
  },
};

const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const cleanText = (value, maximum = 1000) => typeof value === 'string'
  ? [...value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\r\n?/g, '\n').trim()].slice(0, maximum).join('') : '';

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

/** Only bundled paths can become images in a newspaper, even for imported data. */
export function newspaperAssetPath(value) {
  return typeof value === 'string' && /^assets\/[A-Za-z0-9_./-]+\.(png|webp|jpe?g)$/i.test(value)
    && !value.split('/').includes('..') ? value : null;
}

/** Build a publication from observable data. Unknown parcels never enter its seed. */
export function createNewspaperArticle({ build, hero, items = [], language = 'ru', contract } = {}) {
  const source = record(build || contract?.build), subject = record(hero), reviewSource = record(contract);
  const lang = language === 'en' ? 'en' : 'ru', copy = COPY[lang];
  const catalog = items instanceof Map ? items : new Map((Array.isArray(items) ? items : []).filter(item => item && typeof item.id === 'string').map(item => [item.id, item]));
  const history = Array.isArray(source.history) ? source.history.filter(entry => entry && typeof entry.itemId === 'string').slice(0, 12) : [];
  const plan = getBuildPurchasePlan(source, catalog).slice(0, MAX_STEPS);
  const fate = normalizeBuildFate(source.fate), rawJournal = getBuildFateJournal(source, catalog);
  const allEntries = [...history, ...plan];
  const sealedIds = new Set(allEntries.filter(entry => entry && isBuildEntrySealed(source, entry, catalog)).map(entry => entry.itemId));
  const liveSealedIds = new Set(sealedIds);
  // Removed journal masks are immutable; a future purchase of the same item cannot expose them.
  for (const event of rawJournal) for (const entry of [...(event.removedEntries || []), ...(event.sacrificedEntries || []), ...(event.chosenEntry ? [event.chosenEntry] : [])]) {
    const closed = event.kind === 'archmother' ? isBuildEntrySealed({ ...source, history: [entry], purchasePlan: [entry] }, entry, catalog) : entry.sealed === true;
    if (closed) sealedIds.add(entry.itemId);
  }
  for (const entry of fate.kingImpostorQueue || []) sealedIds.add(entry.itemId);
  const forbidden = [...sealedIds].flatMap(id => {
    const item = catalog.get(id);
    return [id, item?.name, item?.nameRu, item?.className, item?.icon].filter(value => typeof value === 'string' && value);
  }).sort((a, b) => b.length - a.length);
  const redact = (value, maximum = 1000) => {
    let text = cleanText(value, maximum);
    for (const secret of forbidden) text = text.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), copy.secret);
    return text;
  };
  const heroName = redact(lang === 'ru' ? subject.nameRu || subject.name : subject.name, 80) || copy.noHero;
  const rows = (entries, inventory = false, mask = 'live') => entries.filter(entry => entry && typeof entry.itemId === 'string').map((entry, index) => {
    const sealed = mask === 'snapshot' ? entry.sealed === true : mask === 'choice' ? isBuildEntrySealed({ ...source, history: [entry], purchasePlan: [entry] }, entry, catalog) : isBuildEntrySealed(source, entry, catalog);
    const item = sealed ? null : catalog.get(entry.itemId);
    const hidden = sealed || !item;
    return {
      key: `${inventory ? 'slot' : 'purchase'}-${index + 1}`, number: index + 1,
      ...(hidden ? {} : { itemId: item.id }),
      name: hidden ? copy.secret : cleanText(lang === 'ru' ? item.nameRu || item.name : item.name, 100),
      icon: hidden ? null : newspaperAssetPath(item.icon),
      tier: hidden ? null : Number.isInteger(item.tier) ? item.tier : null,
      category: hidden ? null : CATEGORIES.includes(item.category) ? item.category : null,
      cost: hidden ? null : Number.isFinite(item.cost) ? Math.max(0, item.cost) : null,
      secret: hidden,
      sealed: entry.sealed === true,
      archmotherOrigin: entry.archmotherOrigin === true,
      chickenOrigin: entry.chickenOrigin === true,
      kingOrigin: entry.kingOrigin === true,
      ...(!hidden && entry.kingImpostor === true ? { kingImpostor: true } : {}),
      cursed: entry.cursed === true || entry.locked === true,
      pair: false,
      upgradeFromItemIds: hidden ? [] : (Array.isArray(entry.upgradeFromIds) ? entry.upgradeFromIds : []).filter(id => !liveSealedIds.has(id) && catalog.has(id)),
      upgradeFrom: hidden ? [] : (Array.isArray(entry.upgradeFromIds) ? entry.upgradeFromIds : []).filter(id => !liveSealedIds.has(id) && catalog.has(id)).map(id => cleanText(lang === 'ru' ? catalog.get(id).nameRu || catalog.get(id).name : catalog.get(id).name, 100)),
      component: false,
    };
  });
  const inventory = rows(history, true), purchases = rows(plan);
  const componentIds = new Set(purchases.flatMap(item => item.upgradeFromItemIds));
  purchases.forEach(item => { item.component = !item.secret && componentIds.has(item.itemId); });
  const safeGroups = new Map();
  const knownCombos = new Map(ITEM_COMBOS.map(combo => [combo.id, combo]));
  history.forEach((entry, index) => {
    const key = typeof entry?.comboOrigin === 'string' ? entry.comboOrigin : null;
    if (!key || !knownCombos.get(key)?.itemIds.includes(entry.itemId)) return;
    const group = safeGroups.get(key) || [];
    group.push(inventory[index]); safeGroups.set(key, group);
  });
  const pairs = [...safeGroups.values()].filter(group => group.length === 2 && group.every(item => item && !item.secret));
  pairs.flat().forEach(item => { item.pair = true; });
  const pairNames = pairs.map(group => group.map(item => item.name).join(' + '));
  const visible = inventory.filter(item => !item.secret);
  const categoryCounts = Object.fromEntries(CATEGORIES.map(category => [category, visible.filter(item => item.category === category).length]));
  const secretCount = inventory.filter(item => item.secret).length;
  const sealedPurchaseCount = purchases.filter(item => item.secret).length;
  const cursedCount = inventory.filter(item => item.cursed).length;
  const upgradeCount = purchases.filter(item => item.upgradeFrom.length).length;
  const traits = {
    king: fate.kingActive === true, chicken: fate.chickenUsed === true,
    totalLocked: fate.totalLocked === true, offerPending: Boolean(fate.pendingArchmother), archmother: fate.archmotherUsed === true && !fate.pendingArchmother,
    sealed: Math.max(secretCount, sealedPurchaseCount), sealedSlots: secretCount, cursed: cursedCount, pairs: pairs.length,
    full: inventory.length === 12, known: visible.length, ...categoryCounts,
    kingMode: copy.kingModes[fate.kingMode] ? fate.kingMode : null,
    kingEdict: fate.kingMode === 'decree' && copy.kingEdicts[fate.kingEdict] ? fate.kingEdict : null,
  };
  const isHaze = String(subject.id) === '13' || subject.className === 'hero_haze';
  const isDoorman = String(subject.id) === '69' || subject.className === 'hero_doorman';
  const topic = traits.king ? 'king' : traits.sealed ? 'sealed' : traits.chicken ? 'chicken'
    : isHaze && traits.vitality >= 4 && traits.vitality >= traits.known / 2 ? 'haze_vitality'
      : traits.cursed ? isDoorman ? 'doorman_curse' : 'cursed' : traits.pairs ? 'pairs' : traits.archmother ? 'archmother'
        : traits.vitality >= 5 && traits.vitality > traits.known / 2 ? 'vitality'
          : traits.spirit >= 5 && traits.spirit > traits.known / 2 ? 'spirit'
            : traits.weapon >= 6 && traits.weapon > traits.known / 2 ? 'weapon'
              : traits.full ? 'full' : !inventory.length ? 'empty' : 'mixed';
  const seed = hashText(JSON.stringify({ hero: String(subject.id || ''),
    inventory: inventory.map(item => item.secret ? { secret: true } : { id: item.itemId, cursed: item.cursed, pair: item.pair }),
    purchases: purchases.map(item => item.secret ? { secret: true } : { id: item.itemId, cursed: item.cursed, parents: item.upgradeFromItemIds }),
    fate: { king: traits.king, chicken: traits.chicken, totalLocked: traits.totalLocked, offerPending: traits.offerPending, archmother: traits.archmother, kingMode: traits.kingMode, kingEdict: traits.kingEdict },
  }));
  const headline = copy.headlines[topic][seed % copy.headlines[topic].length].replaceAll('{hero}', heroName);
  const lede = lang === 'ru'
    ? `В описи ${inventory.length} / 12 слотов: оружие — ${traits.weapon}, живучесть — ${traits.vitality}, спиритизм — ${traits.spirit}.${secretCount ? ` Ещё ${secretCount} закрытых посылок; содержимое не опубликовано.` : ''} Газета описывает состав контракта, а вердикт остаётся владельцу.`
    : `The inventory has ${inventory.length} / 12 slots: Weapon ${traits.weapon}, Vitality ${traits.vitality}, Spirit ${traits.spirit}.${secretCount ? ` Another ${secretCount} parcels remain unopened; their contents are unpublished.` : ''} The paper records the contract. Its verdict belongs to the owner.`;
  const facts = [
    { label: copy.inventory, value: `${inventory.length} / 12` },
    { label: copy.weapon, value: String(traits.weapon) }, { label: copy.vitality, value: String(traits.vitality) }, { label: copy.spirit, value: String(traits.spirit) },
    { label: copy.purchases, value: String(purchases.length) }, { label: copy.upgrades, value: String(upgradeCount) },
  ];
  const fateFacts = [
    { label: copy.cursed, value: String(cursedCount) }, { label: copy.pairs, value: String(pairs.length) }, { label: copy.secrets, value: String(sealedPurchaseCount) },
    ...(traits.king ? [{ label: copy.king, value: copy.kingActive }] : []),
    ...(traits.kingMode ? [{ label: copy.kingDeal, value: copy.kingModes[traits.kingMode] }] : fate.pendingKing ? [{ label: copy.kingDeal, value: copy.pendingKing }] : []),
    ...(traits.kingEdict ? [{ label: copy.kingEdict, value: copy.kingEdicts[traits.kingEdict] }] : []),
    ...(traits.totalLocked ? [{ label: copy.locks, value: copy.allLocked }] : []),
    ...(traits.chicken ? [{ label: copy.chicken, value: copy.chickenUsed }] : []),
    ...(traits.offerPending ? [{ label: copy.archmother, value: copy.offerPending }] : []),
    ...(traits.archmother ? [{ label: copy.archmother, value: copy.giftAccepted }] : []),
  ];
  const witnessKey = topic === 'doorman_curse' ? 'cursed' : topic;
  const rating = typeof reviewSource.rating === 'number' && Number.isFinite(reviewSource.rating) ? Math.min(5, Math.max(0, Math.round(reviewSource.rating))) : 0;
  const comment = redact(reviewSource.comment, 1000);
  const journal = rawJournal.map((event, index) => {
    const chicken = event.kind === 'chicken', mother = event.kind === 'archmother';
    const entries = chicken ? rows(event.removedEntries || [], false, 'snapshot') : mother ? rows(event.chosenEntry ? [event.chosenEntry] : [], false, 'choice') : rows(event.sacrificedEntries || [], false, 'snapshot');
    const title = chicken ? `${copy.chickenRoll} · D12 ${event.die}` : mother ? `${copy.archmother} · ${copy.giftAccepted}` : `${copy.kingDeal}${copy.kingModes[event.mode] ? ` · ${copy.kingModes[event.mode]}` : ''}`;
    const detail = chicken ? `${copy.removed}: ${entries.length}${event.fullReroll ? ` · ${copy.allLocked}` : ''}` : mother ? copy.giftAccepted : copy.kingEdicts[event.edict] || (entries.length ? `${copy.sacrificed}: ${entries.length}` : copy.kingActive);
    return { number: index + 1, kind: chicken ? 'chicken' : mother ? 'archmother' : 'king', title, detail, entries, ...(chicken ? { die: event.die } : {}) };
  });
  return {
    language: lang, topic, seed, issue: seed.toString(16).padStart(8, '0').toUpperCase(),
    masthead: copy.masthead, edition: copy.edition, issueLabel: copy.issue, personal: copy.personal,
    kicker: copy.kicker, subtitle: copy.subtitle, heroName,
    contractName: redact(reviewSource.name || source.name, 80),
    headline, lede, facts, fateFacts, traits,
    kingSummary: traits.kingMode ? [copy.kingModes[traits.kingMode], traits.kingEdict ? copy.kingEdicts[traits.kingEdict] : ''].filter(Boolean).join(' · ') : '',
    columns: [
      { title: copy.facts, body: lang === 'ru' ? `Названы ${visible.length} предметов из ${inventory.length}. ${pairNames.length ? `Вместе в составе: ${pairNames.join('; ')}.` : 'Предметы перечислены отдельно, как в инвентаре.'}` : `${visible.length} of ${inventory.length} items are named. ${pairNames.length ? `Together in the kit: ${pairNames.join('; ')}.` : 'Items are recorded separately, as in the inventory.'}` },
      { title: copy.fiction, body: copy.witness[witnessKey] || copy.witness.default },
    ],
    itemStrip: inventory, purchaseSteps: purchases,
    journal,
    review: { title: copy.review, rating, stars: '★'.repeat(rating) + '☆'.repeat(5 - rating), comment, text: comment || (rating ? copy.noComment : copy.noReview), recorded: rating > 0 || Boolean(comment) },
    labels: { facts: copy.facts, fate: copy.fate, route: copy.route, routeEmpty: copy.routeEmpty, photo: copy.photo, price: copy.price, component: copy.component, upgrade: copy.upgrade, lock: copy.lock, pair: copy.pair, secret: copy.secret, journal: copy.journal, journalEmpty: copy.journalEmpty },
    footer: copy.footer,
  };
}

/** Rendering helpers use this for every data-derived text and attribute. */
export function escapeNewspaperHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
