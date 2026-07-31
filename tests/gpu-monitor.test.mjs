import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NvidiaQueryClient,
  parseNvidiaCombinedOutput,
  parseNvidiaOutput,
  parseNvidiaOutputAll,
  parseNvidiaOptionalOutput,
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

test('parses only optional NVIDIA fields supported by the installed tool', () => {
  assert.deepEqual(
    parseNvidiaOptionalOutput('35, 2415, 10501, 4, 1, P2, 320.0', [
      'fan.speed', 'clocks.current.graphics', 'clocks.current.memory',
      'utilization.encoder', 'utilization.decoder', 'pstate', 'power.limit',
    ]),
    [{
      fanPercent: 35,
      clockMHz: 2415,
      memoryClockMHz: 10501,
      encoderUsage: 4,
      decoderUsage: 1,
      performanceState: 'P2',
      powerLimitWatts: 320,
    }],
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

test('checks NVIDIA optional fields once and reuses one combined query afterwards', async () => {
  const calls = [];
  const execFileImpl = (_file, args, _options, callback) => {
    calls.push(args);
    if (args[0] === '--help-query-gpu') {
      callback(null, 'fan.speed\npstate\n', '');
      return;
    }
    callback(null, 'NVIDIA RTX, 555.42, 50, 20, 10, 1024, 8192, 75, 35, P2\n', '');
  };
  const client = new NvidiaQueryClient({ execFileImpl });
  const first = await client.query();
  const second = await client.query();

  assert.equal(calls.filter((args) => args[0] === '--help-query-gpu').length, 1);
  assert.equal(calls.length, 3);
  assert.equal(first[0].fanPercent, 35);
  assert.equal(second[0].performanceState, 'P2');
  assert.match(calls[2][0], /fan\.speed/);
});

test('parses combined NVIDIA base and optional fields in one row', () => {
  const [gpu] = parseNvidiaCombinedOutput(
    'NVIDIA RTX, 555.42, 50, 20, 10, 1024, 8192, 75, 35, P2',
    ['fan.speed', 'pstate'],
  );
  assert.equal(gpu.name, 'NVIDIA RTX');
  assert.equal(gpu.fanPercent, 35);
  assert.equal(gpu.performanceState, 'P2');
});

test('falls back to base NVIDIA fields when an advertised optional field is rejected', async () => {
  const calls = [];
  const execFileImpl = (_file, args, _options, callback) => {
    calls.push(args);
    if (args[0] === '--help-query-gpu') {
      callback(null, 'fan.speed\n', '');
    } else if (args[0].includes('fan.speed')) {
      callback(new Error('field rejected'), '', 'Field is not supported on this device');
    } else {
      callback(null, 'NVIDIA RTX, 555.42, 50, 20, 10, 1024, 8192, 75\n', '');
    }
  };
  const client = new NvidiaQueryClient({ execFileImpl });
  const result = await client.query();

  assert.equal(result[0].name, 'NVIDIA RTX');
  assert.equal(result[0].fanPercent, undefined);
  assert.equal(calls.length, 3);
  await client.query();
  assert.equal(calls.length, 4);
  assert.ok(!calls[3][0].includes('fan.speed'));
});
