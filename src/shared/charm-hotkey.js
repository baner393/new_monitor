/**
 * charm-hotkey.js — Ctrl+Alt+A 按住/松手组合键状态机（纯函数，无依赖）
 *
 * 输入是低级键盘钩子（uiohook-napi）的 keydown/keyup 事件流，输出相位：
 *   'down' — 组合恰好补齐（按住开始；环形菜单开环的信号）
 *   'up'   — 组合断裂（松手触发 / 取消的信号）
 *   null   — 与相位无关的普通键盘事件
 *
 * 不使用事件自带的 ctrlKey/altKey 布尔字段——实测在注入事件（keybd_event /
 * 远程桌面等）下这些字段不可靠。改为自维护 keycode 按住集合：
 *   - 组合 = 触发键 A + 任意一侧 Ctrl + 任意一侧 Alt 全部在按住集合中；
 *   - Windows 自动重复会连发 keydown，fired 标志保证 'down' 相位只发一次；
 *   - 组合成员（A / Ctrl / Alt）任一松开即断裂；组合外的按键不影响相位。
 */

export const CHARM_HOTKEY_TRIGGER_KEYCODE = 30; // UiohookKey.A
export const CHARM_HOTKEY_CTRL_KEYCODES = [29, 3613]; // UiohookKey.Ctrl / CtrlRight
export const CHARM_HOTKEY_ALT_KEYCODES = [56, 3640]; // UiohookKey.Alt / AltRight

export function createCharmHotkeyState() {
  return { down: new Set(), fired: false };
}

function isComboMember(keycode) {
  return keycode === CHARM_HOTKEY_TRIGGER_KEYCODE
    || CHARM_HOTKEY_CTRL_KEYCODES.includes(keycode)
    || CHARM_HOTKEY_ALT_KEYCODES.includes(keycode);
}

function isComboComplete(down) {
  return down.has(CHARM_HOTKEY_TRIGGER_KEYCODE)
    && CHARM_HOTKEY_CTRL_KEYCODES.some((k) => down.has(k))
    && CHARM_HOTKEY_ALT_KEYCODES.some((k) => down.has(k));
}

export function feedCharmHotkeyState(state, event) {
  const { type, keycode } = event || {};
  if (typeof keycode !== 'number') return { phase: null };

  if (type === 'down') {
    state.down.add(keycode);
    if (!state.fired && isComboComplete(state.down)) {
      state.fired = true;
      return { phase: 'down' };
    }
    return { phase: null };
  }

  if (type === 'up') {
    const wasDown = state.down.delete(keycode);
    if (state.fired && wasDown && isComboMember(keycode)) {
      state.fired = false;
      return { phase: 'up' };
    }
    return { phase: null };
  }

  return { phase: null };
}
