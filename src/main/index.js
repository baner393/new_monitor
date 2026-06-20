import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'path';
import { GPUMonitor } from './gpu-monitor.js';

let mainWindow;
let gpuMonitor;

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
    if (message.includes('[BOUNCE]') || message.includes('[Input]') || message.includes('[GameLoop]')) {
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
        // TODO: implement settings window
        console.log('[Menu] Settings clicked');
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
