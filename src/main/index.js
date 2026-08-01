import { app, BrowserWindow, clipboard, ipcMain, Menu, dialog, powerMonitor, screen, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { SystemMonitor } from './system-monitor.js';
import { resolveHardwareSensorHostPath } from './hardware-sensor-monitor.js';
import { isWindowsProcessElevated } from './elevation-restart.js';
import {
  createDefaultMonitorPanelConfig,
  migrateLegacyMonitorVisibility,
  normalizeMonitorPanelConfig,
  toLegacyMonitorVisibility,
} from '../shared/monitor-panel-config.js';
import {
  ReloadInputGuard,
  resolveCustomResourcePath,
  SoftRefreshCoordinator,
} from './window-lifecycle.js';
import { CodexMonitor, resolveCodexHome } from './codex-monitor.js';
import { submitCodexDesktopClipboard, waitForCodexDesktopUserMessage } from './codex-desktop-bridge.js';
import { ClaudeMonitor, resolveClaudeExecutables, resolveClaudeHome } from './claude-monitor.js';
import {
  claudeVsCodeUri,
  launchClaudeTerminalSession,
  resolveClaudeIdeTarget,
  submitClaudeClientClipboard,
} from './claude-client-bridge.js';
import {
  DEFAULT_CODEX_INTEGRATION_CONFIG,
  normalizeCodexIntegrationConfig,
} from '../shared/codex-integration.js';
import {
  DEFAULT_CLAUDE_INTEGRATION_CONFIG,
  normalizeClaudeIntegrationConfig,
} from '../shared/claude-integration.js';

let mainWindow;
let customWindow;
let canvasWindow;
let regionWindow;
let systemMonitor;
let codexMonitor;
let claudeMonitor;
let mainWindowInputGuard;
let mainWindowRefreshCoordinator;
let pendingWindowRecovery = null;
let pendingGridData = null;
let pendingRegionImage = null; // temp storage for region marker image data

function resolveCustomResource(fileName) {
  return resolveCustomResourcePath({
    appPath: app.getAppPath(),
    fileName,
    isDevelopment: Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL),
  });
}

function requestMainWindowSoftRefresh() {
  return mainWindowRefreshCoordinator?.request() ?? false;
}

function completeWindowRecovery(browserWindow) {
  const recovery = pendingWindowRecovery;
  if (!recovery || recovery.replacementWindow !== browserWindow) return;
  if (recovery.watchdog) clearTimeout(recovery.watchdog);
  pendingWindowRecovery = null;
  if (!browserWindow.isDestroyed()) browserWindow.showInactive();
  if (recovery.oldWindow && !recovery.oldWindow.isDestroyed()) recovery.oldWindow.destroy();
  console.log(`[Window] Recovery complete (${recovery.reason})`);
}

function recreateMainWindow(reason) {
  if (pendingWindowRecovery || !mainWindow || mainWindow.isDestroyed()) return false;
  const oldWindow = mainWindow;
  mainWindowInputGuard?.suspend();
  const recovery = { reason, oldWindow, replacementWindow: null, watchdog: null };
  pendingWindowRecovery = recovery;
  console.warn(`[Window] Rebuilding renderer after ${reason}`);
  recovery.replacementWindow = createWindow({ show: false });
  recovery.watchdog = setTimeout(() => {
    if (pendingWindowRecovery !== recovery) return;
    console.error('[Window] Replacement renderer did not become interactive; relaunching application');
    app.relaunch();
    app.exit(0);
  }, 8000);
  recovery.watchdog.unref?.();
  return true;
}

// ── Chromium flags (must be before app.whenReady) ────────────
app.commandLine.appendSwitch('enable-transparent-visuals');

// ── Settings persistence ────────────────────────────────────────────
// Use Electron's userData directory for reliable cross-platform persistence
const SETTINGS_PATH = path.join(app.getPath('userData'), 'turtle-settings.json');

const DEFAULT_MONITOR_PANEL = createDefaultMonitorPanelConfig();
const DEFAULT_SETTINGS = {
  turtleSize:       64,
  ropeLength:       150,
  gravity:          800,
  damping:          0.995,
  pulleyFriction:   0.92,
  ropeStiffness:    500,
  ropeDamping:      15,
  bounceRestitution: 0.6,
  airDamping:       0.98,
  ropeElasticity:   5,      // 档位 1-12（与渲染进程一致）
  selectedSkin:     'turtle',
  ambientSwingEnabled: true,
  panelMoveStable:  true,
  monitorVisibility: toLegacyMonitorVisibility(DEFAULT_MONITOR_PANEL),
  monitorPanel: DEFAULT_MONITOR_PANEL,
  codexIntegration: DEFAULT_CODEX_INTEGRATION_CONFIG,
  claudeIntegration: DEFAULT_CLAUDE_INTEGRATION_CONFIG,
};

let currentSettings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      currentSettings = { ...DEFAULT_SETTINGS, ...data };
      currentSettings.monitorPanel = data.monitorPanel
        ? normalizeMonitorPanelConfig(data.monitorPanel)
        : migrateLegacyMonitorVisibility(data.monitorVisibility, DEFAULT_MONITOR_PANEL);
      currentSettings.monitorVisibility = toLegacyMonitorVisibility(currentSettings.monitorPanel);
      currentSettings.codexIntegration = normalizeCodexIntegrationConfig(data.codexIntegration);
      currentSettings.claudeIntegration = normalizeClaudeIntegrationConfig(data.claudeIntegration);
      console.log('[Settings] Loaded from', SETTINGS_PATH);
    }
  } catch (err) {
    console.warn('[Settings] Failed to load:', err.message);
  }
}

