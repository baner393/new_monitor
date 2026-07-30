import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  applyMousePassthrough,
  ReloadInputGuard,
  reloadWindowSafely,
  resolveCustomResourcePath,
} from '../src/main/window-lifecycle.js';

test('reload passthrough keeps forwarding mouse movement', () => {
  const calls = [];
  const browserWindow = {
    isDestroyed: () => false,
    setIgnoreMouseEvents: (...args) => calls.push(args),
  };

  assert.equal(applyMousePassthrough(browserWindow, true), true);
  assert.deepEqual(calls, [[true, { forward: true }]]);
});

test('destroyed windows are ignored by passthrough updates', () => {
  const browserWindow = {
    isDestroyed: () => true,
    setIgnoreMouseEvents: () => assert.fail('destroyed window was touched'),
  };

  assert.equal(applyMousePassthrough(browserWindow, false), false);
});

test('every completed reload cycle captures input before navigation', () => {
  const calls = [];
  const webContents = {
    isDestroyed: () => false,
    isLoading: () => false,
    reload: () => calls.push(['reload']),
  };
  const browserWindow = {
    webContents,
    isDestroyed: () => false,
    setIgnoreMouseEvents: (...args) => calls.push(['passthrough', ...args]),
  };

  for (let cycle = 0; cycle < 25; cycle += 1) {
    assert.equal(reloadWindowSafely(browserWindow), true);
  }
  assert.equal(calls.length, 50);
  for (let index = 0; index < calls.length; index += 2) {
    assert.deepEqual(calls[index], ['passthrough', false, { forward: true }]);
    assert.deepEqual(calls[index + 1], ['reload']);
  }
});

test('duplicate reload is ignored while navigation is in progress', () => {
  const browserWindow = {
    isDestroyed: () => false,
    setIgnoreMouseEvents: () => assert.fail('passthrough changed during an active reload'),
    webContents: {
      isDestroyed: () => false,
      isLoading: () => true,
      reload: () => assert.fail('duplicate reload started'),
    },
  };

  assert.equal(reloadWindowSafely(browserWindow), false);
});

test('input guard rejects stale renderer messages across 25 reload generations', () => {
  const calls = [];
  const timers = new Map();
  let nextTimer = 1;
  const browserWindow = {
    isDestroyed: () => false,
    setIgnoreMouseEvents: (...args) => calls.push(args),
  };
  const guard = new ReloadInputGuard(browserWindow, {
    setTimeoutImpl: (callback) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeoutImpl: (id) => timers.delete(id),
  });

  for (let cycle = 0; cycle < 25; cycle += 1) {
    const generation = guard.beginLoad();
    assert.equal(generation, cycle + 1);
    assert.equal(guard.setFromRenderer(true, generation - 1), false, 'stale document changed passthrough');
    assert.equal(guard.markRendererReady(true, generation - 1), false, 'stale document completed the handshake');
    guard.finishLoad();
    assert.equal(guard.markRendererReady(cycle % 2 === 0, generation), true);
    assert.equal(timers.size, 0, 'ready handshake left a watchdog behind');
    assert.equal(guard.setFromRenderer(false, generation), true);
  }

  assert.equal(calls.length, 75);
  assert.equal(guard.generation, 25);
});

test('input guard watchdog fails open when renderer startup never completes', () => {
  const calls = [];
  let watchdog;
  const guard = new ReloadInputGuard({
    isDestroyed: () => false,
    setIgnoreMouseEvents: (...args) => calls.push(args),
  }, {
    setTimeoutImpl: (callback) => {
      watchdog = callback;
      return 1;
    },
    clearTimeoutImpl: () => {},
  });

  guard.beginLoad();
  guard.finishLoad();
  watchdog();
  assert.deepEqual(calls, [
    [false, { forward: true }],
    [true, { forward: true }],
  ]);
  assert.equal(guard.rendererReady, true);
});

test('input guard keeps the desktop click-through while a secondary window is active', () => {
  const calls = [];
  const guard = new ReloadInputGuard({
    isDestroyed: () => false,
    setIgnoreMouseEvents: (...args) => calls.push(args),
  });
  const generation = guard.beginLoad();
  guard.markRendererReady(false, generation);
  assert.equal(guard.suspend(), true);
  assert.equal(guard.setFromRenderer(false, generation), false);
  assert.equal(guard.resume(), true);
  assert.equal(guard.setFromRenderer(false, generation), true);
  assert.deepEqual(calls.slice(-3), [
    [false, { forward: true }],
    [true, { forward: true }],
    [false, { forward: true }],
  ]);
});

test('source startup resolves custom-mode files from src/custom', () => {
  const appPath = path.resolve('example-app');
  const sourcePath = path.join(appPath, 'src', 'custom', 'index.html');
  const result = resolveCustomResourcePath({
    appPath,
    fileName: 'index.html',
    isDevelopment: true,
    existsSync: (candidate) => candidate === sourcePath,
  });

  assert.equal(result, sourcePath);
});

test('packaged startup resolves copied custom-mode files from .vite/build', () => {
  const appPath = path.resolve('example-app');
  const buildPath = path.join(appPath, '.vite', 'build', 'src', 'custom', 'preload.js');
  const result = resolveCustomResourcePath({
    appPath,
    fileName: 'preload.js',
    isDevelopment: false,
    existsSync: (candidate) => candidate === buildPath,
  });

  assert.equal(result, buildPath);
});
