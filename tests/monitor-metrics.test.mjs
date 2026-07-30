import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMonitorMetricInventory } from '../src/main/monitor-metrics.js';

function baseSnapshot(overrides = {}) {
  return {
    timestamp: 1000,
    providers: ['node-os', 'windows-cim', 'librehardwaremonitor'],
    diagnostics: {},
    providerDetails: { windows: { probeErrors: [] }, hardware: { issues: [] } },
    system: { osName: 'Windows 11', uptimeSec: 120, processCount: 10, threadCount: 100, cpuQueueLength: 0 },
    cpu: { model: 'CPU', usage: 20, physicalCores: 4, logicalCores: 8, currentClockMHz: 4000, perCoreUsage: [10, 30], temperatureC: 60 },
    memory: { totalBytes: 1000, usedBytes: 500, availableBytes: 500, usage: 50, pageFileTotalBytes: 200, pageFileAvailableBytes: 100 },
    disks: [{ name: 'C:', sizeBytes: 1000, usedBytes: 600, freeBytes: 400, usage: 60, provider: 'windows-cim' }],
    physicalDisks: [],
    diskIo: { readBytesPerSec: 10, writeBytesPerSec: 20, provider: 'performance-counter' },
    network: { downloadBytesPerSec: 30, uploadBytesPerSec: 40, interfaces: [] },
    gpu: null,
    battery: null,
    thermalZones: [],
    hardwareSensors: { hardware: [], sensors: [], storage: [], access: { elevated: false }, issues: [] },
    ...overrides,
  };
}

test('keeps every distinct core and storage value in the complete metric list', () => {
  const inventory = buildMonitorMetricInventory(baseSnapshot());
  assert.equal(inventory.metrics.filter((item) => /^cpu:core:\d+:usage$/.test(item.key)).length, 2);
  assert.ok(inventory.metrics.some((item) => item.key === 'storage:c:total'));
  assert.ok(inventory.metrics.some((item) => item.key === 'memory:page-used' && item.value === 100));
});

test('deduplicates a preferred CPU package sensor already used by the summary', () => {
  const snapshot = baseSnapshot({
    hardwareSensors: {
      hardware: [{ identifier: '/cpu/0', hardwareType: 'Cpu' }],
      storage: [],
      access: { elevated: true },
      issues: [],
      sensors: [{
        identifier: '/cpu/0/temperature/0',
        hardwareIdentifier: '/cpu/0',
        hardwareName: 'CPU',
        hardwareType: 'Cpu',
        name: 'CPU Package',
        sensorType: 'Temperature',
        value: 60,
        status: 'available',
        provider: 'librehardwaremonitor',
      }],
    },
  });
  const inventory = buildMonitorMetricInventory(snapshot);
  assert.equal(inventory.metrics.filter((item) => item.cardId === 'cpu' && item.kind === 'temperature').length, 1);
  assert.equal(inventory.metrics.find((item) => item.key === 'cpu:temperature').value, 60);
});

test('uses an enumerated empty sensor reason instead of a generic missing message', () => {
  const snapshot = baseSnapshot({
    cpu: { model: 'CPU', usage: 20 },
    hardwareSensors: {
      hardware: [{ identifier: '/cpu/0', hardwareType: 'Cpu' }],
      storage: [],
      access: { elevated: true },
      issues: [],
      sensors: [{
        identifier: '/cpu/0/temperature/0', hardwareIdentifier: '/cpu/0', hardwareName: 'CPU', hardwareType: 'Cpu',
        name: 'CPU Package', sensorType: 'Temperature', value: null, status: 'unavailable',
        reasonCode: 'sensor_returned_no_value', reason: '传感器已枚举，但本次返回空值',
      }],
    },
  });
  const inventory = buildMonitorMetricInventory(snapshot);
  const issue = inventory.availability.find((item) => item.key === 'cpu:temperature');
  assert.equal(issue.reasonCode, 'sensor_returned_no_value');
  assert.match(issue.reason, /返回空值/);
});

test('collapses an absent device into one clear battery explanation', () => {
  const inventory = buildMonitorMetricInventory(baseSnapshot());
  const issues = inventory.availability.filter((item) => item.cardId === 'battery');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].reasonCode, 'device_absent');
});

test('reports first-sample rate warmup separately from provider failure', () => {
  const snapshot = baseSnapshot({
    network: { downloadBytesPerSec: null, uploadBytesPerSec: null, interfaces: [{ name: 'Ethernet', mode: 'cumulative' }] },
  });
  const inventory = buildMonitorMetricInventory(snapshot);
  assert.equal(inventory.availability.find((item) => item.key === 'network:download').reasonCode, 'first_sample_pending');
});

test('only recommends elevation when a provider returned permission evidence', () => {
  const snapshot = baseSnapshot({
    cpu: { model: 'CPU', usage: 20, temperatureC: null },
    hardwareSensors: {
      hardware: [{ identifier: '/cpu/0', hardwareType: 'Cpu' }],
      sensors: [], storage: [], access: { elevated: false },
      issues: [{ hardwareIdentifier: '/cpu/0', code: 'permission_required', message: 'Access denied' }],
    },
  });
  const inventory = buildMonitorMetricInventory(snapshot);
  const issue = inventory.availability.find((item) => item.key === 'cpu:temperature');
  assert.equal(issue.reasonCode, 'permission_required');
  assert.equal(issue.action, 'request_elevation');
});
