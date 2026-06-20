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

  /**
   * Subscribe to open-settings event from main process (context menu).
   * @param {() => void} callback
   * @returns {() => void} unsubscribe function
   */
  onOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('open-settings', listener);
    return () => ipcRenderer.removeListener('open-settings', listener);
  },

  /**
   * Subscribe to settings-changed event from main process.
   * @param {(settings: object) => void} callback
   * @returns {() => void} unsubscribe function
   */
  onSettingsChanged: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on('settings-changed', listener);
    return () => ipcRenderer.removeListener('settings-changed', listener);
  },

  /**
   * Settings API — persistent configuration via IPC.
   */
  settings: {
    /** Get current settings object. */
    get: () => ipcRenderer.invoke('settings-get'),

    /** Set a single setting value. */
    set: (key, value) => {
      ipcRenderer.send('settings-set', key, value);
    },

    /** Persist current settings to file. */
    save: () => {
      ipcRenderer.send('settings-save');
    },

    /** Reset all settings to defaults. Returns the new settings object. */
    reset: () => ipcRenderer.invoke('settings-reset'),
  },
});
