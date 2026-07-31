import assert from 'node:assert/strict';
import test from 'node:test';

import { PhysicsEngine } from '../src/renderer/physics.js';

function idlePhysics(ambientSwingEnabled) {
  const physics = new PhysicsEngine();
  physics.setContext({ state: 'IDLE', windowWidth: 1200, windowHeight: 800, turtleSize: 64 });
  physics.ambientSwingEnabled = ambientSwingEnabled;
  physics._time = 1;
  return physics;
}

test('idle ambient swing can be disabled without disabling the pendulum engine', () => {
  const still = idlePhysics(false);
  still.updatePendulum(1 / 60);
  assert.equal(still.pendulumOmega, 0);
  assert.equal(still.pendulumAngle, 0);

  const moving = idlePhysics(true);
  moving.updatePendulum(1 / 60);
  assert.notEqual(moving.pendulumOmega, 0);
});
