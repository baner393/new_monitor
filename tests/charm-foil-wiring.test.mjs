import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyFlip, createFlipState, FLIP_DEFAULTS } from '../src/renderer/charm-flip.js';

const main = fs.readFileSync(new URL('../src/renderer/main.js', import.meta.url), 'utf8');
const frameDriver = main.slice(main.indexOf('function updateFoilFx(dt) {'), main.indexOf('// Body sprite (main texture)'));

function sprite(texture = {}) {
  return {
    texture, visible: true, alpha: 1, tint: 0xffffff,
    scale: { x: 2, y: 2 }, position: { x: 0, y: 0 },
  };
}

test('actual foil frame driver keeps the metal back independent of front animation frames', () => {
  const metal = { name: 'metal-back' };
  const body = sprite({ name: 'idle-front' });
  const back = sprite(metal);
  const state = { ...createFlipState(), spinY: Math.PI };
  const deps = {
    foilFx: { maskSprite: sprite(), backMaskSprite: sprite(), backTexture: metal, size: 96, frameW: 32, slices: [] },
    bodySprite: body, backSprite: back, backSheenSprite: sprite(),
    foilEdgeSprite: sprite(), foilFoilSprite: sprite(), foilBandSprite: sprite(),
    backFoilSprite: sprite(), backBandSprite: sprite(),
    physics: { turtle: { vx: 0, vy: 0 }, pendulumOmega: 0, ropeLength: 80 },
    flipState: state, flipConfig: { ...FLIP_DEFAULTS }, charmAccel: { x: 0, y: 0 },
    charmHoloEnabled: true, currentSkinBaseSize: 32, turtleContainer: {},
    isCharmMode: () => true,
    updateFlip: () => ({}), applyFlip,
  };
  const drive = new Function('deps', `
    const { ${Object.keys(deps).join(', ')} } = deps;
    let prevTurtleVx = 0, prevTurtleVy = 0, prevMotion = 0;
    ${frameDriver}
    return updateFoilFx;
  `)(deps);
  for (const face of ['idle-front', 'blink-front', 'pain-front', 'happy-front']) {
    body.texture = { name: face };
    drive(1 / 60);
    assert.equal(back.texture, metal, `${face} must not appear on the metal back`);
    assert.equal(body.visible, false, 'front stays hidden at the back-facing angle');
    assert.equal(back.visible, true);
  }
  deps.flipConfig.backMaterial = 'pattern';
  drive(1 / 60);
  assert.equal(back.texture, body.texture, 'pattern mode follows the current expression');
  assert.equal(deps.foilFx.backMaskSprite.texture, body.texture, 'pattern reflection uses its own matching mask');
  assert.equal(back.scale.x, body.scale.y, 'pattern mode keeps the normal viewing direction');
  assert.equal(back.scale.y, body.scale.y, 'pattern mode keeps the full image height');
  assert.equal(back.tint, 0xffffff, 'metal shading must not darken the pattern');
  deps.flipConfig.backMaterial = 'metal';
  drive(1 / 60);
  assert.equal(back.texture, metal, 'switching back restores the original metal asset');
});
