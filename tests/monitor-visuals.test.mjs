import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdaptiveSpeedTracker,
  capacityColor,
  paginate,
  remainingCapacityColor,
  temperatureColor,
} from '../src/renderer/monitor-visuals.js';

test('capacity colors keep identity before warming into an alert', () => {
  const identity = 0xbb77ff;
  assert.equal(capacityColor(identity, 74), identity);
  assert.notEqual(capacityColor(identity, 82), identity);
  assert.equal(capacityColor(identity, 90), 0xc92f45);
  assert.equal(capacityColor(identity, 100), 0xc92f45);
});

test('remaining battery capacity warns when nearly empty, not when full', () => {
  const identity = 0x71e58b;
  assert.equal(remainingCapacityColor(identity, 100), identity);
  assert.notEqual(remainingCapacityColor(identity, 10), identity);
});

test('device temperature colors move continuously from cool to critical', () => {
  const thresholds = [35, 60, 75, 90];
  assert.equal(temperatureColor(20, thresholds), 0x4ebcff);
  assert.notEqual(temperatureColor(68, thresholds), temperatureColor(60, thresholds));
  assert.equal(temperatureColor(100, thresholds), 0xff4d5a);
});

test('adaptive speed tiers rise immediately and downgrade with hysteresis', () => {
  const tracker = new AdaptiveSpeedTracker({
    minimumLearningSamples: 999,
    defaults: { networkDown: { baseline: 100, noise: 0 } },
  });
  assert.equal(tracker.update('networkDown', 0).tier, 0);
  assert.equal(tracker.update('networkDown', 10).tier, 1);
  assert.equal(tracker.update('networkDown', 20).tier, 2);
  assert.equal(tracker.update('networkDown', 50).tier, 3);
  assert.equal(tracker.update('networkDown', 80).tier, 4);
  tracker.step(0.1);
  assert.ok(tracker.snapshot('networkDown').animated > 0);
  assert.ok(tracker.snapshot('networkDown').animated < 4);
  assert.equal(tracker.update('networkDown', 1).tier, 4);
  assert.equal(tracker.update('networkDown', 1).tier, 1);
});

test('adaptive baseline keeps only the configured recent sample window', () => {
  const tracker = new AdaptiveSpeedTracker({
    windowSize: 3,
    minimumLearningSamples: 2,
    defaults: { diskRead: { baseline: 1, noise: 0 } },
  });
  [10, 20, 30, 40].forEach((value) => tracker.update('diskRead', value));
  assert.equal(tracker.snapshot('diskRead').sampleCount, 3);
  assert.ok(tracker.snapshot('diskRead').baseline >= 30);
});

test('missing speed samples stay unavailable and do not distort the learned baseline', () => {
  const tracker = new AdaptiveSpeedTracker();
  const snapshot = tracker.update('diskRead', null);
  assert.equal(snapshot.value, null);
  assert.equal(snapshot.sampleCount, 0);
  assert.equal(snapshot.tier, 0);
});

test('pagination wraps across complete partition and sensor lists', () => {
  assert.deepEqual(paginate(['C:', 'D:', 'E:'], 1, 2), {
    items: ['E:'], page: 1, pageCount: 2,
  });
  assert.equal(paginate(['C:'], 7, 2).page, 0);
});
