import { generateSkillPlan, pickHero, DEFAULT_INVENTORY_SLOTS, DEFAULT_UPGRADE_COSTS } from './build-core.js';
import { localizedItemName, localeFor } from './i18n.js';
import { randomUnitInterval } from './roulette.js';
import { createReelPlan, reelPosition, reelDuration } from './reel-motion.js';
import heroArt from './hero-art.js';
import { ITEM_COMBOS } from './item-combos.js';
import { getBuildPurchasePlan } from './build-purchase-plan.js';
import { curseTiming } from './curse-timing.js';
import { isBuildEntrySealed, getNextSealedPurchase, getBuildFateJournal, shouldSealBuildDraw } from './build-fate.js';
import { createFateEffects, SEALED_ITEM_SVG } from './fate-effects.js';
import { FATE_PRESENTATION, fateBadgeHTML } from './fate-presentation.js';
import { canUndoBuildDraw } from './build-inventory.js';

const COPY = {
  ru: {
    newspaper: '▤ Газета контракта', sealedItem: 'Закрытая покупка', sealedHint: 'Тайный король не раскрывает этот предмет до его очереди в маршруте.', sealedScanning: 'Чтение закрытого дела…', sealedChosen: 'ПОКУПКА ЗАПЕЧАТАНА', sealedMeta: 'ПЕЧАТЬ КОРОЛЯ', revealPurchase: 'Открыть следующую покупку', revealStep: 'Шаг', revealHint: 'Открывается только следующий закрытый шаг.', chicken: 'Курица судьбы', archmother: 'Архимать', hiddenKing: 'Тайный король', chickenHint: 'Один раз за билд после трёх предметов. D12 решает, сколько последних предметов исчезнет; 12 заменит весь инвентарь и запрёт его.', archmotherHint: 'Один раз за билд предлагает три одиночных предмета. Выбери один; остальные останутся в пуле.', hiddenKingHint: 'Один раз за билд закрывает будущие покупки. Открывай их по очереди в маршруте.', fateWaiting: 'Ожидает своего часа', fateSpent: 'Уже появился в этом билде', chickenWaiting: 'Ждёт трёх предметов', kingActive: 'Печать действует', motherPending: 'Подношение ждёт выбора', totalLocked: 'После броска 12 весь инвентарь заперт. Розыгрыш, правки и отмена недоступны до нового билда.', motherTitle: 'Архимать протягивает дары', motherOfferHint: 'Выбери один предмет. Выбор сохранится в текущем билде.', motherOfferSealedHint: 'Король закрыл эти дары. Выбери одну закрытую карту; её предмет откроется в порядке покупок.', motherChoose: 'Принять дар', motherChoosing: 'Принимаем дар…', motherFooter: 'Выбор обязателен. Подношение сохранится даже после перезапуска.', fateLockedAction: 'Инвентарь заперт после броска D12',
    purchaseOrder: 'ПОРЯДОК ПОКУПОК', purchaseHint: 'Покупай слева направо: базовые предметы сохранены перед их улучшениями.', purchaseEmpty: 'Первый предмет откроет маршрут покупок.', purchaseSteps: 'шагов', purchaseUpgrade: 'Улучшение', purchaseComponent: 'Базовый предмет', purchaseMerged: 'Входит в улучшение',
    curse: 'ПРОКЛЯТИЕ', curseWarning: 'Судьба требует ещё один предмет', curseHint: 'Следующий предмет нельзя изменить.', curseLocked: 'Проклятый предмет: реролл, апгрейд и даунгрейд закрыты', curseChance: 'Шанс проклятия', curseChanceHint: 'У каждого предмета свой шанс вызвать дополнительный предмет с замком. Проклятые предметы не запускают новое проклятие.', pairs: 'Двойные находки', pairsHint: 'Связки участвуют в рулетке вместе с одиночными предметами. Каждая часть занимает свой слот.', pair: 'СВЯЗКА', earlyItem: 'Ранний предмет: перенесён в начало покупок', mergedItem: 'Улучшение объединилось с базовым предметом', newRules: 'ПОВОРОТЫ СУДЬБЫ', actionCursed: 'Этот предмет запечатан проклятием', comboMark: 'Выпали вместе', purchaseChanges: 'Порядок покупок обновлён', mergedNotice: 'Объединено с базовым предметом · слот освобождён', earlyNotice: 'T1 перенесён в начало покупок',
    poster: '↗ Постер матча', rerollItem: 'Реролл', upgradeItem: 'Апгрейд', downgradeItem: 'Даунгрейд', itemActions: 'ОДНОРАЗОВЫЕ ПРАВКИ', actionHint: 'Каждая кнопка — один раз за билд. Один предмет — одна правка.', actionUsed: 'Уже потрачено в этом билде', actionModified: 'Этот предмет уже изменён', actionMissing: 'Сначала разыграй предмет', actionEmpty: 'Нет доступных предметов для этой правки', heroDossier: 'ЛИЧНОЕ ДЕЛО', singleCharge: '1 / 1', spentCharge: '0 / 1',
    eyebrow: 'АРХИВ СЛУЧАЙНЫХ КОНТРАКТОВ', title: 'Билд на персонажа', subtitle: 'Герой, предметы и порядок прокачки — один контракт на матч.',
    newBuild: 'Новый билд', chooseHero: 'Выбрать героя', rerollHero: 'Другой герой', scanning: 'Поиск в архиве…', noHero: 'Кто выйдет на улицы?', noHeroHint: 'Архив выберет одного из включённых героев с равным шансом.',
    chosen: 'КОНТРАКТ ЗАКЛЮЧЁН', candidates: 'героев участвуют', heroPool: 'Участники розыгрыша', search: 'Найти героя…', all: 'Включить всех', none: 'Выключить всех', noPool: 'Включи хотя бы одного героя.', noMatches: 'Герои не найдены', enabled: 'Участвует', excluded: 'Исключён',
    inventory: 'Твой инвентарь', inventoryHint: '9 обычных + 3 Flex-слота за уничтожение Ходоков. Каждый предмет выпадает один раз за билд.', emptySlot: 'Пустой слот', flexSlot: 'Flex-слот: открывается за уничтожение Ходока', slot: 'Слот', full: 'Инвентарь собран. Удачи в матче!', drawItem: 'Разыграть предмет', souls: 'душ',
    supply: 'АРХИВ СНАРЯЖЕНИЯ', itemWaiting: 'Что окажется в следующем слоте?', itemWaitingHint: 'Категории и веса учитываются при каждом розыгрыше.', itemScanning: 'Поиск снаряжения…', itemChosen: 'СНАРЯЖЕНИЕ ПОЛУЧЕНО', weapon: 'Ган', vitality: 'ХП', spirit: 'Спирит',
    skills: 'Порядок прокачки', skillsHint: 'Читай слева направо. Ромб — покупка ранга за 1, 2 или 5 AP. Нажми на него, когда улучшение куплено; если умение ещё закрыто, дождись открытия.', shuffleSkills: 'Перемешать прокачку', unlocks: 'ОТКРЫТИЕ УМЕНИЙ', unlocksHint: 'Обычные умения открываются первыми, ультимейт — четвёртым.', upgrades: 'УЛУЧШЕНИЯ', step: 'Шаг', rank: 'Ранг', spent: 'Всего', abilityPoints: 'очков умений', noSkills: 'Выбери героя — здесь появится случайный план его четырёх умений.', progress: 'улучшений выполнено', missingAbilities: 'Данные умений этого героя недоступны.', next: 'СЛЕДУЮЩАЯ ПОКУПКА', skillComplete: 'Все улучшения отмечены. План выполнен.', ability: 'УМЕНИЕ',
    contracts: 'Твои контракты', contractsHint: 'Сохрани героя, предметы и прокачку. Любимый случайный билд можно пройти ещё раз.', contractName: 'Имя контракта (необязательно)', saveContract: 'Сохранить билд', savedContracts: 'АРХИВ КОНТРАКТОВ', noContracts: 'Сохрани первый билд — и он останется здесь.', replayContract: 'Сыграть снова', deleteContract: 'Удалить контракт', contractSaved: 'Контракт сохранён в архиве.', contractLoaded: 'Контракт открыт. Отметки прокачки сброшены.', contractDeleted: 'Контракт удалён.', contractItems: 'предметов', contractRating: 'Оценка билда', contractStar: 'из 5 звёзд', contractComment: 'Комментарий к билду', contractCommentHint: 'Как прошёл матч? Что особенно понравилось?', contractUnrated: 'Без оценки', contractReadComment: 'Читать комментарий',
    newHint: 'Новый билд очистит героя, инвентарь и отметки прокачки. Участники розыгрыша сохранятся.', wheel: 'Правила розыгрыша предметов', rulesHint: 'Категории, тиры и веса',
    buildTiers: 'ТИРЫ ЭТОГО БИЛДА', buildTiersHint: 'Тиры билда настраиваются отдельно от обычной рулетки.', tierEnabled: 'Участвует в билде', tierDisabled: 'Исключён из билда', tierCount: 'В инвентаре', tierChance: 'Шанс следующего предмета', decay: 'Динамические веса', decayHint: 'Каждый предмет уменьшает вес своего тира. После трёх предметов шанс на четвёртый резко снижается.', decayFactor: 'Множитель веса', noItemPool: 'Включи тир или измени категории и веса: доступных предметов нет.', undoItem: 'Отменить последний предмет', undoHint: 'Вернуть последний предмет в пул и освободить его слот.',
    previewContract: 'Посмотреть билд', editContract: 'Оценить после матча', contractUpdated: 'Оценка и комментарий обновлены. Сам билд сохранён без изменений.', contractPreview: 'Превью контракта', contractPreviewHint: 'Просмотр сохранённого билда. Текущий билд и отметки прокачки сохраняются.', contractEditHint: 'Измени оценку и заметку после матча. Копия билда не создаётся.', saveChanges: 'Сохранить изменения', cancel: 'Отмена', close: 'Закрыть',
    confirmNewTitle: 'Начать новый билд?', confirmNewHint: 'Герой, предметы и отметки прокачки текущего билда будут очищены. Архив, участники розыгрыша и настройки тиров сохранятся.', confirmSkillsTitle: 'Перемешать прокачку?', confirmSkillsHint: 'Порядок прокачки изменится, отметки купленных улучшений сбросятся. Герой и предметы сохранятся.', confirmNewAction: 'Начать новый билд', confirmSkillsAction: 'Перемешать',
  },
  en: {
    newspaper: '▤ Contract gazette', sealedItem: 'Sealed purchase', sealedHint: 'The Hidden King conceals this item until its turn in the purchase route.', sealedScanning: 'Reading the sealed file…', sealedChosen: 'PURCHASE SEALED', sealedMeta: 'THE KING’S SEAL', revealPurchase: 'Reveal the next purchase', revealStep: 'Step', revealHint: 'Only the next sealed purchase can be revealed.', chicken: 'Chicken of fate', archmother: 'The Archmother', hiddenKing: 'The Hidden King', chickenHint: 'Once per build after three items. D12 determines how many recent items disappear; 12 replaces and locks the entire inventory.', archmotherHint: 'Once per build she offers three single items. Choose one; the other two remain in the pool.', hiddenKingHint: 'Once per build he seals future purchases. Reveal them in purchase order.', fateWaiting: 'Waiting in the wings', fateSpent: 'Already appeared in this build', chickenWaiting: 'Waiting for three items', kingActive: 'The seal is active', motherPending: 'A gift awaits your choice', totalLocked: 'A roll of 12 locked the whole inventory. Drawing, alterations and undo remain unavailable until a new build.', motherTitle: 'The Archmother offers her gifts', motherOfferHint: 'Choose one item. Your choice becomes part of the current build.', motherOfferSealedHint: 'The King sealed these gifts. Choose a face-down card; its item opens in purchase order.', motherChoose: 'Accept this gift', motherChoosing: 'Accepting the gift…', motherFooter: 'One choice is required. The offer survives an application restart.', fateLockedAction: 'The inventory is locked after D12',
    purchaseOrder: 'PURCHASE ORDER', purchaseHint: 'Buy from left to right: base items stay before their upgrades.', purchaseEmpty: 'Your first item starts the purchase route.', purchaseSteps: 'steps', purchaseUpgrade: 'Upgrade', purchaseComponent: 'Base item', purchaseMerged: 'Used in an upgrade',
    curse: 'CURSED', curseWarning: 'Fate demands another item', curseHint: 'The next item cannot be altered.', curseLocked: 'Cursed item: reroll, upgrade and downgrade are locked', curseChance: 'Curse chance', curseChanceHint: 'Each item independently may summon an extra locked item. Cursed items cannot trigger another curse.', pairs: 'Double drops', pairsHint: 'Synergy pairs join the roulette alongside single items. Each component occupies its own slot.', pair: 'SYNERGY', earlyItem: 'Early item: moved to the opening purchases', mergedItem: 'Upgrade merged with its base item', newRules: 'TWISTS OF FATE', actionCursed: 'This item is sealed by a curse', comboMark: 'Dropped together', purchaseChanges: 'Purchase order updated', mergedNotice: 'Merged with its base item · slot freed', earlyNotice: 'T1 moved to the opening purchases',
    poster: '↗ Match poster', rerollItem: 'Reroll', upgradeItem: 'Upgrade', downgradeItem: 'Downgrade', itemActions: 'ONE-USE ALTERATIONS', actionHint: 'Each action once per build. One alteration per item.', actionUsed: 'Already spent in this build', actionModified: 'This item has already been altered', actionMissing: 'Draw an item first', actionEmpty: 'No available items for this alteration', heroDossier: 'PERSONNEL FILE', singleCharge: '1 / 1', spentCharge: '0 / 1',
    eyebrow: 'THE RANDOM CONTRACT ARCHIVE', title: 'Hero build', subtitle: 'A hero, an inventory and a skill order — one contract for your match.',
    newBuild: 'New build', chooseHero: 'Choose a hero', rerollHero: 'Another hero', scanning: 'Scanning the archive…', noHero: 'Who takes to the streets?', noHeroHint: 'The archive picks one enabled hero with an equal chance.',
    chosen: 'CONTRACT SIGNED', candidates: 'heroes enabled', heroPool: 'Hero participation', search: 'Search heroes…', all: 'Enable all', none: 'Disable all', noPool: 'Enable at least one hero.', noMatches: 'No heroes found', enabled: 'Enabled', excluded: 'Excluded',
    inventory: 'Your inventory', inventoryHint: '9 base + 3 Flex slots unlocked by destroying Walkers. Each item can appear only once per build.', emptySlot: 'Empty slot', flexSlot: 'Flex slot: unlocked by destroying a Walker', slot: 'Slot', full: 'Inventory complete. Good luck in your match!', drawItem: 'Draw an item', souls: 'souls',
    supply: 'THE SUPPLY ARCHIVE', itemWaiting: 'What goes in the next slot?', itemWaitingHint: 'Your categories and weights apply to every draw.', itemScanning: 'Scanning supplies…', itemChosen: 'SUPPLIES RECEIVED', weapon: 'Weapon', vitality: 'Vitality', spirit: 'Spirit',
    skills: 'Skill order', skillsHint: 'Read left to right. A diamond buys a rank for 1, 2 or 5 AP. Click it after purchasing; wait for an ability to unlock if needed.', shuffleSkills: 'Shuffle skill order', unlocks: 'ABILITY UNLOCKS', unlocksHint: 'Basic abilities unlock first; the ultimate unlocks fourth.', upgrades: 'UPGRADES', step: 'Step', rank: 'Rank', spent: 'Total', abilityPoints: 'ability points', noSkills: 'Choose a hero to generate a random plan for their four abilities.', progress: 'upgrades completed', missingAbilities: 'Ability data is unavailable for this hero.', next: 'NEXT PURCHASE', skillComplete: 'All upgrades checked. Plan complete.', ability: 'ABILITY',
    contracts: 'Your contracts', contractsHint: 'Save the hero, items and skill order. Give a favorite random build another run.', contractName: 'Contract name (optional)', saveContract: 'Save build', savedContracts: 'CONTRACT ARCHIVE', noContracts: 'Save your first build to keep it here.', replayContract: 'Play again', deleteContract: 'Delete contract', contractSaved: 'Contract saved in the archive.', contractLoaded: 'Contract opened. Skill checkmarks reset.', contractDeleted: 'Contract deleted.', contractItems: 'items', contractRating: 'Build rating', contractStar: 'out of 5 stars', contractComment: 'Build comment', contractCommentHint: 'How did the match go? What stood out?', contractUnrated: 'Not rated', contractReadComment: 'Read comment',
    newHint: 'A new build clears the hero, inventory and skill checkmarks. Hero participation is preserved.', wheel: 'Item draw rules', rulesHint: 'Categories, tiers and weights',
    buildTiers: 'TIERS FOR THIS BUILD', buildTiersHint: 'Build tiers are separate from the normal roulette.', tierEnabled: 'Included in the build', tierDisabled: 'Excluded from the build', tierCount: 'In inventory', tierChance: 'Chance of the next item', decay: 'Dynamic weights', decayHint: 'Each item reduces the weight of its tier. After three items, a fourth becomes much less likely.', decayFactor: 'Weight multiplier', noItemPool: 'Enable a tier or adjust categories and weights: there are no available items.', undoItem: 'Undo last item', undoHint: 'Return the last item to the pool and free its slot.',
    previewContract: 'Preview build', editContract: 'Rate after the match', contractUpdated: 'Rating and comment updated. The saved build is unchanged.', contractPreview: 'Contract preview', contractPreviewHint: 'A preview of your saved build. Your current build and skill checkmarks stay in place.', contractEditHint: 'Update the rating and notes after your match. No duplicate build is created.', saveChanges: 'Save changes', cancel: 'Cancel', close: 'Close',
    confirmNewTitle: 'Start a new build?', confirmNewHint: 'The current hero, items and skill checkmarks will be cleared. Your archive, hero participation and tier settings will stay in place.', confirmSkillsTitle: 'Shuffle the skill order?', confirmSkillsHint: 'The skill order will change and purchased upgrade checkmarks will reset. Your hero and items will stay in place.', confirmNewAction: 'Start new build', confirmSkillsAction: 'Shuffle',
  },
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const nameFor = (entry, language) => language === 'en' ? entry.name : entry.nameRu || entry.name;
const assetURL = path => path ? new URL(`../${path}`, import.meta.url).href : '';
const categoryGlyph = { weapon: '⌁', vitality: '♡', spirit: '✧' };
Object.assign(COPY.ru, { hiddenKingHint:'Один раз за билд после пяти предметов предлагает одну из четырёх королевских сделок.', kingWaiting:'Ждёт пяти предметов', eventHistory:'ХРОНИКА КОНТРАКТА', eventEmpty:'Судьба ещё не вмешивалась в этот контракт.', eventTriggered:'СЛУЧИЛОСЬ', eventReset:'Каждое событие появляется один раз за текущий билд. Отмена и перезапуск не возвращают событие; новый билд сбрасывает историю.', motherSpinning:'Три дара ищут своих владельцев…', motherReady:'Все три дара раскрыты. Выбери один.', eventLoss:'Потеряно', eventChosen:'Принят дар', eventKing:'Королевская сделка' });
Object.assign(COPY.en, { hiddenKingHint:'Once per build after five items he offers one of four royal deals.', kingWaiting:'Waiting for five items', eventHistory:'CONTRACT CHRONICLE', eventEmpty:'Fate has not intervened in this contract yet.', eventTriggered:'TRIGGERED', eventReset:'Each event appears once in the current build. Undo and restart do not refund it; a new build resets the history.', motherSpinning:'Three gifts are finding their owners…', motherReady:'All three gifts have landed. Choose one.', eventLoss:'Lost', eventChosen:'Gift accepted', eventKing:'Royal deal' });
Object.assign(COPY.ru,{royalUndoHint:'Сделку нельзя отменить; новые обычные покупки можно.',royalSealHint:'Сначала открой королевскую покупку в маршруте.',kingQueueHint:'Сначала получи все три королевских свёртка. Правки и отмена временно закрыты.',pendingChickenHint:'Сначала прими результат броска Курицы судьбы.',pendingKingHint:'Сначала заверши сделку с Тайным королём.'});
Object.assign(COPY.en,{royalUndoHint:'The deal cannot be undone; new ordinary purchases can.',royalSealHint:'Reveal the royal purchase in the route first.',kingQueueHint:'Collect all three royal parcels first. Alterations and undo are temporarily locked.',pendingChickenHint:'Accept the chicken’s die result first.',pendingKingHint:'Finish the deal with the Hidden King first.'});
const lockIcon = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="4" y="8" width="12" height="9" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 8V5.5a3.5 3.5 0 0 1 7 0V8" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="12" r="1" fill="currentColor"/><path d="M10 13v1.5" stroke="currentColor" stroke-width="1.5"/></svg>';

export function createBuildMode({ root, heroes, items, getState, commit, getLanguage, getQuick = () => false, getCurseChance = () => 50, onCurseChanceChange = () => {}, getPairsEnabled = () => true, onPairsEnabledChange = () => {}, getFatePreferences = () => ({ chickenChance: .1, archmotherChance: .1, hiddenKingChance: .1 }), onFatePreferenceChange = () => {}, onRevealNextPurchase = () => false, onChooseArchmother = () => false, getArchmotherCandidates = () => items, onArchmotherTick = () => {}, getKingAvailability = () => [], onChooseKing = () => false, onRequestNewspaper = () => {}, getItemCandidates = () => items.filter(item => !(getState().history || []).some(entry => entry.itemId === item.id)), getBuildDistribution = () => null, getItemActionAvailability = () => ({}), getContracts = () => [], onSaveContract = () => false, onLoadContract = () => false, onDeleteContract = () => false, onUpdateContract = () => false, rules = {}, onHeroBusyChange = () => {}, onHeroTick = () => {}, onHeroImpact = () => {}, onHeroReveal = () => {}, onAbilityReveal = () => {}, onRequestItemSpin = () => {}, onRequestItemAction = () => {}, onExportPoster = () => {}, onUndoBuildItem = () => {}, onNewBuild } = {}) {
  const inventorySlots = rules.inventorySlots || DEFAULT_INVENTORY_SLOTS;
  const costs = rules.upgradeCosts || DEFAULT_UPGRADE_COSTS;
  const heroById = new Map(heroes.map(hero => [hero.id, hero]));
  const itemById = new Map(items.map(item => [item.id, item]));
  const comboById = new Map(ITEM_COMBOS.map(combo => [combo.id, combo]));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let heroBusy = false;
  let itemSpinning = false;
  let search = '';
  let frame = 0;
  let itemFrame = 0;
  let revealTimer;
  let abilityTimer;
  let abilityWaitResolve;
  let abilityRevealCount = 4;
  let revealingHeroId = null;
  let itemRevealTimer;
  let itemAnimation = null;
  let heroReel = null;
  let itemReel = null;
  let scannerItem = null;
  let scannerSealed = false;
  let fateBusy = false;
  let archmotherChoosing = false;
  let archmotherPromise = null;
  let archmotherResolve = null;
  let archmotherOffer = null;
  let offerRenderKey = '';
  let archmotherFrame = 0;
  let archmotherReels = [];
  let archmotherReady = false;
  let kingOffer = null;
  let kingPromise = null;
  let kingResolve = null;
  let kingChoosing = false;
  let lastRevealedKeys = new Set(getState().fate?.revealedPurchaseKeys || []);
  let justRevealedItemIds = new Set();
  let scannerState = 'idle';
  let scannerSlot = 0;
  let newlyDrawnItem = null;
  let pendingHistory = null;
  let pendingPurchasePlan;
  let inventoryChanges = { insertedItemIds: [], mergedItemIds: [], earlyItemIds: [] };
  let curseTimers = [];
  let curseResolve;
  let contractName = getState().name || '';
  let contractRating = 0;
  let contractComment = '';
  let lastStateName = getState().name || '';
  let contractNotice = '';
  let contractDialog = null;
  let lastBuildDistribution = null;
  let destroyed = false;
  const language = () => getLanguage() === 'en' ? 'en' : 'ru';
  const t = key => COPY[language()][key] || key;
  const $ = selector => root.querySelector(selector);
  const disabled = () => heroBusy || itemSpinning || fateBusy || Boolean(getState().fate?.pendingArchmother || getState().fate?.pendingKing || getState().fate?.pendingChicken);
  root.classList.add('build-mode');
  for (const [kind,palette] of Object.entries(FATE_PRESENTATION)) {
    for (const [key,value] of Object.entries({color:palette.color,bright:palette.brightColor,dark:palette.darkColor,glow:palette.glowColor})) document.documentElement.style.setProperty(`--fate-${kind}-${key}`,value);
  }
  // Keep local portraits warm so the fast archive shuffle has no image-load gaps.
  const portraitCache = heroes.map(hero => {
    const image = new Image();
    if (hero.portrait || hero.icon) image.src = assetURL(hero.portrait || hero.icon);
    return image;
  });
  const itemImageCache = new Map();
  root.innerHTML = `
    <div class="build-heading"><div><div class="eyebrow" data-build-copy="eyebrow"></div><h2 data-build-copy="title"></h2><p data-build-copy="subtitle"></p></div><div class="build-heading-actions"><button id="build-poster-button" class="build-secondary" data-build-copy="poster"></button><button id="build-new-button" class="build-secondary" data-build-copy="newBuild"></button></div></div>
    <div class="build-top-grid">
      <section class="panel build-hero-panel"><div class="build-hero-stage" data-poster-state="idle"><div id="build-hero-card" class="build-hero-card" aria-live="polite"></div><div id="build-hero-poster" class="build-hero-poster" aria-hidden="true"></div><div id="build-hero-unlocks" class="build-hero-unlocks"></div></div><div class="build-hero-actions"><button id="build-hero-random" class="build-primary"></button><span id="build-hero-count"></span></div></section>
      <section class="panel build-inventory-panel"><div class="panel-heading"><h2 data-build-copy="inventory"></h2><span id="build-inventory-count"></span></div><p class="build-note" id="build-inventory-note"></p><div id="build-item-scanner" class="build-item-scanner" data-state="idle" aria-live="polite"></div><div id="build-inventory" class="build-inventory"></div><div id="build-purchase-plan" class="build-purchase-plan" aria-live="polite"></div><div class="build-inventory-actions"><button id="build-item-random" class="build-secondary build-inventory-draw" data-build-copy="drawItem"></button><button id="build-item-undo" class="build-secondary" data-build-copy="undoItem"></button></div><div class="build-item-alterations"><div class="build-alterations-heading"><span class="eyebrow" data-build-copy="itemActions"></span><small data-build-copy="actionHint"></small></div><div class="build-item-action-buttons">${[['reroll','↻','rerollItem'],['upgrade','↑','upgradeItem'],['downgrade','↓','downgradeItem']].map(([action,glyph,label]) => `<button id="build-${action}-button" class="build-secondary build-item-action" data-build-item-action="${action}"><span aria-hidden="true">${glyph}</span><b data-build-copy="${label}"></b><small class="build-action-charge"></small></button>`).join('')}</div></div></section>
    </div>
    <details class="panel build-pool"><summary><span data-build-copy="heroPool"></span><span class="build-pool-count" id="build-pool-count"></span><span aria-hidden="true">＋</span></summary><div class="build-pool-tools"><input id="build-hero-search" type="search" autocomplete="off"><button id="build-heroes-all" class="build-secondary" data-build-copy="all"></button><button id="build-heroes-none" class="build-secondary" data-build-copy="none"></button></div><div id="build-hero-grid" class="build-hero-grid"></div></details>
    <section class="panel build-skill-panel"><div class="build-skills-heading"><div><h2 data-build-copy="skills"></h2><p class="build-note" data-build-copy="skillsHint"></p></div><button id="build-skill-random" class="build-secondary" data-build-copy="shuffleSkills"></button></div><div id="build-skill-content"></div></section>
    <section class="panel build-contract-panel"><div class="build-contract-heading"><div><h2 data-build-copy="contracts"></h2><p class="build-note" data-build-copy="contractsHint"></p></div><div class="build-contract-form"><input id="build-contract-name" type="text" maxlength="60" autocomplete="off"><button id="build-contract-save" class="build-primary" data-build-copy="saveContract"></button></div></div><div class="build-contract-notes"><div class="build-contract-rating-field"><span data-build-copy="contractRating"></span><div id="build-contract-rating" class="build-contract-rating-input" role="group"></div></div><textarea id="build-contract-comment" maxlength="1000" rows="2"></textarea></div><details class="build-contract-archive"><summary><span data-build-copy="savedContracts"></span><span id="build-contract-count"></span><span aria-hidden="true">＋</span></summary><div id="build-contract-gallery" class="build-contract-gallery"></div></details><p id="build-contract-notice" class="build-contract-notice" aria-live="polite"></p></section>
    <details class="panel build-item-rules"><summary><span data-build-copy="wheel"></span><small data-build-copy="rulesHint"></small><span aria-hidden="true">＋</span></summary><div id="build-wheel-host"></div></details>
    <section class="panel build-fate-rules" aria-labelledby="build-fate-title"><span id="build-fate-title" class="eyebrow" data-build-copy="newRules"></span><div class="build-fate-controls"><label class="build-pairs-control"><input id="build-pairs-enabled" type="checkbox"><span><b data-build-copy="pairs"></b><small data-build-copy="pairsHint"></small></span><i aria-hidden="true">◇◇</i></label><label class="build-curse-control"><span><b data-build-copy="curseChance"></b><output id="build-curse-chance-output" for="build-curse-chance"></output></span><input id="build-curse-chance" type="range" min="0" max="100" step="1"><small data-build-copy="curseChanceHint"></small></label></div></section>
    <section class="panel build-tier-rules" aria-labelledby="build-tier-title"><div class="build-tier-heading"><span id="build-tier-title" class="eyebrow" data-build-copy="buildTiers"></span><label class="build-decay-control"><input id="build-dynamic-weights" type="checkbox"><span data-build-copy="decay"></span></label></div><div id="build-tier-controls" class="build-tier-controls"></div><p id="build-tier-note" class="build-note"></p></section>
    <dialog id="build-contract-dialog" class="build-contract-dialog" aria-labelledby="build-contract-dialog-title"><div id="build-contract-dialog-content"></div></dialog>
  `;
  $('.build-heading-actions').insertAdjacentHTML('afterbegin', '<button id="build-newspaper-button" class="build-secondary" data-build-copy="newspaper"></button>');
  $('#build-purchase-plan').insertAdjacentHTML('afterend', '<button id="build-reveal-next" class="build-reveal-next" type="button" hidden><span></span><small></small></button>');
  $('.build-fate-rules').insertAdjacentHTML('beforeend', `<div class="build-fate-settings">${[['chickenChance','chicken','chickenHint'],['archmotherChance','archmother','archmotherHint'],['hiddenKingChance','hiddenKing','hiddenKingHint']].map(([key,label,hint]) => {const kind=key==='hiddenKingChance'?'king':label;return `<section class="build-fate-setting" data-fate-kind="${kind}"><span class="build-fate-setting-heading"><button class="build-fate-info-button" type="button" data-fate-info="${kind}" aria-label="${escape(t(label))}"><i aria-hidden="true">${FATE_PRESENTATION[kind].svg}</i><b data-build-copy="${label}"></b><span aria-hidden="true">ⓘ</span></button><output id="build-${key}-output" for="build-${key}"></output></span><input id="build-${key}" type="range" min="0" max="100" step="1" data-fate-preference="${key}"><small data-build-copy="${hint}"></small><span class="build-fate-state" id="build-${key}-state"></span></section>`;}).join('')}</div><p id="build-fate-locked-banner" class="build-fate-locked-banner" hidden></p>`);
  $('.build-curse-control>span').insertAdjacentHTML('afterbegin','<button class="build-fate-info-button build-curse-info" type="button" data-fate-info="curse" aria-label="CURSE">ⓘ</button>');
  $('.build-top-grid').insertAdjacentHTML('afterend','<details id="build-event-history" class="panel build-event-history"><summary><span class="build-event-history-title"></span><span class="build-event-history-count"></span><span aria-hidden="true">＋</span></summary><div class="build-event-history-list"></div></details>');
  root.insertAdjacentHTML('beforeend','<dialog id="build-fate-info-dialog" class="build-fate-info-dialog" aria-labelledby="build-fate-info-title"><div class="build-fate-info-mark"></div><h2 id="build-fate-info-title"></h2><div class="build-fate-info-content"></div><button id="build-fate-info-close" class="build-secondary" type="button"></button></dialog>');
  root.insertAdjacentHTML('beforeend', '<dialog id="build-archmother-dialog" class="build-archmother-dialog" aria-labelledby="build-archmother-title"><div class="build-archmother-header"><span class="eyebrow">DEADLOCK / OFFERING</span><h2 id="build-archmother-title" tabindex="-1"></h2><p></p></div><div class="build-archmother-choices"></div><p class="build-archmother-status" aria-live="polite"></p><p class="build-archmother-footer"></p></dialog>');
  $('#build-fate-locked-banner').insertAdjacentHTML('beforebegin','<button id="build-archmother-resume" class="build-secondary build-archmother-resume" type="button" hidden></button>');
  $('#build-archmother-resume').insertAdjacentHTML('afterend','<button id="build-king-resume" class="build-secondary build-king-resume" type="button" hidden></button>');
  $('#build-reveal-next').insertAdjacentHTML('afterend','<aside id="build-king-deal-banner" class="build-king-deal-banner" hidden></aside>');
  root.insertAdjacentHTML('beforeend','<dialog id="build-king-dialog" class="build-king-dialog" aria-labelledby="build-king-title"><div class="build-king-offer-header"><span class="build-king-offer-mark"></span><span class="eyebrow">DEADLOCK / ROYAL CONTRACT</span><h2 id="build-king-title" tabindex="-1"></h2><p></p></div><div class="build-king-choices"></div><p class="build-king-offer-footer"></p></dialog>');
  const fateEffects = createFateEffects({ root, items, getLanguage: language, getQuick, reducedMotion });
  const sealedHTML = () => `<span class="build-sealed-sigil">${SEALED_ITEM_SVG}</span>`;

  function imageHTML(entry, className = '', type = 'portrait') {
    const path = type === 'portrait' ? entry.portrait || entry.icon : entry.icon;
    return path ? `<img class="${className}" src="${escape(assetURL(path))}" alt="" loading="lazy">` : `<span class="build-image-fallback ${className}" aria-hidden="true">◈</span>`;
  }

  function itemComponents(entry) {
    if (Array.isArray(entry?.components) && entry.components.length) return entry.components.map(item => typeof item === 'string' ? itemById.get(item) : item).filter(Boolean);
    if (Array.isArray(entry?.itemIds)) return entry.itemIds.map(id => itemById.get(id)).filter(Boolean);
    return entry?.id && itemById.has(entry.id) ? [entry] : [];
  }

  function itemName(entry) {
    const components = itemComponents(entry);
    return components.length > 1 ? components.map(item => localizedItemName(item, language())).join(' + ') : localizedItemName(components[0] || entry, language());
  }

  function itemMeta(entry) {
    const components = itemComponents(entry);
    return components.length > 1 ? `${t('pair')} · ${components.map(item => `T${item.tier}`).join(' + ')}` : `${t(entry.category)} · T${entry.tier}`;
  }

  function latestEntries(state = getState()) {
    const history = state.history || [];
    return state.latestDrawId ? history.filter(entry => entry.drawId === state.latestDrawId) : history.slice(-1);
  }

  function latestTicket(state = getState()) {
    const entries = latestEntries(state);
    const sealed = entries.some(entry => isBuildEntrySealed(state, entry, items));
    const descriptor = comboById.get(entries[0]?.comboOrigin || entries[0]?.ticketId);
    if (descriptor) {
      const components = descriptor.itemIds.map(id => itemById.get(id)).filter(Boolean);
      if (components.length === descriptor.itemIds.length) return { ...descriptor, combo: true, components, category: components[0].category, tier: Math.max(...components.map(item => item.tier)), cursed: entries.some(entry => entry.cursed), sealed };
    }
    const components = entries.map(entry => itemById.get(entry.itemId)).filter(Boolean);
    if (components.length > 1) return { id: entries[0].comboOrigin || `combo:${components.map(item => item.id).join('+')}`, combo: true, itemIds: components.map(item => item.id), components, category: components[0].category, tier: Math.max(...components.map(item => item.tier)), cursed: entries.some(entry => entry.cursed), sealed };
    return components[0] ? { ...components[0], sealed } : null;
  }

  function latestSlot() {
    const history = getState().history || [];
    const latest = latestEntries()[0];
    return latest ? Math.min(inventorySlots, Math.max(1, history.indexOf(latest) + 1)) : 0;
  }

  function visibleHistory() {
    if (!itemSpinning) return getState().history || [];
    if (pendingHistory) return pendingHistory;
    const latest = new Set(latestEntries());
    return (getState().history || []).filter(entry => !latest.has(entry));
  }

  function visiblePurchasePlan() {
    const state = getState();
    if (!itemSpinning) return getBuildPurchasePlan(state, items);
    return getBuildPurchasePlan({ ...state, history: visibleHistory(), purchasePlan: pendingPurchasePlan ?? null }, items);
  }

  function purchasePlanHTML(state, { plan = getBuildPurchasePlan(state, items) } = {}) {
    const positions = new Map(plan.map((entry, index) => [entry.itemId, index + 1]));
    const finalItems = new Set((state.history || []).map(entry => entry.itemId));
    const consumedItems = new Set(plan.flatMap(entry => entry.upgradeFromIds || []));
    const heading = `<div class="build-purchase-heading"><span class="eyebrow">${escape(t('purchaseOrder'))}</span>${plan.length ? `<small>${plan.length} ${escape(t('purchaseSteps'))}</small>` : ''}</div>`;
    if (!plan.length) return `${heading}<p class="build-purchase-empty">${escape(t('purchaseEmpty'))}</p>`;
    return `${heading}<ol class="build-purchase-route" aria-label="${escape(t('purchaseOrder'))}">${plan.map((entry, index) => {
      const item = itemById.get(entry.itemId);
      if (!item) return '';
      const sealed = isBuildEntrySealed(state, entry, items);
      if (sealed) return `<li class="build-purchase-step is-sealed${entry.cursed ? ' is-cursed' : ''}" data-purchase-item-id="sealed-${index + 1}" data-purchase-step="${index + 1}" title="${escape(t('sealedHint'))}" tabindex="0"><span class="build-purchase-index">${String(index + 1).padStart(2, '0')}</span><span class="build-purchase-art">${sealedHTML()}${entry.cursed ? `<i class="build-purchase-lock" aria-label="${escape(t('curseLocked'))}">${lockIcon}</i>` : ''}</span><span class="build-purchase-copy"><b>${escape(t('sealedItem'))}</b><small>${escape(t('sealedMeta'))}</small></span><span class="build-purchase-detail">${escape(t('sealedHint'))}</span></li>`;
      const name = localizedItemName(item, language());
      const parents = (entry.upgradeFromIds || []).map(id => itemById.get(id)).filter(Boolean);
      const publicParentNames = parents.map(parent => isBuildEntrySealed(state, plan.find(step => step.itemId === parent.id), items) ? t('sealedItem') : localizedItemName(parent, language()));
      const publicParentIds = parents.filter(parent => !isBuildEntrySealed(state,plan.find(step=>step.itemId===parent.id),items)).map(parent=>parent.id);
      const parentSteps = parents.map(item => positions.get(item.id)).filter(Boolean);
      const locked = Boolean(entry.cursed || entry.locked);
      const component = !finalItems.has(item.id) && consumedItems.has(item.id);
      const relationship = parents.length ? `${t('purchaseUpgrade')}: ${publicParentNames.join(' + ')} → ${name}` : component ? t('purchaseMerged') : '';
      const detail = [String(index + 1).padStart(2, '0') + '. ' + name, `T${item.tier}`, relationship, locked ? t('curseLocked') : ''].filter(Boolean).join(' · ');
      return `<li class="build-purchase-step ${item.category}${parents.length ? ' is-upgrade' : ''}${component ? ' is-component' : ''}${locked ? ' is-cursed' : ''}" data-purchase-item-id="${escape(item.id)}" data-purchase-step="${index + 1}" data-upgrade-from="${escape(publicParentIds.join(','))}" title="${escape(detail)}" tabindex="0"><span class="build-purchase-index">${String(index + 1).padStart(2, '0')}</span><span class="build-purchase-art">${imageHTML(item, '', 'item')}${locked ? `<i class="build-purchase-lock" aria-label="${escape(t('curseLocked'))}">${lockIcon}</i>` : ''}</span><span class="build-purchase-copy"><b>${escape(name)}</b><small>${parents.length ? `<span class="build-purchase-upgrade">↗ ${escape(t('purchaseUpgrade'))}${parentSteps.length ? ` <i>${parentSteps.map(index => String(index).padStart(2, '0')).join(' + ')}</i>` : ''}</span>` : component ? escape(t('purchaseComponent')) : `T${item.tier}`}</small></span><span class="build-purchase-detail">${escape(detail)}</span></li>`;
    }).join('')}</ol><p class="build-purchase-hint">${escape(t('purchaseHint'))}</p>`;
  }

  function renderPurchasePlan() {
    $('#build-purchase-plan').innerHTML = purchasePlanHTML({ ...getState(), history: visibleHistory() }, { plan: visiblePurchasePlan() });
    attachEntryBadges($('#build-purchase-plan'),visiblePurchasePlan(),'.build-purchase-step',getState(),{compact:true});
  }

  function stillReelPlan(candidates, winner, neighbors = 1) {
    let alternatives = [...new Map(candidates.filter(entry => entry?.id && entry.id !== winner.id).map(entry => [entry.id, entry])).values()];
    const entries = [];
    for (let index = 0; index < neighbors * 2 + 1; index++) {
      if (index === neighbors) { entries.push(winner); continue; }
      if (!alternatives.length) alternatives = candidates.filter(entry => entry?.id && entry.id !== winner.id);
      const choice = alternatives[Math.floor(randomUnitInterval() * alternatives.length)] || winner;
      entries.push(choice);
      alternatives = alternatives.filter(entry => entry.id !== choice.id);
    }
    return { entries, neighbors, startIndex: neighbors, landingIndex: neighbors, travelDuration: 0, settleDuration: 0, overshoot: 0 };
  }

  function reelCardHTML(entry, type, index, sealed = false) {
    const hero = type === 'hero';
    if (!hero && sealed) return `<div class="build-reel-card build-reel-item is-sealed" data-reel-entry-id="sealed-${index}" data-reel-card-index="${index}"><div class="build-reel-card-body"><div class="build-reel-art build-item-scanner-art">${sealedHTML()}<i class="build-reel-art-glint" aria-hidden="true"></i></div><strong class="build-reel-name build-item-scanner-name">${escape(t('sealedItem'))}</strong><small class="build-reel-meta">${escape(t('sealedMeta'))}</small></div></div>`;
    const art = hero && heroArt[entry.id];
    const components = hero ? [] : itemComponents(entry);
    const pair = components.length > 1;
    const path = hero ? art?.render || entry.portrait || entry.icon : entry.icon;
    const name = hero ? nameFor(entry, language()) : itemName(entry);
    const meta = hero ? `DEADLOCK / ${String(heroes.indexOf(entry) + 1).padStart(3, '0')}` : itemMeta(entry);
    const pairImages = pair ? components.slice(0, 2).map((item, index) => `<img class="build-combo-component build-combo-component-${index}" src="${escape(assetURL(item.icon))}" alt="" decoding="async" draggable="false">`).join('') + '<b class="build-combo-link" aria-hidden="true">+</b>' : '';
    const synergy = language() === 'en' ? entry.synergy || entry.description : entry.synergyRu || entry.descriptionRu || entry.synergy || entry.description;
    return `<div class="build-reel-card${hero ? ' build-reel-hero' : ` build-reel-item ${escape(entry.category)}${pair ? ' is-combo' : ''}`}" data-reel-entry-id="${escape(entry.id)}" data-reel-card-index="${index}"><div class="build-reel-card-body"><div class="build-reel-art${hero ? ' build-reel-hero-art' : ' build-item-scanner-art'}">${hero && art?.background ? `<img class="build-reel-hero-background" src="${escape(assetURL(art.background))}" alt="" decoding="async" draggable="false">` : ''}${pairImages || (path ? `<img class="${hero ? 'build-reel-hero-render' : ''}" src="${escape(assetURL(path))}" alt="" decoding="async" draggable="false">` : `<span class="build-image-fallback" aria-hidden="true">${hero ? '◈' : categoryGlyph[entry.category]}</span>`)}<i class="build-reel-art-glint" aria-hidden="true"></i></div><strong class="build-reel-name${hero ? '' : ' build-item-scanner-name'}" title="${escape(name)}">${escape(name)}</strong><small class="build-reel-meta">${escape(meta)}</small>${pair && synergy ? `<span class="build-reel-synergy">${escape(synergy)}</span>` : ''}</div></div>`;
  }

  function renderPoster() {
    const hero = heroById.get(getState().heroId);
    const stage = $('.build-hero-stage');
    const poster = $('#build-hero-poster');
    const expanded = Boolean(hero && (!heroBusy || revealingHeroId === hero.id));
    stage.dataset.posterState = expanded ? 'expanded' : heroBusy ? 'scanning' : 'idle';
    if (!hero) { poster.innerHTML = ''; poster.dataset.heroId = ''; return; }
    const art = heroArt[hero.id] || {};
    stage.style.setProperty('--poster-accent', art.color || '#af91bf');
    if (poster.dataset.heroId !== hero.id) {
      const background = art.background || '';
      const render = art.render || hero.portrait || hero.icon;
      poster.innerHTML = `${background ? `<img class="build-poster-background" src="${escape(assetURL(background))}" alt="" draggable="false">` : ''}<div class="build-poster-orbit" aria-hidden="true"><i></i><b>◆</b></div>${render ? `<img class="build-poster-render${art.fullBody ? ' is-full-body' : ' is-portrait'}" src="${escape(assetURL(render))}" alt="" draggable="false">` : ''}<div class="build-poster-caption"><span class="eyebrow">DEADLOCK / <b>${String(heroes.indexOf(hero) + 1).padStart(3,'0')}</b></span><h3></h3></div><div class="build-poster-stamp"><span></span><b aria-hidden="true">◈</b></div>`;
      poster.dataset.heroId = hero.id;
      poster.dataset.fullBody = String(Boolean(art.fullBody));
    }
    poster.querySelector('.build-poster-caption h3').textContent = nameFor(hero, language());
    poster.querySelector('.build-poster-stamp span').textContent = t('heroDossier');
  }

  function mountReel(host, type, plan, winner, sealed = false) {
    const hero = type === 'hero';
    host.dataset.sealed = String(Boolean(sealed));
    host.innerHTML = `<div class="build-reel-topline"><span class="eyebrow build-reel-status"></span>${hero ? '<span class="build-reel-archive-number" aria-hidden="true">◈ / 003</span>' : '<span class="build-item-scanner-slot"></span>'}</div><div class="build-reel-viewport" data-reel-type="${type}" data-reel-count="${hero ? 3 : 5}"><div class="build-reel-track">${plan.entries.map((entry, index) => reelCardHTML(entry, type, index, sealed)).join('')}</div><div class="build-reel-guide" aria-hidden="true"><i></i><b>◆</b><i></i></div><div class="build-reel-vignette" aria-hidden="true"></div></div>${hero ? '<div class="build-hero-reel-footer"><div class="build-ability-preview"></div></div>' : '<div class="build-item-scan-progress" aria-hidden="true"><i></i></div>'}`;
    host.classList.add('has-reel');
    const poolKey = (type === 'hero' ? enabledHeroes() : getItemCandidates().map(candidate => candidate.item || candidate)).map(entry => entry.id).join('|');
    const reel = { host, type, plan, winner, sealed, poolKey, position: plan.startIndex, center: -1, width: 0, viewport: host.querySelector('.build-reel-viewport'), track: host.querySelector('.build-reel-track'), cards: [...host.querySelectorAll('.build-reel-card')], activeCards: new Set() };
    refreshReelLabels(reel);
    paintReel(reel, plan.startIndex);
    reel.resizeObserver = new ResizeObserver(() => {
      if (!destroyed) paintReel(reel, reel.position);
    });
    reel.resizeObserver.observe(reel.viewport);
    return reel;
  }

  function refreshReelLabels(reel) {
    reel.cards.forEach((card, index) => {
      const entry = reel.plan.entries[index];
      const name = reel.type === 'hero' ? nameFor(entry, language()) : reel.sealed ? t('sealedItem') : itemName(entry);
      card.querySelector('.build-reel-name').textContent = name;
      card.querySelector('.build-reel-name').title = name;
      card.querySelector('.build-reel-meta').textContent = reel.type === 'hero' ? `DEADLOCK / ${String(heroes.indexOf(entry) + 1).padStart(3, '0')}` : reel.sealed ? t('sealedMeta') : itemMeta(entry);
      const synergy = card.querySelector('.build-reel-synergy');
      if (synergy) synergy.textContent = (language() === 'en' ? entry.synergy || entry.description : entry.synergyRu || entry.descriptionRu || entry.synergy || entry.description) || '';
    });
    const curseSeal = reel.host.querySelector('.build-scanner-curse-seal');
    if (curseSeal) { curseSeal.querySelector('span').textContent = t('curse'); curseSeal.title = t('curseLocked'); }
    updateReelSummary(reel);
  }

  function updateReelSummary(reel) {
    const scanning = reel.host.dataset.state === 'scanning';
    const entry = reel.plan.entries[Math.max(0, reel.center)];
    reel.host.querySelector('.build-reel-status').textContent = t(reel.type === 'hero' ? scanning ? 'scanning' : 'chosen' : reel.sealed ? scanning ? 'sealedScanning' : 'sealedChosen' : scanning ? 'itemScanning' : 'itemChosen');
    if (reel.type === 'hero') {
      const ordered = entry?.id === getState().heroId && getState().unlockOrder?.length ? getState().unlockOrder.map(slot => entry.abilities.find(ability => ability.slot === slot)).filter(Boolean) : entry?.abilities || [];
      reel.host.querySelector('.build-ability-preview').innerHTML = ordered.map((ability, index) => {
        const visible = !scanning && (!heroBusy || revealingHeroId === entry.id && index < abilityRevealCount);
        return `<span class="${visible ? 'is-revealed' : 'is-pending'}" data-build-ability-reveal="${index}" title="${visible ? escape(nameFor(ability, language())) : ''}" ${visible ? '' : 'aria-hidden="true"'}>${imageHTML(ability, '', 'ability')}<b>${ability.slot}</b></span>`;
      }).join('');
    } else {
      reel.host.querySelector('.build-item-scanner-slot').innerHTML = `${escape(t('slot'))}<b>${String(scannerSlot || Math.min((getState().history?.length || 0) + 1, inventorySlots)).padStart(2, '0')}</b>`;
      for (const category of ['weapon', 'vitality', 'spirit']) reel.host.classList.toggle(category, !reel.sealed && entry?.category === category);
    }
  }

  function paintReel(reel, position) {
    const width = reel.viewport.clientWidth;
    const neighbors = reel.type === 'hero' ? 1 : 2;
    const step = width / (neighbors * 2 + 1);
    const cardWidth = Math.max(1, step - 8);
    if (width !== reel.width) {
      reel.width = width;
      reel.cards.forEach(card => { card.style.width = `${cardWidth}px`; });
    }
    reel.position = position;
    reel.host.dataset.reelIndex = position.toFixed(4);
    reel.track.style.transform = `translate3d(${width / 2 - cardWidth / 2 - position * step}px,0,0)`;
    const center = Math.min(reel.cards.length - 1, Math.max(0, Math.round(position)));
    if (center !== reel.center) {
      reel.center = center;
      const entry = reel.plan.entries[center];
      if (reel.type === 'hero') reel.host.dataset.heroId = entry.id;
      else { scannerItem = entry; reel.host.dataset.itemId = reel.sealed ? 'sealed' : entry.id; }
      reel.cards.forEach((card, index) => {
        card.dataset.reelPosition = index === center ? 'center' : index === center - 1 ? 'previous' : index === center + 1 ? 'next' : neighbors === 2 && index === center - 2 ? 'previous-2' : neighbors === 2 && index === center + 2 ? 'next-2' : 'offscreen';
        card.setAttribute('aria-hidden', index === center ? 'false' : 'true');
      });
      updateReelSummary(reel);
    }
    const active = new Set();
    for (let index = Math.max(0, Math.floor(position) - neighbors - 1); index <= Math.min(reel.cards.length - 1, Math.ceil(position) + neighbors + 1); index++) {
      const card = reel.cards[index];
      const distance = Math.min(neighbors, Math.abs(index - position));
      card.style.opacity = String(1 - distance * (neighbors === 2 ? .24 : .56));
      card.firstElementChild.style.transform = `scale(${1 - distance * (neighbors === 2 ? .085 : .14)})`;
      active.add(index);
    }
    reel.activeCards.forEach(index => { if (!active.has(index)) reel.cards[index].style.opacity = '0'; });
    reel.activeCards = active;
  }

  function runReel(reel, { onTick = () => {}, onImpact = () => {} } = {}) {
    const host = reel.host;
    host.dataset.state = 'scanning';
    host.dataset.reelDuration = String(reducedMotion ? 0 : reelDuration(reel.plan));
    host.classList.add('is-scanning');
    host.classList.remove('is-revealed', 'is-impact');
    host.setAttribute('aria-live', 'off');
    updateReelSummary(reel);
    const started = performance.now();
    let previousCenter = reel.center;
    let impacted = false;
    return new Promise(resolve => {
      reel.cancel = resolve;
      const animate = now => {
        if (destroyed) { resolve(); return; }
        const elapsed = reducedMotion ? reelDuration(reel.plan) : now - started;
        const duration = reelDuration(reel.plan);
        paintReel(reel, reelPosition(reel.plan, elapsed));
        const progress = host.querySelector('.build-item-scan-progress>i');
        if (progress) progress.style.transform = `scaleX(${Math.min(1, elapsed / duration)})`;
        if (reel.center !== previousCenter) { previousCenter = reel.center; if (!reducedMotion) onTick(); }
        if (!impacted && elapsed >= reel.plan.travelDuration) {
          impacted = true;
          host.classList.add('is-impact');
          onImpact();
        }
        if (elapsed >= duration) {
          paintReel(reel, reel.plan.landingIndex);
          host.dataset.state = 'revealed';
          host.classList.remove('is-scanning');
          host.classList.add('is-revealed');
          host.setAttribute('aria-live', 'polite');
          updateReelSummary(reel);
          reel.cancel = null;
          resolve();
          return;
        }
        if (reel.type === 'hero') frame = requestAnimationFrame(animate);
        else itemFrame = requestAnimationFrame(animate);
      };
      if (reducedMotion) animate(started);
      else if (reel.type === 'hero') frame = requestAnimationFrame(animate);
      else itemFrame = requestAnimationFrame(animate);
    });
  }

  function renderHero() {
    const card = $('#build-hero-card');
    const hero = heroById.get(getState().heroId);
    if (heroReel && (heroBusy || heroReel.winner.id === hero?.id && heroReel.poolKey === enabledHeroes().map(entry => entry.id).join('|'))) {
      refreshReelLabels(heroReel);
      paintReel(heroReel, heroReel.position);
      return;
    }
    card.classList.toggle('has-hero', Boolean(hero));
    card.classList.remove('is-scanning', 'is-impact', 'is-revealed', 'has-reel');
    heroReel?.resizeObserver?.disconnect();
    heroReel = null;
    card.dataset.state = hero ? 'revealed' : 'idle';
    card.dataset.heroId = hero?.id || '';
    if (hero) heroReel = mountReel(card, 'hero', stillReelPlan(enabledHeroes(), hero), hero);
    else card.innerHTML = `<div class="build-empty-portrait"><span aria-hidden="true">◈</span><i></i></div><div class="build-hero-copy"><span class="eyebrow">DEADLOCK / CONTRACT</span><h3>${escape(t('noHero'))}</h3><p>${escape(t('noHeroHint'))}</p></div>`;
  }

  function enabledHeroes() {
    const excluded = new Set(getState().excludedHeroIds);
    return heroes.filter(hero => !excluded.has(hero.id));
  }

  function renderPool() {
    const excluded = new Set(getState().excludedHeroIds);
    const query = search.trim().toLocaleLowerCase(localeFor(language()));
    const matching = heroes.filter(hero => `${hero.name} ${hero.nameRu || ''}`.toLocaleLowerCase(localeFor(language())).includes(query));
    $('#build-hero-grid').innerHTML = matching.length ? matching.map(hero => {
      const enabled = !excluded.has(hero.id);
      return `<button class="build-hero-choice" data-build-hero-id="${escape(hero.id)}" aria-pressed="${enabled}" title="${escape(`${nameFor(hero, language())} · ${t(enabled ? 'enabled' : 'excluded')}`)}" ${disabled() ? 'disabled' : ''}>${imageHTML(hero, 'build-pool-portrait')}<span>${escape(nameFor(hero, language()))}</span><b aria-hidden="true">${enabled ? '✓' : '−'}</b></button>`;
    }).join('') : `<p class="build-note">${escape(t('noMatches'))}</p>`;
  }

  function warmItemImages(candidates) {
    for (const item of candidates.flatMap(item => itemComponents(item))) {
      if (!item?.icon || itemImageCache.has(item.id)) continue;
      const image = new Image();
      image.src = assetURL(item.icon);
      itemImageCache.set(item.id, image);
    }
  }

  function renderItemScanner() {
    const scanner = $('#build-item-scanner');
    if (!itemAnimation && !itemSpinning) scanner.dataset.cursed = String(latestEntries().some(entry => entry.cursed || entry.locked));
    const pool = getItemCandidates().map(candidate => candidate.item || candidate).filter(candidate => candidate?.id && itemComponents(candidate).length);
    if (itemReel && (itemAnimation || itemReel.winner.id === scannerItem?.id && itemReel.sealed === scannerSealed && itemReel.poolKey === pool.map(entry => entry.id).join('|'))) {
      refreshReelLabels(itemReel);
      paintReel(itemReel, itemReel.position);
      return;
    }
    const item = scannerItem;
    itemReel?.resizeObserver?.disconnect();
    itemReel = null;
    scanner.dataset.state = scannerState;
    scanner.dataset.itemId = item ? scannerSealed ? 'sealed' : item.id : '';
    scanner.className = `build-item-scanner${item ? scannerSealed ? ' is-sealed' : ` ${item.category}` : ''}`;
    scanner.setAttribute('aria-live', 'polite');
    if (item) {
      warmItemImages(pool);
      itemReel = mountReel(scanner, 'item', stillReelPlan(pool, item, 2), item, scannerSealed);
      scanner.querySelector('.build-item-scan-progress>i').style.transform = 'scaleX(1)';
      if (scanner.dataset.cursed === 'true') addCurseSeal(scanner);
    } else scanner.innerHTML = `<div class="build-item-scanner-art"><span aria-hidden="true">◈</span></div><div class="build-item-scanner-copy"><span class="eyebrow">${escape(t('supply'))}</span><strong class="build-item-scanner-name">${escape(t('itemWaiting'))}</strong><small>${escape(t('itemWaitingHint'))}</small></div>`;
  }

  function centerStages() {
    const region = $('.build-top-grid');
    if (!region) return;
    const rect = region.getBoundingClientRect();
    const target = Math.max(0, window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2);
    window.scrollTo({ top: target, left: window.scrollX, behavior: reducedMotion ? 'instant' : 'smooth' });
  }

  function animateItem({ winner, candidates = [], beforeHistory, beforePurchasePlan, cursed = false, sealed = false, fastReveal = false, scroll = true, onTick = () => {}, onImpact = () => {} } = {}) {
    if (destroyed || !winner) return Promise.resolve();
    if (itemAnimation) return itemAnimation.promise;
    const pool = candidates.map(candidate => candidate.item || candidate).filter(item => item?.id && itemComponents(item).length);
    if (!pool.length) pool.push(winner);
    warmItemImages(pool);
    warmItemImages([winner]);
    itemSpinning = true;
    scannerSealed = Boolean(sealed);
    pendingHistory = Array.isArray(beforeHistory) ? beforeHistory.slice() : visibleHistory().slice();
    if (beforePurchasePlan !== undefined) pendingPurchasePlan = Array.isArray(beforePurchasePlan) ? beforePurchasePlan.slice() : null;
    scannerState = 'scanning';
    scannerSlot = latestSlot() || 1;
    newlyDrawnItem = null;
    clearTimeout(itemRevealTimer);
    const scanner = $('#build-item-scanner');
    itemReel?.resizeObserver?.disconnect();
    scanner.classList.remove('is-impact', 'is-revealed');
    scanner.dataset.state = 'scanning';
    const plan = createReelPlan(pool, winner, { quick: fastReveal || getQuick(), neighbors: 2 });
    if (fastReveal) { plan.travelDuration = 760; plan.settleDuration = 280; }
    itemReel = mountReel(scanner, 'item', plan, winner, scannerSealed);
    scanner.dataset.cursed = String(Boolean(cursed));
    if (cursed) addCurseSeal(scanner);
    renderInventory();
    renderPurchasePlan();
    if (scroll) centerStages();
    renderControls();
    const promise = runReel(itemReel, { onTick, onImpact }).then(() => {
      itemAnimation = null;
      if (destroyed) return;
      scannerItem = winner;
      scannerState = 'revealed';
      newlyDrawnItem = winner.id;
      pendingHistory = (getState().history || []).slice();
      pendingPurchasePlan = getBuildPurchasePlan(getState(), items);
      inventoryChanges.insertedItemIds = itemComponents(winner).map(item => item.id);
      renderInventory();
      renderPurchasePlan();
      itemRevealTimer = setTimeout(() => {
        newlyDrawnItem = null;
        inventoryChanges = { insertedItemIds: [], mergedItemIds: [], earlyItemIds: [] };
        $('#build-inventory')?.querySelectorAll('.is-new').forEach(slot => slot.classList.remove('is-new'));
      }, 1500);
    });
    itemAnimation = { promise };
    return promise;
  }

  async function revealArchmotherGift({winner,beforeHistory,beforePurchasePlan,sealed=false,cursed=false,onImpact=()=>{}}={}) {
    if(destroyed||!winner)return;
    itemSpinning=true;scannerSealed=Boolean(sealed);
    pendingHistory=Array.isArray(beforeHistory)?beforeHistory.slice():visibleHistory().slice();
    pendingPurchasePlan=Array.isArray(beforePurchasePlan)?beforePurchasePlan.slice():beforePurchasePlan;
    renderInventory();renderPurchasePlan();
    scannerItem=winner;scannerState='revealed';scannerSlot=latestSlot()||1;
    pendingHistory=(getState().history||[]).slice();pendingPurchasePlan=getBuildPurchasePlan(getState(),items);
    newlyDrawnItem=winner.id;inventoryChanges.insertedItemIds=itemComponents(winner).map(item=>item.id);
    renderItemScanner();$('#build-item-scanner').dataset.cursed=String(cursed);if(cursed)addCurseSeal($('#build-item-scanner'));
    renderInventory();renderPurchasePlan();renderControls();
    $('#build-item-scanner').classList.add('is-archmother-gift');
    $('#build-inventory').querySelectorAll('.is-new').forEach(slot=>slot.classList.add('is-archmother-drop'));
    onImpact(winner);
    await new Promise(resolve=>setTimeout(resolve,reducedMotion?120:320));
    if(destroyed)return;
    $('#build-item-scanner').classList.remove('is-archmother-gift');
    $('#build-inventory').querySelectorAll('.is-archmother-drop').forEach(slot=>slot.classList.remove('is-archmother-drop'));
  }

  function renderInventory() {
    const history = visibleHistory();
    const entries = history.slice(0, inventorySlots);
    $('#build-inventory-count').textContent = `${entries.length} / ${inventorySlots}`;
    $('#build-inventory-note').textContent = entries.length === inventorySlots ? t('full') : t('inventoryHint');
    $('#build-inventory').innerHTML = Array.from({ length: inventorySlots }, (_, index) => {
      const entry = entries[index];
      const item = itemById.get(entry?.itemId);
      const flex = index >= (rules.baseInventorySlots || 9);
      const flexHTML = flex ? '<span class="build-slot-flex">FLEX</span>' : '';
      if (!item) return `<div class="build-item-slot is-empty${flex ? ' is-flex' : ''}" title="${escape(`${t('slot')} ${index + 1} · ${t(flex ? 'flexSlot' : 'emptySlot')}`)}"><span class="build-slot-index">${String(index + 1).padStart(2, '0')}</span><span class="build-empty-plus" aria-hidden="true">＋</span>${flexHTML}</div>`;
      if (isBuildEntrySealed(getState(), entry, items)) return `<div class="build-item-slot is-sealed${flex ? ' is-flex' : ''}${entry.cursed ? ' is-cursed' : ''}" data-build-item-id="sealed-${index + 1}" data-sealed="true" data-cursed="${Boolean(entry.cursed)}" tabindex="0" title="${escape(t('sealedHint'))}"><span class="build-slot-index">${String(index + 1).padStart(2, '0')}</span><span class="build-slot-art">${sealedHTML()}${entry.cursed ? `<span class="build-item-lock" aria-label="${escape(t('curseLocked'))}">${lockIcon}</span>` : ''}</span><span class="build-slot-name">${escape(t('sealedItem'))}</span>${flexHTML}</div>`;
      const name = localizedItemName(item, language());
      const cost = new Intl.NumberFormat(localeFor(language())).format(item.cost);
      const locked = Boolean(entry.cursed || entry.locked);
      const isNew = newlyDrawnItem === item.id || inventoryChanges.insertedItemIds.includes(item.id);
      const early = inventoryChanges.earlyItemIds.includes(item.id);
      const merged = inventoryChanges.mergedItemIds.includes(item.id);
      const lockHTML = locked ? `<span class="build-item-lock" title="${escape(t('curseLocked'))}" aria-label="${escape(t('curseLocked'))}">${lockIcon}</span>` : '';
      const comboHTML = entry.comboOrigin ? `<span class="build-item-combo-mark" title="${escape(t('comboMark'))}" aria-label="${escape(t('comboMark'))}">◇◇</span>` : '';
      const changeHTML = early || merged ? `<span class="build-item-change" title="${escape(t(early ? 'earlyItem' : 'mergedItem'))}" aria-label="${escape(t(early ? 'earlyItem' : 'mergedItem'))}">${early ? '↟' : '↗'}</span>` : '';
      return `<div class="build-item-slot ${item.category}${flex ? ' is-flex' : ''}${isNew ? ' is-new' : ''}${locked ? ' is-cursed' : ''}${early ? ' is-early' : ''}${merged ? ' is-merged' : ''}" data-build-item-id="${escape(item.id)}" data-build-draw-id="${escape(entry.drawId)}" data-cursed="${locked}" tabindex="0" title="${escape(`${index + 1}. ${name} · T${item.tier} · ${cost} ${t('souls')}${locked ? ` · ${t('curseLocked')}` : ''}`)}"><span class="build-slot-index">${String(index + 1).padStart(2, '0')}</span><span class="build-slot-art">${item.icon ? `<img src="${escape(assetURL(item.icon))}" alt="${escape(name)}">` : `<span class="build-item-fallback">${categoryGlyph[item.category]}</span>`}${lockHTML}</span><span class="build-slot-tier">T${item.tier}</span><span class="build-slot-name">${escape(name)}</span>${flexHTML}${comboHTML}${changeHTML}<span class="build-item-tooltip">${escape(name)}<small>T${item.tier} · ${cost} ${escape(t('souls'))}${flex ? ` · FLEX` : ''}</small>${locked ? `<em>${lockIcon}${escape(t('curseLocked'))}</em>` : ''}${entry.comboOrigin ? `<small>${escape(t('comboMark'))}</small>` : ''}</span></div>`;
    }).join('');
    attachEntryBadges($('#build-inventory'),history,'[data-build-item-id]',getState());
  }

  function attachEntryBadges(host,entries,selector,state,{compact=false}={}) {
    if(!host)return;
    host.querySelectorAll(selector).forEach((node,index)=>{
      const entry=entries[index];if(!entry)return;
      const sealed=isBuildEntrySealed(state,entry,items);
      node.insertAdjacentHTML('beforeend',fateBadgeHTML(entry,language(),{sealed,compact}));
      if(entry.kingImpostor&&!sealed){node.classList.add('is-king-impostor');node.insertAdjacentHTML('beforeend',`<span class="build-impostor-mark">${language()==='ru'?'ПОДДЕЛКА':'IMPOSTOR'}</span>`);}
    });
  }

  function renderBuildRules() {
    const state = getState();
    const enabled = new Set(state.enabledTiers || [1, 2, 3, 4]);
    const currentDistribution = getBuildDistribution();
    // A committed pending draw must not reveal its tier before the reel lands.
    const distribution = itemSpinning ? lastBuildDistribution || currentDistribution : currentDistribution;
    if (!itemSpinning) lastBuildDistribution = currentDistribution;
    const visibleEntries = visibleHistory();
    const maskedStats = Boolean(getNextSealedPurchase({...state,history:visibleEntries,...(itemSpinning?{purchasePlan:pendingPurchasePlan??null}:{})},items));
    const counts = distribution?.tierCounts || Object.fromEntries([1, 2, 3, 4, 5].map(tier => [tier, visibleEntries.filter(entry => itemById.get(entry.itemId)?.tier === tier).length]));
    const factors = distribution?.decayFactors || {};
    const percentages = new Intl.NumberFormat(localeFor(language()), { style: 'percent', maximumFractionDigits: 1 });
    const multipliers = new Intl.NumberFormat(localeFor(language()), { maximumFractionDigits: 4 });
    $('#build-dynamic-weights').checked = state.dynamicWeights !== false;
    $('#build-dynamic-weights').disabled = disabled();
    $('#build-dynamic-weights').title = t('decayHint');
    $('#build-tier-controls').innerHTML = [1, 2, 3, 4, 5].filter(tier => items.some(item => item.tier === tier)).map(tier => {
      const included = enabled.has(tier);
      const probability = distribution?.byTier instanceof Map ? distribution.byTier.get(tier) : distribution?.byTier?.[tier];
      const factor = state.dynamicWeights === false ? 1 : factors[tier] ?? 1;
      const chance = maskedStats ? '—' : percentages.format(Number(probability) || 0);
      const factorText = maskedStats ? '—' : `×${multipliers.format(factor)}`;
      const tooltip = maskedStats ? t('sealedHint') : `${t(included ? 'tierEnabled' : 'tierDisabled')} · ${t('tierCount')}: ${counts[tier] || 0} · ${t('tierChance')}: ${chance} · ${t('decayFactor')}: ${factorText}`;
      return `<button class="build-tier-toggle${included ? ' is-enabled' : ''}" data-build-toggle-tier="${tier}" aria-pressed="${included}" title="${escape(tooltip)}" ${disabled() ? 'disabled' : ''}><span><b>T${tier}</b><i aria-hidden="true">${included ? '✓' : '−'}</i></span><strong>${chance}</strong><small><b data-build-tier-count="${tier}">${maskedStats ? '?' : counts[tier] || 0}</b> ${escape(t('contractItems'))}<em data-build-tier-factor="${tier}">${factorText}</em></small></button>`;
    }).join('');
    const hasPool = distribution ? distribution.eligibleCount > 0 : getItemCandidates().length > 0;
    $('#build-tier-note').textContent = !hasPool && (state.history?.length || 0) < inventorySlots ? t('noItemPool') : `${t('buildTiersHint')} ${state.dynamicWeights !== false ? t('decayHint') : ''}`.trim();
    $('#build-tier-note').classList.toggle('is-empty-pool', !hasPool);
    $('#build-item-random').disabled ||= !hasPool;
  }

  function renderUnlocks() {
    const state = getState();
    const hero = heroById.get(state.heroId);
    const host = $('#build-hero-unlocks');
    host.hidden = !hero || !state.unlockOrder?.length || heroBusy && !revealingHeroId;
    if (host.hidden) { host.innerHTML = ''; return; }
    const abilityBySlot = new Map(hero.abilities.map(ability => [ability.slot, ability]));
    host.innerHTML = `<div class="build-unlocks-heading"><span class="eyebrow">${escape(t('unlocks'))}</span><small>${escape(t('unlocksHint'))}</small></div><div class="build-unlock-order">${state.unlockOrder.map((slot, index) => {
      const ability = abilityBySlot.get(slot);
      const threshold = rules.unlockSoulThresholds?.[index];
      const unlockAt = Number.isFinite(threshold) ? `${new Intl.NumberFormat(localeFor(language())).format(threshold)} ${t('souls')}` : String(slot);
      const revealed = !heroBusy || index < abilityRevealCount;
      return ability ? `<span class="build-unlock ${revealed ? 'is-revealed' : 'is-pending'}" data-build-unlock-order="${index}" data-build-unlock-slot="${slot}" title="${revealed ? escape(nameFor(ability, language())) : ''}" ${revealed ? '' : 'aria-hidden="true"'}><b>${index + 1}</b>${imageHTML(ability, '', 'ability')}<span>${escape(nameFor(ability, language()))}<small>${escape(unlockAt)}</small></span></span>` : '';
    }).join('')}</div>`;
  }

  function skillPlanHTML(state, { readonly = false } = {}) {
    const hero = heroById.get(state.heroId);
    if (!hero || !state.skillPlan?.length) {
      return `<div class="build-no-skills"><span aria-hidden="true">Ⅰ · Ⅱ · Ⅲ · Ⅳ</span><p>${escape(t(hero ? 'missingAbilities' : 'noSkills'))}</p></div>`;
    }
    const abilityBySlot = new Map(hero.abilities.map(ability => [ability.slot, ability]));
    const checked = new Set(state.checkedSkills || []);
    const progress = state.skillPlan.filter((_, index) => checked.has(index)).length;
    const spent = state.skillPlan.reduce((total, step, index) => total + (checked.has(index) ? step.cost : 0), 0);
    const nextIndex = state.skillPlan.findIndex((_, index) => !checked.has(index));
    const nextStep = state.skillPlan[nextIndex];
    const nextAbility = nextStep && abilityBySlot.get(nextStep.slot);
    return `<div class="build-skill-progress"><span class="eyebrow">${escape(t('upgrades'))} <i aria-hidden="true">→</i></span><span>${progress} / ${state.skillPlan.length} ${escape(t('progress'))} · ${spent} / ${state.skillPlan.at(-1).cumulativeCost} AP</span></div><div class="build-timeline-scroll"><div ${readonly ? '' : 'id="build-skills"'} class="build-skills build-timeline${readonly ? ' is-readonly' : ''}" role="table" aria-label="${escape(t('skills'))}"><div class="build-timeline-header" role="row"><span class="build-timeline-corner" role="columnheader">${escape(t('ability'))}</span>${state.skillPlan.map((step, index) => `<span class="build-timeline-column${index === nextIndex ? ' is-next' : ''}" data-build-step-index="${index}" role="columnheader" title="${escape(`${t('step')} ${index + 1} · ${t('spent')} ${step.cumulativeCost} AP`)}"><b>${String(index + 1).padStart(2, '0')}</b><small>${step.cumulativeCost} AP</small></span>`).join('')}</div>${hero.abilities.slice().sort((a, b) => a.slot - b.slot).map(ability => {
      const doneRanks = state.skillPlan.filter((step, index) => step.slot === ability.slot && checked.has(index)).length;
      return `<div class="build-timeline-row" data-build-ability-slot="${ability.slot}" role="row"><div class="build-timeline-ability" role="rowheader">${imageHTML(ability, 'build-skill-icon', 'ability')}<span><strong>${escape(nameFor(ability, language()))}</strong><small><b>${ability.slot}</b><span class="build-rank-dots" aria-hidden="true">${[1, 2, 3].map(rank => `<i class="${rank <= doneRanks ? 'active' : ''}"></i>`).join('')}</span></small></span></div>${state.skillPlan.map((step, index) => {
        const nextClass = index === nextIndex ? ' is-next' : '';
        if (step.slot !== ability.slot) return `<span class="build-timeline-cell${nextClass}" role="cell" aria-hidden="true"></span>`;
        const checkedStep = checked.has(index);
        const description = `${t('step')} ${index + 1}: ${nameFor(ability, language())}, ${t('rank')} ${step.rank} · ${step.cost} AP · ${t('spent')} ${step.cumulativeCost} AP`;
        const tag = readonly ? 'span' : 'label';
        return `<${tag} class="build-timeline-cell build-skill-step${checkedStep ? ' is-done' : ''}${nextClass}" data-build-step-index="${index}" role="cell" title="${escape(description)}">${readonly ? '' : `<input type="checkbox" data-build-skill-index="${index}" ${checkedStep ? 'checked' : ''} ${disabled() ? 'disabled' : ''} aria-label="${escape(description)}">`}<span class="build-skill-diamond" aria-hidden="true"><b>${checkedStep ? '✓' : ['I', 'II', 'III'][step.rank - 1]}</b></span><span class="build-timeline-cost">${step.cost} AP</span></${tag}>`;
      }).join('')}</div>`;
    }).join('')}</div></div><div class="build-skill-footer"><div class="build-next-skill">${nextAbility ? `<span class="eyebrow">${escape(t('next'))}</span>${imageHTML(nextAbility, '', 'ability')}<span><b>${String(nextIndex + 1).padStart(2, '0')}</b> ${escape(nameFor(nextAbility, language()))} <small>· ${escape(t('rank'))} ${nextStep.rank} · ${nextStep.cost} AP</small></span>` : `<span class="build-plan-complete">✓ ${escape(t('skillComplete'))}</span>`}</div><div class="build-skill-meter" role="progressbar" aria-label="${escape(t('progress'))}" aria-valuemin="0" aria-valuemax="${state.skillPlan.length}" aria-valuenow="${progress}"><i></i></div></div>`;
  }

  function renderSkills() {
    const state = getState();
    $('#build-skill-content').innerHTML = skillPlanHTML(state);
    const meter = $('#build-skill-content .build-skill-meter>i');
    if (meter) meter.style.width = `${100 * (state.checkedSkills?.length || 0) / state.skillPlan.length}%`;
  }

  function renderContracts() {
    const stateName = getState().name || '';
    if (stateName !== lastStateName) { contractName = stateName; lastStateName = stateName; }
    const nameInput = $('#build-contract-name');
    if (nameInput.value !== contractName) nameInput.value = contractName;
    nameInput.placeholder = t('contractName');
    nameInput.setAttribute('aria-label', t('contractName'));
    nameInput.disabled = disabled();
    renderContractDraft();
    $('#build-contract-save').disabled = disabled() || !heroById.has(getState().heroId);
    const contracts = getContracts() || [];
    $('#build-contract-count').textContent = String(contracts.length);
    $('#build-contract-notice').textContent = contractNotice ? t(contractNotice) : '';
    $('#build-contract-gallery').innerHTML = contracts.length ? contracts.map(contract => {
      const hero = heroById.get(contract.build?.heroId);
      const date = new Date(contract.savedAt);
      const savedAt = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(localeFor(language()), { day: 'numeric', month: 'short' }).format(date) : '';
      const itemCount = contract.build?.history?.length || 0;
      const rating = Math.min(5, Math.max(0, Math.round(Number(contract.rating) || 0)));
      const comment = typeof contract.comment === 'string' ? contract.comment : '';
      const commentHTML = comment ? comment.length > 220 ? `<div class="build-contract-comment-preview">${escape(comment.slice(0, 180))}…</div><details class="build-contract-comment-details"><summary>${escape(t('contractReadComment'))}</summary><p class="build-contract-comment">${escape(comment)}</p></details>` : `<p class="build-contract-comment">${escape(comment)}</p>` : '';
      const miniItems = (contract.build?.history || []).map(entry => {
        const item = itemById.get(entry.itemId);
        if (!item) return '';
        const locked = entry.cursed || entry.locked;
        if (isBuildEntrySealed(contract.build, entry, items)) return `<span class="is-sealed" title="${escape(t('sealedHint'))}">${SEALED_ITEM_SVG}${locked ? `<i class="build-mini-lock">${lockIcon}</i>` : ''}${fateBadgeHTML(entry,language(),{sealed:true,compact:true})}</span>`;
        return `<span class="${item.category}${locked ? ' is-cursed' : ''}" title="${escape(`${localizedItemName(item, language())} · T${item.tier}${locked ? ` · ${t('curseLocked')}` : ''}`)}">${imageHTML(item, '', 'item')}${locked ? `<i class="build-mini-lock">${lockIcon}</i>` : ''}${fateBadgeHTML(entry,language(),{sealed:false,compact:true})}</span>`;
      }).join('');
      return `<article class="build-contract-card" data-build-contract-id="${escape(contract.id)}">${hero ? imageHTML(hero, 'build-contract-portrait') : '<span class="build-contract-portrait build-image-fallback" aria-hidden="true">◈</span>'}<div class="build-contract-card-copy"><h3 title="${escape(contract.name)}">${escape(contract.name)}</h3><p>${hero ? escape(nameFor(hero, language())) : 'DEADLOCK'} · ${itemCount} ${escape(t('contractItems'))}</p>${miniItems ? `<button class="build-contract-mini-inventory" data-build-contract-preview="${escape(contract.id)}" aria-label="${escape(`${t('previewContract')} · ${contract.name}`)}" ${disabled() ? 'disabled' : ''}>${miniItems}</button>` : ''}<span class="build-contract-rating" data-rating="${rating}" aria-label="${escape(rating ? `${rating} ${t('contractStar')}` : t('contractUnrated'))}">${[1, 2, 3, 4, 5].map(value => `<i class="${value <= rating ? 'is-lit' : ''}" aria-hidden="true">★</i>`).join('')}</span>${commentHTML}<small>${escape(savedAt)}</small></div><div class="build-contract-card-actions"><button class="build-contract-preview" data-build-contract-preview="${escape(contract.id)}" title="${escape(`${t('previewContract')} · ${contract.name}`)}" aria-label="${escape(`${t('previewContract')} · ${contract.name}`)}" ${disabled() ? 'disabled' : ''}><span aria-hidden="true">◈</span><span>${escape(t('previewContract'))}</span></button><button class="build-contract-replay" data-build-contract-load="${escape(contract.id)}" title="${escape(`${t('replayContract')} · ${contract.name}`)}" aria-label="${escape(`${t('replayContract')} · ${contract.name}`)}" ${disabled() ? 'disabled' : ''}><span aria-hidden="true">↻</span><span>${escape(t('replayContract'))}</span></button><button class="build-contract-edit" data-build-contract-edit="${escape(contract.id)}" title="${escape(t('editContract'))}" aria-label="${escape(`${t('editContract')} · ${contract.name}`)}" ${disabled() ? 'disabled' : ''}><span aria-hidden="true">✎</span><span>${escape(t('editContract'))}</span></button><button class="build-contract-delete" data-build-contract-delete="${escape(contract.id)}" title="${escape(`${t('deleteContract')} · ${contract.name}`)}" aria-label="${escape(`${t('deleteContract')} · ${contract.name}`)}" ${disabled() ? 'disabled' : ''}>×</button></div></article>`;
    }).join('') : `<p class="build-contract-empty">${escape(t('noContracts'))}</p>`;
  }

  function renderContractDraft() {
    const ratingHost = $('#build-contract-rating');
    ratingHost.setAttribute('aria-label', t('contractRating'));
    // Keep the clicked button's focus when updating the rating.
    if (!ratingHost.children.length) ratingHost.innerHTML = [1, 2, 3, 4, 5].map(value => `<button type="button" class="build-contract-star" data-build-contract-rating="${value}">★</button>`).join('');
    [...ratingHost.children].forEach((button, index) => {
      const value = index + 1;
      button.setAttribute('aria-pressed', value <= contractRating ? 'true' : 'false');
      button.setAttribute('aria-label', `${value} ${t('contractStar')}`);
      button.title = `${value} ${t('contractStar')}`;
      button.disabled = disabled();
    });
    ratingHost.dataset.rating = String(contractRating);
    const comment = $('#build-contract-comment');
    if (comment.value !== contractComment) comment.value = contractComment;
    comment.placeholder = t('contractCommentHint');
    comment.setAttribute('aria-label', t('contractComment'));
    comment.disabled = disabled();
  }

  function previewInventoryHTML(state) {
    return `<div class="build-inventory build-preview-inventory">${Array.from({ length: inventorySlots }, (_, index) => {
      const entry = state.history?.[index];
      const item = itemById.get(entry?.itemId);
      const flex = index >= (rules.baseInventorySlots || 9);
      if (!item) return `<div class="build-item-slot is-empty${flex ? ' is-flex' : ''}"><span class="build-slot-index">${String(index + 1).padStart(2, '0')}</span><span class="build-empty-plus" aria-hidden="true">＋</span></div>`;
      const locked = Boolean(entry.cursed || entry.locked);
      if (isBuildEntrySealed(state, entry, items)) return `<div class="build-item-slot is-sealed${flex ? ' is-flex' : ''}${locked ? ' is-cursed' : ''}" data-build-preview-item-id="sealed-${index + 1}" data-sealed="true" title="${escape(t('sealedHint'))}"><span class="build-slot-index">${String(index + 1).padStart(2, '0')}</span><span class="build-slot-art">${sealedHTML()}${locked ? `<span class="build-item-lock" aria-label="${escape(t('curseLocked'))}">${lockIcon}</span>` : ''}</span><span class="build-slot-name">${escape(t('sealedItem'))}</span></div>`;
      return `<div class="build-item-slot ${item.category}${flex ? ' is-flex' : ''}${locked ? ' is-cursed' : ''}" data-build-preview-item-id="${escape(item.id)}" data-cursed="${locked}" title="${escape(`${localizedItemName(item, language())} · T${item.tier}${locked ? ` · ${t('curseLocked')}` : ''}`)}"><span class="build-slot-index">${String(index + 1).padStart(2, '0')}</span><span class="build-slot-art">${imageHTML(item, '', 'item')}${locked ? `<span class="build-item-lock" aria-label="${escape(t('curseLocked'))}">${lockIcon}</span>` : ''}</span><span class="build-slot-tier">T${item.tier}</span><span class="build-slot-name">${escape(localizedItemName(item, language()))}</span>${entry.comboOrigin ? `<span class="build-item-combo-mark" title="${escape(t('comboMark'))}">◇◇</span>` : ''}</div>`;
    }).join('')}</div>`;
  }

  function previewUnlocksHTML(state, hero) {
    return `<div class="build-preview-unlocks"><span class="eyebrow">${escape(t('unlocks'))}</span><div class="build-unlock-order">${(state.unlockOrder || []).map((slot, index) => {
      const ability = hero?.abilities?.find(entry => entry.slot === slot);
      return ability ? `<span class="build-unlock"><b>${index + 1}</b>${imageHTML(ability, '', 'ability')}<span>${escape(nameFor(ability, language()))}</span></span>` : '';
    }).join('')}</div></div>`;
  }

  function renderContractDialog() {
    if (!contractDialog) return;
    const content = $('#build-contract-dialog-content');
    const confirmation = contractDialog.kind === 'new' || contractDialog.kind === 'skills';
    if (confirmation) {
      const newBuild = contractDialog.kind === 'new';
      content.innerHTML = `<div class="build-dialog-header"><div><span class="eyebrow">DEADLOCK / CONTRACT</span><h2 id="build-contract-dialog-title">${escape(t(newBuild ? 'confirmNewTitle' : 'confirmSkillsTitle'))}</h2></div><button id="build-contract-dialog-close" class="build-dialog-close" aria-label="${escape(t('close'))}">×</button></div><p class="build-dialog-hint">${escape(t(newBuild ? 'confirmNewHint' : 'confirmSkillsHint'))}</p><div class="build-dialog-actions"><button id="build-confirm-cancel" class="build-secondary">${escape(t('cancel'))}</button><button id="build-confirm-accept" class="build-primary" ${disabled() ? 'disabled' : ''}>${escape(t(newBuild ? 'confirmNewAction' : 'confirmSkillsAction'))}</button></div>`;
      $('#build-contract-dialog').classList.add('is-editor');
      return;
    }
    const contract = (getContracts() || []).find(entry => entry.id === contractDialog.id);
    if (!contract) { closeContractDialog(); return; }
    const state = contract.build;
    const hero = heroById.get(state?.heroId);
    const editing = contractDialog.kind === 'edit';
    $('#build-contract-dialog').classList.toggle('is-editor', editing);
    const header = `<div class="build-dialog-header"><div><span class="eyebrow">${escape(t(editing ? 'editContract' : 'contractPreview'))}</span><h2 id="build-contract-dialog-title">${escape(contract.name)}</h2></div><button id="build-contract-dialog-close" class="build-dialog-close" aria-label="${escape(t('close'))}">×</button></div><p class="build-dialog-hint">${escape(t(editing ? 'contractEditHint' : 'contractPreviewHint'))}</p>`;
    if (editing) {
      content.innerHTML = `${header}<div class="build-dialog-contract-identity">${hero ? imageHTML(hero, 'build-contract-portrait') : ''}<span>${hero ? escape(nameFor(hero, language())) : 'DEADLOCK'}<small>${state.history?.length || 0} ${escape(t('contractItems'))}</small></span></div><label class="build-dialog-field-label">${escape(t('contractRating'))}</label><div id="build-contract-edit-rating" class="build-contract-rating-input" role="group" aria-label="${escape(t('contractRating'))}">${[1, 2, 3, 4, 5].map(value => `<button type="button" class="build-contract-star" data-build-contract-edit-rating="${value}" aria-label="${escape(`${value} ${t('contractStar')}`)}">★</button>`).join('')}</div><label class="build-dialog-field-label" for="build-contract-edit-comment">${escape(t('contractComment'))}</label><textarea id="build-contract-edit-comment" maxlength="1000" rows="5" placeholder="${escape(t('contractCommentHint'))}"></textarea><div class="build-dialog-actions"><button id="build-contract-dialog-cancel" class="build-secondary">${escape(t('cancel'))}</button><button id="build-contract-edit-save" class="build-primary" ${disabled() ? 'disabled' : ''}>${escape(t('saveChanges'))}</button></div>`;
      $('#build-contract-edit-comment').value = contractDialog.comment;
      updateContractEditRating();
      return;
    }
    const rating = Number(contract.rating) || 0;
    content.innerHTML = `${header}<div class="build-preview-top"><div class="build-preview-hero">${hero ? imageHTML(hero, 'build-preview-portrait') : ''}<h3>${hero ? escape(nameFor(hero, language())) : 'DEADLOCK'}</h3><div class="build-contract-rating" aria-label="${escape(rating ? `${rating} ${t('contractStar')}` : t('contractUnrated'))}">${[1, 2, 3, 4, 5].map(value => `<i class="${value <= rating ? 'is-lit' : ''}" aria-hidden="true">★</i>`).join('')}</div>${contract.comment ? `<p class="build-contract-comment-preview">${escape(contract.comment)}</p>` : ''}${previewUnlocksHTML(state, hero)}</div><div class="build-preview-items"><div class="panel-heading"><h3>${escape(t('inventory'))}</h3><span>${state.history?.length || 0} / ${inventorySlots}</span></div>${previewInventoryHTML(state)}<section class="build-purchase-plan build-preview-purchase-plan">${purchasePlanHTML(state)}</section></div></div><section class="build-preview-skills"><h3>${escape(t('skills'))}</h3>${skillPlanHTML(state, { readonly: true })}</section><div class="build-dialog-actions"><button id="build-contract-dialog-cancel" class="build-secondary">${escape(t('close'))}</button></div>`;
    content.querySelector('.build-dialog-actions').insertAdjacentHTML('beforeend', `<button id="build-contract-newspaper-button" class="build-secondary">${escape(t('newspaper'))}</button>`);
    content.querySelector('.build-preview-skills').insertAdjacentHTML('beforebegin',`<details class="build-event-history build-preview-event-history"><summary><span>${escape(t('eventHistory'))}</span><span>${getBuildFateJournal(state,items).length}</span><span aria-hidden="true">＋</span></summary><div class="build-event-history-list">${eventHistoryHTML(state)}</div></details>`);
    attachEntryBadges(content.querySelector('.build-preview-inventory'),state.history||[],'[data-build-preview-item-id]',state);
    attachEntryBadges(content.querySelector('.build-preview-purchase-plan'),getBuildPurchasePlan(state,items),'.build-purchase-step',state,{compact:true});
    const meter = content.querySelector('.build-skill-meter>i');
    if (meter) meter.style.width = `${100 * (state.checkedSkills?.length || 0) / state.skillPlan.length}%`;
  }

  function updateContractEditRating() {
    if (contractDialog?.kind !== 'edit') return;
    const host = $('#build-contract-edit-rating');
    if (!host) return;
    host.dataset.rating = String(contractDialog.rating);
    host.querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-pressed', Number(button.dataset.buildContractEditRating) <= contractDialog.rating ? 'true' : 'false');
      button.disabled = disabled();
    });
  }

  function openContractDialog(kind, id) {
    if (disabled()) return;
    const contract = (getContracts() || []).find(entry => entry.id === id);
    if ((kind === 'preview' || kind === 'edit') && !contract) return;
    contractDialog = { kind, id, rating: contract?.rating || 0, comment: contract?.comment || '' };
    renderContractDialog();
    const dialog = $('#build-contract-dialog');
    if (!dialog.open) dialog.showModal();
    const defaultFocus = kind === 'new' || kind === 'skills' ? $('#build-confirm-cancel') : kind === 'edit' ? $('#build-contract-edit-comment') : $('#build-contract-dialog-close');
    defaultFocus?.focus({ preventScroll: true });
  }

  function closeContractDialog() {
    contractDialog = null;
    $('#build-contract-dialog').close();
  }

  function renderControls() {
    root.querySelectorAll('[data-build-copy]').forEach(element => { element.textContent = t(element.dataset.buildCopy); });
    $('#build-new-button').title = t('newHint');
    $('#build-hero-search').placeholder = t('search');
    $('#build-hero-search').setAttribute('aria-label', t('search'));
    const count = enabledHeroes().length;
    $('#build-hero-count').textContent = count ? `${count} / ${heroes.length} ${t('candidates')}` : t('noPool');
    $('#build-pool-count').textContent = `${count} / ${heroes.length}`;
    $('#build-hero-random').textContent = heroBusy ? t('scanning') : t(getState().heroId ? 'rerollHero' : 'chooseHero');
    $('#build-hero-random').disabled = disabled() || count === 0;
    $('#build-new-button').disabled = disabled();
    $('#build-skill-random').disabled = disabled() || !heroById.has(getState().heroId);
    const totalLocked = getState().fate?.totalLocked === true;
    $('#build-item-random').disabled = disabled() || totalLocked || !heroById.has(getState().heroId);
    const cursedLatest = latestEntries().some(entry => entry.cursed || entry.locked);
    const canUndo=canUndoBuildDraw(getState()),fate=getState().fate||{};
    $('#build-item-undo').disabled = disabled() || !canUndo;
    $('#build-item-undo').title = t(totalLocked?'fateLockedAction':fate.pendingChicken?'pendingChickenHint':fate.pendingKing?'pendingKingHint':fate.pendingArchmother?'motherPending':fate.kingImpostorQueue?.length?'kingQueueHint':cursedLatest?'actionCursed':!canUndo&&fate.kingMode&&fate.kingMode!=='veil'?'royalUndoHint':'undoHint');
    $('#build-poster-button').disabled = disabled() || !heroById.has(getState().heroId);
    $('#build-newspaper-button').disabled = disabled() || !heroById.has(getState().heroId);
    const availability = getItemActionAvailability();
    for (const action of ['reroll','upgrade','downgrade']) {
      const button = $(`#build-${action}-button`);
      const state = availability[action] || { disabled: true, reason: 'missing-item' };
      button.disabled = disabled() || totalLocked || state.disabled;
      const spent = getState().itemActions?.usedActions?.includes(action) || state.reason === 'used';
      button.dataset.spent = String(spent);
      button.querySelector('.build-action-charge').textContent = t(spent ? 'spentCharge' : 'singleCharge');
      button.title = t(({ used: 'actionUsed', modified: 'actionModified', cursed: 'actionCursed', locked: 'actionCursed', fateLocked:'fateLockedAction',pendingOffer:'motherPending',pendingChicken:'pendingChickenHint',pendingKing:'pendingKingHint',kingQueue:'kingQueueHint',royalSeal:'royalSealHint','missing-item': 'actionMissing', emptyPool: 'actionEmpty', 'empty-pool': 'actionEmpty' })[state.reason] || 'actionHint');
    }
    $('#build-heroes-all').disabled = disabled();
    $('#build-heroes-none').disabled = disabled();
    $('#build-hero-search').disabled = disabled();
    const chance = Math.min(100, Math.max(0, Number(getCurseChance()) || 0));
    const chanceSlider = $('#build-curse-chance');
    chanceSlider.value = String(chance);
    chanceSlider.disabled = disabled();
    chanceSlider.setAttribute('aria-label', t('curseChance'));
    chanceSlider.style.setProperty('--curse-progress', `${chance}%`);
    $('#build-curse-chance-output').textContent = `${chance}%`;
    $('#build-pairs-enabled').checked = getPairsEnabled() !== false;
    $('#build-pairs-enabled').disabled = disabled();
    renderFateControls();
  }

  function renderFateControls() {
    const state = getState();
    const fate = state.fate || {};
    const prefs = getFatePreferences();
    for (const key of ['chickenChance','archmotherChance','hiddenKingChance']) {
      const value = typeof prefs[key] === 'number' ? prefs[key] : .1;
      const percentage = Math.round(Math.min(1, Math.max(0, value)) * 100);
      const input = $(`#build-${key}`);
      input.value = String(percentage); input.disabled = disabled(); input.style.setProperty('--fate-progress', `${percentage}%`);
      input.setAttribute('aria-label', t(({ chickenChance:'chicken',archmotherChance:'archmother',hiddenKingChance:'hiddenKing' })[key]));
      $(`#build-${key}-output`).textContent = `${percentage}%`;
      const text = key === 'chickenChance' ? fate.chickenUsed ? 'fateSpent' : state.history.length < 3 ? 'chickenWaiting' : 'fateWaiting'
        : key === 'archmotherChance' ? fate.pendingArchmother ? 'motherPending' : fate.archmotherUsed ? 'fateSpent' : 'fateWaiting'
          : fate.kingActive ? 'kingActive' : state.history.length < 5 ? 'kingWaiting' : 'fateWaiting';
      const spent = key === 'chickenChance' ? fate.chickenUsed : key === 'archmotherChance' ? fate.archmotherUsed : fate.kingActive;
      const kind=key==='hiddenKingChance'?'king':key==='archmotherChance'?'archmother':'chicken';
      const setting=input.closest('.build-fate-setting'); setting.dataset.triggered=String(Boolean(spent));
      $(`#build-${key}-state`).innerHTML = `${spent ? `<i aria-hidden="true">${FATE_PRESENTATION[kind].svg}</i><b>${escape(t('eventTriggered'))}</b>` : '<i aria-hidden="true">◌</i>'}<span>${escape(t(text))}</span>`;
    }
    const banner = $('#build-fate-locked-banner'); banner.hidden = !fate.totalLocked; banner.textContent = t('totalLocked');
    const resume = $('#build-archmother-resume'); resume.hidden = !fate.pendingArchmother; resume.textContent = t('motherTitle'); resume.disabled = heroBusy || itemSpinning || fateBusy;
    const kingResume=$('#build-king-resume');kingResume.hidden=!fate.pendingKing;kingResume.textContent=language()==='ru'?'Продолжить сделку с Королём':'Continue the King’s deal';kingResume.disabled=heroBusy||itemSpinning||fateBusy;
    renderKingBanner();
    const visibleState = { ...state, history: visibleHistory(), ...(itemSpinning ? { purchasePlan: pendingPurchasePlan ?? null } : {}) };
    const next = getNextSealedPurchase(visibleState, items);
    const reveal = $('#build-reveal-next'); reveal.hidden = !next;
    reveal.disabled = disabled() || !next;
    if (next) {
      const index = getBuildPurchasePlan(visibleState, items).findIndex(entry => entry.itemId === next.itemId) + 1;
      reveal.querySelector('span').textContent = `${t('revealPurchase')} · ${t('revealStep')} ${String(index).padStart(2,'0')}`;
      reveal.querySelector('small').textContent = t('revealHint');
    }
    if ($('#build-archmother-dialog').open && archmotherOffer) renderArchmotherOffer(archmotherOffer);
    renderEventHistory();
  }

  function eventItemHTML(entry,state,{snapshot=false}={}) {
    const item=itemById.get(entry?.itemId);
    if(!item)return '';
    const sealed=snapshot?entry.sealed===true:isBuildEntrySealed(state,entry,items);
    const name=sealed?t('sealedItem'):localizedItemName(item,language());
    return `<span class="build-event-item${sealed?' is-sealed':''}" data-sealed="${sealed}" title="${escape(name)}">${sealed?sealedHTML():imageHTML(item,'','item')}<small>${escape(name)}</small>${fateBadgeHTML(entry,language(),{sealed,compact:true})}</span>`;
  }

  function eventHistoryHTML(state) {
    const journal=getBuildFateJournal(state,items);
    if(!journal.length)return `<p class="build-event-empty">${escape(t('eventEmpty'))}</p>`;
    return [...journal].reverse().map(event=>{
      const kind=event.kind==='hidden-king'?'king':event.kind;
      const palette=FATE_PRESENTATION[kind];
      const title=t(kind==='king'?'hiddenKing':kind);
      const date=new Date(event.time);const time=Number.isFinite(date.getTime())?new Intl.DateTimeFormat(localeFor(language()),{hour:'2-digit',minute:'2-digit'}).format(date):'';
      const edict=event.edict?language()==='ru'?({spirit:'Вес спирита ×6',vitality:'Вес ХП ×6','no-t1':'Без T1'})[event.edict]:({spirit:'Spirit weight ×6',vitality:'Vitality weight ×6','no-t1':'No T1'})[event.edict]:'';
      const kingCopy=event.mode?kingDealCopy(event.mode):null;
      const content=kind==='chicken'?`<span class="build-event-die">D12 <b>${event.die}</b></span><p>${escape(event.fullReroll?t('totalLocked'):`${t('eventLoss')}: ${event.removedEntries?.length||0}`)}</p><div class="build-event-items">${(event.removedEntries||[]).map(entry=>eventItemHTML(entry,state,{snapshot:true})).join('')}</div>`:kind==='archmother'?`<p>${escape(t('eventChosen'))}</p><div class="build-event-items">${eventItemHTML(event.chosenEntry,state)}</div>`:`<p>${escape(kingCopy?`${kingCopy[0]}${edict?` · ${edict}`:''}`:t('eventKing'))}</p>${kingCopy?`<p>${escape(kingCopy[1])}</p>`:''}${event.sacrificedEntries?.length?`<div class="build-event-items">${event.sacrificedEntries.map(entry=>eventItemHTML(entry,state,{snapshot:true})).join('')}</div>`:''}`;
      return `<article class="build-event-entry" data-event-kind="${kind}"><header><i aria-hidden="true">${palette.svg}</i><b>${escape(title)}</b><time>${escape(time)}</time><span>${escape(t('eventTriggered'))}</span></header><div class="build-event-entry-content">${content}</div></article>`;
    }).join('');
  }

  function renderEventHistory() {
    const journal=getBuildFateJournal(getState(),items);
    $('#build-event-history .build-event-history-title').textContent=t('eventHistory');
    $('#build-event-history .build-event-history-count').textContent=String(journal.length);
    $('#build-event-history .build-event-history-list').innerHTML=eventHistoryHTML(getState());
  }

  function openFateInfo(kind) {
    const palette=FATE_PRESENTATION[kind];if(!palette)return;
    const dialog=$('#build-fate-info-dialog');dialog.dataset.fateKind=kind;
    dialog.querySelector('.build-fate-info-mark').innerHTML=palette.svg;
    dialog.querySelector('h2').textContent=t(kind==='king'?'hiddenKing':kind==='curse'?'curseChance':kind);
    const ru=language()==='ru';
    const details=kind==='chicken'?(ru?['После трёх предметов она может появиться и бросить D12.','1–6: исчезает последняя покупка. 7–9: две последние. 10–11: три последние.','12: инвентарь очищается и заново разыгрываются 12 предметов с замками. Их нельзя менять и отменять.','Бросок останавливается на результате. Только твоя кнопка «Продолжить» запускает потерю предметов.']:['After three items she may appear and roll a D12.','1–6: lose the latest purchase. 7–9: the latest two. 10–11: the latest three.','12: the inventory is cleared and 12 locked items are drawn again. They cannot be altered or undone.','The die holds its result. Only your Continue button starts the item loss.']):kind==='archmother'?(ru?['Три вертикальных барабана показывают три разных одиночных предмета.','После остановки всех барабанов выбери один дар. Два остальных остаются в пуле.','Под печатью Тайного короля дары закрыты: выбор вслепую, открытие по очереди покупок.']:['Three vertical reels offer three different single items.','When all reels land, choose one gift. The other two stay in the pool.','Under the King’s seal the gifts are face down: choose blind, reveal in purchase order.']):kind==='king'?(ru?['Тайный король может прийти после пяти предметов в инвентаре.','Уже открытые предметы остаются видны. Все будущие покупки скрывают имя, картинку, тир и цену.','Кнопка раскрывает только следующий закрытый шаг маршрута. Сами предметы уже определены — открытие их не меняет.']:['The Hidden King may appear after five items in the inventory.','Known items stay visible. Every future purchase conceals its name, art, tier and price.','The reveal button opens only the next sealed purchase step. The items are already determined; revealing does not reroll them.']):(ru?['Каждый обычный предмет отдельно может вызвать проклятие.','Следом разыгрывается дополнительный предмет с замком: его нельзя рероллить, улучшать, понижать или отменять.','Проклятый предмет не вызывает ещё одно проклятие. В двойной находке обе части проверяются отдельно.']:['Every ordinary item independently may trigger a curse.','An extra locked item is drawn next. It cannot be rerolled, upgraded, downgraded or undone.','A cursed item cannot trigger another curse. Both halves of a double drop are checked independently.']);
    const shownDetails=kind==='king'?[ru?'Король приходит после пяти предметов. Выбери одну доступную сделку:':'The King arrives after five items. Choose one eligible deal:',...['exchange','treasury','impostor','decree'].map(mode=>kingDealCopy(mode).slice(0,2).join(' — ')),ru?'Все фильтры предметов сохраняются. Закрытые награды открываются только по очереди покупок.':'All item filters remain in force. Sealed rewards open only in purchase order.']:details;
    dialog.querySelector('.build-fate-info-content').innerHTML=`<ol>${shownDetails.map(text=>`<li>${escape(text)}</li>`).join('')}</ol>${kind!=='curse'?`<p class="build-fate-info-reset">${escape(t('eventReset'))}</p>`:''}`;
    dialog.querySelector('button').textContent=t('close');dialog.showModal();dialog.querySelector('button').focus({preventScroll:true});
  }

  function kingDealCopy(mode) {
    const ru=language()==='ru';
    const copy={
      exchange:ru?['Королевский обмен','Отдай один непроклятый предмет. Получи закрытый предмет другого тира или связку, если хватает места.','↟']:['Royal exchange','Sacrifice one non-cursed item. Receive a sealed item of a different tier, or a pair if it fits.','↟'],
      treasury:ru?['Сокровищница','Три последние покупки исчезнут. Вместо них — предмет T4 и двойная находка.','◇◇']:['The treasury','Your three latest purchases vanish. Receive a T4 item and a double drop instead.','◇◇'],
      impostor:ru?['Самозванец','Следующие три покупки — золотые свёртки: два предмета T3/T4 и одна подделка T1. Узнаешь только при открытии.','?']:['The impostor','The next three purchases are golden parcels: two T3/T4 items and one T1 fake. Discover it only upon opening.','?'],
      decree:ru?['Королевский указ','На остаток билда: вес спирита ×6, вес ХП ×6 или полный запрет T1. Доступный указ выбирает Король.','⚑']:['Royal decree','For the rest of this build: Spirit weight ×6, Vitality weight ×6, or no T1. The King chooses an eligible edict.','⚑'],
      veil:ru?['Печать Короля','Будущие покупки закрыты. Открывай их по очереди в маршруте.','◇']:['The King’s seal','Future purchases are sealed. Reveal them in purchase order.','◇'],
    };
    return copy[mode]||copy.veil;
  }

  function renderKingBanner() {
    const state=getState(),fate=state.fate||{},banner=$('#build-king-deal-banner');
    banner.hidden=!fate.kingMode;if(banner.hidden)return;
    const [title,hint]=kingDealCopy(fate.kingMode);
    const edict=fate.kingEdict?language()==='ru'?({spirit:'Вес спирита ×6',vitality:'Вес ХП ×6','no-t1':'Без предметов T1'})[fate.kingEdict]:({spirit:'Spirit weight ×6',vitality:'Vitality weight ×6','no-t1':'No T1 items'})[fate.kingEdict]:'';
    banner.dataset.kingMode=fate.kingMode;
    banner.innerHTML=`<i aria-hidden="true">${FATE_PRESENTATION.king.svg}</i><span><b>${escape(title)}${edict?` · ${escape(edict)}`:''}</b><small>${escape(hint)}</small></span>`;
    const unveiled=(state.history||[]).filter(entry=>entry.kingImpostor&&!isBuildEntrySealed(state,entry,items));
    for(const entry of unveiled){
      root.querySelectorAll(`[data-build-item-id="${CSS.escape(entry.itemId)}"],[data-purchase-item-id="${CSS.escape(entry.itemId)}"]`).forEach(node=>{
        node.classList.add('is-king-impostor');
        if(!node.querySelector('.build-impostor-mark'))node.insertAdjacentHTML('beforeend',`<span class="build-impostor-mark">${language()==='ru'?'ПОДДЕЛКА':'IMPOSTOR'}</span>`);
      });
    }
  }

  function render({ spinning = itemSpinning, beforeHistory, beforePurchasePlan } = {}) {
    if (destroyed) return;
    itemSpinning = Boolean(spinning);
    const keys = new Set(getState().fate?.revealedPurchaseKeys || []);
    justRevealedItemIds = new Set([...keys].filter(key => !lastRevealedKeys.has(key)).map(key => key.slice(key.lastIndexOf(':') + 1)));
    lastRevealedKeys = keys;
    if (Array.isArray(beforeHistory)) pendingHistory = beforeHistory.slice();
    if (beforePurchasePlan !== undefined) pendingPurchasePlan = Array.isArray(beforePurchasePlan) ? beforePurchasePlan.slice() : null;
    if (!itemSpinning && !itemAnimation) { pendingHistory = null; pendingPurchasePlan = undefined; }
    renderControls();
    renderHero();
    renderPoster();
    renderUnlocks();
    renderPool();
    renderInventory();
    renderPurchasePlan();
    renderBuildRules();
    if (!itemAnimation && !itemSpinning) {
      scannerItem = latestTicket();
      scannerSealed = Boolean(scannerItem?.sealed);
      scannerState = scannerItem ? 'revealed' : 'idle';
      scannerSlot = scannerItem ? latestSlot() : 0;
    }
    renderItemScanner();
    renderSkills();
    renderContracts();
    renderKingBanner();
    for (const id of justRevealedItemIds) root.querySelectorAll(`[data-build-item-id="${CSS.escape(id)}"],[data-purchase-item-id="${CSS.escape(id)}"]`).forEach(node => node.classList.add('is-unsealing'));
    if ($('#build-contract-dialog').open) renderContractDialog();
  }

  function storeHero(hero) {
    const plan = generateSkillPlan(hero, { costs });
    commit(state => {
      state.heroId = hero.id;
      state.skillPlan = plan.skillPlan;
      state.unlockOrder = plan.unlockOrder;
      state.checkedSkills = [];
      state.generatedAt = Date.now();
    });
  }

  async function chooseHero() {
    if (disabled()) return;
    const winner = pickHero(heroes, getState().excludedHeroIds);
    if (!winner) return;
    heroBusy = true;
    abilityRevealCount = 0;
    revealingHeroId = null;
    onHeroBusyChange(true);
    renderPoster();
    renderControls();
    renderPool();
    renderSkills();
    renderContracts();
    renderUnlocks();
    renderBuildRules();
    const pool = enabledHeroes();
    const card = $('#build-hero-card');
    heroReel?.resizeObserver?.disconnect();
    card.dataset.state = 'scanning';
    card.classList.add('has-hero');
    heroReel = mountReel(card, 'hero', createReelPlan(pool, winner, { quick: getQuick() }), winner);
    centerStages();
    await runReel(heroReel, { onTick: onHeroTick, onImpact: onHeroImpact });
    if (destroyed) return;
    revealingHeroId = winner.id;
    storeHero(winner);
    render();
    onHeroReveal(winner);
    const abilityBySlot = new Map(winner.abilities.map(ability => [ability.slot, ability]));
    for (const [index, slot] of getState().unlockOrder.entries()) {
      await new Promise(resolve => {
        abilityWaitResolve = resolve;
        const delay = reducedMotion ? 0 : getQuick() ? 130 : index === 0 ? 220 : 360;
        abilityTimer = setTimeout(() => { abilityWaitResolve = null; resolve(); }, delay);
      });
      if (destroyed) return;
      abilityRevealCount = index + 1;
      const ability = abilityBySlot.get(slot);
      for (const selector of [`[data-build-unlock-order="${index}"]`, `.build-ability-preview [data-build-ability-reveal="${index}"]`]) {
        const icon = $(selector);
        if (!icon) continue;
        icon.classList.remove('is-pending');
        icon.classList.add('is-revealed', 'is-pulse');
        icon.removeAttribute('aria-hidden');
        icon.title = ability ? nameFor(ability, language()) : '';
      }
      if (ability) onAbilityReveal(ability, index);
    }
    heroBusy = false;
    revealingHeroId = null;
    renderControls();
    renderBuildRules();
    renderPool();
    renderSkills();
    renderContracts();
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      card.classList.remove('is-revealed', 'is-impact');
      root.querySelectorAll('.build-unlock.is-pulse, .build-ability-preview .is-pulse').forEach(icon => icon.classList.remove('is-pulse'));
    }, 900);
    onHeroBusyChange(false);
  }

  function startNewBuild() {
    contractNotice = '';
    contractName = '';
    contractRating = 0;
    contractComment = '';
    if (onNewBuild) onNewBuild();
    else commit(state => { state.heroId = null; state.history = []; state.purchasePlan = []; state.skillPlan = []; state.checkedSkills = []; state.unlockOrder = []; state.generatedAt = null; });
    render();
  }

  function handleClick(event) {
    const dialog = $('#build-contract-dialog');
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeContractDialog();
      return;
    }
    const target = event.target.closest('button');
    if (!target || !root.contains(target) || target.disabled) return;
    if (dialog.open && !dialog.contains(target)) return;
    if (['build-contract-dialog-close', 'build-contract-dialog-cancel', 'build-confirm-cancel'].includes(target.id)) { closeContractDialog(); return; }
    if (target.id === 'build-confirm-accept' && !disabled()) {
      const kind = contractDialog?.kind;
      closeContractDialog();
      if (kind === 'new') startNewBuild();
      if (kind === 'skills') {
        const hero = heroById.get(getState().heroId);
        if (hero) storeHero(hero);
        render();
      }
      return;
    }
    if (target.dataset.fateInfo) { openFateInfo(target.dataset.fateInfo); return; }
    if (target.id === 'build-fate-info-close') { $('#build-fate-info-dialog').close(); return; }
    if (target.id === 'build-hero-random') chooseHero();
    if (target.id === 'build-heroes-all') {
      commit(state => { state.excludedHeroIds = []; }); render();
    }
    if (target.id === 'build-heroes-none') {
      commit(state => { state.excludedHeroIds = heroes.map(hero => hero.id); }); render();
    }
    if (target.dataset.buildHeroId && !disabled()) {
      const id = target.dataset.buildHeroId;
      commit(state => { state.excludedHeroIds = state.excludedHeroIds.includes(id) ? state.excludedHeroIds.filter(value => value !== id) : [...state.excludedHeroIds, id]; }); render();
    }
    if (target.id === 'build-skill-random' && !disabled()) {
      openContractDialog('skills');
    }
    if (target.id === 'build-new-button' && !disabled()) {
      openContractDialog('new');
    }
    if (target.id === 'build-item-random' && !disabled()) onRequestItemSpin();
    if (target.dataset.buildItemAction && !disabled() && !target.disabled) onRequestItemAction(target.dataset.buildItemAction);
    if (target.id === 'build-poster-button' && !disabled() && !target.disabled) onExportPoster();
    if (target.id === 'build-newspaper-button' && !disabled()) onRequestNewspaper({ build: structuredClone(getState()) });
    if (target.id === 'build-contract-newspaper-button' && !disabled()) {
      const contract = (getContracts() || []).find(entry => entry.id === contractDialog?.id);
      if (contract) { closeContractDialog(); onRequestNewspaper({ build: structuredClone(contract.build), contract }); }
    }
    if (target.id === 'build-reveal-next' && !disabled()) onRevealNextPurchase();
    if (target.id === 'build-archmother-resume' && !heroBusy && !itemSpinning && !fateBusy) onChooseArchmother();
    if (target.id === 'build-king-resume' && !heroBusy && !itemSpinning && !fateBusy) onChooseKing();
    if (target.id === 'build-item-undo' && !disabled()) { newlyDrawnItem = null; onUndoBuildItem(); render(); }
    if (target.dataset.buildToggleTier && !disabled()) {
      const tier = Number(target.dataset.buildToggleTier);
      commit(state => { const enabled = new Set(state.enabledTiers || [1, 2, 3, 4]); if (enabled.has(tier)) enabled.delete(tier); else enabled.add(tier); state.enabledTiers = [...enabled].sort((a, b) => a - b); });
      render();
    }
    if (target.id === 'build-contract-save' && !disabled()) {
      if (onSaveContract(contractName.trim(), { rating: contractRating, comment: contractComment }) !== false) {
        contractNotice = 'contractSaved';
        $('.build-contract-archive').open = true;
      }
      renderContracts();
    }
    if (target.dataset.buildContractRating && !disabled()) {
      const rating = Number(target.dataset.buildContractRating);
      contractRating = contractRating === rating ? 0 : rating;
      renderContractDraft();
    }
    if (target.dataset.buildContractLoad && !disabled()) {
      const contract = (getContracts() || []).find(entry => entry.id === target.dataset.buildContractLoad);
      if (contract && onLoadContract(contract.id) !== false) {
        contractName = contract.name;
        contractRating = contract.rating || 0;
        contractComment = contract.comment || '';
        contractNotice = 'contractLoaded';
      }
      render();
    }
    if (target.dataset.buildContractDelete && !disabled()) {
      if (onDeleteContract(target.dataset.buildContractDelete) !== false) contractNotice = 'contractDeleted';
      renderContracts();
    }
    if (target.dataset.buildContractPreview && !disabled()) openContractDialog('preview', target.dataset.buildContractPreview);
    if (target.dataset.buildContractEdit && !disabled()) openContractDialog('edit', target.dataset.buildContractEdit);
    if (target.dataset.buildContractEditRating && !disabled() && contractDialog?.kind === 'edit') {
      const rating = Number(target.dataset.buildContractEditRating);
      contractDialog.rating = contractDialog.rating === rating ? 0 : rating;
      updateContractEditRating();
    }
    if (target.id === 'build-contract-edit-save' && !disabled() && contractDialog?.kind === 'edit') {
      if (onUpdateContract(contractDialog.id, { rating: contractDialog.rating, comment: contractDialog.comment }) !== false) {
        contractNotice = 'contractUpdated';
        closeContractDialog();
        renderContracts();
      }
    }
  }

  function handleInput(event) {
    if (event.target.dataset.fatePreference && !disabled()) {
      const key = event.target.dataset.fatePreference;
      const percentage = Math.min(100,Math.max(0,Number(event.target.value)||0));
      $(`#build-${key}-output`).textContent = `${percentage}%`;
      event.target.style.setProperty('--fate-progress',`${percentage}%`);
      onFatePreferenceChange(key, percentage / 100);
    }
    if (event.target.id === 'build-curse-chance' && !disabled()) {
      const chance = Math.min(100, Math.max(0, Number(event.target.value) || 0));
      $('#build-curse-chance-output').textContent = `${chance}%`;
      event.target.style.setProperty('--curse-progress', `${chance}%`);
      onCurseChanceChange(chance);
    }
    if (event.target.id === 'build-hero-search') { search = event.target.value; renderPool(); }
    if (event.target.id === 'build-contract-name') { contractName = event.target.value; contractNotice = ''; $('#build-contract-notice').textContent = ''; }
    if (event.target.id === 'build-contract-comment') { contractComment = event.target.value; contractNotice = ''; $('#build-contract-notice').textContent = ''; }
    if (event.target.id === 'build-contract-edit-comment' && contractDialog?.kind === 'edit') contractDialog.comment = event.target.value;
  }

  function handleKeydown(event) {
    if (event.target.id === 'build-contract-name' && event.key === 'Enter') { event.preventDefault(); $('#build-contract-save').click(); }
  }

  function handleChange(event) {
    if (event.target.id === 'build-pairs-enabled' && !disabled()) {
      onPairsEnabledChange(event.target.checked);
      render();
      return;
    }
    if (event.target.id === 'build-dynamic-weights' && !disabled()) {
      const enabled = event.target.checked;
      commit(state => { state.dynamicWeights = enabled; });
      render();
      return;
    }
    if (!event.target.matches('[data-build-skill-index]') || disabled()) return;
    const index = Number(event.target.dataset.buildSkillIndex);
    const checked = event.target.checked;
    commit(state => { const set = new Set(state.checkedSkills); if (checked) set.add(index); else set.delete(index); state.checkedSkills = [...set].sort((a, b) => a - b); });
    renderSkills();
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('input', handleInput);
  root.addEventListener('change', handleChange);
  root.addEventListener('keydown', handleKeydown);
  const handleDialogClose = () => { if (!$('#build-contract-dialog').open) contractDialog = null; };
  $('#build-contract-dialog').addEventListener('close', handleDialogClose);
  $('#build-contract-dialog').addEventListener('cancel', handleDialogClose);
  render();

  function flashCurse() {
    if (destroyed) return Promise.resolve();
    curseTimers.forEach(clearTimeout);
    curseTimers = [];
    curseResolve?.();
    const scanner = $('#build-item-scanner');
    scanner.querySelector('.build-curse-flash')?.remove();
    scanner.classList.remove('is-curse-omen');
    // A new class starts the strike even when the previous draw used the same reel.
    void scanner.offsetWidth;
    scanner.classList.add('is-curse-omen');
    scanner.dataset.curse = 'omen';
    const overlay = document.createElement('div');
    overlay.className = 'build-curse-flash';
    const timing = curseTiming({ quick: getQuick(), reducedMotion });
    overlay.dataset.phase = 'appear';
    overlay.style.setProperty('--curse-duration', `${timing.total}ms`);
    overlay.style.setProperty('--curse-appear', `${timing.appear}ms`);
    overlay.style.setProperty('--curse-disappear', `${timing.disappear}ms`);
    overlay.innerHTML = `<div class="build-curse-sigil" aria-hidden="true"><i></i><b>${lockIcon}</b><i></i></div><span class="eyebrow">${escape(t('curse'))}</span><strong>${escape(t('curseWarning'))}</strong><small>${escape(t('curseHint'))}</small>`;
    overlay.setAttribute('role', 'status');
    scanner.append(overlay);
    return new Promise(resolve => {
      curseResolve = resolve;
      curseTimers.push(setTimeout(() => { overlay.dataset.phase = 'hold'; }, timing.appear));
      curseTimers.push(setTimeout(() => { overlay.dataset.phase = 'disappear'; }, timing.appear + timing.hold));
      curseTimers.push(setTimeout(() => {
        scanner.classList.remove('is-curse-omen');
        delete scanner.dataset.curse;
        overlay.remove();
        curseResolve = null;
        resolve();
        curseTimers = [];
      }, timing.total));
    });
  }

  function addCurseSeal(scanner) {
    if (scanner.querySelector('.build-scanner-curse-seal')) return;
    const seal = document.createElement('span');
    seal.className = 'build-scanner-curse-seal';
    seal.innerHTML = `${lockIcon}<span>${escape(t('curse'))}</span>`;
    seal.title = t('curseLocked');
    scanner.append(seal);
  }

  function showInventoryChanges(changes = {}) {
    inventoryChanges = {
      insertedItemIds: Array.isArray(changes.insertedItemIds) ? changes.insertedItemIds.slice() : [],
      mergedItemIds: Array.isArray(changes.mergedItemIds) && changes.mergedItemIds.length ? [...new Set([...changes.mergedItemIds, ...(changes.insertedItemIds || [])])] : [],
      earlyItemIds: Array.isArray(changes.earlyItemIds) ? changes.earlyItemIds.slice() : [],
    };
    renderInventory();
    const note = $('#build-inventory-note');
    const notices = [];
    if (inventoryChanges.mergedItemIds.length) notices.push(t('mergedNotice'));
    if (inventoryChanges.earlyItemIds.length) notices.push(t('earlyNotice'));
    if (notices.length) {
      note.textContent = notices.join(' · ');
      note.classList.add('has-purchase-change');
    }
    clearTimeout(itemRevealTimer);
    itemRevealTimer = setTimeout(() => {
      newlyDrawnItem = null;
      inventoryChanges = { insertedItemIds: [], mergedItemIds: [], earlyItemIds: [] };
      $('#build-inventory')?.querySelectorAll('.is-new,.is-early,.is-merged').forEach(slot => slot.classList.remove('is-new', 'is-early', 'is-merged'));
      note.classList.remove('has-purchase-change');
    }, 2200);
  }

  function renderArchmotherOffer(offer) {
    const masked = shouldSealBuildDraw(getState());
    const key = `${offer.id}|${language()}|${masked}`;
    const dialog = $('#build-archmother-dialog');
    if (offerRenderKey === key) return;
    offerRenderKey = key;
    dialog.querySelector('h2').textContent = t('motherTitle');
    dialog.querySelector('.build-archmother-header>p').textContent = t(masked ? 'motherOfferSealedHint' : 'motherOfferHint');
    dialog.querySelector('.build-archmother-footer').textContent = t('motherFooter');
    if(archmotherReels.length) {
      dialog.querySelector('.build-archmother-status').textContent=t(archmotherReady?'motherReady':'motherSpinning');
      return;
    }
    const candidates = getArchmotherCandidates().map(candidate=>candidate.item||candidate).filter(item=>itemById.has(item?.id));
    dialog.querySelector('.build-archmother-choices').innerHTML = offer.itemIds.slice(0,3).map((id,index) => {
      const item = itemById.get(id);
      if (!item) return '';
      const plan = createReelPlan(candidates,item,{quick:getQuick(),neighbors:1});
      const total = reducedMotion ? 120 : getQuick()?2000+index*600:4400+index*800;
      plan.settleDuration=reducedMotion?0:getQuick()?360:400; plan.travelDuration=total-plan.settleDuration;
      archmotherReels.push({index,plan,item,masked,landed:false,lastIndex:plan.startIndex});
      const cards=plan.entries.map((entry,cardIndex)=>`<span class="build-archmother-reel-card${masked?' is-sealed':''}" data-mother-card-index="${cardIndex}">${masked?sealedHTML():imageHTML(entry,'','item')}<b>${escape(masked?t('sealedItem'):localizedItemName(entry,language()))}</b><small>${escape(masked?t('sealedMeta'):`${t(entry.category)} · T${entry.tier}`)}</small></span>`).join('');
      return `<div class="build-archmother-reel${masked?' is-sealed':''}" data-archmother-reel="${index}" data-archmother-reel-state="spinning"><span class="build-archmother-reel-number">${String(index+1).padStart(2,'0')}</span><div class="build-archmother-reel-window"><span class="build-archmother-reel-focus" aria-hidden="true"></span><div class="build-archmother-reel-track">${cards}</div></div><button class="build-archmother-choice" type="button" data-archmother-choice="${index}" disabled aria-label="${escape(`${t('motherChoose')} · ${index+1}`)}"><span>${escape(t('motherChoose'))}</span><i aria-hidden="true">↙</i></button></div>`;
    }).join('');
    dialog.querySelector('.build-archmother-status').textContent=t('motherSpinning');
  }

  function animateArchmotherReels() {
    const dialog=$('#build-archmother-dialog');
    let started;
    const step=timestamp=>{
      if(destroyed||!archmotherOffer)return;
      if(started===undefined)started=timestamp;
      const elapsed=timestamp-started;
      archmotherReels.forEach(reel=>{
        const node=dialog.querySelector(`[data-archmother-reel="${reel.index}"]`);if(!node)return;
        const position=reducedMotion?reel.plan.landingIndex:reelPosition(reel.plan,elapsed);
        const pitch=132;
        node.querySelector('.build-archmother-reel-track').style.transform=`translateY(${91-position*pitch}px)`;
        const center=Math.round(position);
        if(center!==reel.lastIndex&&!reducedMotion){reel.lastIndex=center;onArchmotherTick({index:reel.index,landed:false});}
        const landed=elapsed>=reelDuration(reel.plan);
        if(landed&&!reel.landed){
          reel.landed=true;node.dataset.archmotherReelState='landed';onArchmotherTick({index:reel.index,landed:true});
          const button=node.querySelector('button');button.setAttribute('aria-label',`${t('motherChoose')} · ${reel.index+1}${reel.masked?'':` · ${localizedItemName(reel.item,language())}`}`);
        }
        node.querySelectorAll('.build-archmother-reel-card').forEach(card=>{const offset=Math.abs(Number(card.dataset.motherCardIndex)-position);card.classList.toggle('is-current',offset<.5);card.setAttribute('aria-hidden',offset<.5?'false':'true');});
      });
      if(archmotherReels.every(reel=>reel.landed)){
        archmotherReady=true;dialog.querySelectorAll('[data-archmother-choice]').forEach(button=>{button.disabled=false;});
        dialog.querySelector('.build-archmother-status').textContent=t('motherReady');archmotherFrame=0;
      }else archmotherFrame=requestAnimationFrame(step);
    };
    archmotherFrame=requestAnimationFrame(step);
  }

  function showArchmotherOffer(offer) {
    if (destroyed || !offer?.id || !Array.isArray(offer.itemIds)) return Promise.resolve(null);
    if (archmotherPromise && archmotherOffer?.id === offer.id) return archmotherPromise;
    const dialog = $('#build-archmother-dialog');
    archmotherOffer = structuredClone(offer);
    archmotherChoosing = false; offerRenderKey = ''; archmotherReady=false;archmotherReels=[];cancelAnimationFrame(archmotherFrame);
    renderArchmotherOffer(archmotherOffer);
    if ($('#build-contract-dialog').open) closeContractDialog();
    archmotherPromise = new Promise(resolve => { archmotherResolve = resolve; });
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('h2').focus({preventScroll:true});
    animateArchmotherReels();
    return archmotherPromise;
  }

  function renderKingOffer(offer) {
    const dialog=$('#build-king-dialog'),ru=language()==='ru';
    const sacrifice=offer.stage==='sacrifice';
    dialog.dataset.kingStage=sacrifice?'sacrifice':'mode';
    dialog.querySelector('.build-king-offer-mark').innerHTML=FATE_PRESENTATION.king.svg;
    dialog.querySelector('h2').textContent=sacrifice?ru?'Цена королевского обмена':'The price of the royal exchange':ru?'Король предлагает сделку':'The King offers a deal';
    dialog.querySelector('.build-king-offer-header>p').textContent=sacrifice?ru?'Выбери один предмет, который уйдёт из инвентаря. Закрытая награда уже ждёт.':'Choose one item to sacrifice from your inventory. A sealed reward awaits.':ru?'Один контракт. Четыре пути. Выбор останется с этим билдом.':'One contract. Four paths. Your choice stays with this build.';
    dialog.querySelector('.build-king-offer-footer').textContent=ru?'Сделка случается один раз за билд и сохраняется после перезапуска. Нельзя обойти свои фильтры предметов.':'The deal happens once per build and survives restart. Your item filters always apply.';
    const availability=getKingAvailability();
    if(sacrifice) {
      const eligible=new Set(availability.find(entry=>entry.mode==='exchange')?.sacrificeItemIds||[]);
      dialog.querySelector('.build-king-choices').innerHTML=`<div class="build-king-sacrifice-grid">${(getState().history||[]).map((entry,index)=>{
        if(!eligible.has(entry.itemId))return '';
        const item=itemById.get(entry.itemId);if(!item)return '';
        const sealed=isBuildEntrySealed(getState(),entry,items),name=sealed?t('sealedItem'):localizedItemName(item,language());
        return `<button class="build-king-sacrifice${sealed?' is-sealed':''}" type="button" data-king-sacrifice="${index}" aria-label="${escape(`${ru?'Пожертвовать':'Sacrifice'} · ${name}`)}">${sealed?sealedHTML():imageHTML(item,'','item')}<b>${escape(name)}</b><small>${escape(sealed?t('sealedMeta'):`${t(item.category)} · T${item.tier}`)}</small>${fateBadgeHTML(entry,language(),{sealed,compact:true})}</button>`;
      }).join('')}</div>`;
    } else {
      dialog.querySelector('.build-king-choices').innerHTML=`<div class="build-king-contract-grid">${['exchange','treasury','impostor','decree'].map((mode,index)=>{
        const record=availability.find(entry=>entry.mode===mode),available=record?.available===true;
        const [title,hint,glyph]=kingDealCopy(mode);
        const reason=record?.reason?({ 'no-sacrifice':ru?'Нет непроклятого предмета с доступной заменой':'No non-cursed item with an eligible replacement','empty-pool':t('actionEmpty'),'no-pair':ru?'Нет доступной связки':'No eligible pair','no-t4':ru?'В доступном пуле нет T4':'No eligible T4 items','no-treasury':ru?'Нет совместимых T4 и связки для замены':'No compatible T4 item and pair to replace the losses','need-three-slots':ru?'Нужны три свободных слота':'Three free slots are required','no-impostor-pool':ru?'Нужны T1 и два совместимых T3/T4':'A T1 item and two compatible T3/T4 items are required','no-edict':ru?'Нет доступного указа':'No eligible edict','not-enough-items':ru?'Недостаточно предметов':'Not enough items','locked':t('fateLockedAction'),'full':t('full') })[record.reason]|| (ru?'Для этой сделки не хватает доступных предметов.':'Not enough eligible items for this deal.'):ru?'Недоступно при текущих фильтрах':'Unavailable with the current filters';
        return `<button class="build-king-contract" type="button" data-king-mode="${mode}" data-king-available="${available}" ${available?'':'disabled'}><span class="build-king-contract-index">0${index+1}</span><span class="build-king-contract-symbol" aria-hidden="true">${glyph}</span><b>${escape(title)}</b><p>${escape(hint)}</p><span class="build-king-contract-accept">${escape(available?ru?'Заключить сделку':'Make this deal':reason)}${available?'<i aria-hidden="true">→</i>':''}</span></button>`;
      }).join('')}</div>`;
    }
  }

  function showKingOffer(offer) {
    if(destroyed||!offer?.id)return Promise.resolve(null);
    if(kingPromise&&kingOffer?.id===offer.id&&kingOffer.stage===offer.stage)return kingPromise;
    kingOffer=structuredClone(offer);kingChoosing=false;renderKingOffer(kingOffer);
    if($('#build-contract-dialog').open)closeContractDialog();
    const dialog=$('#build-king-dialog');kingPromise=new Promise(resolve=>{kingResolve=resolve;});
    if(!dialog.open)dialog.showModal();dialog.querySelector('h2').focus({preventScroll:true});
    return kingPromise;
  }

  function chooseKing(event) {
    const button=event.target.closest('button');if(!button||button.disabled||kingChoosing||!kingOffer)return;
    let choice;
    if(button.dataset.kingMode) {
      const record=getKingAvailability().find(entry=>entry.mode===button.dataset.kingMode);if(!record?.available)return;
      choice={mode:record.mode};
    }else if(button.dataset.kingSacrifice!==undefined) {
      const entry=(getState().history||[])[Number(button.dataset.kingSacrifice)];
      if(!entry||!getKingAvailability().find(record=>record.mode==='exchange')?.sacrificeItemIds?.includes(entry.itemId))return;
      choice={mode:'exchange',sacrificeItemId:entry.itemId};
    }else return;
    kingChoosing=true;$('#build-king-dialog').querySelectorAll('button').forEach(button=>{button.disabled=true;});$('#build-king-dialog').close();
    const resolve=kingResolve;kingResolve=null;kingPromise=null;kingOffer=null;resolve?.(choice);
  }

  function chooseArchmother(event) {
    const button = event.target.closest('[data-archmother-choice]');
    if (!button || button.disabled || !archmotherReady || archmotherChoosing || !archmotherOffer) return;
    const itemId = archmotherOffer.itemIds[Number(button.dataset.archmotherChoice)];
    if (!itemById.has(itemId)) return;
    archmotherChoosing = true;
    $('#build-archmother-dialog').querySelectorAll('button').forEach(button => {button.disabled=true;});
    $('#build-archmother-dialog').querySelector('.build-archmother-status').textContent = t('motherChoosing');
    $('#build-archmother-dialog').close();
    const resolve = archmotherResolve;
    archmotherResolve = null; archmotherPromise = null; archmotherOffer = null; offerRenderKey = '';archmotherReels=[];archmotherReady=false;cancelAnimationFrame(archmotherFrame);
    resolve?.(itemId);
  }

  const preventOfferCancel = event => { event.preventDefault(); };
  const preventOfferEscape = event => { if (event.key==='Escape') {event.preventDefault();event.stopPropagation();} };
  $('#build-archmother-dialog').addEventListener('cancel',preventOfferCancel);
  $('#build-archmother-dialog').addEventListener('keydown',preventOfferEscape,true);
  $('#build-archmother-dialog').addEventListener('click',chooseArchmother);
  $('#build-king-dialog').addEventListener('cancel',preventOfferCancel);
  $('#build-king-dialog').addEventListener('keydown',preventOfferEscape,true);
  $('#build-king-dialog').addEventListener('click',chooseKing);
  async function showFateEvent(event, options = {}) {
    fateBusy = true; renderControls();
    try { await fateEffects.play(event, options); }
    finally { fateBusy = false; if (!destroyed) renderControls(); }
  }
  async function flashRoyalReveal(entry,options={}) {
    if(destroyed||!entry||isBuildEntrySealed(getState(),entry,items))return;
    await showFateEvent({type:'royal-reveal',entry},options);
  }
  return {
    render,
    animateItem,
    revealArchmotherGift,
    flashCurse,
    showInventoryChanges,
    centerStages,
    showFateEvent,
    flashRoyalReveal,
    showArchmotherOffer,
    showKingOffer,
    get busy() { return heroBusy || fateBusy; },
    destroy() {
      destroyed = true;
      fateEffects.destroy();
      cancelAnimationFrame(archmotherFrame);archmotherReels=[];
      archmotherResolve?.(null); archmotherResolve = null; archmotherPromise = null;
      kingResolve?.(null);kingResolve=null;kingPromise=null;kingOffer=null;
      $('#build-archmother-dialog').removeEventListener('cancel',preventOfferCancel);
      $('#build-archmother-dialog').removeEventListener('keydown',preventOfferEscape,true);
      $('#build-archmother-dialog').removeEventListener('click',chooseArchmother);
      $('#build-king-dialog').removeEventListener('cancel',preventOfferCancel);
      $('#build-king-dialog').removeEventListener('keydown',preventOfferEscape,true);
      $('#build-king-dialog').removeEventListener('click',chooseKing);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(itemFrame);
      clearTimeout(revealTimer);
      clearTimeout(abilityTimer);
      abilityWaitResolve?.();
      abilityWaitResolve = null;
      clearTimeout(itemRevealTimer);
      curseTimers.forEach(clearTimeout);
      curseTimers = [];
      curseResolve?.();
      curseResolve = null;
      heroReel?.resizeObserver?.disconnect();
      itemReel?.resizeObserver?.disconnect();
      heroReel?.cancel?.();
      itemReel?.cancel?.();
      itemAnimation = null;
      portraitCache.length = 0;
      itemImageCache.clear();
      root.removeEventListener('click', handleClick);
      root.removeEventListener('input', handleInput);
      root.removeEventListener('change', handleChange);
      root.removeEventListener('keydown', handleKeydown);
      $('#build-contract-dialog').removeEventListener('close', handleDialogClose);
      $('#build-contract-dialog').removeEventListener('cancel', handleDialogClose);
      if (heroBusy) onHeroBusyChange(false);
    },
  };
}
