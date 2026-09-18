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
import { clampCharmAnchor } from '../shared/anchor-model.js';

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
    this.ambientSwingEnabled = true

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
      x: 0, y: 50,       // 像素坐标 (y=50 matches anchorY compensation)
      vx: 0,             // 水平速度 (px/s)
    }

    // ── 挂饰模式（鼠标当滑轮）：锚点 = 光标 1:1，乌龟跑同一套 2D 方程 ──
    // true 时：updatePendulum/updatePulleyMomentum 由调用方跳过；
    // updateCharmStep 驱动乌龟；滑轮位置由 setCharmAnchor（光标）直接给定，
    // 滑轮惯性/摩擦/边界段不参与，screenAnchorX 保持不动（切回经典原样恢复）。
    this.charmMode = false

    // ── 甩动物理参数 ──
    this.ropeStiffness     = ROPE_STIFFNESS
    this.ropeDamping       = ROPE_DAMPING
    this.ropeBounceRest    = BOUNCE_RESTITUTION
    this.airDamping        = AIR_DAMPING
    this.ropeElasticity    = 0.02   // 左键拖拽绳子弹性（越小越松/越大越紧）

    // ── VelocityTracker 实例 ──
    this.velocityTracker = new VelocityTracker()

    // ── 内部时间累加器 ──
    this._time = 0

    // ── 外部注入的上下文（由调用者每帧设置）──
    this.state       = 'IDLE'     // 当前状态机状态
    this.windowWidth = 200        // 窗口宽度 (px)
    this.windowHeight = 400       // 窗口高度 (px)
    this.turtleSize  = 48         // 精灵大小 (px)

    // ── 碰撞状态 ──
    this._justCollided = false     // 刚发生碰撞（供外部读取后重置）
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
    this.pulley.y = 50
    this.pulley.vx = 0

    // 清空速度追踪器
    this.velocityTracker.clear()
    this.velocityTracker.addSample(mouseX, mouseY)
  }

  // ──────────────────────────────────────────
  // 右键甩动：拖拽更新
  // 绳子约束传播：乌龟移动 → 通过绳子张力拉动滑轮
  // ──────────────────────────────────────────
  updateDrag(mouseX, mouseY, dt) {
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

    if (dist > this.restRopeLength) {
      // 绳子被拉伸，计算拉伸方向的分量
      const stretch = dist - this.restRopeLength
      const nx = dx / dist
      const ny = dy / dist

      // 绳子张力通过水平分量拉动滑轮
      const tensionForce = this.ropeStiffness * stretch
      const pullForceX = tensionForce * nx

      // 滑轮受力平衡（高阻尼，跟随式）
      this.pulley.vx += pullForceX * dt
      this.pulley.vx *= Math.pow(0.85, dt * 60) // 高阻尼 (frame-rate independent)

      // 更新滑轮位置
      this.pulley.x += this.pulley.vx * dt

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

  // Cancel only pointer-owned state. Runtime settings and the current physical
  // position are intentionally preserved for renderer-local recovery.
  cancelInteraction() {
    this.turtle.dragging = false
    this.velocityTracker.clear()
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

    const turtleSpeed = this._stepTurtlePhysics(dt)

    // ── 滑轮物理 ──

    // 摩擦
    this.pulley.vx *= Math.pow(this.pulleyFriction, dt * 60)

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
    const pulleySpeed = Math.abs(this.pulley.vx)
    const totalEnergy = turtleSpeed + pulleySpeed

    return totalEnergy
  }

  // ──────────────────────────────────────────
  // 乌龟物理一步（重力 + 绳弹簧力 + 空气阻尼 + 碰撞）
  // updatePulleyPhysics（右键甩动）与挂饰模式共用；方程与原版逐行一致。
  // 返回乌龟速度模长（挂饰模式不参与滑轮，停止判定由调用方自理）。
  // ──────────────────────────────────────────
  _stepTurtlePhysics(dt) {
    // ── 乌龟物理 ──

    // 重力
    this.turtle.vy += this.gravity * dt

    // 绳子弹簧力（乌龟 → 滑轮）
    const dx = this.turtle.x - this.pulley.x
    const dy = this.turtle.y - this.pulley.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist > 0.01) {
      const stretch = dist - this.restRopeLength

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
    this.turtle.vx *= Math.pow(this.airDamping, dt * 60)
    this.turtle.vy *= Math.pow(this.airDamping, dt * 60)

    // 积分乌龟位置
    this.turtle.x += this.turtle.vx * dt
    this.turtle.y += this.turtle.vy * dt

    // ── 乌龟碰撞（窗口边界）──
    const margin = this.turtleSize / 2

    // 左右边界
    if (this.turtle.x < margin) {
      this.turtle.x = margin
      this.turtle.vx = Math.abs(this.turtle.vx) * this.ropeBounceRest
      this._justCollided = true
    }
    if (this.turtle.x > this.windowWidth - margin) {
      this.turtle.x = this.windowWidth - margin
      this.turtle.vx = -Math.abs(this.turtle.vx) * this.ropeBounceRest
      this._justCollided = true
    }

    // 底部边界
    if (this.turtle.y > this.windowHeight - margin) {
      this.turtle.y = this.windowHeight - margin
      this.turtle.vy = -Math.abs(this.turtle.vy) * this.ropeBounceRest
      this._justCollided = true
      // 地面摩擦
      this.turtle.vx *= Math.pow(0.95, dt * 60)
    }

    // 顶部边界（不应低于绳子锚点）
    if (this.turtle.y < margin) {
      this.turtle.y = margin
      this.turtle.vy = Math.abs(this.turtle.vy) * this.ropeBounceRest
      this._justCollided = true
    }

    return Math.sqrt(this.turtle.vx * this.turtle.vx + this.turtle.vy * this.turtle.vy)
  }

  // ──────────────────────────────────────────
  // 挂饰模式一步：乌龟跑同一套 2D 方程，滑轮由光标直接驱动（无惯性）。
  // 仅在 charmMode + IDLE 时生效；返回乌龟速度模长，未激活返回 undefined。
  // ──────────────────────────────────────────
  updateCharmStep(dt) {
    if (!this.charmMode || this.state !== 'IDLE') return undefined
    dt = Math.min(dt, 0.033)
    return this._stepTurtlePhysics(dt)
  }

  // ──────────────────────────────────────────
  // 挂饰模式：光标驱动滑轮（锚点）。畸形采样整点丢弃并返回 false，
  // 保持上一帧锚点——绝不让 NaN 进 pulley（NaN 会经绳弹簧污染乌龟）。
  // ──────────────────────────────────────────
  setCharmAnchor(cursor) {
    const clamped = clampCharmAnchor(cursor, this.windowWidth, this.windowHeight)
    if (!clamped) return false
    this.pulley.x = clamped.x
    this.pulley.y = clamped.y
    return true
  }

  // ──────────────────────────────────────────
  // 进入挂饰模式：乌龟从当前姿态无缝接管（弹簧自然过渡到光标下方）。
  // ──────────────────────────────────────────
  enterCharmMode({ turtleX, turtleY, cursor } = {}) {
    this.charmMode = true
    this.pendulumAngle = 0
    this.pendulumOmega = 0
    this.turtle.x = (typeof turtleX === 'number' && Number.isFinite(turtleX)) ? turtleX : this.pulley.x
    this.turtle.y = (typeof turtleY === 'number' && Number.isFinite(turtleY)) ? turtleY : this.pulley.y
    this.turtle.vx = 0
    this.turtle.vy = 0
    this.turtle.dragging = false
    this.setCharmAnchor(cursor || { x: this.pulley.x, y: this.pulley.y })
  }

  // ──────────────────────────────────────────
  // 退出挂饰模式：screenAnchorX 挂饰期间未被触碰，经典锚点原样恢复。
  // ──────────────────────────────────────────
  exitCharmMode() {
    this.charmMode = false
    this.pulley.x = this.screenAnchorX * this.windowWidth
    this.pulley.y = 50
    this.pulley.vx = 0
    this.turtle.dragging = false
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
    if (this.ambientSwingEnabled && this.state === 'IDLE')  alpha += 0.8 * Math.sin(t * 3.0)
    if (this.ambientSwingEnabled && this.state === 'HOVER') alpha += 2.0 * Math.sin(t * 4.0)

    // 欧拉积分
    this.pendulumOmega += alpha * dt
    this.pendulumOmega *= Math.pow(this.damping, dt * 60)
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
    this.pulleyMomentumVelocity *= Math.pow(this.pulleyFriction, dt * 60)

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
    this.pulley.y = 50
    this.pulley.vx = 0

    this.velocityTracker.clear()
  }
}

// ────────────────────────────────────────────
// 导出
// ────────────────────────────────────────────
export { PhysicsEngine, easeOutBack, GRAVITY, DAMPING, PULLEY_FRICTION, DEFAULT_ROPE_LENGTH, MIN_ROPE_LENGTH, MAX_ROPE_LENGTH }
export default PhysicsEngine
