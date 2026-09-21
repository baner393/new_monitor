import test from 'node:test';
import assert from 'node:assert/strict';
import PhysicsEngine from '../src/renderer/physics.js';

function freshEngine() {
  const engine = new PhysicsEngine();
  engine.setContext({ state: 'IDLE', windowWidth: 1000, windowHeight: 800, turtleSize: 48 });
  return engine;
}

test('enterCharmMode seeds turtle from current pose and zeroes pendulum', () => {
  const engine = freshEngine();
  engine.pendulumAngle = 0.5;
  engine.pendulumOmega = 1.5;
  engine.pulley.x = 400;
  engine.pulley.y = 50;
  engine.enterCharmMode({ turtleX: 410, turtleY: 300, cursor: { x: 420, y: 240 } });
  assert.equal(engine.charmMode, true);
  assert.equal(engine.turtle.x, 410);
  assert.equal(engine.turtle.y, 300);
  assert.equal(engine.turtle.vx, 0);
  assert.equal(engine.turtle.vy, 0);
  assert.equal(engine.pendulumAngle, 0);
  assert.equal(engine.pendulumOmega, 0);
  assert.equal(engine.pulley.x, 420);
  assert.equal(engine.pulley.y, 240);
});

test('setCharmAnchor drives the pulley 1:1 and never touches screenAnchorX', () => {
  const engine = freshEngine();
  engine.enterCharmMode({ cursor: { x: 100, y: 100 } });
  const before = engine.screenAnchorX;
  assert.equal(engine.setCharmAnchor({ x: 555, y: 321 }), true);
  assert.equal(engine.pulley.x, 555);
  assert.equal(engine.pulley.y, 321);
  assert.equal(engine.screenAnchorX, before);
});

test('setCharmAnchor clamps to the window and discards malformed samples', () => {
  const engine = freshEngine();
  engine.enterCharmAnchorSafeGuard = undefined;
  engine.enterCharmMode({ cursor: { x: 100, y: 100 } });
  assert.equal(engine.setCharmAnchor({ x: 99999, y: 99999 }), true);
  assert.equal(engine.pulley.x, 1000 - 2);
  assert.equal(engine.pulley.y, 800 - 2);
  assert.equal(engine.setCharmAnchor({ x: NaN, y: 50 }), false);
  assert.equal(engine.pulley.x, 1000 - 2);
});

test('updateCharmStep is inert outside charm mode or outside IDLE', () => {
  const engine = freshEngine();
  engine.enterCharmMode({ cursor: { x: 100, y: 100 } });
  engine.setContext({ state: 'PULLING' });
  assert.equal(engine.updateCharmStep(1 / 60), undefined);
  engine.setContext({ state: 'IDLE' });
  engine.exitCharmMode();
  assert.equal(engine.updateCharmStep(1 / 60), undefined);
});

test('charm turtle settles hanging under the anchor at rest rope length', () => {
  const engine = freshEngine();
  engine.restRopeLength = 80;
  engine.enterCharmMode({ turtleX: 500, turtleY: 500, cursor: { x: 400, y: 300 } });
  const dt = 1 / 60;
  for (let i = 0; i < 1200; i++) {
    engine.updateCharmStep(dt);
  }
  const dx = engine.turtle.x - engine.pulley.x;
  const dy = engine.turtle.y - engine.pulley.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // 稳态：摆动完全衰减，乌龟静止在锚点正下方，绳长在静态拉伸平衡点
  assert.ok(Math.abs(dx) < 2, `dx ${dx.toFixed(2)} should be ~0 (straight down)`);
  assert.ok(Math.abs(dist - 80) < 2.5, `distance ${dist.toFixed(2)} should be ~80`);
  assert.ok(dy > 0, 'turtle hangs below the anchor');
  assert.ok(Math.hypot(engine.turtle.vx, engine.turtle.vy) < 5, 'should be at rest');
});

