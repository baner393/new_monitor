import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { inspectSkinSource, prepareOnlineSkinRelease, writeBuiltInSkin } from './lib/skin-publisher.js';
import { publishOnlineSkinRelease } from './lib/skin-release-publisher.js';

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = process.env.TURTLE_SKIN_REPOSITORY || path.resolve(toolDir, '..', '..');
let mainWindow;
const valid = (event) => mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
const execute = (event, operation) => {
  if (!valid(event)) return { success: false, error: 'Invalid publisher window.' };
  try { return { success: true, ...operation() }; } catch (error) { return { success: false, error: String(error?.message || error) }; }
};

ipcMain.handle('skin-publisher-select-source', async (event) => {
  if (!valid(event)) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('skin-publisher-inspect', (event, payload = {}) => valid(event)
  ? inspectSkinSource({ sourceDir: payload.sourceDir, skinId: payload.skinId })
  : { valid: false, errors: ['Invalid publisher window.'] });
ipcMain.handle('skin-publisher-write-built-in', (event, payload = {}) => execute(event, () => writeBuiltInSkin({ sourceDir: payload.sourceDir, skinsBasePath: path.join(repositoryRoot, 'assets', 'skins'), metadata: payload.metadata || {} })));
ipcMain.handle('skin-publisher-prepare-online', (event, payload = {}) => execute(event, () => prepareOnlineSkinRelease({ sourceDir: payload.sourceDir, outputDir: path.join(app.getPath('userData'), 'skin-release-staging'), metadata: payload.metadata || {} })));
ipcMain.handle('skin-publisher-publish-online', (event, payload = {}) => execute(event, () => {
  const release = prepareOnlineSkinRelease({ sourceDir: payload.sourceDir, outputDir: path.join(app.getPath('userData'), 'skin-release-staging'), metadata: payload.metadata || {} });
  return publishOnlineSkinRelease({ release, serviceDir: path.join(repositoryRoot, 'subscription-service') });
}));

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({ width: 980, height: 760, minWidth: 760, minHeight: 600, title: 'Turtle Monitor Skin Publisher', backgroundColor: '#10131a', webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(toolDir, 'preload.js') } });
  mainWindow.loadFile(path.join(toolDir, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
