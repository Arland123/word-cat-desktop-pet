const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('catApi', {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  showPanel: () => ipcRenderer.invoke('panel:show'),
  showChat: () => ipcRenderer.invoke('chat:show'),
  loadCatPersonality: () => ipcRenderer.invoke('cat:personality'),
  sendChat: (payload) => ipcRenderer.invoke('chat:send', payload),
  onReminder: (listener) => ipcRenderer.on('reminder', (_event, payload) => listener(payload)),
  triggerReminder: () => ipcRenderer.send('pet:reminder'),
  showPetMenu: () => ipcRenderer.send('pet:context-menu'),
  getPetPosition: () => ipcRenderer.invoke('pet:get-position'),
  movePet: (position) => ipcRenderer.send('pet:move', position),
  startPetDrag: () => ipcRenderer.send('pet:drag-start'),
  updatePetDrag: () => ipcRenderer.send('pet:drag-move'),
  stopPetDrag: () => ipcRenderer.send('pet:drag-end'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:set-ignore-mouse', ignore)
});
