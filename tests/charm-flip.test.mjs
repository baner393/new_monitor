import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFlipState,
  updateFlip,
  computeSlab,
  applyFlip,
  HANG_GRAVITY,
  TILT_MAX,
} from '../src/renderer/charm-flip.js';

const DT = 1 / 60;

function runSteps(state, steps, fn) {
  let last;
  for (let i = 0; i < steps; i++) last = fn(state, i);
  return last;
}

function mockSprite() {
  return {
    scale: { x: 1, y: 1 },
    position: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } },
    alpha: 1, visible: true, rotation: 0, width: 10, height: 10,
  };
}

test('createFlipState 静置默认值', () => {
  const s = createFlipState();
  assert.equal(s.spinY, 0);
  assert.equal(s.tilt, 0);
  assert.equal(s.energy, 0);
});

test('updateFlip 对非有限输入防御（无 NaN 产出）', () => {
  const s = createFlipState();
  const r = runSteps(s, 30, (st) => updateFlip(st, DT, NaN, NaN, { x: NaN, y: NaN }));
  for (const k of ['spinY', 'velY', 'spinZ', 'velZ', 'tilt', 'velTilt', 'energy']) {
    assert.ok(Number.isFinite(s[k]), `${k} 应有限`);
  }
  assert.ok(Number.isFinite(r.cosY) && Number.isFinite(r.sinY));
});

test('能量有界 [0,1]', () => {
  const s = createFlipState();
  runSteps(s, 600, (st) => updateFlip(st, DT, 5000, 1));
  assert.ok(s.energy > 0.9 && s.energy <= 1, `energy=${s.energy}`);
  runSteps(s, 1200, (st) => updateFlip(st, DT, 0, 0));
  assert.ok(s.energy >= 0 && s.energy < 0.1, `衰减后 energy=${s.energy}`);
});

test('重力链接：向右加速 → 挂牌向左滞后倾斜（惯性力反向）', () => {
  const s = createFlipState();
  const accel = { x: 400, y: 0 }; // 只向右加速
  runSteps(s, 240, (st) => updateFlip(st, DT, 0, 0, accel));
  assert.ok(s.tilt < -0.05, `tilt=${s.tilt}，应为负（向左倾）`);
});

test('重力链接：静止无加速度 → 垂直下垂（tilt→0）', () => {
  const s = createFlipState();
  s.tilt = 0.5;
  runSteps(s, 300, (st) => updateFlip(st, DT, 0, 0, { x: 0, y: 0 }));
  assert.ok(Math.abs(s.tilt) < 0.02, `tilt=${s.tilt}`);
});

test('重力链接：等效重力方向钳制在 ±TILT_MAX', () => {
  const s = createFlipState();
  // 向下加速 > 重力 → 等效重力朝上 → 目标角超限被钳制
  runSteps(s, 600, (st) => updateFlip(st, DT, 0, 0, { x: 0, y: HANG_GRAVITY * 3 }));
  assert.ok(Math.abs(s.tilt) <= TILT_MAX + 0.05, `tilt=${s.tilt}`);
});

test('重力链接：centripetal（转向加速度）改变倾斜方向', () => {
  const s1 = createFlipState();
  const s2 = createFlipState();
  runSteps(s1, 240, (st) => updateFlip(st, DT, 0, 0, { x: 800, y: 0 }));
  runSteps(s2, 240, (st) => updateFlip(st, DT, 0, 0, { x: -800, y: 0 }));
  assert.ok(s1.tilt * s2.tilt < 0, '左右转向加速度应产生反向倾斜');
  assert.ok(Math.abs(Math.abs(s1.tilt) - Math.abs(s2.tilt)) < 1e-6, '对称输入 → 对称倾斜');
});

test('经典模式（accel=null）tilt 回正', () => {
  const s = createFlipState();
  s.tilt = 0.8;
  runSteps(s, 300, (st) => updateFlip(st, DT, 100, 0, null));
  assert.ok(Math.abs(s.tilt) < 0.02, `tilt=${s.tilt}`);
});

test('computeSlab：正对无侧棱，侧对最厚', () => {
  // restL=-50, restR=50（轮廓对称）, TH=6
  const face = computeSlab(1, 0, -50, 50, 6);
  assert.equal(face.width, 0);
  const edgeOn = computeSlab(0, 1, -50, 50, 6);
  assert.ok(Math.abs(edgeOn.width - 6) < 1e-9);
  assert.ok(edgeOn.x > 0, 'sinY>0 时侧棱在右缘');
  const other = computeSlab(0, -1, -50, 50, 6);
  assert.ok(Math.abs(other.width - 6) < 1e-9);
  assert.ok(other.x < 0, 'sinY<0 时侧棱在左缘');
});

