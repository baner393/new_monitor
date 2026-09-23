/**
 * charm-keymap.js — 挂饰快捷键组合的解析与录制（纯函数，无依赖）
 *
 * 组合字符串格式：'Ctrl+Alt+A'（修饰键任意序 + 一个普通键）。
 * uiohook-napi 的 keycode 在 Windows 上 = 扫描码（A=30、Ctrl=29/3613 等，
 * 与 charm-hotkey.js 既有定义一致）；修饰键左右两侧等效。
 */

// uiohook (libuiohook) Windows 扫描码
const LETTER_KEYCODES = {
  Q: 16, W: 17, E: 18, R: 19, T: 20, Y: 21, U: 22, I: 23, O: 24, P: 25,
  A: 30, S: 31, D: 32, F: 33, G: 34, H: 35, J: 36, K: 37, L: 38,
  Z: 44, X: 45, C: 46, V: 47, B: 48, N: 49, M: 50,
};
const DIGIT_KEYCODES = {
  1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10, 0: 11,
};
const F_KEYCODES = {
  F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64,
  F7: 65, F8: 66, F9: 67, F10: 68, F11: 87, F12: 88,
};

export const MODIFIER_KEYCODES = Object.freeze({
  Ctrl: [29, 3613],   // Ctrl / CtrlRight
  Alt: [56, 3640],    // Alt / AltRight
  Shift: [42, 3638],  // Shift / ShiftRight
  Meta: [3675, 3676], // Win 左/右
});

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const MODIFIER_SET = new Set(MODIFIER_ORDER);

/**
 * 解析组合字符串 → { trigger: number, mods: Set<string> } | null。
 * 合法组合 = 至少一个修饰键 + 恰好一个普通键（字母/数字/F1-F12）。
 */
export function parseHotkeyCombo(combo) {
  if (typeof combo !== 'string') return null;
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const mods = new Set();
  let trigger = null;
  for (const part of parts) {
    const name = part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1).toLowerCase();
    if (MODIFIER_SET.has(name)) {
      mods.add(name);
      continue;
    }
    if (trigger !== null) return null; // 普通键只能有一个
    const code = LETTER_KEYCODES[name] ?? DIGIT_KEYCODES[name] ?? F_KEYCODES[name];
    if (code === undefined) return null;
    trigger = code;
  }
  if (trigger === null || mods.size === 0) return null;
  return { trigger, mods };
}

/**
 * 解析结果 → 规整的组合字符串（修饰键按固定序），非法输入返回 null。
 */
export function normalizeHotkeyCombo(combo) {
  const parsed = parseHotkeyCombo(combo);
  if (!parsed) return null;
  const triggerName = Object.entries({ ...LETTER_KEYCODES, ...DIGIT_KEYCODES, ...F_KEYCODES })
    .find(([, code]) => code === parsed.trigger)?.[0];
  if (!triggerName) return null;
  return [...MODIFIER_ORDER.filter((m) => parsed.mods.has(m)), triggerName].join('+');
}

/**
 * 键盘录制：DOM KeyboardEvent → 组合字符串。
 * 纯修饰键按下/松开返回 null（等待普通键）；无修饰键返回 null。
 */
export function comboFromKeyboardEvent(event) {
  if (!event || typeof event.key !== 'string') return null;
  const key = event.key;
  const mods = [];
  if (event.ctrlKey) mods.push('Ctrl');
  if (event.altKey) mods.push('Alt');
  if (event.shiftKey) mods.push('Shift');
  if (event.metaKey) mods.push('Meta');
  if (mods.length === 0) return null;
  let name = null;
  if (/^[a-z]$/i.test(key)) name = key.toUpperCase();
  else if (/^[0-9]$/.test(key)) name = key;
  else if (/^F([1-9]|1[0-2])$/.test(key)) name = key;
  if (!name) return null;
  return [...mods, name].join('+');
}
