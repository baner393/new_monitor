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

test('computeSlab：侧棱填满正背面之间的视差', () => {
  // 前面固定 x=0，背面 x=thickness·sinY；侧棱在两者中央。
  const face = computeSlab(1, 0, -50, 50, 6);
  assert.equal(face.width, 0);
  const edgeOn = computeSlab(0, 1, -50, 50, 6);
  assert.ok(Math.abs(edgeOn.width - 6) < 1e-9);
  assert.equal(edgeOn.x, 3, 'sinY>0 时中心在正背面中点');
  const other = computeSlab(0, -1, -50, 50, 6);
  assert.ok(Math.abs(other.width - 6) < 1e-9);
  assert.equal(other.x, -3, 'sinY<0 时中心在正背面中点');
});

test('computeSlab：侧棱不受精灵透明边距或轮廓偏移影响', () => {
  const sl = computeSlab(0.5, Math.sin(Math.acos(0.5)), -30, 70, 4);
  assert.ok(Math.abs(sl.x - (4 * 0.8660254) / 2) < 1e-6, `x=${sl.x}`);
  const sl2 = computeSlab(-0.5, Math.sin(Math.acos(-0.5)), -30, 70, 4);
  assert.ok(Math.abs(sl2.x - (4 * 0.8660254) / 2) < 1e-6, `x=${sl2.x}`);
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

test('applyFlip：正背面独立镜像并以厚度产生视差', () => {
  const sprites = {
    body: mockSprite(), mask: mockSprite(), edge: mockSprite(),
    back: mockSprite(),
    strip: mockSprite(), flash: mockSprite(), foil: mockSprite(),
    band: mockSprite(), container: mockSprite(),
  };
  const state = createFlipState();
  const o = { baseScale: 2, edgeBase: 2 / 3, restL: -50, restR: 50, stripTop: -6, stripH: 100, thickness: 6, span: 100 };

  state.spinY = 0; // 正面
  applyFlip(sprites, state, o);
  assert.equal(sprites.body.scale.x, 2);
  assert.equal(sprites.edge.scale.x, 2 / 3);
  assert.equal(sprites.body.visible, true);
  assert.equal(sprites.back.visible, false);

  state.spinY = Math.PI / 2; // 侧对：面压到最窄，侧棱最厚 + 白闪可见
  state.velY = 10;
  applyFlip(sprites, state, o);
  assert.ok(Math.abs(sprites.body.scale.x) <= 2 * 0.05 + 1e-9);
  assert.ok(sprites.strip.visible);
  assert.ok(Math.abs(sprites.strip.width - 6) < 1e-6, `strip.width=${sprites.strip.width}`);
  assert.ok(sprites.flash.alpha > 0.5, `flash.alpha=${sprites.flash.alpha}`);
  assert.ok(Math.abs(sprites.strip.position.x - 3) < 1e-6);
  assert.ok(Math.abs(sprites.back.position.x - 6) < 1e-6, '背面应位于前面右侧一个完整厚度');

  state.spinY = Math.PI; // 背面：镜像
  state.velY = 0;
  applyFlip(sprites, state, o);
  assert.equal(sprites.body.visible, false);
  assert.equal(sprites.back.visible, true);
  assert.ok(sprites.back.scale.x < 0, '背面 scale.x 为负（镜像）');
  assert.equal(sprites.strip.visible, false, '正对背面时无侧棱');
  assert.equal(sprites.flash.visible, false);
});

test('applyFlip：全息门控同时响应 tilt，光带横扫位置也纳入 tilt', () => {
  const sprites = { foil: mockSprite(), band: mockSprite(), body: mockSprite() };
  const state = createFlipState();
  const o = { baseScale: 1, edgeBase: 1, restL: -25, restR: 25, stripTop: -5, stripH: 50, thickness: 4, span: 100 };
  applyFlip(sprites, state, o);
  assert.equal(sprites.foil.alpha, 0, '正对且垂直时不触发全息');
  const baseBandX = sprites.band.position.x;
  state.tilt = 0.49;
  applyFlip(sprites, state, o);
  assert.ok(sprites.foil.alpha > 0.4, `foil.alpha=${sprites.foil.alpha}，±28° tilt 应触发全强门控`);
  assert.notEqual(sprites.band.position.x, baseBandX, 'tilt 应改变光带横扫位置');
});

test('applyFlip：累计翻滚不会把倾角光带扫出宠物范围', () => {
  const sprites = { foil: mockSprite(), band: mockSprite(), body: mockSprite() };
  const state = createFlipState();
  const o = { baseScale: 1, edgeBase: 1, restL: -25, restR: 25, stripTop: -5, stripH: 50, thickness: 4, span: 100 };
  state.spinY = Math.PI * 12 + 0.2; // 已翻六圈，视觉朝向仍接近正面
  state.tilt = 0.49;
  applyFlip(sprites, state, o);
  assert.equal(sprites.band.visible, true);
  assert.ok(sprites.band.alpha > 0.2, `band.alpha=${sprites.band.alpha}，倾角光带应可见`);
  // 主亮带位于 2×span 纹理的 60%，应留在宠物的可见范围附近。
  const brightCenter = sprites.band.position.x + o.span * 1.2;
  assert.ok(Math.abs(brightCenter) < 80, `brightCenter=${brightCenter}，不能随累计圈数漂走或落到 mask 外`);
});

test('背面帧后仍可继续推进并恢复正面复合层可见', () => {
  const sprites = {
    body: mockSprite(), back: mockSprite(), foil: mockSprite(), band: mockSprite(),
  };
  const state = createFlipState();
  const o = { baseScale: 1, edgeBase: 1, restL: -25, restR: 25, stripTop: -5, stripH: 50, thickness: 4, span: 100 };
  state.spinY = Math.PI;
  applyFlip(sprites, state, o);
  assert.equal(sprites.foil.visible, false, '背面时正面箔层可隐藏');
  assert.equal(sprites.back.visible, true);

  // 模拟 main ticker：背面帧之后，每帧仍先推进物理，再应用最新姿态。
  // 静置弹簧应能把它从背面带回正面，而不是被“不可见”状态卡住。
  let sawFrontComposite = false;
  for (let i = 0; i < 600; i++) {
    updateFlip(state, DT, 0, 0);
    applyFlip(sprites, state, o);
    sawFrontComposite ||= sprites.body.visible && sprites.foil.visible && !sprites.back.visible;
  }
  assert.notEqual(state.spinY, Math.PI, '背面后物理状态仍持续推进');
  assert.equal(sawFrontComposite, true, '后续帧会恢复正面复合层可见');
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
