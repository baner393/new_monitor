const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// ── Settings persistence ──────────────────────────────────────────
const SETTINGS_PATH = path.join(app.getPath('userData'), 'turtle-settings.json');
const DEFAULT_SETTINGS = {
  gravity: 0.5,
  damping: 0.98,
  pulleyFriction: 0.01,
  ropeStiffness: 0.5,
  ropeDamping: 0.95,
  bounceRestitution: 0.4,
  airDamping: 0.3,
  ropeElasticity: 3,
  turtleSize: 64,
  selectedSkin: 'turtle',
  panelMoveStable: true,
  ropeLength: 160,
  ignoreMouseEvents: true,
};

let settingsData = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      const saved = JSON.parse(raw);
      settingsData = { ...DEFAULT_SETTINGS, ...saved };
      console.log('[Settings] Loaded:', Object.keys(settingsData).length, 'keys');
    }
  } catch (err) {
    console.error('[Settings] Failed to load:', err.message);
  }
}

function saveSettings() {
  try {
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settingsData, null, 2), 'utf-8');
    console.log('[Settings] Saved to', SETTINGS_PATH);
  } catch (err) {
    console.error('[Settings] Failed to save:', err.message);
  }
}

loadSettings();

// ── IPC: Settings handlers ──────────────────────────────────────────
ipcMain.handle('settings-get', () => ({ ...settingsData }));

ipcMain.on('settings-set', (event, key, value) => {
  if (key in DEFAULT_SETTINGS) {
    settingsData[key] = value;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('settings-changed', { [key]: value });
    }
  }
});

ipcMain.on('settings-save', () => {
  saveSettings();
});

ipcMain.handle('settings-reset', () => {
  settingsData = { ...DEFAULT_SETTINGS };
  saveSettings();
  return { ...settingsData };
});

// ── Skin persistence handlers ─────────────────────────────────────
ipcMain.on('skin-set', (event, skinId) => {
  settingsData.selectedSkin = skinId;
  saveSettings();
});

ipcMain.handle('skin-get', () => {
  return settingsData.selectedSkin || 'turtle';
});

// ── Window state ─────────────────────────────────────────────────
let mainWindow = null;
let customWindow = null;
let tray = null;
let isQuitting = false;

// ── License verification ───────────────────────────────────────────
function checkLicense() {
  // Sponsor-only: verify RSA license at startup
  // Falls back to free mode if no valid license
  if (!__IS_SPONSOR__) return false;
  try {
    const { verifyLicense } = require('./license.js');
    const pubKeyPath = path.join(__dirname, '..', '..', 'public.pem');
    const licensePath = path.join(app.getPath('userData'), 'license.json');
    const result = verifyLicense(pubKeyPath, licensePath);
    if (!result.valid) {
      console.warn('[License] Verification failed:', result.reason);
    }
    return result.valid;
  } catch (err) {
    console.warn('[License] Check error:', err.message);
    return false;
  }
}

const isLicensed = checkLicense();
console.log('[Edition] Sponsor:', __IS_SPONSOR__ === true, '| Licensed:', isLicensed);

