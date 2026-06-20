const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Toggle mouse-event passthrough.
   * @param {boolean} ignore  true = click-through, false = normal
   */
  setIgnoreMouseEvents: (ignore) => {
    ipcRenderer.send('set-ignore-mouse', ignore);
  },

  /**
   * Subscribe to GPU data pushed from the main process.
   * @param {(data: object) => void} callback
   * @returns {() => void} unsubscribe function
   */
  onGPUData: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('gpu-data', listener);
    return () => ipcRenderer.removeListener('gpu-data', listener);
  },

  /**
   * Manually request a fresh GPU data poll.
   */
  requestGPUData: () => {
    ipcRenderer.send('request-gpu-data');
  },

  /**
   * Resize the BrowserWindow.
   * @param {{ width: number, height: number }} bounds
   */
  setBounds: (bounds) => {
    ipcRenderer.send('set-bounds', bounds);
  },

  /**
   * Show the context menu at cursor position.
   */
  showContextMenu: () => {
    ipcRenderer.send('show-context-menu');
  },
});
