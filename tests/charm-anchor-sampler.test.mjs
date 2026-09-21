import test from 'node:test';
import assert from 'node:assert/strict';

import { CharmAnchorSampler } from '../src/renderer/charm-anchor.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('新鲜 DOM 光标样本不会触发屏幕坐标 IPC', async () => {
  let now = 1_000;
  let calls = 0;
  const sampler = new CharmAnchorSampler({
    now: () => now,
    getCursorPosition: async () => { calls += 1; return { x: 9, y: 9 }; },
  });
  sampler.noteWindowCursor(4, 5);

  assert.equal(sampler.pollOnce(), false);
  await flush();
  assert.equal(calls, 0);
  assert.deepEqual(sampler.sample(), { x: 4, y: 5 });
});

test('DOM 来源失效后按限速单飞回退到屏幕坐标', async () => {
  let now = 1_000;
  let resolveQuery;
  let calls = 0;
  const sampler = new CharmAnchorSampler({
    now: () => now,
    domFreshMs: 100,
    fallbackIntervalMs: 80,
    getCursorPosition: () => {
      calls += 1;
      return new Promise((resolve) => { resolveQuery = resolve; });
    },
  });
  sampler.noteWindowCursor(4, 5);
  now += 101;

  assert.equal(sampler.pollOnce(), true);
  assert.equal(sampler.pollOnce(), false);
  await flush();
  assert.equal(calls, 1);
  resolveQuery({ x: 11, y: 12 });
  await flush();
  assert.deepEqual(sampler.sample(), { x: 11, y: 12 });

  now += 40;
  assert.equal(sampler.pollOnce(), false);
  now += 40;
  assert.equal(sampler.pollOnce(), true);
});

test('新的 DOM 样本优先于较早的屏幕回退样本', async () => {
  let now = 1_000;
  const sampler = new CharmAnchorSampler({ now: () => now });
  sampler.noteScreenCursor(1, 2);
  now += 1;
  sampler.noteWindowCursor(8, 9);

  assert.deepEqual(sampler.sample(), { x: 8, y: 9 });
});
