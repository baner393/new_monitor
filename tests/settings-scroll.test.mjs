import assert from 'node:assert/strict';
import test from 'node:test';

import { SettingsPanel } from '../src/renderer/settings.js';

function makePanelHarness() {
  const workspace = {
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 400,
    querySelectorAll: () => [],
  };
  const panel = Object.create(SettingsPanel.prototype);
  panel._values = {};
  panel._originalValues = {};
  panel._section = 'quick';
  panel._open = false;
  panel._animating = false;
  panel._closeTimer = null;
  panel._reducedMotion = true;
  panel._onVisibilityChange = null;
  panel._draft = { dirty: false };
  panel.workspace = workspace;
  panel.nav = { querySelectorAll: () => [] };
  panel.status = { dataset: {} };
  panel.saveButton = {};
  panel.root = {
    hidden: true,
    classList: { add() {}, remove() {} },
    setAttribute() {},
  };
  panel.panel = { focus() {} };
  panel._renderSection = () => {};
  panel._syncUi = () => {};
  panel._syncPreviewSettings = () => {};
  return panel;
}

test('switching settings sections resets the previous workspace scroll offset', () => {
  const panel = makePanelHarness();
  panel.workspace.scrollTop = panel.workspace.scrollHeight - panel.workspace.clientHeight;
  panel._renderSection = () => {
    // A full DOM replacement can clamp/restore the previous offset during layout.
    panel.workspace.scrollTop = panel.workspace.scrollHeight;
  };

  panel._setSection('classic');

  assert.equal(panel.workspace.scrollTop, 0);
});

test('reopening settings starts the workspace at the top', async () => {
  const panel = makePanelHarness();
  panel.workspace.scrollTop = panel.workspace.scrollHeight - panel.workspace.clientHeight;
  panel._renderSection = () => {
    panel.workspace.scrollTop = panel.workspace.scrollHeight;
  };
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousWindow = globalThis.window;
  globalThis.requestAnimationFrame = () => {};
  globalThis.window = { electronAPI: { settings: { get: async () => null } } };

  try {
    await panel.open();
    assert.equal(panel.workspace.scrollTop, 0);
  } finally {
    if (previousRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('updating a setting rerenders controls without forcing the workspace to the top', () => {
  const panel = makePanelHarness();
  let renderCount = 0;
  panel.workspace.scrollTop = 300;
  panel._draft = {
    dirty: true,
    update: (values) => values,
  };
  panel._renderSection = () => {
    renderCount += 1;
    // Model the scroll offset being lost while the old controls are replaced.
    panel.workspace.scrollTop = 0;
  };

  panel._applyValues({ charmFlipEnabled: false });

  assert.equal(renderCount, 1);
  assert.equal(panel.workspace.scrollTop, 300);
});
