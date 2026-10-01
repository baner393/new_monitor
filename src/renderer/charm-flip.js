/**
 * charm-flip.js — 挂饰的 3D 翻转物理（伪 3D 薄板，全部绕「绳结点」转动）
 *
 * 模型（v2，用户 09-19 复审驱动）：挂饰是一块有厚度的双面薄板，铰接在
 * 「绳子与宠物的连接点」（容器原点 = grip 点）。三个旋转自由度都绕它：
 *   · tilt（屏幕面内）：重力链接——在挂饰的加速参考系里，等效重力
 *     g_eff = (−ax, G−ay)（重力 + 运动惯性力 + 向心力自动叠加，因为
 *     加速度差分里天然含向心分量），薄板像真实挂牌一样弹簧阻尼地摆向
 *     g_eff：静止垂直下垂、加速时滞后外甩、甩圈时被离心力掀起；
 *   · spinY（绕挂点竖轴）：甩动注入能量翻滚（背面 = 独立金属背板），
 *     能量耗尽回 ±8° 静置摇摆；侧棱倒下斥力防卡死（沿用 565e5fb）；
 *   · spinZ（绕绳轴自转）：能量 >55% 随机激发的纷飞 + 回正弹簧。
 *
 * 渲染映射（2D 合成，薄板厚度可见——描边不再固定）：
 *   · 正、背面是两张独立精灵：正面显示原图，背面为同轮廓金属材质；背面沿
 *     thickness·sin(spinY) 产生横向视差；
 *   · 侧壁 = 行段网格挤出：深度 λ 处投影到 x = thickness·sinY·λ，
 *     每层覆盖完整深度区间，窄轮廓在90°也形成连续实心截面；
 *     冷银中段与两端窄倒角提供硬币厚度感；
 *   · tilt + spinZ 施加到容器 rotation（都绕挂点）。
 */

export const HANG_GRAVITY = 800;   // 与 physics.js GRAVITY 一致（px/s²）
export const TILT_MAX = 1.15;      // 重力链接的极限张角（≈66°）

/** 翻转物理的默认配置（硬编码定稿值，参数含义见 knobsToFlipConfig）。 */
export const FLIP_DEFAULTS = Object.freeze({
  impulse: 30,          // 甩动冲量系数
  spinDamping: 0.9,     // 翻滚阻尼（/s，exp 衰减率）
  idleSwayAmp: 0.14,    // 静置摇摆幅度（rad，±8°）
  energySpeed: 550,     // 能量满格所需运动速度（px/s）
  tiltStiffness: 42,    // 重力链接弹簧刚度（ω²）
  tiltDamping: 11,      // 重力链接阻尼（2ζω）
  thicknessRatio: 0.07, // 厚度 = 显示宽 × ratio（clamp 2~9px）
  flipEnabled: true,
  backMaterial: 'metal',
});

/**
 * 设置面板手感旋钮（0-100）→ 底层物理参数（纯函数）。
 * 映射故意温和：任一极端值都不会产生鬼畜或失效。
 */
export function knobsToFlipConfig(values = {}) {
  const pct = (v) => clamp(finiteOr(Number(v), 50), 0, 100) / 100;
  const energy = pct(values.charmFlipEnergy);   // 越灵敏：冲量大、满能量所需速度低
  const spin = pct(values.charmFlipSpin);       // 越长：阻尼小
  const sway = pct(values.charmIdleSway);
  const link = pct(values.charmGravityLink);
  const thick = pct(values.charmThickness);
  const tiltStiffness = 18 + link * 52;         // 18..70
  return {
    impulse: 12 + energy * 36,                  // 12..48
    spinDamping: 1.5 - spin * 1.1,              // 1.5..0.4（越长越慢衰减）
    idleSwayAmp: 0.02 + sway * 0.24,            // ±1°..±15°
    energySpeed: 720 - energy * 420,            // 720..300 px/s
    tiltStiffness,
    tiltDamping: 2 * Math.sqrt(tiltStiffness) * 0.85,
    thicknessRatio: 0.03 + thick * 0.08,        // 3%..11% 显示宽
    flipEnabled: values.charmFlipEnabled !== false,
    backMaterial: values.charmBackMaterial === 'pattern' ? 'pattern' : 'metal',
  };
}

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
 * @param {object} [cfg]      knobsToFlipConfig 输出（缺省 = FLIP_DEFAULTS）
 * @returns {{energy:number, cosY:number, sinY:number, tilt:number, sideK:number}}
 */
