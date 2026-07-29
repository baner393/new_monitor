import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseNvidiaOutput,
  parseNvidiaOutputAll,
  parseWindowsGpuOutput,
  selectPrimaryGpu,
} from '../src/main/gpu-monitor.js';

test('parses nvidia-smi metrics', () => {
  assert.deepEqual(
    parseNvidiaOutput('NVIDIA GeForce RTX 4070, 555.42, 55, 20, 10, 1024, 12282, 75.5\r\n'),
    {
      name: 'NVIDIA GeForce RTX 4070',
      driverVersion: '555.42',
      temperature: 55,
      gpuUtilization: 20,
      memoryUtilization: 10,
      memoryUsed: 1024,
      memoryTotal: 12282,
      powerDraw: 75.5,
      provider: 'nvidia-smi',
    },
  );
});

test('parses and selects from multiple NVIDIA adapters', () => {
  const adapters = parseNvidiaOutputAll([
    'NVIDIA RTX A2000, 555.42, 42, 10, 5, 512, 6144, 30',
    'NVIDIA GeForce RTX 4090, 555.42, 62, 75, 20, 4096, 24564, 320',
  ].join('\n'));
  assert.equal(adapters.length, 2);
  assert.equal(selectPrimaryGpu(adapters).name, 'NVIDIA GeForce RTX 4090');
  assert.equal(adapters[1].memoryTotalBytes, 24564 * 1024 * 1024);
});

test('keeps unavailable metrics as null instead of fake zeroes', () => {
  const result = parseWindowsGpuOutput(JSON.stringify({
    name: 'AMD Radeon RX590 GME',
    driverVersion: '31.0.21912.14',
    gpuUtilization: 12.5,
    memoryUsed: 512,
    memoryTotal: 4095,
    temperature: null,
    powerDraw: null,
    provider: 'windows',
  }));
  assert.equal(result.name, 'AMD Radeon RX590 GME');
  assert.equal(result.temperature, null);
  assert.equal(result.powerDraw, null);
  assert.equal(result.gpuUtilization, 12.5);
});

test('rejects malformed provider output', () => {
  assert.throws(() => parseNvidiaOutput('not enough fields'), /Unexpected/);
  assert.throws(() => parseWindowsGpuOutput('{}'), /no adapter/);
});
