import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHotkeyCombo,
  normalizeHotkeyCombo,
  comboFromKeyboardEvent,
  MODIFIER_KEYCODES,
} from '../src/shared/charm-keymap.js';
import {
  createCharmHotkeyState,
  setCharmHotkeyCombo,
  feedCharmHotkeyState,
  DEFAULT_CHARM_HOTKEY,
} from '../src/shared/charm-hotkey.js';

test('parseHotkeyCombo：合法组合解析，非法输入拒绝', () => {
  const ok = parseHotkeyCombo('Ctrl+Alt+A');
  assert.equal(ok.trigger, 30);
  assert.deepEqual([...ok.mods].sort(), ['Alt', 'Ctrl']);
  assert.equal(parseHotkeyCombo('A'), null, '无修饰键');
  assert.equal(parseHotkeyCombo('Ctrl+Alt'), null, '无普通键');
  assert.equal(parseHotkeyCombo('Ctrl+A+B'), null, '两个普通键');
  assert.equal(parseHotkeyCombo('Ctrl+Alt+Ω'), null, '未知键');
  assert.equal(parseHotkeyCombo(42), null);
  assert.equal(parseHotkeyCombo(''), null);
});

test('normalizeHotkeyCombo：规整修饰键顺序与大小写', () => {
  assert.equal(normalizeHotkeyCombo('alt+ctrl+a'), 'Ctrl+Alt+A');
  assert.equal(normalizeHotkeyCombo('Shift+Ctrl+F5'), 'Ctrl+Shift+F5');
  assert.equal(normalizeHotkeyCombo('meta+alt+3'), 'Alt+Meta+3');
  assert.equal(normalizeHotkeyCombo('nonsense'), null);
});

test('comboFromKeyboardEvent：录制 DOM 键盘事件', () => {
  assert.equal(comboFromKeyboardEvent({ key: 'q', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Q');
  assert.equal(comboFromKeyboardEvent({ key: 'F6', altKey: true }), 'Alt+F6');
  assert.equal(comboFromKeyboardEvent({ key: 'Control', ctrlKey: true }), null, '纯修饰键等待');
  assert.equal(comboFromKeyboardEvent({ key: 'a' }), null, '无修饰键无效');
  assert.equal(comboFromKeyboardEvent({ key: 'Enter', ctrlKey: true }), null, '不支持的普通键');
});

test('charm-hotkey：默认组合行为不变（回归）', () => {
  const state = createCharmHotkeyState();
  assert.equal(feedCharmHotkeyState(state, { type: 'down', keycode: 29 }).phase, null);
  assert.equal(feedCharmHotkeyState(state, { type: 'down', keycode: 56 }).phase, null);
  assert.equal(feedCharmHotkeyState(state, { type: 'down', keycode: 30 }).phase, 'down');
  assert.equal(feedCharmHotkeyState(state, { type: 'up', keycode: 56 }).phase, 'up');
});

test('charm-hotkey：自定义组合（Ctrl+Shift+Q）完整 down/up 周期', () => {
  const state = createCharmHotkeyState('Ctrl+Shift+Q');
  assert.equal(feedCharmHotkeyState(state, { type: 'down', keycode: 30 }).phase, null, '旧触发键 A 无相位');
  feedCharmHotkeyState(state, { type: 'down', keycode: 29 });  // Ctrl
  feedCharmHotkeyState(state, { type: 'down', keycode: 42 });  // Shift
  assert.equal(feedCharmHotkeyState(state, { type: 'down', keycode: 16 }).phase, 'down'); // Q
  assert.equal(feedCharmHotkeyState(state, { type: 'up', keycode: 42 }).phase, 'up');
});

test('charm-hotkey：右侧修饰键等效', () => {
  const state = createCharmHotkeyState('Ctrl+Alt+A');
  feedCharmHotkeyState(state, { type: 'down', keycode: 3613 }); // CtrlRight
  feedCharmHotkeyState(state, { type: 'down', keycode: 3640 }); // AltRight
  assert.equal(feedCharmHotkeyState(state, { type: 'down', keycode: 30 }).phase, 'down');
});

test('setCharmHotkeyCombo：热更新组合并清空残留状态', () => {
  const state = createCharmHotkeyState(DEFAULT_CHARM_HOTKEY);
  feedCharmHotkeyState(state, { type: 'down', keycode: 29 });
  assert.equal(setCharmHotkeyCombo(state, 'Alt+Shift+B'), true);
  assert.equal(state.down.size, 0, '按住集合已清空');
  feedCharmHotkeyState(state, { type: 'down', keycode: 56 });
  feedCharmHotkeyState(state, { type: 'down', keycode: 3638 }); // ShiftRight
  assert.equal(feedCharmHotkeyState(state, { type: 'down', keycode: 48 }).phase, 'down'); // B
  assert.equal(setCharmHotkeyCombo(state, 'garbage'), false, '非法组合拒绝');
  assert.equal(state.combo.trigger, 48, '非法输入不破坏现有组合');
});

test('MODIFIER_KEYCODES 覆盖左右两侧', () => {
  for (const codes of Object.values(MODIFIER_KEYCODES)) {
    assert.equal(codes.length, 2, '每个修饰键有左右两个 keycode');
  }
});
