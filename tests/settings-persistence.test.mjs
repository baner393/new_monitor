import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { SettingsPanel } from '../src/renderer/settings.js';
import { PET_SETTINGS_DEFAULTS, PetSettingsDraft, normalizePetSettings } from '../src/shared/pet-settings-model.js';
import * as monitorModel from '../src/shared/monitor-panel-config.js';

const mainSource = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8');
function startMain(directory, failWrite = false) {
  const handlers = new Map();
  const context = vm.createContext({
    fs: { ...fs, writeFileSync: (...args) => {
      if (failWrite) throw new Error('disk full');
      return fs.writeFileSync(...args);
    } }, path, console: { log() {}, warn() {}, error() {} },
    app: { getPath: () => directory }, mainWindow: null,
    ...monitorModel, normalizePetSettings,
    DEFAULT_CODEX_INTEGRATION_CONFIG: {}, DEFAULT_CLAUDE_INTEGRATION_CONFIG: {},
    normalizeCodexIntegrationConfig: (value) => value || {},
    normalizeClaudeIntegrationConfig: (value) => value || {},
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on: (name, handler) => handlers.set(name, handler) },
  });
  vm.runInContext(mainSource.slice(mainSource.indexOf('const SETTINGS_PATH'), mainSource.indexOf("ipcMain.handle('monitor-settings-get'")), context);
  vm.runInContext(mainSource.slice(mainSource.indexOf("ipcMain.on('settings-set'"), mainSource.indexOf('// IPC: skin.set')), context);
  return {
    get: async () => handlers.get('settings-get')(),
    set: (key, value) => handlers.get('settings-set')({}, key, value),
    save: () => handlers.get('settings-save')(),
    apply: async (values) => handlers.get('settings-apply')({}, values),
  };
}
function makePanel(values) {
  const panel = Object.create(SettingsPanel.prototype);
  Object.assign(panel, {
    _values: normalizePetSettings(values), _draft: new PetSettingsDraft(values),
    status: { dataset: {} }, saveButton: {}, workspace: { scrollTop: 0 },
    nav: {}, root: { classList: { add() {} }, setAttribute() {} }, panel: { focus() {} },
    _renderSection() {}, _syncUi() {}, _syncPreviewSettings() {}, close() { this.closed = true; },
  });
  return panel;
}
test('save, reopen settings and restart retain changes without overwriting external settings', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-settings-'));
  const previousWindow = globalThis.window;
  const previousRaf = globalThis.requestAnimationFrame;
  try {
    const settings = startMain(directory);
    globalThis.window = { electronAPI: { settings } };
    globalThis.requestAnimationFrame = () => {};
    const panel = makePanel(PET_SETTINGS_DEFAULTS);
    panel._values = panel._draft.update({ ...panel._values, charmFlipSpin: 75 });
    await panel._save();
    settings.set('ropeLength', 125);
    settings.save();
    await panel.open();
    assert.equal(panel._values.ropeLength, 125, 'reopening must read current persisted values');
    panel._values = panel._draft.update({ ...panel._values, charmFlipEnabled: false, charmBackMaterial: 'pattern' });
    settings.set('ropeLength', 135);
    settings.save();
    await panel._save();
    const restarted = await startMain(directory).get();
    assert.equal(restarted.ropeLength, 135, 'applying one field must preserve external changes');
    assert.equal(restarted.charmFlipSpin, 75);
    assert.equal(restarted.charmFlipEnabled, false);
    assert.equal(restarted.charmBackMaterial, 'pattern');
  } finally {
    globalThis.window = previousWindow;
    globalThis.requestAnimationFrame = previousRaf;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test('failed persistence keeps the draft dirty and settings panel open', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-settings-'));
  const previousWindow = globalThis.window;
  try {
    const settings = startMain(directory, true);
    globalThis.window = { electronAPI: { settings } };
    const panel = makePanel(PET_SETTINGS_DEFAULTS);
    panel._values = panel._draft.update({ ...panel._values, charmFlipEnabled: false });
    await panel._save();
    assert.equal(panel._draft.dirty, true);
    assert.equal(panel.closed, undefined);
    assert.equal(panel.status.dataset.dirty, 'error');
    assert.equal((await settings.get()).charmFlipEnabled, true);
  } finally {
    globalThis.window = previousWindow;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test('a delayed settings read cannot clear an edited draft', async () => {
  const previousWindow = globalThis.window;
  try {
    let resolveRead;
    globalThis.window = { electronAPI: { settings: { get: () => new Promise((resolve) => { resolveRead = resolve; }) } } };
    const panel = makePanel(PET_SETTINGS_DEFAULTS);
    const load = panel._loadSettings();
    panel._values = panel._draft.update({ ...panel._values, charmFlipSpin: 75 });
    resolveRead(PET_SETTINGS_DEFAULTS);
    await load;
    assert.equal(panel._values.charmFlipSpin, 75);
    assert.equal(panel._draft.dirty, true);
  } finally { globalThis.window = previousWindow; }
});
