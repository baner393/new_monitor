/**
 * settings.js — Settings Panel
 *
 * Minecraft frosted-glass style settings panel for Turtle Monitor.
 * Features:
 *   - MC-style frosted glass background (multi-layer translucent + blur)
 *   - MC-style pixel border with cut corners, 3D highlights & shadows
 *   - Edge glow / bloom system
 *   - Slider controls with real-time value display
 *   - Save / Reset / Cancel buttons
 *   - IPC-based persistence via preload.js
 */

import * as PIXI from 'pixi.js';

// ── Constants ─────────────────────────────────────────────────────────
const PANEL_WIDTH  = 520;
const PANEL_HEIGHT = 620;
const PADDING      = 24;
const PIXEL        = 4;
const CORNER_CUT   = 24;

// Slider dimensions
const SLIDER_WIDTH  = PANEL_WIDTH - PADDING * 2 - 100; // leave room for value
const SLIDER_HEIGHT = 6;
const SLIDER_KNOB   = 14;
const ROW_HEIGHT    = 56;  // height per setting row (label + slider)

// ── MC Frosted Glass Palette (same as panel.js) ───────────────────────

const BG_BASE       = 0x0e1018;
const BG_BASE_ALPHA = 0.78;

const FROST_WHITE   = 0xffffff;
const FROST_ALPHA_1 = 0.06;
const FROST_ALPHA_2 = 0.03;

const BORDER_DARK    = 0x000000;
const BORDER_SHADOW  = 0x1a1a1a;
const BORDER_MID     = 0x2a2a3a;
const BORDER_LIGHT   = 0x505068;
const BORDER_BRIGHT  = 0x707088;

const INNER_HIGHLIGHT = 0x404058;
const INNER_SHADOW    = 0x151520;

const GLOW_COLOR     = 0x6699cc;
const GLOW_ALPHA     = 0.08;

const STREAK_ALPHA_1 = 0.18;
const STREAK_ALPHA_2 = 0.06;

// Text
const TEXT_COLOR    = 0xeeeeee;
const LABEL_COLOR   = 0xffffff;
const TITLE_COLOR   = 0x55ff55;
const HINT_COLOR    = 0x888899;
const VALUE_COLOR   = 0x88ccff;
const SECTION_COLOR = 0xffaa44;

// Button colors
const BTN_SAVE_BG   = 0x2a6e2a;
const BTN_RESET_BG  = 0x6e6e2a;
const BTN_CANCEL_BG = 0x6e2a2a;
const BTN_HOVER_BG  = 0x4a4a6e;

// Slider
const SLIDER_TRACK_COLOR = 0x1a1a2e;
const SLIDER_FILL_COLOR  = 0x4488cc;
const SLIDER_KNOB_COLOR  = 0x6699cc;
const SLIDER_KNOB_HOVER  = 0x88bbff;

// Animation
const ANIM_DURATION = 0.35;

// ── Default Settings ──────────────────────────────────────────────────

const DEFAULTS = {
  turtleSize:       64,
  ropeLength:       150,
  gravity:          800,
  damping:          0.995,
  pulleyFriction:   0.92,
  ropeStiffness:    500,
  ropeDamping:      15,
  bounceRestitution: 0.6,
  airDamping:       0.98,
  ropeElasticity:   5,      // 档位 1-12（旧版为浮点数 0.001-2.0，自动迁移）
  panelMoveStable:  true, // 面板移动稳定：面板打开时右键拖拽使用稳定参数
  blinkDuration:    0.15, // 眨眼(闭眼)时长（秒），0.05~0.5
};

// ── 绳子弹性系数 12 档位映射（指数分布，每档感知变化幅度接近）──
// 档位 1 = 最松，12 = 最紧
export const ROPE_ELASTICITY_STEPS = [
  0.001,  // 1: 极松
  0.003,  // 2
  0.006,  // 3
  0.01,   // 4
  0.02,   // 5: 适中 ⬅ 默认
  0.04,   // 6
  0.07,   // 7
  0.12,   // 8
  0.25,   // 9
  0.5,    // 10
  1.0,    // 11
  2.0,    // 12: 极紧
];

