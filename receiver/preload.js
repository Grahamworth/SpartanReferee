'use strict';
// What the window may ask the app to do.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('receiver', {
  state: () => ipcRenderer.invoke('state'),
  judge: (n) => ipcRenderer.invoke('judge', n),
  fixFirewall: () => ipcRenderer.invoke('fixFirewall'),
  removeOldServer: () => ipcRenderer.invoke('removeOldServer'),
  openRecordings: () => ipcRenderer.invoke('openRecordings'),
  copy: (text) => ipcRenderer.invoke('copy', text),
  tailscaleSite: () => ipcRenderer.invoke('tailscaleSite'),
  settings: (v) => ipcRenderer.invoke('settings', v),
  addCamera: () => ipcRenderer.invoke('addCamera'),
  tailscaleInstall: () => ipcRenderer.invoke('tailscaleInstall'),
  tailscaleUp: () => ipcRenderer.invoke('tailscaleUp'),
  youtube: (n, key) => ipcRenderer.invoke('youtube', n, key),
  review: (n) => ipcRenderer.invoke('review', n),
  judgeSettings: () => ipcRenderer.invoke('judgeSettings'),
  checkUpdate: () => ipcRenderer.invoke('checkUpdate'),
  installUpdate: () => ipcRenderer.invoke('installUpdate'),
});
