import { execFile } from 'child_process';

export const NVIDIA_BASE_FIELDS = Object.freeze([
  'name',
  'driver_version',
  'temperature.gpu',
  'utilization.gpu',
  'utilization.memory',
  'memory.used',
  'memory.total',
  'power.draw',
]);

export const NVIDIA_ARGS = [
  `--query-gpu=${NVIDIA_BASE_FIELDS.join(',')}`,
  '--format=csv,noheader,nounits',
];

export const NVIDIA_OPTIONAL_FIELDS = Object.freeze([
  'fan.speed',
  'clocks.current.graphics',
  'clocks.current.memory',
  'utilization.encoder',
  'utilization.decoder',
  'pstate',
  'power.limit',
]);

function toNumber(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function mibToBytes(value) {
  const number = toNumber(value);
  return number === null ? null : number * 1024 * 1024;
}

function parseNvidiaLine(line) {
  const parts = line.split(/,\s*/);
  if (parts.length < 8) throw new Error('Unexpected nvidia-smi output');

  const memoryUsedBytes = mibToBytes(parts[5]);
  const memoryTotalBytes = mibToBytes(parts[6]);
  const reportedMemoryUsage = toNumber(parts[4]);

  return {
    name: parts[0],
    driverVersion: parts[1] || null,
    temperatureC: toNumber(parts[2]),
    usage: toNumber(parts[3]),
    memoryUsage: reportedMemoryUsage ?? (
      memoryUsedBytes !== null && memoryTotalBytes > 0
        ? 100 * memoryUsedBytes / memoryTotalBytes
        : null
    ),
    memoryUsedBytes,
    memoryTotalBytes,
    powerWatts: toNumber(parts[7]),
    provider: 'nvidia-smi',
  };
}

/** Parse every adapter returned by nvidia-smi, including mixed/multi-GPU PCs. */
export function parseNvidiaOutputAll(stdout) {
  const lines = String(stdout || '')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) throw new Error('Empty nvidia-smi output');
  return lines.map(parseNvidiaLine);
}

export function parseNvidiaOptionalOutput(stdout, fields) {
  const lines = String(stdout || '').trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.map((line) => {
    const values = line.split(/,\s*/);
    const result = {};
    fields.forEach((field, index) => {
      const raw = values[index];
      const value = toNumber(raw);
      if (field === 'fan.speed') result.fanPercent = value;
      if (field === 'clocks.current.graphics') result.clockMHz = value;
      if (field === 'clocks.current.memory') result.memoryClockMHz = value;
      if (field === 'utilization.encoder') result.encoderUsage = value;
      if (field === 'utilization.decoder') result.decoderUsage = value;
      if (field === 'pstate') result.performanceState = raw && !/not supported|n\/a/i.test(raw) ? raw : null;
      if (field === 'power.limit') result.powerLimitWatts = value;
    });
    return result;
  });
}

export function parseNvidiaCombinedOutput(stdout, optionalFields = []) {
  const lines = String(stdout || '').trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Empty nvidia-smi output');
  return lines.map((line) => {
    const values = line.split(/,\s*/);
    const base = parseNvidiaLine(values.slice(0, NVIDIA_BASE_FIELDS.length).join(', '));
    const optional = parseNvidiaOptionalOutput(
      values.slice(NVIDIA_BASE_FIELDS.length).join(', '),
      optionalFields,
    )[0] || {};
    return { ...base, ...optional };
  });
}

/**
 * Backward-compatible single-adapter parser used by earlier tests and callers.
 * Legacy aliases remain so old renderer payloads do not silently break.
 */
export function parseNvidiaOutput(stdout) {
  const gpu = parseNvidiaOutputAll(stdout)[0];
  return {
    name: gpu.name,
    driverVersion: gpu.driverVersion,
    temperature: gpu.temperatureC,
    gpuUtilization: gpu.usage,
    memoryUtilization: gpu.memoryUsage,
    memoryUsed: gpu.memoryUsedBytes === null ? null : gpu.memoryUsedBytes / 1024 / 1024,
    memoryTotal: gpu.memoryTotalBytes === null ? null : gpu.memoryTotalBytes / 1024 / 1024,
    powerDraw: gpu.powerWatts,
    provider: gpu.provider,
  };
}

/** Normalize a generic Windows adapter payload while accepting the old schema. */
export function parseWindowsGpuOutput(stdout) {
  const raw = String(stdout || '').replace(/^\uFEFF/, '').trim();
  const data = JSON.parse(raw);
  if (!data?.name) throw new Error('Windows GPU query returned no adapter');

  for (const key of [
    'temperature', 'temperatureC', 'gpuUtilization', 'usage',
    'memoryUtilization', 'memoryUsage', 'memoryUsed', 'memoryTotal',
    'memoryUsedBytes', 'memoryTotalBytes', 'powerDraw', 'powerWatts',
  ]) {
    if (key in data) data[key] = toNumber(data[key]);
  }
  return data;
}

export function selectPrimaryGpu(adapters) {
  const candidates = Array.isArray(adapters) ? adapters.filter(Boolean) : [];
  if (candidates.length === 0) return null;

  return [...candidates].sort((a, b) => {
    const aHardware = /virtual|remote|basic display|idd/i.test(a.name || '') ? 0 : 1;
    const bHardware = /virtual|remote|basic display|idd/i.test(b.name || '') ? 0 : 1;
    if (aHardware !== bHardware) return bHardware - aHardware;
    return (b.usage ?? -1) - (a.usage ?? -1);
  })[0];
}

export class NvidiaQueryClient {
  constructor({ execFileImpl = execFile, timeoutMs = 5000 } = {}) {
    this.execFileImpl = execFileImpl;
    this.timeoutMs = timeoutMs;
    this.supportedFields = null;
  }

  execute(args) {
    return new Promise((resolve, reject) => {
      this.execFileImpl(
      'nvidia-smi.exe',
      args,
      { timeout: this.timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || '').trim();
          reject(new Error(detail || error.message));
          return;
        }
        resolve(stdout);
      },
      );
    });
  }

  resetCapabilities() {
    this.supportedFields = null;
  }

  async query() {
    if (this.supportedFields === null) {
      try {
        const help = await this.execute(['--help-query-gpu']);
        this.supportedFields = NVIDIA_OPTIONAL_FIELDS.filter((field) => String(help).includes(field));
      } catch {
        this.supportedFields = [];
      }
    }
    const fields = [...NVIDIA_BASE_FIELDS, ...this.supportedFields];
    let stdout;
    try {
      stdout = await this.execute([
        `--query-gpu=${fields.join(',')}`,
        '--format=csv,noheader,nounits',
      ]);
    } catch (error) {
      if (!this.supportedFields.length) throw error;
      // Some driver versions advertise a field but reject it for the current
      // board. Keep the base GPU data and remember the reduced capability set.
      this.supportedFields = [];
      stdout = await this.execute(NVIDIA_ARGS);
    }
    const sampledAt = Date.now();
    return parseNvidiaCombinedOutput(stdout, this.supportedFields)
      .map((adapter) => ({ ...adapter, sampledAt }));
  }
}

const defaultNvidiaClient = new NvidiaQueryClient();

export function queryNvidiaGpus(options = {}) {
  if (options.execFileImpl || options.timeoutMs) return new NvidiaQueryClient(options).query();
  return defaultNvidiaClient.query();
}
