/**
 * RopeRenderer - 贝塞尔曲线绳子渲染模块
 * 使用两段贝塞尔曲线实现更自然的绳子效果
 */
export class RopeRenderer {
  constructor(graphics) {
    this.graphics = graphics;
  }

  /**
   * 计算绳子下垂量 - 考虑拖拽状态
   * @param {number} ropeLength - 绳子长度
   * @param {number} omega - 角速度
   * @param {number} pullDist - 拖拽拉伸距离（0 = 未拖拽）
   * @param {string} state - 当前状态
   * @returns {number} sagAmount
   */
  static calcSagAmount(ropeLength, omega = 0, pullDist = 0, state = 'IDLE') {
    // 基础下垂
    let sag = Math.min(ropeLength * 0.08, 25);
    
    // 摆动增加的下垂
    sag += Math.min(Math.abs(omega) * 5, 15);
    
    // 拖拽时：距离越远绳子越紧，但保持最小弧度
    if (state === 'PULLING') {
      const tautness = Math.min(pullDist / 200, 1); // 0~1
      sag = sag * (1 - tautness * 0.7); // 最多减少 70%
      sag = Math.max(sag, 3); // 保持最小弧度
    }
    
    return sag;
  }

  /**
   * 绘制绳子 - 使用两段贝塞尔曲线实现更平滑的效果
   * @param {number} anchorX - 锚点 X
   * @param {number} anchorY - 锚点 Y
   * @param {number} endX - 端点 X
   * @param {number} endY - 端点 Y
   * @param {number} sagAmount - 下垂量
   * @param {number} ropeWidth - 绳子宽度
   */
  draw(anchorX, anchorY, endX, endY, sagAmount, ropeWidth) {
    this.graphics.clear();

    const dx = endX - anchorX;
    const dy = endY - anchorY;

    // 两段贝塞尔的中点（最大下垂处）
    const midX = anchorX + dx * 0.5;
    const midY = anchorY + dy * 0.5 + sagAmount;

    // 前半段控制点
    const cp1x = anchorX + dx * 0.25;
    const cp1y = anchorY + dy * 0.25 + sagAmount * 0.6;

    // 后半段控制点
    const cp2x = anchorX + dx * 0.75;
    const cp2y = anchorY + dy * 0.75 + sagAmount * 0.6;

    // 绘制副线（浅棕色，高光效果）
    this.graphics.lineStyle(Math.max(ropeWidth - 1, 1), 0x8B7355, 0.8);
    this.graphics.moveTo(anchorX + 1, anchorY);
    // 前半段
    this.graphics.bezierCurveTo(cp1x + 1, cp1y, midX + 1, midY, midX + 1, midY);
    // 后半段
    this.graphics.bezierCurveTo(midX + 1, midY, cp2x + 1, cp2y, endX + 1, endY);

    // 绘制主线（深棕色）
    this.graphics.lineStyle(ropeWidth, 0x5C4033, 1);
    this.graphics.moveTo(anchorX, anchorY);
    // 前半段
    this.graphics.bezierCurveTo(cp1x, cp1y, midX, midY, midX, midY);
    // 后半段
    this.graphics.bezierCurveTo(midX, midY, cp2x, cp2y, endX, endY);
  }
}
