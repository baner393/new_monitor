/**
 * charm-flip.js — 挂饰的 3D 翻转物理（伪 3D 薄板，全部绕「绳结点」转动）
 *
 * 模型（v2，用户 09-19 复审驱动）：挂饰是一块有厚度的双面薄板，铰接在
 * 「绳子与宠物的连接点」（容器原点 = grip 点）。三个旋转自由度都绕它：
 *   · tilt（屏幕面内）：重力链接——在挂饰的加速参考系里，等效重力
 *     g_eff = (−ax, G−ay)（重力 + 运动惯性力 + 向心力自动叠加，因为
 *     加速度差分里天然含向心分量），薄板像真实挂牌一样弹簧阻尼地摆向
 *     g_eff：静止垂直下垂、加速时滞后外甩、甩圈时被离心力掀起；
 *   · spinY（绕挂点竖轴）：甩动注入能量翻滚（背面 = 原版精灵镜像），
 *     能量耗尽回 ±8° 静置摇摆；侧棱倒下斥力防卡死（沿用 565e5fb）；
 *   · spinZ（绕绳轴自转）：能量 >55% 随机激发的纷飞 + 回正弹簧。
 *
 * 渲染映射（2D 合成，薄板厚度可见——描边不再固定）：
 *   · 面（body / 银虹彩描边 / 形状 mask）统一 scaleX = cos(spinY)，
 *     负值自动镜像出背面；
 *   · 厚度侧棱 = 宽度 thickness·|sin(spinY)| 的金属条，贴在面的外缘
 *     （computeSlab）：翻转时从面缘长出、侧对时最厚、正对消失；
 *   · 白闪：转速快时叠加 ADD 混合白条（翻过侧棱瞬间的硬币闪光）；
 *   · tilt + spinZ 施加到容器 rotation（都绕挂点）。
 */

export const HANG_GRAVITY = 800;   // 与 physics.js GRAVITY 一致（px/s²）
export const TILT_MAX = 1.15;      // 重力链接的极限张角（≈66°）

