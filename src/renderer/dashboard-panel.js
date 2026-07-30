import * as PIXI from 'pixi.js';
import {
  applyMonitorPreset,
  CARD_IDS,
  CARD_LABELS,
  cloneMonitorPanelConfig,
  createDefaultMonitorPanelConfig,
  DEFAULT_TEMPERATURE_THRESHOLDS,
  migrateLegacyMonitorVisibility,
  normalizeMonitorPanelConfig,
  PRESET_LABELS,
} from '../shared/monitor-panel-config.js';
import { MonitorConfigDraft } from '../shared/monitor-config-draft.js';
import { calculateOverviewHeight, layoutDashboardCards } from './panel-layout.js';
import {
  deriveDashboardReadings,
  detectDashboardCardAvailability,
  effectiveDashboardCardIds,
  normalizeBatteryState,
  reorderDashboardCards,
} from './dashboard-model.js';
import {
  AdaptiveSpeedTracker,
  capacityColor,
  paginate,
  remainingCapacityColor,
  temperatureColor,
  temperatureRatio,
} from './monitor-visuals.js';

const PANEL_WIDTH = 700;
const MANAGEMENT_HEIGHT = 620;
const DETAIL_HEIGHT = 620;
const MIN_OVERVIEW_HEIGHT = 170;
const MAX_OVERVIEW_HEIGHT = 700;
const PADDING = 20;
const GAP = 8;

const COLORS = Object.freeze({
  background: 0x0e1018,
  border: 0x62708a,
  section: 0x171c2a,
  sectionBorder: 0x39445c,
  title: 0x55ff88,
  text: 0xf0f3f8,
  muted: 0xaeb8ca,
  dim: 0x76839b,
  cpu: 0x55ccff,
  memory: 0xbb77ff,
  gpu: 0x66dd88,
  storage: 0xffb84d,
  network: 0x55bbff,
  cooling: 0x78d9ff,
  power: 0xffd166,
  battery: 0x71e58b,
  upload: 0xff88bb,
  warning: 0xffcc55,
  danger: 0xff4d5a,
});

const CARD_SPECS = Object.freeze({
  cpu: { height: 104, color: COLORS.cpu },
  memory: { height: 104, color: COLORS.memory },
  gpu: { height: 112, color: COLORS.gpu },
  network: { height: 112, color: COLORS.network },
  storage: { height: 148, color: COLORS.storage, span: 2 },
  cooling: { height: 104, color: COLORS.cooling },
  power: { height: 104, color: COLORS.power },
  battery: { height: 104, color: COLORS.battery },
});

const THRESHOLD_LABELS = ['冷', '正常', '偏热', '危险'];

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function percent(value) {
  return finite(value) === null ? '读取源缺失' : `${Math.round(value)}%`;
}

function formatBytes(value, perSecond = false) {
  if (finite(value) === null) return '读取源缺失';
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
    ? '读取源缺失'
    : `${formatBytes(used)} / ${formatBytes(total)}`;
}

function formatClock(mhz) {
  if (finite(mhz) === null) return '读取源缺失';
  return mhz >= 1000 ? `${(mhz / 1000).toFixed(2)} GHz` : `${Math.round(mhz)} MHz`;
}

function formatDuration(seconds) {
  if (finite(seconds) === null) return '读取源缺失';
  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `${days ? `${days}天 ` : ''}${hours}时 ${minutes}分`;
}

function truncate(value, maxLength) {
  const text = String(value ?? '读取源缺失');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
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

function addText(parent, text, x, y, size = 13, color = COLORS.text, options = {}) {
  const object = makeText(text, size, color, options);
  object.position.set(x, y);
  parent.addChild(object);
  return object;
}

function drawPixelPanel(graphics, x, y, width, height, fill, border, alpha = 0.9) {
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
  graphics.beginFill(0xffffff, 0.055);
  graphics.drawRect(x + cut, y + 2, width - cut * 2, 2);
  graphics.endFill();
  graphics.beginFill(0x000000, 0.2);
  graphics.drawRect(x + cut, y + height - 4, width - cut * 2, 2);
  graphics.endFill();
}

function drawBar(graphics, x, y, width, value, color, height = 9) {
  const ratio = finite(value) === null ? 0 : clamp(value / 100, 0, 1);
  graphics.beginFill(0x080b12, 0.9);
  graphics.drawRect(x, y, width, height);
  graphics.endFill();
  graphics.lineStyle(1, 0x48536a, 0.75);
  graphics.drawRect(x, y, width, height);
  graphics.lineStyle(0);
  if (ratio <= 0) return;
  const fillWidth = Math.max(2, (width - 2) * ratio);
  graphics.beginFill(color, 0.92);
  graphics.drawRect(x + 1, y + 1, fillWidth, height - 2);
  graphics.endFill();
  graphics.beginFill(0xffffff, 0.18);
  graphics.drawRect(x + 1, y + 1, fillWidth, 2);
  graphics.endFill();
}

function drawTemperatureRail(graphics, x, y, width, value, thresholds) {
  const ratio = temperatureRatio(value, thresholds);
  const segments = 14;
  const gap = 2;
  const segmentWidth = (width - gap * (segments - 1)) / segments;
  for (let index = 0; index < segments; index += 1) {
    const progress = (index + 1) / segments;
    const sample = thresholds[0] - 15 + progress * (thresholds[3] - thresholds[0] + 15);
    const active = ratio !== null && progress <= ratio + 1 / segments;
    graphics.beginFill(active ? temperatureColor(sample, thresholds) : 0x222938, active ? 0.95 : 0.72);
    graphics.drawRect(x + index * (segmentWidth + gap), y, segmentWidth, 7);
    graphics.endFill();
  }
}

function clearContainer(container) {
  for (const child of container.removeChildren()) child.destroy?.({ children: true });
}

function diskTotals(disks) {
  const valid = (disks || []).filter((disk) => finite(disk.sizeBytes) !== null);
  if (!valid.length) return { total: null, used: null, usage: null };
  const total = valid.reduce((sum, disk) => sum + disk.sizeBytes, 0);
  const used = valid.reduce((sum, disk) => sum + (finite(disk.usedBytes) || 0), 0);
  return { total, used, usage: total > 0 ? used / total * 100 : null };
}

function sensorUnavailable(data, notApplicable = false) {
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
    Current: () => `${value.toFixed(3)} A`,
    Power: () => `${value.toFixed(2)} W`,
    Clock: () => formatClock(value),
    Load: () => `${value.toFixed(1)}%`,
    Control: () => `${value.toFixed(1)}%`,
    Level: () => `${value.toFixed(1)}%`,
    Data: () => `${value.toFixed(2)} GB`,
    SmallData: () => `${value.toFixed(2)} MB`,
    Throughput: () => `${value.toFixed(1)} B/s`,
    Energy: () => `${value.toFixed(2)} mWh`,
    Frequency: () => `${value.toFixed(1)} Hz`,
  };
  return formats[sensor.sensorType]?.() || value.toFixed(2);
}

