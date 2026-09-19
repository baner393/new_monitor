import test from 'node:test';
import assert from 'node:assert/strict';
import { RING_ACTIONS } from '../src/shared/ring-items.js';

test('exactly 9 actions, sector 0 is the monitor panel', () => {
  assert.equal(RING_ACTIONS.length, 9);
  assert.equal(RING_ACTIONS[0].id, 'panel');
});

test('every action has an id, label and icon key', () => {
  for (const item of RING_ACTIONS) {
    assert.ok(item.id, 'missing id');
    assert.ok(item.label, 'missing label');
    assert.ok(item.iconKey, 'missing iconKey');
  }
});

test('quit is deliberately not in the ring (misrelease would exit the app)', () => {
  assert.equal(RING_ACTIONS.some((item) => item.id === 'quit'), false);
});

test('custom mode is the only creator-gated action', () => {
  const gated = RING_ACTIONS.filter((item) => item.creatorOnly);
  assert.equal(gated.length, 1);
  assert.equal(gated[0].id, 'custom');
});

test('ids are unique', () => {
  const ids = RING_ACTIONS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});
