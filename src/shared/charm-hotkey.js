/**
 * charm-hotkey.js — 可配置组合键的按住/松手状态机（纯函数，无依赖）
 *
 * 输入是低级键盘钩子（uiohook-napi）的 keydown/keyup 事件流，输出相位：
 *   'down' — 组合恰好补齐（按住开始；环形菜单开环的信号）
 *   'up'   — 组合断裂（松手触发 / 取消的信号）
 *   null   — 与相位无关的普通键盘事件
 *
 * 不使用事件自带的 ctrlKey/altKey 布尔字段——实测在注入事件（keybd_event /
 * 远程桌面等）下这些字段不可靠。改为自维护 keycode 按住集合：
 *   - 组合 = 触发键 + 每个要求的修饰键组（左右两侧等效）全部在按住集合中；
 *   - Windows 自动重复会连发 keydown，fired 标志保证 'down' 相位只发一次；
 *   - 组合成员任一松开即断裂；组合外的按键不影响相位。
 *
 * 组合由 charm-keymap.parseHotkeyCombo('Ctrl+Alt+A') 解析；默认 Ctrl+Alt+A。
 */

import { parseHotkeyCombo, MODIFIER_KEYCODES } from './charm-keymap.js';

export const DEFAULT_CHARM_HOTKEY = 'Ctrl+Alt+A';

// 兼容旧引用（默认组合的 keycode 集合）
export const CHARM_HOTKEY_TRIGGER_KEYCODE = 30; // UiohookKey.A
export const CHARM_HOTKEY_CTRL_KEYCODES = [29, 3613]; // UiohookKey.Ctrl / CtrlRight
export const CHARM_HOTKEY_ALT_KEYCODES = [56, 3640]; // UiohookKey.Alt / AltRight

function comboKeycodeGroups(combo) {
  // [触发键集合, ...每个修饰键组]
  const groups = [[combo.trigger]];
  for (const mod of combo.mods) groups.push(MODIFIER_KEYCODES[mod]);
  return groups;
}

function comboMemberKeycodes(combo) {
  return new Set(comboKeycodeGroups(combo).flat());
}

export function createCharmHotkeyState(comboText = DEFAULT_CHARM_HOTKEY) {
  const parsed = parseHotkeyCombo(comboText) || parseHotkeyCombo(DEFAULT_CHARM_HOTKEY);
  return { down: new Set(), fired: false, combo: parsed };
}

/** 热更新组合（设置面板改快捷键）：清空按住集合避免残留状态。 */
export function setCharmHotkeyCombo(state, comboText) {
  const parsed = parseHotkeyCombo(comboText);
  if (!parsed) return false;
  state.combo = parsed;
  state.down = new Set();
  state.fired = false;
  return true;
}

function isComboMember(state, keycode) {
  return comboMemberKeycodes(state.combo).has(keycode);
}

function isComboComplete(state) {
  return comboKeycodeGroups(state.combo).every((group) => group.some((k) => state.down.has(k)));
}

export function feedCharmHotkeyState(state, event) {
  const { type, keycode } = event || {};
  if (typeof keycode !== 'number') return { phase: null };

  if (type === 'down') {
    state.down.add(keycode);
    if (!state.fired && isComboComplete(state)) {
      state.fired = true;
      return { phase: 'down' };
    }
    return { phase: null };
  }

  if (type === 'up') {
    const wasDown = state.down.delete(keycode);
    if (state.fired && wasDown && isComboMember(state, keycode)) {
      state.fired = false;
      return { phase: 'up' };
    }
    return { phase: null };
  }

  return { phase: null };
}
