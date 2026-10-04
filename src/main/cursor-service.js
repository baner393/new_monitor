import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { CURSOR_HOST_SOURCE } from './cursor-native-host.js';
import { decodeCursorAsset, cursorAssetMetadata, buildPunchedCursor } from './cursor-assets.js';
import { cursorProfileKey, normalizeCursorProfiles, validateCursorHole, cursorMountGeometry, punchCursorPixels, resizeCursorFrame } from '../shared/cursor-hole-model.js';

const LABELS = { Arrow: '普通选择', Help: '帮助选择', AppStarting: '后台运行', Wait: '忙碌', Crosshair: '精确选择',
  IBeam: '文本选择', NWPen: '手写', No: '不可用', SizeNS: '垂直调整', SizeWE: '水平调整', SizeNWSE: '对角调整',
  SizeNESW: '反向对角调整', SizeAll: '移动', UpArrow: '候选选择', Hand: '链接选择' };
const INACTIVE = Object.freeze({ active: false, supported: false, role: null });

/** Win32 helper owns temporary cursors and independently restores on pipe/parent death. */
export class CursorService {
  constructor({ directory, codec, onState = () => {}, onTheme = () => {}, getScaleFactor = () => 1,
    platform = process.platform, spawnProcess = spawn, io = fs, timeoutMs = 10000 } = {}) {
    this.directory = directory; this.codec = codec; this.onState = onState; this.onTheme = onTheme;
    this.getScaleFactor = getScaleFactor; this.platform = platform; this.spawnProcess = spawnProcess;
    this.io = io; this.timeoutMs = timeoutMs; this.child = null; this.starting = null;
    this.pending = new Map(); this.sequence = 0; this.assets = new Map(); this.installed = new Map();
    this.theme = null; this.settings = {}; this.state = { ...INACTIVE }; this.nativeState = null;
    this.queue = Promise.resolve(); this.stopping = false; this.restored = true; this.appliedKey = null;
    this.loadingTheme = null; this.scaleTimer = null;
    this.displayScale = null;
    this.recoveryAttempted = false;
    this.cursorScalingApi = false;
  }

  emit(state) {
    if (JSON.stringify(state) === JSON.stringify(this.state)) return;
    this.state = state; this.onState({ ...state });
  }

  async start() {
    if (this.platform !== 'win32') return false;
    if (this.starting) return this.starting;
    if (this.child) return true;
    this.starting = this.launch();
    try { return await this.starting; } finally { this.starting = null; }
  }

