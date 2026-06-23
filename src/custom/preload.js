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

  // ── Region marker window APIs ──
  openRegionMarker: (imageData) => ipcRenderer.send('open-region-marker', imageData),
  requestRegionImage: () => ipcRenderer.invoke('region-request-image'),
  regionMarkDone: (regions) => ipcRenderer.send('region-mark-done', regions),
  onRegionResult: (callback) => {
    const listener = (_event, regions) => callback(regions);
    ipcRenderer.on('region-result', listener);
    return () => ipcRenderer.removeListener('region-result', listener);
  },

  // ── Skin Import APIs ──
  skinImportSelectFolder: () => ipcRenderer.invoke('skin-import-select-folder'),
  skinImportReadFiles: (dirPath) => ipcRenderer.invoke('skin-import-read-files', dirPath),
  skinImportCopy: (srcDir, skinId, files) => ipcRenderer.invoke('skin-import-copy', { srcDir, skinId, files }),
  skinImportReadJson: () => ipcRenderer.invoke('skin-import-read-json'),
  skinImportWriteJson: (config) => ipcRenderer.invoke('skin-import-write-json', config),
  skinImportDelete: (skinId) => ipcRenderer.invoke('skin-import-delete', skinId),
});
