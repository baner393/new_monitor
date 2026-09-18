/**
 * ring-menu.js — 环形菜单（角色互换模型 + mockup 视觉规格）
 *
 * 设计文档 §1.1/§1.2/§1.5 定稿：
 *   · 按下快捷键瞬间，宠物当前位置钉死为圆心；常态 |光标−宠物| = 绳长
 *     （挂饰的钟摆恒等式）保证光标自动落在半径圆上，无需状态机切换；
 *   · 按住期间锚点被牵在圆上（方位角 = 光标相对圆心的角），宠物钉死；
 *   · 松手触发：纯角度命中（半扇区偏移消歧）+ 死区 + hover 门控 + 速率门控。
 *
 * 视觉（mockup §1.5）：#6cc8ff 青色系、dashed 双圈、扇区楔形高亮、24×24
 * 像素图标盘 r=19、追踪虚线、光标下浮层标签。开环 120ms / 收环 100ms，
 * 缩放 0.5 + 0.5×ringT 指数缓动。
 *
 * 本类不依赖 main.js——open/update/close 三段式由调用方驱动。
 */
import * as PIXI from 'pixi.js';
import {
  CursorSpeedTracker,
  HoverGate,
  RING_CANCEL_RATE,
  RING_SECTOR_RAD,
  ringAim,
  ringAngleFrom,
  ringItemAngle,
  ringPolar,
} from '../shared/ring-geometry.js';
import { RING_ACTIONS } from '../shared/ring-items.js';
import { getRingIconTexture } from './ring-icons.js';

const COLOR_CYAN = 0x6cc8ff;
const COLOR_WHITE = 0xffffff;
const COLOR_DISC = 0x0d1117;
const COLOR_LABEL_BG = 0x0d1117;
const COLOR_TRACK = 0xffffff;

const RING_OPEN_MS = 120;
const RING_CLOSE_MS = 100;
const RING_GAP_RAD = (3 * Math.PI) / 180; // 扇区间隙（视觉分隔，不影响命中）
const DISC_RADIUS = 19;
const WEDGE_INNER = 20;   // 楔形内半径偏移（R-20）
const WEDGE_OUTER = 22;   // 楔形外半径偏移（R+22）
const RING_INNER_OFFSET = 22; // 内圈半径偏移（R-22）
const OPEN_SAG = 6;       // 开环期绳的固定小垂度（mockup: 6×max(0,1-|ω|·2)，钉死时 ω=0）
const LABEL_FONT = 'bold 13px "Microsoft YaHei", "PingFang SC", sans-serif';

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 虚线圆：沿圆周画短弧段。 */
function drawDashedCircle(g, radius, dashLen, gapLen, color, alpha, width) {
  const circumference = Math.PI * 2 * radius;
  const segments = Math.max(8, Math.round(circumference / (dashLen + gapLen)));
  const step = (Math.PI * 2) / segments;
  const arc = (dashLen / circumference) * Math.PI * 2;
  g.lineStyle(width, color, alpha);
  for (let i = 0; i < segments; i++) {
    g.arc(0, 0, radius, i * step, i * step + arc);
  }
}

/** 虚线线段（追踪指引线）。 */
function drawDashedLine(g, x0, y0, x1, y1, dashLen, gapLen, color, alpha, width) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1) return;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  g.lineStyle(width, color, alpha);
  for (let d = 0; d < len; d += dashLen + gapLen) {
    const e = Math.min(d + dashLen, len);
    g.moveTo(x0 + ux * d, y0 + uy * d);
    g.lineTo(x0 + ux * e, y0 + uy * e);
  }
}

export class RingMenu {
  constructor({ getRadius }) {
    this._getRadius = getRadius; // 半径 = 绳长（挂饰 80 / 经典 150）
    this.container = new PIXI.Container();
    this.container.visible = false;

    // 层级（对齐 mockup SVG）：track < outer < inner < sectors < items
    this._track = new PIXI.Graphics();
    this._ringOuter = new PIXI.Graphics();
    this._ringInner = new PIXI.Graphics();
    this._sectors = new PIXI.Graphics();
    this._discs = new PIXI.Graphics();
    this._itemLayer = new PIXI.Container();
    this.container.addChild(this._track, this._ringOuter, this._ringInner, this._sectors, this._discs, this._itemLayer);

    this._itemSprites = RING_ACTIONS.map((item) => {
      const holder = new PIXI.Container();
      const icon = new PIXI.Sprite(getRingIconTexture(item.iconKey));
      icon.anchor.set(0.5);
      holder.addChild(icon);
      this._itemLayer.addChild(holder);
      return { holder, icon };
    });

    // 浮层标签（不随环缩放，独立挂在调用方的舞台上）
    this.labelContainer = new PIXI.Container();
    this.labelContainer.visible = false;
    this._labelBg = new PIXI.Graphics();
    this._labelText = new PIXI.Text('', {
      fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
      fontSize: 13,
      fontWeight: 'bold',
      fill: COLOR_WHITE,
    });
    this._labelText.anchor.set(0.5, 0.5);
    this.labelContainer.addChild(this._labelBg, this._labelText);

    this._holding = false;
    this._ringT = 0;
    this._center = null;
    this._anchorAngle = 0;
    this._hoverIdx = -1;
    this._fireIdx = -1;
    this._fireT = 0;
    this._gate = new HoverGate();
    this._speed = new CursorSpeedTracker();
  }