// Setting definitions with labels, ranges, and hints
const SETTINGS_DEFS = [
  {
    section: '基础设置',
    items: [
      {
        key: 'turtleSize',
        label: '乌龟大小',
        hint: '控制乌龟精灵的显示尺寸',
        min: 24, max: 192, step: 2,
        unit: 'px',
      },
      {
        key: 'ropeLength',
        label: '绳子长度',
        hint: '乌龟悬挂绳子的默认长度',
        min: 30, max: 400, step: 5,
        unit: 'px',
      },
      {
        key: 'blinkDuration',
        label: '眨眼时长',
        hint: '闭眼状态的持续时间，越长闭眼越明显',
        min: 0.05, max: 0.5, step: 0.05,
        unit: '秒',
      },
    ],
  },
  {
    section: '左键属性',
    items: [
      {
        key: 'gravity',
        label: '重力',
        hint: '重力加速度，影响摆动和下落速度',
        min: 200, max: 2000, step: 50,
        unit: 'px/s²',
      },
      {
        key: 'damping',
        label: '阻尼系数',
        hint: '钟摆运动的能量衰减，越小衰减越快',
        min: 0.9, max: 1.0, step: 0.005,
        unit: '',
      },
      {
        key: 'ropeElasticity',
        label: '绳子弹性档位',
        hint: '左键拖拽时绳子的弹性，档位 1(极松)~12(极紧)，每档感知变化幅度接近',
        min: 1, max: 12, step: 1,
        unit: '档',
      },
    ],
  },
  {
    section: '右键属性',
    items: [
      {
        key: 'pulleyFriction',
        label: '滑轮摩擦',
        hint: '滑轮水平移动的摩擦力',
        min: 0.8, max: 1.0, step: 0.01,
        unit: '',
      },
      {
        key: 'ropeStiffness',
        label: '绳子弹簧刚度',
        hint: '绳子被拉伸时的回弹力',
        min: 100, max: 1000, step: 50,
        unit: '',
      },
      {
        key: 'ropeDamping',
        label: '绳子弹簧阻尼',
        hint: '绳子弹簧的振动衰减速度',
        min: 5, max: 30, step: 1,
        unit: '',
      },
      {
        key: 'bounceRestitution',
        label: '碰撞恢复系数',
        hint: '乌龟碰墙后的弹力，越大弹越远',
        min: 0.1, max: 1.0, step: 0.1,
        unit: '',
      },
      {
        key: 'airDamping',
        label: '空气阻尼',
        hint: '空气阻力，越小阻力越大',
        min: 0.9, max: 1.0, step: 0.01,
        unit: '',
      },
    ],
  },
  {
    section: '面板相关',
    items: [
      {
        key: 'panelMoveStable',
        label: '面板移动稳定',
        hint: '面板打开时右键拖拽使用稳定参数（弹簧刚度100，空气阻尼0.9），关闭则用右键属性值',
        min: 0, max: 1, step: 1,
        unit: '',
      },
    ],
  },
];

// ── Helper: draw pixel-cut rectangle (MC GUI style) ──────────────────

function drawPixelCutRect(g, x, y, w, h, cut, pixelSize) {
  const ps = pixelSize || PIXEL;
  const steps = Math.floor(cut / ps);
  const points = [];

  for (let i = 0; i <= steps; i++) {
    points.push([x + i * ps, y + (steps - i) * ps]);
  }
  points.push([x + w - steps * ps, y]);
  for (let i = 0; i <= steps; i++) {
    points.push([x + w - steps * ps + i * ps, y + i * ps]);
  }
  points.push([x + w, y + h - steps * ps]);
  for (let i = 0; i <= steps; i++) {
    points.push([x + w - i * ps, y + h - steps * ps + i * ps]);
  }
  points.push([x + steps * ps, y + h]);
  for (let i = 0; i <= steps; i++) {
    points.push([x + steps * ps - i * ps, y + h - i * ps]);
  }
  points.push([x, y + steps * ps]);

  g.beginFill(0, 0);
  g.endFill();
  g.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    g.lineTo(points[i][0], points[i][1]);
  }
  g.closePath();
}

// ── Helper: draw MC-style frosted glass border ─────────────────────