export function updateFlip(state, dt, motion, motionDirX = 0, accel = null, cfg = FLIP_DEFAULTS) {
  state.t += dt;
  if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
  motion = finiteOr(motion, 0);
  motionDirX = finiteOr(motionDirX, 0);
  const energyTarget = Math.min(1, motion / cfg.energySpeed);
  // 能量平滑上升快、衰减慢（甩一下能纷飞一阵）
  state.energy += (energyTarget - state.energy) * Math.min(1, dt * (energyTarget > state.energy ? 8 : 1.4));
  const energy = state.energy;

  if (cfg.flipEnabled !== false) {
    // spinY 翻滚：速度越大、越往运动方向翻
    const impulse = energy * energy * motionDirX * dt * cfg.impulse;
    state.velY += impulse;
  }
  // 静置回正（能量低时生效）：目标 = 最近的正面圈（2π 整数倍）+ 小幅摇摆——
  // 翻滚停在任意角度都走最短路径转回正面，而不是绕剩余圈数慢慢蹭回来。
  // 翻转关闭时回正始终全强（直接把姿态拉回正面）。
  const restTarget = Math.sin(state.t * 0.8) * cfg.idleSwayAmp;
  const home = Math.round((state.spinY - restTarget) / (Math.PI * 2)) * Math.PI * 2 + restTarget;
  const homeStrength = cfg.flipEnabled !== false ? (1 - energy) * 2.4 : 8;
  state.velY += (home - state.spinY) * homeStrength * dt;
  // 关闭翻转时强制更强阻尼：中途停用也能 1~2 秒内直回正面
  const spinDamping = cfg.flipEnabled !== false ? cfg.spinDamping : Math.max(cfg.spinDamping, 1.6);
  state.velY *= Math.exp(-dt * spinDamping);
  state.spinY += state.velY * dt;

  // spinZ 纷飞：能量高时受随机扰动激发（翻转关闭时不激发且快速回正）
  if (cfg.flipEnabled !== false && energy > 0.55 && Math.random() < dt * 2.2) {
    state.velZ += (Math.random() - 0.5) * energy * 2.4;
  }
  state.velZ *= Math.exp(-dt * (cfg.flipEnabled !== false ? 1.7 : 8));
  state.velZ += -state.spinZ * 1.2 * dt; // 回正弹簧：晃完不歪着停
  state.spinZ = clamp(state.spinZ + state.velZ * dt, -0.65, 0.65);

  // 侧棱斥力（硬币立棱必倒）：倒向 = 当前旋转方向，避免在 ±90° 振荡捕获
  const cosY = Math.cos(state.spinY);
  const fall = state.velY >= 0 ? 1 : -1;
  state.velY += fall * Math.pow(1 - Math.abs(cosY), 2) * 5.5 * dt;
  const sideK = Math.max(0, 1 - Math.abs(cosY) / 0.18);

  // tilt 重力链接：加速系里的等效重力方向 + 弹簧阻尼
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
  state.velTilt += ((target - state.tilt) * cfg.tiltStiffness - state.velTilt * cfg.tiltDamping) * dt;
  state.tilt += state.velTilt * dt;

  return { energy, cosY, sinY: Math.sin(state.spinY), tilt: state.tilt, sideK };
}

/**
 * 切片堆叠挤出的每层横向偏移（纯函数）。
 * 前面固定在 x=0，背面 x = thickness·sinY；第 i 层切片在
 * gap·i/(count+1)（不含两端——两端是正背面本身）。
 * @returns {number[]} 容器坐标 x 偏移数组
 */
export function sliceOffsets(s, thickness, count) {
  if (![s, thickness, count].every(Number.isFinite) || count < 1) return [];
  const gap = thickness * s;
  const out = [];
  for (let i = 1; i <= count; i++) out.push((gap * i) / (count + 1));
  return out;
}

