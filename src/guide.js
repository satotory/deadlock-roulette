const STORAGE_KEY = 'deadlock-roulette.guide.v1';
const COPY = {
  en: {
    welcomeEyebrow: 'YOUR FIRST CONTRACT', welcomeTitle: 'Meet the Chance Shop.',
    welcomeBody: 'A quick look around before you trust fate. We will highlight the controls without drawing a hero, spending a charge or changing your build.',
    welcomeFoot: 'About two minutes. You can reopen the guide at any time.', start: 'Show me around', later: 'I’ll explore myself',
    eyebrow: 'A LITTLE GUIDANCE', back: 'Back', next: 'Next', finish: 'Let’s play', skip: 'Finish the guide', close: 'Close guide',
    step: 'Step', of: 'of', protected: 'Your build stays untouched.', missing: 'This control appears when its mode is available. Your current build is preserved.',
    modes: ['Two ways to trust fate', 'Item roulette is a pool without repeats. Hero build makes a whole match contract: a hero, an inventory and a skill order. We will visit both, then return you here.'],
    weights: ['Choose what can drop', 'Categories and tiers define the pool. A larger weight means a larger chance for each eligible item; zero removes it. Start with a preset, then make the rules your own.'],
    wheel: ['Read the wheel', 'Sector size follows its chance. Hover over a stopped sector to enlarge it and inspect its item. No need to guess from a tiny icon.'],
    draw: ['Draw, then decide', 'Spin here or press Space. An ordinary result leaves the pool until reset. Reroll, upgrade and downgrade sit just below: one charge each, and only one alteration per result.'],
    catalogue: ['Look inside the pool', 'Show the item catalogue to search, read descriptions, exclude an item or adjust its own weight. Save and Load below the draw history transfer the complete session as JSON.'],
    comfort: ['Make it comfortable', 'Set your scale, language and sound here. Music, reel sounds, interface effects and hero voices have separate saved volumes. The lightning button shortens animations.'],
    hero: ['A hero for this match', 'Draw a hero without touching your current item pool. The Hero participation panel below lets you choose who can appear. The four icons on the portrait show the ability unlock order.'],
    route: ['A build you can actually follow', 'The twelve slots show your final items; the purchase route below keeps every buying step. Upgrades absorb their components and free slots. Late T1 drops move into the opening purchases.'],
    skills: ['Follow the diamonds', 'Read the upgrade plan from left to right. Its twelve purchases spend 32 AP while keeping ability ranks in order. Click a diamond after buying that upgrade in the match.'],
    balance: ['Keep the build varied', 'These tier switches belong to the hero builder. Dynamic weights lower the chance of a tier as you collect more of it, so one tier is less likely to take over the build.'],
    events: ['Let fate misbehave', 'Double drops use two slots. Curses add an unchangeable item. Chicken, Archmother and Hidden King each visit once per build, with separate chance sliders. Click their symbols later for the full rules.'],
    archive: ['Keep the good stories', 'Save a contract, preview it, then rate the same build after a match. Stars and comments can be edited without making a copy. Poster and gazette buttons above the hero turn it into a shareable image.'],
    links: ['Ready to share', 'Use Share to copy the browser version’s link, or visit GitHub for source and Windows releases. The update control checks for a new version; installing or reloading always waits for your click. The Guide button brings you back here.'],
  },
  ru: {
    welcomeEyebrow: 'ТВОЙ ПЕРВЫЙ КОНТРАКТ', welcomeTitle: 'Знакомься с Лавкой случая.',
    welcomeBody: 'Короткая прогулка перед встречей с судьбой. Подсветим кнопки, не разыгрывая героя, не тратя заряды и не меняя твой билд.',
    welcomeFoot: 'Примерно две минуты. Гайд можно открыть снова в любой момент.', start: 'Покажи, что здесь есть', later: 'Разберусь сам',
    eyebrow: 'НЕБОЛЬШАЯ ПОДСКАЗКА', back: 'Назад', next: 'Дальше', finish: 'Пора играть', skip: 'Завершить гайд', close: 'Закрыть гайд',
    step: 'Шаг', of: 'из', protected: 'Твой билд остаётся нетронутым.', missing: 'Этот элемент появится в доступном режиме. Твой текущий билд сохранён.',
    modes: ['Два способа довериться случаю', 'Рулетка — это пул предметов без повторов. Билд героя — контракт на целый матч: персонаж, инвентарь и прокачка. Посмотрим оба режима, затем вернём тебя сюда.'],
    weights: ['Выбери, что может выпасть', 'Категории и тиры определяют пул. Больший вес повышает шанс каждой подходящей вещи, ноль исключает её. Можно начать с пресета, а потом настроить свои правила.'],
    wheel: ['Как читать колесо', 'Размер сектора соответствует шансу. Наведи мышку на остановившееся колесо: сектор увеличится и покажет предмет. Разбирать крошечные иконки не придётся.'],
    draw: ['Разыграй и реши', 'Крути этой кнопкой или пробелом. Обычный результат уходит из пула до сброса. Ниже — реролл, апгрейд и даунгрейд: по одному заряду каждого, и только одна правка на результат.'],
    catalogue: ['Загляни в пул', 'Открой каталог: ищи предметы, читай описания, исключай вещи и меняй их личный вес. «Сохранить» и «Загрузить» под историей переносят полную сессию в JSON.'],
    comfort: ['Сделай поудобнее', 'Здесь масштаб, язык и звук. У музыки, прокрутки, интерфейса и реплик героев отдельные сохраняемые громкости. Молния сокращает анимации.'],
    hero: ['Герой на этот матч', 'Разыграй персонажа, не затрагивая пул обычной рулетки. В панели участников ниже можно выбрать, кому выпадать. Четыре иконки на постере показывают порядок открытия умений.'],
    route: ['Сборка, по которой можно играть', 'Двенадцать слотов показывают итоговые вещи, а маршрут под ними — все шаги закупа. Улучшения поглощают компоненты и освобождают слоты. Поздние T1 попадают в начало покупок.'],
    skills: ['Следуй ромбам', 'Читай прокачку слева направо. Двенадцать покупок расходуют 32 AP и сохраняют порядок рангов умений. Купил улучшение в матче — отметь его ромб.'],
    balance: ['Больше разнообразия', 'Эти выключатели тиров относятся к билдеру. Динамические веса уменьшают шанс тира с каждой его вещью, чтобы один тир реже захватывал всю сборку.'],
    events: ['Пусть судьба похулиганит', 'Даблы занимают два слота. Проклятие добавляет неизменяемую вещь. Курица, Архимать и Тайный король приходят по разу за билд; у каждого свой шанс. Позже нажми на их значки, чтобы прочитать правила.'],
    archive: ['Сохраняй хорошие истории', 'Сохрани контракт, посмотри его и оцени после матча. Звёзды и комментарий можно изменить без новой копии. Кнопки постера и газеты над героем превращают билд в картинку для друзей.'],
    links: ['Можно делиться', '«Поделиться» копирует ссылку на браузерную версию, GitHub ведёт к исходникам и Windows-релизам. Обновление проверяет новую версию; установка или перезагрузка ждёт твоего нажатия. Кнопка гайда вернёт тебя сюда.'],
  },
};

