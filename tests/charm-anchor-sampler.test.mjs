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

test('环形菜单可用更短的 DOM 新鲜期触发快速 IPC 回退', async () => {
  let now = 1_000;
  let calls = 0;
  const sampler = new CharmAnchorSampler({
    now: () => now,
    domFreshMs: 120,
    getCursorPosition: async () => { calls += 1; return { x: 9, y: 9 }; },
  });
  sampler.noteWindowCursor(4, 5);

  now += 16;
  assert.equal(sampler.pollOnce({ staleAfterMs: 16 }), false);
  now += 1;
  assert.equal(sampler.pollOnce({ staleAfterMs: 16 }), true);
  await flush();
  assert.equal(calls, 1);
  assert.deepEqual(sampler.sample(), { x: 9, y: 9 });
});

test('DOM 来源失效后逐帧单飞回退到屏幕坐标', async () => {
  let now = 1_000;
  const resolveQueries = [];
  let calls = 0;
  const sampler = new CharmAnchorSampler({
    now: () => now,
    domFreshMs: 100,
    getCursorPosition: () => {
      calls += 1;
      return new Promise((resolve) => { resolveQueries.push(resolve); });
    },
  });
  sampler.noteWindowCursor(4, 5);
  now += 101;

  assert.equal(sampler.pollOnce(), true);
  assert.equal(sampler.pollOnce(), false);
  await flush();
  assert.equal(calls, 1);
  resolveQueries[0]({ x: 11, y: 12 });
  await flush();
  assert.deepEqual(sampler.sample(), { x: 11, y: 12 });

  now += 16;
  assert.equal(sampler.pollOnce(), true);
  assert.equal(sampler.pollOnce(), false);
  await flush();
  assert.equal(calls, 2);
  resolveQueries[1]({ x: 13, y: 14 });
  await flush();
});

test('较晚 DOM mousemove 会使在途屏幕 IPC 回包失效', async () => {
  let now = 1_000;
  let resolveQuery;
  const sampler = new CharmAnchorSampler({
    now: () => now,
    domFreshMs: 100,
    getCursorPosition: () => new Promise((resolve) => { resolveQuery = resolve; }),
  });
  sampler.noteWindowCursor(4, 5);
  now += 101;

  assert.equal(sampler.pollOnce(), true);
  await flush();
  now += 1;
  sampler.noteWindowCursor(8, 9);
  now += 1;
  resolveQuery({ x: 11, y: 12 });
  await flush();

  assert.deepEqual(sampler.sample(), { x: 8, y: 9 });
});

test('较早 screen IPC 回包不会覆盖较晚请求的样本', () => {
  let now = 1_000;
  const sampler = new CharmAnchorSampler({ now: () => now });
  const earlierRequestAt = sampler.beginScreenRequest(now);
  now += 1;
  const laterRequestAt = sampler.beginScreenRequest(now);

  assert.equal(sampler.noteScreenCursor(20, 21, laterRequestAt), true);
  now += 1;
  assert.equal(sampler.noteScreenCursor(10, 11, earlierRequestAt), false);
  assert.deepEqual(sampler.sample(), { x: 20, y: 21 });
});

test('挂饰逐帧采样不会废弃在途系统光标同步请求', async () => {
  let now = 1_000;
  let resolvePoll;
  const sampler = new CharmAnchorSampler({
    now: () => now,
    getCursorPosition: () => new Promise((resolve) => { resolvePoll = resolve; }),
  });
  const syncRequestAt = sampler.beginScreenRequest(now);
  now += 1;

  assert.equal(sampler.pollOnce(), true);
  await flush();
  assert.equal(sampler.isScreenRequestCurrent(syncRequestAt), true);
  assert.equal(sampler.noteScreenCursor(30, 31, syncRequestAt), true);

  resolvePoll({ x: 40, y: 41 });
  await flush();
  assert.deepEqual(sampler.sample(), { x: 40, y: 41 });
});

test('新的 DOM 样本优先于较早的屏幕回退样本', async () => {
  let now = 1_000;
  const sampler = new CharmAnchorSampler({ now: () => now });
  sampler.noteScreenCursor(1, 2);
  now += 1;
  sampler.noteWindowCursor(8, 9);

  assert.deepEqual(sampler.sample(), { x: 8, y: 9 });
});
