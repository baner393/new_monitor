import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNvidiaOutput, parseWindowsGpuOutput } from '../src/main/gpu-monitor.js';

test('parses nvidia-smi metrics', () => {
  assert.deepEqual(
    parseNvidiaOutput('NVIDIA GeForce RTX 4070, 55, 20, 10, 1024, 12282, 75.5\r\n'),
    {
      name: 'NVIDIA GeForce RTX 4070',
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
