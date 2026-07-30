import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  applyMousePassthrough,
  ReloadInputGuard,
  resolveCustomResourcePath,
  SoftRefreshCoordinator,
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
    [true, { forward: true }],
    [true, { forward: true }],
  ]);
  assert.equal(guard.rendererReady, true);
});

test('soft refresh coalesces repeated requests and accepts only the active acknowledgement', () => {
  const sent = [];
  const timers = new Map();
  let nextTimer = 1;
  const coordinator = new SoftRefreshCoordinator({
    send: (requestId) => sent.push(requestId),
    onFailure: (error) => assert.fail(error.message),
    setTimeoutImpl: (callback) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeoutImpl: (id) => timers.delete(id),
  });

  for (let cycle = 0; cycle < 25; cycle += 1) {
    assert.equal(coordinator.request(), true);
    assert.equal(coordinator.request(), false, 'duplicate request was not coalesced');
    assert.equal(coordinator.complete(cycle, true), false, 'stale acknowledgement was accepted');
    assert.equal(coordinator.complete(cycle + 1, true), true);
    assert.equal(timers.size, 0, 'completed refresh left a watchdog behind');
  }
  assert.deepEqual(sent, Array.from({ length: 25 }, (_, index) => index + 1));
});

test('soft refresh timeout clears single-flight state before recovery', () => {
  let watchdog;
  const failures = [];
  const coordinator = new SoftRefreshCoordinator({
    send: () => {},
    onFailure: (error) => failures.push(error.message),
    setTimeoutImpl: (callback) => {
      watchdog = callback;
      return 1;
    },
    clearTimeoutImpl: () => {},
  });

  assert.equal(coordinator.request(), true);
  watchdog();
  assert.match(failures[0], /timed out/);
  assert.equal(coordinator.request(), true, 'timeout left refresh permanently locked');
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
