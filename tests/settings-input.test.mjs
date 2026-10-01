import assert from 'node:assert/strict';
import test from 'node:test';

import { InputManager, isEventOwnedByRoot } from '../src/renderer/input.js';

test('settings-owned category, switch, and range presses do not start pet dragging', () => {
  const root = {};
  const targets = new Set([
    { control: 'category' },
    { control: 'flip-switch' },
    { control: 'flip-spin-range' },
  ]);
  root.contains = (target) => targets.has(target);
  const transitions = [];
  const input = new InputManager({
    sprite: { x: 100, y: 100, getBounds: () => ({ x: 80, y: 80, width: 40, height: 40 }) },
    stateMachine: {
      getState: () => 'IDLE',
      transition: (event) => transitions.push(event),
    },
    physics: {},
    shouldIgnoreEvent: (event) => isEventOwnedByRoot(event, root),
  });

  for (const target of targets) {
    input._onMouseDown({ button: 0, clientX: 100, clientY: 100, target });
    assert.equal(input._isDragging, false, target.control);
  }
  assert.deepEqual(transitions, []);

  input._onMouseDown({ button: 0, clientX: 100, clientY: 100, target: {} });
  assert.equal(input._isDragging, true);
  assert.deepEqual(transitions, ['LEFT_CLICK_TURTLE']);
});

test('settings event ownership also recognizes nodes in the composed event path', () => {
  const root = {};
  const target = {};

  assert.equal(isEventOwnedByRoot({ target, composedPath: () => [target, root] }, root), true);
  assert.equal(isEventOwnedByRoot({ target: {} }, root), false);
});
