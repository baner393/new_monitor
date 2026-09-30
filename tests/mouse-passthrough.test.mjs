import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveMousePassthrough } from '../src/renderer/mouse-passthrough.js';

test('blank desktop remains click-through in idle state', () => {
  assert.equal(resolveMousePassthrough({ state: 'IDLE' }), true);
});

test('pet and companion hit regions capture mouse input', () => {
  assert.equal(resolveMousePassthrough({ state: 'IDLE', overSprite: true }), false);
  assert.equal(resolveMousePassthrough({ state: 'IDLE', overCompanion: true }), false);
});

test('closing one surface cannot override another open surface', () => {
  assert.equal(resolveMousePassthrough({
    state: 'IDLE',
    settingsOpen: false,
    settingsAnimating: false,
    skinSelectorOpen: true,
  }), false);
});

test('interactive transitions keep the full window captured', () => {
  for (const state of ['PULLING', 'PULLEY_DRAG', 'EXPANDING', 'PANEL_OPEN', 'COLLAPSING', 'CODEX_CONFIG_OPEN']) {
    assert.equal(resolveMousePassthrough({ state }), false, state);
  }
});

