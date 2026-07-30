import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import test from 'node:test';

import {
  HardwareSensorClient,
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
  assert.equal(snapshot.gpus.length, 1);
  assert.equal(snapshot.gpus[0].name, 'GPU');
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

test('does not present an all-zero GPU fan placeholder as measured RPM', () => {
  const snapshot = parseHardwareSensorSnapshot({
    type: 'snapshot',
    protocolVersion: 1,
    elevated: false,
    hardware: [{ identifier: '/gpu/0', name: 'GPU', hardwareType: 'GpuAmd' }],
    sensors: [
      sensor({
        identifier: '/gpu/0/fan/0', hardwareIdentifier: '/gpu/0', hardwareName: 'GPU', hardwareType: 'GpuAmd',
        sensorType: 'Fan', name: 'GPU Fan', value: 0, min: 0, max: 0,
      }),
      sensor({
        identifier: '/gpu/0/control/0', hardwareIdentifier: '/gpu/0', hardwareName: 'GPU', hardwareType: 'GpuAmd',
        sensorType: 'Control', name: 'GPU Fan', value: 0, min: 0, max: 0,
      }),
    ],
  });

  assert.equal(snapshot.gpu.fanRpm, null);
  assert.equal(snapshot.gpu.fanPercent, null);
  assert.equal(snapshot.fans.length, 0);
  assert.equal(snapshot.sensors[0].reasonCode, 'zero_fan_unconfirmed');
  assert.match(snapshot.sensors[0].reason, /停转模式/);
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

test('maps device update failures and empty sensor values to specific reasons', () => {
  const snapshot = parseHardwareSensorSnapshot({
    type: 'snapshot', protocolVersion: 1, elevated: false,
    hardware: [{ identifier: '/cpu/0', name: 'CPU', hardwareType: 'Cpu' }],
    sensors: [sensor({ hardwareIdentifier: '/cpu/0', hardwareName: 'CPU', value: null })],
    errors: ['/cpu/0: Access denied'],
  });
  assert.equal(snapshot.issues[0].code, 'permission_required');
  assert.equal(snapshot.sensors[0].reasonCode, 'permission_required');
  assert.equal(snapshot.access.permissionEvidence, true);
});

test('elevates only the hardware host and confirms the named-pipe handshake', async () => {
  const socket = new EventEmitter();
  socket.destroyed = false;
  socket.setEncoding = () => {};
  socket.write = () => true;
  socket.destroy = () => { socket.destroyed = true; };
  let launchOptions = null;
  let connectedPath = null;
  const client = new HardwareSensorClient(process.execPath, {
    launchElevatedImpl: async (options) => {
      launchOptions = options;
      return { started: true };
    },
    resolveUserSidImpl: () => 'S-1-5-21-123-456-789-1001',
    connectImpl: (pipePath) => {
      connectedPath = pipePath;
      queueMicrotask(() => {
        socket.emit('connect');
        queueMicrotask(() => socket.emit('data', '{"type":"ready","protocolVersion":1,"elevated":true}\n'));
      });
      return socket;
    },
    elevationConnectTimeoutMs: 1000,
  });

  const result = await client.requestElevation();
  assert.equal(result.started, true);
  assert.equal(client.elevated, true);
  assert.equal(client.ready, true);
  assert.equal(launchOptions.executable, process.execPath);
  assert.equal(launchOptions.args[0], '--pipe');
  assert.match(launchOptions.args[1], /^turtle-monitor-hardware-/);
  assert.deepEqual(launchOptions.args.slice(2), ['--client-sid', 'S-1-5-21-123-456-789-1001']);
  assert.match(connectedPath, /^\\\\\.\\pipe\\turtle-monitor-hardware-/);
  client.stop();
});
