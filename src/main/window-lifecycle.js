import fs from 'fs';
import path from 'path';

export function applyMousePassthrough(browserWindow, ignore) {
  if (!browserWindow || browserWindow.isDestroyed()) return false;
  browserWindow.setIgnoreMouseEvents(ignore, { forward: true });
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
