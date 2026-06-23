import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { GPUMonitor } from './gpu-monitor.js';

let mainWindow;
let customWindow;
let canvasWindow;
let regionWindow;
let gpuMonitor;
let pendingGridData = null;
let pendingRegionImage = null; // temp storage for region marker image data

// ── Settings persistence ────────────────────────────────────────────
const SETTINGS_PATH = path.join(os.homedir(), '.hermes', 'profiles', 'coordinator', 'turtle-settings.json');

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
  ropeElasticity:   0.02,
};

let currentSettings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
      currentSettings = { ...DEFAULT_SETTINGS, ...data };
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

// IPC: settings.reset — reset to defaults
ipcMain.handle('settings-reset', () => {
  currentSettings = { ...DEFAULT_SETTINGS };
  saveSettings();
  return { ...currentSettings };
});

function createWindow() {
  // Get screen dimensions for full-screen transparent window
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const { x: screenX, y: screenY } = primaryDisplay.workArea;
  
  // Full-screen transparent window (transparent pixels are nearly free in GPU)
  mainWindow = new BrowserWindow({
    x: screenX,
    y: screenY,
    width: screenWidth,
    height: screenHeight,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    thickFrame: false,
    type: 'toolbar',
    title: '',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Fix DPI scaling - prevent Windows from auto-scaling
  mainWindow.webContents.setZoomFactor(1);

  // Handle DPI changes when window moves between monitors
  mainWindow.on('moved', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dpi-changed');
    }
  });

  // Enable click-through with forward
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  // Listen for console messages from renderer (new API)
  mainWindow.webContents.on('console-message', (event) => {
    const message = event.message;
    if (message.includes('[BOUNCE]') || message.includes('[Input]') || message.includes('[GameLoop]') || message.includes('[FPS]') || message.includes('[Skin]') || message.includes('[SkinSelector]')) {
      console.log(`[RENDERER] ${message}`);
    }
  });

  mainWindow.on('closed', () => {
    if (gpuMonitor) {
      gpuMonitor.stop();
      gpuMonitor = null;
    }
    mainWindow = null;
  });

  // Start GPU monitoring
  gpuMonitor = new GPUMonitor(mainWindow, 2000);
  gpuMonitor.start();
}

// IPC: renderer can toggle click-through
ipcMain.on('set-ignore-mouse', (event, ignore) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

// IPC: renderer can manually request GPU data
ipcMain.on('request-gpu-data', () => {
  if (gpuMonitor) {
    gpuMonitor._poll();
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
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.reload();
        }
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
    {
      label: '自定义模式',
      click: () => {
        openCustomMode();
      },
    },
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
  if (customWindow && !customWindow.isDestroyed()) {
    customWindow.focus();
    return;
  }

  customWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    backgroundColor: '#1a1a2e',
    title: 'Turtle Monitor — 自定义模式',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(app.getAppPath(), 'src', 'custom', 'preload.js'),
    },
  });

  customWindow.webContents.setZoomFactor(1);

  // Load the custom mode HTML directly via file://
  // In dev: app.getAppPath() = project root; in prod: not available (excluded from build)
  const appPath = app.getAppPath();
  const customHtmlPath = path.join(appPath, 'src', 'custom', 'index.html');
  customWindow.loadFile(customHtmlPath);

  customWindow.on('closed', () => {
    customWindow = null;
  });
}

// ── Fullscreen Canvas Window ──────────────────────────────────
function openCanvasWindow(gridData) {
  if (canvasWindow && !canvasWindow.isDestroyed()) {
    canvasWindow.focus();
    return;
  }

  pendingGridData = gridData;

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  canvasWindow = new BrowserWindow({
    width: width,
    height: height,
    frame: false,
    backgroundColor: '#0e1018',
    title: '像素画布 — 全屏模式',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(app.getAppPath(), 'src', 'custom', 'preload.js'),
    },
  });

  canvasWindow.webContents.setZoomFactor(1);

  const canvasHtmlPath = path.join(app.getAppPath(), 'src', 'custom', 'canvas-fullscreen.html');
  canvasWindow.loadFile(canvasHtmlPath);

  canvasWindow.on('closed', () => {
    canvasWindow = null;
    pendingGridData = null;
  });
}

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
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  regionWindow = new BrowserWindow({
    width, height, frame: false, backgroundColor: '#0e1018',
    title: '标记区域 — 全屏模式',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(app.getAppPath(), 'src', 'custom', 'preload.js'),
    },
  });
  regionWindow.webContents.setZoomFactor(1);
  regionWindow.loadFile(path.join(app.getAppPath(), 'src', 'custom', 'canvas-region.html'));
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
const SKINS_BASE_PATH = path.join(app.getAppPath(), 'public', 'assets', 'skins');
const SKINS_JSON_PATH = path.join(SKINS_BASE_PATH, 'skins.json');

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

// Copy skin files to the skins directory
ipcMain.handle('skin-import-copy', async (event, { srcDir, skinId, files }) => {
  try {
    const destDir = path.join(SKINS_BASE_PATH, skinId);
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

// Read skins.json
ipcMain.handle('skin-import-read-json', async () => {
  try {
    const data = fs.readFileSync(SKINS_JSON_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('[SkinImport] Failed to read skins.json:', err.message);
    return { skins: [], defaultSkin: 'turtle' };
  }
});

// Write skins.json
ipcMain.handle('skin-import-write-json', async (event, config) => {
  try {
    // Backup first
    if (fs.existsSync(SKINS_JSON_PATH)) {
      const backupPath = SKINS_JSON_PATH + '.bak';
      fs.copyFileSync(SKINS_JSON_PATH, backupPath);
    }
    fs.writeFileSync(SKINS_JSON_PATH, JSON.stringify(config, null, 2), 'utf-8');
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

// Delete skin folder
ipcMain.handle('skin-import-delete', async (event, skinId) => {
  try {
    const skinDir = path.join(SKINS_BASE_PATH, skinId);
    if (!fs.existsSync(skinDir)) {
      return { success: true }; // already gone
    }
    // Recursively delete the folder
    fs.rmSync(skinDir, { recursive: true, force: true });
    console.log('[SkinImport] Deleted skin folder:', skinDir);
    return { success: true };
  } catch (err) {
    console.error('[SkinImport] Failed to delete skin folder:', err.message);
    return { success: false, error: err.message };
  }
});

// Get current skin info (frames paths) for the expression editor
ipcMain.handle('skin-get-current', async () => {
  try {
    const data = fs.readFileSync(SKINS_JSON_PATH, 'utf-8');
    const config = JSON.parse(data);
    const currentId = config.defaultSkin || 'turtle';
    const skin = config.skins.find(s => s.id === currentId);
    if (!skin) return { success: false, error: 'skin not found' };
    // Resolve frame paths to absolute file:// paths
    const frames = {};
    for (const [state, relPath] of Object.entries(skin.frames || {})) {
      const fullPath = path.join(SKINS_BASE_PATH, relPath.replace('assets/skins/', ''));
      frames[state] = `file://${fullPath.replace(/\\/g, '/')}`;
    }
    return { success: true, skinId: currentId, frames, baseSize: skin.baseSize || 24 };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Save a PNG file into the skins folder
ipcMain.handle('skin-save-png', async (event, { skinId, exprId, pngBase64 }) => {
  try {
    const destDir = path.join(SKINS_BASE_PATH, skinId);
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

app.whenReady().then(createWindow);

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
  if (gpuMonitor) gpuMonitor.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
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
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