export const GUIDE_STEPS = Object.freeze([
  { id: 'modes', mode: 'roulette', selectors: ['.mode-tabs'] },
  { id: 'weights', mode: 'roulette', selectors: ['.controls'] },
  { id: 'wheel', mode: 'roulette', selectors: ['#wheel-wrap'] },
  { id: 'draw', mode: 'roulette', selectors: ['#spin-button', '.roulette-actions'] },
  { id: 'catalogue', mode: 'roulette', selectors: ['#catalog-toggle-button', '#catalog-title'] },
  { id: 'comfort', mode: 'roulette', selectors: ['.header-actions'] },
  { id: 'hero', mode: 'build', selectors: ['.build-hero-panel', '#build-hero-random'] },
  { id: 'route', mode: 'build', selectors: ['#build-purchase-plan', '#build-inventory', '.build-inventory-panel'] },
  { id: 'skills', mode: 'build', selectors: ['.build-skill-panel', '#build-skill-content'] },
  { id: 'balance', mode: 'build', selectors: ['.build-tier-rules', '#build-tier-controls'] },
  { id: 'events', mode: 'build', selectors: ['.build-fate-rules', '#build-fate-title'] },
  { id: 'archive', mode: 'build', selectors: ['.build-contract-panel', '#build-contract-save'] },
  { id: 'links', mode: null, selectors: ['#share-button', '#github-link', '#update-button', '.header-actions'] },
].map(step => Object.freeze({ ...step, selectors: Object.freeze(step.selectors) })));

export function getGuideSteps(language = 'en', section = 'all') {
  const copy = COPY[language === 'ru' ? 'ru' : 'en'];
  return GUIDE_STEPS.filter(step => section === 'all' || !step.mode || step.mode === section)
    .map(step => ({ ...step, title: copy[step.id][0], description: copy[step.id][1] }));
}

