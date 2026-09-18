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
  // 光标瞬移 200px，乌龟应被弹簧拉向新锚点而不是留在原地
  engine.setCharmAnchor({ x: 600, y: 300 });
  for (let i = 0; i < 240; i++) engine.updateCharmStep(dt);
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
  const a = freshEngine();
  const b = freshEngine();
  for (const engine of [a, b]) {
    engine.restRopeLength = 80;
    engine.turtle.x = 420;
    engine.turtle.y = 360;
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
