import test from 'node:test';
import assert from 'node:assert/strict';

import { RingMenu } from '../src/renderer/ring-menu.js';

function makeGraphics() {
  return {
    clears: 0,
    commands: [],
    clear() { this.clears += 1; this.commands = []; return this; },
    lineStyle(...args) { this.commands.push(['lineStyle', ...args]); return this; },
    arc(...args) { this.commands.push(['arc', ...args]); return this; },
    moveTo() { return this; },
    lineTo() { return this; },
    beginFill(...args) { this.commands.push(['beginFill', ...args]); return this; },
    beginHole() { this.commands.push(['beginHole']); return this; },
    endHole() { this.commands.push(['endHole']); return this; },
    endFill() { return this; },
    drawCircle(...args) { this.commands.push(['drawCircle', ...args]); return this; },
    drawRoundedRect(...args) { this.commands.push(['drawRoundedRect', ...args]); return this; },
    closePath() { return this; },
  };
}

function makeMenuForDrawing() {
  const menu = Object.create(RingMenu.prototype);
  menu._getRadius = () => 150;
  menu.backgroundContainer = { alpha: 0, visible: false, scale: { value: 0, set(value) { this.value = value; } } };
  menu.container = { alpha: 0, visible: false, scale: { value: 0, set(value) { this.value = value; } } };
  menu.labelContainer = { visible: false };
  menu._band = makeGraphics();
  menu._selectionArc = { ...makeGraphics(), rotation: 0, alpha: 0 };
  menu._bandDisplay = menu._band;
  menu._selectionArcDisplay = menu._selectionArc;
  menu._renderer = null;
  menu._discTextures = null;
  menu._itemSprites = Array.from({ length: 9 }, () => ({
    holder: { alpha: 0, position: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } }, scale: { set() {} } },
    disc: makeGraphics(),
    icon: { tint: 0 },
    hot: false,
  }));
  menu._holding = false;
  menu._ringT = 1;
  menu._center = null;
  menu._hoverIdx = -1;
  menu._fireIdx = -1;
  menu._fireT = 0;
  menu._arcVisible = false;
  menu._arcAngle = 0;
  menu._reducedMotion = false;
  menu._geometryRadius = null;
  return menu;
}

test('band and arc geometry are cached across frames and hover changes', () => {
  const menu = makeMenuForDrawing();

  menu._draw(null);
  const initialClears = {
    band: menu._band.clears,
    arc: menu._selectionArc.clears,
    discs: menu._itemSprites.map((node) => node.disc.clears),
  };
  menu._draw(null);

  assert.deepEqual({
    band: menu._band.clears,
    arc: menu._selectionArc.clears,
    discs: menu._itemSprites.map((node) => node.disc.clears),
  }, initialClears, 'an unchanged frame performs no Graphics.clear calls');

  menu._hoverIdx = 0;
  menu._draw(null);
  assert.equal(menu._band.clears, initialClears.band);
  assert.equal(menu._selectionArc.clears, initialClears.arc);
  assert.equal(menu._itemSprites[0].disc.clears, initialClears.discs[0] + 1);
  assert.equal(menu._itemSprites[1].disc.clears, initialClears.discs[1]);
  assert.equal(menu._selectionArc.alpha, 1);

  menu._hoverIdx = 1;
  menu._draw(null, 1 / 60);
  assert.equal(menu._selectionArc.clears, initialClears.arc);
  assert.ok(menu._selectionArc.rotation > 0 && menu._selectionArc.rotation < Math.PI * 2 / 9);
});

test('background and foreground share open and close animation state', () => {
  const menu = makeMenuForDrawing();
  menu._ringT = 0.4;
  menu._draw(null);
  assert.equal(menu.backgroundContainer.visible, menu.container.visible);
  assert.equal(menu.backgroundContainer.alpha, menu.container.alpha);
  assert.equal(menu.backgroundContainer.scale.value, menu.container.scale.value);
  menu.update(0.2, null);
  assert.equal(menu.backgroundContainer.visible, false);
  assert.equal(menu.container.visible, false);
});

test('scheme A renders the full disc, separate inner guide and outer hairline', () => {
  const menu = makeMenuForDrawing();
  menu._draw(null);
  const band = menu._band.commands;
  const circles = band.filter(([name]) => name === 'drawCircle').map(([, x, y, radius]) => radius);
  assert.deepEqual(circles, [151, 151, 119, 177]);
  assert.equal(band.some(([name]) => name === 'beginHole'), false, 'the disc stays complete below the pet');
  assert.ok(circles[2] < 150 - 25, 'inner hairline sits inside the 50px band');
  assert.ok(circles[3] > 150 + 25, 'outer hairline sits outside the band');
  assert.deepEqual(band.filter(([name]) => name === 'beginFill'), [['beginFill', 0x10212c, 0.76]]);
  assert.deepEqual(band.filter(([name]) => name === 'lineStyle').map(([, width]) => width), [1, 50, 1, 1]);
  assert.deepEqual(band.find(([name]) => name === 'lineStyle'), ['lineStyle', 1, 0x46657a, 0.45]);
  const arcLines = menu._selectionArc.commands.filter(([name]) => name === 'lineStyle');
  assert.deepEqual(arcLines.map(([, style]) => style.width), [15, 9, 5, 4]);
  for (const [, , , radius, start, end] of menu._selectionArc.commands.filter(([name]) => name === 'arc')) {
    assert.equal(start, -Math.PI / 2, 'selection begins at the node direction');
    assert.ok(Math.abs((end - start) * radius - 51) < 1e-10, 'selection length matches the 51px prototype');
  }
});