export function createFlipState() {
  return {
    spinY: 0,      // 绕竖轴角（rad；0 = 正面，±π = 背面）
    velY: 0,       // 角速度
    spinZ: 0,      // 绕绳轴自转（纷飞，rad）
    velZ: 0,
    tilt: 0,       // 重力链接铰链角（屏幕面内，0 = 垂直下垂）
    velTilt: 0,
    t: 0,          // 时钟（静置摇摆用）
    energy: 0,     // 平滑运动能量 0~1
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finiteOr = (v, fb) => (Number.isFinite(v) ? v : fb);

/**
 * 物理推进。
 * @param {object} state      createFlipState()
 * @param {number} dt         秒
 * @param {number} motion     运动速度模（px/s；乌龟速度或钟摆摆速）
 * @param {number} motionDirX 运动水平方向（-1~1，冲量的方向感）
 * @param {{x:number,y:number}|null} accel 挂饰加速度（px/s²，速度差分；
 *        null = 无重力链接（经典模式），tilt 回正）
 * @returns {{energy:number, cosY:number, sinY:number, tilt:number, sideK:number}}
 */
export function updateFlip(state, dt, motion, motionDirX = 0, accel = null) {
  state.t += dt;
  if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
  motion = finiteOr(motion, 0);
  motionDirX = finiteOr(motionDirX, 0);
  const energyTarget = Math.min(1, motion / 550);
  // 能量平滑上升快、衰减慢（甩一下能纷飞一阵）
  state.energy += (energyTarget - state.energy) * Math.min(1, dt * (energyTarget > state.energy ? 8 : 1.4));
  const energy = state.energy;

  // spinY 翻滚：速度越大、越往运动方向翻
  const impulse = energy * energy * motionDirX * dt * 30;
  state.velY += impulse;
  // 静置回正（能量低时生效）：目标 = 最近的正面圈（2π 整数倍）+ ±8° 摇摆——
  // 翻滚停在任意角度都走最短路径转回正面，而不是绕剩余圈数慢慢蹭回来
  const restTarget = Math.sin(state.t * 0.8) * 0.14;
  const home = Math.round((state.spinY - restTarget) / (Math.PI * 2)) * Math.PI * 2 + restTarget;
  state.velY += (home - state.spinY) * (1 - energy) * 2.4 * dt;
  state.velY *= Math.exp(-dt * 0.9);
  state.spinY += state.velY * dt;

  // spinZ 纷飞：能量高时受随机扰动激发
  if (energy > 0.55 && Math.random() < dt * 2.2) {
    state.velZ += (Math.random() - 0.5) * energy * 2.4;
  }
  state.velZ *= Math.exp(-dt * 1.7);
  state.velZ += -state.spinZ * 1.2 * dt; // 回正弹簧：晃完不歪着停
  state.spinZ = clamp(state.spinZ + state.velZ * dt, -0.65, 0.65);

  // 侧棱斥力（硬币立棱必倒）：倒向 = 当前旋转方向，避免在 ±90° 振荡捕获
  const cosY = Math.cos(state.spinY);
  const fall = state.velY >= 0 ? 1 : -1;
  state.velY += fall * Math.pow(1 - Math.abs(cosY), 2) * 5.5 * dt;
  const sideK = Math.max(0, 1 - Math.abs(cosY) / 0.18);

  // tilt 重力链接：加速系里的等效重力方向 + 弹簧阻尼（ω≈6.5，ζ≈0.85）
  let target = 0;
  if (accel && Number.isFinite(accel.x) && Number.isFinite(accel.y)) {
    const ax = clamp(finiteOr(accel.x, 0), -6000, 6000);
    const ay = clamp(finiteOr(accel.y, 0), -6000, 6000);
    const gx = -ax;
    const gy = HANG_GRAVITY - ay;
    if (Math.abs(gx) > 1 || Math.abs(gy) > 1) {
      target = clamp(Math.atan2(gx, gy), -TILT_MAX, TILT_MAX);
    }
  }
  state.velTilt += ((target - state.tilt) * 42 - state.velTilt * 11) * dt;
  state.tilt += state.velTilt * dt;

  return { energy, cosY, sinY: Math.sin(state.spinY), tilt: state.tilt, sideK };
}

/**
 * 薄板厚度侧棱的几何（纯函数）。
 * 面绕挂点竖轴压缩（x→x·cosY），厚度沿 sinY 方向从面的外缘长出。
 * @param {number} restL 静置时可见轮廓左缘相对挂点的 x（px，负值）
 * @param {number} restR 静置时可见轮廓右缘相对挂点的 x（px）
 * @returns {{x:number, width:number, side:number}} 容器坐标（挂点为原点）
 */
export function computeSlab(c, s, restL, restR, thickness) {
  if (![c, s, restL, restR, thickness].every(Number.isFinite)) {
    return { x: 0, width: 0, side: 1 };
  }
  const side = s >= 0 ? 1 : -1;
  const leftEdge = restL * c;
  const rightEdge = restR * c;
  const faceEdge = side > 0 ? Math.max(leftEdge, rightEdge) : Math.min(leftEdge, rightEdge);
  const width = thickness * Math.abs(s);
  return { x: faceEdge + (side * width) / 2, width, side };
}

/**
 * 把翻转姿态应用到渲染对象。
 * @param {object} s { body, mask, edge, strip, flash, foil, band, container }
 *        全部可选；mask = 形状裁剪 Sprite（与 body 同 base、同 anchor）。
 * @param {object} state
 * @param {object} o { baseScale, edgeBase, restL, restR, stripTop, stripH,
 *                     thickness, span }
 */
export function applyFlip(s, state, o) {
  const cosY = Math.cos(state.spinY);
  const sinY = Math.sin(state.spinY);
  const sgn = cosY >= 0 ? 1 : -1;
  const sx = Math.max(0.05, Math.abs(cosY));

  // 面与描边、形状 mask 一起压缩/镜像——描边随翻转收放，不再固定
  if (s.body) s.body.scale.x = o.baseScale * sx * sgn;
  if (s.mask) s.mask.scale.x = o.baseScale * sx * sgn;
  if (s.edge) s.edge.scale.x = o.edgeBase * sx * sgn;

  // 厚度侧棱（硬币式）+ 翻转白闪
  if (s.strip) {
    const sl = computeSlab(cosY, sinY, o.restL, o.restR, o.thickness);
    s.strip.visible = sl.width > 0.4;
    if (s.strip.visible) {
      s.strip.width = Math.max(1.2, sl.width);
      s.strip.height = o.stripH;
      s.strip.position.set(sl.x, o.stripTop);
      s.strip.alpha = Math.min(1, 0.55 + Math.abs(sinY) * 0.45);
      if (s.flash) {
        s.flash.visible = true;
        s.flash.width = s.strip.width;
        s.flash.height = o.stripH;
        s.flash.position.set(sl.x, o.stripTop);
        // 转速越快，翻过侧棱的硬币闪光越亮
        const speedGlow = Math.min(0.95, Math.abs(state.velY) * 0.3);
        s.flash.alpha = speedGlow * Math.min(1, Math.abs(sinY) * 1.8);
      }
    } else if (s.flash) {
      s.flash.visible = false;
    }
  }

  // 暗场全息：面斜/背泛起（|sin| 峰值在侧棱两侧），运动加成
  const tilt = Math.abs(sinY);
  const glow = Math.min(1, 0.45 + state.energy * 0.55 + Math.min(0.4, Math.abs(state.velY) * 0.12));
  if (s.foil) s.foil.alpha = Math.pow(tilt, 1.05) * glow;
  if (s.band) {
    s.band.alpha = Math.pow(Math.max(0, Math.sin(state.spinY * 1.6 + 0.9)), 1.5) * tilt * glow;
    // 光带随翻转角横向扫动
    s.band.position.x = (state.spinY / Math.PI) * o.span * 0.8 - o.span * 0.4;
  }

  // 重力链接 + 纷飞自转（都绕挂点）
  if (s.container) s.container.rotation = state.tilt + state.spinZ * 0.55;
}
