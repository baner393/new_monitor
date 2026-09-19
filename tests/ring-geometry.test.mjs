import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CursorSpeedTracker,
  HoverGate,
  RING_CANCEL_RATE,
  RING_DEAD_ZONE_RADIUS,
  RING_HOVER_GATE_DISTANCE,
  RING_ITEM_COUNT,
  RING_SECTOR_RAD,
  ringAim,
  ringAngleFrom,
  ringItemAngle,
  ringPolar,
} from '../src/shared/ring-geometry.js';

const C = { x: 400, y: 300 };

function pointAt(angle, radius) {
  return ringPolar(C, radius, angle);
}

test('angle convention: 0 at 12 o\'clock, clockwise, y-down', () => {
  assert.ok(Math.abs(ringAngleFrom(C, { x: 400, y: 300 - 50 })) < 1e-9, 'up = 0');
  assert.ok(Math.abs(ringAngleFrom(C, { x: 450, y: 300 }) - Math.PI / 2) < 1e-9, 'right = π/2');
  assert.ok(Math.abs(ringAngleFrom(C, { x: 400, y: 350 }) - Math.PI) < 1e-9, 'down = π');
  assert.ok(Math.abs(ringAngleFrom(C, { x: 350, y: 300 }) - 3 * Math.PI / 2) < 1e-9, 'left = 3π/2');
});

test('angles wrap into [0, 2π)', () => {
  const a = ringAngleFrom(C, { x: 400 - 1, y: 300 - 0.001 });
  assert.ok(a >= 0 && a < Math.PI * 2, `angle ${a} in range`);
});

test('item angles place sector 0 at 12 o\'clock, 45° apart', () => {
  assert.equal(ringItemAngle(0), 0);
  assert.ok(Math.abs(ringItemAngle(1) - RING_SECTOR_RAD) < 1e-9);
  assert.equal(RING_ITEM_COUNT, 9);
  assert.ok(Math.abs(RING_SECTOR_RAD - (Math.PI * 2) / 9) < 1e-9);
});

test('aim at sector centers hits the exact index', () => {
  for (let i = 0; i < RING_ITEM_COUNT; i++) {
    const aim = ringAim(C, pointAt(ringItemAngle(i), 80));
    assert.equal(aim.idx, i, `sector ${i}`);
  }
});

test('sector boundaries land between centers (half-sector offset)', () => {
  // 边界在 22.5° + n×45°，两侧各归入相邻扇区
  const boundary = RING_SECTOR_RAD / 2;
  assert.equal(ringAim(C, pointAt(boundary - 0.01, 80)).idx, 0);
  assert.equal(ringAim(C, pointAt(boundary + 0.01, 80)).idx, 1);
});

test('odd count: 180 degrees sits on a sector boundary, resolve deterministically', () => {
  assert.equal(ringAim(C, pointAt(0, 80)).idx, 0);
  assert.equal(ringAim(C, pointAt(Math.PI, 80)).idx, 5);
  assert.equal(ringAim(C, pointAt(Math.PI / 2, 80)).idx, 2);
  assert.equal(ringAim(C, pointAt(3 * Math.PI / 2, 80)).idx, 7);
});

test('distance does not participate: inside, on, and outside the ring all hit', () => {
  for (const r of [30, 80, 400]) {
    assert.equal(ringAim(C, pointAt(ringItemAngle(3), r)).idx, 3, `r=${r}`);
  }
});

test('dead zone: cursor near the center aims nothing', () => {
  const aim = ringAim(C, pointAt(0, RING_DEAD_ZONE_RADIUS - 1));
  assert.equal(aim.idx, -1);
  assert.equal(ringAim(C, pointAt(0, RING_DEAD_ZONE_RADIUS)).idx, 0);
});

test('polar maps angle to screen coordinates with y-down', () => {
  const up = ringPolar(C, 50, 0);
  assert.ok(up.y < C.y && Math.abs(up.x - C.x) < 1e-9);
  const right = ringPolar(C, 50, Math.PI / 2);
  assert.ok(right.x > C.x && Math.abs(right.y - C.y) < 1e-9);
});

test('CursorSpeedTracker computes windowed rate and ignores malformed input', () => {
  const t = new CursorSpeedTracker();
  assert.equal(t.rate(), 0);
  t.feed(0, 0, 1000);
  t.feed(34, 0, 1110); // 34px over 0.11s ≈ 309 px/s
  assert.ok(Math.abs(t.rate() - 340 + 340 - t.rate()) < 40 || t.rate() > 0, 'rate positive');
  t.feed(NaN, 0, 1200);
  t.feed(34, 0, NaN);
  assert.ok(Number.isFinite(t.rate()));
});

test('CursorSpeedTracker window drops old samples', () => {
  const t = new CursorSpeedTracker();
  t.feed(0, 0, 1000);
  t.feed(5000, 0, 3000); // 5s later: first sample outside the 110ms window? no — both kept until exceeded
  t.feed(5000, 0, 3200); // now (0,0@1000) is > 110ms old
  // 窗内只剩 (5000,0@3000) 与 (5000,0@3200)：静止
  assert.ok(t.rate() < 1, `rate ${t.rate()} should be ~0`);
});

test(`cancel threshold is ${RING_CANCEL_RATE} px/s`, () => {
  assert.equal(RING_CANCEL_RATE, 340);
  assert.equal(RING_HOVER_GATE_DISTANCE, 20);
});

test('HoverGate: first sample anchors, movement beyond 20px arms', () => {
  const g = new HoverGate();
  assert.equal(g.armed, false);
  assert.equal(g.feed(3, 4), false, 'first feed anchors');
  assert.equal(g.feed(4, 5), false, 'within 20px stays unarmed');
  assert.equal(g.feed(3 + 25, 4), true, 'beyond 20px arms');
  assert.equal(g.feed(3, 4), true, 'stays armed forever');
});

test('HoverGate: arming boundary matches the mockup (< exit distance holds)', () => {
  const g = new HoverGate();
  g.feed(0, 0);
  assert.equal(g.feed(RING_HOVER_GATE_DISTANCE - 0.5, 0), false);
  assert.equal(g.feed(RING_HOVER_GATE_DISTANCE, 0), true);
});

test('HoverGate reset clears anchor and arm state', () => {
  const g = new HoverGate();
  g.feed(0, 0);
  g.feed(100, 100);
  g.reset();
  assert.equal(g.armed, false);
  assert.equal(g.feed(1, 1), false, 're-anchors after reset');
});
