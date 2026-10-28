'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deadlock', Object.freeze({
  setZoomFactor: (value) => ipcRenderer.invoke('desktop:set-zoom', value),
  toggleFullscreen: () => ipcRenderer.invoke('desktop:toggle-fullscreen'),
  getVersion: () => ipcRenderer.invoke('desktop:version'),
  exportJSON: (text, language = 'ru') => ipcRenderer.invoke('desktop:export-json', text, language),
  importJSON: (language = 'ru') => ipcRenderer.invoke('desktop:import-json', language),
  exportPNG: (dataURL, name, language = 'ru') => ipcRenderer.invoke('desktop:export-png', dataURL, name, language),
}));
