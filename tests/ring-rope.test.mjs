import test from 'node:test';
import assert from 'node:assert/strict';

import { charmRopeAttachment, ringRopeSag } from '../src/renderer/ring-rope.js';
import { CHARM_MOUNT_GEOMETRY } from '../src/renderer/charm-mount-geometry.js';
import { cursorMountGeometry } from '../src/shared/cursor-hole-model.js';

test('rope attachment follows the moving cursor ring and stays on its pet-facing rim', () => {
  const pet = { x: 100, y: 200 };
  const first = charmRopeAttachment({ x: 100, y: 100 }, pet);
  const second = charmRopeAttachment({ x: 140, y: 100 }, pet);

  assert.ok(first.y < 100);
  assert.ok(second.x > first.x);
  const centerY = 100 - (CHARM_MOUNT_GEOMETRY.anchorY - CHARM_MOUNT_GEOMETRY.centerY);
  assert.ok(Math.abs(Math.hypot((second.x - 140 - 0.2 * (second.y - centerY)) / 11.1, (second.y - centerY) / 14.43) - 1) < 1e-9);
});

test('rope pulls nearly taut away from the pet and loosens near the center', () => {
  const pet = { x: 100, y: 200 };
  assert.equal(ringRopeSag(80, { x: 100, y: 80 }, pet), 2);
  assert.ok(ringRopeSag(80, { x: 100, y: 190 }, pet) > 2);
  assert.ok(Math.abs(ringRopeSag(80, { x: 100, y: 200 }, pet) - 13.2) < 1e-9);
});

test('cursor size and hole diameter scale the pet-facing ring attachment together', () => {
  const anchor = { x: 80, y: 120 }, pet = { x: 200, y: 210 };
  for (const scale of [0.3, 0.8, 1.7, 3]) {
    const point = charmRopeAttachment(anchor, pet, scale);
    const center = { x: anchor.x, y: anchor.y - (CHARM_MOUNT_GEOMETRY.anchorY - CHARM_MOUNT_GEOMETRY.centerY) * scale };
    assert.ok(Math.abs(Math.hypot((point.x - center.x - 0.2 * (point.y - center.y)) / (11.1 * scale), (point.y - center.y) / (14.43 * scale)) - 1) < 1e-9);
    assert.ok(point.x > center.x && point.y > center.y);
  }
});

test('the contact travels continuously around the actual native ring with the force direction', () => {
  const { anchor, center, ringGeometry } = cursorMountGeometry({ width: 56, height: 48, hotspot: { x: 8, y: 12 } }, { u: 0.6, v: 0.7, radius: 0.05 });
  let previous = null;
  const quadrants = new Set();
  for (let step = 0; step <= 120; step++) {
    const angle = step / 120 * Math.PI * 2;
    const pet = { x: anchor.x + Math.cos(angle) * 100, y: anchor.y + Math.sin(angle) * 100 };
    const point = charmRopeAttachment(anchor, pet, 99, ringGeometry);
    const dx = point.x - center.x, dy = point.y - center.y;
    assert.ok(Math.abs(Math.hypot((dx - ringGeometry.shear * dy) / ringGeometry.radiusX, dy / ringGeometry.radiusY) - 1) < 1e-9);
    const forceX = pet.x - anchor.x, forceY = pet.y - anchor.y;
    const forceDot = dx * forceX + dy * forceY;
    for (let sample = 0; sample < 120; sample++) {
      const t = sample / 120 * Math.PI * 2;
      const x = ringGeometry.radiusX * Math.cos(t) + ringGeometry.shear * ringGeometry.radiusY * Math.sin(t);
      const y = ringGeometry.radiusY * Math.sin(t);
      assert.ok(forceDot >= x * forceX + y * forceY - 1e-8);
    }
    if (previous) assert.ok(Math.hypot(point.x - previous.x, point.y - previous.y) < 2);
    quadrants.add(`${Math.sign(dx)},${Math.sign(dy)}`);
    previous = point;
  }
  assert.ok(quadrants.size >= 4);
});

test('default gravity contact is the actual lowest metal point, including shear and role scaling', () => {
  const native = cursorMountGeometry({ width: 48, height: 48 }, { u: 0.6, v: 0.7, radius: 0.05 });
  assert.deepEqual(native.anchor, { x: native.center.x + native.ringGeometry.shear * native.ringGeometry.radiusY,
    y: native.center.y + native.ringGeometry.radiusY });
  for (const [radiusX, radiusY, shear] of [[10, 13, 0.2], [20, 19.5, 0.2 * 2 / 1.5], [4, 8, -0.3]]) {
    const center = { x: 50, y: 30 }, bottom = { x: center.x + shear * radiusY, y: center.y + radiusY };
    const geometry = { radiusX, radiusY, shear, centerFromAnchor: { x: center.x - bottom.x, y: center.y - bottom.y } };
    assert.deepEqual(charmRopeAttachment(bottom, { x: bottom.x, y: bottom.y + 100 }, 1, geometry), bottom);
    assert.deepEqual(charmRopeAttachment(bottom, bottom, 1, geometry), bottom);
  }
});