function makeButton(parent, label, x, y, width, height, onTap, options = {}) {
  const button = new PIXI.Container();
  button.position.set(x, y);
  button.eventMode = options.disabled ? 'none' : 'static';
  button.cursor = options.disabled ? 'default' : 'pointer';
  button.hitArea = new PIXI.Rectangle(0, 0, width, height);
  const graphic = new PIXI.Graphics();
  drawPixelPanel(
    graphic, 0, 0, width, height,
    options.active ? 0x1d5530 : options.disabled ? 0x151923 : 0x1c2535,
    options.active ? COLORS.title : options.disabled ? COLORS.dim : COLORS.sectionBorder,
    0.96,
  );
  button.addChild(graphic);
  const text = makeText(label, options.size || 12, options.disabled ? COLORS.dim : COLORS.text, { bold: options.bold });
  text.anchor.set(0.5);
  text.position.set(width / 2, height / 2);
  button.addChild(text);
  if (!options.disabled) button.on('pointertap', (event) => {
    event?.stopPropagation?.();
    onTap?.(event);
  });
  parent.addChild(button);
  return button;
}

function cardTemperatureKind(cardId) {
  if (cardId === 'cpu') return 'cpu';
  if (cardId === 'gpu') return 'gpu';
  if (cardId === 'storage') return 'storage';
  return 'unknown';
}

export class Panel {
  constructor({ onConfigurationCommit = null, onVisibilityChange = null, onRequestElevation = null } = {}) {
    this._onConfigurationCommit = onConfigurationCommit;
    this._onVisibilityChange = onVisibilityChange;
    this._onRequestElevation = onRequestElevation;
    this._config = createDefaultMonitorPanelConfig();
    this._draftSession = null;
    this._data = null;
    this._page = 'overview';
    this._manageSection = 'layout';
    this._detailCard = null;
    this._detailPage = 0;
    this._partitionPage = 0;
    this._thresholdDeviceIndex = 0;
    this._overviewHeight = MIN_OVERVIEW_HEIGHT;
    this._animating = false;
    this._animProgress = 0;
    this._animDirection = 1;
    this._animCallback = null;
    this._motionTime = 0;
    this._speedTracker = new AdaptiveSpeedTracker();
    this._motionPreference = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    this._reducedMotion = this._motionPreference?.matches || false;
    this._motionPreference?.addEventListener?.('change', (event) => {
      this._reducedMotion = event.matches;
      this._drawMotion();
      if (this._page === 'manage') this._renderManagement();
    });
    this._drag = null;

    this.container = new PIXI.Container();
    this.container.visible = false;
    this.container.alpha = 0;

    this._background = new PIXI.Graphics();
    this.container.addChild(this._background);
    this._overviewLayer = new PIXI.Container();
    this._detailLayer = new PIXI.Container();
    this._managementLayer = new PIXI.Container();
    this.container.addChild(this._overviewLayer, this._detailLayer, this._managementLayer);

    this._title = addText(this.container, '系统资源监控', PADDING, 13, 20, COLORS.title, { bold: true });
    this._systemLine = addText(this.container, '正在读取系统信息…', PADDING, 42, 11, COLORS.muted);
    this._systemLine.eventMode = 'static';
    this._systemLine.cursor = 'pointer';
    this._systemLine.on('pointertap', () => this._openDetail('system'));
    this._status = addText(this.container, '采集中', PANEL_WIDTH - PADDING, 42, 11, COLORS.dim);
    this._status.anchor.set(1, 0);
    this._overviewTab = addText(this.container, '概览', 510, 15, 13, COLORS.title, { bold: true });
    this._overviewTab.eventMode = 'static';
    this._overviewTab.cursor = 'pointer';
    this._overviewTab.on('pointertap', () => this._leaveToOverview(true));
    this._manageTab = addText(this.container, '监控管理', 557, 15, 13, COLORS.muted, { bold: true });
    this._manageTab.eventMode = 'static';
    this._manageTab.cursor = 'pointer';
    this._manageTab.on('pointertap', () => this._openManagement());

    this._cards = new Map();
    for (const id of CARD_IDS) this._cards.set(id, this._createCard(id));
    this._emptyText = addText(this._overviewLayer, '当前布局没有可显示的卡片 · 请到“监控管理”调整', PANEL_WIDTH / 2, 107, 13, COLORS.muted, { bold: true });
    this._emptyText.anchor.set(0.5, 0);
    this._applyCardLayout();
    this._showPage('overview');
  }

  _createCard(id) {
    const spec = CARD_SPECS[id];
    const container = new PIXI.Container();
    const background = new PIXI.Graphics();
    const staticGraphic = new PIXI.Graphics();
    const motionGraphic = new PIXI.Graphics();
    const content = new PIXI.Container();
    container.addChild(background, staticGraphic, motionGraphic, content);
    container.eventMode = 'static';
    container.cursor = 'pointer';
    container.on('pointertap', () => this._openDetail(id));
    this._overviewLayer.addChild(container);
    return { id, spec, container, background, staticGraphic, motionGraphic, content, width: 0, height: spec.height };
  }

  setConfiguration(config) {
    this._config = normalizeMonitorPanelConfig(config);
    this._draftSession = null;
    this._applyCardLayout();
    this._renderAll();
  }

  setVisibility(visibility) {
    this.setConfiguration(migrateLegacyMonitorVisibility(visibility, this._config));
  }

  getConfiguration() {
    return cloneMonitorPanelConfig(this._config);
  }

  commitPendingConfiguration() {
    this._commitDraft();
  }

  _cardAvailability() {
    return detectDashboardCardAvailability(this._data || {});
  }

  _effectiveCardIds() {
    return effectiveDashboardCardIds(this._config, this._data || {});
  }

  _applyCardLayout() {
    const visibleIds = this._effectiveCardIds();
    const cards = visibleIds.map((id) => ({ key: id, ...CARD_SPECS[id] }));
    const placements = layoutDashboardCards(cards, {
      panelWidth: PANEL_WIDTH,
      padding: PADDING,
      columnGap: 16,
      top: 66,
      rowGap: GAP,
    });
    const visible = new Set(visibleIds);
    for (const [id, card] of this._cards) card.container.visible = visible.has(id);
    for (const placement of placements) {
      const card = this._cards.get(placement.key);
      card.container.position.set(placement.x, placement.y);
      card.width = placement.width;
      card.height = placement.height;
      card.container.hitArea = new PIXI.Rectangle(0, 0, card.width, card.height);
      card.background.clear();
      drawPixelPanel(card.background, 0, 0, card.width, card.height, COLORS.section, COLORS.sectionBorder, 0.78);
    }
    this._emptyText.visible = this._page === 'overview' && placements.length === 0;
    this._overviewHeight = calculateOverviewHeight(placements, {
      minHeight: MIN_OVERVIEW_HEIGHT,
      maxHeight: MAX_OVERVIEW_HEIGHT,
      padding: PADDING,
    });
    this._drawChrome();
    this._clampToViewport();
  }

