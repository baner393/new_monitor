const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Custom mode window APIs ──
  openCanvasWindow: (gridData) => ipcRenderer.send('open-canvas-window', gridData),
  onGridUpdated: (callback) => {
    const listener = (_event, grid) => callback(grid);
    ipcRenderer.on('canvas-grid-updated', listener);
    return () => ipcRenderer.removeListener('canvas-grid-updated', listener);
  },

  // ── Fullscreen canvas window APIs ──
  requestGridData: () => ipcRenderer.invoke('canvas-request-grid'),
  saveGridData: (grid) => ipcRenderer.send('canvas-save-grid', grid),
  onInitGrid: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('canvas-init-grid', listener);
    return () => ipcRenderer.removeListener('canvas-init-grid', listener);
  },
});