/**
 * 闪卡各层随宠物基准缩放同步（皮肤加载与 turtleSize 改变时都要调用）。
 * body/mask 用宠物基准 scale；back/backSheen/foil/band/edge/slices 的纹理是皮肤帧 ×3
 * 预渲染，对应 scale/3。翻转每帧只接管 scale.x（cos(spinY) 压缩），
 * 本函数负责把 scale.y（和未翻转时的基准 scale.x）同步到新尺寸——
 * 纯尺寸变化绝不重建纹理。
 */
export function syncLayerScales(layers, baseScale) {
  const faceScale = baseScale;
  const texScale = baseScale / 3;
  for (const key of ['body', 'mask', 'backMask']) {
    if (layers[key]) layers[key].scale.set(faceScale, faceScale);
  }
  for (const key of ['back', 'backSheen', 'foil', 'band', 'backFoil', 'backBand', 'edge']) {
    if (layers[key]) layers[key].scale.set(texScale, texScale);
  }
  if (layers.slices) {
    for (const slice of layers.slices) slice.scale.set(texScale, texScale);
  }
}

/**
 * 把翻转姿态应用到渲染对象。
 * @param {object} s { body, back, mask, edge, slices, foil, band, container }
 *        全部可选；mask = 形状裁剪 Sprite（与 body 同 base、同 anchor）；
 *        slices = 金属剪影切片精灵数组（与面同 anchor）。
 * @param {object} state
 * @param {object} o { baseScale, edgeBase, thickness, span }
 */
