import assert from 'node:assert/strict';
import test from 'node:test';

import { createElevationScript } from '../src/main/elevation-restart.js';

test('elevated restart quotes executable and every argument as PowerShell literals', () => {
  const script = createElevationScript(
    "C:\\Program Files\\Turtle's Monitor\\TurtleMonitor.exe",
    ['C:\\work tree\\new_monitor', "--label=owner's"],
    "D:\\apps\\Turtle's Monitor",
  );

  assert.match(script, /Start-Process -FilePath/);
  assert.match(script, /Turtle''s Monitor/);
  assert.match(script, /'C:\\work tree\\new_monitor'/);
  assert.match(script, /owner''s/);
  assert.match(script, /-WorkingDirectory 'D:\\apps\\Turtle''s Monitor'/);
  assert.match(script, /-WindowStyle Hidden/);
  assert.match(script, /-Verb RunAs/);
});
