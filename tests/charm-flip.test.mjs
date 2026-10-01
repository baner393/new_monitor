import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFlipState,
  updateFlip,
  sliceOffsets,
  applyFlip,
  syncLayerScales,
  knobsToFlipConfig,
  HANG_GRAVITY,
  TILT_MAX,
} from '../src/renderer/charm-flip.js';
import { buildSlabGeometry } from '../src/renderer/charm-foil.js';

const DT = 1 / 60;

test('图案背面使用本底尺寸原色、独立反光与遮罩，材质切回金属不串层', () => {
  const layers = Object.fromEntries(['body', 'back', 'backSheen', 'backMask', 'backFoil', 'backBand', 'edge'].map((key) => [key, mockSprite()]));
  const state = { ...createFlipState(), spinY: Math.PI * 0.8, energy: 0.7 };
  const options = { baseScale: 3, edgeBase: 1, thickness: 6, span: 96, backMaterial: 'pattern' };
  applyFlip(layers, state, options);
  assert.equal(layers.body.visible, false);
  assert.equal(layers.back.visible, true);
  assert.equal(layers.back.scale.x, 3 * Math.abs(Math.cos(state.spinY)));
  assert.equal(layers.back.scale.y, 3);
  assert.equal(layers.back.tint, 0xffffff);
  assert.equal(layers.backSheen.visible, false);
  assert.equal(layers.backFoil.visible, true);
  assert.equal(layers.backBand.visible, true);
  assert.equal(layers.backFoil.position.x, layers.back.position.x);
  assert.equal(layers.backMask.position.x, layers.back.position.x);
  assert.equal(layers.backMask.scale.x, layers.back.scale.x);
  assert.ok(layers.backFoil.alpha > 0);
  applyFlip(layers, state, { ...options, backMaterial: 'metal' });
  assert.equal(layers.back.scale.y, 1);
  assert.equal(layers.backSheen.visible, true);
  assert.equal(layers.backFoil.visible, false);
  assert.equal(layers.backBand.visible, false);
  assert.equal(knobsToFlipConfig({ charmBackMaterial: 'pattern' }).backMaterial, 'pattern');
  assert.equal(knobsToFlipConfig({ charmBackMaterial: 'invalid' }).backMaterial, 'metal');
});

test('金属翻转：侧面隐藏两张面，倒角明暗分层，背面高光不受转速影响', () => {
  const layers = { body: mockSprite(), back: mockSprite(), backSheen: mockSprite(), edge: mockSprite(), slices: Array.from({ length: 14 }, mockSprite) };
  const state = createFlipState();
  const options = { baseScale: 3, edgeBase: 1, thickness: 6, span: 96 };
  for (const angle of [Math.PI / 2, Math.PI * 1.5]) {
    for (const delta of [-0.008, 0, 0.008]) {
      state.spinY = angle + delta;
      applyFlip(layers, state, options);
      assert.equal(layers.body.visible, false, '侧面对正面图案不保留最低宽度条纹');
      assert.equal(layers.back.visible, false);
      assert.ok(new Set(layers.slices.map((slice) => slice.tint)).size >= 3, '侧壁必须有倒角和暗截面');
    }
  }
  for (const angle of [Math.PI * 0.7, Math.PI, Math.PI * 1.3, Math.PI * 5]) {
    state.spinY = angle;
    for (const velocity of [-20, 0, 20]) {
      state.velY = velocity;
      applyFlip(layers, state, options);
      assert.equal(layers.body.visible, false);
      assert.equal(layers.back.visible, true);
      assert.equal(layers.backSheen.visible, true);
      assert.ok(layers.slices.every((slice) => !slice.visible || slice.scale.x < 0), '背面侧壁须镜像同一个不对称轮廓');
      assert.ok(layers.backSheen.alpha > 0 && layers.backSheen.alpha < 1);
      assert.equal(layers.back.scale.y, layers.backSheen.scale.y);
      assert.ok(Math.abs(layers.back.scale.x + Math.abs(Math.cos(angle))) < 1e-9);
    }
  }
});

function runSteps(state, steps, fn) {
  let last;
  for (let i = 0; i < steps; i++) last = fn(state, i);
  return last;
}

function mockSprite() {
  return {
    scale: { x: 1, y: 1, set(x, y) { this.x = x; this.y = y === undefined ? x : y; } },
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

test('sliceOffsets：切片均匀分布在正背面间距内', () => {
  const off = sliceOffsets(1, 6, 4);
  assert.equal(off.length, 4);
  // 不含两端（0 和 6 是正背面本身）：1.2, 2.4, 3.6, 4.8
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(off[i] - 6 * (i + 1) / 5) < 1e-9, `off[${i}]=${off[i]}`);
  }
  assert.ok(off[0] > 0 && off[3] < 6, '切片不含端点');
});

