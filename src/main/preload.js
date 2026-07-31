const { contextBridge, ipcRenderer } = require('electron');

let rendererInputGeneration = null;

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Toggle mouse-event passthrough.
   * @param {boolean} ignore  true = click-through, false = normal
   */
  setIgnoreMouseEvents: (ignore) => {
    ipcRenderer.send('set-ignore-mouse', ignore, rendererInputGeneration);
  },

  /** Complete the per-navigation transparent-window input handshake. */
  markRendererInputReady: (ignore) => {
    ipcRenderer.send('renderer-input-ready', ignore, rendererInputGeneration);
  },

  /** Bind this isolated renderer document to the current navigation generation. */
  initializeRendererInputSession: async () => {
    rendererInputGeneration = await ipcRenderer.invoke('renderer-input-generation-get');
    return rendererInputGeneration;
  },

  /** Return the current cursor position relative to this window. */
  getCursorPosition: () => ipcRenderer.invoke('cursor-position-get'),

  /** Subscribe to unified CPU / memory / disk / network / GPU snapshots. */
  onSystemData: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('system-data', listener);
    return () => ipcRenderer.removeListener('system-data', listener);
  },

  /** Manually request a fresh system snapshot. */
  requestSystemData: () => {
    ipcRenderer.send('request-system-data');
  },

  /** Report whether the hardware panel is visible; animation frame rate is unaffected. */
  setMonitorActivity: (state) => {
    ipcRenderer.send('monitor-activity-set', state);
  },

  /** Refresh renderer-owned state without navigating or destroying the page. */
  onSoftRefresh: (callback) => {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('soft-refresh', listener);
    return () => ipcRenderer.removeListener('soft-refresh', listener);
  },

  completeSoftRefresh: (result) => {
    ipcRenderer.send('soft-refresh-complete', result);
  },

  /** Persistent monitor field visibility and optional elevated restart. */
  monitor: {
    getConfiguration: () => ipcRenderer.invoke('monitor-panel-config-get'),
    saveConfiguration: (config) => ipcRenderer.send('monitor-panel-config-set', config),
    getVisibility: () => ipcRenderer.invoke('monitor-settings-get'),
    setVisibility: (visibility) => ipcRenderer.send('monitor-settings-set', visibility),
    requestElevation: () => ipcRenderer.invoke('monitor-request-elevation'),
  },

  /** Local Codex conversation sync and optional app-server managed replies. */
  codex: {
    getConfig: () => ipcRenderer.invoke('codex-config-get'),
    saveConfig: (config) => ipcRenderer.invoke('codex-config-set', config),
    selectHome: () => ipcRenderer.invoke('codex-home-select'),
    getStatus: () => ipcRenderer.invoke('codex-status-get'),
    refresh: () => ipcRenderer.invoke('codex-refresh'),
    markRead: (eventId) => ipcRenderer.invoke('codex-mark-read', eventId),
    reply: (threadId, text) => ipcRenderer.invoke('codex-reply', { threadId, text }),
    respond: (requestId, response) => ipcRenderer.invoke('codex-respond', { requestId, response }),
    openApp: (threadId, title) => ipcRenderer.invoke('codex-open-app', { threadId, title }),
    onStatus: (callback) => {
      const listener = (_event, snapshot) => callback(snapshot);
      ipcRenderer.on('codex-status', listener);
      return () => ipcRenderer.removeListener('codex-status', listener);
    },
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

  /** Re-evaluate transparent-window hit testing after a secondary window closes. */
  onResyncMousePassthrough: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('resync-mouse-passthrough', listener);
    return () => ipcRenderer.removeListener('resync-mouse-passthrough', listener);
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

  /**
   * Get merged skin list (built-in ASAR + custom userData).
   * Returns { skins: [...], defaultSkin: '...' }
   */
  skinListGet: () => ipcRenderer.invoke('skin-list-get'),
});
