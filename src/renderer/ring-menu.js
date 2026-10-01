/**
 * ring-menu.js — 环形菜单（宠物在圆心，真实绳子承担方向提示）
 *
 * 设计文档 §1.1/§1.2/§1.5 定稿：
 *   · 按下快捷键瞬间，宠物当前位置钉死为圆心；常态 |光标−宠物| = 绳长
 *     （挂饰的钟摆恒等式）保证光标自动落在半径圆上，无需状态机切换；
 *   · 按住期间根据光标相对圆心的角度判定方向，宠物钉死；经典模式
 *     的绳锚点投到物理绳长圆上，挂饰模式由调用方使用真实挂环位置；
 *   · 松手触发：纯角度命中（半扇区偏移消歧）+ 死区 + hover 门控 + 速率门控。
 *
 * 视觉：方案 A 轻轨环。静态几何仅在半径变化时重建。
 *
 * 本类不依赖 main.js——open/update/close 三段式由调用方驱动。
 */
import * as PIXI from 'pixi.js';
import {
  CursorSpeedTracker,
  HoverGate,
  RING_CANCEL_RATE,
  clampRingCenter,
  ringAim,
  ringAngleFrom,
  ringItemAngle,
  ringPolar,
} from '../shared/ring-geometry.js';
import { RING_ACTIONS } from '../shared/ring-items.js';
import { getRingIconTexture, preloadRingIconTextures } from './ring-icons.js';

const COLOR_CYAN = 0x78dcff;
const COLOR_WHITE = 0xe2f8ff;
const COLOR_LABEL_TEXT = 0xe7f8ff;
const COLOR_LABEL_BG = 0x193544;

const RING_OPEN_MS = 270;
const RING_CLOSE_MS = 150;
const FIRE_MS = 120;
const DISC_RADIUS = 24;
const DISC_TEXTURE_PADDING = 40; // 16px 柔影及 5px 下移的尾部留白。
const BAND_HALF_WIDTH = 25;
const MIN_VISUAL_RADIUS = 151; // HTML A；短绳也保持九个按钮的呼吸空间。
const DETAIL_RESOLUTION = 3; // 只提高轮盘贴图密度，保留全局像素画采样设置。
const MAX_TEXTURE_EDGE = 1536; // 限制极大绳长时环纹理的显存占用。
const OPEN_SAG = 6;       // 开环期绳的固定小垂度（mockup: 6×max(0,1-|ω|·2)，钉死时 ω=0）

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeOut(t) { return 1 - (1 - t) ** 3; }

function visualRadius(physicalRadius, petClearance = 0) {
  return Math.max(MIN_VISUAL_RADIUS, physicalRadius,
    Number.isFinite(petClearance) ? petClearance : 0);
}

function drawDisc(g, hot) {
  g.clear();
  // 无 renderer 时的 Graphics 后备：分层软影，不增加原型没有的亮弧。
  const shadowAlpha = hot ? 0x66 / 255 : 0x44 / 255;
  for (let i = 0; i < 8; i += 1) {
    g.beginFill(0x000000, 1 - (1 - shadowAlpha) ** (1 / 8));
    g.drawCircle(0, 5, DISC_RADIUS + 16 * (1 - i / 8));
    g.endFill();
  }
  if (hot) {
    g.beginFill(0x5cc9f6, 0x22 / 255);
    g.drawCircle(0, 0, DISC_RADIUS + 4);
    g.endFill();
  }
  g.lineStyle(1, hot ? 0x9be8ff : 0x8eb9ca, hot ? 1 : 0x6b / 255);
  g.beginFill(hot ? 0x28596d : 0x172e3b, 1);
  g.drawCircle(0, 0, DISC_RADIUS - 0.5);
  g.endFill();
}

