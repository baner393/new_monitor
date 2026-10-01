import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCharmMountPose } from '../src/renderer/charm-mount.js';

test('keychain follows the live cursor while the radial menu is visible', () => {
  assert.deepEqual(resolveCharmMountPose({
    isCharmMode: true,
    ringVisible: true,
    cursor: { x: 120, y: 80 },
    mountAnchor: { x: 10, y: 20 },
  }), {
    visible: true,
    position: { x: 136, y: 107 },
  });
});

test('keychain returns to the physical anchor after the radial menu closes', () => {
  assert.deepEqual(resolveCharmMountPose({
    isCharmMode: true,
    ringVisible: false,
    cursor: { x: 120, y: 80 },
    mountAnchor: { x: 10, y: 20 },
  }), {
    visible: true,
    position: { x: 10, y: 20 },
  });
});

test('keychain stays hidden outside charm mode or without a valid anchor', () => {
  assert.deepEqual(resolveCharmMountPose({
    isCharmMode: false,
    ringVisible: true,
    cursor: { x: 120, y: 80 },
    mountAnchor: { x: 10, y: 20 },
  }), { visible: false, position: null });
  assert.deepEqual(resolveCharmMountPose({
    isCharmMode: true,
    ringVisible: false,
    cursor: null,
    mountAnchor: { x: NaN, y: 20 },
  }), { visible: false, position: null });
});
