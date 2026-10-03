import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFoilAssets, buildSlabTexture, buildSlabGeometry } from '../src/renderer/charm-foil.js';
import { applyFlip, createFlipState } from '../src/renderer/charm-flip.js';
import { updateMetalUniforms } from '../src/renderer/charm-metal.js';

test('金属反射只随姿态变化，同角度多圈、速度和能量不改变反射', () => {
  const uniforms = { uMetalYaw: new Float32Array(2), uMetalRotation: new Float32Array(2), uMetalDepth: 0 };
  const state = { ...createFlipState(), spinY: 1.2, tilt: 0.3, spinZ: 0.2 };
  updateMetalUniforms(uniforms, state, 0.4);
  const snapshot = JSON.stringify(uniforms);
  updateMetalUniforms(uniforms, { ...state, spinY: state.spinY + Math.PI * 20, energy: 1, velY: 99, t: 1000 }, 0.4);
  assert.equal(JSON.stringify(uniforms), snapshot);
  for (const key of ['spinY', 'tilt', 'spinZ']) {
    updateMetalUniforms(uniforms, { ...state, [key]: state[key] + 0.2 }, 0.4);
    assert.notEqual(JSON.stringify(uniforms), snapshot, `${key} 要改变环境反射方向`);
  }
  const layer = { scale: {}, position: {}, metalUniforms: uniforms };
  applyFlip({ slices: [layer] }, state, { baseScale: 1, edgeBase: 1 / 3, thickness: 6, span: 96 });
  assert.equal(layer.tint, 0xffffff, '正式 shader 的反射不可再乘固定灰色 tint');
  assert.equal(uniforms.uMetalDepth, 0.5);
});

test('侧壁轮廓法线取相邻行坡度，断开行段不互相影响', () => {
  const width = 30, height = 9;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / 3);
    for (const [left, right] of [[3 + row * 3, 18 - row * 3], [24, 27]]) {
      for (let x = left; x < right; x++) pixels[(y * width + x) * 4 + 3] = 255;
    }
  }
  const geometry = buildSlabGeometry({ width, height, getContext: () => ({ getImageData: () => ({ data: pixels }) }) });
  assert.equal(geometry.slopes.length, geometry.vertices.length);
  for (let i = 0; i < geometry.slopes.length; i += 16) {
    assert.equal(geometry.slopes[i], 1);
    assert.equal(geometry.slopes[i + 1], -1);
    assert.equal(geometry.slopes[i + 8], 0);
    assert.equal(geometry.slopes[i + 9], 0);
  }
});

test('金属背板只保留皮肤轮廓，与正面图案颜色独立，并带局部反光', () => {
  const previous = globalThis.document;
  globalThis.document = {
    createElement() {
      const canvas = { width: 0, height: 0, pixels: null };
      canvas.getContext = () => ({
        drawImage(frame) {
          canvas.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const i = (y * canvas.width + x) * 4;
              canvas.pixels.set([...frame.color, x < 3 ? 0 : 255], i);
            }
          }
        },
        getImageData() { return { data: canvas.pixels }; },
        createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
        putImageData(image) { canvas.pixels = image.data; },
        createLinearGradient() { return { addColorStop() {} }; },
        fillRect() {},
      });
      return canvas;
    },
  };
  try {
    const first = buildFoilAssets({ width: 8, height: 6, color: [255, 25, 0] });
    const second = buildFoilAssets({ width: 8, height: 6, color: [255, 255, 255] });
    const slab = buildSlabTexture({ width: 8, height: 6, color: [255, 25, 0] });
    for (let i = 0; i < slab.pixels.length; i += 4) {
      assert.equal(slab.pixels[i + 3], second.back.pixels[i + 3], '侧壁保持相同轮廓');
      if (slab.pixels[i + 3]) assert.ok(slab.pixels[i] >= 160, '金属侧壁底部也保留实心银色');
    }
    const foil = { scale: {}, position: {} };
    const state = { ...createFlipState(), spinY: Math.PI / 3, energy: 1, velY: 8 };
    applyFlip({ foil }, state, { baseScale: 1, edgeBase: 1 / 3, span: 24, thickness: 3 });
    let totalLight = 0, visiblePixels = 0;
    for (let di = 0; di < second.foil.pixels.length; di += 4) {
      if (second.back.pixels[di + 3] === 0) continue;
      const opacity = second.foil.pixels[di + 3] / 255 * foil.alpha;
      const light = (second.foil.pixels[di] + second.foil.pixels[di + 1] + second.foil.pixels[di + 2]) / (3 * 255);
      totalLight += 1 * (1 - opacity) + light * opacity;
      visiblePixels++;
    }
    assert.ok(totalLight / visiblePixels > 0.85, `实际纹理覆盖后原图不能整片暗化，当前亮度=${(totalLight / visiblePixels).toFixed(3)}`);
    assert.deepEqual(first.back.pixels, second.back.pixels, '不同正面颜色不能成为背板图案');
    assert.deepEqual(first.backSheen.pixels, second.backSheen.pixels);
    assert.notDeepEqual(first.foil.pixels, second.foil.pixels, '正面箔图案仍读取正面颜色');
    assert.equal(first.back.width, 24);
    assert.equal(first.back.height, 18, '非正方形皮肤保留原高宽比');
    const silver = new Set();
    const reflections = new Set();
    for (let y = 0; y < 18; y++) {
      for (let x = 0; x < 24; x++) {
        const di = (y * 24 + x) * 4;
        assert.equal(first.back.pixels[di + 3], x < 3 ? 0 : 255);
        if (x >= 3) silver.add(first.back.pixels[di]);
        reflections.add(first.backSheen.pixels[di + 3]);
      }
    }
    assert.ok(silver.size > 10, '背板有金属明暗渐变');
    assert.ok(reflections.size > 10, '反光带有局部亮度变化');
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