test('sliceOffsets：sinY 反向时偏移反向，正对为空区间两端', () => {
  const pos = sliceOffsets(1, 6, 3);
  const neg = sliceOffsets(-1, 6, 3);
  assert.deepEqual(neg, pos.map((v) => -v), '翻转方向相反 → 偏移相反');
  const zero = sliceOffsets(0, 6, 3);
  assert.ok(zero.every((v) => v === 0), '正对时所有切片重合在原点');
});

test('sliceOffsets 非有限输入防御', () => {
  assert.deepEqual(sliceOffsets(NaN, 6, 3), []);
  assert.deepEqual(sliceOffsets(1, 6, 0), []);
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
    slices: [mockSprite(), mockSprite(), mockSprite()],
    foil: mockSprite(),
    band: mockSprite(), container: mockSprite(),
  };
  const state = createFlipState();
  const o = { baseScale: 2, edgeBase: 2 / 3, thickness: 6, span: 100 };

  state.spinY = 0; // 正面：无侧壁
  applyFlip(sprites, state, o);
  assert.equal(sprites.body.scale.x, 2);
  assert.equal(sprites.edge.scale.x, 2 / 3);
  assert.equal(sprites.body.visible, true);
  assert.equal(sprites.back.visible, false);
  assert.ok(sprites.slices.every((sl) => !sl.visible), '正对时切片全部隐藏');

  state.spinY = Math.PI / 2; // 侧对：面压到最窄，侧壁最厚
  state.velY = 10;
  applyFlip(sprites, state, o);
  assert.ok(Math.abs(sprites.body.scale.x) <= 2 * 0.05 + 1e-9);
  assert.ok(sprites.slices.every((sl) => sl.visible), '侧对时切片全部显示');
  // 3 层完整深度区间中心：1 / 3 / 5。
  [1, 3, 5].forEach((want, i) => {
    assert.ok(Math.abs(sprites.slices[i].position.x - want) < 1e-6, `slice[${i}].x=${sprites.slices[i].position.x}`);
    assert.ok(Math.abs(sprites.slices[i].scale.x - (2 / 3) * 0.02) < 1e-6, '深度区间覆盖完整厚度');
  });
  assert.ok(Math.abs(sprites.back.position.x - 6) < 1e-6, '背面应位于前面右侧一个完整厚度');

  state.spinY = Math.PI; // 背面：镜像
  state.velY = 0;
  applyFlip(sprites, state, o);
  assert.equal(sprites.body.visible, false);
  assert.equal(sprites.back.visible, true);
  assert.ok(sprites.back.scale.x < 0, '背面 scale.x 为负（镜像）');
  assert.ok(sprites.slices.every((sl) => !sl.visible), '正对背面时无侧壁');
});

test('实心侧壁：不对称窄行、断开行段及大小厚度在侧对前后连续覆盖', () => {
  const width = 96, height = 12;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const rows = [[[12, 15]], [[36, 60]], [], [[6, 9], [72, 90]]];
  for (let y = 0; y < height; y++) {
    for (const [left, right] of rows[Math.floor(y / 3)]) {
      for (let x = left; x < right; x++) pixels[(y * width + x) * 4 + 3] = 255;
    }
  }
  const geometry = buildSlabGeometry({ width, height, getContext: () => ({ getImageData: () => ({ data: pixels }) }) }, { x: 0.3, y: 0.12 });
  assert.equal(geometry.vertices.length / 8, 4, '空白行不填充，断开行段保留独立四边形');
  const slices = Array.from({ length: 14 }, () => ({ ...mockSprite(), vertices: geometry.vertices.slice(), slabVertices: geometry.vertices }));
  for (const span of [32, 96, 192]) for (const thickness of [2, 6, 9]) {
    for (const degrees of [0.1, 60, 89.5, 90, 90.5, 120, 270]) {
      for (const backMaterial of ['metal', 'pattern']) {
        const state = { ...createFlipState(), spinY: degrees * Math.PI / 180 };
        applyFlip({ slices }, state, { baseScale: span / 32, edgeBase: span / 96, span, thickness, backMaterial });
        if (!slices[0].visible) continue;
        const gap = thickness * Math.sin(state.spinY);
        const direction = Math.cos(state.spinY) >= 0 || backMaterial === 'pattern' ? 1 : -1;
        for (let row = 0; row < geometry.vertices.length; row += 8) {
          const projected = [geometry.vertices[row], geometry.vertices[row + 2]]
            .map((x) => x * Math.abs(Math.cos(state.spinY)) * direction * span / 96);
          const ranges = slices.map((slice) => [slice.vertices[row], slice.vertices[row + 2]]
            .map((x) => x * slice.scale.x + slice.position.x).sort((a, b) => a - b))
            .sort((a, b) => a[0] - b[0]);
          const expectedLeft = Math.min(...projected) + Math.min(0, gap);
          const expectedRight = Math.max(...projected) + Math.max(0, gap);
          assert.ok(Math.abs(ranges[0][0] - expectedLeft) < 0.0001);
          let right = ranges[0][1];
          for (const range of ranges.slice(1)) {
            assert.ok(range[0] <= right + 0.0001, `侧壁不得漏缝：${span}px / ${thickness}px / ${degrees}°`);
            right = Math.max(right, range[1]);
          }
          assert.ok(Math.abs(right - expectedRight) < 0.0001);
        }
        assert.ok(slices.slice(1, -1).every((slice) => (slice.tint & 255) >= 224), '中段不能像暗色空腔');
      }
    }
  }
});

