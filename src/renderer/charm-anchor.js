/**
 * charm-anchor.js — 挂饰模式的光标双源采样（渲染进程）
 *
 * 不自建定时器/监听器：main.js 已有两条光标链——
 *   · DOM mousemove（窗内，零延迟）
 *   · IPC cursor-position-get（窗外兜底，`synchronizeMousePassthroughFromSystem`）
 * 本类只记录两个源的值与到达时刻，每帧 sample() 取新者（freshest wins），
 * 避免「慢 1-3 帧的 IPC 旧值覆盖窗内新值」造成的锚点回跳。
 */
import { freshestCursorSample, isFiniteCoordinate } from '../shared/anchor-model.js';

export class CharmAnchorSampler {
  constructor({ getCursorPosition = null, now = () => performance.now(), domFreshMs = 120 } = {}) {
    this._getCursorPosition = getCursorPosition;
    this._now = now;
    this._domFreshMs = domFreshMs;
    this._windowCursor = null;
    this._windowAt = 0;
    this._screenCursor = null;
    this._screenAt = 0;
    this._inFlight = false;
    this._lastObservationAt = 0;
    this._latestScreenRequestAt = 0;
  }

  _nextObservationAt(at) {
    const candidate = Number.isFinite(at) ? at : this._now();
    const next = candidate > this._lastObservationAt
      ? candidate
      : this._lastObservationAt + Number.EPSILON * Math.max(1, Math.abs(this._lastObservationAt));
    this._lastObservationAt = next;
    return next;
  }

  /** DOM mousemove 源：窗内每像素更新。 */
  noteWindowCursor(x, y) {
    if (!isFiniteCoordinate(x) || !isFiniteCoordinate(y)) return;
    this._windowCursor = { x, y };
    this._windowAt = this._nextObservationAt(this._now());
  }

  /** 标记 screen IPC 发起时间，回包必须早于期间出现的更新样本。 */
  beginScreenRequest(requestAt = this._now(), { supersede = true } = {}) {
    const observedAt = this._nextObservationAt(requestAt);
    if (supersede) this._latestScreenRequestAt = observedAt;
    return observedAt;
  }

  isScreenRequestCurrent(requestAt) {
    return Number.isFinite(requestAt)
      && this._windowAt <= requestAt
      && this._latestScreenRequestAt <= requestAt;
  }

  /** IPC screen.getCursorScreenPoint 源：以请求时刻作为坐标观测时刻。 */
  noteScreenCursor(x, y, observedAt = this._nextObservationAt(this._now())) {
    if (!isFiniteCoordinate(x) || !isFiniteCoordinate(y) || !Number.isFinite(observedAt)) return false;
    if (this._windowAt > observedAt
      || this._latestScreenRequestAt > observedAt
      || this._screenAt >= observedAt) return false;
    this._screenCursor = { x, y };
    this._screenAt = observedAt;
    this._lastObservationAt = Math.max(this._lastObservationAt, observedAt);
    return true;
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
   * 单飞 IPC 采样（未返回不重发）。DOM 样本失效时由挂饰分支逐帧调用，
   * 每次 IPC 完成后即可在下一帧发起新采样，不再受 80ms 定时器节流影响。
   */
  pollOnce({ staleAfterMs = this._domFreshMs } = {}) {
    const now = this._now();
    // 透明全屏窗口正常会转发 DOM mousemove；该零延迟来源新鲜时无需再
    // 穿越主进程查询系统光标。仅把 IPC 留给转发偶发失效的兜底路径。
    if (now - this._windowAt <= staleAfterMs) return false;
    if (this._inFlight || !this._getCursorPosition) return false;
    this._inFlight = true;
    // Passthrough synchronization is authoritative for input readiness. A
    // per-frame anchor poll must not invalidate its in-flight IPC response.
    const requestAt = this.beginScreenRequest(now, { supersede: false });
    let cursorRequest;
    try {
      cursorRequest = this._getCursorPosition();
    } catch {
      this._inFlight = false;
      return true;
    }
    Promise.resolve(cursorRequest)
      .then((pos) => {
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
          this.noteScreenCursor(pos.x, pos.y, requestAt);
        }
      })
      .catch(() => {
        // A failed fallback sample is ignored; the next animation frame can retry.
      })
      .finally(() => {
        this._inFlight = false;
      });
    return true;
  }
}