function saveSettings() {
  try {
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(currentSettings, null, 2), 'utf-8');
    console.log('[Settings] Saved to', SETTINGS_PATH);
    // Notify renderer of new settings
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('settings-changed', currentSettings);
    }
  } catch (err) {
    console.error('[Settings] Failed to save:', err.message);
  }
}

// Load settings on startup
loadSettings();

// IPC: settings.get — return current settings
ipcMain.handle('settings-get', () => {
  return { ...currentSettings };
});

ipcMain.handle('monitor-settings-get', () => ({
  ...DEFAULT_SETTINGS.monitorVisibility,
  ...(currentSettings.monitorVisibility || {}),
}));

ipcMain.handle('monitor-panel-config-get', () => normalizeMonitorPanelConfig(currentSettings.monitorPanel));

ipcMain.handle('codex-config-get', () => normalizeCodexIntegrationConfig(currentSettings.codexIntegration));
ipcMain.handle('claude-config-get', () => normalizeClaudeIntegrationConfig(currentSettings.claudeIntegration));

ipcMain.handle('codex-config-set', (_event, config) => {
  currentSettings.codexIntegration = codexMonitor
    ? codexMonitor.updateConfig(config)
    : normalizeCodexIntegrationConfig(config);
  if (!codexMonitor) saveSettings();
  return currentSettings.codexIntegration;
});

ipcMain.handle('codex-home-select', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Codex 数据目录',
    properties: ['openDirectory'],
    defaultPath: resolveCodexHome(currentSettings.codexIntegration) || app.getPath('home'),
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('codex-status-get', () => codexMonitor?.getSnapshot() || null);
ipcMain.handle('codex-messages-get', async (_event, payload = {}) => await codexMonitor?.getMessages(
  payload.threadId,
  { cursor: payload.cursor ?? null, limit: payload.limit ?? 50 },
) || { threadId: String(payload.threadId || ''), messages: [], nextCursor: null, total: 0 });
ipcMain.handle('codex-refresh', async () => {
  await codexMonitor?.scan(true);
  return codexMonitor?.getSnapshot() || null;
});
ipcMain.handle('codex-mark-read', (_event, eventId) => codexMonitor?.markRead(eventId) || null);
ipcMain.handle('codex-mark-notified', (_event, eventId) => codexMonitor?.markNotified(eventId) || null);
ipcMain.handle('codex-thread-connect', (_event, threadId) => codexMonitor?.connectThread(threadId));
ipcMain.handle('codex-thread-disconnect', (_event, threadId) => codexMonitor?.disconnectThread(threadId));
ipcMain.handle('codex-reply', async (_event, payload) => {
  const submittedAtMs = Date.now();
  const result = await codexMonitor?.reply(payload?.threadId, payload?.text);
  if (!result?.openDesktop) return result;
  clipboard.writeText(String(payload?.text || ''));
  try {
    await shell.openExternal(`codex://threads/${encodeURIComponent(result.threadId)}`);
  } catch (error) {
    return {
      ...result,
      copied: true,
      opened: false,
      submitted: false,
      openError: error?.message || String(error),
    };
  }
  try {
    const submitted = await submitCodexDesktopClipboard({ text: payload?.text });
    const recorded = await waitForCodexDesktopUserMessage({
      text: payload?.text,
      sinceMs: submittedAtMs,
      readMessages: async () => {
        await codexMonitor?.scan(true);
        const page = await codexMonitor?.getMessages(result.threadId, { limit: 100 });
        return page?.messages || [];
      },
    });
    if (!recorded) throw new Error('Codex client did not record the submitted message');
    return { ...result, copied: true, opened: true, submitted: true, desktopProcessId: submitted.processId };
  } catch (error) {
    return { ...result, copied: true, opened: true, submitted: false, submitError: error?.message || String(error) };
  }
});
ipcMain.handle('codex-respond', (_event, payload) => codexMonitor?.respond(payload?.requestId, payload?.response));
ipcMain.handle('codex-open-app', async (_event, payload = {}) => {
  const threadId = String(payload.threadId || '').trim();
  const target = threadId ? `codex://threads/${encodeURIComponent(threadId)}` : 'codex://';
  await shell.openExternal(target);
  return { opened: true, exact: Boolean(threadId), copiedThread: false };
});
ipcMain.handle('codex-open-link', async (_event, value) => {
  const target = new URL(String(value || '').trim());
  if (!['http:', 'https:', 'mailto:'].includes(target.protocol)) throw new Error('Unsupported Codex message link');
  await shell.openExternal(target.href);
  return { opened: true };
});

ipcMain.handle('claude-config-set', (_event, config) => {
  currentSettings.claudeIntegration = claudeMonitor
    ? claudeMonitor.updateConfig(config)
    : normalizeClaudeIntegrationConfig(config);
  if (!claudeMonitor) saveSettings();
  return currentSettings.claudeIntegration;
});
ipcMain.handle('claude-home-select', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Claude Code 数据目录',
    properties: ['openDirectory'],
    defaultPath: resolveClaudeHome(currentSettings.claudeIntegration) || app.getPath('home'),
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});
ipcMain.handle('claude-status-get', () => claudeMonitor?.getSnapshot() || null);
ipcMain.handle('claude-messages-get', async (_event, payload = {}) => await claudeMonitor?.getMessages(
  payload.sessionId || payload.threadId,
  { cursor: payload.cursor ?? null, limit: payload.limit ?? 50 },
) || { threadId: String(payload.sessionId || payload.threadId || ''), messages: [], nextCursor: null, total: 0 });
ipcMain.handle('claude-refresh', async () => {
  await claudeMonitor?.scan(true);
  return claudeMonitor?.getSnapshot() || null;
});
ipcMain.handle('claude-mark-read', (_event, eventId) => claudeMonitor?.markRead(eventId) || null);
ipcMain.handle('claude-mark-notified', (_event, eventId) => claudeMonitor?.markNotified(eventId) || null);
ipcMain.handle('claude-session-connect', (_event, sessionId) => claudeMonitor?.connectSession(sessionId));
ipcMain.handle('claude-session-disconnect', (_event, sessionId) => claudeMonitor?.disconnectSession(sessionId));

