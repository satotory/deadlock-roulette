import { APP_VERSION, PROJECT_LINKS } from './app-version.js';

const COPY = {
  ru: {
    title: 'Обновления', check: 'Проверить обновления', checking: 'Проверяем релизы…', current: 'У тебя последняя версия',
    available: 'Есть новая версия', idle: 'Обновления приложения', update: 'Обновить и перезапустить', reload: 'Обновить страницу',
    download: 'Скачиваем обновление', installing: 'Готовим перезапуск…', error: 'Не удалось обновить приложение', close: 'Закрыть', later: 'Позже',
    version: 'Текущая версия', latest: 'Новая версия', nativeHint: 'Приложение скачает и проверит новый файл, затем перезапустится. Настройки, архив и текущий билд сохранятся.',
    webHint: 'Страница загрузит новую версию. Текущий билд и настройки останутся в этом браузере.',
    sourceHint: 'Автоматическая замена доступна в переносимой Windows-версии. Здесь можно открыть страницу релиза.',
    failed: 'Проверь соединение и попробуй ещё раз. Текущая версия остаётся на месте.', busy: 'Сначала заверши розыгрыш или текущий выбор.',
    saveFailed: 'Не удалось сохранить сессию. Сначала экспортируй её в JSON.', releases: 'Открыть релиз', pending: 'Дождись завершения обновления.',
    hash: 'Проверка файла не прошла. Обновление не установлено.', folder: 'Не удалось заменить файл в этой папке. Перемести приложение в доступную для записи папку.',
  },
  en: {
    title: 'Updates', check: 'Check for updates', checking: 'Checking releases…', current: 'You have the latest version',
    available: 'A new version is available', idle: 'App updates', update: 'Update and restart', reload: 'Update this page',
    download: 'Downloading update', installing: 'Preparing to restart…', error: 'Could not update the app', close: 'Close', later: 'Later',
    version: 'Current version', latest: 'New version', nativeHint: 'The app will download and verify the new file, then restart. Your settings, archive and current build are kept.',
    webHint: 'This page will load the new version. Your current build and settings stay in this browser.',
    sourceHint: 'Automatic replacement is available in the portable Windows app. You can open the release page here.',
    failed: 'Check your connection and try again. The current version stays in place.', busy: 'Finish the draw or pending choice first.',
    saveFailed: 'Could not save the session. Export it as JSON before updating.', releases: 'Open release', pending: 'Wait for the update to finish.',
    hash: 'File verification failed. No update was installed.', folder: 'Could not replace the file in this folder. Move the app to a writable folder.',
  },
};

export function versionParts(value) {
  if (typeof value !== 'string' || value.length > 48 || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
  const parts = value.replace(/^v/, '').split('.').map(Number);
  return parts.every(number => Number.isSafeInteger(number) && number <= 2147483647) ? parts : null;
}

export function isNewerVersion(candidate, current) {
  const next = versionParts(candidate), previous = versionParts(current);
  if (!next || !previous) return false;
  for (let index = 0; index < 3; index++) { if (next[index] !== previous[index]) return next[index] > previous[index]; }
  return false;
}

export function parseWebRelease(value) {
  if (!value || typeof value !== 'object' || !versionParts(value.version)) throw new TypeError('Invalid release manifest.');
  return { version: value.version.replace(/^v/, ''), releaseURL: PROJECT_LINKS.releases };
}

export function safeUpdateState(value = {}) {
  const allowed = ['idle', 'checking', 'current', 'available', 'downloading', 'ready', 'installing', 'error', 'unsupported'];
  const rawError = value.errorCode || value.code || (value.error && typeof value.error === 'object' ? value.error.code : value.error);
  return {
    status: allowed.includes(value.status) ? value.status : 'error',
    currentVersion: versionParts(value.currentVersion) ? value.currentVersion.replace(/^v/, '') : APP_VERSION,
    latestVersion: versionParts(value.latestVersion) ? value.latestVersion.replace(/^v/, '') : null,
    progress: Number.isFinite(value.progress) ? Math.max(0, Math.min(100, value.progress)) : 0,
    canInstall: value.canInstall === true,
    error: typeof rawError === 'string' ? rawError.slice(0, 96) : '',
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 96) : '',
    releaseURL: PROJECT_LINKS.releases,
  };
}

