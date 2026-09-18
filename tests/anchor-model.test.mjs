import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANCHOR_MODES,
  CHARM_ANCHOR_MARGIN,
  DEFAULT_ROPE_LENGTHS,
  clampCharmAnchor,
  freshestCursorSample,
  isFiniteCoordinate,
  isFinitePoint,
  resolveAnchorPoint,
} from '../src/shared/anchor-model.js';

test('anchor modes expose top and cursor', () => {
  assert.deepEqual(Object.values(ANCHOR_MODES).sort(), ['cursor', 'top']);
});

test('default rope lengths differ per mode and never bleed into each other', () => {
  assert.equal(DEFAULT_ROPE_LENGTHS[ANCHOR_MODES.TOP], 150);
  assert.equal(DEFAULT_ROPE_LENGTHS[ANCHOR_MODES.CURSOR], 80);
});

test('isFiniteCoordinate rejects missing and malformed values, not just NaN', () => {
  for (const bad of [null, undefined, '', '  ', '12', NaN, Infinity, {}, () => {}]) {
    assert.equal(isFiniteCoordinate(bad), false, String(bad));
  }
  assert.equal(isFiniteCoordinate(0), true);
  assert.equal(isFiniteCoordinate(-12.5), true);
});

test('isFinitePoint requires both coordinates', () => {
  assert.equal(isFinitePoint({ x: 1, y: 2 }), true);
  assert.equal(isFinitePoint({ x: 1, y: null }), false);
  assert.equal(isFinitePoint({ x: NaN, y: 2 }), false);
  assert.equal(isFinitePoint(null), false);
});

test('cursor mode resolves the anchor from a valid cursor sample', () => {
  assert.deepEqual(
    resolveAnchorPoint({ anchorMode: ANCHOR_MODES.CURSOR, cursor: { x: 12, y: 34 }, screenAnchorX: 0.5, windowWidth: 1000 }),
    { x: 12, y: 34 },
  );
});

test('cursor mode returns null on malformed cursor instead of guessing a point', () => {
  for (const cursor of [null, {}, { x: 1 }, { x: NaN, y: 2 }, { x: '', y: 2 }]) {
    assert.equal(
      resolveAnchorPoint({ anchorMode: ANCHOR_MODES.CURSOR, cursor, screenAnchorX: 0.5, windowWidth: 1000 }),
      null,
      JSON.stringify(cursor),
    );
  }
});

test('top mode resolves the normalized anchor at y=50', () => {
  assert.deepEqual(
    resolveAnchorPoint({ anchorMode: ANCHOR_MODES.TOP, cursor: null, screenAnchorX: 0.25, windowWidth: 800 }),
    { x: 200, y: 50 },
  );
});

test('top mode rejects malformed inputs', () => {
  assert.equal(resolveAnchorPoint({ anchorMode: ANCHOR_MODES.TOP, cursor: null, screenAnchorX: NaN, windowWidth: 800 }), null);
  assert.equal(resolveAnchorPoint({ anchorMode: ANCHOR_MODES.TOP, cursor: null, screenAnchorX: 0.5, windowWidth: 0 }), null);
});

test('clampCharmAnchor keeps the anchor inside a tiny margin', () => {
  const w = 1000;
  const h = 800;
  assert.deepEqual(clampCharmAnchor({ x: 500, y: 400 }, w, h), { x: 500, y: 400 });
  assert.deepEqual(clampCharmAnchor({ x: -50, y: -50 }, w, h), { x: CHARM_ANCHOR_MARGIN, y: CHARM_ANCHOR_MARGIN });
  assert.deepEqual(clampCharmAnchor({ x: 5000, y: 5000 }, w, h), { x: w - CHARM_ANCHOR_MARGIN, y: h - CHARM_ANCHOR_MARGIN });
});

test('clampCharmAnchor drops malformed points and malformed bounds', () => {
  assert.equal(clampCharmAnchor({ x: NaN, y: 5 }, 1000, 800), null);
  assert.equal(clampCharmAnchor({ x: 1, y: 2 }, NaN, 800), null);
});

test('freshestCursorSample prefers the newer timestamp', () => {
  assert.deepEqual(
    freshestCursorSample({ windowCursor: { x: 1, y: 1 }, windowAt: 100, screenCursor: { x: 2, y: 2 }, screenAt: 200 }),
    { x: 2, y: 2 },
  );
  assert.deepEqual(
    freshestCursorSample({ windowCursor: { x: 1, y: 1 }, windowAt: 300, screenCursor: { x: 2, y: 2 }, screenAt: 200 }),
    { x: 1, y: 1 },
  );
});

test('freshestCursorSample falls back to whichever source exists', () => {
  assert.deepEqual(freshestCursorSample({ windowCursor: { x: 1, y: 1 }, windowAt: 100 }), { x: 1, y: 1 });
  assert.deepEqual(freshestCursorSample({ screenCursor: { x: 2, y: 2 }, screenAt: 100 }), { x: 2, y: 2 });
  assert.equal(freshestCursorSample({}), null);
});

test('freshestCursorSample ignores stale or malformed sources', () => {
  assert.deepEqual(
    freshestCursorSample({ windowCursor: { x: 1, y: 1 }, windowAt: 0, screenCursor: { x: 2, y: 2 }, screenAt: 100 }),
    { x: 2, y: 2 },
  );
  assert.equal(
    freshestCursorSample({ windowCursor: { x: NaN, y: 1 }, windowAt: 999, screenCursor: null, screenAt: 0 }),
    null,
  );
});
