import fs from 'fs';
import path from 'path';

export function applyMousePassthrough(browserWindow, ignore) {
  if (!browserWindow || browserWindow.isDestroyed()) return false;
  browserWindow.setIgnoreMouseEvents(ignore, { forward: true });
  return true;
}

/**
 * Reloading destroys the renderer that owns transparent hit testing. Capture
 * mouse input until the replacement renderer is ready, and ignore duplicate
 * reload requests while navigation is already in progress.
 */
export function reloadWindowSafely(browserWindow) {
  if (!browserWindow || browserWindow.isDestroyed()) return false;
  const webContents = browserWindow.webContents;
  if (!webContents || webContents.isDestroyed() || webContents.isLoading()) return false;
  applyMousePassthrough(browserWindow, false);
  webContents.reload();
  return true;
}

export function resolveCustomResourcePath({ appPath, fileName, isDevelopment, existsSync = fs.existsSync }) {
  const sourcePath = path.join(appPath, 'src', 'custom', fileName);
  const buildPath = path.join(appPath, '.vite', 'build', 'src', 'custom', fileName);

  if (isDevelopment && existsSync(sourcePath)) return sourcePath;
  if (existsSync(buildPath)) return buildPath;
  if (existsSync(sourcePath)) return sourcePath;
  return buildPath;
}