function createDiscTexture(hot) {
  const edge = DISC_RADIUS + DISC_TEXTURE_PADDING;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = edge * 2 * DETAIL_RESOLUTION;
  const ctx = canvas.getContext('2d');
  ctx.scale(DETAIL_RESOLUTION, DETAIL_RESOLUTION);
  ctx.translate(edge, edge);
  // Canvas 的 shadowBlur/Offset 不随 CTM 缩放，显式转成纹理像素。
  ctx.shadowColor = hot ? '#0006' : '#0004';
  ctx.shadowBlur = 16 * DETAIL_RESOLUTION;
  ctx.shadowOffsetY = 5 * DETAIL_RESOLUTION;
  ctx.fillStyle = hot ? '#28596d' : '#172e3b';
  ctx.beginPath();
  ctx.arc(0, 0, DISC_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  if (hot) {
    ctx.fillStyle = '#5cc9f622';
    ctx.beginPath();
    ctx.arc(0, 0, DISC_RADIUS + 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = hot ? '#28596d' : '#172e3b';
  ctx.strokeStyle = hot ? '#9be8ff' : '#8eb9ca6b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, DISC_RADIUS - 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  return PIXI.Texture.from(canvas, {
    resolution: DETAIL_RESOLUTION,
    scaleMode: PIXI.SCALE_MODES.LINEAR,
  });
}

export class RingMenu {
  constructor({ getRadius, getViewport, getPetClearance, renderer, reducedMotion = false }) {
    this._getRadius = getRadius; // 物理绳长（挂饰 80 / 经典 150），视觉半径另设下限。
    this._getViewport = getViewport;
    this._getPetClearance = getPetClearance;
    this._reducedMotion = reducedMotion;
    this._renderer = renderer;
    preloadRingIconTextures();
    this.backgroundContainer = new PIXI.Container();
    this.backgroundContainer.visible = false;
    this.container = new PIXI.Container();
    this.container.visible = false;

    // 连续环带、独立短弧和九个图标节点。
    this._band = new PIXI.Graphics();
    this._selectionArc = new PIXI.Graphics();
    this._bandDisplay = renderer ? new PIXI.Sprite(PIXI.Texture.EMPTY) : this._band;
    this._selectionArcDisplay = renderer ? new PIXI.Sprite(PIXI.Texture.EMPTY) : this._selectionArc;
    if (renderer) {
      this._bandDisplay.anchor.set(0.5);
      this._selectionArcDisplay.anchor.set(0.5);
    }
    this._bandTexture = null;
    this._arcTexture = null;
    this._itemLayer = new PIXI.Container();
    this.backgroundContainer.addChild(this._bandDisplay);
    this.container.addChild(this._selectionArcDisplay, this._itemLayer);

    // 小圆盘仅有冷/热两态，预生成两张纹理，hover 时只换贴图。
    this._discTextures = renderer ? [false, true].map(createDiscTexture) : null;

    this._itemSprites = RING_ACTIONS.map((item) => {
      const holder = new PIXI.Container();
      const disc = renderer ? new PIXI.Sprite(this._discTextures[0]) : new PIXI.Graphics();
      if (renderer) disc.anchor.set(0.5);
      else drawDisc(disc, false);
      const icon = new PIXI.Sprite(getRingIconTexture(item.iconKey));
      icon.anchor.set(0.5);
      holder.addChild(disc, icon);
      this._itemLayer.addChild(holder);
      return { holder, disc, icon, hot: false };
    });

    // 浮层标签（不随环缩放，独立挂在调用方的舞台上）
    this.labelContainer = new PIXI.Container();
    this.labelContainer.visible = false;
    this._labelBg = new PIXI.Graphics();
    this._labelBgDisplay = renderer ? new PIXI.Sprite(PIXI.Texture.EMPTY) : this._labelBg;
    this._labelBgTexture = null;
    if (renderer) this._labelBgDisplay.anchor.set(0.5);
    this._labelText = new PIXI.Text('', {
      fontFamily: 'Microsoft YaHei UI, PingFang SC, Noto Sans CJK SC, sans-serif',
      fontSize: 13,
      fontWeight: 'bold',
      fill: COLOR_LABEL_TEXT,
      letterSpacing: 0.52,
    });
    this._labelText.anchor.set(0.5, 0.5);
    this._labelText.resolution = DETAIL_RESOLUTION;
    this._labelText.texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
    this.labelContainer.addChild(this._labelBgDisplay, this._labelText);

    this._holding = false;
    this._ringT = 0;
    this._nodeOpenMs = 0;
    this._center = null;
    this._anchorAngle = 0;
    this._hoverIdx = -1;
    this._fireIdx = -1;
    this._fireT = 0;
    this._arcAngle = 0;
    this._arcVisible = false;
    this._gate = new HoverGate();
    this._speed = new CursorSpeedTracker();

    this._geometryRadius = null;
    this._labelTextValue = null;
  }

  _rasterize(graphics, region) {
    const resolution = Math.min(DETAIL_RESOLUTION,
      MAX_TEXTURE_EDGE / Math.max(region.width, region.height));
    return this._renderer.generateTexture(graphics, {
      region,
      resolution,
      multisample: PIXI.MSAA_QUALITY.MEDIUM,
      scaleMode: PIXI.SCALE_MODES.LINEAR,
    });
  }

  _replaceTexture(display, key, source, region) {
    if (!this._renderer) return;
    const next = this._rasterize(source, region);
    display.texture = next;
    this[key]?.destroy(true);
    this[key] = next;
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
    if ((!this._holding && this._ringT <= 0) || !this._center) return null;
    return ringPolar(this._center, this._getRadius(), this._anchorAngle);
  }

  /** 开环期绳垂度（固定小垂度，钉死时无摆动）。 */
  get openSag() {
    return OPEN_SAG;
  }

  setReducedMotion(value) {
    this._reducedMotion = Boolean(value);
  }

  /**
   * 开环。center 必须在按下瞬间取宠物当前位置（求值顺序：先取 center 再置
   * holding——mockup openRing 的踩坑记录）。
   */
  open(center, cursor) {
    if (this._holding || !center) return;
    const radius = visualRadius(Math.max(0, this._getRadius()), this._getPetClearance?.());
    const viewport = this._getViewport?.() || { width: center.x * 2, height: center.y * 2 };
    const petBottom = Math.max(0, (this._getPetClearance?.() || 0) - 36);
    const labelHeight = (this._labelText?.height || 15) + 18;
    // 大宠物标签最远落在底部按钮以下，连同柔影留白一起预留。
    const needsLabelClearance = petBottom + labelHeight / 2 + 8 > 96;
    const edgeMargin = needsLabelClearance
      ? Math.max(radius + 28, radius + DISC_RADIUS + 8 + labelHeight + 52)
      : radius + 28; // 外导线 R+26 与抗锯齿留白。
    this._center = clampRingCenter(center, viewport.width, viewport.height, edgeMargin);
    this._holding = true;
    this._nodeOpenMs = 0;
    this._anchorAngle = cursor ? ringAngleFrom(this._center, cursor) : 0;
    this._gate.reset();
    this._speed.reset();
    this._hoverIdx = -1;
    this._fireIdx = -1;
    this._fireT = 0;
    this._arcVisible = false;
    this.backgroundContainer.visible = true;
    this.container.visible = true;
    this.backgroundContainer.position.set(this._center.x, this._center.y);
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
        this.backgroundContainer.visible = false;
        this.labelContainer.visible = false;
        this._center = null;
      }
      return null;
    }

    const target = this._holding ? 1 : 0;
    const duration = this._holding ? RING_OPEN_MS : RING_CLOSE_MS;
    this._ringT = this._reducedMotion ? target : clamp01(this._ringT + (target ? 1 : -1) * dt * 1000 / duration);
    this._nodeOpenMs = this._reducedMotion ? 372 * target
      : Math.max(0, Math.min(372, (this._nodeOpenMs || 0) + (target ? 1 : -1) * dt * 1000));

    if (this._fireT > 0) {
      this._fireT -= (dt * 1000) / FIRE_MS;
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

    this._draw(cursor, dt);

    if (!this._holding && this._ringT <= 0) {
      this._ringT = 0;
      this.container.visible = false;
      this.backgroundContainer.visible = false;
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

  _draw(cursor, dt = 0) {
    const t = this._ringT;
    const R = visualRadius(Math.max(0, this._getRadius()), this._getPetClearance?.());
    const scaleProgress = this._reducedMotion ? t : easeOut(t);
    const progress = this._holding && !this._reducedMotion
      ? easeOut(clamp01((this._nodeOpenMs ?? t * RING_OPEN_MS) / 145)) : scaleProgress;
    this.backgroundContainer.alpha = progress;
    const scale = (this._holding ? 0.96 : 0.97) + (this._holding ? 0.04 : 0.03) * scaleProgress;
    this.backgroundContainer.scale.set(scale);
    this.backgroundContainer.visible = progress > 0;
    this.container.alpha = progress;
    this.container.scale.set(scale);
    this.container.visible = progress > 0;

    if (this._geometryRadius !== R) {
      this._band.clear();
      // HTML A: 深色整圆底板、50px 中轨、轨内独立细圆线、外侧细圆线。
      // 整个底盘在宠物下层，上层只绘制选中弧和按钮。
      this._band.lineStyle(1, 0x46657a, 0.45);
      this._band.beginFill(0x10212c, 0.76);
      this._band.drawCircle(0, 0, R);
      this._band.endFill();
      this._band.lineStyle(BAND_HALF_WIDTH * 2, 0x28485a, 0.78);
      this._band.drawCircle(0, 0, R);
      this._band.lineStyle(1, 0x78b5d0, 0.22);
      this._band.drawCircle(0, 0, Math.max(1, R - 32));
      this._band.lineStyle(1, 0x7aacc3, 0.30);
      this._band.drawCircle(0, 0, R + 26);
      this._replaceTexture(this._bandDisplay, '_bandTexture', this._band,
        new PIXI.Rectangle(-R - 28, -R - 28, (R + 28) * 2, (R + 28) * 2));

      this._selectionArc.clear();
      const arcStart = -Math.PI / 2;
      for (const [width, alpha] of [[15, 0.045], [9, 0.10], [5, 0.24], [4, 1]]) {
        this._selectionArc.lineStyle({ width, color: COLOR_CYAN, alpha, cap: PIXI.LINE_CAP.ROUND });
        this._selectionArc.moveTo(Math.cos(arcStart) * R, Math.sin(arcStart) * R);
        this._selectionArc.arc(0, 0, R, arcStart, arcStart + 51 / R);
      }
      if (this._renderer && typeof document !== 'undefined') {
        const edge = R + 16;
        const resolution = Math.min(DETAIL_RESOLUTION, MAX_TEXTURE_EDGE / Math.ceil(edge * 2));
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = Math.ceil(edge * 2 * resolution);
        const ctx = canvas.getContext('2d');
        ctx.scale(resolution, resolution);
        ctx.translate(canvas.width / (2 * resolution), canvas.height / (2 * resolution));
        ctx.strokeStyle = '#78dcff';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.shadowColor = '#68cfff9c';
        ctx.shadowBlur = 5 * resolution;
        ctx.beginPath();
        ctx.arc(0, 0, R, arcStart, arcStart + 51 / R);
        ctx.stroke();
        const texture = PIXI.Texture.from(canvas, { resolution, scaleMode: PIXI.SCALE_MODES.LINEAR });
        this._selectionArcDisplay.texture = texture;
        this._arcTexture?.destroy(true);
        this._arcTexture = texture;
      } else {
        this._replaceTexture(this._selectionArcDisplay, '_arcTexture', this._selectionArc,
          new PIXI.Rectangle(-R - 10, -R - 10, (R + 10) * 2, (R + 10) * 2));
      }
      this._itemSprites.forEach((node, i) => {
        const p = ringPolar({ x: 0, y: 0 }, R, ringItemAngle(i));
        node.target = p;
      });
      this._geometryRadius = R;
    }

    const selected = this._hoverIdx >= 0 ? this._hoverIdx : this._fireIdx;
    if (selected >= 0) {
      const targetAngle = ringItemAngle(selected);
      if (!this._arcVisible || this._reducedMotion) this._arcAngle = targetAngle;
      else {
        const delta = Math.atan2(Math.sin(targetAngle - this._arcAngle), Math.cos(targetAngle - this._arcAngle));
        this._arcAngle += delta * Math.min(1, dt * 18);
      }
      this._arcVisible = true;
      this._selectionArcDisplay.rotation = this._arcAngle;
    } else {
      this._arcVisible = false;
    }
    this._selectionArcDisplay.alpha = this._arcVisible ? progress * (this._hoverIdx < 0 && this._fireIdx >= 0 ? this._fireT : 1) : 0;

    this._itemSprites.forEach((node, i) => {
      const hot = i === selected;
      if (node.hot !== hot) {
        if (this._discTextures) node.disc.texture = this._discTextures[hot ? 1 : 0];
        else drawDisc(node.disc, hot);
        node.hot = hot;
      }
      const elapsed = (this._nodeOpenMs ?? t * 372) - i * 14;
      const stagger = this._reducedMotion ? 1 : easeOut(clamp01(elapsed / 260));
      node.holder.position.set(node.target.x, node.target.y);
      node.holder.alpha = this._reducedMotion ? 1 : easeOut(clamp01(elapsed / 170));
      node.holder.scale.set(0.55 + 0.45 * stagger + (i === this._fireIdx ? 0.12 * this._fireT : 0));
      node.icon.tint = hot ? COLOR_WHITE : 0xc0d6e1;
    });

    // HTML show 态是圆心 +92+4；仅在大宠物遮住标签时额外避让。
    if (this._holding && this._hoverIdx >= 0 && progress > 0.3 && cursor) {
      const item = RING_ACTIONS[this._hoverIdx];
      if (this._labelTextValue !== item.label) {
        this._labelText.text = item.label;
        this._labelTextValue = item.label;
        const tw = this._labelText.width;
        const th = this._labelText.height;
        const width = tw + 34;
        const height = th + 18;
        this._labelBg.clear();
        this._labelBg.beginFill(COLOR_LABEL_BG, 0xf5 / 255);
        this._labelBg.lineStyle(1, 0x8bcee3, 0x6b / 255);
        this._labelBg.drawRoundedRect(-width / 2, -height / 2, width, height, height / 2);
        this._labelBg.endFill();
        if (this._renderer) {
          const padding = 52; // 22px 柔影及 8px 下移，不裁切尾部。
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil((width + padding * 2) * DETAIL_RESOLUTION);
          canvas.height = Math.ceil((height + padding * 2) * DETAIL_RESOLUTION);
          const ctx = canvas.getContext('2d');
          ctx.scale(DETAIL_RESOLUTION, DETAIL_RESOLUTION);
          ctx.translate(canvas.width / (2 * DETAIL_RESOLUTION), canvas.height / (2 * DETAIL_RESOLUTION));
          ctx.shadowColor = '#0007';
          ctx.shadowBlur = 22 * DETAIL_RESOLUTION;
          ctx.shadowOffsetY = 8 * DETAIL_RESOLUTION;
          ctx.fillStyle = '#193544f5';
          ctx.beginPath();
          ctx.roundRect(-width / 2 + 0.5, -height / 2 + 0.5, width - 1, height - 1, (height - 1) / 2);
          ctx.fill();
          ctx.shadowColor = 'transparent';
          ctx.strokeStyle = '#8bcee36b';
          ctx.lineWidth = 1;
          ctx.stroke();
          const texture = PIXI.Texture.from(canvas, {
            resolution: DETAIL_RESOLUTION,
            scaleMode: PIXI.SCALE_MODES.LINEAR,
          });
          this._labelBgDisplay.texture = texture;
          this._labelBgTexture?.destroy(true);
          this._labelBgTexture = texture;
        }
      }
      const labelX = this._center ? this._center.x : cursor.x;
      const petBottom = Math.max(0, (this._getPetClearance?.() || 0) - 36);
      const labelHalfHeight = (this._labelText.height + 18) / 2;
      let labelOffset = Math.max(96, petBottom + labelHalfHeight + 8);
      if (labelOffset > 96) {
        const labelHalfWidth = (this._labelText.width + 34) / 2;
        for (const node of this._itemSprites) {
          const dx = Math.max(0, Math.abs(node.target.x) - labelHalfWidth);
          const dy = Math.max(0, Math.abs(node.target.y - labelOffset) - labelHalfHeight);
          if (Math.hypot(dx, dy) < DISC_RADIUS + 8) {
            labelOffset = Math.max(labelOffset, node.target.y + DISC_RADIUS + labelHalfHeight + 8);
          }
        }
      }
      const labelY = this._center ? this._center.y + labelOffset : cursor.y + 34;
      this.labelContainer.position.set(labelX, labelY);
      this.labelContainer.alpha = progress;
      this.labelContainer.visible = true;
    } else {
      this.labelContainer.visible = false;
    }
  }

}