  async launch() {
    await this.io.mkdir(this.directory, { recursive: true });
    const helper = path.join(this.directory, 'cursor-host.ps1');
    await this.io.writeFile(helper, CURSOR_HOST_SOURCE, 'utf8');
    return new Promise((resolve, reject) => {
      const child = this.spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', helper, '-ParentProcessId', String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      const timer = setTimeout(() => { child.stdin.end(); reject(new Error('Cursor helper startup timed out')); }, this.timeoutMs);
      let ready = false, diagnostic = '';
      const lines = readline.createInterface({ input: child.stdout });
      child.stderr.on('data', (chunk) => { diagnostic = (diagnostic + chunk).slice(-4000); });
      lines.on('line', (line) => {
        let message;
        try { message = JSON.parse(line.replace(/^\uFEFF/, '')); }
        catch { return; }
        if (message.type === 'ready') {
          ready = true; clearTimeout(timer);
          this.nativeDpiAwareness = message.dpiAwareness;
          this.cursorScalingApi = message.cursorScalingApi === true;
          this.scaleTimer = setInterval(() => {
            this.publishNativeState();
            const scale = Math.max(0.1, Number(this.getScaleFactor()) || 1);
            if (this.theme && scale !== this.displayScale) {
              this.displayScale = scale;
              this.getTheme().then((theme) => this.onTheme(theme)).catch((error) => this.fail(error));
            }
          }, 250); this.scaleTimer.unref?.();
          resolve(true);
        }
        else if (message.type === 'reply') {
          const waiter = this.pending.get(message.requestId);
          if (waiter) {
            clearTimeout(waiter.timer); this.pending.delete(message.requestId);
            if (message.error) waiter.reject(new Error(message.error)); else waiter.resolve(message.result);
          }
        } else if (message.type === 'restored') this.restored = true;
        else if (message.type === 'state') { this.nativeState = message.state; this.publishNativeState(); }
        else if (message.type === 'theme-changed') {
          this.restored = true; this.installed.clear(); this.theme = null; this.appliedKey = null;
          this.emit({ ...INACTIVE, reason: 'theme-changed' });
          this.sync(this.settings).then(() => this.getTheme()).then((theme) => this.onTheme(theme)).catch((error) => this.fail(error));
        } else if (message.type === 'error') this.fail(new Error(message.error));
      });
      child.once('error', (error) => { clearTimeout(timer); reject(error); this.fail(error); });
      child.once('exit', (code) => {
        clearTimeout(timer); clearInterval(this.scaleTimer); this.scaleTimer = null;
        lines.close(); if (this.child === child) this.child = null;
        this.appliedKey = null;
        this.installed.clear(); this.nativeState = null;
        for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Cursor helper disconnected')); }
        this.pending.clear();
        if (!ready) reject(new Error(diagnostic || `Cursor helper exited before ready (${code})`));
        this.emit({ ...INACTIVE, reason: this.stopping ? 'stopped' : 'native-error', error: this.stopping ? undefined : diagnostic || `Cursor helper exited (${code})` });
        // Never leave consumed copies installed after an unexpected native process failure.
        if (!this.restored && !this.stopping) {
          const retryMount = !this.recoveryAttempted;
          this.recoveryAttempted = true;
          this.start().then(() => this.request('restore')).then((result) => {
            if (!result?.restored) throw new Error('Emergency cursor restoration was not acknowledged');
            this.restored = true; this.installed.clear(); this.appliedKey = null; this.nativeState = null;
            if (retryMount && !this.stopping && this.settings.anchorMode === 'cursor') {
              const retry = this.queue.catch(() => {}).then(() => this.applySettings({ ...this.settings }));
              this.queue = retry;
              return retry;
            }
          })
            .catch((error) => this.fail(error));
        }
      });
    });
  }