  _drawChrome() {
    const height = this.height;
    this._background.clear();
    for (let spread = 14; spread >= 4; spread -= 5) {
      drawPixelPanel(this._background, -spread, -spread, PANEL_WIDTH + spread * 2, height + spread * 2, 0x5588bb, 0x5588bb, 0.018);
    }
    drawPixelPanel(this._background, 0, 0, PANEL_WIDTH, height, COLORS.background, COLORS.border, 0.94);
  }

  _showPage(page) {
    this._page = page;
    this._overviewLayer.visible = page === 'overview';
    this._detailLayer.visible = page === 'detail';
    this._managementLayer.visible = page === 'manage';
    this._overviewTab.style.fill = page === 'overview' || page === 'detail' ? COLORS.title : COLORS.muted;
    this._manageTab.style.fill = page === 'manage' ? COLORS.title : COLORS.muted;
    this._emptyText.visible = page === 'overview' && this._effectiveCardIds().length === 0;
    this._drawChrome();
    this._clampToViewport();
  }

  _leaveToOverview(commitDraft) {
    if (this._page === 'manage' && commitDraft) this._commitDraft();
    this._detailCard = null;
    this._showPage('overview');
    this._applyCardLayout();
    this._renderAll();
  }

  _openManagement() {
    if (this._page !== 'manage') {
      this._draftSession = new MonitorConfigDraft(this._config);
    }
    this._showPage('manage');
    this._renderManagement();
  }

  _setDraft(next) {
    this._draftSession ||= new MonitorConfigDraft(this._config);
    this._config = this._draftSession.update(next);
    this._applyCardLayout();
    this._renderAll();
    this._renderManagement();
  }

  _commitDraft() {
    if (!this._draftSession?.dirty) return;
    this._config = this._draftSession.commit();
    this._onConfigurationCommit?.(cloneMonitorPanelConfig(this._config));
    this._onVisibilityChange?.(this._config.layout.enabled);
  }

  _cancelDraft() {
    if (this._draftSession) this._config = this._draftSession.cancel();
    this._draftSession = null;
    this._leaveToOverview(false);
  }

  _temperatureThresholds(kind, identifier = null) {
    if (identifier && this._config.sensors.temperatureOverrides[identifier]) {
      return this._config.sensors.temperatureOverrides[identifier];
    }
    return this._config.sensors.temperatureDefaults[kind]
      || DEFAULT_TEMPERATURE_THRESHOLDS[kind]
      || DEFAULT_TEMPERATURE_THRESHOLDS.unknown;
  }

  _renderAll() {
    if (!this._data) return;
    this._applyCardLayout();
    for (const id of this._effectiveCardIds()) this._renderCard(this._cards.get(id));
    if (this._page === 'detail') this._renderDetail();
    if (this._page === 'manage' && !this._drag) this._renderManagement();
  }

  _renderCard(card) {
    card.staticGraphic.clear();
    clearContainer(card.content);
    const data = this._data || {};
    const readings = deriveDashboardReadings(data);
    const color = card.spec.color;
    const width = card.width;
    const title = addText(card.content, CARD_LABELS[card.id], 11, 7, 14, color, { bold: true });
    title.eventMode = 'none';

    const barRow = (label, value, display, y, identity = color, capacity = false, remaining = false) => {
      addText(card.content, label, 11, y, 10, COLORS.muted);
      const valueText = addText(card.content, display, width - 11, y - 1, 11, COLORS.text, { numeric: true, bold: true });
      valueText.anchor.set(1, 0);
      const barColor = remaining
        ? remainingCapacityColor(identity, value)
        : capacity ? capacityColor(identity, value) : identity;
      drawBar(card.staticGraphic, 11, y + 17, width - 22, value, barColor, 8);
    };
    const temperatureRow = (label, value, kind, y, identifier = null) => {
      const thresholds = this._temperatureThresholds(kind, identifier);
      addText(card.content, label, 11, y, 10, COLORS.muted);
      const reading = addText(card.content, finite(value) === null ? sensorUnavailable(data) : `${Math.round(value)} °C`, width - 11, y - 1, 11, temperatureColor(value, thresholds), { numeric: true, bold: true });
      reading.anchor.set(1, 0);
      drawTemperatureRail(card.staticGraphic, 11, y + 17, width - 22, value, thresholds);
    };

    if (card.id === 'cpu') {
      const cpu = data.cpu || {};
      barRow('总负载', cpu.usage, percent(cpu.usage), 27);
      if (this._config.sensors.visible.temperature) temperatureRow('热状态', readings.cpuTemperatureC, 'cpu', 61, readings.cpuTemperatureIdentifier);
      addText(card.content, `${formatClock(cpu.currentClockMHz)} · ${cpu.physicalCores ?? '?'}核/${cpu.logicalCores ?? '?'}线程`, 11, 87, 10, COLORS.dim);
      return;
    }
    if (card.id === 'memory') {
      const memory = data.memory || {};
      barRow('物理内存', memory.usage, `${percent(memory.usage)} · ${formatPair(memory.usedBytes, memory.totalBytes)}`, 27, color, true);
      const pageTotal = finite(memory.pageFileTotalBytes);
      const pageUsed = pageTotal !== null && finite(memory.pageFileAvailableBytes) !== null
        ? pageTotal - memory.pageFileAvailableBytes : null;
      const pageUsage = pageTotal > 0 && finite(pageUsed) !== null ? pageUsed / pageTotal * 100 : null;
      barRow('页面文件', pageUsage, formatPair(pageUsed, pageTotal), 62, color, true);
      return;
    }
    if (card.id === 'gpu') {
      const gpu = data.gpu || {};
      barRow('核心负载', readings.gpuUsage, percent(readings.gpuUsage), 25);
      barRow('显存容量', gpu.memoryUsage, formatPair(gpu.memoryUsedBytes, gpu.memoryTotalBytes), 55, color, true);
      if (this._config.sensors.visible.temperature) temperatureRow('热状态', readings.gpuTemperatureC, 'gpu', 84, readings.gpuTemperatureIdentifier);
      return;
    }
    if (card.id === 'network') {
      const network = data.network || {};
      const down = formatBytes(readings.networkDownloadBytesPerSec, true);
      const up = formatBytes(readings.networkUploadBytesPerSec, true);
      addText(card.content, `↓ ${down}`, 11, 33, 16, COLORS.network, { numeric: true, bold: true });
      const upText = addText(card.content, `↑ ${up}`, width - 11, 33, 16, COLORS.upload, { numeric: true, bold: true });
      upText.anchor.set(1, 0);
      const active = [...(network.interfaces || [])].sort((a, b) => (b.totalBytesPerSec || 0) - (a.totalBytesPerSec || 0))[0];
      const activeName = readings.networkInterfaceName || active?.name || '无活动接口';
      const activeInterface = (network.interfaces || []).find((item) => item.name === activeName) || active;
      addText(card.content, `${truncate(activeName, 25)} · 链路 ${finite(activeInterface?.linkSpeedBits) === null ? '未知' : formatBytes(activeInterface.linkSpeedBits / 8, true)}`, 11, 88, 10, COLORS.dim);
      return;
    }
    if (card.id === 'storage') {
      const totals = diskTotals(data.disks);
      barRow('总容量', totals.usage, `${percent(totals.usage)} · ${formatPair(totals.used, totals.total)}`, 24, color, true);
      const page = paginate(data.disks || [], this._partitionPage, 4);
      this._partitionPage = page.page;
      const columnWidth = (width - 34) / 2;
      page.items.forEach((disk, index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const x = 11 + column * (columnWidth + 12);
        const y = 59 + row * 30;
        addText(card.content, `${disk.name}${disk.volumeName ? ` ${truncate(disk.volumeName, 10)}` : ''}`, x, y, 10, COLORS.muted);
        const value = addText(card.content, percent(disk.usage), x + columnWidth, y, 10, COLORS.text, { numeric: true });
        value.anchor.set(1, 0);
        drawBar(card.staticGraphic, x, y + 17, columnWidth, disk.usage, capacityColor(color, disk.usage), 7);
      });
      if (page.pageCount > 1) {
        const pageButton = makeButton(card.content, `${page.page + 1}/${page.pageCount} ›`, width - 66, 4, 55, 24, () => {
          this._partitionPage = (this._partitionPage + 1) % page.pageCount;
          this._renderCard(card);
        }, { size: 10 });
        pageButton.cursor = 'pointer';
      }
      const io = data.diskIo || {};
      addText(card.content, `读 ${formatBytes(readings.diskReadBytesPerSec, true)} · 写 ${formatBytes(readings.diskWriteBytesPerSec, true)} · 活跃 ${percent(readings.diskActivity)}`, 11, 116, 10, COLORS.dim);
      if (readings.storageTemperatureC !== null && this._config.sensors.visible.temperature) {
        const temp = addText(card.content, `${Math.round(readings.storageTemperatureC)} °C`, width - 11, 115, 10, temperatureColor(readings.storageTemperatureC, this._temperatureThresholds('storage', readings.storageTemperatureIdentifier)), { numeric: true, bold: true });
        temp.anchor.set(1, 0);
      }
      return;
    }
    if (card.id === 'cooling') {
      const fans = (data.hardwareSensors?.fans || []).filter((sensor) => finite(sensor.value) !== null);
      const controls = (data.hardwareSensors?.sensors || []).filter((sensor) => (
        sensor.sensorType === 'Control' && /fan/i.test(sensor.name || '') && finite(sensor.value) !== null
      ));
      const fastest = fans.length ? Math.max(...fans.map((sensor) => sensor.value)) : null;
      const highestControl = controls.length ? Math.max(...controls.map((sensor) => sensor.value)) : null;
      const primaryReading = finite(fastest) !== null
        ? `${Math.round(fastest)} RPM`
        : finite(highestControl) !== null ? `${Math.round(highestControl)}%` : sensorUnavailable(data);
      addText(card.content, primaryReading, 11, 35, 18, color, { numeric: true, bold: true });
      addText(card.content, `${fans.length} 路转速 · ${controls.length} 路控制 · 点击查看明细`, 11, 72, 10, COLORS.dim);
      return;
    }
    if (card.id === 'power') {
      const cpuPower = readings.cpuPowerWatts;
      const gpuPower = readings.gpuPowerWatts;
      addText(card.content, 'CPU', 11, 32, 10, COLORS.muted);
      addText(card.content, finite(cpuPower) === null ? sensorUnavailable(data) : `${cpuPower.toFixed(1)} W`, 55, 29, 15, color, { numeric: true, bold: true });
      addText(card.content, 'GPU', 11, 58, 10, COLORS.muted);
      addText(card.content, finite(gpuPower) === null ? sensorUnavailable(data, !data.gpu?.name) : `${gpuPower.toFixed(1)} W`, 55, 55, 15, COLORS.gpu, { numeric: true, bold: true });
      const voltageCount = (data.hardwareSensors?.voltages || []).filter((sensor) => finite(sensor.value) !== null).length;
      addText(card.content, `${voltageCount} 路电压传感器`, 11, 82, 10, COLORS.dim);
      return;
    }
    if (card.id === 'battery') {
      const battery = data.battery || {};
      const batteryState = normalizeBatteryState(battery);
      barRow('剩余电量', battery.percent, percent(battery.percent), 29, color, true, true);
      addText(card.content, `${batteryState.label} · ${batteryState.estimatedMinutes === null ? '剩余时间未知' : `约 ${Math.round(batteryState.estimatedMinutes)} 分钟`}`, 11, 75, 10, COLORS.dim);
    }
  }