test('applyFlip：全息门控同时响应 tilt，光带横扫位置也纳入 tilt', () => {
  const sprites = { foil: mockSprite(), band: mockSprite(), body: mockSprite() };
  const state = createFlipState();
  const o = { baseScale: 1, edgeBase: 1, restL: -25, restR: 25, stripTop: -5, stripH: 50, thickness: 4, span: 100 };
  applyFlip(sprites, state, o);
  assert.equal(sprites.foil.alpha, 0, '正对且垂直时不触发全息');
  assert.equal(sprites.foil.scale.x, o.edgeBase);
  const baseBandX = sprites.band.position.x;
  state.tilt = 0.49;
  applyFlip(sprites, state, o);
  assert.ok(sprites.foil.alpha > 0.4, `foil.alpha=${sprites.foil.alpha}，±28° tilt 应触发全强门控`);
  assert.notEqual(sprites.band.position.x, baseBandX, 'tilt 应改变光带横扫位置');
  state.spinY = Math.PI / 3;
  applyFlip(sprites, state, o);
  assert.ok(Math.abs(sprites.foil.scale.x - o.edgeBase * 0.5) < 1e-9, '正面箔面必须跟随原图投影压缩');
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

// ── 回归：闪卡层随 turtleSize 同步缩放（2026-09-21 修复）──

test('syncLayerScales：body/mask 用基准 scale，金属背板及箔材质用 scale/3', () => {
  const layers = {
    body: mockSprite(), back: mockSprite(), backSheen: mockSprite(), mask: mockSprite(),
    foil: mockSprite(), band: mockSprite(), edge: mockSprite(),
    slices: [mockSprite(), mockSprite(), mockSprite()],
  };
  syncLayerScales(layers, 1);
  assert.equal(layers.body.scale.y, 1);
  assert.equal(layers.back.scale.y, 1 / 3);
  assert.equal(layers.backSheen.scale.y, 1 / 3);
  assert.equal(layers.mask.scale.y, 1);
  assert.equal(layers.foil.scale.y, 1 / 3);
  assert.equal(layers.band.scale.y, 1 / 3);
  assert.equal(layers.edge.scale.y, 1 / 3);
  assert.ok(layers.slices.every((s) => Math.abs(s.scale.y - 1 / 3) < 1e-9));

  // 尺寸 scale=1 → 4：所有层的 y 缩放必须更新，不残留旧值
  syncLayerScales(layers, 4);
  assert.equal(layers.body.scale.y, 4);
  assert.equal(layers.back.scale.y, 4 / 3);
  assert.equal(layers.backSheen.scale.y, 4 / 3);
  assert.equal(layers.mask.scale.y, 4);
  assert.equal(layers.foil.scale.y, 4 / 3);
  assert.equal(layers.band.scale.y, 4 / 3);
  assert.equal(layers.edge.scale.y, 4 / 3);
  assert.ok(layers.slices.every((s) => Math.abs(s.scale.y - 4 / 3) < 1e-9), '切片层不得保留旧 y 缩放');
});

test('缩放同步后翻转压缩不破坏新缩放：scale.y 保持，scale.x 由翻转接管', () => {
  const layers = {
    body: mockSprite(), back: mockSprite(), mask: mockSprite(),
    edge: mockSprite(), slices: [mockSprite()],
    foil: mockSprite(), band: mockSprite(), container: mockSprite(),
  };
  syncLayerScales(layers, 4);
  const state = createFlipState();
  state.spinY = Math.PI / 3;
  applyFlip(layers, state, { baseScale: 4, edgeBase: 4 / 3, stripTop: -6, stripH: 100, thickness: 6, span: 100 });
  assert.equal(layers.body.scale.y, 4, '翻转不改 y 缩放');
  assert.ok(Math.abs(layers.body.scale.x - 4 * Math.cos(Math.PI / 3)) < 1e-9);
  assert.equal(layers.edge.scale.y, 4 / 3);
  assert.equal(layers.slices[0].scale.y, 4 / 3, '切片 y 缩放不被翻转残留');
});

test('侧对翻转不存在全高白闪层（flash 已删除，不得复活）', () => {
  // 传入 flash 精灵时 applyFlip 也不得驱动它——旧的中央全高 ADD 白条已删除
  const flash = mockSprite();
  flash.visible = false;
  const sprites = {
    body: mockSprite(), back: mockSprite(), mask: mockSprite(), edge: mockSprite(),
    slices: [mockSprite(), mockSprite()], foil: mockSprite(), band: mockSprite(),
    container: mockSprite(), flash,
  };
  const state = createFlipState();
  state.spinY = Math.PI / 2;
  state.velY = 12;
  applyFlip(sprites, state, { baseScale: 1, edgeBase: 1 / 3, stripTop: -6, stripH: 50, thickness: 6, span: 100 });
  assert.equal(flash.visible, false, 'applyFlip 不得驱动任何 flash 层');
  assert.equal(flash.alpha, 1, 'flash 的 alpha 不得被触碰');
  assert.ok(sprites.slices.every((s) => s.visible), '侧壁切片仍在承担厚度表现');
});

// ── 手感旋钮 → 底层参数映射（设置面板挂饰分组）──

test('knobsToFlipConfig：默认 50% 映射到定稿参数', () => {
  const cfg = knobsToFlipConfig({});
  assert.ok(Math.abs(cfg.impulse - 30) < 1e-9);
  assert.ok(Math.abs(cfg.spinDamping - 0.95) < 1e-9);
  assert.ok(Math.abs(cfg.idleSwayAmp - 0.14) < 1e-9);
  assert.ok(Math.abs(cfg.energySpeed - 510) < 1e-9);
  assert.ok(Math.abs(cfg.thicknessRatio - 0.07) < 1e-9);
  assert.equal(cfg.flipEnabled, true);
});

test('knobsToFlipConfig：极端值有界且单调', () => {
  const lo = knobsToFlipConfig({ charmFlipEnergy: 0, charmFlipSpin: 0, charmGravityLink: 0, charmThickness: 0 });
  const hi = knobsToFlipConfig({ charmFlipEnergy: 100, charmFlipSpin: 100, charmGravityLink: 100, charmThickness: 100 });
  assert.ok(hi.impulse > lo.impulse, '灵敏度↑ → 冲量↑');
  assert.ok(hi.energySpeed < lo.energySpeed, '灵敏度↑ → 满能量所需速度↓');
  assert.ok(hi.spinDamping < lo.spinDamping, '时长↑ → 阻尼↓');
  assert.ok(hi.tiltStiffness > lo.tiltStiffness, '链接感↑ → 弹簧↑');
  assert.ok(hi.thicknessRatio > lo.thicknessRatio);
  for (const cfg of [lo, hi]) {
    assert.ok(cfg.impulse >= 12 && cfg.impulse <= 48);
    assert.ok(cfg.spinDamping >= 0.39 && cfg.spinDamping <= 1.51); // 浮点边界（1.5-1.1≈0.3999）
    assert.ok(cfg.tiltStiffness >= 18 && cfg.tiltStiffness <= 70);
    assert.ok(cfg.thicknessRatio >= 0.03 && cfg.thicknessRatio <= 0.11);
  }
});

test('knobsToFlipConfig：非法输入回退中位', () => {
  const cfg = knobsToFlipConfig({ charmFlipEnergy: NaN, charmFlipSpin: 'x' });
  assert.ok(Math.abs(cfg.impulse - 30) < 1e-9);
});

test('翻转开关：关闭后无冲量且快速回正', () => {
  const s = createFlipState();
  s.spinY = 2.0;
  s.velY = 5;
  const off = knobsToFlipConfig({ charmFlipEnabled: false });
  assert.equal(off.flipEnabled, false);
  for (let i = 0; i < 240; i++) updateFlip(s, DT, 1500, 1, null, off);
  assert.ok(Math.abs(Math.cos(s.spinY)) > 0.95, `cosY=${Math.cos(s.spinY).toFixed(3)}，关闭翻转后应回正面`);
  assert.ok(Math.abs(s.spinZ) < 0.01, '纷飞也回正');
});