  get isOpen() {
    return this._holding;
  }

  get ringCenter() {
    return this._center;
  }

  get highlightIndex() {
    return this._hoverIdx;
  }

  /** 开环期绳锚点（圆上、光标方位角）；未开环返回 null。 */
  get ropeAnchor() {
    if (!this._holding || !this._center) return null;
    return ringPolar(this._center, this._getRadius(), this._anchorAngle);
  }

  /** 开环期绳垂度（固定小垂度，钉死时无摆动）。 */
  get openSag() {
    return OPEN_SAG;
  }

  /**
   * 开环。center 必须在按下瞬间取宠物当前位置（求值顺序：先取 center 再置
   * holding——mockup openRing 的踩坑记录）。
   */
  open(center, cursor) {
    if (this._holding || !center) return;
    this._center = { x: center.x, y: center.y };
    this._holding = true;
    this._anchorAngle = cursor ? ringAngleFrom(this._center, cursor) : 0;
    this._gate.reset();
    this._speed.reset();
    this._hoverIdx = -1;
    this.container.visible = true;
    this.container.position.set(this._center.x, this._center.y);
  }

  /**
   * 每帧推进。cursor 为最新光标（可 null——保持上一帧）。
   * @returns {{holding:boolean, anchor:{x,y}|null, highlight:number}|null}
   */
  update(dt, cursor, nowMs) {
    if (!this._holding && this._ringT <= 0) {
      if (this.container.visible) {
        this.container.visible = false;
        this.labelContainer.visible = false;
        this._center = null;
      }
      return null;
    }

    const rate = this._holding ? 1000 / RING_OPEN_MS : 1000 / RING_CLOSE_MS;
    const target = this._holding ? 1 : 0;
    this._ringT = clamp01(this._ringT + (target - this._ringT) * Math.min(1, dt * rate * 2.4));

    if (this._fireT > 0) {
      this._fireT -= (dt * 1000) / RING_CLOSE_MS;
      if (this._fireT <= 0) {
        this._fireT = 0;
        this._fireIdx = -1;
      }
    }

    if (cursor && nowMs !== undefined) {
      this._speed.feed(cursor.x, cursor.y, nowMs);
    }

    if (this._holding && cursor && this._center) {
      const dx = cursor.x - this._center.x;
      const dy = cursor.y - this._center.y;
      if (this._gate.feed(dx, dy)) {
        this._hoverIdx = ringAim(this._center, cursor).idx;
      } else {
        this._hoverIdx = -1;
      }
      this._anchorAngle = ringAngleFrom(this._center, cursor);
    } else if (!this._holding) {
      this._hoverIdx = -1;
    }

    this._draw(cursor);

    if (!this._holding && this._ringT <= 0.001) {
      this._ringT = 0;
      this.container.visible = false;
      this.labelContainer.visible = false;
      this._center = null;
    }

    return {
      holding: this._holding,
      anchor: this.ropeAnchor,
      highlight: this._hoverIdx,
    };
  }

  /**
   * 松手。@returns {{action:string|null, reason:'hit'|'dead-zone'|'mistap'|'closed', index:number}|null}
   */
  close() {
    if (!this._holding) return null;
    this._holding = false;
    const result = { action: null, reason: 'closed', index: -1 };
    if (this._hoverIdx >= 0) {
      const speed = this._speed.rate();
      if (speed > RING_CANCEL_RATE) {
        result.reason = 'mistap';
      } else {
        result.reason = 'hit';
        result.index = this._hoverIdx;
        result.action = RING_ACTIONS[this._hoverIdx].id;
        this._fireIdx = this._hoverIdx;
        this._fireT = 1;
      }
    } else {
      result.reason = 'dead-zone';
    }
    this._hoverIdx = -1;
    return result;
  }