/** Same update affordance on Windows and the web; only main may replace an executable. */
export function createAppUpdates({ getLanguage, isBusy, beforeUpdate, notify = () => {} }) {
  const native = typeof window.deadlock?.checkForUpdates === 'function';
  let state = safeUpdateState({ status: 'idle', currentVersion: APP_VERSION, canInstall: !native });
  let destroyed = false, checking = false, inFlight = false, startupTimer, pollTimer, unsubscribe, lastCheck = 0;
  const button = document.querySelector('#update-button');
  const dialog = document.createElement('dialog');
  dialog.id = 'app-update-dialog'; dialog.className = 'modal compact-modal app-update-dialog';
  dialog.innerHTML = '<button type="button" class="modal-close" data-update-close aria-label="">×</button><span class="eyebrow" data-update-eyebrow></span><h2 data-update-heading></h2><div class="app-update-versions"><span data-update-current></span><strong data-update-latest></strong></div><p data-update-copy></p><div class="app-update-progress" hidden><progress max="100" value="0"></progress><span></span></div><div class="modal-actions"><a class="secondary-button" data-update-releases target="_blank" rel="noopener noreferrer"></a><button class="secondary-button" type="button" data-update-check></button><button class="primary-button" type="button" data-update-install hidden></button></div>';
  document.body.append(dialog);
  const text = key => COPY[getLanguage() === 'en' ? 'en' : 'ru'][key];
  const applying = () => inFlight || ['downloading', 'ready', 'installing'].includes(state.status);
  const available = () => isNewerVersion(state.latestVersion, state.currentVersion);
  const $ = selector => dialog.querySelector(selector);

  function refresh() {
    if (destroyed) return;
    const busy = applying(), hasUpdate = available();
    document.body.classList.toggle('is-app-updating', busy);
    button.classList.toggle('has-update', hasUpdate); button.classList.toggle('is-checking', state.status === 'checking');
    button.dataset.updateStatus = state.status;
    button.querySelector('[data-update-label]').textContent = hasUpdate ? text('available') : `v${state.currentVersion}`;
    button.title = hasUpdate ? `${text('available')}: ${state.latestVersion}` : text('check'); button.setAttribute('aria-label', button.title);
    $('[data-update-eyebrow]').textContent = text('title');
    const heading = ['idle', 'unsupported'].includes(state.status) ? text('idle') : state.status === 'ready' ? text('installing') : text(state.status === 'downloading' ? 'download' : state.status);
    $('[data-update-heading]').textContent = heading || text('idle');
    $('[data-update-current]').textContent = `${text('version')} · ${state.currentVersion}`;
    $('[data-update-latest]').textContent = hasUpdate ? `${text('latest')} · ${state.latestVersion}` : '';
    let description = native ? text('nativeHint') : text('webHint');
    if (native && state.reason) description = text('sourceHint');
    if (state.status === 'error') description = /hash|digest|checksum|integrity|verification/i.test(state.error) ? text('hash') : /folder|writ|permission|replace|path/i.test(state.error) ? text('folder') : text('failed');
    if (busy) description = text('pending') + ' ' + (native ? text('nativeHint') : text('webHint'));
    $('[data-update-copy]').textContent = description;
    $('[data-update-close]').disabled = busy; $('[data-update-close]').setAttribute('aria-label', text('close'));
    $('[data-update-check]').textContent = text('check'); $('[data-update-check]').disabled = checking || busy;
    $('[data-update-releases]').textContent = text('releases'); $('[data-update-releases]').href = PROJECT_LINKS.releases;
    $('[data-update-releases]').hidden = busy;
    $('[data-update-install]').hidden = !hasUpdate || (native && !state.canInstall);
    $('[data-update-install]').textContent = busy ? text(state.status === 'downloading' ? 'download' : 'installing') : text(native ? 'update' : 'reload');
    $('[data-update-install]').disabled = busy;
    $('.app-update-progress').hidden = !busy;
    const percentage = Math.round(state.progress); $('.app-update-progress progress').value = percentage;
    $('.app-update-progress span').textContent = state.status === 'downloading' ? `${percentage}%` : text('installing');
  }

  function accept(next) { state = safeUpdateState(next); refresh(); }

  async function check({ quiet = false } = {}) {
    if (destroyed || checking || applying()) return;
    if (quiet && lastCheck && Date.now() - lastCheck < 30 * 60 * 1000) return;
    lastCheck = Date.now();
    checking = true; accept({ ...state, status: 'checking' });
    try {
      if (native) accept(await window.deadlock.checkForUpdates());
      else {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
        try {
          const response = await fetch(new URL(`../version.json?check=${Date.now()}`, import.meta.url), { cache: 'no-store', signal: controller.signal });
          if (!response.ok || Number(response.headers.get('content-length')) > 16384) throw new Error('Release manifest unavailable.');
          const raw = await response.text(); if (raw.length > 16384) throw new Error('Release manifest too large.');
          const release = parseWebRelease(JSON.parse(raw));
          accept({ ...state, status: isNewerVersion(release.version, APP_VERSION) ? 'available' : 'current', latestVersion: release.version, currentVersion: APP_VERSION, canInstall: true });
        } finally { clearTimeout(timer); }
      }
    } catch { accept({ ...state, status: 'error', error: 'network' }); }
    finally { checking = false; refresh(); }
    if (!quiet && !dialog.open && state.status === 'available') open();
  }

  function open() {
    if (isBusy()) { notify(text('busy')); return false; }
    refresh(); if (!dialog.open) dialog.showModal();
    if (state.status === 'idle' || state.status === 'error') check({ quiet: true });
    return true;
  }

  async function install() {
    if (!available() || applying() || (native && !state.canInstall)) return;
    if (isBusy()) { notify(text('busy')); return; }
    if (beforeUpdate() === false) { notify(text('saveFailed')); return; }
    if (!native) { window.location.reload(); return; }
    inFlight = true; refresh();
    try {
      const result = await window.deadlock.installUpdate();
      if (result) accept(result);
    } catch { accept({ ...state, status: 'error', error: 'install' }); }
    finally { inFlight = false; refresh(); }
  }

  const onButton = () => open(), onClose = () => { if (!applying()) dialog.close(); };
  const onCheck = () => check(), onInstall = () => install();
  const onCancel = event => { if (applying()) event.preventDefault(); };
  const onReleases = event => { if (window.deadlock?.openProjectLink) { event.preventDefault(); window.deadlock.openProjectLink('releases').catch(() => notify(text('failed'))); } };
  const onVisible = () => { if (document.visibilityState === 'visible' && !isBusy() && !dialog.open) check({ quiet: true }); };
  button.addEventListener('click', onButton); $('[data-update-close]').addEventListener('click', onClose);
  $('[data-update-check]').addEventListener('click', onCheck); $('[data-update-install]').addEventListener('click', onInstall);
  $('[data-update-releases]').addEventListener('click', onReleases); dialog.addEventListener('cancel', onCancel);
  if (native && window.deadlock.onUpdateState) unsubscribe = window.deadlock.onUpdateState(accept);
  if (native && window.deadlock.getUpdateState) window.deadlock.getUpdateState().then(accept).catch(() => {});
  startupTimer = setTimeout(() => check({ quiet: true }), 5000);
  pollTimer = setInterval(() => { if (!isBusy() && !dialog.open) check({ quiet: true }); }, 6 * 60 * 60 * 1000);
  document.addEventListener('visibilitychange', onVisible);
  refresh();
  return { check, open, refresh, get applying() { return applying(); }, get state() { return { ...state }; }, destroy() {
    destroyed = true; clearTimeout(startupTimer); clearInterval(pollTimer); unsubscribe?.(); button.removeEventListener('click', onButton);
    document.removeEventListener('visibilitychange', onVisible); dialog.remove(); document.body.classList.remove('is-app-updating');
  } };
}
