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
   * Subscribe to open-skin-selector event from main process (context menu).
   * @param {() => void} callback
   * @returns {() => void} unsubscribe function
   */
  onOpenSkinSelector: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('open-skin-selector', listener);
    return () => ipcRenderer.removeListener('open-skin-selector', listener);
  },

  /**
   * Subscribe to DPI change events (window moved between monitors).
   * @param {() => void} callback
   * @returns {() => void} unsubscribe function
   */
  onDpiChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('dpi-changed', listener);
    return () => ipcRenderer.removeListener('dpi-changed', listener);
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
   * Subscribe to skins-reloaded event (after skin import in custom mode).
   * Sponsor-only feature — no-op in free edition.
   * @param {() => void} callback
   * @returns {() => void} unsubscribe function
   */
  onSkinsReloaded: (callback) => {
    if (!__IS_SPONSOR__) {
      console.warn('[Edition] Skin import is a sponsor-only feature');
      return () => {};
    }
    const listener = () => callback();
    ipcRenderer.on('skins-reloaded', listener);
    return () => ipcRenderer.removeListener('skins-reloaded', listener);
  },

  /**
   * Read full skin config (skins.json) from writable userData path.
   * Frame paths are resolved to absolute file:// URLs for texture loading.
   * @returns {Promise<{skins: Array, defaultSkin: string}>}
   */
  getSkinConfig: () => ipcRenderer.invoke('skin-get-config'),

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

  /**
   * Skin persistence API — save/load selected skin across sessions.
   */
  skin: {
    /** Set the active skin and persist to file. */
    set: (skinId) => {
      ipcRenderer.send('skin-set', skinId);
    },

    /** Get the saved skin ID. */
    get: () => ipcRenderer.invoke('skin-get'),
  },
});
