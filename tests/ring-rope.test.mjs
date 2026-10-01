import test from 'node:test';
import assert from 'node:assert/strict';

import { charmRopeAttachment, ringRopeSag } from '../src/renderer/ring-rope.js';
import { CHARM_MOUNT_GEOMETRY } from '../src/renderer/charm-mount-geometry.js';

test('rope attachment follows the moving cursor ring and stays on its pet-facing rim', () => {
  const pet = { x: 100, y: 200 };
  const first = charmRopeAttachment({ x: 100, y: 100 }, pet);
  const second = charmRopeAttachment({ x: 140, y: 100 }, pet);

  assert.deepEqual(first, { x: 100, y: 100 });
  assert.ok(second.x > first.x);
  const centerY = 100 - (CHARM_MOUNT_GEOMETRY.anchorY - CHARM_MOUNT_GEOMETRY.centerY);
  assert.ok(Math.abs(Math.hypot(second.x - 140, second.y - centerY) - CHARM_MOUNT_GEOMETRY.outerRadius) < 1e-9);
});

test('rope pulls nearly taut away from the pet and loosens near the center', () => {
  const pet = { x: 100, y: 200 };
  assert.equal(ringRopeSag(80, { x: 100, y: 80 }, pet), 2);
  assert.ok(ringRopeSag(80, { x: 100, y: 190 }, pet) > 2);
  assert.ok(Math.abs(ringRopeSag(80, { x: 100, y: 200 }, pet) - 13.2) < 1e-9);
});