function drawMCBorder(g, w, h) {
  const cut = CORNER_CUT;
  const ps = PIXEL;
  const steps = Math.floor(cut / ps);

  function pixelCutPoints(x, y, w, h, c) {
    const s = Math.floor(c / ps);
    const pts = [];
    pts.push([x + s * ps, y]);
    pts.push([x + w - s * ps, y]);
    for (let i = 0; i <= s; i++) pts.push([x + w - s * ps + i * ps, y + i * ps]);
    pts.push([x + w, y + h - s * ps]);
    for (let i = 0; i <= s; i++) pts.push([x + w - i * ps, y + h - s * ps + i * ps]);
    pts.push([x + s * ps, y + h]);
    for (let i = 0; i <= s; i++) pts.push([x + s * ps - i * ps, y + h - i * ps]);
    pts.push([x, y + s * ps]);
    return pts;
  }

  function drawFilledPixelCut(x, y, w, h, c, color, alpha) {
    const pts = pixelCutPoints(x, y, w, h, c);
    g.beginFill(color, alpha);
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.endFill();
  }

  function drawStrokedPixelCut(x, y, w, h, c, color, alpha, lineW) {
    const pts = pixelCutPoints(x, y, w, h, c);
    g.lineStyle(lineW, color, alpha);
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.lineStyle(0);
  }

  // Outer edge glow
  for (let i = 3; i >= 1; i--) {
    const expand = i * 6;
    drawFilledPixelCut(
      -expand, -expand, w + expand * 2, h + expand * 2,
      cut + expand, GLOW_COLOR, GLOW_ALPHA / (i + 1)
    );
  }

  // Dark base background
  drawFilledPixelCut(0, 0, w, h, cut, BG_BASE, BG_BASE_ALPHA);

  // Frost white overlay
  drawFilledPixelCut(2, 2, w - 4, h - 4, cut - 2, FROST_WHITE, FROST_ALPHA_1);

  // Pixel texture stripes
  const inner = 6;
  for (let row = 0; row < h - inner * 2; row += ps) {
    const a = (row % (ps * 2) === 0) ? 0.025 : 0.012;
    g.beginFill(0xffffff, a);
    g.drawRect(inner, inner + row, w - inner * 2, ps / 2);
    g.endFill();
  }

  // Second frost layer
  drawFilledPixelCut(4, 4, w - 8, h - 8, cut - 4, FROST_WHITE, FROST_ALPHA_2);

  // Top highlight streak
  const streakH = 60;
  g.beginFill(0xffffff, STREAK_ALPHA_1);
  g.drawRect(inner + 4, inner + 4, w - inner * 2 - 8, streakH / 3);
  g.endFill();
  g.beginFill(0xffffff, STREAK_ALPHA_2);
  g.drawRect(inner + 4, inner + 4 + streakH / 3, w - inner * 2 - 8, streakH / 3);
  g.endFill();

  // Diagonal lens flare
  g.beginFill(0xaaccff, 0.04);
  g.moveTo(w * 0.15, inner);
  g.lineTo(w * 0.45, inner);
  g.lineTo(w * 0.35, inner + 80);
  g.lineTo(w * 0.05, inner + 80);
  g.closePath();
  g.endFill();

  // Outer border
  drawStrokedPixelCut(0, 0, w, h, cut, BORDER_DARK, 0.9, 1);

  // Bottom-right shadow
  const shadowPts = pixelCutPoints(0, 0, w, h, cut);
  g.lineStyle(ps, BORDER_SHADOW, 0.7);
  const bottomStart = Math.floor(shadowPts.length * 0.55);
  const bottomEnd = Math.floor(shadowPts.length * 0.85);
  g.moveTo(shadowPts[bottomStart][0], shadowPts[bottomStart][1]);
  for (let i = bottomStart + 1; i <= bottomEnd; i++) {
    g.lineTo(shadowPts[i][0], shadowPts[i][1]);
  }
  const rightStart = Math.floor(shadowPts.length * 0.28);
  const rightEnd = Math.floor(shadowPts.length * 0.55);
  g.moveTo(shadowPts[rightStart][0], shadowPts[rightStart][1]);
  for (let i = rightStart + 1; i <= rightEnd; i++) {
    g.lineTo(shadowPts[i][0], shadowPts[i][1]);
  }
  g.lineStyle(0);

  // Top-left highlight
  g.lineStyle(ps, BORDER_LIGHT, 0.6);
  const topStart = Math.floor(shadowPts.length * 0.85);
  const topEnd = shadowPts.length - 1;
  g.moveTo(shadowPts[topStart][0], shadowPts[topStart][1]);
  for (let i = topStart + 1; i <= topEnd; i++) {
    g.lineTo(shadowPts[i][0], shadowPts[i][1]);
  }
  g.lineTo(shadowPts[0][0], shadowPts[0][1]);
  const leftStart = 0;
  const leftEnd = Math.floor(shadowPts.length * 0.28);
  for (let i = leftStart; i <= leftEnd; i++) {
    g.lineTo(shadowPts[i][0], shadowPts[i][1]);
  }
  g.lineStyle(0);

  // Brightest edge
  g.lineStyle(1, BORDER_BRIGHT, 0.5);
  g.moveTo(shadowPts[shadowPts.length - 2][0], shadowPts[shadowPts.length - 2][1]);
  g.lineTo(shadowPts[shadowPts.length - 1][0], shadowPts[shadowPts.length - 1][1]);
  g.lineTo(shadowPts[0][0], shadowPts[0][1]);
  g.lineStyle(0);

  // Inner inset border
  const off = PIXEL * 3;
  const iw = w - off * 2;
  const ih = h - off * 2;

  g.lineStyle(0);
  g.beginFill(INNER_HIGHLIGHT, 0.5);
  g.drawRect(off, off, iw, 1);
  g.drawRect(off, off, 1, ih);
  g.endFill();

  g.beginFill(INNER_SHADOW, 0.5);
  g.drawRect(off, off + ih - 1, iw, 1);
  g.drawRect(off + iw - 1, off, 1, ih);
  g.endFill();

  // Corner pixel accents
  const cs = 4;
  g.beginFill(BORDER_BRIGHT, 0.6);
  g.drawRect(off, off, cs, cs);
  g.endFill();
  g.beginFill(BORDER_LIGHT, 0.4);
  g.drawRect(off + cs, off, cs, cs);
  g.drawRect(off, off + cs, cs, cs);
  g.endFill();
  g.beginFill(BORDER_LIGHT, 0.4);
  g.drawRect(off + iw - cs, off, cs, cs);
  g.endFill();
  g.beginFill(INNER_SHADOW, 0.5);
  g.drawRect(off, off + ih - cs, cs, cs);
  g.drawRect(off + iw - cs, off + ih - cs, cs, cs);
  g.endFill();
}

