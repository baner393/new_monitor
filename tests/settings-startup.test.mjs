import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { knobsToFlipConfig } from '../src/renderer/charm-flip.js';

const main = fs.readFileSync(new URL('../src/renderer/main.js', import.meta.url), 'utf8');
const modeSetter = main.slice(main.indexOf('function setAnchorMode('), main.indexOf('// ── Ring menu 交互'));
const settingsApplier = main.slice(main.indexOf('function applySettings('), main.indexOf('// Click-outside detection for settings panel'));

test('startup restores the saved charm rope length without writing the default over it', () => {
  const stored = { anchorMode: 'cursor', ropeLength: 125, charmFlipEnergy: 80, charmHoloEnabled: false };
  const before = { ...stored };
  let saves = 0;
  const physics = {
    turtle: {}, enterCharmMode() {}, exitCharmMode() {},
    ropeLength: 150, restRopeLength: 150,
  };
  const state = { mode: 'top', ropeLengths: { top: 150, cursor: 80 } };
  const deps = {
    physics, charmState: state, ANCHOR_MODES: { TOP: 'top', CURSOR: 'cursor' },
    charmAnchorSampler: { sample: () => ({ x: 100, y: 100 }) },
    lastCursorPosition: null, sprite: { x: 100, y: 200 },
    onboardingGuide: { onAnchorModeChanged() {} },
    window: { electronAPI: { settings: {
      set(key, value) { stored[key] = value; }, save() { saves += 1; },
    } } },
    petBehaviorSettings: {}, codexCompanion: { setReadingStability() {} },
    knobsToFlipConfig, foilFoilSprite: {}, foilBandSprite: {}, backFoilSprite: {}, backBandSprite: {},
    ROPE_ELASTICITY_STEPS: [], currentSkinBaseSize: 24,
    syncLayerScales() {}, foilLayers: () => ({}), console: { log() {} },
  };
  const apply = new Function('deps', `
    const { ${Object.keys(deps).join(', ')} } = deps;
    let flipConfig = {}, charmHoloEnabled = true;
    ${modeSetter}
    ${settingsApplier}
    return applySettings;
  `)(deps);
  apply({ ...stored }, { isInitialLoad: true });
  assert.deepEqual(stored, before, 'reading settings must not overwrite the saved values');
  assert.equal(physics.restRopeLength, 125);
  assert.equal(state.ropeLengths.cursor, 125);
  assert.equal(saves, 0, 'startup restore is read-only');
});
