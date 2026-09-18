import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARM_HOTKEY_ALT_KEYCODES,
  CHARM_HOTKEY_CTRL_KEYCODES,
  CHARM_HOTKEY_TRIGGER_KEYCODE,
  createCharmHotkeyState,
  feedCharmHotkeyState,
} from '../src/shared/charm-hotkey.js';

const KEY_A = CHARM_HOTKEY_TRIGGER_KEYCODE; // 30
const KEY_CTRL = CHARM_HOTKEY_CTRL_KEYCODES[0]; // 29
const KEY_CTRL_R = CHARM_HOTKEY_CTRL_KEYCODES[1]; // 3613
const KEY_ALT = CHARM_HOTKEY_ALT_KEYCODES[0]; // 56
const KEY_ALT_R = CHARM_HOTKEY_ALT_KEYCODES[1]; // 3640
const KEY_X = 45;

const down = (keycode) => ({ type: 'down', keycode });
const up = (keycode) => ({ type: 'up', keycode });
// 组合的修饰键前置序列（Ctrl、Alt 先于触发键按住）
const ARM = [down(KEY_CTRL), down(KEY_ALT)];

function phases(events) {
  const state = createCharmHotkeyState();
  return events.map((event) => feedCharmHotkeyState(state, event).phase);
}

test('plain keys without modifiers never fire a phase', () => {
  assert.deepEqual(phases([down(KEY_A), up(KEY_A)]), [null, null]);
});

test('combo completing with the trigger key fires down exactly once', () => {
  assert.deepEqual(phases([down(KEY_CTRL), down(KEY_ALT), down(KEY_A)]), [null, null, 'down']);
});

test('combo completing with modifiers pressed last arms when the set fills', () => {
  assert.deepEqual(phases([down(KEY_A), down(KEY_CTRL), down(KEY_ALT)]), [null, null, 'down']);
});

test('right-side Ctrl and Alt satisfy the combo the same as left-side', () => {
  assert.deepEqual(phases([down(KEY_CTRL_R), down(KEY_ALT_R), down(KEY_A)]), [null, null, 'down']);
});

test('auto-repeat keydowns do not re-fire the down phase', () => {
  assert.deepEqual(
    phases([...ARM, down(KEY_A), down(KEY_A), down(KEY_A)]),
    [null, null, 'down', null, null],
  );
});

test('releasing the trigger key fires up once', () => {
  assert.deepEqual(phases([...ARM, down(KEY_A), up(KEY_A)]), [null, null, 'down', 'up']);
});

test('releasing a modifier fires up even while the trigger key stays held', () => {
  assert.deepEqual(phases([...ARM, down(KEY_A), up(KEY_ALT)]), [null, null, 'down', 'up']);
  assert.deepEqual(phases([...ARM, down(KEY_A), up(KEY_CTRL)]), [null, null, 'down', 'up']);
});

test('unrelated keys pressed and released while held do not break the combo', () => {
  assert.deepEqual(phases([...ARM, down(KEY_A), down(KEY_X), up(KEY_X)]), [null, null, 'down', null, null]);
});

test('releasing non-combo keys before the combo is armed fires nothing', () => {
  assert.deepEqual(phases([down(KEY_CTRL), down(KEY_ALT), up(KEY_ALT)]), [null, null, null]);
});

test('the cycle can re-arm after a full down/up sequence', () => {
  assert.deepEqual(phases([...ARM, down(KEY_A), up(KEY_A), down(KEY_A)]), [null, null, 'down', 'up', 'down']);
});

test('modifier release with the trigger key auto-repeating ends cleanly', () => {
  assert.deepEqual(phases([...ARM, down(KEY_A), up(KEY_ALT), down(KEY_A)]), [null, null, 'down', 'up', null]);
});

test('phantom duplicate keyup events fire no extra phase', () => {
  assert.deepEqual(phases([...ARM, down(KEY_A), up(KEY_A), up(KEY_A)]), [null, null, 'down', 'up', null]);
});

test('malformed events are ignored without throwing', () => {
  const state = createCharmHotkeyState();
  assert.deepEqual(feedCharmHotkeyState(state, null).phase, null);
  assert.deepEqual(feedCharmHotkeyState(state, {}).phase, null);
  assert.deepEqual(feedCharmHotkeyState(state, { type: 'weird', keycode: KEY_A }).phase, null);
  assert.deepEqual(feedCharmHotkeyState(state, { type: 'down', keycode: 'A' }).phase, null);
});
