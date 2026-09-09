const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('catApi', {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  recordStudy: (counts) => ipcRenderer.invoke('study:record', counts),
  setStudy: (counts) => ipcRenderer.invoke('study:set', counts),
  undoStudy: (date) => ipcRenderer.invoke('study:undo', date),
  undoNewWord: (date) => ipcRenderer.invoke('study:undo-new', date),
  undoReviewWord: (date) => ipcRenderer.invoke('study:undo-review', date),
  showPanel: () => ipcRenderer.invoke('panel:show'),
  showChat: () => ipcRenderer.invoke('chat:show'),
  loadCatPersonality: () => ipcRenderer.invoke('cat:personality'),
  sendChat: (payload) => ipcRenderer.invoke('chat:send', payload),
  abortChat: () => ipcRenderer.send('chat:abort'),
  onStateChanged: (callback) => ipcRenderer.on('state:changed', (_event, state) => callback(state)),
  onPetBubble: (callback) => ipcRenderer.on('pet:bubble', (_event, payload) => callback(payload)),
  onPanelToast: (callback) => ipcRenderer.on('panel:toast', (_event, message) => callback(message)),
  showPetMenu: () => ipcRenderer.send('pet:context-menu'),
  startPetDrag: () => ipcRenderer.send('pet:drag-start'),
  updatePetDrag: () => ipcRenderer.send('pet:drag-move'),
  stopPetDrag: () => ipcRenderer.send('pet:drag-end'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:set-ignore-mouse', ignore),
  onPetScale: (callback) => ipcRenderer.on('pet:scale', (_event, scale) => callback(scale)),
  stepPetScale: (delta) => ipcRenderer.send('pet:scale-step', delta)
});
