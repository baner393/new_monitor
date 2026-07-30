import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  createElevationScript,
  isWindowsProcessElevated,
  launchElevatedProcess,
  resolveWindowsUserSid,
} from '../src/main/elevation-restart.js';

test('elevated launcher quotes executable and native arguments safely', () => {
  const script = createElevationScript(
    "C:\\Program Files\\Turtle's Monitor\\HardwareSensorHost.exe",
    ['--pipe', 'turtle monitor pipe', "--label=owner's"],
    "D:\\apps\\Turtle's Monitor",
  );

  assert.match(script, /ProcessStartInfo/);
  assert.match(script, /Turtle''s Monitor/);
  assert.match(script, /"turtle monitor pipe"/);
  assert.match(script, /owner''s/);
  assert.match(script, /WorkingDirectory = 'D:\\apps\\Turtle''s Monitor'/);
  assert.match(script, /ProcessWindowStyle\]::Hidden/);
  assert.match(script, /Verb = 'runas'/);
  assert.match(script, /UseShellExecute = \$true/);
});

test('administrator identity check uses the stable Windows role result', () => {
  assert.equal(isWindowsProcessElevated({
    platform: 'win32',
    execFileSyncImpl: () => 'True\r\n',
  }), true);
  assert.equal(isWindowsProcessElevated({
    platform: 'win32',
    execFileSyncImpl: () => 'False\r\n',
  }), false);
  assert.equal(isWindowsProcessElevated({ platform: 'linux' }), false);
});

test('resolves the requesting Windows account SID for cross-account UAC', () => {
  assert.equal(resolveWindowsUserSid({
    platform: 'win32',
    execFileSyncImpl: () => '"DESKTOP\\visitor","S-1-5-21-123-456-789-1001"\r\n',
  }), 'S-1-5-21-123-456-789-1001');
  assert.equal(resolveWindowsUserSid({ platform: 'linux' }), null);
  assert.equal(resolveWindowsUserSid({
    platform: 'win32',
    execFileSyncImpl: () => 'unexpected output',
  }), null);
});

test('launcher requests UAC for the sensor executable without restarting Electron', async () => {
  const child = new EventEmitter();
  let spawned = null;
  const resultPromise = launchElevatedProcess({
    executable: 'C:\\apps\\HardwareSensorHost.exe',
    args: ['--pipe', 'turtle-monitor-hardware-test'],
    workingDirectory: 'C:\\apps',
    spawnImpl: (executable, args, options) => {
      spawned = { executable, args, options };
      return child;
    },
  });
  child.emit('close', 0);
  const result = await resultPromise;

  assert.equal(result.started, true);
  assert.match(spawned.executable, /powershell\.exe$/i);
  assert.ok(spawned.args.includes('-EncodedCommand'));
  assert.equal(spawned.options.windowsHide, true);
});

test('launcher reports a cancelled UAC request and leaves lifecycle to the caller', async () => {
  const child = new EventEmitter();
  const resultPromise = launchElevatedProcess({
    executable: 'C:\\apps\\HardwareSensorHost.exe',
    spawnImpl: () => child,
  });
  child.emit('close', 1);
  await assert.rejects(resultPromise, /取消|失败/);
});