  _updateSpeedTrackers() {
    const data = this._data || {};
    const readings = deriveDashboardReadings(data);
    this._speedTracker.update('networkDown', readings.networkDownloadBytesPerSec);
    this._speedTracker.update('networkUp', readings.networkUploadBytesPerSec);
    this._speedTracker.update('diskRead', readings.diskReadBytesPerSec);
    this._speedTracker.update('diskWrite', readings.diskWriteBytesPerSec);
    const fans = (data.hardwareSensors?.fans || []).map((sensor) => finite(sensor.value)).filter(Number.isFinite);
    const fanControls = (data.hardwareSensors?.sensors || [])
      .filter((sensor) => sensor.sensorType === 'Control' && /fan/i.test(sensor.name || ''))
      .map((sensor) => finite(sensor.value))
      .filter(Number.isFinite);
    const fanMotionValue = fans.length
      ? Math.max(...fans)
      : fanControls.length ? Math.max(...fanControls) * 18 : null;
    this._speedTracker.update('fan', fanMotionValue);
  }

  _drawMotion() {
    for (const card of this._cards.values()) card.motionGraphic.clear();
    if (this._page !== 'overview' || !this.container.visible || !this._config.motion.enabled) return;
    const staticOnly = this._reducedMotion;
    this._drawNetworkMotion(this._cards.get('network'), staticOnly);
    this._drawStorageMotion(this._cards.get('storage'), staticOnly);
    this._drawCoolingMotion(this._cards.get('cooling'), staticOnly);
  }

  _drawNetworkMotion(card, staticOnly) {
    if (!card?.container.visible) return;
    const down = this._speedTracker.snapshot('networkDown').animated;
    const up = this._speedTracker.snapshot('networkUp').animated;
    const g = card.motionGraphic;
    const laneWidth = card.width - 22;
    const drawLane = (y, level, color, reverse) => {
      g.lineStyle(1, color, 0.22 + level * 0.08);
      g.moveTo(11, y);
      g.lineTo(card.width - 11, y);
      g.lineStyle(0);
      const idle = level <= 0.02;
      const count = idle ? 1 : Math.max(1, Math.ceil(level * 2.5));
      for (let index = 0; index < count; index += 1) {
        const phase = staticOnly || idle ? (index + 1) / (count + 1) : (this._motionTime * (0.12 + level * 0.09) + index / count) % 1;
        const x = 11 + laneWidth * (reverse ? 1 - phase : phase);
        g.beginFill(color, 0.45 + level * 0.11);
        g.drawRect(x, y - 2, 3 + level * 1.4, 4);
        g.endFill();
      }
    };
    drawLane(68, down, COLORS.network, false);
    drawLane(76, up, COLORS.upload, true);
  }

