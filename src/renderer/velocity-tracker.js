/**
 * velocity-tracker.js — 滑动窗口速度追踪器
 *
 * 使用最近 5-10 个采样点，时间加权平均计算速度。
 * 内含限速机制（maxSpeed = 3000 px/s）。
 */

const MAX_SAMPLES = 10;
const MAX_SPEED = 3000; // px/s

export class VelocityTracker {
  constructor(maxSpeed = MAX_SPEED) {
    this.maxSpeed = maxSpeed;
    this._samples = []; // { x, y, time }
  }

  /**
   * 记录一个新的位置采样
   * @param {number} x - 像素坐标 X
   * @param {number} y - 像素坐标 Y
   * @param {number} [time] - 时间戳 (ms)，默认 performance.now()
   */
  addSample(x, y, time) {
    if (time === undefined) time = performance.now();
    this._samples.push({ x, y, time });

    // 保留最近 MAX_SAMPLES 个采样
    if (this._samples.length > MAX_SAMPLES) {
      this._samples.shift();
    }
  }

  /**
   * 计算当前速度（px/s），使用时间加权平均
   * @returns {{ vx: number, vy: number }}
   */
  getVelocity() {
    if (this._samples.length < 2) {
      return { vx: 0, vy: 0 };
    }

    let totalVx = 0;
    let totalVy = 0;
    let totalWeight = 0;

    // 对相邻采样对计算瞬时速度，按时间间隔加权
    for (let i = 1; i < this._samples.length; i++) {
      const prev = this._samples[i - 1];
      const curr = this._samples[i];
      const dt = (curr.time - prev.time) / 1000; // 秒

      if (dt <= 0) continue;

      const vx = (curr.x - prev.x) / dt;
      const vy = (curr.y - prev.y) / dt;
      const weight = dt; // 时间间隔作为权重

      totalVx += vx * weight;
      totalVy += vy * weight;
      totalWeight += weight;
    }

    if (totalWeight <= 0) {
      return { vx: 0, vy: 0 };
    }

    let vx = totalVx / totalWeight;
    let vy = totalVy / totalWeight;

    // 限速
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > this.maxSpeed) {
      const scale = this.maxSpeed / speed;
      vx *= scale;
      vy *= scale;
    }

    return { vx, vy };
  }

  /**
   * 清空所有采样
   */
  clear() {
    this._samples.length = 0;
  }

  /**
   * 获取采样数量
   */
  get sampleCount() {
    return this._samples.length;
  }
}

export default VelocityTracker;
