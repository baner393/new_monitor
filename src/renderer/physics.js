/**
 * physics.js — Turtle Monitor 钟摆物理引擎 + 乌龟驱动滑轮物理
 *
 * 纯数学模块，不依赖任何 UI。
 * 使用归一化坐标 (0.0 ~ 1.0) 和物理单位。
 *
 * 核心方程: θ'' = -(g/L) * sin(θ)
 *
 * 新增：右键甩动模式 — 乌龟被鼠标拖拽，通过绳子弹簧力驱动滑轮
 */

import { VelocityTracker } from './velocity-tracker.js';

// ────────────────────────────────────────────
// 物理常量
// ────────────────────────────────────────────
const GRAVITY             = 800   // 重力加速度 (px/s²)
const DAMPING             = 0.995 // 阻尼系数
const DEFAULT_ROPE_LENGTH = 150   // 默认绳长 (px)
const MIN_ROPE_LENGTH     = 40
const MAX_ROPE_LENGTH     = 300
const PULLEY_FRICTION     = 0.92  // 滑轮摩擦系数

// 新增：甩动物理参数
const ROPE_STIFFNESS      = 500   // 绳子弹簧刚度
const ROPE_DAMPING        = 15    // 绳子弹簧阻尼
const BOUNCE_RESTITUTION  = 0.6   // 碰撞恢复系数
const AIR_DAMPING         = 0.98  // 空气阻尼

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
    this.restRopeLength = DEFAULT_ROPE_LENGTH  // 用户设置的静止绳长（不被动画修改）

    // ── 滑轮状态 ──
    this.screenAnchorX           = 0.5   // 归一化 X 锚点 (0.0 ~ 1.0)
    this.pulleyMomentumVelocity = 0      // 滑轮速度

    // ── 乌龟状态（右键甩动模式）──
    this.turtle = {
      x: 0, y: 0,      // 像素坐标
      vx: 0, vy: 0,     // 速度 (px/s)
      dragging: false,   // 是否被拖拽中
    }

    // ── 滑轮状态（右键甩动模式）──
    this.pulley = {
      x: 0, y: 0,       // 像素坐标
      vx: 0,             // 水平速度 (px/s)
    }

    // ── 甩动物理参数 ──
    this.ropeStiffness     = ROPE_STIFFNESS
    this.ropeDamping       = ROPE_DAMPING
    this.ropeBounceRest    = BOUNCE_RESTITUTION
    this.airDamping        = AIR_DAMPING

    // ── VelocityTracker 实例 ──
    this.velocityTracker = new VelocityTracker()

    // ── 内部时间累加器 ──
    this._time = 0

    // ── 外部注入的上下文（由调用者每帧设置）──
    this.state       = 'IDLE'     // 当前状态机状态
    this.windowWidth = 200        // 窗口宽度 (px)
    this.windowHeight = 400       // 窗口高度 (px)
    this.turtleSize  = 48         // 精灵大小 (px)
  }

  // ──────────────────────────────────────────
  // 供调用者注入上下文（每帧之前调用）
  // ──────────────────────────────────────────
  setContext({ state, windowWidth, windowHeight, turtleSize }) {
    if (state !== undefined)        this.state        = state
    if (windowWidth !== undefined)  this.windowWidth  = windowWidth
    if (windowHeight !== undefined) this.windowHeight = windowHeight
    if (turtleSize !== undefined)   this.turtleSize   = turtleSize
  }

  // ──────────────────────────────────────────
  // 右键甩动：开始拖拽
  // ──────────────────────────────────────────
  startDrag(mouseX, mouseY) {
    // 乌龟跟随鼠标
    this.turtle.x = mouseX
    this.turtle.y = mouseY
    this.turtle.vx = 0
    this.turtle.vy = 0
    this.turtle.dragging = true

    // 初始化滑轮位置（锚点）
    this.pulley.x = this.screenAnchorX * this.windowWidth
    this.pulley.y = 0
    this.pulley.vx = 0

    // 清空速度追踪器
    this.velocityTracker.clear()
    this.velocityTracker.addSample(mouseX, mouseY)
  }

  // ──────────────────────────────────────────
  // 右键甩动：拖拽更新
  // 绳子约束传播：乌龟移动 → 通过绳子张力拉动滑轮
  // ──────────────────────────────────────────
  updateDrag(mouseX, mouseY) {
    if (!this.turtle.dragging) return

    // 记录采样
    this.velocityTracker.addSample(mouseX, mouseY)

    // 乌龟位置跟随鼠标
    this.turtle.x = mouseX
    this.turtle.y = mouseY

    // 绳子约束传播到滑轮
    const dx = this.turtle.x - this.pulley.x
    const dy = this.turtle.y - this.pulley.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist > DEFAULT_ROPE_LENGTH) {
      // 绳子被拉伸，计算拉伸方向的分量
      const stretch = dist - DEFAULT_ROPE_LENGTH
      const nx = dx / dist
      const ny = dy / dist

      // 绳子张力通过水平分量拉动滑轮
      const tensionForce = this.ropeStiffness * stretch
      const pullForceX = tensionForce * nx

      // 滑轮受力平衡（高阻尼，跟随式）
      this.pulley.vx += pullForceX * 0.016 // 假设 ~60fps 的 dt
      this.pulley.vx *= 0.85 // 高阻尼

      // 更新滑轮位置
      this.pulley.x += this.pulley.vx * 0.016

      // 滑轮边界约束
      const margin = 50
      this.pulley.x = Math.max(margin, Math.min(this.windowWidth - margin, this.pulley.x))
    }
  }

  // ──────────────────────────────────────────
  // 右键甩动：释放
  // 鼠标速度传递给乌龟
  // ──────────────────────────────────────────
  release() {
    if (!this.turtle.dragging) return

    this.turtle.dragging = false

    // 获取鼠标速度传递给乌龟
    const { vx, vy } = this.velocityTracker.getVelocity()
    this.turtle.vx = vx
    this.turtle.vy = vy

    // 更新归一化锚点
    this.screenAnchorX = this.pulley.x / this.windowWidth
  }

  // ──────────────────────────────────────────
  // 右键甩动物理模拟
  // 乌龟：重力 + 绳子弹簧力 + 空气阻尼 + 碰撞
  // 滑轮：绳子水平分量驱动 + 摩擦
  // ──────────────────────────────────────────
  updatePulleyPhysics(dt) {
    if (this.state !== 'PULLEY_PHYSICS') return

    // 安全 dt
    dt = Math.min(dt, 0.033) // 最大 33ms

    // ── 乌龟物理 ──

    // 重力
    this.turtle.vy += this.gravity * dt

    // 绳子弹簧力（乌龟 → 滑轮）
    const dx = this.turtle.x - this.pulley.x
    const dy = this.turtle.y - this.pulley.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist > 0.01) {
      const stretch = dist - DEFAULT_ROPE_LENGTH

      if (stretch > 0) {
        // 绳子被拉伸 → 弹簧力
        const nx = dx / dist
        const ny = dy / dist

        const springForce = this.ropeStiffness * stretch

        // 阻尼力（沿绳子方向的速度分量）
        const relVx = this.turtle.vx - this.pulley.vx
        const relVy = this.turtle.vy - 0 // 滑轮无垂直速度
        const relVn = relVx * nx + relVy * ny
        const dampForce = this.ropeDamping * relVn

        const totalForce = springForce + dampForce

        // 施加到乌龟（反方向）
        this.turtle.vx -= totalForce * nx * dt
        this.turtle.vy -= totalForce * ny * dt

        // 施加水平分量到滑轮（正方向，但滑轮质量大所以力小）
        this.pulley.vx += totalForce * nx * dt * 0.3

        // 如果绳子松弛（stretch < 0），施加微弱拉力保持绳长
      } else if (stretch < -5) {
        // 绳子松弛过多，施加微弱收缩力
        const nx = dx / dist
        const ny = dy / dist
        const slackForce = this.ropeStiffness * 0.1 * stretch
        this.turtle.vx -= slackForce * nx * dt
        this.turtle.vy -= slackForce * ny * dt
      }
    }

    // 空气阻尼
    this.turtle.vx *= this.airDamping
    this.turtle.vy *= this.airDamping

    // 积分乌龟位置
    this.turtle.x += this.turtle.vx * dt
    this.turtle.y += this.turtle.vy * dt

    // ── 乌龟碰撞（窗口边界）──
    const margin = this.turtleSize / 2

    // 左右边界
    if (this.turtle.x < margin) {
      this.turtle.x = margin
      this.turtle.vx = Math.abs(this.turtle.vx) * this.ropeBounceRest
    }
    if (this.turtle.x > this.windowWidth - margin) {
      this.turtle.x = this.windowWidth - margin
      this.turtle.vx = -Math.abs(this.turtle.vx) * this.ropeBounceRest
    }

    // 底部边界
    if (this.turtle.y > this.windowHeight - margin) {
      this.turtle.y = this.windowHeight - margin
      this.turtle.vy = -Math.abs(this.turtle.vy) * this.ropeBounceRest
      // 地面摩擦
      this.turtle.vx *= 0.95
    }

    // 顶部边界（不应低于绳子锚点）
    if (this.turtle.y < margin) {
      this.turtle.y = margin
      this.turtle.vy = Math.abs(this.turtle.vy) * this.ropeBounceRest
    }

    // ── 滑轮物理 ──

    // 摩擦
    this.pulley.vx *= this.pulleyFriction

    // 积分滑轮位置
    this.pulley.x += this.pulley.vx * dt

    // 滑轮边界
    const pulleyMargin = 50
    if (this.pulley.x < pulleyMargin) {
      this.pulley.x = pulleyMargin
      this.pulley.vx = Math.abs(this.pulley.vx) * 0.5
    }
    if (this.pulley.x > this.windowWidth - pulleyMargin) {
      this.pulley.x = this.windowWidth - pulleyMargin
      this.pulley.vx = -Math.abs(this.pulley.vx) * 0.5
    }

    // 更新归一化锚点
    this.screenAnchorX = this.pulley.x / this.windowWidth

    // ── 停止检测 ──
    const turtleSpeed = Math.sqrt(this.turtle.vx * this.turtle.vx + this.turtle.vy * this.turtle.vy)
    const pulleySpeed = Math.abs(this.pulley.vx)
    const totalEnergy = turtleSpeed + pulleySpeed

    return totalEnergy
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
    this.restRopeLength = DEFAULT_ROPE_LENGTH
    this.screenAnchorX = 0.5
    this.pulleyMomentumVelocity = 0
    this._time = 0

    // 重置乌龟和滑轮
    this.turtle.x = 0
    this.turtle.y = 0
    this.turtle.vx = 0
    this.turtle.vy = 0
    this.turtle.dragging = false

    this.pulley.x = 0
    this.pulley.y = 0
    this.pulley.vx = 0

    this.velocityTracker.clear()
  }
}

// ────────────────────────────────────────────
// 导出
// ────────────────────────────────────────────
export { PhysicsEngine, easeOutBack, GRAVITY, DAMPING, PULLEY_FRICTION, DEFAULT_ROPE_LENGTH, MIN_ROPE_LENGTH, MAX_ROPE_LENGTH }
export default PhysicsEngine
