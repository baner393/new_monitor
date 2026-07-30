import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  parseHardwareSensorSnapshot,
  resolveHardwareSensorHostPath,
} from '../src/main/hardware-sensor-monitor.js';

function sensor(overrides) {
  return {
    identifier: '/sensor/0',
    name: 'Sensor',
    sensorType: 'Temperature',
    index: 0,
    value: 42,
    min: 30,
    max: 50,
    hardwareIdentifier: '/hardware/0',
    hardwareName: 'Device',
    hardwareType: 'Cpu',
    ...overrides,
  };
}

test('normalizes and summarizes the complete hardware sensor inventory', () => {
  const snapshot = parseHardwareSensorSnapshot({
    type: 'snapshot',
    protocolVersion: 1,
    provider: 'librehardwaremonitor',
    providerVersion: '0.9.6.0',
    elevated: true,
    hardware: [
      { identifier: '/cpu/0', name: 'CPU', hardwareType: 'Cpu' },
      { identifier: '/gpu/0', name: 'GPU', hardwareType: 'GpuAmd' },
      { identifier: '/storage/0', name: 'NVMe', hardwareType: 'Storage' },
    ],
    sensors: [
      sensor({ hardwareIdentifier: '/cpu/0', hardwareName: 'CPU', name: 'CPU Package', value: 63 }),
      sensor({ hardwareIdentifier: '/cpu/0', hardwareName: 'CPU', sensorType: 'Power', name: 'CPU Package', value: 82.5 }),
      sensor({ hardwareIdentifier: '/gpu/0', hardwareName: 'GPU', hardwareType: 'GpuAmd', name: 'GPU Core', value: 55 }),
      sensor({ hardwareIdentifier: '/gpu/0', hardwareName: 'GPU', hardwareType: 'GpuAmd', sensorType: 'Fan', name: 'GPU Fan', value: 1200 }),
      sensor({ hardwareIdentifier: '/storage/0', hardwareName: 'NVMe', hardwareType: 'Storage', name: 'Composite', value: 44 }),
      sensor({ hardwareIdentifier: '/storage/0', hardwareName: 'NVMe', hardwareType: 'Storage', sensorType: 'Level', name: 'Remaining Life', value: 97 }),
    ],
    errors: [],
  });

  assert.equal(snapshot.access.sensorCount, 6);
  assert.equal(snapshot.access.permissionRecommended, false);
  assert.equal(snapshot.cpu.temperatureC, 63);
  assert.equal(snapshot.cpu.hardwareIdentifier, '/cpu/0');
  assert.equal(snapshot.cpu.powerWatts, 82.5);
  assert.equal(snapshot.gpu.temperatureC, 55);
  assert.equal(snapshot.gpu.hardwareIdentifier, '/gpu/0');
  assert.equal(snapshot.gpu.fanRpm, 1200);
  assert.equal(snapshot.storage[0].temperatureC, 44);
  assert.equal(snapshot.storage[0].hardwareIdentifier, '/storage/0');
  assert.equal(snapshot.storage[0].lifePercent, 97);
  assert.equal(snapshot.sensors.length, 6);
});

test('marks protected CPU sensors as permission candidates in standard mode', () => {
  const snapshot = parseHardwareSensorSnapshot({
    type: 'snapshot',
    protocolVersion: 1,
    elevated: false,
    hardware: [{ identifier: '/cpu/0', name: 'CPU', hardwareType: 'Cpu' }],
    sensors: [sensor({ sensorType: 'Power', name: 'CPU Package', value: 0 })],
  });

  assert.equal(snapshot.access.permissionRecommended, true);
  assert.equal(snapshot.cpu.temperatureC, null);
  assert.equal(snapshot.cpu.powerWatts, null);
});

test('does not present unsupported all-zero CPU power counters as a real reading', () => {
  const snapshot = parseHardwareSensorSnapshot({
    type: 'snapshot',
    protocolVersion: 1,
    elevated: true,
    hardware: [{ identifier: '/cpu/0', name: 'CPU', hardwareType: 'Cpu' }],
    sensors: [
      sensor({ sensorType: 'Power', name: 'CPU Package', value: 0 }),
      sensor({ identifier: '/sensor/1', sensorType: 'Power', name: 'CPU Cores', value: 0 }),
    ],
  });

  assert.equal(snapshot.access.permissionRecommended, false);
  assert.equal(snapshot.cpu.powerWatts, null);
});

test('resolves source and packaged sensor hosts without machine-specific paths', () => {
  assert.equal(resolveHardwareSensorHostPath({
    appPath: path.join('D:', 'apps', 'monitor'),
    resourcesPath: path.join('D:', 'ignored'),
    isPackaged: false,
  }), path.join('D:', 'apps', 'monitor', 'resources', 'hardware-sensor', 'HardwareSensorHost.exe'));
  assert.equal(resolveHardwareSensorHostPath({
    appPath: path.join('D:', 'ignored'),
    resourcesPath: path.join('E:', 'portable', 'resources'),
    isPackaged: true,
  }), path.join('E:', 'portable', 'resources', 'hardware-sensor', 'HardwareSensorHost.exe'));
});

test('rejects incompatible host protocol payloads', () => {
  assert.throws(() => parseHardwareSensorSnapshot({ type: 'snapshot', protocolVersion: 2 }), /incompatible/);
});
