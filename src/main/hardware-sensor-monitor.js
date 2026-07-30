import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function maximum(values) {
  const valid = values.map(finiteOrNull).filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : null;
}

function preferredValue(sensors, type, preferredNames = []) {
  const candidates = sensors.filter((sensor) => sensor.sensorType === type && sensor.value !== null);
  for (const pattern of preferredNames) {
    const match = candidates.find((sensor) => pattern.test(sensor.name));
    if (match) return match.value;
  }
  return maximum(candidates.map((sensor) => sensor.value));
}

function valuesOfType(sensors, type) {
  return sensors.filter((sensor) => sensor.sensorType === type && sensor.value !== null);
}

function summarizeDeviceSensors(sensors) {
  return {
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

  const sensors = (Array.isArray(raw.sensors) ? raw.sensors : []).map((sensor) => ({
    identifier: normalizedText(sensor?.identifier),
    name: normalizedText(sensor?.name, 'Sensor'),
    sensorType: normalizedText(sensor?.sensorType, 'Unknown'),
    index: finiteOrNull(sensor?.index),
    value: finiteOrNull(sensor?.value),
    min: finiteOrNull(sensor?.min),
    max: finiteOrNull(sensor?.max),
    hardwareIdentifier: normalizedText(sensor?.hardwareIdentifier),
    hardwareName: normalizedText(sensor?.hardwareName, 'Hardware'),
    hardwareType: normalizedText(sensor?.hardwareType, 'Unknown'),
  }));
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
  if (cpuPowerValues.length && cpuPowerValues.every((value) => value === 0)) cpu.powerWatts = null;

  return {
    provider: normalizedText(raw.provider, 'librehardwaremonitor'),
    providerVersion: normalizedText(raw.providerVersion) || null,
    timestamp: finiteOrNull(raw.timestamp),
    elevated: Boolean(raw.elevated),
    hardware,
    sensors,
    errors: (Array.isArray(raw.errors) ? raw.errors : []).map(String),
    access: {
      elevated: Boolean(raw.elevated),
      permissionRecommended: !raw.elevated && protectedCpuDataMissing,
      sensorCount: sensors.filter((sensor) => sensor.value !== null).length,
      totalSensorCount: sensors.length,
      hardwareCount: hardware.length,
    },
    cpu,
    gpu,
    motherboard: {
      temperatures: valuesOfType(boardSensors, 'Temperature'),
      fans: valuesOfType(boardSensors, 'Fan'),
      voltages: valuesOfType(boardSensors, 'Voltage'),
    },
    fans: fanSensors,
    voltages: voltageSensors,
    storage: storageSensors,
  };
}

export function resolveHardwareSensorHostPath({ appPath, resourcesPath, isPackaged }) {
  return isPackaged
    ? path.join(resourcesPath, 'hardware-sensor', 'HardwareSensorHost.exe')
    : path.join(appPath, 'resources', 'hardware-sensor', 'HardwareSensorHost.exe');
}

export class HardwareSensorClient {
  constructor(executablePath, { spawnImpl = spawn, timeoutMs = 12000 } = {}) {
    this.executablePath = executablePath;
    this.spawnImpl = spawnImpl;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.ready = false;
    this.buffer = '';
    this.stderr = '';
    this.pending = null;
    this.stopping = false;
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

    if (!this.child) this._start();
    if (this.ready) this._requestSnapshot();
    return promise;
  }

  stop() {
    this.stopping = true;
    this._rejectPending(new Error('Hardware sensor client stopped'));
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
      this.child.stdin.write('snapshot\n');
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
    if (this.child && !this.child.killed) this.child.kill();
  }

  _resetChild(child) {
    if (this.child !== child) return;
    this.child = null;
    this.ready = false;
  }
}