test('charm turtle tracks a moving anchor through the same rope spring', () => {
  const engine = freshEngine();
  engine.restRopeLength = 80;
  engine.enterCharmMode({ turtleX: 400, turtleY: 380, cursor: { x: 400, y: 300 } });
  const dt = 1 / 60;
  for (let i = 0; i < 120; i++) engine.updateCharmStep(dt);
  // 光标瞬移 200px，乌龟应被弹簧拉向新锚点而不是留在原地。
  // 修复后 charm 锚点硬绑定（pulley.vx 恒 0），阻尼基准是纯锚点静止系，
  // 收敛比旧实现（残留的滑轮速度虚增阻尼）慢一些，给足收敛时间。
  engine.setCharmAnchor({ x: 600, y: 300 });
  for (let i = 0; i < 600; i++) engine.updateCharmStep(dt);
  const dx = engine.turtle.x - engine.pulley.x;
  assert.ok(Math.abs(dx) < 6, `dx ${dx.toFixed(1)} should follow the anchor`);
});

test('charm collisions raise _justCollided and clamp the turtle inside bounds', () => {
  const engine = freshEngine();
  engine.restRopeLength = 300;
  engine.ropeStiffness = 2000;
  engine.enterCharmMode({ turtleX: 500, turtleY: 400, cursor: { x: 500, y: 50 } });
  engine.setCharmAnchor({ x: 500, y: 20 });
  engine.turtle.vx = -3000;
  const dt = 1 / 60;
  let collided = false;
  for (let i = 0; i < 300; i++) {
    engine.updateCharmStep(dt);
    if (engine._justCollided) {
      collided = true;
      engine._justCollided = false;
    }
  }
  assert.equal(collided, true);
  assert.ok(engine.turtle.x >= engine.turtleSize / 2 - 0.5, 'left boundary respected');
  assert.ok(engine.turtle.x <= engine.windowWidth - engine.turtleSize / 2 + 0.5, 'right boundary respected');
});

test('exitCharmMode restores the classic pulley anchor and leaves screenAnchorX intact', () => {
  const engine = freshEngine();
  engine.screenAnchorX = 0.25;
  engine.enterCharmMode({ turtleX: 500, turtleY: 400, cursor: { x: 700, y: 700 } });
  assert.equal(engine.pulley.x, 700);
  engine.exitCharmMode();
  assert.equal(engine.charmMode, false);
  assert.equal(engine.pulley.x, 250);
  assert.equal(engine.pulley.y, 50);
  assert.equal(engine.screenAnchorX, 0.25);
});

test('updatePulleyPhysics keeps original semantics for the right-click throw', () => {
  const engine = freshEngine();
  engine.setContext({ state: 'PULLEY_PHYSICS' });
  // 乌龟在绳长以内（松弛）：重力自由落体，弹簧不发力
  engine.turtle.x = 500;
  engine.turtle.y = 150;
  engine.turtle.vx = 0;
  engine.turtle.vy = 0;
  engine.pulley.x = 500;
  engine.pulley.y = 50;
  engine.restRopeLength = 150;
  const energy = engine.updatePulleyPhysics(1 / 60);
  assert.ok(typeof energy === 'number' && energy >= 0, 'returns total energy');
  assert.ok(engine.turtle.vy > 0, 'gravity pulls the turtle down while the rope is slack');
  assert.ok(engine.pulley.x === 500, 'slack rope exerts no force on the pulley');
});

test('charm step and throw physics agree on the same initial frame', () => {
  // 松绳分支按模式有意分叉（挂饰回收 / 经典外推），一致性断言用张紧构型。
  const a = freshEngine();
  const b = freshEngine();
  for (const engine of [a, b]) {
    engine.restRopeLength = 80;
    engine.turtle.x = 420;
    engine.turtle.y = 420;
    engine.turtle.vx = 120;
    engine.turtle.vy = -40;
    engine.pulley.x = 400;
    engine.pulley.y = 300;
    engine.pulley.vx = 0;
  }
  a.setContext({ state: 'IDLE' });
  a.enterCharmMode({ turtleX: a.turtle.x, turtleY: a.turtle.y, cursor: { x: 400, y: 300 } });
  a.turtle.vx = 120;
  a.turtle.vy = -40;
  b.setContext({ state: 'PULLEY_PHYSICS' });
  a.updateCharmStep(1 / 60);
  b.updatePulleyPhysics(1 / 60);
  assert.ok(Math.abs(a.turtle.x - b.turtle.x) < 1e-9, 'same turtle x');
  assert.ok(Math.abs(a.turtle.y - b.turtle.y) < 1e-9, 'same turtle y');
  assert.ok(Math.abs(a.turtle.vx - b.turtle.vx) < 1e-9, 'same turtle vx');
  assert.ok(Math.abs(a.turtle.vy - b.turtle.vy) < 1e-9, 'same turtle vy');
});

