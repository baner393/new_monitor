/**
 * panel.js — GPU Info Panel
 *
 * Minecraft-style pixel-art panel that displays GPU statistics.
 * Features:
 *   - MC-style double-line pixel border
 *   - Dark semi-transparent background
 *   - GPU data: name, temperature, utilization, VRAM, power
 *   - Animated progress bars with temperature colour mapping
 *   - Expand / collapse animation (scale + fade + slide)
 */

import * as PIXI from 'pixi.js';

// ── Constants ─────────────────────────────────────────────────────────
const PANEL_WIDTH  = 500;
const PANEL_HEIGHT = 380;
const PADDING      = 20;
const BORDER_WIDTH = 4;         // outer border thickness
const INNER_GAP    = 3;         // gap between outer and inner border
const INNER_BORDER = 2;         // inner border thickness

const BAR_WIDTH    = PANEL_WIDTH - PADDING * 2;
const BAR_HEIGHT   = 18;
const BAR_GAP      = 8;         // gap between label row and bar
const ROW_GAP      = 16;        // gap between data rows

const BG_COLOR     = 0x1a1a2e;
const BG_ALPHA     = 0.92;
const BORDER_COLOR = 0x555555;
const INNER_BORDER_COLOR = 0x3a3a3a;
const TEXT_COLOR   = 0xeeeeee;
const LABEL_COLOR  = 0xaaaaaa;
const TITLE_COLOR  = 0x55ff55;

// Temperature colour thresholds
const TEMP_GREEN  = 0x44dd44;   // 0-50
const TEMP_YELLOW = 0xdddd44;   // 50-70
const TEMP_ORANGE = 0xdd8844;   // 70-80
const TEMP_RED    = 0xdd4444;   // 80+

// Animation
const ANIM_DURATION = 0.35;     // seconds

// ── Helper: temperature → colour ──────────────────────────────────────

function tempColor(temp) {
  if (temp < 50) return TEMP_GREEN;
  if (temp < 70) return TEMP_YELLOW;
  if (temp < 80) return TEMP_ORANGE;
  return TEMP_RED;
}

// ── Helper: draw MC-style double border on a Graphics ─────────────────

function drawMCBorder(g, w, h) {
  // Outer border
  g.lineStyle(BORDER_WIDTH, BORDER_COLOR, 1);
  g.beginFill(BG_COLOR, BG_ALPHA);
  g.drawRect(0, 0, w, h);
  g.endFill();

  // Inner border
  const off = BORDER_WIDTH + INNER_GAP;
  g.lineStyle(INNER_BORDER, INNER_BORDER_COLOR, 1);
  g.drawRect(off, off, w - off * 2, h - off * 2);
}

// ── Helper: create a bitmap text (falls back to PIXI.Text) ────────────

function makeText(str, size, color, bold = false) {
  // Use PIXI.Text with Mojang pixel font
  const style = new PIXI.TextStyle({
    fontFamily: 'Mojang, "Courier New", monospace',
    fontSize: size,
    fill: color,
    fontWeight: bold ? 'bold' : 'normal',
  });
  const txt = new PIXI.Text(str, style);
  txt.resolution = window.devicePixelRatio || 2;
  txt.autoResolution = true;
  return txt;
}

// ── Helper: draw a progress bar ───────────────────────────────────────

