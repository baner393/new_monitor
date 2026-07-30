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

/**
 * Owns the transparent full-screen window's input state across navigations.
 * Renderer messages are ignored until the replacement document explicitly
 * announces that hit testing is ready. A watchdog fails open so a renderer
 * startup error can never leave an invisible desktop-sized input blocker.
 */
export class ReloadInputGuard {
  constructor(browserWindow, {
    timeoutMs = 3000,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  } = {}) {
    this.browserWindow = browserWindow;
    this.timeoutMs = timeoutMs;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.generation = 0;
    this.rendererReady = false;
    this.suspended = false;
    this.watchdog = null;
    this.disposed = false;
  }

  beginLoad() {
    if (this.disposed) return 0;
    this.generation += 1;
    this.rendererReady = false;
    this._clearWatchdog();
    applyMousePassthrough(this.browserWindow, this.suspended);
    return this.generation;
  }

  finishLoad() {
    if (this.disposed || this.rendererReady) return;
    const generation = this.generation;
    this._clearWatchdog();
    this.watchdog = this.setTimeoutImpl(() => {
      if (this.disposed || generation !== this.generation || this.rendererReady) return;
      // Fail open: transparent pixels must not block the desktop indefinitely.
      this.rendererReady = true;
      applyMousePassthrough(this.browserWindow, true);
    }, this.timeoutMs);
    this.watchdog?.unref?.();
  }

  markRendererReady(ignore, generation) {
    if (this.disposed || generation !== this.generation) return false;
    this.rendererReady = true;
    this._clearWatchdog();
    return applyMousePassthrough(this.browserWindow, this.suspended ? true : Boolean(ignore));
  }

  setFromRenderer(ignore, generation) {
    if (this.disposed || this.suspended || !this.rendererReady || generation !== this.generation) return false;
    return applyMousePassthrough(this.browserWindow, Boolean(ignore));
  }

  suspend() {
    if (this.disposed) return false;
    this.suspended = true;
    return applyMousePassthrough(this.browserWindow, true);
  }

  resume() {
    if (this.disposed) return false;
    this.suspended = false;
    return true;
  }

  failOpen() {
    if (this.disposed) return false;
    this.rendererReady = true;
    this._clearWatchdog();
    return applyMousePassthrough(this.browserWindow, true);
  }

  dispose() {
    this.disposed = true;
    this._clearWatchdog();
    this.browserWindow = null;
  }

  _clearWatchdog() {
    if (this.watchdog !== null) this.clearTimeoutImpl(this.watchdog);
    this.watchdog = null;
  }
}

export function resolveCustomResourcePath({ appPath, fileName, isDevelopment, existsSync = fs.existsSync }) {
  const sourcePath = path.join(appPath, 'src', 'custom', fileName);
  const buildPath = path.join(appPath, '.vite', 'build', 'src', 'custom', fileName);

  if (isDevelopment && existsSync(sourcePath)) return sourcePath;
  if (existsSync(buildPath)) return buildPath;
  if (existsSync(sourcePath)) return sourcePath;
  return buildPath;
}