// ── Helper: create text ────────────────────────────────────────────

function makeText(str, size, color, bold = false, isLabel = false) {
  const isNumeric = /^\d/.test(str);  // starts with digit → treat as numeric (Mojang font)
  const fontFamily = isNumeric 
    ? '"Mojang", "Courier New", monospace'
    : '"Unifont", "Microsoft YaHei", "PingFang SC", sans-serif';
  
  const style = new PIXI.TextStyle({
    fontFamily: fontFamily,
    fontSize: size,
    fill: color,
    fontWeight: bold ? 'bold' : 'normal',
    stroke: 0x1a1a2e,
    strokeThickness: isLabel ? 0.5 : (bold ? 1.5 : 1),
    lineJoin: 'round',
    miterLimit: 0,
    padding: 4,
    dropShadow: false,
  });
  const txt = new PIXI.Text(str, style);
  txt.roundPixels = true;
  return txt;
}

// ── Helper: format value for display ───────────────────────────────

function formatValue(val, step) {
  if (step >= 1) return Math.round(val).toString();
  if (step >= 0.01) return val.toFixed(2);
  if (step >= 0.001) return val.toFixed(3);
  return val.toString();
}

// ── Easing functions ──────────────────────────────────────────────

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeInQuad(t) {
  return t * t;
}

// ── SettingsPanel Class ───────────────────────────────────────────

export class SettingsPanel {
  constructor() {
    // Root container
    this.container = new PIXI.Container();
    this.container.visible = false;
    this.container.alpha = 0;

    // Current values (deep copy of defaults)
    this._values = { ...DEFAULTS };
    this._originalValues = { ...DEFAULTS }; // for cancel/restore

    // Slider references
    this._sliders = {};

    // Animation state
    this._animating = false;
    this._animProgress = 0;
    this._animDirection = 1;
    this._animCallback = null;

    // Active slider drag
    this._activeSlider = null;

    // Build the UI
    this._build();

    // Load saved settings
    this._loadSettings();

    // Bind drag handlers
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    document.addEventListener('pointermove', this._onPointerMove);
    document.addEventListener('pointerup', this._onPointerUp);
  }

  // ── Build the full UI ────────────────────────────────────────────

