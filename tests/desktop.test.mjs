import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const handlers = new Map();
const fakeContents = {
  mainFrame: { url: pathToFileURL(path.join(root, 'src', 'index.html')).href },
  zoomFactor: 1,
  setZoomFactor(value) { this.zoomFactor = value; },
  getZoomFactor() { return this.zoomFactor; },
};
const fakeWindow = {
  webContents: fakeContents,
  fullscreen: false,
  isFullScreen() { return this.fullscreen; },
  setFullScreen(value) { this.fullscreen = value; },
};
const electron = {
  app: {
    setName() {}, setAppUserModelId() {}, setPath() {}, on() {}, quit() {},
    getPath: () => root,
    getVersion: () => '1.0.0',
    commandLine: { getSwitchValue: () => '' },
    requestSingleInstanceLock: () => true,
    whenReady: () => ({ then() {} }),
  },
  ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
  dialog: {},
  shell: { openExternal: async () => {} },
  clipboard: { writeText() {} },
};
const context = vm.createContext({
  require: (name) => name === 'electron' ? electron : require(name),
  __dirname: root, Buffer, URL, console, process: { argv: [] },
});
vm.runInContext(`${fs.readFileSync(path.join(root, 'main.cjs'), 'utf8')}\n` +
  'globalThis.desktop = { isAppResource, validatedJSON, validatedPNG, registerIPC, setWindow: value => { mainWindow = value; } };', context);
const desktop = context.desktop;
desktop.setWindow(fakeWindow);
desktop.registerIPC();
const trustedEvent = { sender: fakeContents, senderFrame: fakeContents.mainFrame };

test('bundled resource policy accepts packaged files and rejects remote/outside files', () => {
  assert.equal(desktop.isAppResource(pathToFileURL(path.join(root, 'assets', 'items.json')).href), true);
  assert.equal(desktop.isAppResource(pathToFileURL(path.join(root, '..', 'secret.json')).href), false);
  assert.equal(desktop.isAppResource('https://example.com/app.js'), false);
  assert.equal(desktop.isAppResource('http://localhost:8000'), false);
  assert.equal(desktop.isAppResource('javascript:alert(1)'), false);
  assert.equal(desktop.isAppResource('not a URL'), false);
});

test('desktop IPC accepts only the active main renderer frame', async () => {
  assert.equal(handlers.get('desktop:version')(trustedEvent), '1.0.0');
  assert.equal(handlers.get('desktop:toggle-fullscreen')(trustedEvent), true);
  assert.equal(handlers.get('desktop:toggle-fullscreen')(trustedEvent), false);
  fakeContents.mainFrame.url += '#';
  assert.equal(handlers.get('desktop:version')(trustedEvent), '1.0.0');
  fakeContents.mainFrame.url = fakeContents.mainFrame.url.slice(0, -1);
  assert.throws(() => handlers.get('desktop:version')({ sender: {}, senderFrame: {} }), /Untrusted/);
  assert.throws(() => handlers.get('desktop:version')({ sender: fakeContents, senderFrame: { ...fakeContents.mainFrame } }), /Untrusted/);
  await assert.rejects(handlers.get('desktop:export-json')({ sender: {}, senderFrame: {} }, '{}'), /Untrusted/);
});

test('session JSON import/export rejects invalid, non-object, and excessive data', () => {
  assert.equal(desktop.validatedJSON('{"history":[]}'), '{\n  "history": []\n}\n');
  assert.throws(() => desktop.validatedJSON('[1,2,3]'), /объект/);
  assert.throws(() => desktop.validatedJSON('null'), /объект/);
  assert.throws(() => desktop.validatedJSON('{ broken }'), /JSON/);
  assert.throws(() => desktop.validatedJSON({ history: [] }), /2 МБ/);
  assert.throws(() => desktop.validatedJSON(`{"value":"${'я'.repeat(1024 * 1024)}"}`), /2 МБ/);
});

