import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateCpuUsage,
  createPersistentWindowsMonitorScript,
  matchHardwareGpu,
  mergeSnapshots,
  mergeWindowsSnapshots,
  parseWindowsSystemOutput,
  resolveMonitorCadence,
  SystemMonitor,
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
    probeErrors: [{ probe: 'thermal-zone-cim', code: 'query_failed', message: 'Class not supported' }],
    system: { osName: 'Windows', processCount: 123 },
    cpu: { physicalCores: 8, logicalCores: 16 },
    memory: { totalBytes: 1000, availableBytes: 250 },
    disks: [{ name: 'C:', sizeBytes: 1000, freeBytes: 200 }],
    physicalDisks: [{ name: 'SSD', mediaType: 'SSD', healthStatus: 'Healthy', sizeBytes: 1000, temperatureC: 41, wearPercent: 3 }],
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
  assert.equal(parsed.snapshot.physicalDisks[0].temperatureC, 41);
  assert.equal(parsed.snapshot.probeErrors[0].probe, 'thermal-zone-cim');
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

test('hardware sensors enrich OS counters without replacing their fallbacks', () => {
  const portable = {
    providers: ['node-os'],
    system: { hostname: 'PC' },
    cpu: { usage: 35 },
    memory: { usage: 50 },
    disks: [],
    diskIo: {},
    network: { interfaces: [] },
    gpu: { name: 'GPU', usage: 20 },
    thermalZones: [],
    battery: null,
    diagnostics: {},
  };
  const hardwareSensors = {
    provider: 'librehardwaremonitor',
    cpu: { temperatureC: 61, powerWatts: 70 },
    gpu: { temperatureC: 52, powerWatts: 90, fanRpm: 1100 },
  };

  const merged = mergeSnapshots(portable, null, null, {}, hardwareSensors);
  assert.equal(merged.cpu.usage, 35);
  assert.equal(merged.cpu.temperatureC, 61);
  assert.equal(merged.gpu.usage, 20);
  assert.equal(merged.gpu.temperatureC, 52);
  assert.equal(merged.gpu.fanRpm, 1100);
  assert.ok(merged.providers.includes('librehardwaremonitor'));
});

test('matches hardware readings to the correct GPU without guessing between multiple adapters', () => {
  const hardware = [
    { name: 'NVIDIA GeForce RTX 4070', temperatureC: 50 },
    { name: 'AMD Radeon RX 590', temperatureC: 60 },
  ];
  assert.equal(matchHardwareGpu('AMD Radeon RX590 GME', hardware).temperatureC, 60);
  assert.equal(matchHardwareGpu('Unknown virtual adapter', hardware), null);
});

test('monitor cadence keeps panel data fast while using the low-power hidden cadence', () => {
  assert.deepEqual(resolveMonitorCadence({ panelOpen: true, onBattery: true, idleSeconds: 600 }), {
    portable: 1000, windows: 2000, nvidia: 2000, hardware: 2000,
  });
  assert.deepEqual(resolveMonitorCadence({ panelOpen: false, onBattery: false, idleSeconds: 0 }), {
    portable: 5000, windows: 10000, nvidia: 10000, hardware: 10000,
  });
  assert.deepEqual(resolveMonitorCadence({ panelOpen: false, onBattery: true, idleSeconds: 0 }), {
    portable: 5000, windows: 10000, nvidia: 10000, hardware: 10000,
  });
  assert.deepEqual(resolveMonitorCadence({ panelOpen: false, onBattery: false, idleSeconds: 600 }), {
    portable: 5000, windows: 10000, nvidia: 10000, hardware: 10000,
  });
});

test('monitor activity switches cadence immediately on panel open and defers work on close', () => {
  let now = 10_000;
  const monitor = new SystemMonitor(null, 2000, { now: () => now });
  const scheduled = [];
  monitor._schedule = (delay, force = false) => scheduled.push({ delay, force });
  monitor.activityState = { panelOpen: true, onBattery: false, suspended: false };
  monitor.nextDue = { portable: now + 1, windows: now + 1, nvidia: now + 1, hardware: now + 1 };

  monitor.setActivityState({ panelOpen: false });
  assert.deepEqual(monitor.nextDue, {
    portable: 15_000, windows: 20_000, nvidia: 20_000, hardware: 20_000,
  });
  assert.deepEqual(scheduled.pop(), { delay: 5000, force: false });

  now += 100;
  monitor.setActivityState({ panelOpen: true });
  assert.deepEqual(monitor.nextDue, { portable: 0, windows: 0, nvidia: 0, hardware: 0 });
  assert.deepEqual(scheduled.pop(), { delay: 0, force: true });
});

test('persistent Windows monitor script accepts repeated snapshot commands', () => {
  const script = createPersistentWindowsMonitorScript('"{\\"ok\\":true}"');
  assert.match(script, /while \(\$null -ne \(\$requestLine/);
  assert.match(script, /TURTLE_MONITOR_COUNTER_GROUPS/);
  assert.match(script, /TURTLE_MONITOR_FAST_ONLY/);
  assert.match(script, /__TURTLE_MONITOR_END__:/);
});

test('fast Windows samples update live counters without dropping static details', () => {
  const previous = {
    timestamp: 100,
    providers: ['windows-cim', 'Win32_LogicalDisk'],
    probeErrors: [{ probe: 'thermal', code: 'query_failed', message: 'not exposed' }],
    system: { osName: 'Windows 11', model: 'Desktop', processCount: 100 },
    cpu: { model: 'CPU model', usage: 20, physicalCores: 8 },
    memory: { totalBytes: 1000, usage: 50 },
    disks: [{ name: 'C:', sizeBytes: 1000 }],
    physicalDisks: [{ name: 'SSD' }],
    diskIo: { readBytesPerSec: 10 },
    network: { interfaces: [{ name: 'Ethernet' }], downloadBytesPerSec: 10 },
    gpu: { name: 'GPU', adapters: [{ name: 'GPU' }], memoryTotalBytes: 8000, usage: 20 },
    thermalZones: [{ name: 'TZ0', temperatureC: 40 }],
    battery: { percent: 80 },
  };
  const fast = {
    timestamp: 200,
    providers: ['windows-cim', 'Get-Counter:CPU'],
    probeErrors: [],
    system: { osName: null, model: null, processCount: 110 },
    cpu: { model: null, usage: 65, physicalCores: null },
    memory: { totalBytes: null, usage: null },
    disks: [],
    physicalDisks: [],
    diskIo: { readBytesPerSec: 500 },
    network: { interfaces: [{ name: 'Ethernet' }], downloadBytesPerSec: 900 },
    gpu: { name: null, adapters: [], memoryTotalBytes: null, usage: 70 },
    thermalZones: [],
    battery: null,
  };

  const merged = mergeWindowsSnapshots(previous, fast);
  assert.equal(merged.timestamp, 200);
  assert.equal(merged.system.model, 'Desktop');
  assert.equal(merged.system.processCount, 110);
  assert.equal(merged.cpu.model, 'CPU model');
  assert.equal(merged.cpu.usage, 65);
  assert.equal(merged.disks[0].name, 'C:');
  assert.equal(merged.gpu.name, 'GPU');
  assert.equal(merged.gpu.usage, 70);
  assert.equal(merged.gpu.memoryTotalBytes, 8000);
  assert.equal(merged.battery.percent, 80);
});