async function waitForClaudeMessage(sessionId, text, sinceMs, attempts = 40) {
  return waitForCodexDesktopUserMessage({
    text,
    sinceMs,
    attempts,
    readMessages: async () => {
      await claudeMonitor?.scan(true);
      return (await claudeMonitor?.getMessages(sessionId, { limit: 100 }))?.messages || [];
    },
  });
}

function claudeTask(sessionId) {
  return claudeMonitor?.getSnapshot()?.tasks?.find((task) => String(task.id) === String(sessionId)) || null;
}

ipcMain.handle('claude-reply', async (_event, payload = {}) => {
  const submittedAtMs = Date.now();
  const text = String(payload.text || '');
  const result = await claudeMonitor?.reply(payload.sessionId || payload.threadId, text);
  if (!result?.openClient) return result;
  const task = claudeTask(result.sessionId);
  const owner = task?.owner || result.owner || null;
  const claudeHome = resolveClaudeHome(currentSettings.claudeIntegration);
  clipboard.writeText(text);
  let opened = false;
  let bridge = null;
  try {
    const ide = /vscode/i.test(String(task?.entrypoint || owner?.entrypoint || ''))
      ? resolveClaudeIdeTarget(claudeHome, task?.cwd || owner?.cwd || '')
      : null;
    if (ide) {
      await shell.openExternal(claudeVsCodeUri({ sessionId: result.sessionId, scheme: ide.scheme }));
      opened = true;
      const bridgeOptions = { processId: ide.pid || owner?.pid || 0, paste: true, preferForeground: true };
      try { bridge = await submitClaudeClientClipboard({ ...bridgeOptions, shortcut: 'enter' }); }
      catch { bridge = await submitClaudeClientClipboard({ ...bridgeOptions, shortcut: 'ctrl-enter', focusDelayMs: 150 }); }
    } else if (owner?.pid) {
      opened = true;
      const bridgeOptions = { processId: owner.pid, paste: true, focusDelayMs: 150 };
      try { bridge = await submitClaudeClientClipboard({ ...bridgeOptions, shortcut: 'enter' }); }
      catch { bridge = await submitClaudeClientClipboard({ ...bridgeOptions, shortcut: 'ctrl-enter' }); }
    } else {
      const executable = resolveClaudeExecutables().find((candidate) => !path.isAbsolute(candidate) || fs.existsSync(candidate));
      launchClaudeTerminalSession({
        executable,
        cwd: task?.cwd || app.getPath('home'),
        sessionId: result.sessionId,
        prompt: text,
      });
      opened = true;
    }
    let recorded = await waitForClaudeMessage(result.sessionId, text, submittedAtMs, 28);
    if (!recorded && bridge) {
      await submitClaudeClientClipboard({
        processId: owner?.pid || bridge.processId || 0,
        paste: false,
        shortcut: 'ctrl-enter',
        focusDelayMs: 100,
        preferForeground: Boolean(ide),
      });
      recorded = await waitForClaudeMessage(result.sessionId, text, submittedAtMs, 20);
    }
    if (!recorded) throw new Error('Claude Code 客户端已打开并预填消息，但没有确认提交；消息仍保留在原窗口中');
    return { ...result, copied: true, opened, submitted: true, clientProcessId: bridge?.processId || owner?.pid || 0 };
  } catch (error) {
    return { ...result, copied: true, opened, submitted: false, submitError: error?.message || String(error) };
  }
});

ipcMain.handle('claude-open-app', async (_event, payload = {}) => {
  const sessionId = String(payload.sessionId || payload.threadId || '').trim();
  const task = claudeTask(sessionId);
  const owner = task?.owner || null;
  const claudeHome = resolveClaudeHome(currentSettings.claudeIntegration);
  const ide = /vscode/i.test(String(task?.entrypoint || owner?.entrypoint || ''))
    ? resolveClaudeIdeTarget(claudeHome, task?.cwd || owner?.cwd || '')
    : null;
  if (ide) {
    await shell.openExternal(claudeVsCodeUri({ sessionId, scheme: ide.scheme }));
    return { opened: true, exact: true, surface: ide.ideName || ide.scheme };
  }
  if (owner?.pid) {
    await submitClaudeClientClipboard({ processId: owner.pid, paste: false, shortcut: 'none', focusDelayMs: 100 });
    return { opened: true, exact: true, surface: 'terminal' };
  }
  const executable = resolveClaudeExecutables().find((candidate) => !path.isAbsolute(candidate) || fs.existsSync(candidate));
  launchClaudeTerminalSession({ executable, cwd: task?.cwd || app.getPath('home'), sessionId, prompt: '' });
  return { opened: true, exact: true, surface: 'terminal' };
});

