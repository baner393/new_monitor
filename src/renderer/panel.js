/**
 * panel.js — GPU Info Panel
 *
 * Minecraft frosted-glass style panel that displays GPU statistics.
 * Features:
 *   - MC-style frosted glass background (multi-layer translucent + blur)
 *   - MC-style pixel border with cut corners, 3D highlights & shadows
 *   - Edge glow / bloom system
 *   - Top highlight streak (light reflection)
 *   - GPU data: name, temperature, utilization, VRAM, power
 *   - Animated progress bars with MC pixel style
 *   - Expand / collapse animation (scale + fade + slide)
 */

import * as PIXI from 'pixi.js';

// ── Constants ─────────────────────────────────────────────────────────
const PANEL_WIDTH  = 500;
const PANEL_HEIGHT = 395;
const PADDING      = 20;
const PIXEL        = 4;            // base pixel unit for MC-style edges
const CORNER_CUT   = 24;           // pixel-cut corner size (6px * 4)

const BAR_WIDTH    = PANEL_WIDTH - PADDING * 2;
const BAR_HEIGHT   = 18;
const BAR_GAP      = 8;            // gap between label row and bar
const ROW_GAP      = 16;           // gap between data rows

// ── MC Frosted Glass Palette ──────────────────────────────────────────

// Main background (dark translucent)
const BG_BASE       = 0x0e1018;
const BG_BASE_ALPHA = 0.72;

// Frost layers (white overlays)
const FROST_WHITE   = 0xffffff;
const FROST_ALPHA_1 = 0.06;        // first frost layer
const FROST_ALPHA_2 = 0.03;        // second frost layer (subtle)

// MC 3D Border colours
const BORDER_DARK    = 0x000000;    // outermost edge
const BORDER_SHADOW  = 0x1a1a1a;    // bottom-right shadow
const BORDER_MID     = 0x2a2a3a;    // mid-tone
const BORDER_LIGHT   = 0x505068;    // top-left highlight
const BORDER_BRIGHT  = 0x707088;    // brightest edge highlight

// Inner inset border
const INNER_HIGHLIGHT = 0x404058;
const INNER_SHADOW    = 0x151520;

// Glow / bloom
const GLOW_COLOR     = 0x6699cc;
const GLOW_ALPHA     = 0.08;

// Edge light (outer glow ring)
const EDGE_GLOW_ALPHA = 0.15;

// Light streak (top reflection)
const STREAK_ALPHA_1  = 0.18;
const STREAK_ALPHA_2  = 0.06;

// Text
const TEXT_COLOR   = 0xeeeeee;
const LABEL_COLOR  = 0xffffff;    // pure white for clarity
const TITLE_COLOR  = 0x55ff55;

// Temperature colour thresholds
const TEMP_GREEN  = 0x44dd44;
const TEMP_YELLOW = 0xdddd44;
const TEMP_ORANGE = 0xdd8844;
const TEMP_RED    = 0xdd4444;

// Animation
const ANIM_DURATION = 0.35;

// ── Helper: temperature → colour ──────────────────────────────────────

function tempColor(temp) {
  if (temp < 50) return TEMP_GREEN;
  if (temp < 70) return TEMP_YELLOW;
  if (temp < 80) return TEMP_ORANGE;
  return TEMP_RED;
}

// ── Helper: draw pixel-cut rectangle (MC GUI style) ──────────────────
// Draws a rectangle with corners cut in PIXEL-sized steps, like
// Minecraft's Advancement / Inventory panels.