  _build() {
    // Background
    this._bg = new PIXI.Graphics();
    drawMCBorder(this._bg, PANEL_WIDTH, PANEL_HEIGHT);
    this.container.addChild(this._bg);

    // Scrollable content area
    this._content = new PIXI.Container();
    this._content.x = PADDING;
    this._content.y = PADDING;
    this.container.addChild(this._content);

    // Scroll mask
    this._scrollMask = new PIXI.Graphics();
    this._scrollMask.beginFill(0xffffff);
    this._scrollMask.drawRect(PADDING, PADDING, PANEL_WIDTH - PADDING * 2, PANEL_HEIGHT - PADDING * 2 - 60);
    this._scrollMask.endFill();
    this.container.addChild(this._scrollMask);
    this._content.mask = this._scrollMask;

    // Title
    this._title = makeText('⚙ 设置', 20, TITLE_COLOR, true);
    this._title.x = 0;
    this._title.y = 0;
    this._content.addChild(this._title);

    // Build settings rows
    let yOffset = 36;

    for (const section of SETTINGS_DEFS) {
      // Section header
      const sectionText = makeText(`▎${section.section}`, 14, SECTION_COLOR, true);
      sectionText.x = 0;
      sectionText.y = yOffset;
      this._content.addChild(sectionText);
      yOffset += 28;

      // Section separator line
      const sepG = new PIXI.Graphics();
      sepG.lineStyle(1, BORDER_LIGHT, 0.3);
      sepG.moveTo(0, yOffset - 4);
      sepG.lineTo(SLIDER_WIDTH + 80, yOffset - 4);
      sepG.lineStyle(1, BORDER_SHADOW, 0.2);
      sepG.moveTo(0, yOffset - 2);
      sepG.lineTo(SLIDER_WIDTH + 80, yOffset - 2);
      sepG.lineStyle(0);
      this._content.addChild(sepG);

      for (const item of section.items) {
        const slider = this._createSlider(
          item.label,
          item.hint,
          item.min,
          item.max,
          item.step,
          this._values[item.key],
          item.unit,
          item.key
        );
        slider.container.x = 4;
        slider.container.y = yOffset;
        this._content.addChild(slider.container);
        this._sliders[item.key] = slider;
        yOffset += ROW_HEIGHT;
      }

      yOffset += 8; // section gap
    }

    // ── Buttons (fixed at bottom, outside scroll) ─────────────────
    this._buttonsContainer = new PIXI.Container();
    this._buttonsContainer.x = PADDING;
    this._buttonsContainer.y = PANEL_HEIGHT - PADDING - 40;
    this.container.addChild(this._buttonsContainer);

    const btnW = 120;
    const btnH = 32;
    const btnGap = 16;
    const totalBtnW = btnW * 3 + btnGap * 2;
    const btnStartX = (PANEL_WIDTH - PADDING * 2 - totalBtnW) / 2;

    this._saveBtn = this._createButton('保存', btnStartX, 0, btnW, btnH, BTN_SAVE_BG, () => this._save());
    this._resetBtn = this._createButton('重置', btnStartX + btnW + btnGap, 0, btnW, btnH, BTN_RESET_BG, () => this._reset());
    this._cancelBtn = this._createButton('取消', btnStartX + (btnW + btnGap) * 2, 0, btnW, btnH, BTN_CANCEL_BG, () => this._cancel());

    this._buttonsContainer.addChild(this._saveBtn.container);
    this._buttonsContainer.addChild(this._resetBtn.container);
    this._buttonsContainer.addChild(this._cancelBtn.container);

    // Store total content height for scroll
    this._contentHeight = yOffset;
    this._scrollOffset = 0;
    this._maxScroll = Math.max(0, this._contentHeight - (PANEL_HEIGHT - PADDING * 2 - 60));

    // Mouse wheel scrolling
    this.container.eventMode = 'static';
    this.container.on('wheel', (e) => {
      this._scrollOffset = Math.max(0, Math.min(this._maxScroll, this._scrollOffset + e.deltaY * 0.5));
      this._content.y = PADDING - this._scrollOffset;
    });
  }

  // ── Create a single slider ─────────────────────────────────────