ipcMain.on('monitor-panel-config-set', (_event, config) => {
  currentSettings.monitorPanel = normalizeMonitorPanelConfig(config);
  currentSettings.monitorVisibility = toLegacyMonitorVisibility(currentSettings.monitorPanel);
  saveSettings();
});

ipcMain.on('monitor-settings-set', (_event, visibility) => {
  const next = {};
  for (const key of Object.keys(DEFAULT_SETTINGS.monitorVisibility)) {
    next[key] = visibility?.[key] !== false;
  }
  currentSettings.monitorVisibility = next;
  currentSettings.monitorPanel = migrateLegacyMonitorVisibility(next, currentSettings.monitorPanel);
  saveSettings();
});

// IPC: settings.set — set a single value
ipcMain.on('settings-set', (event, key, value) => {
  if (key in DEFAULT_SETTINGS) {
    currentSettings[key] = value;
  }
});

// IPC: settings.save — persist to file
ipcMain.on('settings-save', () => {
  saveSettings();
});

// IPC: skin.set — set selected skin and persist
ipcMain.on('skin-set', (event, skinId) => {
  currentSettings.selectedSkin = skinId;
  saveSettings();
});

// IPC: skin.get — returns the saved skin ID
ipcMain.handle('skin-get', () => {
  return currentSettings.selectedSkin || 'turtle';
});

// IPC: settings.reset — reset to defaults
ipcMain.handle('settings-reset', () => {
  const monitorPanel = createDefaultMonitorPanelConfig();
  currentSettings = {
    ...DEFAULT_SETTINGS,
    monitorPanel,
    monitorVisibility: toLegacyMonitorVisibility(monitorPanel),
    codexIntegration: normalizeCodexIntegrationConfig(DEFAULT_CODEX_INTEGRATION_CONFIG),
    claudeIntegration: normalizeClaudeIntegrationConfig(DEFAULT_CLAUDE_INTEGRATION_CONFIG),
  };
  codexMonitor?.updateConfig(currentSettings.codexIntegration);
  claudeMonitor?.updateConfig(currentSettings.claudeIntegration);
  saveSettings();
  return { ...currentSettings };
});

// ── Skin path constants (outside __IS_SPONSOR__ — needed by skin-list-get) ──
// Read path: ASAR (built-in skins, read-only)
const SKINS_BASE_PATH = MAIN_WINDOW_VITE_DEV_SERVER_URL
  ? path.join(app.getAppPath(), 'public', 'assets', 'skins')
  : path.join(app.getAppPath(), '.vite', 'renderer', 'main_window', 'assets', 'skins');
const SKINS_JSON_PATH = path.join(SKINS_BASE_PATH, 'skins.json');
// Write path: userData (for custom skins, writable)
const SKINS_USER_PATH = path.join(app.getPath('userData'), 'skins');
const SKINS_USER_JSON = path.join(SKINS_USER_PATH, 'skins.json');

// IPC: skin-list-get — return merged skin list (built-in ASAR + custom userData)
// Custom images are returned as data URLs. This works from both the Vite HTTP
// dev server and the packaged file:// renderer without weakening webSecurity.
ipcMain.handle('skin-list-get', async () => {
  function resolveSkinPath(skinId, relPath) {
    if (!relPath) return null;
    const safeSkinId = path.basename(String(skinId));
    if (safeSkinId !== skinId) return null;
    const fileName = path.basename(relPath);
    const skinRoot = path.resolve(SKINS_USER_PATH, safeSkinId);
    const fullPath = path.resolve(skinRoot, fileName);
    if (!fullPath.startsWith(skinRoot + path.sep) || !fs.existsSync(fullPath)) return null;
    const image = fs.readFileSync(fullPath);
    return `data:image/png;base64,${image.toString('base64')}`;
  }

  function transformCustomSkin(skin) {
    const out = { ...skin };
    const idle = resolveSkinPath(skin.id, out.frames?.idle);
    if (!idle) {
      console.warn(`[Skins] Ignoring custom skin without a readable idle frame: ${skin.id}`);
      return null;
    }
    const newFrames = {};
    for (const [key, val] of Object.entries(out.frames || {})) {
      newFrames[key] = resolveSkinPath(skin.id, val) || idle;
    }
    out.frames = newFrames;
    out.preview = resolveSkinPath(skin.id, out.preview) || idle;
    return out;
  }

  // 1. Read built-in skins from ASAR
  let builtInSkins = [];
  let defaultSkin = 'turtle';
  try {
    const asarRaw = fs.readFileSync(SKINS_JSON_PATH, 'utf-8');
    const asarCfg = JSON.parse(asarRaw);
    builtInSkins = asarCfg.skins || [];
    defaultSkin = asarCfg.defaultSkin || 'turtle';
  } catch (err) {
    console.error('[Skins] Failed to read built-in skins:', err.message);
  }

  // 2. Read custom skins from userData
  let customSkins = [];
  try {
    if (fs.existsSync(SKINS_USER_JSON)) {
      const userRaw = fs.readFileSync(SKINS_USER_JSON, 'utf-8');
      const userCfg = JSON.parse(userRaw);
      customSkins = (userCfg.customSkins || userCfg.skins || []).filter(s => {
        // Only custom skins (not built-in duplicates)
        return !builtInSkins.some(b => b.id === s.id);
      }).map(transformCustomSkin).filter(Boolean);
    }
  } catch (err) {
    console.warn('[Skins] Failed to read custom skins:', err.message);
  }

  // 3. Merge (built-in first, then custom — custom wins by not duplicating ids)
  return {
    skins: [...builtInSkins, ...customSkins],
    defaultSkin,
  };
});