// ── Create Main Window ─────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    hasShadow: false,
    icon: path.join(__dirname, '..', '..', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  mainWindow.setIgnoreMouseEvents(settingsData.ignoreMouseEvents !== false, { forward: true });

  // Center horizontally, position at top
  const { width: screenWidth } = require('electron').screen.getPrimaryDisplay().workAreaSize;
  const x = Math.round((screenWidth - 400) / 2 * (settingsData.screenAnchorX || 0.5));
  mainWindow.setPosition(x, 0);
  mainWindow.setBounds({ width: 400, height: 300 });

  const indexPath = path.join(__dirname, '..', 'renderer', 'main_window', 'index.html');
  mainWindow.loadFile(indexPath);

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Listen for set-ignore-mouse from renderer
  ipcMain.on('set-ignore-mouse', (event, ignore) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });

  // Listen for set-bounds from renderer
  ipcMain.on('set-bounds', (event, bounds) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBounds(bounds);
    }
  });

  // Listen for show-context-menu from renderer
  ipcMain.on('show-context-menu', () => {
    const template = [
      {
        label: '设置',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('open-settings');
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: '选择皮肤',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('open-skin-selector');
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      ...(__IS_SPONSOR__ ? [
        {
          label: '自定义模式',
          click: () => {
            if (!__IS_SPONSOR__) {
              console.warn('[Edition] Custom mode is a sponsor-only feature');
              return;
            }
            if (customWindow && !customWindow.isDestroyed()) {
              customWindow.focus();
              return;
            }
            openCustomMode();
          },
        },
      ] : []),
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup();
  });

  // Listen for DPI change
  mainWindow.on('dpi-changed', () => {
    mainWindow.webContents.send('dpi-changed');
  });

  // GPU monitoring
  startGPUDataPush();
}

// ── Custom Mode Window ─────────────────────────────────────────────
function openCustomMode() {
  if (!__IS_SPONSOR__) {
    console.warn('[Edition] Custom mode is a sponsor-only feature');
    return;
  }

  if (customWindow && !customWindow.isDestroyed()) {
    customWindow.focus();
    return;
  }

  customWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Turtle Monitor - 自定义模式',
    icon: path.join(__dirname, '..', '..', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'custom', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In dev: app.getAppPath() = project root; in prod: not available (excluded from build)
  const appPath = app.getAppPath();
  const customHtmlPath = path.join(__dirname, '..', 'custom', 'index.html');
  customWindow.loadFile(customHtmlPath);

  customWindow.on('closed', () => { customWindow = null; });
}

// ── Fullscreen Canvas Window ───────────────────────────────────────
let canvasWindow = null;
let pendingGridData = null;
let pendingRegionImage = null;

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
  canvasWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'custom', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const canvasHtmlPath = path.join(__dirname, '..', 'custom', 'canvas-fullscreen.html');
  canvasWindow.loadFile(canvasHtmlPath);

  canvasWindow.on('closed', () => {
    canvasWindow = null;
    pendingGridData = null;
  });
}

// ── Region Marker Window ───────────────────────────────────────────
let regionWindow = null;

function openRegionMarker(imageData) {
  if (!__IS_SPONSOR__) {
    console.warn('[Edition] Region marker is a sponsor-only feature');
    return;
  }

  if (regionWindow && !regionWindow.isDestroyed()) {
    regionWindow.focus();
    return;
  }

  pendingRegionImage = imageData;
  regionWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'custom', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  regionWindow.loadFile(path.join(__dirname, '..', 'custom', 'canvas-region.html'));

  regionWindow.on('closed', () => {
    regionWindow = null;
    pendingRegionImage = null;
  });
}

// ── GPU Data Push ──────────────────────────────────────────────────
let gpuMonitor = null;

function startGPUDataPush() {
  try {
    const { spawn } = require('child_process');
    gpuMonitor = spawn('nvidia-smi', [
      '--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total',
      '--format=csv,noheader,nounits',
      '--loop=2',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let buffer = '';
    gpuMonitor.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(',').map(s => s.trim());
        if (parts.length >= 4) {
          const data = {
            gpuUtil: parseInt(parts[0]) || 0,
            gpuTemp: parseInt(parts[1]) || 0,
            memUsed: parseInt(parts[2]) || 0,
            memTotal: parseInt(parts[3]) || 0,
          };
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('gpu-data', data);
          }
        }
      }
    });

    gpuMonitor.stderr.on('data', () => {}); // ignore stderr
    gpuMonitor.on('error', () => { gpuMonitor = null; });
    gpuMonitor.on('exit', () => { gpuMonitor = null; });
  } catch (err) {
    console.warn('[GPU] Monitor not available:', err.message);
  }
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
      ? { expressionId: pendingGridData.expressionId, grid }
      : { grid };
    if (customWindow && !customWindow.isDestroyed()) {
      customWindow.webContents.send('canvas-grid-updated', payload);
    }
  });

  // IPC: region marker
  ipcMain.on('open-region-marker', (event, imageData) => {
    openRegionMarker(imageData);
  });

  ipcMain.handle('region-request-image', () => pendingRegionImage || { dataUrl: null });
  ipcMain.on('region-mark-done', (event, regions) => {
    if (customWindow && !customWindow.isDestroyed()) {
      customWindow.webContents.send('region-result', regions);
    }
  });

  // ── Skin Import IPC ─────────────────────────────────────────────
  // Writable skin path: use userData so custom skins can be saved
  const SKINS_USER_PATH = path.join(app.getPath('userData'), 'skins');
  // Read-only built-in skin path (in ASAR in production)
  const SKINS_APP_PATH = path.join(app.getAppPath(), '.vite', 'renderer', 'main_window', 'assets', 'skins');
  // Primary path: writable userData skin folder
  const SKINS_BASE_PATH = SKINS_USER_PATH;
  const SKINS_JSON_PATH = path.join(SKINS_BASE_PATH, 'skins.json');

  // On init, ensure writable folder exists and copy built-in skins from ASAR
  (function ensureWritableSkins() {
    try {
      if (!fs.existsSync(SKINS_BASE_PATH)) {
        fs.mkdirSync(SKINS_BASE_PATH, { recursive: true });
        console.log('[Skin] Created writable skins folder:', SKINS_BASE_PATH);
      }
      // Copy built-in skins from app path (ASAR) if not already present
      if (fs.existsSync(SKINS_APP_PATH)) {
        const builtInDirs = fs.readdirSync(SKINS_APP_PATH, { withFileTypes: true });
        for (const dirent of builtInDirs) {
          if (dirent.isDirectory()) {
            const dest = path.join(SKINS_BASE_PATH, dirent.name);
            if (!fs.existsSync(dest)) {
              const src = path.join(SKINS_APP_PATH, dirent.name);
              fs.cpSync(src, dest, { recursive: true });
              console.log('[Skin] Copied built-in skin to writable folder:', dirent.name);
            }
          } else if (dirent.name === 'skins.json') {
            const dest = path.join(SKINS_BASE_PATH, 'skins.json');
            if (!fs.existsSync(dest)) {
              fs.copyFileSync(path.join(SKINS_APP_PATH, 'skins.json'), dest);
              console.log('[Skin] Copied built-in skins.json to writable folder');
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Skin] Failed to ensure writable skins folder:', err.message);
    }
  })();

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
        frames[state] = `file://${fullPath.replace(/\\\\/g, '/')}`;
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
} // ← end __IS_SPONSOR__ block

// ── Shared skin config reader (available in both editions) ──────
// Reads skins.json from the writable userData path.
// Used by the main window's skin selector to show custom skins.
ipcMain.handle('skin-get-config', async () => {
  try {
    const cfgPath = path.join(app.getPath('userData'), 'skins', 'skins.json');
    if (fs.existsSync(cfgPath)) {
      const data = fs.readFileSync(cfgPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('[Skin] Failed to read skin config:', err.message);
  }
  return { skins: [], defaultSkin: 'turtle' };
});

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
  isQuitting = true;
});

app.whenReady().then(() => {
  createWindow();
  if (__IS_SPONSOR__) {
    // Sponsor-only: check RSA license and show status
    if (!isLicensed) {
      console.warn('[License] No valid license — running in free mode');
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});