  request(op, payload = {}) {
    if (!this.child?.stdin?.writable) return Promise.reject(new Error('Cursor helper is unavailable'));
    const requestId = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`Cursor ${op} timed out`)); }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ requestId, op, ...payload }) + '\n', (error) => {
        if (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
      });
    });
  }

  fail(error) { this.emit({ ...INACTIVE, reason: 'native-error', error: error.message }); }

  async getTheme() {
    if (!await this.start()) return { available: false, roles: [], activeRole: null };
    if (!this.theme) {
      if (!this.loadingTheme) this.loadingTheme = this.readTheme();
      try { await this.loadingTheme; } finally { this.loadingTheme = null; }
    }
    const scale = Math.max(0.1, Number(this.getScaleFactor()) || 1);
    this.displayScale = scale;
    return { ...this.theme, roles: this.theme.roles.map((role) => ({ ...role,
      displaySize: this.assets.get(role.role)?.asset.format === 'cur' ? role.displaySize : role.displaySize / scale })),
      activeRole: this.nativeState?.role || null };
  }

  async readTheme() {
    if (!this.theme) {
      const native = await this.request('theme');
      this.assets.clear();
      const roles = await Promise.all(native.roles.map(async (role) => {
        try {
          const bytes = role.path ? await this.io.readFile(role.path) : Buffer.from(role.capture?.curBase64 || '', 'base64');
          const asset = decodeCursorAsset(bytes, this.codec);
          this.assets.set(role.role, { asset, native: role });
          return cursorAssetMetadata(asset, { role: role.role, label: LABELS[role.role] || role.role,
            displaySize: role.width || 32, targetWidth: role.width || 32, targetHeight: role.height || 32,
            targetHotspot: role.hotspot, encodePng: this.codec.encodePng });
        } catch (error) {
          return { role: role.role, id: '', label: LABELS[role.role] || role.role,
            displaySize: role.width || 32, frames: [], steps: [], supported: false, reason: error.message };
        }
      }));
      this.theme = { available: true, roles };
    }
  }

  sync(settings) {
    this.recoveryAttempted = false;
    this.settings = { ...settings }; const snapshot = this.settings;
    const operation = this.queue.catch(() => {}).then(() => this.applySettings(snapshot));
    this.queue = operation; return operation;
  }

  async applySettings(settings) {
    if (this.stopping) return;
    if (settings.anchorMode !== 'cursor') {
      if (this.child && !this.restored) {
        const result = await this.request('restore');
        if (!result?.restored) throw new Error('Cursor restoration was not acknowledged');
        this.restored = true;
      }
      this.installed.clear(); this.appliedKey = null; this.emit({ ...INACTIVE, reason: 'classic' }); return;
    }
    const theme = await this.getTheme();
    if (!theme.available) { this.emit({ ...INACTIVE, reason: 'platform' }); return; }
    if (!this.cursorScalingApi) {
      this.installed.clear(); this.appliedKey = null;
      this.emit({ ...INACTIVE, reason: 'unsupported-scaling' }); return;
    }
    const profiles = normalizeCursorProfiles(settings.charmCursorProfiles);
    const key = JSON.stringify({ profiles, ids: theme.roles.map((role) => [role.role, role.id]) });
    if (key === this.appliedKey) { this.publishNativeState(); return; }
    // Generate all files before changing any OS cursor, and validate all ANI steps/sizes.
    const entries = [], installed = new Map();
    for (const role of theme.roles) {
      const record = this.assets.get(role.role);
      if (!record) continue;
      const profile = profiles[cursorProfileKey(role.role, role.id)] || role.defaultProfile;
      // Native canvas dimensions include ring padding; profiles belong to source art.
      const activeFrames = record.asset.frames.map(frame => resizeCursorFrame([...frame.images].sort((a, b) =>
        Math.abs(a.width - record.native.width) - Math.abs(b.width - record.native.width))[0], record.native.width, record.native.height));
      if (record.native.hotspot) for (let index = 0; index < activeFrames.length; index++) {
        activeFrames[index] = { ...activeFrames[index], hotspot: { ...record.native.hotspot } };
      }
      if (!validateCursorHole(activeFrames, profile).valid) continue;
      const sourceFrame = activeFrames[0];
      const rendered = punchCursorPixels(sourceFrame, profile);
      const bytes = buildPunchedCursor(record.asset, profile, { ...this.codec, targetWidth: record.native.width,
        targetHeight: record.native.height, targetHotspot: record.native.hotspot });
      const filename = `${role.role}-${role.id}.${record.asset.format}`;
      const destination = path.join(this.directory, filename);
      await this.io.writeFile(destination, bytes);
      const creationScalingMode = record.asset.format === 'ani' ? 'default' : 'none';
      entries.push({ systemId: record.native.systemId, path: destination, creationScalingMode,
        expectedWidth: rendered.width, expectedHeight: rendered.height,
        expectedHotspotX: rendered.hotspot.x, expectedHotspotY: rendered.hotspot.y });
      installed.set(role.role, { id: role.id, profile, sourceFrame: { width: sourceFrame.width, height: sourceFrame.height, hotspot: { ...sourceFrame.hotspot } },
        renderedFrame: { width: rendered.width, height: rendered.height, hotspot: { ...rendered.hotspot } },
        format: record.asset.format, creationScalingMode });
    }
    this.emit(this.state.active ? { ...this.state, updating: true } : { ...INACTIVE, reason: 'updating' });
    this.restored = false; // Also covers partial installs and abnormal helper termination.
    try {
      const result = await this.request('install', { roles: entries });
      if (Boolean(result?.installed) !== (entries.length > 0)) throw new Error('Cursor installation was not acknowledged');
      const activeRoleInfo = result.roles?.find(info => info.systemId === this.assets.get(this.nativeState?.role)?.native.systemId);
      if (activeRoleInfo) this.nativeState = { ...this.nativeState, ...activeRoleInfo };
      this.installed = installed; this.restored = !entries.length; this.appliedKey = key; this.publishNativeState();
    } catch (error) {
      this.installed.clear(); this.appliedKey = null;
      try {
        const recovery = await this.request('restore');
        this.restored = recovery?.restored === true;
      } finally {
        if (!this.restored) this.child?.stdin.end();
        this.fail(error);
      }
      throw error;
    }
  }

  publishNativeState() {
    if (this.stopping || this.settings.anchorMode !== 'cursor') return;
    const native = this.nativeState, record = this.installed.get(native?.role);
    if (!native?.visible || !record) {
      this.emit({ ...INACTIVE, role: native?.role || null, reason: 'unsupported' }); return;
    }
    const scale = Math.max(0.1, Number(this.getScaleFactor()) || 1);
    const source = record.sourceFrame, generated = record.renderedFrame;
    // Keep the established logical cursor-size mapping separate from the
    // attachment geometry mapping. The system can DPI-scale the installed
    // cursor bitmap even when GetIconInfo still reports its creation size;
    // the embedded ring follows that final bitmap, while the rope is rendered
    // in Electron DIPs.
    const creationScalingMode = native.creationScalingMode || (native.creationScalingNone ? 'none' : null);
    const monitorToCreationScale = creationScalingMode
      ? (record.format === 'cur' ? scale : 1)
      : Number(native.creationDpi) > 0 ? scale / (Number(native.creationDpi) / 96) : 1;
    const monitorToGeometryScale = creationScalingMode === 'default'
      ? scale
      : creationScalingMode === 'none'
        ? (record.format === 'cur' ? scale : 1)
        : Number(native.creationDpi) > 0 ? scale / (Number(native.creationDpi) / 96) : 1;
    const nativeRatioX = (Number(native.width) || generated.width) / generated.width;
    const nativeRatioY = (Number(native.height) || generated.height) / generated.height;
    const ratioX = nativeRatioX * monitorToCreationScale;
    const ratioY = nativeRatioY * monitorToCreationScale;
    const geometryRatioX = nativeRatioX * monitorToGeometryScale;
    const geometryRatioY = nativeRatioY * monitorToGeometryScale;
    const renderedGeometry = cursorMountGeometry(record.sourceFrame, record.profile);
    const renderedHotspot = {
      x: (Number(native.hotspot?.x) || 0) * monitorToGeometryScale,
      y: (Number(native.hotspot?.y) || 0) * monitorToGeometryScale,
    };
    if (!native.hotspot) {
      renderedHotspot.x = generated.hotspot.x * geometryRatioX;
      renderedHotspot.y = generated.hotspot.y * geometryRatioY;
    }
    const offset = point => ({ x: ((point.x + renderedGeometry.canvas.origin.x) * geometryRatioX - renderedHotspot.x) / scale,
      y: ((point.y + renderedGeometry.canvas.origin.y) * geometryRatioY - renderedHotspot.y) / scale });
    const ring = renderedGeometry.ringGeometry;
    this.emit({ active: true, supported: true, role: native.role, id: record.id,
      cursorCreationScalingMode: creationScalingMode || 'system-default',
      nativeCursorScaling: creationScalingMode
        ? record.format === 'cur' ? 'system-default' : creationScalingMode
        : Number(native.creationDpi) > 0 ? 'dpi-relative' : 'system-default',
      cursorCreationDpi: Number(native.creationDpi) > 0 ? Number(native.creationDpi) : null,
      width: source.width * ratioX / scale, height: source.height * ratioY / scale,
      hotspot: { x: (renderedHotspot.x - renderedGeometry.canvas.origin.x * geometryRatioX) / scale,
        y: (renderedHotspot.y - renderedGeometry.canvas.origin.y * geometryRatioY) / scale },
      hole: { x: renderedGeometry.hole.x * geometryRatioX / scale, y: renderedGeometry.hole.y * geometryRatioY / scale,
        radius: renderedGeometry.hole.radius * Math.sqrt(geometryRatioX * geometryRatioY) / scale },
      mountOffset: offset(renderedGeometry.anchor), ringCenterOffset: offset(renderedGeometry.center),
      ringGeometry: { centerFromAnchor: { x: ring.centerFromAnchor.x * geometryRatioX / scale, y: ring.centerFromAnchor.y * geometryRatioY / scale },
        radiusX: ring.radiusX * geometryRatioX / scale, radiusY: ring.radiusY * geometryRatioY / scale, shear: ring.shear * geometryRatioX / geometryRatioY },
      ringScale: renderedGeometry.ringScale * Math.sqrt(geometryRatioX * geometryRatioY) / scale, ringEmbedded: true });
  }

  async stop() {
    this.stopping = true; this.emit({ ...INACTIVE, reason: 'stopping' });
    await this.queue.catch(() => {});
    if (!this.child) {
      if (!this.restored) { await this.start(); }
      else return;
    }
    if (!this.restored) {
      const restored = await this.request('restore');
      if (!restored?.restored) throw new Error('Cursor restoration was not acknowledged');
      this.restored = true;
    }
    const result = await this.request('stop');
    if (!result?.restored) throw new Error('Cursor helper did not acknowledge safe shutdown');
    this.installed.clear(); this.child?.stdin.end();
  }
}
