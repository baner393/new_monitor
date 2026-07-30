import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { launchElevatedProcess, resolveWindowsUserSid } from './elevation-restart.js';

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function hardwareIssue(value) {
  const message = normalizedText(value, 'Hardware sensor update failed');
  const separator = message.indexOf(':');
  const hardwareIdentifier = separator > 0 ? message.slice(0, separator).trim() : null;
  const detail = separator > 0 ? message.slice(separator + 1).trim() : message;
  const permissionRequired = /access.+denied|unauthori[sz]ed|privilege|permission|拒绝访问|权限/i.test(detail);
  return {
    hardwareIdentifier,
    code: permissionRequired ? 'permission_required' : 'device_update_failed',
    message: detail || message,
  };
}

function maximum(values) {
  const valid = values.map(finiteOrNull).filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : null;
}

function preferredValue(sensors, type, preferredNames = []) {
  const candidates = sensors.filter((sensor) => (
    sensor.sensorType === type
    && sensor.value !== null
    && sensor.status !== 'unavailable'
  ));
  for (const pattern of preferredNames) {
    const match = candidates.find((sensor) => pattern.test(sensor.name));
    if (match) return match.value;
  }
  return maximum(candidates.map((sensor) => sensor.value));
}

function valuesOfType(sensors, type) {
  return sensors.filter((sensor) => sensor.sensorType === type && sensor.value !== null && sensor.status !== 'unavailable');
}

function isZeroOnlyReading(sensor) {
  return sensor?.value === 0 && sensor?.min === 0 && sensor?.max === 0;
}