test('desktop zoom accepts finite numbers, clamps limits, and rejects invalid or untrusted input', () => {
  const setZoom = handlers.get('desktop:set-zoom');
  assert.equal(setZoom(trustedEvent, 1.5), 1.5);
  assert.equal(fakeContents.zoomFactor, 1.5);
  assert.equal(setZoom(trustedEvent, 0.1), 0.75);
  assert.equal(setZoom(trustedEvent, 10), 2.5);
  for (const invalid of ['1.5', null, undefined, NaN, Infinity, -Infinity, {}, []]) {
    assert.throws(() => setZoom(trustedEvent, invalid), /конечным числом/);
    assert.equal(fakeContents.zoomFactor, 2.5);
  }
  assert.throws(() => setZoom({ sender: {}, senderFrame: {} }, 1), /Untrusted/);
  assert.equal(fakeContents.zoomFactor, 2.5);
  assert.equal(setZoom(trustedEvent, 1), 1);
});

test('canceled native session dialogs return null without filesystem access', async () => {
  electron.dialog.showSaveDialog = async () => ({ canceled: true });
  electron.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  assert.equal(await handlers.get('desktop:export-json')(trustedEvent, '{}'), null);
  assert.equal(await handlers.get('desktop:import-json')(trustedEvent), null);
});

test('native session dialogs translate English labels and use Russian for unsupported languages', async () => {
  let saveOptions;
  let loadOptions;
  electron.dialog.showSaveDialog = async (_window, options) => { saveOptions = options; return { canceled: true }; };
  electron.dialog.showOpenDialog = async (_window, options) => { loadOptions = options; return { canceled: true, filePaths: [] }; };
  await handlers.get('desktop:export-json')(trustedEvent, '{}', 'en');
  await handlers.get('desktop:import-json')(trustedEvent, 'en');
  assert.equal(saveOptions.title, 'Save Roulette Session');
  assert.equal(loadOptions.title, 'Load Roulette Session');
  assert.equal(saveOptions.filters[0].name, 'Deadlock Roulette session');
  assert.equal(loadOptions.filters[0].name, 'Deadlock Roulette session');
  await handlers.get('desktop:export-json')(trustedEvent, '{}', 'unexpected');
  await handlers.get('desktop:import-json')(trustedEvent, { language: 'en' });
  assert.equal(saveOptions.title, 'Сохранить сессию рулетки');
  assert.equal(loadOptions.title, 'Загрузить сессию рулетки');
  assert.equal(saveOptions.filters[0].name, 'Сессия Deadlock Roulette');
});

test('preload exposes only specific methods, strips update events and unsubscribes cleanly', () => {
  const calls = [];
  const listeners = new Map();
  let api;
  const preloadContext = vm.createContext({
    require: () => ({
      contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'deadlock'); api = value; } },
      ipcRenderer: {
        invoke(...args) { calls.push(args); return Promise.resolve(); },
        on(channel, listener) { listeners.set(channel, listener); },
        removeListener(channel, listener) { assert.equal(listeners.get(channel), listener); listeners.delete(channel); },
      },
    }),
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8'), preloadContext);
  assert.deepEqual(Object.keys(api), ['setZoomFactor', 'toggleFullscreen', 'getVersion', 'getUpdateState', 'checkForUpdates', 'installUpdate', 'onUpdateState', 'openProjectLink', 'copyAppLink', 'exportJSON', 'importJSON', 'exportPNG']);
  assert.equal(Object.isFrozen(api), true);
  assert.equal(api.invoke, undefined);
  assert.equal(api.send, undefined);
  api.setZoomFactor(1.5);
  api.exportJSON('{}');
  api.importJSON();
  api.exportJSON('{}', 'en');
  api.importJSON('en');
  api.exportPNG('data:image/png;base64,test', 'match', 'en');
  api.getUpdateState(); api.checkForUpdates(); api.installUpdate(); api.openProjectLink(); api.openProjectLink('web'); api.copyAppLink();
  assert.deepEqual(calls, [['desktop:set-zoom', 1.5], ['desktop:export-json', '{}', 'ru'], ['desktop:import-json', 'ru'],
    ['desktop:export-json', '{}', 'en'], ['desktop:import-json', 'en'], ['desktop:export-png', 'data:image/png;base64,test', 'match', 'en'],
    ['desktop:update-state'], ['desktop:check-updates'], ['desktop:install-update'], ['desktop:open-link', 'github'], ['desktop:open-link', 'web'], ['desktop:copy-app-link']]);
  let received;
  const unsubscribe = api.onUpdateState(value => { received = value; });
  const state = { status: 'available', latestVersion: '1.10.0' };
  listeners.get('desktop:update-state')({ sender: 'privileged event' }, state);
  assert.equal(received, state);
  unsubscribe();
  assert.equal(listeners.size, 0);
  assert.throws(() => api.onUpdateState({}), /listener must be a function/);
});

