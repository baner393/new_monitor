const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('skinPublisher', {
  selectSource: () => ipcRenderer.invoke('skin-publisher-select-source'),
  inspect: (payload) => ipcRenderer.invoke('skin-publisher-inspect', payload),
  writeBuiltIn: (payload) => ipcRenderer.invoke('skin-publisher-write-built-in', payload),
  prepareOnline: (payload) => ipcRenderer.invoke('skin-publisher-prepare-online', payload),
});
