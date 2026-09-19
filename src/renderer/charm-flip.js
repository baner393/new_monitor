/**
 * charm-flip.js — 挂饰的 3D 翻转物理（伪 3D，2D 变换合成）
 *
 * 模型（用户确认）：挂饰是一张有厚度的双面挂牌，挂在环上。
 *   · 静置：绕挂点竖轴轻微摇摆（±8° 内），正面（原色）朝外；
 *   · 运动注入能量：甩动/快移给角速度冲量，能量大时进入翻滚纷飞
 *     （rotateY 翻过背面 + 轻微绕绳自转 spinZ），能量耗尽回静置；
 *   · 翻到侧面（|cos(spinY)|→0）露出硬币式的金属侧棱（银虹彩 + 白闪）；
 *   · 背面 = 原版精灵水平镜像（原色）；
 *   · 暗场全息箔的强度 = |sin(spinY)|（面斜/背泛起，正对消失）——与翻转统一。
 *
 * 渲染映射（2D 合成）：
 *   scaleX = cos(spinY)（负值自动镜像出背面）；侧棱在 |cos| < 0.18 时显示；
 *   spinZ 施加到容器 rotation（纷飞）。
 */

export function createFlipState() {
  return {
    spinY: 0,      // 绕竖轴角（rad；0 = 正面，±π = 背面）
    velY: 0,       // 角速度
    spinZ: 0,      // 绕绳轴自转（纷飞，rad）
    velZ: 0,
    t: 0,          // 时钟（静置摇摆用）
    energy: 0,     // 平滑运动能量 0~1
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * 物理推进。
 * @param {object} state      createFlipState()
 * @param {number} dt         秒
 * @param {number} motion     运动速度模（px/s；乌龟速度或钟摆摆速）
 * @param {number} motionDirX 运动水平方向（-1~1，冲量的方向感）
 * @returns {{energy:number, cosY:number, sideK:number}}
 */
export function updateFlip(state, dt, motion, motionDirX = 0) {
  state.t += dt;
  const energyTarget = Math.min(1, motion / 550);
  // 能量平滑上升快、衰减慢（甩一下能纷飞一阵）
  state.energy += (energyTarget - state.energy) * Math.min(1, dt * (energyTarget > state.energy ? 8 : 1.4));
  const energy = state.energy;

  // 运动冲量：速度越大、越往运动方向翻
  const impulse = energy * energy * motionDirX * dt * 30;
  state.velY += impulse;
  // 静置摇摆的弹簧（能量低时把姿态拉回小幅摇摆）
  const restTarget = Math.sin(state.t * 0.8) * 0.14;
  state.velY += (restTarget - state.spinY) * (1 - energy) * 2.4 * dt;
  state.velY *= Math.exp(-dt * 0.9);
  state.spinY += state.velY * dt;

  // spinZ 纷飞：能量高时受随机扰动激发
  if (energy > 0.55 && Math.random() < dt * 2.2) {
    state.velZ += (Math.random() - 0.5) * energy * 2.4;
  }
  state.velZ *= Math.exp(-dt * 1.7);
  state.spinZ = clamp(state.spinZ + state.velZ * dt, -0.65, 0.65);

  const cosY = Math.cos(state.spinY);
  const sideK = Math.max(0, 1 - Math.abs(cosY) / 0.18);
  return { energy, cosY, sideK };
}

/**
 * 把翻转姿态应用到渲染对象。
 * @param {object} s { body, foil, band, side, container }
 * @param {object} state
 * @param {number} baseScale  bodySprite 的基准 scale（含皮肤缩放）
 * @param {number} centerOffsetX 精灵几何中心相对挂点的 x 偏移（(0.5-grip.x)×显示宽）
 * @param {number} span       精灵显示宽度（px，光带扫动范围）
 * @param {number} motion     运动速度模（箔强度加成）
 */
export function applyFlip(s, state, baseScale, centerOffsetX, span, motion) {
  const cosY = Math.cos(state.spinY);
  const back = cosY < 0;
  const sx = Math.max(0.055, Math.abs(cosY)); // 防止完全归零（保留 1px 级窄面）

  // 正面/背面（背面水平镜像 = 原版镜像原色）
  s.body.scale.x = baseScale * sx * (back ? -1 : 1);

  // 侧棱（硬币厚度式）：接近侧对时显示，宽度随翻转角收放
  const sideK = Math.max(0, 1 - Math.abs(cosY) / 0.18);
  if (s.side) {
    s.side.visible = sideK > 0.02;
    s.side.alpha = Math.min(1, sideK * 1.2);
    s.side.width = Math.max(2, 10 * baseScale / 3 * (0.4 + sideK * 0.6));
    s.side.position.x = centerOffsetX;
    // 翻转经过侧棱的白闪（转速快时更亮）
    const speedGlow = Math.min(0.5, Math.abs(state.velY) * 0.22);
    s.side.alpha = Math.min(1, sideK * (0.85 + speedGlow));
  }

  // 暗场全息：面斜/背泛起（|sin| 峰值在侧棱两侧），运动加成
  const tilt = Math.abs(Math.sin(state.spinY));
  const glow = Math.min(1, 0.45 + state.energy * 0.55 + Math.min(0.4, Math.abs(state.velY) * 0.12));
  if (s.foil) s.foil.alpha = Math.pow(tilt, 1.05) * glow;
  if (s.band) {
    s.band.alpha = Math.pow(Math.max(0, Math.sin(state.spinY * 1.6 + 0.9)), 1.5) * tilt * glow;
    // 光带随翻转角横向扫动
    s.band.position.x = (state.spinY / Math.PI) * span * 0.8 - span * 0.4;
  }

  // 纷飞自转（容器微旋）
  if (s.container) s.container.rotation = state.spinZ * 0.55;
}