/** Place the card beside the actual viewport target, falling back to a safe corner. */
export function placeGuideCard(target, viewport, card, margin = 16, gap = 18) {
  const vw = Math.max(1, Number(viewport.width) || 1), vh = Math.max(1, Number(viewport.height) || 1);
  const m = Math.min(margin, vw / 4, vh / 4), width = Math.min(Math.max(1, card.width), vw - 2 * m), height = Math.min(Math.max(1, card.height), vh - 2 * m);
  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
  if (!target) return { left: (vw - width) / 2, top: (vh - height) / 2, side: 'center', width, height };
  const rect = { left: target.left, right: target.right, top: target.top, bottom: target.bottom };
  const candidates = [
    { left: rect.right + gap, top: (rect.top + rect.bottom - height) / 2, side: 'right' },
    { left: rect.left - width - gap, top: (rect.top + rect.bottom - height) / 2, side: 'left' },
    { left: (rect.left + rect.right - width) / 2, top: rect.bottom + gap, side: 'below' },
    { left: (rect.left + rect.right - width) / 2, top: rect.top - height - gap, side: 'above' },
  ];
  const fits = candidate => candidate.left >= m && candidate.top >= m && candidate.left + width <= vw - m && candidate.top + height <= vh - m;
  const chosen = candidates.find(fits) || { left: vw - width - m, top: vh - height - m, side: 'corner' };
  return { ...chosen, left: clamp(chosen.left, m, vw - width - m), top: clamp(chosen.top, m, vh - height - m), width, height };
}

export function readGuideProgress(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
    return { offered: raw?.offered === true, completed: raw?.completed === true };
  } catch { return { offered: false, completed: false }; }
}