function drawProgressBar(g, x, y, w, h, pct, color) {
  const clampedPct = Math.max(0, Math.min(1, pct));

  // Background track
  g.lineStyle(1, 0x444444, 1);
  g.beginFill(0x222222, 0.9);
  g.drawRect(x, y, w, h);
  g.endFill();

  // Fill
  if (clampedPct > 0) {
    g.lineStyle(0);
    g.beginFill(color, 1);
    g.drawRect(x + 1, y + 1, (w - 2) * clampedPct, h - 2);
    g.endFill();
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
    this._title = makeText('GPU 监控', 16, TITLE_COLOR, true);
    this._title.x = 0;
    this._title.y = 0;
    this._content.addChild(this._title);

    // GPU Name
    this._gpuName = makeText('N/A', 14, TEXT_COLOR);
    this._gpuName.x = 0;
    this._gpuName.y = 24;
    this._content.addChild(this._gpuName);

    // Separator line (drawn in _barsGraphics)
    this._barsGraphics = new PIXI.Graphics();
    this._barsGraphics.y = 48;
    this._content.addChild(this._barsGraphics);

    // Data labels & value texts (positioned in _layout)
    const barStartY = 10; // relative to _barsGraphics

    // ── Temperature row ────────────────────────────────────────────
    this._tempLabel = makeText('温度', 12, LABEL_COLOR);
    this._tempValue = makeText('-- C', 12, TEXT_COLOR);
    this._barsGraphics.addChild(this._tempLabel);
    this._barsGraphics.addChild(this._tempValue);

    // ── GPU Utilization row ────────────────────────────────────────
    this._gpuUtilLabel = makeText('负载', 12, LABEL_COLOR);
    this._gpuUtilValue = makeText('-- %', 12, TEXT_COLOR);
    this._barsGraphics.addChild(this._gpuUtilLabel);
    this._barsGraphics.addChild(this._gpuUtilValue);

    // ── Memory row ─────────────────────────────────────────────────
    this._memLabel = makeText('显存', 12, LABEL_COLOR);
    this._memValue = makeText('-- / -- MB', 12, TEXT_COLOR);
    this._barsGraphics.addChild(this._memLabel);
    this._barsGraphics.addChild(this._memValue);

    // ── Power row ──────────────────────────────────────────────────
    this._powerLabel = makeText('功耗', 12, LABEL_COLOR);
    this._powerValue = makeText('-- W', 12, TEXT_COLOR);
    this._barsGraphics.addChild(this._powerLabel);
    this._barsGraphics.addChild(this._powerValue);

    // Current data cache
    this._data = null;

    // Animation state
    this._animating = false;
    this._animProgress = 0;       // 0 = collapsed, 1 = expanded
    this._animDirection = 1;      // 1 = opening, -1 = closing
    this._animCallback = null;

    // Initial layout
    this._layoutStaticText();
  }

  // ── Positioning helper ──────────────────────────────────────────────

  /**
   * Centre the panel at (cx, cy) in stage coordinates.
   */
  setPosition(cx, cy) {
    this.container.x = cx - PANEL_WIDTH / 2;
    this.container.y = cy - PANEL_HEIGHT / 2;
  }

  // ── Static label positioning ────────────────────────────────────────

  _layoutStaticText() {
    const lx = 0;            // label x
    const vx = 160;          // value x (right-aligned area)
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
    // bar drawn in update()

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

    // GPU name (truncate if too long)
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
    // Normalise temp to 0-1 (assuming max ~100°C)
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

    // Separator line (thin)
    g.lineStyle(1, 0x444444, 0.5);
    g.moveTo(0, 4);
    g.lineTo(barW, 4);
  }

  // ── Expand / Collapse animation ─────────────────────────────────────

  /**
   * Start the expand (open) animation.
   * @param {Function} [onComplete]  Called when fully open.
   */
  expand(onComplete) {
    this._animDirection = 1;
    this._animProgress = 0;
    this._animating = true;
    this._animCallback = onComplete || null;
    this.container.visible = true;
    this.container.alpha = 0;
    this.container.scale.set(0.3);
  }

  /**
   * Start the collapse (close) animation.
   * @param {Function} [onComplete]  Called when fully closed.
   */
  collapse(onComplete) {
    this._animDirection = -1;
    this._animProgress = 1;
    this._animating = true;
    this._animCallback = onComplete || null;
  }

  /**
   * Update animation (call from game loop).
   * @param {number} dt  Delta time in seconds.
   */
  updateAnimation(dt) {
    if (!this._animating) return;

    const speed = 1 / ANIM_DURATION;
    this._animProgress += this._animDirection * speed * dt;
    this._animProgress = Math.max(0, Math.min(1, this._animProgress));

    // Ease-out curve
    const t = this._animDirection === 1
      ? easeOutBack(this._animProgress)
      : easeInQuad(this._animProgress);

    this.container.alpha = this._animDirection === 1
      ? this._animProgress
      : this._animProgress;

    const scaleBase = 0.3 + 0.7 * t;
    this.container.scale.set(scaleBase);

    // Check completion
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

  /** True while an expand/collapse animation is running. */
  get isAnimating() { return this._animating; }

  /** True if the panel is fully visible (not animating, alpha > 0). */
  get isOpen() {
    return this.container.visible && this.container.alpha >= 1 && !this._animating;
  }

  /** Panel width. */
  get width() { return PANEL_WIDTH; }

  /** Panel height. */
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
