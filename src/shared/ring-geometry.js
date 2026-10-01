/**
 * ring-geometry.js — 环形菜单几何与判定（纯函数/纯类，无依赖，可单测）
 *
 * 角度约定（与设计文档 §1.2 定稿一致）：0 = 12 点，顺时针为正，y 轴向下；
 * a = atan2(dx, -dy)，归一化到 [0, 2π)。
 * 命中：纯角度映射 idx = floor((a + SECTOR/2) / SECTOR) % N（半扇区偏移消歧，
 * 扇区边界落在两中心之间），距离不参与命中，只有死区（< 24px 判未瞄准）。
 */

export const RING_ITEM_COUNT = 9;
export const RING_SECTOR_RAD = (Math.PI * 2) / RING_ITEM_COUNT;
export const RING_DEAD_ZONE_RADIUS = 24;
export const RING_HOVER_GATE_DISTANCE = 20;
export const RING_CANCEL_RATE = 340; // px/s，松手瞬间超过判误触
export const RING_CANCEL_RATE_WINDOW = 0.110; // s，光标速度估计窗口

/** 0 = 12 点（正上），顺时针为正，结果在 [0, 2π)。 */
export function ringAngleFrom(center, point) {
  let a = Math.atan2(point.x - center.x, -(point.y - center.y));
  if (a < 0) a += Math.PI * 2;
  return a;
}

export function ringPolar(center, r, angle) {
  return { x: center.x + Math.sin(angle) * r, y: center.y - Math.cos(angle) * r };
}

export function ringDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Keep the ring center far enough from screen edges to leave every sector visible. */
export function clampRingCenter(center, width, height, margin) {
  const screenWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const screenHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const edge = Number.isFinite(margin) ? Math.max(0, margin) : 0;
  const clampAxis = (value, size) => {
    if (!Number.isFinite(value) || size <= edge * 2) return size / 2;
    return Math.max(edge, Math.min(size - edge, value));
  };
  return {
    x: clampAxis(center?.x, screenWidth),
    y: clampAxis(center?.y, screenHeight),
  };
}

/** 第 i 项的中心角（扇区 0 = 12 点）。 */
export function ringItemAngle(i) {
  return RING_SECTOR_RAD * i;
}

/**
 * 命中测试：纯角度 + 死区 + 半扇区偏移消歧。
 * @returns {{idx:number, r:number, a:number}} idx = -1 表示未命中（死区）
 */
export function ringAim(center, cursor) {
  const r = ringDistance(cursor, center);
  const a = ringAngleFrom(center, cursor);
  if (r < RING_DEAD_ZONE_RADIUS) return { idx: -1, r, a };
  const idx = Math.floor((a + RING_SECTOR_RAD / 2) / RING_SECTOR_RAD) % RING_ITEM_COUNT;
  return { idx, r, a };
}

/**
 * 光标速度跟踪（滑窗，松手误触门控用）。
 * feed 每帧写入；rate() 返回窗口首尾差分速度（px/s）。
 */
export class CursorSpeedTracker {
  constructor({ windowSeconds = RING_CANCEL_RATE_WINDOW } = {}) {
    this._windowSeconds = windowSeconds;
    this._samples = [];
  }

  reset() {
    this._samples = [];
  }

  feed(x, y, timeMs) {
    if (![x, y, timeMs].every((v) => typeof v === 'number' && Number.isFinite(v))) return;
    this._samples.push({ x, y, t: timeMs });
    while (this._samples.length > 2 && timeMs - this._samples[0].t > this._windowSeconds * 1000) {
      this._samples.shift();
    }
  }

  /** px/s；样本不足或时间倒流时返回 0。 */
  rate() {
    const s = this._samples;
    if (s.length < 2) return 0;
    const first = s[0];
    const last = s[s.length - 1];
    if (last.t <= first.t) return 0;
    return Math.hypot(last.x - first.x, last.y - first.y) / ((last.t - first.t) / 1000);
  }
}

/**
 * hover 门控（juhRadial 的 _hover_gate）：开环首帧锚定「光标相对圆心」的
 * 相对坐标，光标移出 RING_HOVER_GATE_DISTANCE 后才武装命中——同时防
 * 「按下瞬间手抖」和「近屏幕边缘开场误高亮」。
 */
export class HoverGate {
  constructor({ exitDistance = RING_HOVER_GATE_DISTANCE } = {}) {
    this._exitDistance = exitDistance;
    this._anchor = null;
    this._armed = false;
  }

  reset() {
    this._anchor = null;
    this._armed = false;
  }

  /**
   * @param {number} dx 光标相对圆心的 x
   * @param {number} dy 光标相对圆心的 y
   * @returns {boolean} 是否已武装（武装后恒 true）
   */
  feed(dx, dy) {
    if (this._anchor === null) {
      this._anchor = { x: dx, y: dy };
      return false;
    }
    if (!this._armed) {
      if (Math.hypot(dx - this._anchor.x, dy - this._anchor.y) < this._exitDistance) {
        return false;
      }
      this._armed = true;
    }
    return true;
  }

  get armed() {
    return this._armed;
  }
}
