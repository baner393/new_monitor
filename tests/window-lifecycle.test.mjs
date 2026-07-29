import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  applyMousePassthrough,
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