  _drawStorageMotion(card, staticOnly) {
    if (!card?.container.visible) return;
    const read = this._speedTracker.snapshot('diskRead').animated;
    const write = this._speedTracker.snapshot('diskWrite').animated;
    const g = card.motionGraphic;
    const startX = card.width * 0.52;
    const laneWidth = card.width * 0.42;
    const drawBlocks = (y, level, color, reverse) => {
      const idle = level <= 0.02;
      const count = idle ? 1 : Math.max(1, Math.ceil(level * 2));
      for (let index = 0; index < count; index += 1) {
        const phase = staticOnly || idle ? (index + 1) / (count + 1) : (this._motionTime * (0.1 + level * 0.07) + index / count) % 1;
        const x = startX + laneWidth * (reverse ? 1 - phase : phase);
        g.beginFill(color, 0.35 + level * 0.12);
        g.drawRect(x, y, 5 + level, 4);
        g.endFill();
      }
    };
    drawBlocks(132, read, COLORS.network, false);
    drawBlocks(140, write, COLORS.storage, true);
  }

  _drawCoolingMotion(card, staticOnly) {
    if (!card?.container.visible) return;
    const level = this._speedTracker.snapshot('fan').animated;
    const g = card.motionGraphic;
    const cx = card.width - 48;
    const cy = 54;
    const angle = staticOnly || level <= 0.02 ? 0 : this._motionTime * (0.7 + level * 2.2);
    g.lineStyle(1, COLORS.cooling, 0.35 + level * 0.1);
    g.drawCircle(cx, cy, 20);
    g.lineStyle(0);
    for (let blade = 0; blade < 4; blade += 1) {
      const a = angle + blade * Math.PI / 2;
      const x1 = cx + Math.cos(a) * 4;
      const y1 = cy + Math.sin(a) * 4;
      const x2 = cx + Math.cos(a + 0.35) * (11 + level * 1.5);
      const y2 = cy + Math.sin(a + 0.35) * (11 + level * 1.5);
      const x3 = cx + Math.cos(a + 0.9) * (17 + level);
      const y3 = cy + Math.sin(a + 0.9) * (17 + level);
      g.beginFill(COLORS.cooling, 0.38 + level * 0.11);
      g.drawPolygon([x1, y1, x2, y2, x3, y3]);
      g.endFill();
    }
    g.beginFill(COLORS.text, 0.9);
    g.drawCircle(cx, cy, 3);
    g.endFill();
  }

  update(data) {
    this._data = data || null;
    if (!data) {
      this._status.text = '等待采集器';
      return;
    }
    const system = data.system || {};
    this._systemLine.text = truncate(`${system.hostname || '本机'} · ${system.osName || system.platform || '系统未知'} ${system.arch || ''}`, 72);
    const providers = [...new Set(data.providers || [])];
    this._status.text = `${providers.length || 1} 路数据源`;
    this._status.style.fill = data.diagnostics?.windowsError ? COLORS.warning : COLORS.dim;
    this._updateSpeedTrackers();
    this._renderAll();
  }

  _openDetail(cardId) {
    if (!this._data || this._page === 'manage') return;
    this._detailCard = cardId;
    this._detailPage = 0;
    this._showPage('detail');
    this._renderDetail();
  }

  _sensorsForDetail(cardId) {
    const sensors = this._data?.hardwareSensors?.sensors || [];
    const visible = this._config.sensors.visible;
    const allowedType = (sensor) => {
      if (sensor.sensorType === 'Temperature') return visible.temperature;
      if (sensor.sensorType === 'Power') return visible.power;
      if (sensor.sensorType === 'Fan' || sensor.sensorType === 'Control') return visible.fan;
      if (sensor.sensorType === 'Voltage' || sensor.sensorType === 'Current') return visible.voltage;
      return true;
    };
    return sensors.filter((sensor) => {
      if (!allowedType(sensor)) return false;
      if (cardId === 'cpu') return /^Cpu$/i.test(sensor.hardwareType);
      if (cardId === 'memory') return /^Memory$/i.test(sensor.hardwareType);
      if (cardId === 'gpu') return /^Gpu/i.test(sensor.hardwareType);
      if (cardId === 'storage') return /^Storage$/i.test(sensor.hardwareType);
      if (cardId === 'network') return /^Network$/i.test(sensor.hardwareType);
      if (cardId === 'cooling') return ['Fan', 'Control'].includes(sensor.sensorType);
      if (cardId === 'power') return ['Power', 'Voltage', 'Current'].includes(sensor.sensorType);
      if (cardId === 'battery') return /^Battery$/i.test(sensor.hardwareType);
      return true;
    });
  }

  _detailSummary(cardId) {
    const data = this._data || {};
    const readings = deriveDashboardReadings(data);
    const totals = diskTotals(data.disks);
    const batteryState = normalizeBatteryState(data.battery);
    const summaries = {
      cpu: [
        `型号：${data.cpu?.model || '读取源缺失'}`,
        `负载：${percent(data.cpu?.usage)} · 当前频率 ${formatClock(data.cpu?.currentClockMHz)}`,
        `核心：${data.cpu?.physicalCores ?? '?'} 核 / ${data.cpu?.logicalCores ?? '?'} 线程`,
        `温度：${readings.cpuTemperatureC === null ? sensorUnavailable(data) : `${readings.cpuTemperatureC.toFixed(1)} °C`}`,
      ],
      memory: [
        `物理内存：${formatPair(data.memory?.usedBytes, data.memory?.totalBytes)}`,
        `可用：${formatBytes(data.memory?.availableBytes)}`,
        `页面文件：${formatPair(
          finite(data.memory?.pageFileTotalBytes) !== null && finite(data.memory?.pageFileAvailableBytes) !== null
            ? data.memory.pageFileTotalBytes - data.memory.pageFileAvailableBytes : null,
          data.memory?.pageFileTotalBytes,
        )}`,
      ],
      gpu: [
        `设备：${data.gpu?.name || '本机无此设备'}`,
        `负载：${percent(readings.gpuUsage)} · 显存 ${formatPair(data.gpu?.memoryUsedBytes, data.gpu?.memoryTotalBytes)}`,
        `温度：${readings.gpuTemperatureC === null ? sensorUnavailable(data, !data.gpu?.name) : `${readings.gpuTemperatureC.toFixed(1)} °C`}`,
        `驱动：${data.gpu?.driverVersion || '读取源缺失'}`,
      ],
      network: [
        `下载：${formatBytes(readings.networkDownloadBytesPerSec, true)}`,
        `上传：${formatBytes(readings.networkUploadBytesPerSec, true)}`,
        `活动接口：${readings.networkInterfaceName || '读取源缺失'}`,
        `接口数量：${(data.network?.interfaces || []).length} 个`,
      ],
      storage: [
        `总容量：${formatPair(totals.used, totals.total)} · ${percent(totals.usage)}`,
        `读取：${formatBytes(readings.diskReadBytesPerSec, true)}`,
        `写入：${formatBytes(readings.diskWriteBytesPerSec, true)}`,
        `忙碌率：${percent(readings.diskActivity)}`,
        `分区：${(data.disks || []).length} 个`,
      ],
      cooling: [`风扇传感器：${(data.hardwareSensors?.fans || []).length} 路`],
      power: [
        `CPU 功耗：${readings.cpuPowerWatts === null ? sensorUnavailable(data) : `${readings.cpuPowerWatts.toFixed(1)} W`}`,
        `GPU 功耗：${readings.gpuPowerWatts === null ? sensorUnavailable(data, !data.gpu?.name) : `${readings.gpuPowerWatts.toFixed(1)} W`}`,
        `电压传感器：${(data.hardwareSensors?.voltages || []).length} 路`,
      ],
      battery: [
        `剩余：${percent(data.battery?.percent)}`,
        `状态：${batteryState.label}`,
        `预计时间：${batteryState.estimatedMinutes === null ? '读取源缺失' : `${Math.round(batteryState.estimatedMinutes)} 分钟`}`,
      ],
      system: [
        `主机：${data.system?.hostname || '读取源缺失'}`,
        `系统：${data.system?.osName || data.system?.platform || '读取源缺失'} ${data.system?.osVersion || data.system?.release || ''}`,
        `主板：${`${data.system?.manufacturer || ''} ${data.system?.model || ''}`.trim() || '读取源缺失'}`,
        `运行时间：${formatDuration(data.system?.uptimeSec)}`,
        `进程 / 线程：${data.system?.processCount ?? '读取源缺失'} / ${data.system?.threadCount ?? '读取源缺失'}`,
      ],
    };
    return summaries[cardId] || [];
  }

