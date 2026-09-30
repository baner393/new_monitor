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
   * 绘制绳子 - 像素风格编织绳，MC 风格 3D 着色
   * 沿贝塞尔曲线采样点，每点绘制带高光/阴影的像素块
   * @param {number} anchorX - 锚点 X
   * @param {number} anchorY - 锚点 Y
   * @param {number} endX - 端点 X
   * @param {number} endY - 端点 Y
   * @param {number} sagAmount - 下垂量
   * @param {number} ropeWidth - 绳子宽度（像素块大小由内部固定）
   */
  draw(anchorX, anchorY, endX, endY, sagAmount, ropeWidth) {
    this.graphics.clear();

    const dx = endX - anchorX;
    const dy = endY - anchorY;

    // 贝塞尔控制点（与原版一致）
    const cp1x = anchorX + dx * 0.25;
    const cp1y = anchorY + dy * 0.25 + sagAmount * 0.6;
    const cp2x = anchorX + dx * 0.75;
    const cp2y = anchorY + dy * 0.75 + sagAmount * 0.6;

    // 沿贝塞尔曲线采样点
    const segments = 35;
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const mt = 1 - t;
      const x = mt * mt * mt * anchorX + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * endX;
      const y = mt * mt * mt * anchorY + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * endY;
      points.push({ x, y });
    }

    // MC 绳子配色
    const DARK_BROWN  = 0x5C4033; // 深棕（暗纹）
    const LIGHT_BROWN = 0x8B7355; // 浅棕（亮纹）
    const HIGHLIGHT   = 0xA08060; // 顶部高光
    const SHADOW      = 0x3A2A1A; // 底部阴影

    const px = 4; // 像素块尺寸
    const halfPx = px / 2;

    // 逐段绘制像素块
    for (let i = 0; i < points.length - 1; i++) {
      const p = points[i];
      const pNext = points[i + 1];

      // 当前段方向向量
      const segDx = pNext.x - p.x;
      const segDy = pNext.y - p.y;
      const segLen = Math.sqrt(segDx * segDx + segDy * segDy) || 1;

      // 法线方向（垂直于绳子，用于偏移）
      const nx = -segDy / segLen;
      const ny =  segDx / segLen;

      // 编织交替色
      const isLight = i % 2 === 0;
      const bodyColor = isLight ? LIGHT_BROWN : DARK_BROWN;

      // 1) 主体像素块
      this.graphics.beginFill(bodyColor, 1);
      this.graphics.drawRect(
        p.x - halfPx,
        p.y - halfPx,
        px, px
      );
      this.graphics.endFill();

      // 2) 顶部高光（1px 宽，半透明）
      this.graphics.beginFill(HIGHLIGHT, 0.65);
      this.graphics.drawRect(
        p.x - halfPx,
        p.y - halfPx,
        px, 1
      );
      this.graphics.endFill();

      // 3) 底部阴影（1px 宽，半透明）
      this.graphics.beginFill(SHADOW, 0.65);
      this.graphics.drawRect(
        p.x - halfPx,
        p.y + halfPx - 1,
        px, 1
      );
      this.graphics.endFill();

      // 4) 左侧微高光（1px，增强 3D 感）
      this.graphics.beginFill(HIGHLIGHT, 0.35);
      this.graphics.drawRect(
        p.x - halfPx,
        p.y - halfPx + 1,
        1, px - 2
      );
      this.graphics.endFill();

      // 5) 右侧微阴影（1px，增强 3D 感）
      this.graphics.beginFill(SHADOW, 0.35);
      this.graphics.drawRect(
        p.x + halfPx - 1,
        p.y - halfPx + 1,
        1, px - 2
      );
      this.graphics.endFill();
    }
  }
}