test('node materials preserve opaque surfaces, soft shadows and selected halo without extra shine', () => {
  const menu = makeMenuForDrawing();
  menu._hoverIdx = 0;
  menu._draw(null);
  const hot = menu._itemSprites[0].disc.commands;
  assert.ok(hot.some(([name, color, alpha]) => name === 'beginFill' && color === 0x28596d && alpha === 1));
  assert.equal(hot.some(([name]) => name === 'arc'), false, 'the prototype has no top-edge highlight');
  assert.equal(hot.filter(([name, color]) => name === 'beginFill' && color === 0x5cc9f6).length, 1,
    'selected state has one restrained halo');
  assert.ok(hot.filter(([name, color]) => name === 'beginFill' && color === 0x000000).length > 1,
    'Graphics fallback approximates the soft shadow with layers');
  assert.ok(menu._itemSprites.every((node) => node.holder.alpha === 1),
    'selecting a node does not dim the other buttons');
  menu._hoverIdx = 1;
  menu._draw(null);
  const cold = menu._itemSprites[0].disc.commands;
  assert.ok(cold.some(([name, color, alpha]) => name === 'beginFill' && color === 0x172e3b && alpha === 1));
  assert.equal(cold.some(([name]) => name === 'arc'), false);
  assert.deepEqual(cold.find(([name]) => name === 'lineStyle'), ['lineStyle', 1, 0x8eb9ca, 0x6b / 255]);
});

test('ring geometry is rasterized once per radius at 3x with linear sampling', () => {
  const menu = makeMenuForDrawing();
  const options = [];
  let destroyed = 0;
  menu._renderer = {
    generateTexture(_source, config) {
      options.push(config);
      return { destroy() { destroyed += 1; } };
    },
  };
  menu._bandDisplay = { texture: null };
  menu._selectionArcDisplay = { texture: null, rotation: 0, alpha: 0 };

  menu._draw(null);
  assert.equal(options.length, 2);
  assert.ok(options.every((config) => config.resolution === 3));
  assert.ok(options.every((config) => config.scaleMode === 1));
  menu._draw(null);
  assert.equal(options.length, 2, 'unchanged frames do not generate textures');

  menu._getRadius = () => 180;
  menu._draw(null);
  assert.equal(options.length, 4, 'radius changes replace both cached textures');
  assert.equal(destroyed, 2, 'superseded GPU textures are released');

  menu._getRadius = () => 400;
  menu._draw(null);
  assert.equal(options.length, 6);
  for (const config of options.slice(4)) {
    assert.ok(config.resolution < 3);
    assert.ok(Math.max(config.region.width, config.region.height) * config.resolution <= 1536);
  }
  assert.equal(destroyed, 4);
});

test('hover swaps prebuilt node textures without redrawing circles', () => {
  const menu = makeMenuForDrawing();
  const cold = { name: 'cold' };
  const hot = { name: 'hot' };
  menu._discTextures = [cold, hot];
  menu._itemSprites.forEach((node) => { node.disc.texture = cold; });
  menu._draw(null);
  const clears = menu._itemSprites.map((node) => node.disc.clears);
  menu._hoverIdx = 4;
  menu._draw(null);
  assert.equal(menu._itemSprites[4].disc.texture, hot);
  assert.equal(menu._itemSprites[3].disc.texture, cold);
  assert.deepEqual(menu._itemSprites.map((node) => node.disc.clears), clears);
  menu._hoverIdx = 5;
  menu._draw(null);
  assert.equal(menu._itemSprites[4].disc.texture, cold);
  assert.equal(menu._itemSprites[5].disc.texture, hot);
});