function summarizeDeviceSensors(sensors) {
  return {
    loadPercent: preferredValue(sensors, 'Load', [/cpu total|gpu core|gpu total|^3d$/i]),
    temperatureC: preferredValue(sensors, 'Temperature', [
      /package|tdie|tctl|core average|gpu core|temperature/i,
    ]),
    hotspotTemperatureC: preferredValue(sensors, 'Temperature', [/hot spot|hotspot|junction/i]),
    powerWatts: preferredValue(sensors, 'Power', [/package|gpu package|total|core/i]),
    voltageVolts: preferredValue(sensors, 'Voltage', [/core average|core|vcore|gpu core/i]),
    fanRpm: preferredValue(sensors, 'Fan', [/cpu|gpu|fan #?1|fan/i]),
    fanPercent: preferredValue(sensors, 'Control', [/fan/i]),
    clockMHz: preferredValue(sensors, 'Clock', [/core average|gpu core|core #?1|core/i]),
    memoryClockMHz: preferredValue(sensors, 'Clock', [/memory/i]),
  };
}

export function parseHardwareSensorSnapshot(value) {
  const raw = typeof value === 'string' ? JSON.parse(value) : value;
  if (!raw || raw.type !== 'snapshot' || Number(raw.protocolVersion) !== 1) {
    throw new Error('Hardware sensor host returned an incompatible payload');
  }

  const issues = (Array.isArray(raw.errors) ? raw.errors : []).map(hardwareIssue);
  const sensors = (Array.isArray(raw.sensors) ? raw.sensors : []).map((sensor) => {
    const value = finiteOrNull(sensor?.value);
    const hardwareIdentifier = normalizedText(sensor?.hardwareIdentifier);
    const deviceIssue = issues.find((issue) => issue.hardwareIdentifier === hardwareIdentifier);
    return {
      identifier: normalizedText(sensor?.identifier),
      name: normalizedText(sensor?.name, 'Sensor'),
      sensorType: normalizedText(sensor?.sensorType, 'Unknown'),
      index: finiteOrNull(sensor?.index),
      value,
      min: finiteOrNull(sensor?.min),
      max: finiteOrNull(sensor?.max),
      hardwareIdentifier,
      hardwareName: normalizedText(sensor?.hardwareName, 'Hardware'),
      hardwareType: normalizedText(sensor?.hardwareType, 'Unknown'),
      provider: normalizedText(raw.provider, 'librehardwaremonitor'),
      status: value !== null ? 'available' : 'unavailable',
      reasonCode: value !== null ? null : (deviceIssue?.code || 'sensor_returned_no_value'),
      reason: value !== null ? null : (deviceIssue?.message || '传感器已被硬件接口枚举，但本次没有返回数值'),
    };
  });

  // Some GPU drivers expose placeholder fan and control channels whose value,
  // minimum and maximum are all permanently zero. One sample cannot distinguish
  // that from a genuine zero-RPM stop mode, so do not report it as measured RPM.
  for (const fan of sensors.filter((sensor) => sensor.sensorType === 'Fan' && isZeroOnlyReading(sensor))) {
    const matchingControl = sensors.find((sensor) => (
      sensor.sensorType === 'Control'
      && sensor.hardwareIdentifier === fan.hardwareIdentifier
      && isZeroOnlyReading(sensor)
    ));
    if (!matchingControl) continue;
    fan.status = 'unavailable';
    fan.reasonCode = 'zero_fan_unconfirmed';
    fan.reason = '风扇通道只返回 0，暂时不能判断是停转模式，还是驱动没有公开转速';
    matchingControl.status = 'unavailable';
    matchingControl.reasonCode = 'zero_fan_unconfirmed';
    matchingControl.reason = '风扇控制通道只返回 0，暂时不能把它当成真实控制比例';
  }
  const hardware = (Array.isArray(raw.hardware) ? raw.hardware : []).map((device) => ({
    identifier: normalizedText(device?.identifier),
    parentIdentifier: normalizedText(device?.parentIdentifier) || null,
    name: normalizedText(device?.name, 'Hardware'),
    hardwareType: normalizedText(device?.hardwareType, 'Unknown'),
  }));

  const cpuSensors = sensors.filter((sensor) => /^Cpu$/i.test(sensor.hardwareType));
  const gpuGroups = new Map();
  for (const sensor of sensors.filter((item) => /^Gpu/i.test(item.hardwareType))) {
    if (!gpuGroups.has(sensor.hardwareIdentifier)) gpuGroups.set(sensor.hardwareIdentifier, []);
    gpuGroups.get(sensor.hardwareIdentifier).push(sensor);
  }
  const gpuSensorSets = [...gpuGroups.values()].sort((a, b) => b.length - a.length);
  const gpuSensors = gpuSensorSets[0] || [];
  const gpus = gpuSensorSets.map((group) => ({
    hardwareIdentifier: group[0]?.hardwareIdentifier || null,
    name: group[0]?.hardwareName || 'GPU',
    hardwareType: group[0]?.hardwareType || 'Gpu',
    ...summarizeDeviceSensors(group),
    sensors: group,
  }));
  const boardSensors = sensors.filter((sensor) => /Motherboard|SuperIO|EmbeddedController/i.test(sensor.hardwareType));
  const fanSensors = valuesOfType(sensors, 'Fan');
  const voltageSensors = valuesOfType(sensors, 'Voltage');
  const storageSensors = [];
  const storageGroups = new Map();
  for (const sensor of sensors.filter((item) => /^Storage$/i.test(item.hardwareType))) {
    if (!storageGroups.has(sensor.hardwareIdentifier)) storageGroups.set(sensor.hardwareIdentifier, []);
    storageGroups.get(sensor.hardwareIdentifier).push(sensor);
  }
  for (const group of storageGroups.values()) {
    storageSensors.push({
      hardwareIdentifier: group[0]?.hardwareIdentifier || null,
      name: group[0]?.hardwareName || 'Storage',
      temperatureC: preferredValue(group, 'Temperature', [/temperature|composite/i]),
      lifePercent: preferredValue(group, 'Level', [/remaining life|life/i]),
      usedSpacePercent: preferredValue(group, 'Load', [/used space/i]),
      sensors: group,
    });
  }

  const cpu = summarizeDeviceSensors(cpuSensors);
  const gpu = summarizeDeviceSensors(gpuSensors);
  cpu.hardwareIdentifier = cpuSensors[0]?.hardwareIdentifier || null;
  gpu.hardwareIdentifier = gpuSensors[0]?.hardwareIdentifier || null;
  const hasCpuHardware = hardware.some((device) => /^Cpu$/i.test(device.hardwareType));
  const protectedCpuDataMissing = hasCpuHardware && cpu.temperatureC === null;
  const cpuPowerValues = valuesOfType(cpuSensors, 'Power').map((sensor) => sensor.value);
  if (cpuPowerValues.length && cpuPowerValues.every((value) => value === 0)) {
    cpu.powerWatts = null;
    for (const sensor of cpuSensors.filter((item) => item.sensorType === 'Power')) {
      sensor.status = 'unavailable';
      sensor.reasonCode = 'invalid_reading';
      sensor.reason = '功耗通道持续返回 0，已按无效硬件计数器处理';
    }
  }
  const explicitPermissionIssue = issues.some((issue) => issue.code === 'permission_required');

  return {
    provider: normalizedText(raw.provider, 'librehardwaremonitor'),
    providerVersion: normalizedText(raw.providerVersion) || null,
    timestamp: finiteOrNull(raw.timestamp),
    elevated: Boolean(raw.elevated),
    hardware,
    sensors,
    errors: (Array.isArray(raw.errors) ? raw.errors : []).map(String),
    issues,
    access: {
      elevated: Boolean(raw.elevated),
      permissionRecommended: !raw.elevated && protectedCpuDataMissing,
      permissionEvidence: !raw.elevated && explicitPermissionIssue,
      sensorCount: sensors.filter((sensor) => sensor.value !== null && sensor.status === 'available').length,
      totalSensorCount: sensors.length,
      hardwareCount: hardware.length,
    },
    cpu,
    gpu,
    gpus,
    motherboard: {
      temperatures: valuesOfType(boardSensors, 'Temperature'),
      fans: valuesOfType(boardSensors, 'Fan'),
      voltages: valuesOfType(boardSensors, 'Voltage'),
    },
    fans: fanSensors,
    voltages: voltageSensors,
    temperatures: valuesOfType(sensors, 'Temperature'),
    powers: valuesOfType(sensors, 'Power'),
    storage: storageSensors,
  };
}

export function resolveHardwareSensorHostPath({ appPath, resourcesPath, isPackaged }) {
  return isPackaged
    ? path.join(resourcesPath, 'hardware-sensor', 'HardwareSensorHost.exe')
    : path.join(appPath, 'resources', 'hardware-sensor', 'HardwareSensorHost.exe');
}

export class HardwareSensorClient {
  constructor(executablePath, {
    spawnImpl = spawn,
    connectImpl = net.createConnection,
    launchElevatedImpl = launchElevatedProcess,
    resolveUserSidImpl = resolveWindowsUserSid,
    timeoutMs = 12000,
    elevationConnectTimeoutMs = 60000,
  } = {}) {
    this.executablePath = executablePath ? path.resolve(executablePath) : executablePath;
    this.spawnImpl = spawnImpl;
    this.connectImpl = connectImpl;
    this.launchElevatedImpl = launchElevatedImpl;
    this.resolveUserSidImpl = resolveUserSidImpl;
    this.timeoutMs = timeoutMs;
    this.elevationConnectTimeoutMs = elevationConnectTimeoutMs;
    this.child = null;
    this.socket = null;
    this.elevated = false;
    this.ready = false;
    this.buffer = '';
    this.stderr = '';
    this.pending = null;
    this.readyWaiter = null;
    this.stopping = false;
  }

  async requestElevation() {
    if (this.elevated && this.socket && this.ready) {
      return { started: false, alreadyElevated: true };
    }
    if (!this.executablePath || !fs.existsSync(this.executablePath)) {
      throw new Error(`Hardware sensor host is missing: ${this.executablePath || 'path not configured'}`);
    }

    const pipeName = `turtle-monitor-hardware-${randomUUID()}`;
    const clientSid = this.resolveUserSidImpl();
    const elevatedArgs = ['--pipe', pipeName];
    if (clientSid) elevatedArgs.push('--client-sid', clientSid);
    await this.launchElevatedImpl({
      executable: this.executablePath,
      args: elevatedArgs,
      workingDirectory: path.dirname(this.executablePath),
    });
    this._stopCurrentTransport();
    this.stopping = false;
    await this._connectElevatedPipe(pipeName);
    return { started: true, alreadyElevated: false };
  }

  query() {
    if (this.pending) return this.pending.promise;
    if (!this.executablePath || !fs.existsSync(this.executablePath)) {
      return Promise.reject(new Error(`Hardware sensor host is missing: ${this.executablePath || 'path not configured'}`));
    }

    let resolveRequest;
    let rejectRequest;
    const promise = new Promise((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    const timer = setTimeout(() => {
      this._rejectPending(new Error('Hardware sensor host timed out'));
      this._terminate();
    }, this.timeoutMs);
    this.pending = { promise, resolve: resolveRequest, reject: rejectRequest, timer };

    if (!this.child && !this.socket) this._start();
    if (this.ready) this._requestSnapshot();
    return promise;
  }

  stop() {
    this.stopping = true;
    this._rejectPending(new Error('Hardware sensor client stopped'));
    this._rejectReadyWaiter(new Error('Hardware sensor client stopped'));
    if (this.socket && !this.socket.destroyed) {
      try { this.socket.write('quit\n'); } catch {}
      this.socket.destroy();
    }
    if (this.child && !this.child.killed) {
      try { this.child.stdin.write('quit\n'); } catch {}
      const child = this.child;
      setTimeout(() => {
        if (!child.killed) child.kill();
      }, 1000).unref?.();
    }
  }

  _start() {
    this.stopping = false;
    this.elevated = false;
    const child = this.spawnImpl(this.executablePath, [], {
      cwd: path.dirname(this.executablePath),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.ready = false;
    this.buffer = '';
    this.stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._onStdout(chunk));
    child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-8192);
    });
    child.on('error', (error) => {
      this._rejectPending(error);
      this._resetChild(child);
    });
    child.on('close', (code, signal) => {
      if (!this.stopping) {
        this._rejectPending(new Error(this.stderr.trim() || `Hardware sensor host exited with ${code ?? signal}`));
      }
      this._resetChild(child);
    });
    child.stdin.on('error', (error) => {
      if (!this.stopping) this._rejectPending(error);
    });
  }

  _onStdout(chunk) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/^\uFEFF/, '').trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this._onLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  _onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this._rejectPending(new Error(`Hardware sensor host returned invalid JSON: ${error.message}`));
      return;
    }

    if (message.type === 'ready') {
      this.ready = true;
      this.elevated = Boolean(message.elevated);
      if (this.readyWaiter) {
        const waiter = this.readyWaiter;
        this.readyWaiter = null;
        clearTimeout(waiter.timer);
        if (this.elevated) waiter.resolve(true);
        else waiter.reject(new Error('硬件读取器已启动，但没有获得管理员权限'));
      }
      if (this.pending) this._requestSnapshot();
      return;
    }
    if (message.type === 'fatal') {
      this._rejectPending(new Error(message.error || 'Hardware sensor host failed'));
      return;
    }
    if (message.type === 'snapshot' && this.pending) {
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      try {
        pending.resolve(parseHardwareSensorSnapshot(message));
      } catch (error) {
        pending.reject(error);
      }
    }
  }

  _requestSnapshot() {
    try {
      if (this.socket && !this.socket.destroyed) this.socket.write('snapshot\n');
      else this.child.stdin.write('snapshot\n');
    } catch (error) {
      this._rejectPending(error);
    }
  }

  _rejectPending(error) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  _terminate() {
    if (this.socket && !this.socket.destroyed) this.socket.destroy();
    if (this.child && !this.child.killed) this.child.kill();
  }

  _resetChild(child) {
    if (this.child !== child) return;
    this.child = null;
    this.ready = false;
  }

  _stopCurrentTransport() {
    this._rejectPending(new Error('Hardware sensor transport is restarting'));
    this._rejectReadyWaiter(new Error('Hardware sensor transport is restarting'));
    if (this.socket && !this.socket.destroyed) {
      try { this.socket.write('quit\n'); } catch {}
      this.socket.destroy();
    }
    if (this.child && !this.child.killed) {
      try { this.child.stdin.write('quit\n'); } catch {}
      this.child.kill();
    }
    this.socket = null;
    this.child = null;
    this.ready = false;
    this.elevated = false;
    this.buffer = '';
    this.stderr = '';
  }

  _connectElevatedPipe(pipeName) {
    const pipePath = `\\\\.\\pipe\\${pipeName}`;
    const deadline = Date.now() + this.elevationConnectTimeoutMs;
    let lastConnectionError = null;
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (Date.now() >= deadline) {
          const code = String(lastConnectionError?.code || '').toUpperCase();
          if (code === 'EACCES' || code === 'EPERM') {
            reject(new Error('管理员读取器已启动，但 Windows 拒绝了面板与读取器之间的连接'));
          } else if (code === 'ENOENT') {
            reject(new Error('管理员读取器已启动，但没有建立通信通道；请检查安全软件是否拦截了 HardwareSensorHost.exe'));
          } else {
            reject(new Error(`管理员读取器通信等待超时${code ? `（${code}）` : ''}`));
          }
          return;
        }
        const socket = this.connectImpl(pipePath);
        let connected = false;
        const onEarlyError = (error) => {
          if (connected) return;
          lastConnectionError = error;
          socket.destroy();
          setTimeout(attempt, 100);
        };
        socket.once('error', onEarlyError);
        socket.once('connect', () => {
          connected = true;
          socket.removeListener('error', onEarlyError);
          this.socket = socket;
          this.ready = false;
          this.elevated = false;
          this.buffer = '';
          this.stderr = '';
          const remaining = Math.max(1000, deadline - Date.now());
          const timer = setTimeout(() => {
            this._rejectReadyWaiter(new Error('管理员硬件读取器没有按时就绪'));
            socket.destroy();
          }, remaining);
          this.readyWaiter = { resolve, reject, timer };
          socket.setEncoding('utf8');
          socket.on('data', (chunk) => this._onStdout(chunk));
          socket.on('error', (error) => {
            this._rejectReadyWaiter(error);
            this._rejectPending(error);
          });
          socket.on('close', () => {
            this._rejectReadyWaiter(new Error('管理员硬件读取器连接已关闭'));
            if (!this.stopping) this._rejectPending(new Error('管理员硬件读取器连接已关闭'));
            if (this.socket === socket) {
              this.socket = null;
              this.ready = false;
              this.elevated = false;
            }
          });
        });
      };
      attempt();
    });
  }

  _rejectReadyWaiter(error) {
    if (!this.readyWaiter) return;
    const waiter = this.readyWaiter;
    this.readyWaiter = null;
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
}
