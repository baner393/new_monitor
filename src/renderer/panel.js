/**
 * Compact full-system resource panel.
 * All optional hardware values use an explicit unavailable state; a missing
 * sensor is never rendered as a fake zero.
 */

import * as PIXI from 'pixi.js';

const PANEL_WIDTH = 700;
const PANEL_HEIGHT = 590;
const PADDING = 20;
const COLUMN_GAP = 16;
const COLUMN_WIDTH = (PANEL_WIDTH - PADDING * 2 - COLUMN_GAP) / 2;

export const DEFAULT_MONITOR_VISIBILITY = Object.freeze({
  cpu: true,
  memory: true,
  gpu: true,
  disk: true,
  network: true,
  system: true,
  temperature: true,
  power: true,
  fan: true,
  voltage: true,
  storageHealth: true,
  battery: true,
});

const MONITOR_FIELDS = [
  ['cpu', 'CPU 与核心'],
  ['memory', '内存与页面文件'],
  ['gpu', 'GPU 与显存'],
  ['disk', '磁盘容量与 I/O'],
  ['network', '网络接口与吞吐'],
  ['system', '系统与进程信息'],
  ['temperature', '温度传感器'],
  ['power', '功耗传感器'],
  ['fan', '风扇转速 / 控制'],
  ['voltage', '电压传感器'],
  ['storageHealth', '硬盘温度 / 健康'],
  ['battery', '电池信息'],
];

const COLORS = {
  background: 0x0e1018,
  border: 0x62708a,
  borderDark: 0x111520,
  section: 0x171c2a,
  sectionBorder: 0x39445c,
  title: 0x55ff88,
  text: 0xf0f3f8,
  muted: 0xaeb8ca,
  dim: 0x76839b,
  cpu: 0x55ccff,
  memory: 0xbb77ff,
  gpu: 0x66dd88,
  disk: 0xffbb55,
  networkDown: 0x55bbff,
  networkUp: 0xff88bb,
  warning: 0xffcc55,
};

const TEMP_COLORS = {
  cool: 0x55dd77,
  warm: 0xffdd55,
  hot: 0xff9955,
  critical: 0xff5555,
};

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function percent(value) {
  return finite(value) === null ? '当前读取源缺失' : `${Math.round(value)}%`;
}