test('label stays below the center even when physical rope is short', () => {
  const menu = makeMenuForDrawing();
  menu._center = { x: 200, y: 200 };
  menu._holding = true;
  menu._hoverIdx = 0;
  menu._labelText = { text: '', width: 40, height: 15 };
  menu._labelBg = makeGraphics();
  menu._labelBgDisplay = menu._labelBg;
  menu._labelTextValue = null;
  menu.labelContainer = {
    visible: false,
    position: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } },
  };
  menu._draw({ x: 310, y: 400 });
  assert.deepEqual({ x: menu.labelContainer.position.x, y: menu.labelContainer.position.y }, { x: 200, y: 296 });
  assert.deepEqual(menu._labelBg.commands.find(([name]) => name === 'drawRoundedRect'),
    ['drawRoundedRect', -37, -16.5, 74, 33, 16.5]);
  const labelClears = menu._labelBg.clears;
  menu._getRadius = () => 80;
  menu._draw({ x: 310, y: 400 });
  assert.deepEqual({ x: menu.labelContainer.position.x, y: menu.labelContainer.position.y }, { x: 200, y: 296 });
  assert.equal(menu._itemSprites[0].target.y, -151, 'visual ring remains full size');
  assert.equal(menu._labelBg.clears, labelClears, 'unchanged label does not rebuild its background');
  menu._getPetClearance = () => 220;
  menu._draw({ x: 310, y: 400 });
  assert.equal(menu._itemSprites[0].target.y, -220, 'large pets expand the visual ring');
  assert.ok(menu.labelContainer.position.y - 16.5 >= 200 + 220 - 36 + 8,
    'label clears the bottom of a large pet');
  for (const node of menu._itemSprites) {
    const dx = Math.max(0, Math.abs(node.target.x) - 37);
    const dy = Math.max(0, Math.abs(node.target.y - (menu.labelContainer.position.y - 200)) - 16.5);
    assert.ok(Math.hypot(dx, dy) >= 32, 'label also clears the bottom buttons');
  }
});

test('opening staggers nodes and reduced motion settles them immediately', () => {
  const menu = makeMenuForDrawing();
  menu._ringT = 0.3;
  menu._draw(null);
  assert.ok(menu._itemSprites[0].holder.alpha > menu._itemSprites[8].holder.alpha);
  assert.equal(menu._itemSprites[8].holder.position.x, menu._itemSprites[8].target.x,
    'nodes scale in place on the track');
  menu.setReducedMotion(true);
  menu._draw(null);
  assert.equal(menu._itemSprites[8].holder.alpha, 1);
});

test('hit feedback briefly enlarges its node without rebuilding band geometry', () => {
  const menu = makeMenuForDrawing();
  let scale = 0;
  menu._itemSprites[2].holder.scale.set = (value) => { scale = value; };
  menu._draw(null);
  const bandClears = menu._band.clears;
  menu._fireIdx = 2;
  menu._fireT = 1;
  menu._draw(null, 1 / 60);
  assert.ok(scale > 1);
  assert.equal(menu._band.clears, bandClears);
  assert.equal(menu._selectionArc.alpha, 1);
});

test('rope anchor remains at the last angle during closing', () => {
  const menu = makeMenuForDrawing();
  menu._center = { x: 200, y: 200 };
  menu._anchorAngle = Math.PI / 2;
  assert.deepEqual(menu.ropeAnchor, { x: 350, y: 200 });
  menu._ringT = 0;
  assert.equal(menu.ropeAnchor, null);
});

test('opening near a viewport edge clamps center far enough to keep every node visible', () => {
  const menu = Object.create(RingMenu.prototype);
  const position = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } };
  menu._getRadius = () => 150;
  menu._getViewport = () => ({ width: 800, height: 600 });
  menu._holding = false;
  menu._gate = { reset() {} };
  menu._speed = { reset() {} };
  const backgroundPosition = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } };
  menu.backgroundContainer = { visible: false, position: backgroundPosition };
  menu.container = { visible: false, position };

  menu.open({ x: 2, y: 3 }, null);

  assert.deepEqual(menu.ringCenter, { x: 179, y: 179 });
  assert.deepEqual({ x: position.x, y: position.y }, menu.ringCenter);
  assert.deepEqual({ x: backgroundPosition.x, y: backgroundPosition.y }, menu.ringCenter);
  assert.equal(menu.backgroundContainer.visible, true);
});

test('short rope keeps its physical attachment radius while the visible ring uses 151px', () => {
  const menu = makeMenuForDrawing();
  menu._getRadius = () => 80;
  menu._center = { x: 200, y: 200 };
  menu._anchorAngle = Math.PI / 2;
  menu._draw(null);
  assert.equal(menu._itemSprites[0].target.y, -151);
  assert.deepEqual(menu.ropeAnchor, { x: 280, y: 200 });
});

test('opening near the bottom reserves room for the label displaced by a large pet', () => {
  const menu = makeMenuForDrawing();
  menu._getPetClearance = () => 220;
  menu._getViewport = () => ({ width: 1200, height: 1000 });
  menu._gate = { reset() {} };
  menu._speed = { reset() {} };
  menu.backgroundContainer.position = { set() {} };
  menu.container.position = { set() {} };
  menu._labelText = { text: '', width: 90, height: 15 };
  menu._labelBg = makeGraphics();
  menu._labelBgDisplay = menu._labelBg;
  menu.labelContainer.position = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } };
  menu.open({ x: 600, y: 998 }, null);
  menu._hoverIdx = 0;
  menu._draw({ x: 600, y: 300 });
  assert.ok(menu.labelContainer.position.y + 16.5 + 52 <= 1000,
    'the displaced label and its shadow stay inside a viewport that can fit the ring');
});
