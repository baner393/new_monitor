import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  applyMousePassthrough,
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

  for (let cycle = 0; cycle < 3; cycle += 1) {
    assert.equal(reloadWindowSafely(browserWindow), true);
  }
  assert.deepEqual(calls, [
    ['passthrough', false, { forward: true }], ['reload'],
    ['passthrough', false, { forward: true }], ['reload'],
    ['passthrough', false, { forward: true }], ['reload'],
  ]);
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