  _createSlider(label, hint, min, max, step, defaultValue, unit, key) {
    const container = new PIXI.Container();

    // Label text
    const labelText = makeText(label, 13, LABEL_COLOR, false, true);
    labelText.x = 0;
    labelText.y = 0;
    container.addChild(labelText);

    // Hint text
    const hintText = makeText(hint, 10, HINT_COLOR, false, true);
    hintText.x = 0;
    hintText.y = 16;
    container.addChild(hintText);

    // Value display (right-aligned)
    const valueStr = formatValue(defaultValue, step) + (unit ? ` ${unit}` : '');
    const valueText = makeText(valueStr, 13, VALUE_COLOR, true);
    valueText.anchor.set(1, 0);
    valueText.x = SLIDER_WIDTH + 80;
    valueText.y = 0;
    container.addChild(valueText);

    // Slider track background
    const trackY = 36;
    const trackG = new PIXI.Graphics();

    // Track groove (MC inset style)
    trackG.beginFill(SLIDER_TRACK_COLOR, 0.8);
    trackG.drawRect(0, trackY, SLIDER_WIDTH, SLIDER_HEIGHT);
    trackG.endFill();

    // Track 3D inset
    trackG.beginFill(BORDER_SHADOW, 0.5);
    trackG.drawRect(0, trackY, SLIDER_WIDTH, 1);
    trackG.drawRect(0, trackY, 1, SLIDER_HEIGHT);
    trackG.endFill();
    trackG.beginFill(INNER_HIGHLIGHT, 0.3);
    trackG.drawRect(0, trackY + SLIDER_HEIGHT - 1, SLIDER_WIDTH, 1);
    trackG.drawRect(SLIDER_WIDTH - 1, trackY, 1, SLIDER_HEIGHT);
    trackG.endFill();

    container.addChild(trackG);

    // Slider fill (colored portion)
    const fillG = new PIXI.Graphics();
    container.addChild(fillG);

    // Knob (MC pixel style)
    const knobG = new PIXI.Graphics();
    knobG.eventMode = 'static';
    knobG.cursor = 'pointer';
    container.addChild(knobG);

    // Make the whole track area interactive for click-to-set
    const hitArea = new PIXI.Graphics();
    hitArea.beginFill(0xffffff, 0.001);
    hitArea.drawRect(-8, trackY - 8, SLIDER_WIDTH + 16, SLIDER_HEIGHT + 16);
    hitArea.endFill();
    hitArea.eventMode = 'static';
    hitArea.cursor = 'pointer';
    container.addChild(hitArea);

    const slider = {
      container,
      labelText,
      hintText,
      valueText,
      trackG,
      fillG,
      knobG,
      hitArea,
      min,
      max,
      step,
      unit,
      key,
      value: defaultValue,
      trackY,
      trackWidth: SLIDER_WIDTH,
    };

    // Initial draw
    this._drawSlider(slider);

    // Knob drag
    knobG.on('pointerdown', (e) => {
      e.stopPropagation();
      this._activeSlider = slider;
      knobG.alpha = 0.8;
    });

    // Click on track to set value
    hitArea.on('pointerdown', (e) => {
      const localX = e.getLocalPosition(container).x;
      const pct = Math.max(0, Math.min(1, localX / SLIDER_WIDTH));
      const raw = min + pct * (max - min);
      const snapped = Math.round(raw / step) * step;
      slider.value = Math.max(min, Math.min(max, snapped));
      this._values[key] = slider.value;
      this._drawSlider(slider);
      this._activeSlider = slider;
    });

    return slider;
  }

  // ── Draw slider (fill + knob) ──────────────────────────────────

  _drawSlider(slider) {
    const { fillG, knobG, min, max, step, value, trackY, trackWidth, unit, valueText } = slider;
    const pct = (value - min) / (max - min);

    // Fill
    fillG.clear();
    const fillW = pct * trackWidth;
    fillG.beginFill(SLIDER_FILL_COLOR, 0.9);
    fillG.drawRect(0, trackY, fillW, SLIDER_HEIGHT);
    fillG.endFill();

    // Fill highlight (top edge)
    fillG.beginFill(0xffffff, 0.2);
    fillG.drawRect(0, trackY, fillW, 1);
    fillG.endFill();

    // Fill pixel stripe
    for (let sx = 0; sx < fillW; sx += 4) {
      const stripeAlpha = (sx % 8 === 0) ? 0.1 : 0.05;
      fillG.beginFill(0xffffff, stripeAlpha);
      fillG.drawRect(sx, trackY + 1, 2, SLIDER_HEIGHT - 2);
      fillG.endFill();
    }

    // Knob
    knobG.clear();
    const knobX = pct * trackWidth;
    const knobY = trackY + SLIDER_HEIGHT / 2;
    const kHalf = SLIDER_KNOB / 2;

    // Knob shadow
    knobG.beginFill(0x000000, 0.3);
    knobG.drawRect(knobX - kHalf + 1, knobY - kHalf + 1, SLIDER_KNOB, SLIDER_KNOB);
    knobG.endFill();

    // Knob body (MC button style with 3D edges)
    knobG.beginFill(SLIDER_KNOB_COLOR, 1);
    knobG.drawRect(knobX - kHalf, knobY - kHalf, SLIDER_KNOB, SLIDER_KNOB);
    knobG.endFill();

    // Knob highlight (top-left)
    knobG.beginFill(0xffffff, 0.4);
    knobG.drawRect(knobX - kHalf, knobY - kHalf, SLIDER_KNOB, 2);
    knobG.drawRect(knobX - kHalf, knobY - kHalf, 2, SLIDER_KNOB);
    knobG.endFill();

    // Knob shadow (bottom-right)
    knobG.beginFill(0x000000, 0.3);
    knobG.drawRect(knobX - kHalf, knobY + kHalf - 2, SLIDER_KNOB, 2);
    knobG.drawRect(knobX + kHalf - 2, knobY - kHalf, 2, SLIDER_KNOB);
    knobG.endFill();

    // Knob center dot (MC pixel feel)
    knobG.beginFill(0xffffff, 0.6);
    knobG.drawRect(knobX - 1, knobY - 1, 2, 2);
    knobG.endFill();

    // Update value text
    const valueStr = formatValue(value, step) + (unit ? ` ${unit}` : '');
    valueText.text = valueStr;
  }