  _draw(cursor) {
    const t = this._ringT;
    const R = this._getRadius();
    const sc = 0.5 + 0.5 * t;
    this.container.alpha = t;
    this.container.scale.set(sc);
    this.container.visible = t > 0.001;

    this._track.clear();
    if (this._holding && cursor) {
      const dx = cursor.x - this._center.x;
      const dy = cursor.y - this._center.y;
      // 追踪指引线在容器局部坐标（center 即局部原点），随容器缩放
      drawDashedLine(this._track, 0, 0, dx / sc, dy / sc, 4, 5, COLOR_TRACK, 0.2, 1);
    }

    this._ringOuter.clear();
    this._ringOuter.lineStyle(2, COLOR_WHITE, 0.3 * t);
    // dashed 外圈：dasharray "3 6"（mockup）
    drawDashedCircle(this._ringOuter, R, 3, 6, COLOR_WHITE, 0.3 * t, 2);

    this._ringInner.clear();
    // 内圈 r = R-22，dasharray "2 8"
    drawDashedCircle(this._ringInner, Math.max(1, R - RING_INNER_OFFSET), 2, 8, COLOR_WHITE, 0.11 * t, 1);

    // 扇区楔形（hover 且环已展开过半）
    this._sectors.clear();
    if (this._hoverIdx >= 0 && t > 0.3) {
      const half = (RING_SECTOR_RAD - RING_GAP_RAD) / 2;
      const a0 = ringItemAngle(this._hoverIdx) - half;
      const a1 = ringItemAngle(this._hoverIdx) + half;
      this._drawWedge(this._sectors, R, a0, a1);
    }

    // 图标盘 + 图标
    this._discs.clear();
    this._itemSprites.forEach(({ holder, icon }, i) => {
      const angle = ringItemAngle(i);
      const p = ringPolar({ x: 0, y: 0 }, R, angle);
      holder.position.set(p.x, p.y);
      const isHot = i === this._hoverIdx;
      const isFire = i === this._fireIdx;
      const groupAlpha = this._hoverIdx < 0 ? 0.75 : (isHot || isFire ? 1 : 0.35);
      holder.alpha = groupAlpha;

      this._discs.beginFill(COLOR_DISC, isHot || isFire ? 0.95 : 0.6);
      this._discs.lineStyle(1.5, isHot || isFire ? COLOR_CYAN : COLOR_WHITE, isHot || isFire ? 0.95 : 0.2);
      this._discs.drawCircle(p.x, p.y, DISC_RADIUS);
      this._discs.endFill();

      icon.scale.set(isHot || isFire ? 1.3 : 1);
    });

    // 浮层标签（光标下方 +34px，屏幕坐标，不随环缩放）
    if (this._holding && this._hoverIdx >= 0 && t > 0.3 && cursor) {
      const item = RING_ACTIONS[this._hoverIdx];
      this._labelText.text = item.label;
      const tw = this._labelText.width;
      this._labelBg.clear();
      this._labelBg.beginFill(COLOR_LABEL_BG, 0.82);
      this._labelBg.lineStyle(1, COLOR_CYAN, 0.45);
      this._labelBg.drawRoundedRect(-tw / 2 - 6, -10, tw + 12, 20, 4);
      this._labelBg.endFill();
      this.labelContainer.position.set(cursor.x, cursor.y + 34);
      this.labelContainer.alpha = t * 0.95;
      this.labelContainer.visible = true;
    } else {
      this.labelContainer.visible = false;
    }
  }

  /** 扇区楔形（R-20 → R+22）+ 高亮弧线，青色系。 */
  _drawWedge(g, R, a0, a1) {
    const r0 = Math.max(1, R - WEDGE_INNER);
    const r1 = R + WEDGE_OUTER;
    const pt = (r, a) => [Math.sin(a) * r, -Math.cos(a) * r];
    g.beginFill(COLOR_CYAN, 0.14);
    g.lineStyle(0);
    const [x0, y0] = pt(r0, a0);
    g.moveTo(x0, y0);
    // 内弧 a0→a1
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const [x, y] = pt(r0, a0 + ((a1 - a0) * i) / steps);
      g.lineTo(x, y);
    }
    const [x1, y1] = pt(r1, a1);
    g.lineTo(x1, y1);
    for (let i = steps; i >= 0; i--) {
      const [x, y] = pt(r1, a0 + ((a1 - a0) * i) / steps);
      g.lineTo(x, y);
    }
    g.closePath();
    g.endFill();

    // 高亮弧线（半径 R 上）
    g.lineStyle(2.5, COLOR_CYAN, 0.85);
    const [sx, sy] = pt(R, a0);
    g.moveTo(sx, sy);
    for (let i = 1; i <= steps; i++) {
      const [x, y] = pt(R, a0 + ((a1 - a0) * i) / steps);
      g.lineTo(x, y);
    }
  }
}
