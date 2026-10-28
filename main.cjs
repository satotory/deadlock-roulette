'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, session, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { pathToFileURL, fileURLToPath } = require('node:url');

const APP_NAME = 'Deadlock Roulette';
const APP_ROOT = path.resolve(__dirname);
const INDEX_PATH = path.join(APP_ROOT, 'src', 'index.html');
const INDEX_URL = pathToFileURL(INDEX_PATH).href;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_PNG_BYTES = 12 * 1024 * 1024;
const MIN_ZOOM_FACTOR = 0.75;
const MAX_ZOOM_FACTOR = 2.5;
const SMOKE_TEST = process.argv.includes('--smoke-test');
let mainWindow = null;
let fileDialogActive = false;

app.setName(APP_NAME);
app.setAppUserModelId('local.deadlock.roulette');
// A stable path keeps sessions across portable executable rebuilds/extraction folders.
const userDataOverride = app.commandLine.getSwitchValue('user-data-dir');
app.setPath('userData', userDataOverride ? path.resolve(userDataOverride) : path.join(app.getPath('appData'), APP_NAME));

function isAppResource(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return true;
    if (parsed.protocol !== 'file:') return false;
    const relative = path.relative(APP_ROOT, fileURLToPath(parsed));
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

function assertTrustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame ||
      event.senderFrame.url.split('#', 1)[0] !== INDEX_URL) {
    throw new Error('Untrusted application frame.');
  }
}

function validatedJSON(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) {
    throw new Error('Файл должен содержать JSON размером не более 2 МБ.');
  }
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error('Файл не содержит корректный JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Ожидается объект с настройками сессии.');
  }
  return `${JSON.stringify(data, null, 2)}\n`;
}

function validatedPNG(dataURL) {
  if (typeof dataURL !== 'string' || dataURL.length > MAX_PNG_BYTES * 4 / 3 + 64 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataURL)) {
    throw new Error('Expected a PNG image no larger than 12 MB.');
  }
  const image = Buffer.from(dataURL.slice('data:image/png;base64,'.length), 'base64');
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (image.length < 45 || image.length > MAX_PNG_BYTES || !image.subarray(0, 8).equals(signature)
    || image.toString('ascii', 12, 16) !== 'IHDR' || image.toString('ascii', image.length - 8, image.length - 4) !== 'IEND') {
    throw new Error('Invalid PNG image.');
  }
  const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096 || width * height > 12_000_000) throw new Error('Invalid PNG dimensions.');
  return image;
}

function toggleFullscreen() {
  if (!mainWindow) return false;
  const fullscreen = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(fullscreen);
  return fullscreen;
}

function registerIPC() {
  ipcMain.handle('desktop:set-zoom', (event, value) => {
    assertTrustedSender(event);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('Масштаб должен быть конечным числом.');
    }
    const factor = Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, value));
    mainWindow.webContents.setZoomFactor(factor);
    return mainWindow.webContents.getZoomFactor();
  });
  ipcMain.handle('desktop:toggle-fullscreen', (event) => {
    assertTrustedSender(event);
    return toggleFullscreen();
  });
  ipcMain.handle('desktop:version', (event) => {
    assertTrustedSender(event);
    return app.getVersion();
  });
  ipcMain.handle('desktop:export-json', async (event, text, language) => {
    assertTrustedSender(event);
    const content = validatedJSON(text);
    if (fileDialogActive) return null;
    fileDialogActive = true;
    try {
      const chosen = await dialog.showSaveDialog(mainWindow, {
        title: language === 'en' ? 'Save Roulette Session' : 'Сохранить сессию рулетки',
        defaultPath: `deadlock-session-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: language === 'en' ? 'Deadlock Roulette session' : 'Сессия Deadlock Roulette', extensions: ['json'] }],
      });
      if (chosen.canceled || !chosen.filePath) return null;
      await fs.writeFile(chosen.filePath, content, 'utf8');
      return path.basename(chosen.filePath);
    } finally {
      fileDialogActive = false;
    }
  });
  ipcMain.handle('desktop:import-json', async (event, language) => {
    assertTrustedSender(event);
    if (fileDialogActive) return null;
    fileDialogActive = true;
    try {
      const chosen = await dialog.showOpenDialog(mainWindow, {
        title: language === 'en' ? 'Load Roulette Session' : 'Загрузить сессию рулетки',
        filters: [{ name: language === 'en' ? 'Deadlock Roulette session' : 'Сессия Deadlock Roulette', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (chosen.canceled || !chosen.filePaths.length) return null;
      const filePath = chosen.filePaths[0];
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_JSON_BYTES) {
        throw new Error('Выберите JSON-файл размером не более 2 МБ.');
      }
      const content = await fs.readFile(filePath, 'utf8');
      return validatedJSON(content);
    } finally {
      fileDialogActive = false;
    }
  });
}

ipcMain.handle('desktop:export-png', async (event, dataURL, name, language) => {
  assertTrustedSender(event);
  const content = validatedPNG(dataURL);
  if (fileDialogActive) return null;
  fileDialogActive = true;
  try {
    const safeName = (typeof name === 'string' ? name : 'contract').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 60) || 'contract';
    const chosen = await dialog.showSaveDialog(mainWindow, {
      title: language === 'en' ? 'Save Match Poster' : 'Сохранить постер матча',
      defaultPath: `deadlock-${safeName}.png`,
      filters: [{ name: language === 'en' ? 'PNG image' : 'Изображение PNG', extensions: ['png'] }],
    });
    if (chosen.canceled || !chosen.filePath) return null;
    await fs.writeFile(chosen.filePath, content);
    return path.basename(chosen.filePath);
  } finally { fileDialogActive = false; }
});

function createWindow() {
  const iconPath = path.join(APP_ROOT, 'assets', 'app.ico');
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 980,
    minWidth: 1080,
    minHeight: 760,
    backgroundColor: '#101916',
    show: false,
    autoHideMenuBar: true,
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: !SMOKE_TEST,
      offscreen: SMOKE_TEST,
    },
  });
  if (SMOKE_TEST) mainWindow.webContents.setAudioMuted(true);
  mainWindow.once('ready-to-show', () => { if (!SMOKE_TEST) mainWindow.show(); });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== INDEX_URL) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      event.preventDefault();
      toggleFullscreen();
    } else if (input.key === 'Escape' && mainWindow.isFullScreen()) {
      event.preventDefault();
      mainWindow.setFullScreen(false);
    }
  });
  mainWindow.loadFile(INDEX_PATH).catch((error) => {
    dialog.showErrorBox('Deadlock Roulette', `Не удалось открыть приложение.\n${error.message}`);
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark';
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !isAppResource(details.url) });
    });
    registerIPC();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => app.quit());
}