  // ── Pointer handlers for slider drag ───────────────────────────

  _onPointerMove(e) {
    if (!this._activeSlider) return;

    const slider = this._activeSlider;
    const container = slider.container;

    // Convert global mouse to local slider coordinates
    const globalX = e.clientX;
    const globalY = e.clientY;

    // Get the container's global position
    const bounds = container.getBounds();
    const localX = globalX - bounds.x;
    const pct = Math.max(0, Math.min(1, localX / slider.trackWidth));

    const raw = slider.min + pct * (slider.max - slider.min);
    const snapped = Math.round(raw / slider.step) * slider.step;
    slider.value = Math.max(slider.min, Math.min(slider.max, snapped));
    this._values[slider.key] = slider.value;
    this._drawSlider(slider);
  }

  _onPointerUp() {
    if (this._activeSlider) {
      this._activeSlider.knobG.alpha = 1;
      this._activeSlider = null;
    }
  }

  // ── Create a MC-style button ────────────────────────────────────

  _createButton(label, x, y, w, h, bgColor, onClick) {
    const container = new PIXI.Container();
    container.x = x;
    container.y = y;
    container.eventMode = 'static';
    container.cursor = 'pointer';

    const bg = new PIXI.Graphics();

    const drawBtn = (color, hover = false) => {
      bg.clear();

      // Shadow
      bg.beginFill(0x000000, 0.4);
      bg.drawRect(2, 2, w, h);
      bg.endFill();

      // Body
      bg.beginFill(color, 0.9);
      bg.drawRect(0, 0, w, h);
      bg.endFill();

      // Highlight (top-left)
      bg.beginFill(0xffffff, hover ? 0.35 : 0.2);
      bg.drawRect(0, 0, w, 2);
      bg.drawRect(0, 0, 2, h);
      bg.endFill();

      // Shadow (bottom-right)
      bg.beginFill(0x000000, hover ? 0.2 : 0.3);
      bg.drawRect(0, h - 2, w, 2);
      bg.drawRect(w - 2, 0, 2, h);
      bg.endFill();

      // Inner pixel accent
      bg.beginFill(0xffffff, 0.08);
      bg.drawRect(4, 4, w - 8, 1);
      bg.endFill();
    };

    drawBtn(bgColor);
    container.addChild(bg);

    const text = makeText(label, 14, TEXT_COLOR, true);
    text.anchor.set(0.5);
    text.x = w / 2;
    text.y = h / 2;
    container.addChild(text);

    container.on('pointerover', () => drawBtn(bgColor, true));
    container.on('pointerout', () => drawBtn(bgColor, false));
    container.on('pointerdown', (e) => {
      e.stopPropagation();
      if (onClick) onClick();
    });

    return { container, bg, text, drawBtn, bgColor };
  }

  // ── Load settings from main process ─────────────────────────────