function createWindow({ show = true } = {}) {
  // Get screen dimensions for full-screen transparent window
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const { x: screenX, y: screenY } = primaryDisplay.workArea;
  
  // Full-screen transparent window (transparent pixels are nearly free in GPU)
  // y:-50 extends 50px above screen to hide DWM white border outside visible area
  const browserWindow = new BrowserWindow({
    x: screenX - 2,
    y: screenY - 50,
    width: screenWidth + 4,
    height: screenHeight + 50,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    titleBarStyle: 'hidden',
    title: ' ',
    show,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    // titleBarOverlay 会绘制渐变白线，桌面宠物不需要原生窗口按钮，完全删除
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow = browserWindow;

  // Remove menu bar to prevent Alt-triggered black text
  browserWindow.setMenu(null);
  const inputGuard = new ReloadInputGuard(browserWindow);
  mainWindowInputGuard = inputGuard;
  const refreshCoordinator = new SoftRefreshCoordinator({
    send: (requestId) => {
      if (browserWindow.isDestroyed() || browserWindow.webContents.isDestroyed()) {
        throw new Error('Renderer window is unavailable');
      }
      browserWindow.webContents.send('soft-refresh', { requestId });
    },
    onFailure: (error) => {
      if (mainWindow === browserWindow) recreateMainWindow(error.message);
    },
  });
  mainWindowRefreshCoordinator = refreshCoordinator;

  // The renderer owns transparent hit testing. Keep the full-work-area window
  // click-through until the active document restores hit testing from the real
  // cursor position.
  let rendererLoadGeneration = 0;
  browserWindow.webContents.on('did-start-loading', () => {
    rendererLoadGeneration += 1;
    console.log(`[Window] Renderer load ${rendererLoadGeneration} started; desktop passthrough enabled`);
    inputGuard.beginLoad();
  });

  browserWindow.webContents.on('did-finish-load', () => {
    console.log(`[Window] Renderer load ${rendererLoadGeneration} finished`);
    browserWindow.setTitle(' ');
    inputGuard.finishLoad();
  });

  browserWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) {
      console.error(`[Window] Renderer load failed (${code}) ${description}: ${url}`);
      inputGuard.failOpen();
    }
  });

  browserWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[Window] Renderer process gone: ${details.reason}`);
    inputGuard.failOpen();
    if (mainWindow === browserWindow) recreateMainWindow(`renderer process ${details.reason}`);
  });

  // Fix DPI scaling - prevent Windows from auto-scaling
  browserWindow.webContents.setZoomFactor(1);

  // Handle DPI changes when window moves between monitors
  browserWindow.on('moved', () => {
    if (!browserWindow.isDestroyed()) {
      browserWindow.webContents.send('dpi-changed');
    }
  });

  // Enable click-through with forward
  browserWindow.setIgnoreMouseEvents(true, { forward: true });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    browserWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    browserWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  // Listen for console messages from renderer (new API)
  browserWindow.webContents.on('console-message', (event) => {
    const message = event.message;
    if (message.includes('[BOUNCE]') || message.includes('[Input]') || message.includes('[GameLoop]') || message.includes('[FPS]') || message.includes('[Skin]') || message.includes('[SkinSelector]')) {
      console.log(`[RENDERER] ${message}`);
    }
  });

  browserWindow.on('closed', () => {
    inputGuard.dispose();
    refreshCoordinator.dispose();
    if (mainWindow === browserWindow) {
      mainWindowInputGuard = null;
      mainWindowRefreshCoordinator = null;
      if (systemMonitor) {
        systemMonitor.stop();
        systemMonitor = null;
      }
      mainWindow = null;
    }
  });

  // Start the unified CPU / memory / disk / network / GPU monitor.
  const sensorHostPath = resolveHardwareSensorHostPath({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
  });
  if (systemMonitor) {
    systemMonitor.win = browserWindow;
    systemMonitor.requestSnapshot();
  } else {
    systemMonitor = new SystemMonitor(browserWindow, 2000, {
      sensorHostPath,
      getSystemIdleTime: () => powerMonitor.getSystemIdleTime(),
    });
    systemMonitor.setActivityState({ onBattery: powerMonitor.isOnBatteryPower() });
    systemMonitor.start();
  }
  if (codexMonitor) {
    codexMonitor.setWindow(browserWindow);
    codexMonitor.scan(true);
  }
  if (claudeMonitor) {
    claudeMonitor.setWindow(browserWindow);
    claudeMonitor.scan(true);
  }
  return browserWindow;
}

// ── Launch on Windows ──────────────────────────────────────────────
app.whenReady().then(() => {
  codexMonitor = new CodexMonitor({
    config: currentSettings.codexIntegration,
    onConfigChange: (config) => {
      currentSettings.codexIntegration = config;
      saveSettings();
    },
  });
  claudeMonitor = new ClaudeMonitor({
    config: currentSettings.claudeIntegration,
    onConfigChange: (config) => {
      currentSettings.claudeIntegration = config;
      saveSettings();
    },
  });
  codexMonitor.start();
  claudeMonitor.start();
  createWindow();
  powerMonitor.on('on-battery', () => systemMonitor?.setActivityState({ onBattery: true }));
  powerMonitor.on('on-ac', () => systemMonitor?.setActivityState({ onBattery: false }));
  powerMonitor.on('suspend', () => systemMonitor?.setActivityState({ suspended: true }));
  powerMonitor.on('resume', () => {
    systemMonitor?.setActivityState({ suspended: false });
    systemMonitor?.requestSnapshot();
    codexMonitor?.scan(true);
    claudeMonitor?.scan(true);
  });
});

// IPC: renderer can toggle click-through
ipcMain.on('set-ignore-mouse', (event, ignore, generation) => {
  if (mainWindow && event.sender === mainWindow.webContents) {
    mainWindowInputGuard?.setFromRenderer(ignore, generation);
  }
});

ipcMain.handle('renderer-input-generation-get', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return null;
  return mainWindowInputGuard?.generation ?? null;
});

ipcMain.on('renderer-input-ready', (event, ignore, generation) => {
  if (mainWindow && event.sender === mainWindow.webContents) {
    const accepted = mainWindowInputGuard?.markRendererReady(ignore, generation);
    console.log(`[Window] Renderer input generation ${mainWindowInputGuard?.generation} ready; passthrough=${Boolean(ignore)} accepted=${Boolean(accepted)}`);
    if (accepted) completeWindowRecovery(mainWindow);
  }
});

ipcMain.on('soft-refresh-complete', (event, result) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  mainWindowRefreshCoordinator?.complete(
    result?.requestId,
    result?.ok !== false,
    result?.error || '',
  );
});

ipcMain.handle('cursor-position-get', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) return null;
  const cursor = screen.getCursorScreenPoint();
  const bounds = window.getBounds();
  return { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
});

// IPC: renderer can manually request a fresh system snapshot.
ipcMain.on('request-system-data', () => {
  if (systemMonitor) {
    systemMonitor.requestSnapshot();
  }
  codexMonitor?.scan(true);
  claudeMonitor?.scan(true);
});

ipcMain.on('monitor-activity-set', (event, state = {}) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  systemMonitor?.setActivityState({ panelOpen: Boolean(state.panelOpen) });
});

ipcMain.handle('monitor-request-elevation', async () => {
  if (isWindowsProcessElevated() || systemMonitor?.hardwareClient?.elevated) {
    return { started: false, alreadyElevated: true };
  }
  try {
    const result = await systemMonitor.requestHardwareElevation();
    systemMonitor.requestSnapshot();
    return result;
  } catch (error) {
    console.warn('[Elevation] Hardware reader elevation did not complete:', error.message);
    return { started: false, alreadyElevated: false, error: error.message };
  }
});

// IPC: renderer can resize the window
ipcMain.on('set-bounds', (event, bounds) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const current = mainWindow.getBounds();
    mainWindow.setBounds({
      x: current.x,
      y: current.y,
      width: bounds.width,
      height: bounds.height,
    });
  }
});

// IPC: show context menu
ipcMain.on('show-context-menu', (event) => {
  const template = [
    {
      label: '刷新',
      click: () => {
        requestMainWindowSoftRefresh();
      },
    },
    {
      label: '设置',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-settings');
        }
      },
    },
    {
      label: '切换皮肤',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-skin-selector');
        }
      },
    },
    { type: 'separator' },
    ...(__IS_SPONSOR__ ? [
      {
        label: '自定义模式',
        click: () => {
          openCustomMode();
        },
      },
    ] : []),
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit();
      },
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: mainWindow });
});

// ── Custom Mode Window ────────────────────────────────────────
function openCustomMode() {
  if (!__IS_SPONSOR__) {
    console.warn('[Edition] Custom mode is a sponsor-only feature');
    return;
  }
  if (customWindow && !customWindow.isDestroyed()) {
    customWindow.show();
    customWindow.focus();
    return;
  }

  // The pet window is a full-work-area always-on-top surface. Make it
  // click-through before showing the editor so the editor cannot be trapped
  // underneath transparent pixels.
  mainWindowInputGuard?.suspend();

  const customPreloadPath = resolveCustomResource('preload.js');
  const customHtmlPath = resolveCustomResource('index.html');
  console.log(`[CustomMode] Opening HTML: ${customHtmlPath}`);
  console.log(`[CustomMode] Using preload: ${customPreloadPath}`);

  customWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#1a1a2e',
    title: 'Turtle Monitor — 自定义模式',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: customPreloadPath,
    },
  });

  customWindow.webContents.setZoomFactor(1);

  customWindow.once('ready-to-show', () => {
    if (customWindow && !customWindow.isDestroyed()) {
      console.log('[CustomMode] Ready and visible');
      customWindow.show();
      customWindow.focus();
    }
  });

  customWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`[CustomMode] Failed to load (${errorCode}): ${errorDescription}`);
  });
  customWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[CustomMode] Preload failed: ${preloadPath}`, error);
  });

  customWindow.loadFile(customHtmlPath).catch((error) => {
    console.error(`[CustomMode] Unable to open ${customHtmlPath}:`, error);
    if (customWindow && !customWindow.isDestroyed()) customWindow.destroy();
  });

  customWindow.on('closed', () => {
    customWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindowInputGuard?.resume();
      mainWindow.webContents.send('resync-mouse-passthrough');
    }
  });
}

