'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deadlock', Object.freeze({
  setZoomFactor: (value) => ipcRenderer.invoke('desktop:set-zoom', value),
  toggleFullscreen: () => ipcRenderer.invoke('desktop:toggle-fullscreen'),
  getVersion: () => ipcRenderer.invoke('desktop:version'),
  getUpdateState: () => ipcRenderer.invoke('desktop:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  onUpdateState: listener => {
    if (typeof listener !== 'function') throw new TypeError('An update listener must be a function.');
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on('desktop:update-state', wrapped);
    return () => ipcRenderer.removeListener('desktop:update-state', wrapped);
  },
  openProjectLink: (kind = 'github') => ipcRenderer.invoke('desktop:open-link', kind),
  copyAppLink: () => ipcRenderer.invoke('desktop:copy-app-link'),
  exportJSON: (text, language = 'ru') => ipcRenderer.invoke('desktop:export-json', text, language),
  importJSON: (language = 'ru') => ipcRenderer.invoke('desktop:import-json', language),
  exportPNG: (dataURL, name, language = 'ru') => ipcRenderer.invoke('desktop:export-png', dataURL, name, language),
}));