  _renderDetail() {
    clearContainer(this._detailLayer);
    const inner = new PIXI.Graphics();
    drawPixelPanel(inner, 12, 62, PANEL_WIDTH - 24, DETAIL_HEIGHT - 74, COLORS.background, COLORS.border, 0.985);
    this._detailLayer.addChild(inner);
    makeButton(this._detailLayer, '‹ 返回概览', 28, 76, 105, 30, () => this._leaveToOverview(false), { size: 11 });
    addText(this._detailLayer, `${this._detailCard === 'system' ? '系统' : CARD_LABELS[this._detailCard]}明细`, 150, 78, 18, COLORS.title, { bold: true });
    addText(this._detailLayer, '整理摘要', 34, 124, 13, COLORS.muted, { bold: true });
    this._detailSummary(this._detailCard).slice(0, 6).forEach((line, index) => {
      addText(this._detailLayer, truncate(line, 82), 34, 148 + index * 22, 12, index === 0 ? COLORS.text : COLORS.muted);
    });

    const sensors = this._sensorsForDetail(this._detailCard);
    const page = paginate(sensors, this._detailPage, 8);
    this._detailPage = page.page;
    addText(this._detailLayer, `原始传感器 · ${sensors.length} 项`, 34, 294, 13, COLORS.gpu, { bold: true });
    addText(this._detailLayer, `${page.page + 1}/${page.pageCount}`, PANEL_WIDTH - 36, 294, 11, COLORS.dim, { numeric: true }).anchor.set(1, 0);
    page.items.forEach((sensor, index) => {
      const y = 326 + index * 31;
      const row = new PIXI.Graphics();
      row.beginFill(index % 2 ? 0x111622 : 0x151b28, 0.72);
      row.drawRect(34, y, PANEL_WIDTH - 68, 26);
      row.endFill();
      this._detailLayer.addChild(row);
      addText(this._detailLayer, `${truncate(sensor.hardwareName, 20)} · ${truncate(sensor.name, 28)}`, 43, y + 4, 11, COLORS.muted);
      const value = addText(this._detailLayer, formatSensorValue(sensor, this._data), PANEL_WIDTH - 43, y + 4, 11,
        sensor.sensorType === 'Temperature'
          ? temperatureColor(sensor.value, this._temperatureThresholds(cardTemperatureKind(this._detailCard), sensor.hardwareIdentifier))
          : COLORS.text,
        { numeric: true, bold: true });
      value.anchor.set(1, 0);
    });
    if (!sensors.length) addText(this._detailLayer, '当前类别没有可用的原始传感器。', 34, 332, 12, COLORS.dim);
    makeButton(this._detailLayer, '‹ 上一页', 470, 573, 90, 28, () => {
      this._detailPage -= 1;
      this._renderDetail();
    }, { size: 11, disabled: page.pageCount <= 1 });
    makeButton(this._detailLayer, '下一页 ›', 570, 573, 90, 28, () => {
      this._detailPage += 1;
      this._renderDetail();
    }, { size: 11, disabled: page.pageCount <= 1 });
  }

  _renderManagement() {
    this._managementLayer.removeAllListeners();
    clearContainer(this._managementLayer);
    const background = new PIXI.Graphics();
    drawPixelPanel(background, 12, 62, PANEL_WIDTH - 24, MANAGEMENT_HEIGHT - 74, COLORS.background, COLORS.border, 0.985);
    this._managementLayer.addChild(background);
    addText(this._managementLayer, '监控管理', 30, 76, 18, COLORS.title, { bold: true });
    addText(this._managementLayer, '布局决定看到什么，传感器决定看到多细。', 30, 103, 11, COLORS.muted);
    const sections = [['layout', '布局'], ['sensors', '传感器'], ['access', '权限']];
    sections.forEach(([id, label], index) => {
      makeButton(this._managementLayer, label, 430 + index * 78, 75, 70, 30, () => {
        this._manageSection = id;
        this._renderManagement();
      }, { active: this._manageSection === id, size: 11 });
    });
    if (this._manageSection === 'layout') this._renderLayoutEditor();
    if (this._manageSection === 'sensors') this._renderSensorEditor();
    if (this._manageSection === 'access') this._renderAccessEditor();
  }

