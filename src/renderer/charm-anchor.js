/**
 * charm-anchor.js — 挂饰模式的光标双源采样（渲染进程）
 *
 * 不自建定时器/监听器：main.js 已有两条光标链——
 *   · DOM mousemove（窗内，零延迟）
 *   · 80ms IPC 轮询 cursor-position-get（窗外兜底，`synchronizeMousePassthroughFromSystem`）
 * 本类只记录两个源的值与到达时刻，每帧 sample() 取新者（freshest wins），
 * 避免「慢 1-3 帧的 IPC 旧值覆盖窗内新值」造成的锚点回跳。
 */
import { freshestCursorSample, isFiniteCoordinate } from '../shared/anchor-model.js';

export class CharmAnchorSampler {
  constructor() {
    this._windowCursor = null;
    this._windowAt = 0;
    this._screenCursor = null;
    this._screenAt = 0;
  }

  /** DOM mousemove 源：窗内每像素更新。 */
  noteWindowCursor(x, y) {
    if (!isFiniteCoordinate(x) || !isFiniteCoordinate(y)) return;
    this._windowCursor = { x, y };
    this._windowAt = performance.now();
  }

  /** IPC screen.getCursorScreenPoint 源：光标在哪都能取到，慢 1-3 帧。 */
  noteScreenCursor(x, y) {
    if (!isFiniteCoordinate(x) || !isFiniteCoordinate(y)) return;
    this._screenCursor = { x, y };
    this._screenAt = performance.now();
  }

  /** 当帧的最新光标；无任何有效源时返回 null（调用方保持上一帧锚点）。 */
  sample() {
    return freshestCursorSample({
      windowCursor: this._windowCursor,
      windowAt: this._windowAt,
      screenCursor: this._screenCursor,
      screenAt: this._screenAt,
    });
  }
}