/** UI-only guidance. It never draws, alters, imports or resets an application session. */
export function createGuide({ getLanguage = () => 'en', getMode = () => 'roulette', setMode = () => {}, isBusy = () => false, onStateChange = () => {}, storage } = {}) {
  const doc = document, win = window;
  let store = storage;
  if (!store) { try { store = win.localStorage; } catch { /* An unavailable browser store does not disable the guide. */ } }
  const language = () => getLanguage() === 'ru' ? 'ru' : 'en';
  const copy = () => COPY[language()];
  const overlay = doc.createElement('div');
  overlay.id = 'guide-overlay'; overlay.className = 'guide-overlay'; overlay.hidden = true;
  overlay.innerHTML = '<div class="guide-shield" aria-hidden="true"></div><div class="guide-spotlight" aria-hidden="true"><i></i><i></i><i></i><i></i></div><section class="guide-card" role="dialog" aria-modal="true" aria-labelledby="guide-title" aria-describedby="guide-description"><button class="guide-close" data-guide-close type="button">×</button><div class="guide-eyebrow"></div><div class="guide-step-line"><span id="guide-step-count"></span><div class="guide-meter" aria-hidden="true"><i></i></div></div><h2 id="guide-title" tabindex="-1"></h2><p id="guide-description"></p><p class="guide-reassurance"></p><div class="guide-actions"><button class="guide-skip" data-guide-skip type="button"></button><div><button class="guide-back" data-guide-back type="button"></button><button class="guide-next" data-guide-next type="button"></button></div></div><span class="guide-announcement" role="status" aria-live="polite"></span></section>';
  doc.body.append(overlay);
  const card = overlay.querySelector('.guide-card'), spotlight = overlay.querySelector('.guide-spotlight');
  const welcome = doc.createElement('dialog'); welcome.id = 'guide-welcome-dialog'; welcome.className = 'guide-welcome'; welcome.setAttribute('aria-labelledby', 'guide-welcome-title');
  welcome.innerHTML = '<div class="guide-welcome-art" aria-hidden="true"><span>✦</span><i></i><b>?</b></div><div class="guide-eyebrow"></div><h2 id="guide-welcome-title"></h2><p class="guide-welcome-body"></p><small></small><div class="guide-welcome-actions"><button id="guide-later" type="button"></button><button id="guide-start" type="button"></button></div>';
  doc.body.append(welcome);
  let running = false, destroyed = false, transitioning = false, index = 0, section = 'all', sequence = [], initialMode, initialScroll, initialFocus, target = null, frame = 0, generation = 0;
  const detailsSnapshot = new Map();
  function rememberProgress(completed = false) {
    const previous = readGuideProgress(store);
    try { store?.setItem(STORAGE_KEY, JSON.stringify({ offered: true, completed: completed || previous.completed })); } catch { /* Core app reports unavailable persistence separately. */ }
  }
  function notify() { try { onStateChange(running || welcome.open); } catch { /* Guidance must remain usable when a consumer callback fails. */ } }
  function visible(element) {
    if (!element?.isConnected || element.closest('[hidden]')) return false;
    const style = win.getComputedStyle(element), rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }
  function findTarget(step) {
    for (const selector of step?.selectors || []) {
      const candidate = doc.querySelector(selector);
      if (visible(candidate)) return candidate;
    }
    return null;
  }
  function layout() {
    frame = 0; if (!running || destroyed) return;
    const cssZoom = Number.parseFloat(win.getComputedStyle(doc.documentElement).zoom) || 1;
    overlay.style.zoom = String(1 / cssZoom);
    const viewport = { width: win.innerWidth, height: win.innerHeight };
    const rect = target && visible(target) ? target.getBoundingClientRect() : null;
    if (rect) {
      const left = Math.max(8, rect.left - 7), top = Math.max(8, rect.top - 7);
      const right = Math.min(viewport.width - 8, rect.right + 7), bottom = Math.min(viewport.height - 8, rect.bottom + 7);
      spotlight.hidden = right <= left || bottom <= top;
      spotlight.style.left = `${left}px`; spotlight.style.top = `${top}px`;
      spotlight.style.width = `${Math.max(1, right - left)}px`; spotlight.style.height = `${Math.max(1, bottom - top)}px`;
    } else spotlight.hidden = true;
    const size = card.getBoundingClientRect(), placed = placeGuideCard(rect, viewport, { width: size.width || 374, height: size.height || 296 });
    card.style.left = `${placed.left}px`; card.style.top = `${placed.top}px`; card.dataset.side = placed.side;
  }
  function scheduleLayout() { if (running && !frame) frame = win.requestAnimationFrame(layout); }
  function renderCopy() {
    const c = copy(), step = sequence[index]; if (!step) return;
    overlay.lang = language(); overlay.dataset.guideStep = step.id; overlay.dataset.guideIndex = String(index);
    overlay.querySelector('.guide-eyebrow').textContent = c.eyebrow;
    overlay.querySelector('#guide-step-count').textContent = `${c.step} ${index + 1} ${c.of} ${sequence.length}`;
    overlay.querySelector('.guide-meter>i').style.width = `${(index + 1) / sequence.length * 100}%`;
    overlay.querySelector('#guide-title').textContent = c[step.id][0];
    overlay.querySelector('#guide-description').textContent = c[step.id][1];
    overlay.querySelector('.guide-reassurance').textContent = target ? c.protected : c.missing;
    overlay.querySelector('[data-guide-close]').setAttribute('aria-label', c.close);
    overlay.querySelector('[data-guide-skip]').textContent = c.skip;
    overlay.querySelector('[data-guide-back]').textContent = `← ${c.back}`;
    overlay.querySelector('[data-guide-back]').disabled = index === 0 || transitioning;
    overlay.querySelector('[data-guide-next]').textContent = index === sequence.length - 1 ? `${c.finish} ↗` : `${c.next} →`;
    overlay.querySelector('[data-guide-next]').disabled = transitioning;
    overlay.querySelector('.guide-announcement').textContent = `${c.step} ${index + 1} ${c.of} ${sequence.length}. ${c[step.id][0]}`;
  }
  function renderWelcome() {
    const c = copy(); welcome.lang = language();
    welcome.querySelector('.guide-eyebrow').textContent = c.welcomeEyebrow;
    welcome.querySelector('h2').textContent = c.welcomeTitle;
    welcome.querySelector('.guide-welcome-body').textContent = c.welcomeBody;
    welcome.querySelector('small').textContent = c.welcomeFoot;
    welcome.querySelector('#guide-later').textContent = c.later;
    welcome.querySelector('#guide-start').textContent = `${c.start} ↗`;
  }
  async function showStep(nextIndex) {
    if (!running || transitioning || destroyed) return;
    if (nextIndex >= sequence.length) { finish(true); return; }
    if (nextIndex < 0) return;
    const currentGeneration = ++generation; transitioning = true; index = nextIndex; target = null; renderCopy();
    const step = sequence[index];
    try {
      if (step.mode && step.mode !== getMode()) await setMode(step.mode);
      if (!running || currentGeneration !== generation) return;
      target = findTarget(step);
      if (target) {
        const detail = target.closest('details');
        if (detail) {
          if (!detailsSnapshot.has(detail)) detailsSnapshot.set(detail, detail.open);
          detail.open = true;
        }
        target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
      }
      await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)));
      if (!running || currentGeneration !== generation) return;
      target = findTarget(step); transitioning = false; renderCopy(); layout();
      card.querySelector('#guide-title').focus({ preventScroll: true });
    } catch {
      if (running && currentGeneration === generation) { transitioning = false; renderCopy(); layout(); }
    }
  }
  function start(options = {}) {
    if (destroyed || running || isBusy()) return false;
    if (welcome.open) welcome.close();
    section = ['roulette', 'build'].includes(options.section) ? options.section : 'all';
    sequence = getGuideSteps(language(), section); initialMode = getMode(); initialScroll = { left: win.scrollX, top: win.scrollY }; initialFocus = doc.activeElement;
    running = true; overlay.hidden = false; doc.documentElement.classList.add('guide-running');
    rememberProgress(); notify(); showStep(0); return true;
  }
  function finish(completed = false) {
    if (!running) return;
    running = false; transitioning = false; generation++; if (frame) win.cancelAnimationFrame(frame); frame = 0;
    overlay.hidden = true; target = null;
    for (const [detail, open] of detailsSnapshot) if (detail.isConnected) detail.open = open;
    detailsSnapshot.clear();
    if (initialMode && getMode() !== initialMode) { try { setMode(initialMode); } catch { /* A changed app state may reject navigation; never change the build to force it. */ } }
    if (initialScroll) win.scrollTo({ ...initialScroll, behavior: 'instant' });
    doc.documentElement.classList.remove('guide-running'); rememberProgress(completed); notify();
    const focus = visible(initialFocus) ? initialFocus : doc.querySelector('#guide-button');
    focus?.focus({ preventScroll: true });
  }
  function maybeWelcome({ eligible = true } = {}) {
    if (!eligible || destroyed || running || welcome.open || isBusy() || readGuideProgress(store).offered) return false;
    renderWelcome();
    try { welcome.showModal(); } catch { return false; }
    rememberProgress(); notify(); welcome.querySelector('#guide-start').focus({ preventScroll: true }); return true;
  }
  function refresh() {
    if (welcome.open) renderWelcome();
    if (!running) return;
    if (!transitioning) { target = findTarget(sequence[index]); renderCopy(); }
    scheduleLayout();
  }
  function focusButtons() { return [...card.querySelectorAll('button')].filter(button => !button.disabled && !button.hidden); }
  function handleKey(event) {
    if (!running) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); if (!event.repeat) showStep(index + 1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); if (!event.repeat) showStep(index - 1); }
    else if (event.key === 'Tab') {
      event.preventDefault(); const buttons = focusButtons(), current = buttons.indexOf(doc.activeElement);
      const next = current < 0 ? (event.shiftKey ? buttons.length - 1 : 0) : (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus({ preventScroll: true });
    } else if (event.ctrlKey || event.metaKey || event.altKey || !overlay.contains(event.target)) event.preventDefault();
  }
  function trapFocus(event) { if (running && !overlay.contains(event.target)) card.querySelector('[data-guide-next]')?.focus({ preventScroll: true }); }
  function lockScroll(event) { if (running && !card.contains(event.target)) event.preventDefault(); }
  function closeWelcome() { if (!welcome.open) return; welcome.close(); rememberProgress(); notify(); }
  function handleClick(event) {
    const button = event.target.closest('button'); if (!button) return;
    if (button.matches('[data-guide-close],[data-guide-skip]')) finish(false);
    else if (button.matches('[data-guide-back]')) showStep(index - 1);
    else if (button.matches('[data-guide-next]')) showStep(index + 1);
  }
  overlay.addEventListener('click', handleClick);
  welcome.querySelector('#guide-start').addEventListener('click', () => { closeWelcome(); start(); });
  welcome.querySelector('#guide-later').addEventListener('click', closeWelcome);
  welcome.addEventListener('cancel', () => { rememberProgress(); win.queueMicrotask(notify); });
  win.addEventListener('keydown', handleKey, true); doc.addEventListener('focusin', trapFocus, true);
  win.addEventListener('resize', scheduleLayout); win.addEventListener('scroll', scheduleLayout, true);
  win.addEventListener('wheel', lockScroll, { passive: false, capture: true });
  return {
    start, maybeWelcome, refresh, close: () => finish(false),
    get active() { return running || welcome.open; },
    get step() { return running ? sequence[index]?.id : null; },
    destroy() {
      finish(false); closeWelcome(); destroyed = true; overlay.remove(); welcome.remove();
      win.removeEventListener('keydown', handleKey, true); doc.removeEventListener('focusin', trapFocus, true);
      win.removeEventListener('resize', scheduleLayout); win.removeEventListener('scroll', scheduleLayout, true); win.removeEventListener('wheel', lockScroll, true);
    },
  };
}