  async _loadSettings() {
    try {
      if (window.electronAPI && window.electronAPI.settings && window.electronAPI.settings.get) {
        const saved = await window.electronAPI.settings.get();
        if (saved) {
          for (const key of Object.keys(DEFAULTS)) {
            if (saved[key] !== undefined) {
              this._values[key] = saved[key];
            }
          }
          // ── 向后兼容：旧 ropeElasticity 是浮点数(0.001~2.0)，新版是档位(1~12) ──
          if (saved.ropeElasticity !== undefined) {
            const v = saved.ropeElasticity;
            if (v < 1 || v > 12 || !Number.isInteger(v)) {
              // 旧格式：找最近的档位
              let nearest = 5;
              let minDist = Infinity;
              for (let i = 0; i < ROPE_ELASTICITY_STEPS.length; i++) {
                const dist = Math.abs(v - ROPE_ELASTICITY_STEPS[i]);
                if (dist < minDist) { minDist = dist; nearest = i + 1; }
              }
              this._values.ropeElasticity = nearest;
              console.log(`[Settings] Migrated ropeElasticity: ${v} → step ${nearest}`);
            }
          }
          this._updateAllSliders();
        }
      }
    } catch (err) {
      console.warn('[Settings] Failed to load settings:', err);
    }
  }

  // ── Update all slider visuals from current values ───────────────

  _updateAllSliders() {
    for (const [key, slider] of Object.entries(this._sliders)) {
      slider.value = this._values[key];
      this._drawSlider(slider);
    }
  }

  // ── Save settings ──────────────────────────────────────────────

  async _save() {
    try {
      if (window.electronAPI && window.electronAPI.settings && window.electronAPI.settings.save) {
        // Set all values first
        for (const [key, val] of Object.entries(this._values)) {
          await window.electronAPI.settings.set(key, val);
        }
        await window.electronAPI.settings.save();
        console.log('[Settings] Saved:', JSON.stringify(this._values));
      }
      this._originalValues = { ...this._values };
      this.close();
    } catch (err) {
      console.error('[Settings] Save failed:', err);
    }
  }

  // ── Reset to defaults ──────────────────────────────────────────

  _reset() {
    this._values = { ...DEFAULTS };
    this._updateAllSliders();
    console.log('[Settings] Reset to defaults');
  }

  // ── Cancel (restore original values) ───────────────────────────

  _cancel() {
    this._values = { ...this._originalValues };
    this._updateAllSliders();
    this.close();
    console.log('[Settings] Cancelled');
  }

  // ── Positioning ────────────────────────────────────────────────

  setPosition(cx, cy) {
    this.container.x = cx - PANEL_WIDTH / 2;
    this.container.y = cy - PANEL_HEIGHT / 2;
  }

  // ── Open / Close with animation ────────────────────────────────

  open() {
    this._originalValues = { ...this._values };
    this._animDirection = 1;
    this._animProgress = 0;
    this._animating = true;
    this.container.visible = true;
    this.container.alpha = 0;
    this.container.scale.set(0.3);

    // Disable click-through while open
    if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
      window.electronAPI.setIgnoreMouseEvents(false);
    }
  }

  close() {
    this._animDirection = -1;
    this._animProgress = 1;
    this._animating = true;
  }

  updateAnimation(dt) {
    if (!this._animating) return;

    const speed = 1 / ANIM_DURATION;
    this._animProgress += this._animDirection * speed * dt;
    this._animProgress = Math.max(0, Math.min(1, this._animProgress));

    const t = this._animDirection === 1
      ? easeOutBack(this._animProgress)
      : easeInQuad(this._animProgress);

    this.container.alpha = this._animProgress;

    const scaleBase = 0.3 + 0.7 * t;
    this.container.scale.set(scaleBase);

    if (this._animDirection === 1 && this._animProgress >= 1) {
      this._animating = false;
      this.container.alpha = 1;
      this.container.scale.set(1);
    } else if (this._animDirection === -1 && this._animProgress <= 0) {
      this._animating = false;
      this.container.visible = false;
      this.container.alpha = 0;

      // Re-enable click-through when closed
      if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
        window.electronAPI.setIgnoreMouseEvents(true);
      }
    }
  }

  // ── Public getters ─────────────────────────────────────────────

  get isAnimating() { return this._animating; }

  get isOpen() {
    return this.container.visible && this.container.alpha >= 1 && !this._animating;
  }

  get width() { return PANEL_WIDTH; }
  get height() { return PANEL_HEIGHT; }

  /** Get a specific setting value */
  getValue(key) {
    return this._values[key] ?? DEFAULTS[key];
  }

  /** Get all current values */
  getValues() {
    return { ...this._values };
  }
}