// ── Fullscreen Canvas Window ──────────────────────────────────
function openCanvasWindow(gridData) {
  if (!__IS_SPONSOR__) {
    console.warn('[Edition] Canvas window is a sponsor-only feature');
    return;
  }
  if (canvasWindow && !canvasWindow.isDestroyed()) {
    canvasWindow.focus();
    return;
  }

  pendingGridData = gridData;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  canvasWindow = new BrowserWindow({
    width: width,
    height: height,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0e1018',
    title: '像素画布 — 全屏模式',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: resolveCustomResource('preload.js'),
    },
  });

  canvasWindow.webContents.setZoomFactor(1);

  const canvasHtmlPath = resolveCustomResource('canvas-fullscreen.html');
  canvasWindow.loadFile(canvasHtmlPath);

  canvasWindow.on('closed', () => {
    canvasWindow = null;
    pendingGridData = null;
  });
}

// ── Sponsor-only: Canvas IPC + Region Marker + Skin Import ─────
if (__IS_SPONSOR__) {
  // IPC: custom window requests to open fullscreen canvas
  ipcMain.on('open-canvas-window', (event, gridData) => {
    openCanvasWindow(gridData);
  });

  // IPC: fullscreen canvas requests grid data
  ipcMain.handle('canvas-request-grid', () => {
    return pendingGridData || { size: 64, grid: null };
  });

  // IPC: fullscreen canvas saves grid data back
  ipcMain.on('canvas-save-grid', (event, grid) => {
    const payload = pendingGridData?.expressionId
      ? { grid, expressionId: pendingGridData.expressionId }
      : { grid };
    if (customWindow && !customWindow.isDestroyed()) {
      customWindow.webContents.send('canvas-grid-updated', payload);
    }
  });

  // ── Region Marker Window ──────────────────────────────────
  function openRegionMarker(imageData) {
    if (regionWindow && !regionWindow.isDestroyed()) {
      regionWindow.focus();
      return;
    }
    pendingRegionImage = imageData;
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    regionWindow = new BrowserWindow({
      width, height, frame: false, backgroundColor: '#0e1018',
      alwaysOnTop: true,
      title: '标记区域 — 全屏模式',
      webPreferences: {
        nodeIntegration: false, contextIsolation: true,
        preload: resolveCustomResource('preload.js'),
      },
    });
    regionWindow.webContents.setZoomFactor(1);
    regionWindow.loadFile(resolveCustomResource('canvas-region.html'));
    regionWindow.on('closed', () => { regionWindow = null; pendingRegionImage = null; });
  }

  ipcMain.on('open-region-marker', (event, imageData) => openRegionMarker(imageData));
  ipcMain.handle('region-request-image', () => pendingRegionImage || { dataUrl: null });
  ipcMain.on('region-mark-done', (event, regions) => {
    if (customWindow && !customWindow.isDestroyed()) {
      customWindow.webContents.send('region-result', regions);
    }
  });

  // ── Skin Import IPC ─────────────────────────────────────────────
  // SKINS_BASE_PATH, SKINS_JSON_PATH, SKINS_USER_PATH, SKINS_USER_JSON
  // are defined above (outside __IS_SPONSOR__) for skin-list-get.

  // Open folder selection dialog
  ipcMain.handle('skin-import-select-folder', async () => {
    const result = await dialog.showOpenDialog(customWindow, {
      properties: ['openDirectory'],
      title: '选择皮肤文件夹',
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  // Read files from a directory
  ipcMain.handle('skin-import-read-files', async (event, dirPath) => {
    try {
      const files = fs.readdirSync(dirPath);
      return files;
    } catch (err) {
      console.error('[SkinImport] Failed to read directory:', err.message);
      return [];
    }
  });

  // Copy skin files to the skins directory (write to userData)
  ipcMain.handle('skin-import-copy', async (event, { srcDir, skinId, files }) => {
    try {
      const destDir = path.join(SKINS_USER_PATH, skinId);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      for (const file of files) {
        const srcPath = path.join(srcDir, file);
        const destPath = path.join(destDir, file);
        fs.copyFileSync(srcPath, destPath);
      }
      return { success: true, destDir };
    } catch (err) {
      console.error('[SkinImport] Failed to copy files:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Read skins.json (merge ASAR built-in + userData custom)
  ipcMain.handle('skin-import-read-json', async () => {
    // 1. Read built-in from ASAR
    let builtInSkins = [];
    let defaultSkin = 'turtle';
    try {
      const asarRaw = fs.readFileSync(SKINS_JSON_PATH, 'utf-8');
      const asarCfg = JSON.parse(asarRaw);
      builtInSkins = asarCfg.skins || [];
      defaultSkin = asarCfg.defaultSkin || 'turtle';
    } catch (err) {
      console.warn('[SkinImport] Failed to read ASAR skins:', err.message);
    }
    // 2. Read custom from userData
    let customSkins = [];
    try {
      if (fs.existsSync(SKINS_USER_JSON)) {
        const userRaw = fs.readFileSync(SKINS_USER_JSON, 'utf-8');
        const userCfg = JSON.parse(userRaw);
        customSkins = userCfg.customSkins || [];
        if (userCfg.defaultSkin) defaultSkin = userCfg.defaultSkin;
      }
    } catch (err) {
      console.warn('[SkinImport] Failed to read userData skins:', err.message);
    }
    // 3. Merge (built-in + non-duplicate custom)
    const builtInIds = new Set(builtInSkins.map(s => s.id));
    return {
      skins: [...builtInSkins, ...customSkins.filter(s => !builtInIds.has(s.id))],
      defaultSkin,
    };
  });

  // Write skins.json (to userData — only custom skins, no ASAR duplication)
  ipcMain.handle('skin-import-write-json', async (event, config) => {
    try {
      // Ensure userData skins folder exists
      if (!fs.existsSync(SKINS_USER_PATH)) {
        fs.mkdirSync(SKINS_USER_PATH, { recursive: true });
      }
      // Extract only custom skins (filter out built-in duplicates)
      let customSkins = [];
      try {
        const asarRaw = fs.readFileSync(SKINS_JSON_PATH, 'utf-8');
        const asarCfg = JSON.parse(asarRaw);
        const builtInIds = new Set((asarCfg.skins || []).map(s => s.id));
        customSkins = (config.skins || config.customSkins || []).filter(s => !builtInIds.has(s.id));
      } catch (_) {
        // If ASAR read fails, store all as custom
        customSkins = config.skins || config.customSkins || [];
      }
      // Backup existing
      if (fs.existsSync(SKINS_USER_JSON)) {
        const backupPath = SKINS_USER_JSON + '.bak';
        fs.copyFileSync(SKINS_USER_JSON, backupPath);
      }
      // Write only custom skins
      const toWrite = {
        customSkins,
        defaultSkin: config.defaultSkin || 'turtle',
      };
      fs.writeFileSync(SKINS_USER_JSON, JSON.stringify(toWrite, null, 2), 'utf-8');
      // Notify main window to reload skins
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('skins-reloaded');
      }
      return { success: true };
    } catch (err) {
      console.error('[SkinImport] Failed to write skins.json:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Delete skin folder (from userData only, built-in skins are protected)
  ipcMain.handle('skin-import-delete', async (event, skinId) => {
    try {
      const skinDir = path.join(SKINS_USER_PATH, skinId);
      if (!fs.existsSync(skinDir)) {
        return { success: true }; // already gone
      }
      // Recursively delete the folder
      fs.rmSync(skinDir, { recursive: true, force: true });
      console.log('[SkinImport] Deleted skin folder:', skinDir);
      // Notify main window to reload skins
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('skins-reloaded');
      }
      return { success: true };
    } catch (err) {
      console.error('[SkinImport] Failed to delete skin folder:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Get current skin info (frames paths) for the expression editor
  // Merges ASAR built-in + userData custom skins for correct lookup
  ipcMain.handle('skin-get-current', async () => {
    let config = { skins: [], defaultSkin: 'turtle' };
    let currentId = 'turtle';
    let skin = null;

    // 1. Read built-in from ASAR
    try {
      const data = fs.readFileSync(SKINS_JSON_PATH, 'utf-8');
      config = JSON.parse(data);
      currentId = config.defaultSkin || 'turtle';
      skin = config.skins.find(s => s.id === currentId);
    } catch (err) {
      console.warn('[Skins] Failed to read ASAR skins:', err.message);
    }

    // 2. Check custom skins from userData (may override defaultSkin)
    try {
      if (fs.existsSync(SKINS_USER_JSON)) {
        const userData = JSON.parse(fs.readFileSync(SKINS_USER_JSON, 'utf-8'));
        if (userData.defaultSkin) currentId = userData.defaultSkin;
        const userSkins = userData.customSkins || [];
        const userSkin = userSkins.find(s => s.id === currentId);
        if (userSkin) skin = userSkin;
      }
    } catch (err) {
      console.warn('[Skins] Failed to read userData skins:', err.message);
    }

    if (!skin) {
      return { success: false, error: 'skin not found: ' + currentId };
    }

    // Determine if this is a built-in or custom skin for path resolution
    const isBuiltIn = config.skins?.some(s => s.id === currentId);

    // Resolve frame paths to absolute file:// paths
    const frames = {};
    for (const [state, relPath] of Object.entries(skin.frames || {})) {
      let fullPath;
      if (isBuiltIn) {
        // Built-in: resolve relative to ASAR skins base
        fullPath = path.join(SKINS_BASE_PATH, relPath.replace('assets/skins/', ''));
      } else {
        // Custom: resolve relative to userData skins folder
        const fileName = path.basename(relPath);
        fullPath = path.join(SKINS_USER_PATH, currentId, fileName);
      }
      frames[state] = 'file://' + fullPath.replace(/\\/g, '/');
    }
    return { success: true, skinId: currentId, frames, baseSize: skin.baseSize || 24 };
  });

  // Save a PNG file into the skins folder (write to userData)
  ipcMain.handle('skin-save-png', async (event, { skinId, exprId, pngBase64 }) => {
    try {
      const destDir = path.join(SKINS_USER_PATH, skinId);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      const buffer = Buffer.from(pngBase64, 'base64');
      const fileName = exprId + '.png';
      fs.writeFileSync(path.join(destDir, fileName), buffer);
      return { success: true, path: `assets/skins/${skinId}/${fileName}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

// ── Global exception handler ──────────────────────────────────────────
// Suppress EPIPE errors when stdout/stderr pipe is broken (terminal closed).
// Without this, EPIPE triggers a modal error dialog that blocks the main process.
const _origConsoleError = console.error;
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || (err.message && (err.message.includes('EPIPE') || err.message.includes('broken pipe')))) {
    return; // Silently ignore — pipe was closed, harmless
  }
  // For genuine bugs, delegate to original console.error
  _origConsoleError('[FATAL]', err);
});

app.on('window-all-closed', () => {
  if (systemMonitor) systemMonitor.stop();
  codexMonitor?.stop();
  claudeMonitor?.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  codexMonitor?.stop();
  claudeMonitor?.stop();
  if (__IS_SPONSOR__) {
    if (canvasWindow && !canvasWindow.isDestroyed()) {
      canvasWindow.destroy();
      canvasWindow = null;
    }
    if (customWindow && !customWindow.isDestroyed()) {
      customWindow.destroy();
      customWindow = null;
    }
    if (regionWindow && !regionWindow.isDestroyed()) {
      regionWindow.destroy();
      regionWindow = null;
    }
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
