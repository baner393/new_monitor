import assert from 'node:assert/strict';
import test from 'node:test';
import { MonitorConfigDraft } from '../src/shared/monitor-config-draft.js';
import { createDefaultMonitorPanelConfig } from '../src/shared/monitor-panel-config.js';

test('draft cancel restores the complete configuration snapshot', () => {
  const original = createDefaultMonitorPanelConfig();
  const session = new MonitorConfigDraft(original);
  const changed = structuredClone(original);
  changed.layout.enabled.cpu = false;
  changed.motion.enabled = false;
  changed.sensors.temperatureOverrides.cpu0 = [30, 50, 70, 85];
  session.update(changed);
  assert.equal(session.dirty, true);
  assert.deepEqual(session.cancel(), original);
});

test('draft commit keeps live preview changes and clears the dirty marker', () => {
  const original = createDefaultMonitorPanelConfig();
  const session = new MonitorConfigDraft(original);
  const changed = structuredClone(original);
  changed.layout.order = ['memory', 'cpu', ...original.layout.order.slice(2)];
  changed.preset = 'custom';
  const preview = session.update(changed);
  assert.equal(preview.layout.order[0], 'memory');
  const committed = session.commit();
  assert.equal(committed.preset, 'custom');
  assert.equal(session.dirty, false);
  assert.deepEqual(session.cancel(), committed);
});
