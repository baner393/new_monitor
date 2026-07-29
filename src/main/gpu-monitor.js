import { execFile } from 'child_process';

export const NVIDIA_ARGS = [
  '--query-gpu=name,driver_version,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw',
  '--format=csv,noheader,nounits',
];

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

export function queryNvidiaGpus({ execFileImpl = execFile, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(
      'nvidia-smi.exe',
      NVIDIA_ARGS,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || '').trim();
          reject(new Error(detail || error.message));
          return;
        }
        try {
          resolve(parseNvidiaOutputAll(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}
