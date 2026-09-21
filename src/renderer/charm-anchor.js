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
  constructor({ getCursorPosition = null, now = () => performance.now(), domFreshMs = 120, fallbackIntervalMs = 80 } = {}) {
    this._getCursorPosition = getCursorPosition;
    this._now = now;
    this._domFreshMs = domFreshMs;
    this._fallbackIntervalMs = fallbackIntervalMs;
    this._windowCursor = null;
    this._windowAt = 0;
    this._screenCursor = null;
    this._screenAt = 0;
    this._inFlight = false;
    this._lastFallbackAt = -Infinity;
  }

  /** DOM mousemove 源：窗内每像素更新。 */
  noteWindowCursor(x, y) {
    if (!isFiniteCoordinate(x) || !isFiniteCoordinate(y)) return;
    this._windowCursor = { x, y };
    this._windowAt = this._now();
  }

  /** IPC screen.getCursorScreenPoint 源：光标在哪都能取到，慢 1-3 帧。 */
  noteScreenCursor(x, y) {
    if (!isFiniteCoordinate(x) || !isFiniteCoordinate(y)) return;
    this._screenCursor = { x, y };
    this._screenAt = this._now();
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

  /**
   * 单飞 IPC 采样（未返回不重发）。挂饰模式跟随的手感关键：80ms 的
   * passthrough 轮询对锚点跟随来说只有 12.5Hz——鼠标快速移动时锚点每
   * 80ms 跳一步，体感卡顿。挂饰分支每帧调用本方法，锚点采样延迟从
   * 80ms 降到单次 IPC 往返（约 2-4ms）。
   */
  pollOnce() {
    const now = this._now();
    // 透明全屏窗口正常会转发 DOM mousemove；该零延迟来源新鲜时无需再
    // 穿越主进程查询系统光标。仅把 IPC 留给转发偶发失效的兜底路径。
    if (now - this._windowAt <= this._domFreshMs) return false;
    if (this._inFlight || !this._getCursorPosition || now - this._lastFallbackAt < this._fallbackIntervalMs) return false;
    this._inFlight = true;
    this._lastFallbackAt = now;
    Promise.resolve()
      .then(() => this._getCursorPosition())
      .then((pos) => {
        this._inFlight = false;
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
          this._screenCursor = { x: pos.x, y: pos.y };
          this._screenAt = this._now();
        }
      })
      .catch(() => {
        this._inFlight = false;
      });
    return true;
  }
}
