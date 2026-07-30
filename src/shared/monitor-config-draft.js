import {
  cloneMonitorPanelConfig,
  normalizeMonitorPanelConfig,
} from './monitor-panel-config.js';

function sameConfiguration(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class MonitorConfigDraft {
  constructor(configuration) {
    this.snapshot = cloneMonitorPanelConfig(normalizeMonitorPanelConfig(configuration));
    this.draft = cloneMonitorPanelConfig(this.snapshot);
    this.dirty = false;
  }

  update(configuration) {
    this.draft = normalizeMonitorPanelConfig(configuration);
    this.dirty = !sameConfiguration(this.draft, this.snapshot);
    return cloneMonitorPanelConfig(this.draft);
  }

  commit() {
    this.snapshot = cloneMonitorPanelConfig(this.draft);
    this.dirty = false;
    return cloneMonitorPanelConfig(this.snapshot);
  }

  cancel() {
    this.draft = cloneMonitorPanelConfig(this.snapshot);
    this.dirty = false;
    return cloneMonitorPanelConfig(this.snapshot);
  }
}