function formatBytes(value, perSecond = false) {
  if (finite(value) === null) return '当前读取源缺失';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let amount = Math.max(0, value);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits)} ${units[unit]}${perSecond ? '/s' : ''}`;
}

function formatPair(used, total) {
  return finite(used) === null || finite(total) === null
    ? '当前读取源缺失'
    : `${formatBytes(used)} / ${formatBytes(total)}`;
}

function formatClock(mhz) {
  if (finite(mhz) === null) return '当前读取源缺失';
  return mhz >= 1000 ? `${(mhz / 1000).toFixed(2)} GHz` : `${Math.round(mhz)} MHz`;
}

function formatTemperature(value) {
  return finite(value) === null ? '当前读取源缺失' : `${Math.round(value)} °C`;
}

function formatDuration(seconds) {
  if (finite(seconds) === null) return '当前读取源缺失';
  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `${days ? `${days}天 ` : ''}${hours}时 ${minutes}分`;
}

function truncate(value, maxLength) {
  const text = String(value || '当前读取源缺失');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function temperatureColor(value) {
  if (finite(value) === null || value < 55) return TEMP_COLORS.cool;
  if (value < 72) return TEMP_COLORS.warm;
  if (value < 85) return TEMP_COLORS.hot;
  return TEMP_COLORS.critical;
}

function makeText(text, size = 13, color = COLORS.text, options = {}) {
  const instance = new PIXI.Text(text, new PIXI.TextStyle({
    fontFamily: options.numeric
      ? '"Mojang", "Courier New", monospace'
      : '"Unifont", "Microsoft YaHei", "PingFang SC", sans-serif',
    fontSize: size,
    fill: color,
    fontWeight: options.bold ? 'bold' : 'normal',
    stroke: 0x080a10,
    strokeThickness: options.bold ? 1.5 : 1,
    lineJoin: 'round',
    padding: 3,
    wordWrap: Boolean(options.wordWrap),
    wordWrapWidth: options.wordWrapWidth || 0,
    breakWords: true,
  }));
  instance.roundPixels = true;
  return instance;
}

function drawPixelPanel(graphics, x, y, width, height, fill, border, alpha = 0.88) {
  const cut = 8;
  graphics.lineStyle(2, border, 0.85);
  graphics.beginFill(fill, alpha);
  graphics.moveTo(x + cut, y);
  graphics.lineTo(x + width - cut, y);
  graphics.lineTo(x + width, y + cut);
  graphics.lineTo(x + width, y + height - cut);
  graphics.lineTo(x + width - cut, y + height);
  graphics.lineTo(x + cut, y + height);
  graphics.lineTo(x, y + height - cut);
  graphics.lineTo(x, y + cut);
  graphics.closePath();
  graphics.endFill();
  graphics.lineStyle(0);

  graphics.beginFill(0xffffff, 0.06);
  graphics.drawRect(x + cut, y + 2, width - cut * 2, 2);
  graphics.endFill();
  graphics.beginFill(0x000000, 0.18);
  graphics.drawRect(x + cut, y + height - 4, width - cut * 2, 2);
  graphics.endFill();
}

function drawProgressBar(graphics, x, y, width, value, color) {
  const height = 12;
  const ratio = finite(value) === null ? 0 : clamp(value / 100, 0, 1);
  graphics.beginFill(0x080b12, 0.85);
  graphics.drawRect(x, y, width, height);
  graphics.endFill();
  graphics.lineStyle(1, 0x48536a, 0.7);
  graphics.drawRect(x, y, width, height);
  graphics.lineStyle(0);
  if (ratio <= 0) return;

  const fillWidth = Math.max(2, (width - 2) * ratio);
  graphics.beginFill(color, 0.9);
  graphics.drawRect(x + 1, y + 1, fillWidth, height - 2);
  graphics.endFill();
  graphics.beginFill(0xffffff, 0.18);
  graphics.drawRect(x + 1, y + 1, fillWidth, 2);
  graphics.endFill();
}

function aggregateDisks(disks) {
  const valid = (disks || []).filter((disk) => finite(disk.sizeBytes) !== null);
  if (!valid.length) return { total: null, used: null, usage: null };
  const total = valid.reduce((sum, disk) => sum + disk.sizeBytes, 0);
  const used = valid.reduce((sum, disk) => sum + (finite(disk.usedBytes) ?? 0), 0);
  return { total, used, usage: total > 0 ? 100 * used / total : null };
}

function maximumNumber(values) {
  const valid = (values || []).filter((value) => finite(value) !== null);
  return valid.length ? Math.max(...valid) : null;
}

function batteryStatus(battery) {
  if (!battery) return '本机无电池';
  const chargingCodes = new Set([6, 7, 8, 9, 11]);
  const state = chargingCodes.has(battery.statusCode) ? '充电中' : '电池供电';
  return `${percent(battery.percent)} · ${state}`;
}

function sensorUnavailable(data, { notApplicable = false } = {}) {
  if (notApplicable) return '本机无此设备';
  if (data?.diagnostics?.hardwareSensorError) return '传感器读取源异常';
  const access = data?.hardwareSensors?.access;
  if (!access) return '传感器组件未就绪';
  if (!access.elevated && access.permissionRecommended) return '需要管理员权限';
  return access.elevated ? '硬件 / 固件未开放' : '权限受限或硬件未开放';
}

function formatSensorValue(sensor, data) {
  const value = finite(sensor?.value);
  if (value === null) return sensorUnavailable(data);
  const formats = {
    Temperature: () => `${value.toFixed(1)} °C`,
    Fan: () => `${Math.round(value)} RPM`,
    Voltage: () => `${value.toFixed(3)} V`,
    Power: () => `${value.toFixed(2)} W`,
    Clock: () => formatClock(value),
    Load: () => `${value.toFixed(1)}%`,
    Control: () => `${value.toFixed(1)}%`,
    Level: () => `${value.toFixed(1)}%`,
    Data: () => `${value.toFixed(2)} GB`,
    SmallData: () => `${value.toFixed(2)} MB`,
    Throughput: () => `${value.toFixed(1)} B/s`,
    Current: () => `${value.toFixed(3)} A`,
    Energy: () => `${value.toFixed(2)} mWh`,
    Frequency: () => `${value.toFixed(1)} Hz`,
  };
  return formats[sensor.sensorType]?.() || value.toFixed(2);
}

function shouldShowSensor(sensor, visibility) {
  const type = sensor.sensorType;
  if (type === 'Temperature' && !visibility.temperature) return false;
  if (type === 'Power' && !visibility.power) return false;
  if ((type === 'Fan' || type === 'Control') && !visibility.fan) return false;
  if ((type === 'Voltage' || type === 'Current') && !visibility.voltage) return false;
  if (/^Cpu$/i.test(sensor.hardwareType)) return visibility.cpu;
  if (/^Gpu/i.test(sensor.hardwareType)) return visibility.gpu;
  if (/^Memory$/i.test(sensor.hardwareType)) return visibility.memory;
  if (/^Network$/i.test(sensor.hardwareType)) return visibility.network;
  if (/^Storage$/i.test(sensor.hardwareType)) return visibility.disk || visibility.storageHealth;
  if (/^Battery$/i.test(sensor.hardwareType)) return visibility.battery;
  return visibility.system || visibility.temperature || visibility.power || visibility.fan || visibility.voltage;
}

export class Panel {
  constructor({ onVisibilityChange = null, onRequestElevation = null } = {}) {
    this._visibility = { ...DEFAULT_MONITOR_VISIBILITY };
    this._onVisibilityChange = onVisibilityChange;
    this._onRequestElevation = onRequestElevation;
    this._page = 'overview';
    this._hardwarePage = 0;
    this.container = new PIXI.Container();
    this.container.visible = false;
    this.container.alpha = 0;

    this._background = new PIXI.Graphics();
    this._drawBackground();
    this.container.addChild(this._background);

    this._bars = new PIXI.Graphics();
    this.container.addChild(this._bars);

    this._title = makeText('系统资源监控', 20, COLORS.title, { bold: true });
    this._title.position.set(PADDING, 14);
    this.container.addChild(this._title);

    this._overviewTab = makeText('概览', 13, COLORS.title, { bold: true });
    this._overviewTab.position.set(508, 16);
    this._overviewTab.eventMode = 'static';
    this._overviewTab.cursor = 'pointer';
    this._overviewTab.on('pointertap', () => this._showPage('overview'));
    this.container.addChild(this._overviewTab);

    this._manageTab = makeText('监控管理', 13, COLORS.muted, { bold: true });
    this._manageTab.position.set(556, 16);
    this._manageTab.eventMode = 'static';
    this._manageTab.cursor = 'pointer';
    this._manageTab.on('pointertap', () => this._showPage('manage'));
    this.container.addChild(this._manageTab);

    this._systemLine = makeText('正在读取系统信息…', 12, COLORS.muted);
    this._systemLine.position.set(PADDING, 43);
    this.container.addChild(this._systemLine);

    this._status = makeText('多源采集中', 11, COLORS.dim);
    this._status.anchor.set(1, 0);
    this._status.position.set(PANEL_WIDTH - PADDING, 43);
    this.container.addChild(this._status);

    this._meters = {
      cpu: this._createMeter(PADDING, 74, 'CPU', COLORS.cpu),
      memory: this._createMeter(PADDING + COLUMN_WIDTH + COLUMN_GAP, 74, '内存', COLORS.memory),
      gpu: this._createMeter(PADDING, 178, 'GPU / 显存', COLORS.gpu),
      disk: this._createMeter(PADDING + COLUMN_WIDTH + COLUMN_GAP, 178, '磁盘', COLORS.disk),
    };

    this._networkTitle = makeText('网络吞吐', 14, COLORS.networkDown, { bold: true });
    this._networkTitle.position.set(PADDING + 12, 300);
    this.container.addChild(this._networkTitle);
    this._networkValue = makeText('↓ 硬件未提供    ↑ 硬件未提供', 18, COLORS.text, { numeric: true });
    this._networkValue.position.set(PADDING + 12, 325);
    this.container.addChild(this._networkValue);
    this._networkDetail = makeText('活动接口：硬件未提供', 12, COLORS.muted);
    this._networkDetail.position.set(PADDING + 12, 353);
    this.container.addChild(this._networkDetail);
    this._networkExtra = makeText('链路速度：硬件未提供', 12, COLORS.dim);
    this._networkExtra.position.set(PADDING + 12, 374);
    this.container.addChild(this._networkExtra);
    this._networkObjects = [this._networkTitle, this._networkValue, this._networkDetail, this._networkExtra];

    const detailX = PADDING + COLUMN_WIDTH + COLUMN_GAP + 12;
    this._storageTitle = makeText('各分区容量', 14, COLORS.disk, { bold: true });
    this._storageTitle.position.set(detailX, 300);
    this.container.addChild(this._storageTitle);
    this._storageLines = [0, 1, 2, 3].map((index) => {
      const line = makeText(index === 0 ? '正在读取…' : '', 12, index === 0 ? COLORS.text : COLORS.muted);
      line.position.set(detailX, 325 + index * 21);
      this.container.addChild(line);
      return line;
    });
    this._storageObjects = [this._storageTitle, ...this._storageLines];

    this._systemTitle = makeText('系统概况', 14, COLORS.title, { bold: true });
    this._systemTitle.position.set(PADDING + 12, 434);
    this.container.addChild(this._systemTitle);
    this._systemDetails = [0, 1, 2, 3, 4].map((index) => {
      const line = makeText(index === 0 ? '正在读取…' : '', 12, index === 0 ? COLORS.text : COLORS.muted);
      line.position.set(PADDING + 12, 458 + index * 21);
      this.container.addChild(line);
      return line;
    });
    this._systemObjects = [this._systemTitle, ...this._systemDetails];

    this._hardwareTitle = makeText('硬件与传感器 · 点击翻页', 14, COLORS.gpu, { bold: true });
    this._hardwareTitle.position.set(detailX, 434);
    this._hardwareTitle.eventMode = 'static';
    this._hardwareTitle.cursor = 'pointer';
    this._hardwareTitle.on('pointertap', () => {
      this._hardwarePage += 1;
      this._renderHardwarePage();
    });
    this.container.addChild(this._hardwareTitle);
    this._hardwareDetails = [0, 1, 2, 3, 4].map((index) => {
      const line = makeText(index === 0 ? '正在读取…' : '', 12, index === 0 ? COLORS.text : COLORS.muted);
      line.position.set(detailX, 458 + index * 21);
      this.container.addChild(line);
      return line;
    });
    this._hardwareObjects = [this._hardwareTitle, ...this._hardwareDetails];

    this._managementPage = this._createManagementPage();
    this.container.addChild(this._managementPage);

    this._data = null;
    this._animating = false;
    this._animProgress = 0;
    this._animDirection = 1;
    this._animCallback = null;
    this._applyVisibility();
    this._showPage('overview');
    this._drawBars({});
  }

  _createManagementPage() {
    const page = new PIXI.Container();
    const background = new PIXI.Graphics();
    drawPixelPanel(background, 12, 62, PANEL_WIDTH - 24, PANEL_HEIGHT - 74, COLORS.background, COLORS.border, 0.985);
    page.addChild(background);

    const title = makeText('监控管理', 19, COLORS.title, { bold: true });
    title.position.set(34, 78);
    page.addChild(title);
    const hint = makeText('选择概览与传感器明细中显示的数据；更改会立即保存。', 12, COLORS.muted);
    hint.position.set(34, 107);
    page.addChild(hint);

    this._visibilityControls = new Map();
    MONITOR_FIELDS.forEach(([key, label], index) => {
      const column = Math.floor(index / 6);
      const row = index % 6;
      const control = new PIXI.Container();
      control.position.set(34 + column * 326, 140 + row * 45);
      control.eventMode = 'static';
      control.cursor = 'pointer';
      control.hitArea = new PIXI.Rectangle(0, 0, 302, 35);

      const box = new PIXI.Graphics();
      control.addChild(box);
      const text = makeText(label, 13, COLORS.text);
      text.position.set(34, 6);
      control.addChild(text);
      control.on('pointertap', () => {
        this._visibility[key] = !this._visibility[key];
        this._drawVisibilityControl(key);
        this._applyVisibility();
        this._renderHardwarePage();
        this._onVisibilityChange?.({ ...this._visibility });
      });
      this._visibilityControls.set(key, { box, text });
      page.addChild(control);
    });

    const divider = new PIXI.Graphics();
    divider.lineStyle(1, COLORS.sectionBorder, 0.9);
    divider.moveTo(34, 417);
    divider.lineTo(PANEL_WIDTH - 34, 417);
    page.addChild(divider);

    const accessTitle = makeText('传感器权限与完整度', 14, COLORS.gpu, { bold: true });
    accessTitle.position.set(34, 431);
    page.addChild(accessTitle);
    this._manageAccess = makeText('正在等待传感器宿主…', 13, COLORS.text);
    this._manageAccess.position.set(34, 458);
    page.addChild(this._manageAccess);
    this._manageHint = makeText('普通权限先读取；受保护项目可在右侧主动提升。', 12, COLORS.muted);
    this._manageHint.position.set(34, 482);
    page.addChild(this._manageHint);
    this._manageError = makeText('', 11, COLORS.warning);
    this._manageError.position.set(34, 507);
    page.addChild(this._manageError);

    this._elevationButton = new PIXI.Container();
    this._elevationButton.position.set(438, 452);
    this._elevationButton.eventMode = 'static';
    this._elevationButton.cursor = 'pointer';
    this._elevationButton.hitArea = new PIXI.Rectangle(0, 0, 220, 48);
    this._elevationButtonGraphic = new PIXI.Graphics();
    this._elevationButton.addChild(this._elevationButtonGraphic);
    this._elevationButtonText = makeText('请求管理员权限', 13, COLORS.text, { bold: true });
    this._elevationButtonText.anchor.set(0.5);
    this._elevationButtonText.position.set(110, 24);
    this._elevationButton.addChild(this._elevationButtonText);
    this._elevationButton.on('pointertap', async () => {
      if (this._data?.hardwareSensors?.access?.elevated || this._elevationPending) return;
      this._elevationPending = true;
      this._elevationButtonText.text = '正在请求 Windows 权限…';
      try {
        const result = await this._onRequestElevation?.();
        if (result?.alreadyElevated) {
          this._elevationButtonText.text = '已使用管理员权限';
        } else if (!result?.started) {
          this._elevationButtonText.text = '请求未启动，请重试';
          this._elevationPending = false;
        }
      } catch (error) {
        this._elevationButtonText.text = '请求已取消或启动失败';
        this._manageError.text = truncate(error?.message, 58);
        this._elevationPending = false;
      }
    });
    page.addChild(this._elevationButton);

    const note = makeText('说明：设备不存在会标为“本机无此设备”；管理员权限下仍缺失则表示硬件或固件没有开放该传感器。', 11, COLORS.dim, {
      wordWrap: true,
      wordWrapWidth: PANEL_WIDTH - 68,
    });
    note.position.set(34, 545);
    page.addChild(note);

    for (const [key] of MONITOR_FIELDS) this._drawVisibilityControl(key);
    this._drawElevationButton(false);
    return page;
  }

  _drawVisibilityControl(key) {
    const control = this._visibilityControls?.get(key);
    if (!control) return;
    const enabled = this._visibility[key] !== false;
    control.box.clear();
    control.box.lineStyle(1, enabled ? COLORS.title : COLORS.dim, 0.9);
    control.box.beginFill(enabled ? 0x1d5530 : 0x111520, 0.9);
    control.box.drawRect(2, 5, 22, 22);
    control.box.endFill();
    if (enabled) {
      control.box.lineStyle(3, 0xffffff, 0.95);
      control.box.moveTo(7, 15);
      control.box.lineTo(12, 21);
      control.box.lineTo(21, 10);
    }
    control.text.style.fill = enabled ? COLORS.text : COLORS.dim;
  }

  _drawElevationButton(elevated) {
    if (!this._elevationButtonGraphic) return;
    this._elevationButtonGraphic.clear();
    drawPixelPanel(
      this._elevationButtonGraphic,
      0, 0, 220, 48,
      elevated ? 0x24452d : 0x234b68,
      elevated ? COLORS.gpu : COLORS.networkDown,
      0.95,
    );
    this._elevationButton.cursor = elevated ? 'default' : 'pointer';
  }

  _showPage(page) {
    this._page = page === 'manage' ? 'manage' : 'overview';
    if (this._managementPage) this._managementPage.visible = this._page === 'manage';
    if (this._overviewTab) this._overviewTab.style.fill = this._page === 'overview' ? COLORS.title : COLORS.muted;
    if (this._manageTab) this._manageTab.style.fill = this._page === 'manage' ? COLORS.title : COLORS.muted;
  }

  setVisibility(visibility) {
    for (const key of Object.keys(DEFAULT_MONITOR_VISIBILITY)) {
      this._visibility[key] = visibility?.[key] !== false;
      this._drawVisibilityControl(key);
    }
    this._applyVisibility();
    this._renderHardwarePage();
  }

  _applyVisibility() {
    for (const [key, meter] of Object.entries(this._meters || {})) {
      const enabled = this._visibility[key] !== false;
      meter.enabled = enabled;
      for (const object of meter.objects) object.visible = enabled;
    }
    for (const object of this._networkObjects || []) object.visible = this._visibility.network;
    for (const object of this._storageObjects || []) object.visible = this._visibility.disk;
    for (const object of this._systemObjects || []) object.visible = this._visibility.system;
    const showHardware = ['gpu', 'temperature', 'power', 'fan', 'voltage', 'storageHealth', 'battery']
      .some((key) => this._visibility[key]);
    for (const object of this._hardwareObjects || []) object.visible = showHardware;
    if (this._data) this.update(this._data);
  }

  _renderManagement() {
    const hardwareSensors = this._data?.hardwareSensors;
    const access = hardwareSensors?.access;
    const elevated = Boolean(access?.elevated);
    if (access) {
      this._manageAccess.text = `${elevated ? '管理员权限' : '标准权限'} · 已读取 ${access.sensorCount}/${access.totalSensorCount} 项 · ${access.hardwareCount} 个硬件节点`;
      this._manageAccess.style.fill = elevated ? COLORS.gpu : COLORS.warning;
      this._manageHint.text = elevated
        ? '底层读取权限已启用；仍为空的项目属于设备不存在或固件未开放。'
        : access.permissionRecommended
          ? 'CPU / 主板受保护传感器尚未开放，建议点击右侧提升权限。'
          : '已在标准权限下读取可用项目；提升权限可继续探测受保护项目。';
    } else {
      this._manageAccess.text = '传感器宿主尚未返回数据';
      this._manageAccess.style.fill = COLORS.warning;
      this._manageHint.text = '系统占用率兜底仍在运行，底层传感器正在独立恢复。';
    }
    const error = this._data?.diagnostics?.hardwareSensorError;
    this._manageError.text = error ? `读取源异常：${truncate(error, 55)}` : '';
    this._elevationButtonText.text = elevated ? '已使用管理员权限' : '请求管理员权限';
    this._elevationPending = elevated;
    this._drawElevationButton(elevated);
  }

  _drawBackground() {
    const g = this._background;
    g.clear();
    for (let spread = 14; spread >= 4; spread -= 5) {
      drawPixelPanel(g, -spread, -spread, PANEL_WIDTH + spread * 2, PANEL_HEIGHT + spread * 2, 0x5588bb, 0x5588bb, 0.018);
    }
    drawPixelPanel(g, 0, 0, PANEL_WIDTH, PANEL_HEIGHT, COLORS.background, COLORS.border, 0.92);

    const sections = [
      [PADDING, 66, COLUMN_WIDTH, 112],
      [PADDING + COLUMN_WIDTH + COLUMN_GAP, 66, COLUMN_WIDTH, 112],
      [PADDING, 170, COLUMN_WIDTH, 112],
      [PADDING + COLUMN_WIDTH + COLUMN_GAP, 170, COLUMN_WIDTH, 112],
      [PADDING, 292, COLUMN_WIDTH, 126],
      [PADDING + COLUMN_WIDTH + COLUMN_GAP, 292, COLUMN_WIDTH, 126],
      [PADDING, 426, COLUMN_WIDTH, 144],
      [PADDING + COLUMN_WIDTH + COLUMN_GAP, 426, COLUMN_WIDTH, 144],
    ];
    for (const [x, y, width, height] of sections) {
      drawPixelPanel(g, x, y, width, height, COLORS.section, COLORS.sectionBorder, 0.72);
    }
  }

  _createMeter(x, y, title, color) {
    const titleText = makeText(title, 14, color, { bold: true });
    titleText.position.set(x + 12, y);
    this.container.addChild(titleText);

    const valueText = makeText('--%', 17, COLORS.text, { numeric: true, bold: true });
    valueText.anchor.set(1, 0);
    valueText.position.set(x + COLUMN_WIDTH - 12, y - 1);
    this.container.addChild(valueText);

    const detailText = makeText('硬件未提供', 12, COLORS.muted);
    detailText.position.set(x + 12, y + 46);
    this.container.addChild(detailText);

    const extraText = makeText('', 11, COLORS.dim);
    extraText.position.set(x + 12, y + 68);
    this.container.addChild(extraText);

    return {
      x, y, color, titleText, valueText, detailText, extraText,
      objects: [titleText, valueText, detailText, extraText],
      enabled: true,
    };
  }

  setPosition(cx, cy) {
    const viewportWidth = globalThis.window?.innerWidth || PANEL_WIDTH;
    const viewportHeight = globalThis.window?.innerHeight || PANEL_HEIGHT;
    const maxX = Math.max(8, viewportWidth - PANEL_WIDTH - 8);
    const maxY = Math.max(8, viewportHeight - PANEL_HEIGHT - 8);
    this.container.x = clamp(cx - PANEL_WIDTH / 2, 8, maxX);
    this.container.y = clamp(cy - 190, 8, maxY);
  }

  update(data) {
    this._data = data || null;
    if (!data) {
      this._status.text = '等待采集器';
      return;
    }

    const cpu = data.cpu || {};
    const memory = data.memory || {};
    const gpu = data.gpu || {};
    const diskIo = data.diskIo || {};
    const network = data.network || {};
    const system = data.system || {};
    const disks = data.disks || [];
    const diskTotals = aggregateDisks(disks);

    this._systemLine.text = truncate(
      `${system.hostname || '本机'} · ${system.osName || system.platform || '系统未知'} ${system.arch || ''}`,
      72,
    );
    const activeProviders = (data.providers || []).filter((value, index, all) => all.indexOf(value) === index);
    this._status.text = data.diagnostics?.windowsError && activeProviders.length <= 1
      ? '基础数据模式'
      : `${activeProviders.length || 1} 路数据源`;
    this._status.style.fill = data.diagnostics?.windowsError ? COLORS.warning : COLORS.dim;

    const hottestCore = (cpu.perCoreUsage || []).filter(Number.isFinite).length
      ? Math.max(...cpu.perCoreUsage.filter(Number.isFinite))
      : null;
    this._setMeter('cpu', cpu.usage,
      `${truncate(cpu.model, 31)} · ${cpu.physicalCores ?? '?'}核/${cpu.logicalCores ?? '?'}线程`,
      `${formatClock(cpu.currentClockMHz)} / 峰值 ${formatClock(cpu.maxClockMHz)} · 最忙核心 ${percent(hottestCore)}`,
    );

    this._setMeter('memory', memory.usage,
      formatPair(memory.usedBytes, memory.totalBytes),
      `可用 ${formatBytes(memory.availableBytes)} · 页面文件 ${formatPair(
        finite(memory.pageFileTotalBytes) !== null && finite(memory.pageFileAvailableBytes) !== null
          ? memory.pageFileTotalBytes - memory.pageFileAvailableBytes
          : null,
        memory.pageFileTotalBytes,
      )}`,
    );

    this._setMeter('gpu', gpu.usage,
      `${truncate(gpu.name, 28)} · 显存 ${formatPair(gpu.memoryUsedBytes, gpu.memoryTotalBytes)}`,
      `${this._visibility.temperature ? formatTemperature(gpu.temperatureC) : '温度已隐藏'} · ${this._visibility.power ? (finite(gpu.powerWatts) === null ? `功耗${sensorUnavailable(data)}` : `${gpu.powerWatts.toFixed(1)} W`) : '功耗已隐藏'} · ${gpu.adapters?.length || (gpu.name ? 1 : 0)} 个适配器`,
    );

    this._setMeter('disk', finite(diskIo.usage) ?? diskTotals.usage,
      `容量 ${formatPair(diskTotals.used, diskTotals.total)}`,
      `读 ${formatBytes(diskIo.readBytesPerSec, true)} · 写 ${formatBytes(diskIo.writeBytesPerSec, true)} · 队列 ${finite(diskIo.queueLength) === null ? '当前读取源缺失' : diskIo.queueLength.toFixed(1)}`,
    );

    this._networkValue.text = `↓ ${formatBytes(network.downloadBytesPerSec, true)}    ↑ ${formatBytes(network.uploadBytesPerSec, true)}`;
    const sortedInterfaces = [...(network.interfaces || [])].sort(
      (a, b) => (b.totalBytesPerSec ?? 0) - (a.totalBytesPerSec ?? 0),
    );
    const activeInterface = sortedInterfaces[0];
    this._networkDetail.text = `活动接口：${truncate(activeInterface?.name, 35)} · 共 ${sortedInterfaces.length} 个接口`;
    this._networkExtra.text = `链路速度：${finite(activeInterface?.linkSpeedBits) === null ? '当前读取源缺失' : `${formatBytes(activeInterface.linkSpeedBits / 8, true)}`} · 收发包 ${finite(activeInterface?.packetsReceivedPerSec) === null ? '当前读取源缺失' : `${Math.round(activeInterface.packetsReceivedPerSec + (activeInterface.packetsSentPerSec || 0))}/s`}`;

    const diskLines = disks.slice(0, 4).map((disk) => (
      `${disk.name} ${percent(disk.usage)} · ${formatPair(disk.usedBytes, disk.sizeBytes)}${disk.volumeName ? ` · ${truncate(disk.volumeName, 10)}` : ''}`
    ));
    if (disks.length > 4) diskLines[3] = `另有 ${disks.length - 3} 个分区 · 总占用 ${percent(diskTotals.usage)}`;
    this._setLines(this._storageLines, diskLines.length ? diskLines : ['本机未发现固定分区']);

    this._setLines(this._systemDetails, [
      `运行时间：${formatDuration(system.uptimeSec)}`,
      `进程 / 线程：${system.processCount ?? '当前读取源缺失'} / ${system.threadCount ?? '当前读取源缺失'}`,
      `CPU 队列：${finite(system.cpuQueueLength) === null ? '当前读取源缺失' : system.cpuQueueLength.toFixed(1)}`,
      `主机：${truncate(`${system.manufacturer || ''} ${system.model || ''}`.trim(), 35)}`,
      `系统版本：${truncate(system.osVersion || system.release, 30)}`,
    ]);

    this._renderHardwarePage();
    this._renderManagement();

    this._drawBars({
      cpu: cpu.usage,
      memory: memory.usage,
      gpu: gpu.usage,
      disk: finite(diskIo.usage) ?? diskTotals.usage,
    });
  }

  _hardwareSummaryLines() {
    const data = this._data || {};
    const cpu = data.cpu || {};
    const gpu = data.gpu || {};
    const sensors = data.hardwareSensors;
    const lines = [];
    if (this._visibility.temperature) {
      lines.push(`CPU 温度：${finite(cpu.temperatureC) === null ? sensorUnavailable(data) : formatTemperature(cpu.temperatureC)}`);
      lines.push(`GPU 温度：${finite(gpu.temperatureC) === null ? sensorUnavailable(data, { notApplicable: !gpu.name }) : formatTemperature(gpu.temperatureC)}${finite(gpu.hotspotTemperatureC) === null ? '' : ` · 热点 ${formatTemperature(gpu.hotspotTemperatureC)}`}`);
    }
    if (this._visibility.power) {
      lines.push(`CPU / GPU 功耗：${finite(cpu.powerWatts) === null ? sensorUnavailable(data) : `${cpu.powerWatts.toFixed(1)} W`} / ${finite(gpu.powerWatts) === null ? sensorUnavailable(data, { notApplicable: !gpu.name }) : `${gpu.powerWatts.toFixed(1)} W`}`);
    }
    if (this._visibility.fan) {
      const fanCount = sensors?.fans?.filter((sensor) => finite(sensor.value) !== null).length || 0;
      lines.push(`GPU 风扇：${finite(gpu.fanRpm) === null ? sensorUnavailable(data, { notApplicable: !gpu.name }) : `${Math.round(gpu.fanRpm)} RPM`} · 共读取 ${fanCount} 路`);
    }
    if (this._visibility.voltage) {
      const voltageCount = sensors?.voltages?.filter((sensor) => finite(sensor.value) !== null).length || 0;
      lines.push(`CPU / GPU 电压：${finite(cpu.voltageVolts) === null ? sensorUnavailable(data) : `${cpu.voltageVolts.toFixed(3)} V`} / ${finite(gpu.voltageVolts) === null ? sensorUnavailable(data, { notApplicable: !gpu.name }) : `${gpu.voltageVolts.toFixed(3)} V`} · ${voltageCount} 路`);
    }
    if (this._visibility.storageHealth) {
      const storage = sensors?.storage || [];
      const hottest = maximumNumber(storage.map((item) => item.temperatureC));
      lines.push(`存储传感器：${storage.length ? `${storage.length} 个设备 · 最高 ${formatTemperature(hottest)}` : sensorUnavailable(data)}`);
    }
    if (this._visibility.battery) lines.push(`电池：${batteryStatus(data.battery)}`);
    if (this._visibility.gpu) lines.push(`GPU 驱动：${truncate(gpu.driverVersion, 24)}`);
    return lines.length ? lines : ['所有硬件传感器类别已在管理页隐藏'];
  }

  _renderHardwarePage() {
    if (!this._hardwareDetails || !this._data) return;
    const visibleSensors = (this._data.hardwareSensors?.sensors || [])
      .filter((sensor) => shouldShowSensor(sensor, this._visibility));
    const pages = [];
    const summaryLines = this._hardwareSummaryLines();
    for (let index = 0; index < summaryLines.length; index += this._hardwareDetails.length) {
      pages.push(summaryLines.slice(index, index + this._hardwareDetails.length));
    }
    for (let index = 0; index < visibleSensors.length; index += this._hardwareDetails.length) {
      pages.push(visibleSensors.slice(index, index + this._hardwareDetails.length).map((sensor) => (
        `${truncate(sensor.hardwareName, 13)} · ${truncate(sensor.name, 18)}：${formatSensorValue(sensor, this._data)}`
      )));
    }
    const pageIndex = ((this._hardwarePage % pages.length) + pages.length) % pages.length;
    this._hardwarePage = pageIndex;
    this._hardwareTitle.text = `硬件传感器 ${pageIndex + 1}/${pages.length} · 点击翻页`;
    this._setLines(this._hardwareDetails, pages[pageIndex]);
    this._hardwareDetails.forEach((line) => { line.style.fill = COLORS.muted; });
    if (pageIndex === 0) {
      const firstTemperature = this._data.cpu?.temperatureC ?? this._data.gpu?.temperatureC;
      this._hardwareDetails[0].style.fill = temperatureColor(firstTemperature);
    }
  }

  _setMeter(key, usage, detail, extra) {
    const meter = this._meters[key];
    meter.valueText.text = percent(usage);
    meter.detailText.text = truncate(detail, 48);
    meter.extraText.text = truncate(extra, 64);
  }

  _setLines(targets, values) {
    targets.forEach((target, index) => {
      target.text = truncate(values[index] || '', 48);
    });
  }

  _drawBars(values) {
    this._bars.clear();
    for (const [key, meter] of Object.entries(this._meters)) {
      if (!meter.enabled) continue;
      drawProgressBar(this._bars, meter.x + 12, meter.y + 27, COLUMN_WIDTH - 24, values[key], meter.color);
    }
  }

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
    this._animProgress = clamp(this._animProgress + this._animDirection * dt / 0.35, 0, 1);
    const t = this._animDirection === 1
      ? 1 + 2.70158 * Math.pow(this._animProgress - 1, 3) + 1.70158 * Math.pow(this._animProgress - 1, 2)
      : this._animProgress * this._animProgress;
    this.container.alpha = this._animProgress;
    this.container.scale.set(0.3 + 0.7 * t);

    if (this._animDirection === 1 && this._animProgress >= 1) {
      this._animating = false;
      this.container.alpha = 1;
      this.container.scale.set(1);
      this._animCallback?.();
    } else if (this._animDirection === -1 && this._animProgress <= 0) {
      this._animating = false;
      this.container.visible = false;
      this.container.alpha = 0;
      this._animCallback?.();
    }
  }

  get isAnimating() { return this._animating; }
  get isOpen() { return this.container.visible && this.container.alpha >= 1 && !this._animating; }
  get width() { return PANEL_WIDTH; }
  get height() { return PANEL_HEIGHT; }
}