test('computeSlab：轮廓不对称时侧棱贴可见外缘', () => {
  // restL=-30, restR=70（grip 偏左）
  const sl = computeSlab(0.5, Math.sin(Math.acos(0.5)), -30, 70, 4);
  assert.ok(Math.abs(sl.x - (35 + (4 * 0.8660254) / 2)) < 1e-6, `x=${sl.x}`);
  // c<0（背面）卡片翻过 90°：远缘摆过挂点，最右缘 = restL·c = 15
  const sl2 = computeSlab(-0.5, Math.sin(Math.acos(-0.5)), -30, 70, 4);
  assert.ok(Math.abs(sl2.x - (15 + (4 * 0.8660254) / 2)) < 1e-6, `x=${sl2.x}`);
});

test('computeSlab 非有限输入防御', () => {
  const sl = computeSlab(NaN, 1, -50, 50, 6);
  assert.equal(sl.width, 0);
});

test('侧棱倒下斥力：卡在 ±90° 会自行倒下（防卡死回归）', () => {
  const s = createFlipState();
  s.spinY = Math.PI / 2;
  s.velY = 0;
  runSteps(s, 300, (st) => updateFlip(st, DT, 0, 0));
  assert.ok(Math.abs(Math.cos(s.spinY)) > 0.2, `|cosY|=${Math.abs(Math.cos(s.spinY))}，应倒离侧棱`);
});

test('applyFlip：面/描边/mask 随翻转压缩并镜像', () => {
  const sprites = {
    body: mockSprite(), mask: mockSprite(), edge: mockSprite(),
    strip: mockSprite(), flash: mockSprite(), foil: mockSprite(),
    band: mockSprite(), container: mockSprite(),
  };
  const state = createFlipState();
  const o = { baseScale: 2, edgeBase: 2 / 3, restL: -50, restR: 50, stripTop: -6, stripH: 100, thickness: 6, span: 100 };

  state.spinY = 0; // 正面
  applyFlip(sprites, state, o);
  assert.equal(sprites.body.scale.x, 2);
  assert.equal(sprites.edge.scale.x, 2 / 3);

  state.spinY = Math.PI / 2; // 侧对：面压到最窄，侧棱最厚 + 白闪可见
  state.velY = 10;
  applyFlip(sprites, state, o);
  assert.ok(Math.abs(sprites.body.scale.x) <= 2 * 0.05 + 1e-9);
  assert.ok(sprites.strip.visible);
  assert.ok(Math.abs(sprites.strip.width - 6) < 1e-6, `strip.width=${sprites.strip.width}`);
  assert.ok(sprites.flash.alpha > 0.5, `flash.alpha=${sprites.flash.alpha}`);
  assert.ok(Math.abs(sprites.strip.position.x - 3) < 1e-6);

  state.spinY = Math.PI; // 背面：镜像
  state.velY = 0;
  applyFlip(sprites, state, o);
  assert.ok(sprites.body.scale.x < 0, '背面 scale.x 为负（镜像）');
  assert.equal(sprites.strip.visible, false, '正对背面时无侧棱');
  assert.equal(sprites.flash.visible, false);
});

test('applyFlip：tilt 与纷飞都作用在容器 rotation（绕挂点）', () => {
  const sprites = { container: mockSprite() };
  const state = createFlipState();
  state.tilt = 0.3;
  state.spinZ = 0.4;
  applyFlip(sprites, state, { baseScale: 1, edgeBase: 1, restL: -25, restR: 25, stripTop: -5, stripH: 50, thickness: 3, span: 50 });
  assert.ok(Math.abs(sprites.container.rotation - (0.3 + 0.4 * 0.55)) < 1e-9);
});

test('甩动能量学：一次高速甩动翻过侧面（|cosY| 触底）且最终回正', () => {
  const s = createFlipState();
  let minCos = 1;
  for (let i = 0; i < 120; i++) {
    updateFlip(s, DT, 1500, 1);
    minCos = Math.min(minCos, Math.abs(Math.cos(s.spinY)));
  }
  assert.ok(minCos < 0.1, `min|cosY|=${minCos}，应翻过侧对`);
  for (let i = 0; i < 1200; i++) updateFlip(s, DT, 0, 0);
  assert.ok(Math.abs(Math.cos(s.spinY)) > 0.9, '能量耗尽后应回正面');
});

test('静置回正：翻滚停在背面圈数上，走最短路径回正面（不绕大圈）', () => {
  const s = createFlipState();
  s.spinY = 2 * Math.PI + Math.PI * 0.6; // 转过一圈后停在背面 108°
  s.velY = 0;
  s.energy = 0;
  let maxTravel = 0;
  const start = s.spinY;
  for (let i = 0; i < 600; i++) {
    updateFlip(s, DT, 0, 0);
    maxTravel = Math.max(maxTravel, Math.abs(s.spinY - start));
  }
  // home = 2π（最近正面圈）：回正走 ~1.88rad，而不是绕回 0（走 ~5.65rad）
  assert.ok(maxTravel < Math.PI, `maxTravel=${maxTravel.toFixed(2)}rad，应走最短路径`);
  assert.ok(Math.cos(s.spinY) > 0.95, `cosY=${Math.cos(s.spinY).toFixed(3)}，应停在正面`);
});
