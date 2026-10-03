import test from 'node:test';
import assert from 'node:assert/strict';
import { CharmPreview } from '../src/renderer/charm-preview.js';

function preview(masks) {
  const value = Object.create(CharmPreview.prototype);
  value.role = { role: 'Arrow', id: 'a'.repeat(64), masks };
  value.frames = [{ width: 32, height: 32, alpha: new Array(1024).fill(255) }];
  value.events = [];
  value.onProfile = (...args) => value.events.push(args);
  value.onHint = hint => { value.hint = hint; };
  return value;
}

test('preview rejects a hole if any source animation frame or size cannot hold the rim', () => {
  const first = { width: 16, height: 16, alpha: new Array(256).fill(255) };
  const second = { ...first, alpha: [...first.alpha] }; second.alpha[8 * 16 + 8] = 0;
  const value = preview([first, second]);
  assert.equal(value.tryProfile({ u: 0.5, v: 0.5, radius: 0.1 }), false);
  assert.equal(value.events.length, 0);
  assert.match(value.hint, /所有动画帧/);
});

test('valid editing reports normalized role and source profile without changing the click hotspot', () => {
  const frame = { width: 32, height: 32, alpha: new Array(1024).fill(255), hotspot: { x: 0, y: 0 } };
  const value = preview([frame]), profile = { u: 0.5, v: 0.5, radius: 0.05 };
  assert.equal(value.tryProfile(profile), true);
  assert.deepEqual(value.events, [[`Arrow:${'a'.repeat(64)}`, profile]]);
  assert.deepEqual(frame.hotspot, { x: 0, y: 0 });
});