  _renderLayoutEditor() {
    const draft = this._draftSession?.draft || cloneMonitorPanelConfig(this._config);
    addText(this._managementLayer, '快速方案', 34, 132, 12, COLORS.muted, { bold: true });
    ['minimal', 'performance', 'hardware', 'full'].forEach((preset, index) => {
      makeButton(this._managementLayer, PRESET_LABELS[preset], 118 + index * 120, 122, 108, 34, () => {
        this._setDraft(applyMonitorPreset(draft, preset));
      }, { active: draft.preset === preset, size: 11 });
    });
    addText(this._managementLayer, '拖动卡片调整顺序 · 点击右侧眼睛控制显隐', 34, 169, 11, COLORS.dim);

    const availability = this._cardAvailability();
    const tileCards = draft.layout.order.map((id) => ({
      key: id,
      height: 44,
      span: id === 'storage' ? 2 : 1,
    }));
    const placements = layoutDashboardCards(tileCards, {
      panelWidth: 632,
      padding: 0,
      columnGap: 10,
      top: 0,
      rowGap: 7,
    });
    const tileOrigin = { x: 34, y: 194 };
    this._manageTilePlacements = [];
    for (const placement of placements) {
      const id = placement.key;
      const enabled = draft.layout.enabled[id];
      const available = availability[id];
      const tile = new PIXI.Container();
      tile.position.set(tileOrigin.x + placement.x, tileOrigin.y + placement.y);
      tile.eventMode = 'static';
      tile.cursor = 'grab';
      tile.hitArea = new PIXI.Rectangle(0, 0, placement.width, placement.height);
      const graphic = new PIXI.Graphics();
      drawPixelPanel(
        graphic, 0, 0, placement.width, placement.height,
        enabled ? 0x182739 : 0x121620,
        enabled ? CARD_SPECS[id].color : COLORS.dim,
        available ? 0.94 : 0.56,
      );
      tile.addChild(graphic);
      addText(tile, '≡', 11, 11, 15, enabled ? COLORS.text : COLORS.dim, { bold: true });
      addText(tile, CARD_LABELS[id], 36, 11, 13, enabled ? CARD_SPECS[id].color : COLORS.dim, { bold: true });
      if (!available) addText(tile, '未检测', placement.width - 116, 12, 10, COLORS.warning);
      const eye = makeButton(tile, enabled ? '显示' : '隐藏', placement.width - 61, 7, 52, 30, () => {
        const next = cloneMonitorPanelConfig(draft);
        next.layout.enabled[id] = !enabled;
        next.preset = 'custom';
        this._setDraft(next);
      }, { active: enabled, size: 10 });
      eye.cursor = 'pointer';
      eye.on('pointerdown', (event) => event.stopPropagation?.());
      tile.on('pointerdown', (event) => {
        event.stopPropagation?.();
        const local = event.getLocalPosition(this._managementLayer);
        this._drag = { id, tile, offsetY: local.y - tile.y };
        tile.alpha = 0.75;
      });
      this._managementLayer.addChild(tile);
      this._manageTilePlacements.push({
        id,
        tile,
        centerX: tile.x + placement.width / 2,
        centerY: tile.y + placement.height / 2,
      });
    }

    this._managementLayer.eventMode = 'static';
    this._managementLayer.hitArea = new PIXI.Rectangle(12, 62, PANEL_WIDTH - 24, MANAGEMENT_HEIGHT - 74);
    this._managementLayer.on('globalpointermove', (event) => {
      if (!this._drag) return;
      const local = event.getLocalPosition(this._managementLayer);
      this._drag.tile.y = clamp(local.y - this._drag.offsetY, 190, 455);
    });
    const finishDrag = (event) => {
      if (!this._drag) return;
      const active = this._drag;
      const local = event.getLocalPosition(this._managementLayer);
      const candidates = this._manageTilePlacements.filter((item) => item.id !== active.id);
      const target = candidates.sort((a, b) => (
        Math.hypot(a.centerX - local.x, a.centerY - local.y)
        - Math.hypot(b.centerX - local.x, b.centerY - local.y)
      ))[0];
      const next = cloneMonitorPanelConfig(draft);
      next.layout.order = reorderDashboardCards(next.layout.order, active.id, target?.id);
      next.preset = 'custom';
      this._drag = null;
      this._setDraft(next);
    };
    this._managementLayer.on('pointerup', finishDrag);
    this._managementLayer.on('pointerupoutside', finishDrag);

    const hidden = draft.layout.order.filter((id) => !draft.layout.enabled[id]).map((id) => CARD_LABELS[id]);
    addText(this._managementLayer, `隐藏区：${hidden.length ? hidden.join('、') : '无'}`, 34, 470, 11, hidden.length ? COLORS.dim : COLORS.title);
    makeButton(this._managementLayer, '取消', 420, 556, 108, 34, () => this._cancelDraft(), { size: 12 });
    makeButton(this._managementLayer, this._draftSession?.dirty ? '应用布局 *' : '应用布局', 540, 556, 120, 34, () => {
      this._commitDraft();
      this._leaveToOverview(false);
    }, { active: this._draftSession?.dirty, size: 12, bold: true });
  }

  _temperatureDevices() {
    const sensors = (this._data?.hardwareSensors?.sensors || []).filter((sensor) => sensor.sensorType === 'Temperature');
    const devices = new Map();
    for (const sensor of sensors) {
      const identifier = sensor.hardwareIdentifier || sensor.identifier;
      if (!devices.has(identifier)) {
        const kind = /^Cpu$/i.test(sensor.hardwareType) ? 'cpu'
          : /^Gpu/i.test(sensor.hardwareType) ? 'gpu'
            : /^Storage$/i.test(sensor.hardwareType) ? 'storage'
              : /Motherboard|SuperIO|EmbeddedController/i.test(sensor.hardwareType) ? 'motherboard'
                : 'unknown';
        devices.set(identifier, { identifier, name: sensor.hardwareName, kind });
      }
    }
    return [...devices.values()];
  }

  _renderSensorEditor() {
    const draft = this._draftSession?.draft || cloneMonitorPanelConfig(this._config);
    addText(this._managementLayer, '明细类别', 34, 132, 12, COLORS.muted, { bold: true });
    const toggles = [
      ['temperature', '温度'], ['power', '功耗'], ['fan', '风扇'],
      ['voltage', '电压'], ['storageHealth', '存储健康'],
    ];
    toggles.forEach(([key, label], index) => {
      const enabled = draft.sensors.visible[key];
      makeButton(this._managementLayer, `${enabled ? '✓' : '○'} ${label}`, 34 + index * 122, 154, 112, 34, () => {
        const next = cloneMonitorPanelConfig(draft);
        next.sensors.visible[key] = !enabled;
        next.preset = 'custom';
        this._setDraft(next);
      }, { active: enabled, size: 11 });
    });
    const motionEnabled = draft.motion.enabled;
    makeButton(this._managementLayer, `${motionEnabled ? '✓' : '○'} 速度生态动效`, 34, 202, 170, 34, () => {
      const next = cloneMonitorPanelConfig(draft);
      next.motion.enabled = !motionEnabled;
      next.preset = 'custom';
      this._setDraft(next);
    }, { active: motionEnabled, size: 11 });
    addText(this._managementLayer, this._reducedMotion ? 'Windows 已启用减少动态效果，当前仅显示静态档位。' : '网络、磁盘和风扇会根据本机近期速度自动变档。', 218, 211, 11, this._reducedMotion ? COLORS.warning : COLORS.dim);

    const devices = this._temperatureDevices();
    this._thresholdDeviceIndex = clamp(this._thresholdDeviceIndex, 0, Math.max(0, devices.length - 1));
    const device = devices[this._thresholdDeviceIndex];
    addText(this._managementLayer, '设备温区', 34, 260, 12, COLORS.muted, { bold: true });
    if (!device) {
      addText(this._managementLayer, '当前没有检测到温度传感器；设备出现后可在这里调整。', 34, 291, 12, COLORS.dim);
    } else {
      makeButton(this._managementLayer, '上', 34, 286, 40, 30, () => {
        this._thresholdDeviceIndex = (this._thresholdDeviceIndex - 1 + devices.length) % devices.length;
        this._renderManagement();
      }, { size: 14, disabled: devices.length <= 1 });
      addText(this._managementLayer, truncate(device.name, 36), 84, 289, 13, CARD_SPECS[device.kind]?.color || COLORS.text, { bold: true });
      addText(this._managementLayer, `${this._thresholdDeviceIndex + 1}/${devices.length}`, 390, 290, 11, COLORS.dim, { numeric: true }).anchor.set(1, 0);
      makeButton(this._managementLayer, '下', 410, 286, 40, 30, () => {
        this._thresholdDeviceIndex = (this._thresholdDeviceIndex + 1) % devices.length;
        this._renderManagement();
      }, { size: 14, disabled: devices.length <= 1 });
      const thresholds = draft.sensors.temperatureOverrides[device.identifier]
        || draft.sensors.temperatureDefaults[device.kind]
        || draft.sensors.temperatureDefaults.unknown;
      THRESHOLD_LABELS.forEach((label, index) => {
        const y = 337 + index * 43;
        addText(this._managementLayer, label, 50, y + 5, 12, temperatureColor(thresholds[index], thresholds), { bold: true });
        makeButton(this._managementLayer, '−', 145, y, 34, 30, () => this._changeThreshold(device, index, -1), { size: 14 });
        addText(this._managementLayer, `${thresholds[index]} °C`, 230, y + 4, 13, COLORS.text, { numeric: true, bold: true }).anchor.set(0.5, 0);
        makeButton(this._managementLayer, '+', 282, y, 34, 30, () => this._changeThreshold(device, index, 1), { size: 14 });
      });
      makeButton(this._managementLayer, '恢复此设备默认温区', 390, 357, 220, 36, () => {
        const next = cloneMonitorPanelConfig(draft);
        delete next.sensors.temperatureOverrides[device.identifier];
        next.preset = 'custom';
        this._setDraft(next);
      }, { size: 11 });
      const preview = new PIXI.Graphics();
      drawTemperatureRail(preview, 390, 418, 220, thresholds[2], thresholds);
      this._managementLayer.addChild(preview);
      addText(this._managementLayer, '冷色 ← 当前温区预览 → 暖色', 390, 435, 10, COLORS.dim);
    }
    makeButton(this._managementLayer, '取消', 420, 556, 108, 34, () => this._cancelDraft(), { size: 12 });
    makeButton(this._managementLayer, this._draftSession?.dirty ? '应用设置 *' : '应用设置', 540, 556, 120, 34, () => {
      this._commitDraft();
      this._leaveToOverview(false);
    }, { active: this._draftSession?.dirty, size: 12, bold: true });
  }