test('project links and sharing use fixed destinations and reject untrusted frames', async () => {
  const opened = []; const copied = [];
  electron.shell.openExternal = async value => { opened.push(value); };
  electron.clipboard.writeText = value => { copied.push(value); };
  const open = handlers.get('desktop:open-link'), copy = handlers.get('desktop:copy-app-link');
  await open(trustedEvent, 'github'); await open(trustedEvent, 'web'); await open(trustedEvent, 'releases');
  assert.deepEqual(opened, ['https://github.com/satotory/deadlock-roulette', 'https://satotory.github.io/deadlock-roulette/', 'https://github.com/satotory/deadlock-roulette/releases/latest']);
  for (const invalid of ['https://example.com', 'file:///C:/Windows', '', null, {}]) assert.throws(() => open(trustedEvent, invalid), /Unknown project link/);
  assert.equal(copy(trustedEvent), 'https://satotory.github.io/deadlock-roulette/');
  assert.deepEqual(copied, ['https://satotory.github.io/deadlock-roulette/']);
  for (const channel of ['desktop:open-link', 'desktop:copy-app-link', 'desktop:update-state', 'desktop:check-updates', 'desktop:install-update']) assert.throws(() => handlers.get(channel)({ sender: {}, senderFrame: {} }, 'github'), /Untrusted/);
  const initial = handlers.get('desktop:update-state')(trustedEvent);
  assert.equal(initial.status, 'idle');
  assert.equal(initial.canInstall, false);
  assert.equal(initial.reason, 'development');
});

const tinyPNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lLkAAAAASUVORK5CYII=';
test('poster export accepts PNG only, bounded dimensions and trusted renderer', async () => {
  assert.equal(desktop.validatedPNG(tinyPNG).subarray(1, 4).toString(), 'PNG');
  for (const invalid of [null, {}, tinyPNG.replace('png', 'jpeg'), 'data:image/png;base64,AAAA', tinyPNG + '!', 'data:image/png;base64,' + 'A'.repeat(17 * 1024 * 1024)]) {
    assert.throws(() => desktop.validatedPNG(invalid), /PNG/);
  }
  const oversized = Buffer.from(tinyPNG.split(',')[1], 'base64'); oversized.writeUInt32BE(9000, 16);
  assert.throws(() => desktop.validatedPNG('data:image/png;base64,' + oversized.toString('base64')), /dimensions/);
  await assert.rejects(handlers.get('desktop:export-png')({ sender: {}, senderFrame: {} }, tinyPNG), /Untrusted/);
  let options;
  electron.dialog.showSaveDialog = async (_window, value) => { options = value; return { canceled: true }; };
  assert.equal(await handlers.get('desktop:export-png')(trustedEvent, tinyPNG, '../../match<>', 'en'), null);
  assert.equal(options.title, 'Save Match Poster');
  assert.equal(options.filters[0].extensions[0], 'png');
  assert.ok(!options.defaultPath.includes('/') && !options.defaultPath.includes('>'));
});

test('desktop permits remembered music autoplay and mutes only hidden smoke windows before loading', () => {
  for (const smoke of [false, true]) {
    let options;
    let muted = false;
    let loaded = false;
    const windowElectron = {
      ...electron,
      BrowserWindow: class {
        constructor(value) {
          options = value;
          this.webContents = {
            setAudioMuted(value) { muted = value; },
            setWindowOpenHandler() {},
            on() {},
          };
        }
        once() {}
        on() {}
        loadFile() {
          assert.equal(muted, smoke, 'Smoke audio is muted before renderer autoplay can start');
          loaded = true;
          return Promise.resolve();
        }
      },
    };
    const windowContext = vm.createContext({
      require: (name) => name === 'electron' ? windowElectron : require(name),
      __dirname: root, Buffer, URL, console, process: { argv: smoke ? ['--smoke-test'] : [] },
    });
    vm.runInContext(`${fs.readFileSync(path.join(root, 'main.cjs'), 'utf8')}\ncreateWindow();`, windowContext);
    assert.equal(loaded, true);
    assert.equal(options.webPreferences.autoplayPolicy, 'no-user-gesture-required');
    assert.equal(options.webPreferences.offscreen, smoke);
    assert.equal(muted, smoke);
  }
});