// ── 回归：松绳推力方向 + charm 模式 pulley.vx 残留（2026-09-21 修复）──

test('松绳时只回收不推离：挂件在锚点右侧松弛，一帧后 vx 必须为负（朝锚点）', () => {
  const engine = freshEngine();
  engine.charmMode = true;
  engine.gravity = 0;
  engine.airDamping = 1;
  engine.restRopeLength = 80;
  engine.setCharmAnchor({ x: 500, y: 300 });
  engine.turtle.x = 550;
  engine.turtle.y = 300;
  engine.turtle.vx = 0;
  engine.turtle.vy = 0;
  engine.updateCharmStep(1 / 60);
  assert.ok(engine.turtle.vx < 0, `vx=${engine.turtle.vx}，松绳应产生指向锚点的弱回收力（负 x），绝不能推离`);
});

test('charm 模式：绳子反作用不得累积到 pulley.vx，setCharmAnchor 清零残留', () => {
  const engine = freshEngine();
  engine.charmMode = true;
  engine.restRopeLength = 80;
  engine.setCharmAnchor({ x: 500, y: 300 });
  // 拉紧状态：挂件在锚点右侧 200px，绳被拉伸 → 张紧分支
  engine.turtle.x = 700;
  engine.turtle.y = 300;
  engine.updateCharmStep(1 / 60);
  assert.equal(engine.pulley.vx, 0, `charm 模式滑轮硬绑定光标，pulley.vx=${engine.pulley.vx} 应为 0`);
  // 残留速度（模拟经典模式切换遗留）在下次硬绑定锚点时被清零
  engine.pulley.vx = 999;
  engine.setCharmAnchor({ x: 510, y: 300 });
  assert.equal(engine.pulley.vx, 0, 'setCharmAnchor 每次设置硬绑定锚点时清零 pulley.vx');
});

test('高幅度锚点移动后静止：挂件收敛到锚点正下方，速度收敛，无单向偏置', () => {
  const engine = new PhysicsEngine();
  engine.setContext({ state: 'IDLE', windowWidth: 2000, windowHeight: 1000, turtleSize: 48 });
  engine.charmMode = true;
  engine.restRopeLength = 80;
  engine.setCharmAnchor({ x: 500, y: 300 });
  engine.turtle.x = 500;
  engine.turtle.y = 380;
  // 静置到位
  for (let i = 0; i < 300; i++) engine.updateCharmStep(1 / 60);
  // 高幅度瞬移 + 反复大摆
  for (const target of [1500, 300, 1500, 300, 1000]) {
    engine.setCharmAnchor({ x: target, y: 300 });
    for (let i = 0; i < 60; i++) engine.updateCharmStep(1 / 60);
  }
  // 锚点静止 20s，挂件应收敛
  engine.setCharmAnchor({ x: 1000, y: 300 });
  for (let i = 0; i < 1200; i++) engine.updateCharmStep(1 / 60);
  assert.equal(engine.pulley.vx, 0, '收敛全程 pulley.vx 必须保持 0');
  assert.ok(Math.abs(engine.turtle.vx) < 2, `vx=${engine.turtle.vx} 应收敛`);
  assert.ok(Math.abs(engine.turtle.vy) < 2, `vy=${engine.turtle.vy} 应收敛`);
  assert.ok(Math.abs(engine.turtle.x - 1000) < 3, `turtle.x=${engine.turtle.x} 应回到锚点正下方`);
  // 静态悬垂：重力 800 / 绳刚度 500 → 静态拉伸 ≈1.6px
  assert.ok(Math.abs(engine.turtle.y - (300 + 80)) < 6, `turtle.y=${engine.turtle.y} 应悬垂在锚点下方 restRopeLength 处`);
});