export function applyFlip(s, state, o) {
  const cosY = Math.cos(state.spinY);
  const sinY = Math.sin(state.spinY);
  const sx = Math.abs(cosY);
  const frontFacing = cosY >= 0;
  // 侧面对只显示金属截面：不把正面图案强制保留成 5% 宽的条纹。
  const faceVisible = sx > 0.018;
  const gap = o.thickness * sinY;
  const patternBack = o.backMaterial === 'pattern';
  const backDirection = patternBack && !o.backPatternMirror ? 1 : -1;

  // 两张独立的面：正面在原点，背面为高分辨率金属背板，随角度产生视差。
  // 侧对时两者都收窄，把可见面积交给两面间的侧棱带。
  if (s.body) {
    s.body.scale.x = o.baseScale * sx;
    s.body.visible = frontFacing && faceVisible;
  }
  if (s.back) {
    s.back.scale.x = backDirection * (patternBack ? o.baseScale : o.edgeBase) * sx;
    s.back.scale.y = patternBack ? o.baseScale : o.edgeBase;
    s.back.position.x = gap;
    s.back.visible = !frontFacing && faceVisible;
    const silver = Math.round(218 + 37 * Math.max(0, -cosY * 0.8 + sinY * 0.35));
    s.back.tint = patternBack ? 0xffffff : (silver << 16) | (silver << 8) | silver;
  }
  if (s.backSheen) {
    s.backSheen.scale.x = -o.edgeBase * sx;
    s.backSheen.position.x = gap;
    s.backSheen.visible = !patternBack && !frontFacing && faceVisible;
    // 光泽由朝向决定，不因转速或全息开关产生白闪。
    const reflection = Math.max(0, Math.cos(state.spinY - Math.PI - 0.45 + state.tilt * 0.6));
    s.backSheen.alpha = 0.12 + Math.pow(reflection, 6) * 0.5;
  }
  if (s.mask) s.mask.scale.x = o.baseScale * sx;
  if (s.backMask) {
    s.backMask.scale.x = backDirection * o.baseScale * sx;
    s.backMask.position.x = gap;
  }
  if (s.edge) {
    s.edge.scale.x = o.edgeBase * sx * (frontFacing ? 1 : backDirection);
    s.edge.position.x = frontFacing ? 0 : gap;
    s.edge.visible = faceVisible;
  }

  // 每层覆盖一个完整深度区间；行段四边形随投影变形，90°时仍连续实心。
  const gapW = Math.abs(gap);
  if (s.slices) {
    const on = gapW > 0.01;
    for (let i = 0; i < s.slices.length; i++) {
      const sl = s.slices[i];
      sl.visible = on;
      if (on) {
        const direction = frontFacing ? 1 : backDirection;
        const halfBand = gapW / (2 * s.slices.length);
        if (sl.slabVertices) {
          sl.scale.x = o.edgeBase * direction;
          for (let j = 0; j < sl.vertices.length; j += 2) {
            const left = j % 8 === 0 || j % 8 === 6;
            sl.vertices[j] = sl.slabVertices[j] * sx
              + (left ? -1 : 1) * halfBand / o.edgeBase;
          }
        } else {
          sl.scale.x = o.edgeBase * Math.max(gapW / (s.slices.length * o.span), sx) * direction;
        }
        sl.position.x = gap * (i + 0.5) / s.slices.length;
        const depth = (i + 0.5) / s.slices.length;
        const bevel = depth < 0.08 || depth > 0.92;
        const lightDepth = sinY >= 0 ? depth : 1 - depth;
        const shade = bevel ? (lightDepth < 0.08 ? 1 : 0.78)
          : 0.88 + 0.07 * Math.sin(lightDepth * Math.PI);
        const value = Math.round(shade * 255);
        sl.tint = (value << 16) | (value << 8) | value;
      }
    }
  }

  // 暗场全息：偏航翻转或屏幕面内倾斜都可触发；±28° 倾斜达到全强。
  const tilt = Math.abs(sinY);
  const holoK = Math.max(tilt, clamp(Math.abs(state.tilt) / 0.49, 0, 1));
  const glow = Math.min(1, 0.45 + state.energy * 0.55 + Math.min(0.4, Math.abs(state.velY) * 0.12));
  if (s.foil) {
    s.foil.visible = frontFacing && faceVisible;
    s.foil.scale.x = o.edgeBase * sx;
    s.foil.alpha = Math.pow(holoK, 1.05) * glow;
  }
  if (s.band) {
    s.band.visible = frontFacing && faceVisible;
    // spinY 会累计多圈；光带的位置只取当前一圈，否则几次翻滚就会永远
    // 扫到宠物数百像素外，倾角反光虽然已触发却完全看不见。
    const visualSpin = Math.atan2(sinY, cosY);
    const sweep = 0.5 + 0.5 * Math.sin(visualSpin * 1.6 + state.tilt * 1.8 + 0.9);
    // 倾角达到门槛时始终保留可见的光带，sweep 只调制其明暗，不能把它归零。
    s.band.alpha = (0.25 + sweep * 0.75) * holoK * glow;
    // 光带随当前翻转面和重力倾角共同横向扫动。
    // band 纹理宽度为 2×span，主亮带在纹理 60% 处；-1.2×span 把它
    // 对齐宠物中心。此前 -0.4×span 会令主亮带落到 mask 外，被完全裁掉。
    s.band.position.x = (visualSpin / Math.PI) * o.span * 0.8
      + (state.tilt / 0.49) * o.span * 0.25 - o.span * 1.2;
  }

  // 图案背面有自己的 mask 与反光，正面 mask 不参与背面视差。
  if (s.backFoil) {
    s.backFoil.visible = patternBack && !frontFacing && faceVisible;
    s.backFoil.scale.x = backDirection * o.edgeBase * sx;
    s.backFoil.position.x = gap;
    s.backFoil.alpha = Math.pow(holoK, 1.05) * glow;
  }
  if (s.backBand) {
    s.backBand.visible = patternBack && !frontFacing && faceVisible;
    const backSpin = Math.atan2(-sinY, -cosY);
    const sweep = 0.5 + 0.5 * Math.sin(backSpin * 1.6 + state.tilt * 1.8 + 0.9);
    s.backBand.alpha = (0.25 + sweep * 0.75) * holoK * glow;
    s.backBand.position.x = gap + backDirection * ((backSpin / Math.PI) * o.span * 0.8
      + (state.tilt / 0.49) * o.span * 0.25 - o.span * 1.2);
    s.backBand.scale.x = backDirection * o.edgeBase;
  }

  // 重力链接 + 纷飞自转（都绕挂点）
  if (s.container) s.container.rotation = state.tilt + state.spinZ * 0.55;
}
