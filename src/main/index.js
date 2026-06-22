import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { GPUMonitor } from './gpu-monitor.js';

let mainWindow;
let gpuMonitor;

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
    title: 'Turtle Monitor',
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
      label: '退出',
      click: () => {
        app.quit();
      },
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: mainWindow });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (gpuMonitor) gpuMonitor.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
