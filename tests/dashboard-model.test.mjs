import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveDashboardReadings,
  detectDashboardCardAvailability,
  effectiveDashboardCardIds,
  normalizeBatteryState,
  reorderDashboardCards,
} from '../src/renderer/dashboard-model.js';
import { createDefaultMonitorPanelConfig } from '../src/shared/monitor-panel-config.js';

test('raw hardware sensors fill curated dashboard gaps without treating limits as live temperatures', () => {
  const data = {
    cpu: { temperatureC: null, powerWatts: null },
    gpu: { name: 'GPU', usage: null, temperatureC: null },
    hardwareSensors: {
      cpu: { powerWatts: 64 },
      sensors: [
        { hardwareType: 'Cpu', hardwareIdentifier: '/cpu/0', sensorType: 'Temperature', name: 'CPU Package', value: 58 },
        { hardwareType: 'GpuNvidia', sensorType: 'Load', name: 'GPU Core', value: 72 },
        { hardwareType: 'GpuNvidia', sensorType: 'Load', name: 'GPU Memory', value: 94 },
        { hardwareType: 'GpuNvidia', hardwareIdentifier: '/gpu/0', sensorType: 'Temperature', name: 'GPU Core', value: 63 },
        { hardwareType: 'Storage', hardwareIdentifier: '/storage/0', sensorType: 'Temperature', name: 'Composite Temperature', value: 47 },
        { hardwareType: 'Storage', sensorType: 'Temperature', name: 'Critical Temperature', value: 84 },
        { hardwareType: 'Storage', sensorType: 'Throughput', name: 'Read Rate', value: 4000 },
        { hardwareType: 'Storage', sensorType: 'Throughput', name: 'Write Rate', value: 2000 },
        { hardwareType: 'Storage', sensorType: 'Load', name: 'Total Activity', value: 22 },
        { hardwareType: 'Network', hardwareName: 'Wi-Fi', sensorType: 'Throughput', name: 'Download Speed', value: 9000 },
        { hardwareType: 'Network', hardwareName: 'Wi-Fi', sensorType: 'Throughput', name: 'Upload Speed', value: 3000 },
      ],
    },
  };
  assert.deepEqual(deriveDashboardReadings(data), {
    cpuTemperatureC: 58,
    cpuTemperatureIdentifier: '/cpu/0',
    gpuTemperatureC: 63,
    gpuTemperatureIdentifier: '/gpu/0',
    gpuUsage: 72,
    cpuPowerWatts: 64,
    gpuPowerWatts: null,
    storageTemperatureC: 47,
    storageTemperatureIdentifier: '/storage/0',
    networkDownloadBytesPerSec: 9000,
    networkUploadBytesPerSec: 3000,
    networkInterfaceName: 'Wi-Fi',
    diskReadBytesPerSec: 4000,
    diskWriteBytesPerSec: 2000,
    diskActivity: 22,
  });
});

test('missing optional devices keep their desired config but do not occupy the overview', () => {
  const config = createDefaultMonitorPanelConfig();
  const availability = detectDashboardCardAvailability({});
  assert.equal(availability.gpu, false);
  assert.equal(availability.cooling, false);
  assert.equal(availability.battery, false);
  assert.equal(config.layout.enabled.gpu, true);
  assert.deepEqual(effectiveDashboardCardIds(config, {}), ['cpu', 'memory', 'network', 'storage']);
});

test('unavailable placeholder sensors never become live dashboard readings', () => {
  const data = {
    gpu: { name: 'GPU', usage: null },
    hardwareSensors: {
      sensors: [
        { hardwareType: 'GpuAmd', sensorType: 'Load', name: 'GPU Core', value: 0, status: 'unavailable' },
        { hardwareType: 'GpuAmd', sensorType: 'Fan', name: 'GPU Fan', value: 0, status: 'unavailable' },
        { hardwareType: 'GpuAmd', sensorType: 'Control', name: 'GPU Fan', value: 0, status: 'unavailable' },
      ],
    },
  };

  assert.equal(deriveDashboardReadings(data).gpuUsage, null);
  assert.equal(detectDashboardCardAvailability(data).cooling, true);
});

test('card reordering is deterministic in both directions', () => {
  const order = ['cpu', 'memory', 'gpu', 'network'];
  assert.deepEqual(reorderDashboardCards(order, 'cpu', 'gpu'), ['memory', 'gpu', 'cpu', 'network']);
  assert.deepEqual(reorderDashboardCards(order, 'network', 'memory'), ['cpu', 'network', 'memory', 'gpu']);
  assert.deepEqual(order, ['cpu', 'memory', 'gpu', 'network']);
});

test('battery status distinguishes external power and rejects Windows unknown-time sentinels', () => {
  assert.deepEqual(normalizeBatteryState({ statusCode: 2, estimatedMinutes: 71582788 }), {
    label: '外接电源',
    charging: false,
    estimatedMinutes: null,
  });
  assert.equal(normalizeBatteryState({ statusCode: 6, estimatedMinutes: 90 }).charging, true);
  assert.deepEqual(normalizeBatteryState(null), {
    label: '状态未知',
    charging: false,
    estimatedMinutes: null,
  });
});
