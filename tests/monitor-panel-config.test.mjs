import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMonitorPreset,
  CARD_IDS,
  createDefaultMonitorPanelConfig,
  migrateLegacyMonitorVisibility,
  normalizeMonitorPanelConfig,
  toLegacyMonitorVisibility,
} from '../src/shared/monitor-panel-config.js';

test('new monitor configurations start with the performance preset', () => {
  const config = createDefaultMonitorPanelConfig();
  assert.equal(config.version, 2);
  assert.equal(config.preset, 'performance');
  assert.equal(config.layout.enabled.power, false);
  assert.equal(config.layout.enabled.cooling, true);
  assert.deepEqual(config.layout.order, CARD_IDS);
});

test('all four layout presets expose the intended cards', () => {
  const expected = {
    minimal: ['cpu', 'memory', 'storage', 'network'],
    performance: ['cpu', 'memory', 'gpu', 'storage', 'network', 'cooling'],
    hardware: ['cpu', 'gpu', 'storage', 'cooling', 'power', 'battery'],
    full: CARD_IDS,
  };
  for (const [preset, cards] of Object.entries(expected)) {
    const config = applyMonitorPreset(createDefaultMonitorPanelConfig(), preset);
    assert.deepEqual(CARD_IDS.filter((id) => config.layout.enabled[id]).sort(), [...cards].sort());
    assert.equal(config.preset, preset);
  }
});

test('legacy visibility migrates to cards and sensor detail categories', () => {
  const config = migrateLegacyMonitorVisibility({
    cpu: true, memory: false, gpu: true, disk: false, network: true,
    fan: false, power: false, voltage: true, temperature: false, battery: true,
  });
  assert.equal(config.layout.enabled.memory, false);
  assert.equal(config.layout.enabled.storage, false);
  assert.equal(config.layout.enabled.cooling, false);
  assert.equal(config.layout.enabled.power, true);
  assert.equal(config.sensors.visible.temperature, false);
  assert.equal(toLegacyMonitorVisibility(config).voltage, true);
});

test('configuration normalization repairs order and temperature thresholds', () => {
  const config = normalizeMonitorPanelConfig({
    version: 2,
    layout: { order: ['gpu', 'gpu', 'bad'], enabled: { cpu: false } },
    sensors: { temperatureOverrides: { '/cpu/0': [90, 20, 20, 10] } },
  });
  assert.deepEqual(config.layout.order.slice(0, 2), ['gpu', 'cpu']);
  assert.equal(new Set(config.layout.order).size, CARD_IDS.length);
  assert.deepEqual(config.sensors.temperatureOverrides['/cpu/0'], [90, 91, 92, 93]);
  assert.equal(config.layout.enabled.memory, true);
});

test('temperature normalization stays inside the supported range', () => {
  const config = normalizeMonitorPanelConfig({
    sensors: { temperatureOverrides: { hot: [150, 150, 150, 150] } },
  });
  assert.deepEqual(config.sensors.temperatureOverrides.hot, [147, 148, 149, 150]);
});

test('presets remain editable and can become custom', () => {
  const config = applyMonitorPreset(createDefaultMonitorPanelConfig(), 'minimal');
  assert.equal(config.preset, 'minimal');
  assert.equal(config.layout.enabled.gpu, false);
  config.layout.enabled.gpu = true;
  const normalized = normalizeMonitorPanelConfig({ ...config, preset: 'custom' });
  assert.equal(normalized.preset, 'custom');

  const performance = createDefaultMonitorPanelConfig();
  const manuallyMatched = normalizeMonitorPanelConfig({ ...performance, preset: 'custom' });
  assert.equal(manuallyMatched.preset, 'custom');
});