function drawPixelCutRect(g, x, y, w, h, cut, pixelSize) {
  const ps = pixelSize || PIXEL;
  const steps = Math.floor(cut / ps);
  const points = [];

  // Build pixel-stepped outline clockwise from top-left
  // Top-left corner: step down-right
  for (let i = 0; i <= steps; i++) {
    points.push([x + i * ps, y + (steps - i) * ps]);
  }
  // Top edge → top-right corner
  points.push([x + w - steps * ps, y]);
  for (let i = 0; i <= steps; i++) {
    points.push([x + w - steps * ps + i * ps, y + i * ps]);
  }
  // Right edge → bottom-right corner
  points.push([x + w, y + h - steps * ps]);
  for (let i = 0; i <= steps; i++) {
    points.push([x + w - i * ps, y + h - steps * ps + i * ps]);
  }
  // Bottom edge → bottom-left corner
  points.push([x + steps * ps, y + h]);
  for (let i = 0; i <= steps; i++) {
    points.push([x + steps * ps - i * ps, y + h - i * ps]);
  }
  // Left edge back to start
  points.push([x, y + steps * ps]);

  // Draw filled shape
  g.beginFill(0, 0); // transparent fill to create path
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

  // Helper to build pixel-cut polygon points
  function pixelCutPoints(x, y, w, h, c) {
    const s = Math.floor(c / ps);
    const pts = [];
    // Start at top-left after cut
    pts.push([x + s * ps, y]);
    // Top edge → top-right cut
    pts.push([x + w - s * ps, y]);
    for (let i = 0; i <= s; i++) pts.push([x + w - s * ps + i * ps, y + i * ps]);
    // Right edge → bottom-right cut
    pts.push([x + w, y + h - s * ps]);
    for (let i = 0; i <= s; i++) pts.push([x + w - i * ps, y + h - s * ps + i * ps]);
    // Bottom edge → bottom-left cut
    pts.push([x + s * ps, y + h]);
    for (let i = 0; i <= s; i++) pts.push([x + s * ps - i * ps, y + h - i * ps]);
    // Left edge → back to start
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

  // ── Layer 0: Outer edge glow (bloom) ─────────────────────────────
  // Multiple expanding translucent layers behind the panel
  for (let i = 3; i >= 1; i--) {
    const expand = i * 6;
    drawFilledPixelCut(
      -expand, -expand, w + expand * 2, h + expand * 2,
      cut + expand, GLOW_COLOR, GLOW_ALPHA / (i + 1)
    );
  }

  // ── Layer 1: Dark base background ────────────────────────────────
  drawFilledPixelCut(0, 0, w, h, cut, BG_BASE, BG_BASE_ALPHA);

  // ── Layer 2: Frost white overlay (frosted glass) ─────────────────
  drawFilledPixelCut(2, 2, w - 4, h - 4, cut - 2, FROST_WHITE, FROST_ALPHA_1);

  // ── Layer 3: Subtle pixel texture stripes ────────────────────────
  // Horizontal scanlines every 4px for MC pixel feel
  const inner = 6;
  for (let row = 0; row < h - inner * 2; row += ps) {
    const a = (row % (ps * 2) === 0) ? 0.025 : 0.012;
    g.beginFill(0xffffff, a);
    g.drawRect(inner, inner + row, w - inner * 2, ps / 2);
    g.endFill();
  }

  // ── Layer 4: Second frost layer (depth) ──────────────────────────
  drawFilledPixelCut(4, 4, w - 8, h - 8, cut - 4, FROST_WHITE, FROST_ALPHA_2);

  // ── Layer 5: Top highlight streak (light reflection) ─────────────
  // Wide horizontal band near top
  const streakH = 60;
  g.beginFill(0xffffff, STREAK_ALPHA_1);
  g.drawRect(inner + 4, inner + 4, w - inner * 2 - 8, streakH / 3);
  g.endFill();
  g.beginFill(0xffffff, STREAK_ALPHA_2);
  g.drawRect(inner + 4, inner + 4 + streakH / 3, w - inner * 2 - 8, streakH / 3);
  g.endFill();

  // Diagonal lens flare accent (subtle)
  g.beginFill(0xaaccff, 0.04);
  g.moveTo(w * 0.15, inner);
  g.lineTo(w * 0.45, inner);
  g.lineTo(w * 0.35, inner + 80);
  g.lineTo(w * 0.05, inner + 80);
  g.closePath();
  g.endFill();

  // ── MC 3D Border: outer frame ────────────────────────────────────

  // Outermost 1px dark edge
  drawStrokedPixelCut(0, 0, w, h, cut, BORDER_DARK, 0.9, 1);

  // Bottom-right shadow band (3D depth)
  const shadowPts = pixelCutPoints(0, 0, w, h, cut);
  // Draw shadow on bottom and right edges
  g.lineStyle(ps, BORDER_SHADOW, 0.7);
  // Bottom edge portion
  const bottomStart = Math.floor(shadowPts.length * 0.55);
  const bottomEnd = Math.floor(shadowPts.length * 0.85);
  g.moveTo(shadowPts[bottomStart][0], shadowPts[bottomStart][1]);
  for (let i = bottomStart + 1; i <= bottomEnd; i++) {
    g.lineTo(shadowPts[i][0], shadowPts[i][1]);
  }
  // Right edge portion
  const rightStart = Math.floor(shadowPts.length * 0.28);
  const rightEnd = Math.floor(shadowPts.length * 0.55);
  g.moveTo(shadowPts[rightStart][0], shadowPts[rightStart][1]);
  for (let i = rightStart + 1; i <= rightEnd; i++) {
    g.lineTo(shadowPts[i][0], shadowPts[i][1]);
  }
  g.lineStyle(0);

  // Top-left highlight band (3D raised)
  g.lineStyle(ps, BORDER_LIGHT, 0.6);
  // Top edge
  const topStart = Math.floor(shadowPts.length * 0.85);
  const topEnd = shadowPts.length - 1;
  g.moveTo(shadowPts[topStart][0], shadowPts[topStart][1]);
  for (let i = topStart + 1; i <= topEnd; i++) {
    g.lineTo(shadowPts[i][0], shadowPts[i][1]);
  }
  g.lineTo(shadowPts[0][0], shadowPts[0][1]);
  // Left edge
  const leftStart = 0;
  const leftEnd = Math.floor(shadowPts.length * 0.28);
  for (let i = leftStart; i <= leftEnd; i++) {
    g.lineTo(shadowPts[i][0], shadowPts[i][1]);
  }
  g.lineStyle(0);

  // Brightest edge highlight (thin, top-left only)
  g.lineStyle(1, BORDER_BRIGHT, 0.5);
  g.moveTo(shadowPts[shadowPts.length - 2][0], shadowPts[shadowPts.length - 2][1]);
  g.lineTo(shadowPts[shadowPts.length - 1][0], shadowPts[shadowPts.length - 1][1]);
  g.lineTo(shadowPts[0][0], shadowPts[0][1]);
  g.lineStyle(0);

  // ── Inner inset border ───────────────────────────────────────────
  const off = PIXEL * 3;
  const iw = w - off * 2;
  const ih = h - off * 2;

  // Inner highlight (top-left)
  g.lineStyle(0);
  g.beginFill(INNER_HIGHLIGHT, 0.5);
  g.drawRect(off, off, iw, 1);            // top
  g.drawRect(off, off, 1, ih);            // left
  g.endFill();

  // Inner shadow (bottom-right)
  g.beginFill(INNER_SHADOW, 0.5);
  g.drawRect(off, off + ih - 1, iw, 1);   // bottom
  g.drawRect(off + iw - 1, off, 1, ih);   // right
  g.endFill();

  // ── Corner pixel accents (MC decorative detail) ──────────────────
  const cs = 4;
  // Top-left corners (bright)
  g.beginFill(BORDER_BRIGHT, 0.6);
  g.drawRect(off, off, cs, cs);
  g.endFill();
  g.beginFill(BORDER_LIGHT, 0.4);
  g.drawRect(off + cs, off, cs, cs);
  g.drawRect(off, off + cs, cs, cs);
  g.endFill();

  // Top-right corner
  g.beginFill(BORDER_LIGHT, 0.4);
  g.drawRect(off + iw - cs, off, cs, cs);
  g.endFill();

  // Bottom corners (dark)
  g.beginFill(INNER_SHADOW, 0.5);
  g.drawRect(off, off + ih - cs, cs, cs);
  g.drawRect(off + iw - cs, off + ih - cs, cs, cs);
  g.endFill();
}

// ── Helper: create a bitmap text (falls back to PIXI.Text) ────────────

function makeText(str, size, color, bold = false, isLabel = false) {
  // Detect if string is numeric (numbers, spaces, dots, %, /, etc.)
  const isNumeric = /^[\d\s.%/°CW\-+]+$/.test(str);
  const fontFamily = isNumeric 
    ? 'Mojang, "Courier New", monospace'  // Keep Mojang for numbers
    : '"Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif';  // Noto Sans for text
  
  const style = new PIXI.TextStyle({
    fontFamily: fontFamily,
    fontSize: size,
    fill: color,
    fontWeight: bold ? 'bold' : 'normal',
    stroke: 0x2a2a3a,  // dark blue-gray stroke (lighter than black)
    strokeThickness: isLabel ? 1 : (bold ? 3 : 2),  // thinner stroke for labels
    dropShadow: false,
  });
  const txt = new PIXI.Text(str, style);
  txt.resolution = window.devicePixelRatio || 2;
  txt.autoResolution = true;
  return txt;
}

// ── Helper: draw a progress bar (MC frosted glass style) ──────────────

function drawProgressBar(g, x, y, w, h, pct, color) {
  const clampedPct = Math.max(0, Math.min(1, pct));

  // Background groove — translucent dark with subtle border
  g.beginFill(0x0a0a12, 0.7);
  g.drawRect(x, y, w, h);
  g.endFill();

  // Groove border (MC 3D inset)
  g.lineStyle(1, BORDER_SHADOW, 0.6);
  g.drawRect(x, y, w, h);
  g.lineStyle(0);

  // Inner highlight (top/left = lighter, MC raised illusion)
  g.beginFill(0x303040, 0.4);
  g.drawRect(x + 1, y + 1, w - 2, 1);
  g.drawRect(x + 1, y + 1, 1, h - 2);
  g.endFill();

  // Inner shadow (bottom/right)
  g.beginFill(0x000000, 0.2);
  g.drawRect(x + 1, y + h - 2, w - 2, 1);
  g.drawRect(x + w - 2, y + 1, 1, h - 2);
  g.endFill();

  // Fill bar
  if (clampedPct > 0) {
    const fillW = (w - 2) * clampedPct;

    // Main fill
    g.beginFill(color, 0.9);
    g.drawRect(x + 1, y + 1, fillW, h - 2);
    g.endFill();

    // Pixel stripe overlay (MC texture feel)
    for (let sx = 0; sx < fillW; sx += 4) {
      const stripeAlpha = (sx % 8 === 0) ? 0.12 : 0.06;
      g.beginFill(0xffffff, stripeAlpha);
      g.drawRect(x + 1 + sx, y + 1, 2, h - 2);
      g.endFill();
    }

    // Top highlight on fill (glass reflection)
    g.beginFill(0xffffff, 0.18);
    g.drawRect(x + 1, y + 1, fillW, 2);
    g.endFill();

    // Bottom shadow on fill
    g.beginFill(0x000000, 0.12);
    g.drawRect(x + 1, y + h - 3, fillW, 2);
    g.endFill();

    // Right edge glow (leading edge bloom)
    if (clampedPct > 0.05) {
      g.beginFill(color, 0.25);
      g.drawRect(x + fillW - 2, y + 1, 4, h - 2);
      g.endFill();
    }
  }
}

// ── Panel Class ───────────────────────────────────────────────────────

export class Panel {
  constructor() {
    // Root container (positioned by caller)
    this.container = new PIXI.Container();
    this.container.visible = false;
    this.container.alpha = 0;

    // ── Background ─────────────────────────────────────────────────
    this._bg = new PIXI.Graphics();
    drawMCBorder(this._bg, PANEL_WIDTH, PANEL_HEIGHT);
    this.container.addChild(this._bg);

    // ── Content container (clipped inside border) ──────────────────
    this._content = new PIXI.Container();
    this._content.x = PADDING;
    this._content.y = PADDING;
    this.container.addChild(this._content);

    // Title
    this._title = makeText('GPU 监控', 18, TITLE_COLOR, true);
    this._title.x = 0;
    this._title.y = 0;
    this._content.addChild(this._title);

    // GPU Name
    this._gpuName = makeText('N/A', 14, TEXT_COLOR, false, true);
    this._gpuName.x = 0;
    this._gpuName.y = 26;
    this._content.addChild(this._gpuName);

    // Separator line (drawn in _barsGraphics)
    this._barsGraphics = new PIXI.Graphics();
    this._barsGraphics.y = 50;
    this._content.addChild(this._barsGraphics);

    // Data labels & value texts (positioned in _layout)
    const barStartY = 10;

    // ── Temperature row ────────────────────────────────────────────
    this._tempLabel = makeText('温度', 14, LABEL_COLOR, false, true);
    this._tempValue = makeText('-- C', 14, TEXT_COLOR);
    this._barsGraphics.addChild(this._tempLabel);
    this._barsGraphics.addChild(this._tempValue);

    // ── GPU Utilization row ────────────────────────────────────────
    this._gpuUtilLabel = makeText('负载', 14, LABEL_COLOR, false, true);
    this._gpuUtilValue = makeText('-- %', 14, TEXT_COLOR);
    this._barsGraphics.addChild(this._gpuUtilLabel);
    this._barsGraphics.addChild(this._gpuUtilValue);

    // ── Memory row ─────────────────────────────────────────────────
    this._memLabel = makeText('显存', 14, LABEL_COLOR, false, true);
    this._memValue = makeText('-- / -- MB', 14, TEXT_COLOR);
    this._barsGraphics.addChild(this._memLabel);
    this._barsGraphics.addChild(this._memValue);

    // ── Power row ──────────────────────────────────────────────────
    this._powerLabel = makeText('功耗', 14, LABEL_COLOR, false, true);
    this._powerValue = makeText('-- W', 14, TEXT_COLOR);
    this._barsGraphics.addChild(this._powerLabel);
    this._barsGraphics.addChild(this._powerValue);

    // Current data cache
    this._data = null;

    // Animation state
    this._animating = false;
    this._animProgress = 0;
    this._animDirection = 1;
    this._animCallback = null;

    // Initial layout
    this._layoutStaticText();
  }

  // ── Positioning helper ──────────────────────────────────────────────

  setPosition(cx, cy) {
    this.container.x = cx - PANEL_WIDTH / 2;
    this.container.y = cy - PANEL_HEIGHT / 2;
  }

  // ── Static label positioning ────────────────────────────────────────

  _layoutStaticText() {
    const lx = 0;
    const vx = 160;
    const barX = 0;
    const barW = BAR_WIDTH;
    const barH = BAR_HEIGHT;

    let y = 10;

    // Temperature
    this._tempLabel.x = lx;
    this._tempLabel.y = y;
    this._tempValue.x = vx;
    this._tempValue.y = y;
    y += ROW_GAP;

    y += barH + BAR_GAP + 4;

    // GPU Utilization
    this._gpuUtilLabel.x = lx;
    this._gpuUtilLabel.y = y;
    this._gpuUtilValue.x = vx;
    this._gpuUtilValue.y = y;
    y += ROW_GAP;

    y += barH + BAR_GAP + 4;

    // Memory
    this._memLabel.x = lx;
    this._memLabel.y = y;
    this._memValue.x = vx;
    this._memValue.y = y;
    y += ROW_GAP;

    y += barH + BAR_GAP + 4;

    // Power (text only, no bar)
    this._powerLabel.x = lx;
    this._powerLabel.y = y;
    this._powerValue.x = vx;
    this._powerValue.y = y;
  }

  // ── Update GPU data ─────────────────────────────────────────────────

  update(data) {
    if (!data || data.error) {
      this._gpuName.text = data?.error ? 'ERROR' : 'N/A';
      return;
    }

    this._data = data;

    // GPU name
    const name = data.name || 'Unknown GPU';
    this._gpuName.text = name.length > 30 ? name.substring(0, 27) + '...' : name;

    // Temperature
    const temp = data.temperature ?? 0;
    const tColor = tempColor(temp);
    this._tempValue.text = `${temp} °C`;
    this._tempValue.style.fill = tColor;

    // GPU Utilization
    const gpuUtil = data.gpuUtilization ?? 0;
    this._gpuUtilValue.text = `${gpuUtil} %`;

    // Memory
    const memUsed = data.memoryUsed ?? 0;
    const memTotal = data.memoryTotal ?? 1;
    const memPct = memTotal > 0 ? memUsed / memTotal : 0;
    this._memValue.text = `${Math.round(memUsed)} / ${Math.round(memTotal)} MB`;

    // Power
    const power = data.powerDraw ?? 0;
    this._powerValue.text = `${power} W`;

    // Redraw progress bars
    this._redrawBars(temp, gpuUtil, memPct, tColor);
  }

  _redrawBars(temp, gpuUtil, memPct, tColor) {
    const g = this._barsGraphics;
    g.clear();

    const lx = 0;
    const barW = BAR_WIDTH;
    const barH = BAR_HEIGHT;
    let y = 10;

    // ── Temperature bar ────────────────────────────────────────────
    y += ROW_GAP;
    const tempPct = Math.min(temp / 100, 1);
    drawProgressBar(g, lx, y, barW, barH, tempPct, tColor);
    y += barH + BAR_GAP + 4;

    // ── GPU Utilization bar ────────────────────────────────────────
    y += ROW_GAP;
    drawProgressBar(g, lx, y, barW, barH, gpuUtil / 100, 0x4488dd);
    y += barH + BAR_GAP + 4;

    // ── Memory bar ─────────────────────────────────────────────────
    y += ROW_GAP;
    drawProgressBar(g, lx, y, barW, barH, memPct, 0xbb66dd);
    y += barH + BAR_GAP + 4;

    // Separator line (MC style - pixel double-line)
    g.lineStyle(1, BORDER_LIGHT, 0.3);
    g.moveTo(0, 4);
    g.lineTo(barW, 4);
    g.lineStyle(1, BORDER_SHADOW, 0.2);
    g.moveTo(0, 6);
    g.lineTo(barW, 6);
    g.lineStyle(0);
  }

  // ── Expand / Collapse animation ─────────────────────────────────────

  expand(onComplete) {
    this._animDirection = 1;
    this._animProgress = 0;
    this._animating = true;
    this._animCallback = onComplete || null;
    this.container.visible = true;
    this.container.alpha = 0;
    this.container.scale.set(0.3);
  }

  collapse(onComplete) {
    this._animDirection = -1;
    this._animProgress = 1;
    this._animating = true;
    this._animCallback = onComplete || null;
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
      if (this._animCallback) this._animCallback();
    } else if (this._animDirection === -1 && this._animProgress <= 0) {
      this._animating = false;
      this.container.visible = false;
      this.container.alpha = 0;
      if (this._animCallback) this._animCallback();
    }
  }

  get isAnimating() { return this._animating; }

  get isOpen() {
    return this.container.visible && this.container.alpha >= 1 && !this._animating;
  }

  get width() { return PANEL_WIDTH; }
  get height() { return PANEL_HEIGHT; }
}

// ── Easing functions ──────────────────────────────────────────────────

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeInQuad(t) {
  return t * t;
}