  _changeThreshold(device, index, delta) {
    const draft = this._draftSession?.draft || cloneMonitorPanelConfig(this._config);
    const current = draft.sensors.temperatureOverrides[device.identifier]
      || draft.sensors.temperatureDefaults[device.kind]
      || draft.sensors.temperatureDefaults.unknown;
    const thresholds = [...current];
    const min = index === 0 ? -20 : thresholds[index - 1] + 1;
    const max = index === thresholds.length - 1 ? 150 : thresholds[index + 1] - 1;
    thresholds[index] = clamp(thresholds[index] + delta, min, max);
    const next = cloneMonitorPanelConfig(draft);
    next.sensors.temperatureOverrides[device.identifier] = thresholds;
    next.preset = 'custom';
    this._setDraft(next);
  }

  _renderAccessEditor() {
    const data = this._data || {};
    const access = data.hardwareSensors?.access;
    const elevated = Boolean(access?.elevated);
    addText(this._managementLayer, '传感器权限与完整度', 34, 140, 14, COLORS.gpu, { bold: true });
    addText(this._managementLayer,
      access
        ? `${elevated ? '管理员权限' : '标准权限'} · 已读取 ${access.sensorCount}/${access.totalSensorCount} 项 · ${access.hardwareCount} 个硬件节点`
        : '传感器宿主尚未返回数据',
      34, 176, 13, access ? elevated ? COLORS.gpu : COLORS.warning : COLORS.warning, { bold: true });
    addText(this._managementLayer,
      elevated
        ? '底层读取权限已启用；仍为空的项目属于设备不存在或固件未开放。'
        : access?.permissionRecommended
          ? 'CPU 或主板受保护传感器尚未开放，提升权限可继续探测。'
          : '标准权限下已读取可用项目；提升权限可继续探测受保护项目。',
      34, 207, 12, COLORS.muted, { wordWrap: true, wordWrapWidth: 600 });
    const error = data.diagnostics?.hardwareSensorError;
    if (error) addText(this._managementLayer, `读取源异常：${truncate(error, 70)}`, 34, 250, 11, COLORS.warning);
    makeButton(this._managementLayer, elevated ? '已使用管理员权限' : '请求管理员权限', 34, 292, 235, 48, async () => {
      if (elevated) return;
      this._commitDraft();
      await this._onRequestElevation?.();
    }, { active: elevated, disabled: elevated, size: 12, bold: true });
    addText(this._managementLayer, '提升权限会由 Windows 显示确认窗口，并以相同免费版或赞助版重新启动。', 34, 360, 11, COLORS.dim);
    addText(this._managementLayer, '设备不存在会保留在布局编辑器中并标注，但不会占用日常概览位置。', 34, 388, 11, COLORS.dim);
    makeButton(this._managementLayer, '返回概览', 520, 556, 140, 34, () => {
      this._commitDraft();
      this._leaveToOverview(false);
    }, { size: 12 });
  }

  setPosition(cx, cy) {
    const viewportWidth = globalThis.window?.innerWidth || PANEL_WIDTH;
    const viewportHeight = globalThis.window?.innerHeight || this.height;
    this.container.x = clamp(cx - PANEL_WIDTH / 2, 8, Math.max(8, viewportWidth - PANEL_WIDTH - 8));
    this.container.y = clamp(cy - 190, 8, Math.max(8, viewportHeight - this.height - 8));
  }

  _clampToViewport() {
    const viewportWidth = globalThis.window?.innerWidth || PANEL_WIDTH;
    const viewportHeight = globalThis.window?.innerHeight || this.height;
    this.container.x = clamp(this.container.x, 8, Math.max(8, viewportWidth - PANEL_WIDTH - 8));
    this.container.y = clamp(this.container.y, 8, Math.max(8, viewportHeight - this.height - 8));
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
    if (this._page === 'manage') this._commitDraft();
    this._animDirection = -1;
    this._animProgress = 1;
    this._animating = true;
    this._animCallback = onComplete || null;
  }

  settleForRefresh() {
    this.commitPendingConfiguration();
    if (!this._animating) return this.isOpen;
    const opening = this._animDirection >= 0;
    this._animating = false;
    this._animCallback = null;
    this._animProgress = opening ? 1 : 0;
    this.container.visible = opening;
    this.container.alpha = opening ? 1 : 0;
    this.container.scale.set(opening ? 1 : 0.3);
    return opening;
  }

  updateAnimation(dt) {
    if (this.container.visible && this._page === 'overview') {
      this._motionTime += dt;
      this._speedTracker.step(dt);
      this._drawMotion();
    }
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
  get height() {
    if (this._page === 'manage') return MANAGEMENT_HEIGHT;
    if (this._page === 'detail') return DETAIL_HEIGHT;
    return this._overviewHeight;
  }
}
