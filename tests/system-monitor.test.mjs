import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateCpuUsage,
  mergeSnapshots,
  parseWindowsSystemOutput,
} from '../src/main/system-monitor.js';

test('calculates total and per-core CPU deltas', () => {
  const previous = {
    idle: 120,
    total: 300,
    perCore: [{ idle: 60, total: 150 }, { idle: 60, total: 150 }],
  };
  const current = {
    idle: 170,
    total: 500,
    perCore: [{ idle: 80, total: 250 }, { idle: 90, total: 250 }],
  };

  assert.deepEqual(calculateCpuUsage(previous, current), {
    usage: 75,
    perCoreUsage: [80, 70],
  });
});

test('normalizes Windows capacities and cumulative network fallback', () => {
  const payload = JSON.stringify({
    provider: 'windows-cim',
    sources: ['Get-NetAdapterStatistics'],
    system: { osName: 'Windows', processCount: 123 },
    cpu: { physicalCores: 8, logicalCores: 16 },
    memory: { totalBytes: 1000, availableBytes: 250 },
    disks: [{ name: 'C:', sizeBytes: 1000, freeBytes: 200 }],
    diskIo: { mode: 'cumulative', readBytesPerSec: 5000, writeBytesPerSec: 3000, transfersPerSec: 100 },
    networkInterfaces: [{ name: 'Ethernet', mode: 'cumulative', download: 1500, upload: 900 }],
    gpu: {
      adapters: [
        { name: 'Virtual Display Adapter', adapterRamBytes: null },
        { name: 'AMD Radeon', driverVersion: '1.2.3', adapterRamBytes: 4000 },
      ],
      usage: 25,
      memoryUsedBytes: 1000,
      memoryTotalBytes: 8000,
      provider: 'windows-cim',
    },
  });

  const previousNetwork = new Map([['Ethernet', { download: 1000, upload: 500 }]]);
  const parsed = parseWindowsSystemOutput(payload, {
    previousNetwork,
    previousDisk: { read: 4000, write: 2000, transfers: 80 },
    elapsedSec: 2,
  });

  assert.equal(parsed.snapshot.memory.usedBytes, 750);
  assert.equal(parsed.snapshot.memory.usage, 75);
  assert.equal(parsed.snapshot.disks[0].usage, 80);
  assert.equal(parsed.snapshot.diskIo.readBytesPerSec, 500);
  assert.equal(parsed.snapshot.diskIo.writeBytesPerSec, 500);
  assert.equal(parsed.snapshot.network.downloadBytesPerSec, 250);
  assert.equal(parsed.snapshot.network.uploadBytesPerSec, 200);
  assert.equal(parsed.snapshot.gpu.name, 'AMD Radeon');
  assert.equal(parsed.snapshot.gpu.adapters.length, 1);
  assert.equal(parsed.snapshot.gpu.memoryUsage, 12.5);
});

test('keeps portable values when an optional Windows provider is empty', () => {
  const portable = {
    providers: ['node-os'],
    system: { hostname: 'PC', uptimeSec: 10 },
    cpu: { usage: 42, perCoreUsage: [40, 44] },
    memory: { usage: 50 },
    disks: [{ name: 'C:', usage: 60 }],
    diskIo: { usage: null },
    network: { interfaces: [] },
    gpu: null,
    thermalZones: [],
    battery: null,
    diagnostics: {},
  };
  const windows = {
    providers: ['windows-cim'],
    system: { osName: 'Windows' },
    cpu: { usage: null, perCoreUsage: [] },
    memory: { usage: null },
    disks: [],
    diskIo: { usage: null },
    network: { interfaces: [] },
    gpu: null,
    thermalZones: [],
    battery: null,
  };

  const merged = mergeSnapshots(portable, windows, null);
  assert.equal(merged.cpu.usage, 42);
  assert.deepEqual(merged.cpu.perCoreUsage, [40, 44]);
  assert.equal(merged.system.osName, 'Windows');
  assert.equal(merged.disks[0].name, 'C:');
});

test('malformed PowerShell output is rejected instead of becoming zeroes', () => {
  assert.throws(() => parseWindowsSystemOutput('warning only'), /no JSON/);
});
