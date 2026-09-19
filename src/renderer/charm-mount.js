/**
 * charm-mount.js — 鼠标挂环（穿孔鼠标挂饰的金属钥匙扣环）绘制
 *
 * 视觉规格来自效果图 v3（.project-memory/proposals/charm-cursor-mockup.html）：
 * 金属感 = 沿弧分布的锐利镜面色带（高光带与暗部紧邻），不是柔和渐变。
 *
 * 结构（环心为原点，外圈 r=6.5，管宽 ~2.4）：
 *   · 后弧外露段（右上 -60°~0°）：背光中暗 + 内侧高光线
 *   · 前弧（下半 0°~180°）：外缘暗描边 + 四段镜面色带
 *   · 内圈：暗内壁 + 55°~95° 反光亮线
 *   · 开口缝（右下 28°）+ 两枚管口端面亮椭圆
 *
 * 系统箭头光标绘制在 OS 硬件层，永远盖在窗口内容之上——环的左半会被
 * 箭头自然遮住（「穿在鼠标背后挂在边缘」的真实遮挡），因此这里只画
 * 效果图中的外露部分，孔和环左半无需绘制。
 *
 * 锚点约定：绳固定端（physics.pulley）= 环底 = 环心 + (0, +6.5)。
 * 光标到环心偏移 (15, 17)，即光标到绳锚点偏移 (15, 23.5)。
 * 环心放在箭头右缘外一点：系统光标盖住环的左半，右缘露出 C 形段。
 */

export const CHARM_MOUNT_CENTER_OFFSET = { x: 15, y: 17 };
export const CHARM_MOUNT_ANCHOR_OFFSET = { x: 15, y: 23.5 };

const RING_R = 6.5;
const RING_INNER_R = 4.6;

const DEG = Math.PI / 180;

// 前弧四段镜面色带（0°=右，顺时针，y 向下；光源左上）
const FRONT_SEGMENTS = [
  { a0: 0, a1: 55, color: 0xdfe5ec },
  { a0: 55, a1: 95, color: 0xf8fafc },
  { a0: 95, a1: 137, color: 0x59616c },
  { a0: 137, a1: 180, color: 0x3d444e },
];

/**
 * 在 (cx, cy)（环心）绘制金属挂环。每帧整体重绘由调用方的 Graphics 承担。
 */
export function drawCharmMount(graphics, cx, cy) {
  graphics.clear();

  // 前弧外缘暗描边（管壁截断感）
  graphics.lineStyle(3.0, 0x242a33, 1);
  graphics.arc(cx, cy, RING_R, 0, 180 * DEG);

  // 后弧外露段（右上，背光面）+ 内侧高光
  graphics.lineStyle(2.4, 0x7a8492, 1);
  graphics.arc(cx, cy, RING_R, -60 * DEG, 0);
  graphics.lineStyle(0.9, 0x9aa4b0, 1);
  graphics.arc(cx, cy, RING_R - 0.35, -58 * DEG, -8 * DEG);

  // 前弧四段镜面色带
  for (const seg of FRONT_SEGMENTS) {
    graphics.lineStyle(2.2, seg.color, 1);
    graphics.arc(cx, cy, RING_R, seg.a0 * DEG, seg.a1 * DEG);
  }

  // 内圈：暗内壁 + 反光亮线
  graphics.lineStyle(1.4, 0x4c545e, 1);
  graphics.arc(cx, cy, RING_INNER_R, 0, 180 * DEG);
  graphics.lineStyle(0.9, 0xaeb8c3, 1);
  graphics.arc(cx, cy, RING_INNER_R, 55 * DEG, 95 * DEG);

  // 开口缝（右下 28° 方向）
  graphics.lineStyle(1.6, 0x121824, 1);
  graphics.moveTo(cx + 3.7, cy + 2.4);
  graphics.lineTo(cx + 5.2, cy + 3.1);

  // 管口端面（两枚小亮椭圆，近似无旋转）
  graphics.lineStyle(0);
  graphics.beginFill(0xd5dce4, 1);
  graphics.drawEllipse(cx + 5.35, cy + 3.0, 0.75, 0.55);
  graphics.endFill();
  graphics.beginFill(0x9aa4b0, 1);
  graphics.drawEllipse(cx + 3.85, cy + 1.7, 0.7, 0.5);
  graphics.endFill();
}
