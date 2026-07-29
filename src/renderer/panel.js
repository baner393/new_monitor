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
  return finite(value) === null ? '硬件未提供' : `${Math.round(value)}%`;
}

function formatBytes(value, perSecond = false) {
  if (finite(value) === null) return '硬件未提供';
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
    ? '硬件未提供'
    : `${formatBytes(used)} / ${formatBytes(total)}`;
}

function formatClock(mhz) {
  if (finite(mhz) === null) return '硬件未提供';
  return mhz >= 1000 ? `${(mhz / 1000).toFixed(2)} GHz` : `${Math.round(mhz)} MHz`;
}

function formatTemperature(value) {
  return finite(value) === null ? '硬件未提供' : `${Math.round(value)} °C`;
}

function formatDuration(seconds) {
  if (finite(seconds) === null) return '硬件未提供';
  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `${days ? `${days}天 ` : ''}${hours}时 ${minutes}分`;
}

function truncate(value, maxLength) {
  const text = String(value || '硬件未提供');
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

function batteryStatus(battery) {
  if (!battery) return '无电池 / 未提供';
  const chargingCodes = new Set([6, 7, 8, 9, 11]);
  const state = chargingCodes.has(battery.statusCode) ? '充电中' : '电池供电';
  return `${percent(battery.percent)} · ${state}`;
}

export class Panel {
  constructor() {
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

    this._systemLine = makeText('正在读取系统信息…', 12, COLORS.muted);
    this._systemLine.position.set(PADDING, 43);
    this.container.addChild(this._systemLine);

    this._status = makeText('多源采集中', 11, COLORS.dim);
    this._status.anchor.set(1, 0);
    this._status.position.set(PANEL_WIDTH - PADDING, 18);
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

    this._systemTitle = makeText('系统概况', 14, COLORS.title, { bold: true });
    this._systemTitle.position.set(PADDING + 12, 434);
    this.container.addChild(this._systemTitle);
    this._systemDetails = [0, 1, 2, 3, 4].map((index) => {
      const line = makeText(index === 0 ? '正在读取…' : '', 12, index === 0 ? COLORS.text : COLORS.muted);
      line.position.set(PADDING + 12, 458 + index * 21);
      this.container.addChild(line);
      return line;
    });

    this._hardwareTitle = makeText('硬件与传感器', 14, COLORS.gpu, { bold: true });
    this._hardwareTitle.position.set(detailX, 434);
    this.container.addChild(this._hardwareTitle);
    this._hardwareDetails = [0, 1, 2, 3, 4].map((index) => {
      const line = makeText(index === 0 ? '正在读取…' : '', 12, index === 0 ? COLORS.text : COLORS.muted);
      line.position.set(detailX, 458 + index * 21);
      this.container.addChild(line);
      return line;
    });

    this._data = null;
    this._animating = false;
    this._animProgress = 0;
    this._animDirection = 1;
    this._animCallback = null;
    this._drawBars({});
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

    return { x, y, color, valueText, detailText, extraText };
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
      `${formatTemperature(gpu.temperatureC)} · ${finite(gpu.powerWatts) === null ? '功耗硬件未提供' : `${gpu.powerWatts.toFixed(1)} W`} · ${gpu.adapters?.length || (gpu.name ? 1 : 0)} 个适配器`,
    );

    this._setMeter('disk', finite(diskIo.usage) ?? diskTotals.usage,
      `容量 ${formatPair(diskTotals.used, diskTotals.total)}`,
      `读 ${formatBytes(diskIo.readBytesPerSec, true)} · 写 ${formatBytes(diskIo.writeBytesPerSec, true)} · 队列 ${finite(diskIo.queueLength) === null ? '未提供' : diskIo.queueLength.toFixed(1)}`,
    );

    this._networkValue.text = `↓ ${formatBytes(network.downloadBytesPerSec, true)}    ↑ ${formatBytes(network.uploadBytesPerSec, true)}`;
    const sortedInterfaces = [...(network.interfaces || [])].sort(
      (a, b) => (b.totalBytesPerSec ?? 0) - (a.totalBytesPerSec ?? 0),
    );
    const activeInterface = sortedInterfaces[0];
    this._networkDetail.text = `活动接口：${truncate(activeInterface?.name, 35)} · 共 ${sortedInterfaces.length} 个接口`;
    this._networkExtra.text = `链路速度：${finite(activeInterface?.linkSpeedBits) === null ? '硬件未提供' : `${formatBytes(activeInterface.linkSpeedBits / 8, true)}`} · 收发包 ${finite(activeInterface?.packetsReceivedPerSec) === null ? '未提供' : `${Math.round(activeInterface.packetsReceivedPerSec + (activeInterface.packetsSentPerSec || 0))}/s`}`;

    const diskLines = disks.slice(0, 4).map((disk) => (
      `${disk.name} ${percent(disk.usage)} · ${formatPair(disk.usedBytes, disk.sizeBytes)}${disk.volumeName ? ` · ${truncate(disk.volumeName, 10)}` : ''}`
    ));
    if (disks.length > 4) diskLines[3] = `另有 ${disks.length - 3} 个分区 · 总占用 ${percent(diskTotals.usage)}`;
    this._setLines(this._storageLines, diskLines.length ? diskLines : ['硬件未提供']);

    this._setLines(this._systemDetails, [
      `运行时间：${formatDuration(system.uptimeSec)}`,
      `进程 / 线程：${system.processCount ?? '未提供'} / ${system.threadCount ?? '未提供'}`,
      `CPU 队列：${finite(system.cpuQueueLength) === null ? '硬件未提供' : system.cpuQueueLength.toFixed(1)}`,
      `主机：${truncate(`${system.manufacturer || ''} ${system.model || ''}`.trim(), 35)}`,
      `系统版本：${truncate(system.osVersion || system.release, 30)}`,
    ]);

    const thermal = data.thermalZones?.[0]?.temperatureC;
    this._setLines(this._hardwareDetails, [
      `系统热区：${formatTemperature(thermal)}`,
      `GPU 温度：${formatTemperature(gpu.temperatureC)}`,
      `GPU 功耗：${finite(gpu.powerWatts) === null ? '硬件未提供' : `${gpu.powerWatts.toFixed(1)} W`}`,
      `电池：${batteryStatus(data.battery)}`,
      `GPU 驱动：${truncate(gpu.driverVersion, 24)}`,
    ]);
    this._hardwareDetails[0].style.fill = temperatureColor(thermal);
    this._hardwareDetails[1].style.fill = temperatureColor(gpu.temperatureC);

    this._drawBars({
      cpu: cpu.usage,
      memory: memory.usage,
      gpu: gpu.usage,
      disk: finite(diskIo.usage) ?? diskTotals.usage,
    });
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
