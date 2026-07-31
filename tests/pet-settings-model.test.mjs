import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PET_SETTINGS_DEFAULTS,
  PetSettingsDraft,
  applyPetSettingsPreset,
  applyQuickTuning,
  deriveQuickTunings,
  detectPetSettingsPreset,
  normalizePetSettings,
  resolveAmbientSwingEnabled,
  scalePreviewRopeLength,
} from '../src/shared/pet-settings-model.js';

test('legacy rope elasticity values migrate to the nearest current step', () => {
  assert.equal(normalizePetSettings({ ropeElasticity: 0.02 }).ropeElasticity, 5);
  assert.equal(normalizePetSettings({ ropeElasticity: 1 }).ropeElasticity, 1);
});

test('quick tuning changes only its intended physical group', () => {
  const weight = applyQuickTuning(PET_SETTINGS_DEFAULTS, 'weight', 100);
  assert.equal(weight.gravity, 1550);
  assert.equal(weight.damping, 0.94);
  assert.equal(weight.ropeStiffness, PET_SETTINGS_DEFAULTS.ropeStiffness);

  const tension = applyQuickTuning(PET_SETTINGS_DEFAULTS, 'tension', 0);
  assert.equal(tension.ropeElasticity, 1);
  assert.equal(tension.ropeStiffness, 150);
  assert.equal(tension.gravity, PET_SETTINGS_DEFAULTS.gravity);
});

test('derived quick controls follow settings changes without persistence fields', () => {
  const lively = applyPetSettingsPreset(PET_SETTINGS_DEFAULTS, 'lively');
  const controls = deriveQuickTunings(lively);
  assert.ok(controls.bounce > 85);
  assert.ok(controls.weight < 35);
  assert.equal(Object.hasOwn(lively, 'weight'), false);
});

test('preset detection becomes custom after a precise adjustment', () => {
  const steady = applyPetSettingsPreset(PET_SETTINGS_DEFAULTS, 'steady');
  assert.equal(detectPetSettingsPreset(steady), 'steady');
  assert.equal(detectPetSettingsPreset({ ...steady, gravity: 1250 }), 'custom');
});

test('draft cancel and commit preserve the original settings contract', () => {
  const draft = new PetSettingsDraft(PET_SETTINGS_DEFAULTS);
  draft.update({ ...PET_SETTINGS_DEFAULTS, turtleSize: 96 });
  assert.equal(draft.dirty, true);
  assert.deepEqual(draft.cancel(), PET_SETTINGS_DEFAULTS);
  draft.update({ ...PET_SETTINGS_DEFAULTS, panelMoveStable: false });
  draft.commit();
  assert.equal(draft.dirty, false);
  assert.equal(draft.cancel().panelMoveStable, false);
});

test('preview rope length uses the full visual range and changes monotonically', () => {
  const short = scalePreviewRopeLength(30, 330);
  const medium = scalePreviewRopeLength(150, 330);
  const long = scalePreviewRopeLength(400, 330);
  assert.equal(short, 58);
  assert.ok(medium > short);
  assert.equal(long, 230);
});

test('ambient swing is user-controlled and temporarily suppressed for every stable follow panel', () => {
  assert.equal(resolveAmbientSwingEnabled(PET_SETTINGS_DEFAULTS, false), true);
  assert.equal(resolveAmbientSwingEnabled(PET_SETTINGS_DEFAULTS, true), false);
  assert.equal(resolveAmbientSwingEnabled({ ambientSwingEnabled: false, panelMoveStable: false }, false), false);
  assert.equal(resolveAmbientSwingEnabled({ ambientSwingEnabled: true, panelMoveStable: false }, true), true);
  assert.equal(normalizePetSettings({ ambientSwingEnabled: false }).ambientSwingEnabled, false);
});
