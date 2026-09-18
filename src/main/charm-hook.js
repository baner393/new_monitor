/**
 * charm-hook.js — 低级键盘钩子胶水（uiohook-napi，libuiohook 的 napi 封装）
 *
 * Windows 上由包内预编译二进制（prebuilds/win32-*）提供 WH_KEYBOARD_LL 级别的
 * keydown/keyup 事件；napi addon 由 Electron 主进程直接加载，无编译步骤。
 * 必须保持 rollupOptions.external：.node 二进制无法被 vite 打包。
 *
 * 钩子启动失败（二进制缺失、被安全软件拦截等）时降级为「无快捷键、托盘仍可用」，
 * 快捷键是增强入口而非唯一入口。
 */
import { uIOhook } from 'uiohook-napi';
import { createCharmHotkeyState, feedCharmHotkeyState } from '../shared/charm-hotkey.js';

export function startCharmHook({ onPhase } = {}) {
  const state = createCharmHotkeyState();
  const feed = (type) => (event) => {
    const { phase } = feedCharmHotkeyState(state, {
      type,
      keycode: event.keycode,
    });
    if (!phase || !onPhase) return;
    try {
      onPhase(phase);
    } catch (error) {
      console.error('[CharmHook] onPhase handler failed:', error?.message || error);
    }
  };
  const onKeyDown = feed('down');
  const onKeyUp = feed('up');

  try {
    uIOhook.on('keydown', onKeyDown);
    uIOhook.on('keyup', onKeyUp);
    uIOhook.start();
    console.log('[CharmHook] low-level keyboard hook started (Ctrl+Alt+A hold/release)');
  } catch (error) {
    console.error('[CharmHook] failed to start:', error?.message || error);
    return () => {};
  }

  return () => {
    try {
      uIOhook.off('keydown', onKeyDown);
      uIOhook.off('keyup', onKeyUp);
      uIOhook.stop();
      console.log('[CharmHook] keyboard hook stopped');
    } catch (error) {
      console.error('[CharmHook] failed to stop:', error?.message || error);
    }
  };
}
