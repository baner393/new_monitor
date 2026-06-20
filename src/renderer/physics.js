/**
 * physics.js — Turtle Monitor 钟摆物理引擎
 *
 * 纯数学模块，不依赖任何 UI。
 * 使用归一化坐标 (0.0 ~ 1.0) 和物理单位。
 *
 * 核心方程: θ'' = -(g/L) * sin(θ)
 */

// ────────────────────────────────────────────
// 物理常量
// ────────────────────────────────────────────
const GRAVITY             = 800   // 重力加速度 (px/s²)
const DAMPING             = 0.995 // 阻尼系数
const DEFAULT_ROPE_LENGTH = 150   // 默认绳长 (px) - increased from 80
const MIN_ROPE_LENGTH     = 40
const MAX_ROPE_LENGTH     = 300
const PULLEY_FRICTION     = 0.92  // 滑轮摩擦系数

// ────────────────────────────────────────────
// 弹簧回弹缓动函数
// ────────────────────────────────────────────
function easeOutBack(t) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

// ────────────────────────────────────────────
// PhysicsEngine
// ────────────────────────────────────────────
class PhysicsEngine {
  constructor() {
    // ── 暴露的可调配置 ──
    this.gravity       = GRAVITY
    this.damping        = DAMPING
    this.pulleyFriction = PULLEY_FRICTION

    // ── 钟摆状态 ──
    this.pendulumAngle = 0          // θ (弧度)
    this.pendulumOmega = 0          // θ' (角速度)
    this.ropeLength    = DEFAULT_ROPE_LENGTH

    // ── 滑轮状态 ──
    this.screenAnchorX           = 0.5   // 归一化 X 锚点 (0.0 ~ 1.0)
    this.pulleyMomentumVelocity = 0      // 滑轮速度

    // ── 内部时间累加器 ──
    this._time = 0

    // ── 外部注入的上下文（由调用者每帧设置）──
    this.state       = 'IDLE'     // 当前状态机状态
    this.windowWidth = 200        // 窗口宽度 (px)
    this.turtleSize  = 48         // 精灵大小 (px)
  }

  // ──────────────────────────────────────────
  // 供调用者注入上下文（每帧之前调用）
  // ──────────────────────────────────────────
  setContext({ state, windowWidth, turtleSize }) {
    if (state !== undefined)       this.state       = state
    if (windowWidth !== undefined) this.windowWidth = windowWidth
    if (turtleSize !== undefined)  this.turtleSize  = turtleSize
  }

  // ──────────────────────────────────────────
  // 钟摆物理更新
  // ──────────────────────────────────────────
  updatePendulum(dt) {
    // Skip during PULLING (user controls) and BOUNCING (animation controls)
    if (this.state === 'PULLING' || this.state === 'BOUNCING') return

    // 安全最小绳长
    const L = Math.max(this.ropeLength, 1)

    // 计算最大偏移和最大摆角
    const maxOffset = this.windowWidth / 2 - this.turtleSize / 2 - 5
    const maxAngle  = Math.asin(Math.min(1, maxOffset / L))

    // θ'' = -(g/L) * sin(θ)
    let alpha = -(this.gravity / L) * Math.sin(this.pendulumAngle)

    // 状态相关扰动 — 让乌龟微微摇摆
    const t = this._time
    if (this.state === 'IDLE')  alpha += 0.8 * Math.sin(t * 3.0)
    if (this.state === 'HOVER') alpha += 2.0 * Math.sin(t * 4.0)

    // 欧拉积分
    this.pendulumOmega += alpha * dt
    this.pendulumOmega *= this.damping
    this.pendulumAngle += this.pendulumOmega * dt

    // 限制摆角
    this.pendulumAngle = Math.max(-maxAngle, Math.min(maxAngle, this.pendulumAngle))

    // 累加时间
    this._time += dt
  }

  // ──────────────────────────────────────────
  // 滑轮惯性更新
  // ──────────────────────────────────────────
  updatePulleyMomentum(dt) {
    if (this.state !== 'PULLEY_MOMENTUM') return

    // 运动积分（归一化坐标）
    this.screenAnchorX += this.pulleyMomentumVelocity * dt

    // 摩擦
    this.pulleyMomentumVelocity *= this.pulleyFriction

    // 边界反弹 — 像素 margin=50 转归一化
    const w = Math.max(this.windowWidth, 1)
    const margin = 50 / w
    if (this.screenAnchorX < margin) {
      this.screenAnchorX = margin
      this.pulleyMomentumVelocity = Math.abs(this.pulleyMomentumVelocity) * 0.5
    }
    if (this.screenAnchorX > 1.0 - margin) {
      this.screenAnchorX = 1.0 - margin
      this.pulleyMomentumVelocity = -Math.abs(this.pulleyMomentumVelocity) * 0.5
    }
  }

  // ──────────────────────────────────────────
  // 一次性重置
  // ──────────────────────────────────────────
  reset() {
    this.pendulumAngle = 0
    this.pendulumOmega = 0
    this.ropeLength    = DEFAULT_ROPE_LENGTH
    this.screenAnchorX = 0.5
    this.pulleyMomentumVelocity = 0
    this._time = 0
  }
}

// ────────────────────────────────────────────
// 导出
// ────────────────────────────────────────────
export { PhysicsEngine, easeOutBack, GRAVITY, DAMPING, PULLEY_FRICTION, DEFAULT_ROPE_LENGTH, MIN_ROPE_LENGTH, MAX_ROPE_LENGTH }
export default PhysicsEngine
