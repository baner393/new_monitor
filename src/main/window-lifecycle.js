import fs from 'fs';
import path from 'path';

export function applyMousePassthrough(browserWindow, ignore) {
  if (!browserWindow || browserWindow.isDestroyed()) return false;
  browserWindow.setIgnoreMouseEvents(ignore, { forward: true });
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
    applyMousePassthrough(this.browserWindow, true);
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

/**
 * Single-flight request/ack watchdog used by renderer-preserving refreshes.
 * Repeated user requests are coalesced; a missing/failed acknowledgement lets
 * the caller rebuild the BrowserWindow without navigating the existing one.
 */
export class SoftRefreshCoordinator {
  constructor({
    send,
    onFailure,
    timeoutMs = 2500,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  }) {
    this.send = send;
    this.onFailure = onFailure;
    this.timeoutMs = timeoutMs;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.sequence = 0;
    this.pendingId = null;
    this.watchdog = null;
    this.disposed = false;
  }

  request() {
    if (this.disposed || this.pendingId !== null) return false;
    const requestId = ++this.sequence;
    this.pendingId = requestId;
    try {
      this.send(requestId);
    } catch (error) {
      this._finish();
      this.onFailure?.(error);
      return false;
    }
    this.watchdog = this.setTimeoutImpl(() => {
      if (this.disposed || this.pendingId !== requestId) return;
      this._finish();
      this.onFailure?.(new Error(`Soft refresh ${requestId} timed out`));
    }, this.timeoutMs);
    this.watchdog?.unref?.();
    return true;
  }

  complete(requestId, ok = true, errorMessage = '') {
    if (this.disposed || requestId !== this.pendingId) return false;
    this._finish();
    if (!ok) this.onFailure?.(new Error(errorMessage || `Soft refresh ${requestId} failed`));
    return true;
  }

  dispose() {
    this.disposed = true;
    this._finish();
    this.send = null;
    this.onFailure = null;
  }

  _finish() {
    if (this.watchdog !== null) this.clearTimeoutImpl(this.watchdog);
    this.watchdog = null;
    this.pendingId = null;
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
