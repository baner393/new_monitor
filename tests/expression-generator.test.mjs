import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createGrid,
  generateExpressions,
  validateGenerationInput,
} = require('../src/custom/expression-generator.js');

function fixture(size = 24) {
  const grid = createGrid(size);
  for (let y = 3; y < size - 3; y++) {
    for (let x = 3; x < size - 3; x++) grid[y][x] = '#d7aa74';
  }
  const features = {
    leftEye: { region: { x: 6, y: 7, w: 4, h: 4 }, pixels: [{ x: 7, y: 8 }, { x: 8, y: 8 }] },
    rightEye: { region: { x: 14, y: 7, w: 4, h: 4 }, pixels: [{ x: 15, y: 8 }, { x: 16, y: 8 }] },
    mouth: { region: { x: 9, y: 13, w: 6, h: 4 }, pixels: [{ x: 10, y: 14 }, { x: 11, y: 15 }, { x: 12, y: 15 }, { x: 13, y: 14 }] },
  };
  grid[8][7] = '#20202a';
  grid[8][8] = '#4a6bb8';
  grid[8][15] = '#20202a';
  grid[8][16] = '#4a6bb8';
  for (const point of features.mouth.pixels) grid[point.y][point.x] = '#7a2838';
  return { grid, features, size };
}

test('expression generator validates all three marked facial features', () => {
  const data = fixture();
  assert.equal(validateGenerationInput(data.grid, data.size, data.features).valid, true);
  const missing = structuredClone(data.features);
  missing.mouth.pixels = [];
  const result = validateGenerationInput(data.grid, data.size, missing);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /嘴巴/);
});

test('expression generator creates six deterministic editable states', () => {
  const data = fixture();
  const first = generateExpressions(data.grid, data.size, data.features, { strength: 'standard' });
  const second = generateExpressions(data.grid, data.size, data.features, { strength: 'standard' });
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first.results), ['idle', 'hover', 'pull', 'happy', 'pain', 'blink']);
  for (const state of Object.values(first.results)) {
    assert.equal(state.size, data.size);
    assert.equal(state.grid.length, data.size);
    assert.ok(state.grid.every((row) => row.length === data.size));
  }
});

test('blink restores the face and draws eyelids instead of transparent holes', () => {
  const data = fixture();
  const { blink } = generateExpressions(data.grid, data.size, data.features).results;
  for (const feature of [data.features.leftEye, data.features.rightEye]) {
    for (const point of feature.pixels) assert.notEqual(blink.grid[point.y][point.x], null);
  }
  assert.ok(blink.grid.flat().includes('#20202a'));
});

test('pull produces a tongue outside the original mouth pixel skeleton', () => {
  const data = fixture();
  const { pull } = generateExpressions(data.grid, data.size, data.features, { strength: 'bold' }).results;
  assert.ok(pull.grid.flat().includes('#ff80a0'));
});

test('generation preserves source color variation in transformed eyes', () => {
  const data = fixture();
  const { hover } = generateExpressions(data.grid, data.size, data.features).results;
  const colors = new Set(hover.grid.slice(6, 12).flat());
  assert.ok(colors.has('#20202a'));
  assert.ok(colors.has('#4a6bb8'));
});

test('generation remains bounded across the supported working sizes', () => {
  for (const size of [24, 32, 64, 128]) {
    const data = fixture(size);
    const generated = generateExpressions(data.grid, data.size, data.features, { strength: 'bold' });
    for (const state of Object.values(generated.results)) {
      assert.equal(state.size, size);
      assert.equal(state.grid.length, size);
      assert.ok(state.grid.every((row) => row.length === size));
    }
  }
});
