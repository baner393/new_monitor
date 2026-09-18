/**
 * anchor-model.js — 锚点抽象（纯函数，无依赖，可单测）
 *
 * 两种锚点形态：
 *   top    — 经典模式：屏幕顶边悬挂，screenAnchorX(0..1) × 窗宽，anchorY=50
 *   cursor — 挂饰模式：鼠标当滑轮，锚点 = 光标位置（1:1 硬绑定）
 *
 * 所有坐标都是窗口 CSS 像素。NaN 污染防御（畸形采样必须整点丢弃，不能用
 * Number.isFinite(Number(x))——Number(null)/Number('') 都是 0，会把「坐标缺失」
 * 悄悄当成窗口原点造成假瞬移）。
 */

export const ANCHOR_MODES = {
  TOP: 'top',
  CURSOR: 'cursor',
};

/** 挂饰/经典两形态各自的默认绳长（分开存储，互不串味）。 */
export const DEFAULT_ROPE_LENGTHS = {
  [ANCHOR_MODES.TOP]: 150,
  [ANCHOR_MODES.CURSOR]: 80,
};

export function isFiniteCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 整点有效性：任一坐标缺失/畸形即整体无效。 */
export function isFinitePoint(point) {
  return Boolean(point)
    && isFiniteCoordinate(point.x)
    && isFiniteCoordinate(point.y);
}

/**
 * 解析当前帧的锚点。
 * @param {object} params
 * @param {string} params.anchorMode        ANCHOR_MODES 之一
 * @param {{x:number,y:number}|null} params.cursor  挂饰模式的光标采样（可缺失）
 * @param {number} params.screenAnchorX     经典模式的归一化锚点 (0..1)
 * @param {number} params.windowWidth
 * @returns {{x:number, y:number}|null}     无有效锚点时返回 null（调用方保持上一帧）
 */
export function resolveAnchorPoint({ anchorMode, cursor, screenAnchorX, windowWidth }) {
  if (anchorMode === ANCHOR_MODES.CURSOR) {
    return isFinitePoint(cursor) ? { x: cursor.x, y: cursor.y } : null;
  }
  if (!isFiniteCoordinate(screenAnchorX) || !isFiniteCoordinate(windowWidth) || windowWidth <= 0) {
    return null;
  }
  return { x: screenAnchorX * windowWidth, y: 50 };
}

/**
 * 把挂饰锚点钳进窗口（只留极小边距——锚点贴边是「挂件撞墙」的自然表现，
 * 乌龟本体另有边界反弹与疼表情）。
 */
export const CHARM_ANCHOR_MARGIN = 2;

export function clampCharmAnchor(point, windowWidth, windowHeight, margin = CHARM_ANCHOR_MARGIN) {
  if (!isFinitePoint(point)) return null;
  if (!isFiniteCoordinate(windowWidth) || !isFiniteCoordinate(windowHeight)) return null;
  const x = Math.min(Math.max(point.x, margin), Math.max(margin, windowWidth - margin));
  const y = Math.min(Math.max(point.y, margin), Math.max(margin, windowHeight - margin));
  return { x, y };
}

/**
 * 双源光标采样取新：窗内 DOM mousemove 零延迟但光标出窗即停发；
 * IPC 采样慢 1-3 帧但光标在哪都能取到。取到达时刻较新者，任一缺失退回另一个。
 * 都缺时刻时 window 源优先（同一 tick 内 mousemove 更权威）。
 */
export function freshestCursorSample({
  windowCursor = null,
  windowAt = 0,
  screenCursor = null,
  screenAt = 0,
} = {}) {
  const hasWindow = isFinitePoint(windowCursor) && Number.isFinite(windowAt) && windowAt > 0;
  const hasScreen = isFinitePoint(screenCursor) && Number.isFinite(screenAt) && screenAt > 0;
  if (hasWindow && hasScreen) {
    return screenAt > windowAt ? screenCursor : windowCursor;
  }
  if (hasWindow) return windowCursor;
  if (hasScreen) return screenCursor;
  return null;
}
