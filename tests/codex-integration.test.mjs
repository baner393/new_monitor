import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CodexMonitor, parseCodexRollout, resolveCodexHome } from '../src/main/codex-monitor.js';
import { StateMachine } from '../src/renderer/state-machine.js';
import { InputManager } from '../src/renderer/input.js';
import {
  CODEX_ACTIVITY,
  buildCodexVisibleTasks,
  codexMoodForActivity,
  normalizeCodexIntegrationConfig,
  resolveCodexActivity,
  sortCodexUnreadEvents,
} from '../src/shared/codex-integration.js';
import { CodexMotionController, codexDropLength, codexStatusSymbol } from '../src/renderer/codex-motion.js';

function rollout(lines) {
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

test('Codex config is portable, versioned and bounds persisted read events', () => {
  const normalized = normalizeCodexIntegrationConfig({
    enabled: true,
    homeMode: 'manual',
    manualHome: ' C:\\Users\\demo\\.codex ',
    readEventIds: [...Array.from({ length: 520 }, (_, index) => `event-${index}`), 'event-519'],
  });
  assert.equal(normalized.version, 1);
  assert.equal(normalized.homeMode, 'manual');
  assert.equal(normalized.manualHome, 'C:\\Users\\demo\\.codex');
  assert.equal(normalized.readEventIds.length, 512);
  assert.ok(normalized.enabledAtMs > 0);
});

test('unread Codex events follow needs-input, blocked, ready priority', () => {
  const events = sortCodexUnreadEvents([
    { id: 'ready', activity: CODEX_ACTIVITY.READY, createdAtMs: 1 },
    { id: 'blocked', activity: CODEX_ACTIVITY.BLOCKED, createdAtMs: 2 },
    { id: 'input', activity: CODEX_ACTIVITY.NEEDS_INPUT, createdAtMs: 3 },
  ]);
  assert.deepEqual(events.map((event) => event.id), ['input', 'blocked', 'ready']);
  assert.equal(resolveCodexActivity({ unread: events }), CODEX_ACTIVITY.NEEDS_INPUT);
  assert.equal(codexMoodForActivity(CODEX_ACTIVITY.READY), 'happy');
  assert.equal(codexMoodForActivity(CODEX_ACTIVITY.BLOCKED), 'pain');
  assert.equal(codexMoodForActivity(CODEX_ACTIVITY.RUNNING), 'working');
});

test('completed rollout keeps the full reply and only emits one unread event', () => {
  const text = rollout([
    { timestamp: '2026-07-30T10:00:00Z', type: 'session_meta', payload: { id: 'thread-1', cwd: 'D:\\all\\new_monitor' } },
    { timestamp: '2026-07-30T10:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: '请检查构建并修复问题' } },
    { timestamp: '2026-07-30T10:00:02Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
    { timestamp: '2026-07-30T10:00:03Z', type: 'event_msg', payload: { type: 'agent_message', message: '完整回复第一段\n完整回复第二段' } },
    { timestamp: '2026-07-30T10:00:04Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1' } },
  ]);
  const parsed = parseCodexRollout(text, { enabledAtMs: Date.parse('2026-07-30T09:00:00Z') });
  assert.equal(parsed.task.id, 'thread-1');
  assert.equal(parsed.task.project, 'new_monitor');
  assert.equal(parsed.unread.activity, CODEX_ACTIVITY.READY);
  assert.equal(parsed.unread.message, '完整回复第一段\n完整回复第二段');
  assert.equal(parsed.unread.canReply, true);
  assert.equal(parsed.task.messages.at(-1).message, '完整回复第一段\n完整回复第二段');

  const read = parseCodexRollout(text, {
    enabledAtMs: Date.parse('2026-07-30T09:00:00Z'),
    readEventIds: new Set([parsed.unread.id]),
  });
  assert.equal(read.unread, null);
});

test('visible Codex tasks group unread events by thread and keep running count separate', () => {
  const summary = buildCodexVisibleTasks([
    { id: 'running-a', activity: CODEX_ACTIVITY.RUNNING, updatedAtMs: 4 },
    { id: 'ready-a', activity: CODEX_ACTIVITY.SILENT, updatedAtMs: 3 },
  ], [
    { id: 'one', threadId: 'ready-a', activity: CODEX_ACTIVITY.READY, createdAtMs: 2 },
    { id: 'two', threadId: 'ready-a', activity: CODEX_ACTIVITY.READY, createdAtMs: 3 },
  ]);
  assert.equal(summary.runningCount, 1);
  assert.equal(summary.unreadTaskCount, 1);
  assert.equal(summary.visibleTasks.length, 2);
  assert.equal(summary.visibleTasks.find((task) => task.threadId === 'ready-a').unreadCount, 2);
});

test('Codex blocked motion drops, rebounds, climbs and returns without mutating a rope setting', () => {
  const motion = new CodexMotionController();
  motion.setState(CODEX_ACTIVITY.BLOCKED, 'blocked-event-1');
  const options = { enabled: true, petHeight: 64, baseY: 150, viewportHeight: 600 };
  const lengths = [];
  for (let index = 0; index < 110; index++) lengths.push(motion.update(0.05, options).lengthOffset);
  assert.ok(Math.max(...lengths) >= 40);
  assert.ok(lengths.slice(28, 86).some((value, index, values) => index > 0 && value < values[index - 1]));
  assert.equal(lengths.at(-1), 0);
  assert.equal(motion.update(0.05, options).sequence, '');
  assert.equal(codexDropLength({ petHeight: 200, baseY: 570, viewportHeight: 600 }), 0);
});

test('Codex blocked motion does not restart while the aggregate state remains blocked', () => {
  const motion = new CodexMotionController();
  const options = { enabled: true, petHeight: 64, baseY: 150, viewportHeight: 600 };
  motion.setState(CODEX_ACTIVITY.BLOCKED, 'blocked-a');
  for (let index = 0; index < 100; index++) motion.update(0.05, options);
  assert.equal(motion.update(0.05, options).sequence, '');
  motion.setState(CODEX_ACTIVITY.BLOCKED, 'blocked-b');
  assert.equal(motion.update(0.05, options).sequence, '');
  motion.setState(CODEX_ACTIVITY.SILENT, 'clear');
  motion.setState(CODEX_ACTIVITY.BLOCKED, 'blocked-c');
  assert.equal(motion.update(0.05, options).sequence, 'blocked');
});

test('Codex status symbols use distinct pixel silhouettes', () => {
  const signatures = [
    CODEX_ACTIVITY.RUNNING,
    CODEX_ACTIVITY.NEEDS_INPUT,
    CODEX_ACTIVITY.READY,
    CODEX_ACTIVITY.BLOCKED,
    CODEX_ACTIVITY.DISCONNECTED,
  ].map((activity) => JSON.stringify(codexStatusSymbol(activity, 0).pixels));
  assert.equal(new Set(signatures).size, signatures.length);
});

test('running and aborted rollouts map to quiet running and blocked unread states', () => {
  const running = parseCodexRollout(rollout([
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 'running-thread', cwd: 'C:\\work\\app' } },
    { timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-running' } },
  ]), { modifiedAtMs: Date.now(), enabledAtMs: Date.now() - 1000 });
  assert.equal(running.task.activity, CODEX_ACTIVITY.RUNNING);
  assert.equal(running.unread, null);

  const aborted = parseCodexRollout(rollout([
    { timestamp: '2026-07-30T10:00:00Z', type: 'session_meta', payload: { id: 'blocked-thread', cwd: 'C:\\work\\app' } },
    { timestamp: '2026-07-30T10:00:01Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-blocked' } },
    { timestamp: '2026-07-30T10:00:02Z', type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 'turn-blocked' } },
  ]), { enabledAtMs: Date.parse('2026-07-30T09:00:00Z') });
  assert.equal(aborted.unread.activity, CODEX_ACTIVITY.BLOCKED);
  assert.equal(aborted.unread.canReply, false);
});

test('Codex home resolution honors manual mode and uses a portable user-home fallback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-'));
  const automatic = path.join(root, '.codex');
  const manual = path.join(root, 'manual-codex');
  fs.mkdirSync(automatic);
  fs.mkdirSync(manual);
  try {
    assert.equal(resolveCodexHome({ enabled: true }, {}, root), automatic);
    assert.equal(resolveCodexHome({ enabled: true, homeMode: 'manual', manualHome: manual }, {}, root), manual);
    assert.equal(resolveCodexHome({ enabled: true, homeMode: 'manual', manualHome: path.join(root, 'missing') }, {}, root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('short left interaction opens Codex config while long pull keeps monitor behavior', () => {
  const shortClick = new StateMachine();
  shortClick.transition('LEFT_CLICK_TURTLE');
  shortClick.transition('LEFT_RELEASE');
  shortClick.transition('BOUNCE_COMPLETE', { pullExceeded: false });
  assert.equal(shortClick.getState(), 'CODEX_CONFIG_OPENING');
  shortClick.transition('CODEX_CONFIG_OPENED');
  shortClick.transition('CLICK_OUTSIDE');
  shortClick.transition('CODEX_CONFIG_CLOSED');
  assert.equal(shortClick.getState(), 'IDLE');

  const longPull = new StateMachine();
  longPull.transition('LEFT_CLICK_TURTLE');
  longPull.transition('LEFT_RELEASE');
  longPull.transition('BOUNCE_COMPLETE', { pullExceeded: true });
  assert.equal(longPull.getState(), 'EXPANDING');
});

test('Codex overlay presses never start the pet left-click gesture', () => {
  const transitions = [];
  const input = new InputManager({
    pixiApp: {},
    sprite: { x: 100, y: 100, getBounds: () => ({ x: 50, y: 50, width: 100, height: 100 }) },
    stateMachine: {
      getState: () => 'IDLE',
      transition: (...args) => transitions.push(args),
    },
    physics: {},
    shouldIgnoreEvent: () => true,
  });
  input._onMouseDown({ button: 0, clientX: 100, clientY: 100 });
  input._onMouseUp({ button: 0, clientX: 100, clientY: 100 });
  assert.equal(input._isDragging, false);
  assert.deepEqual(transitions, []);
});

test('forced refresh waits for an in-flight enable scan and returns the fresh connection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-scan-'));
  const sessions = path.join(root, 'sessions', '2026', '07', '30');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, 'rollout.jsonl'), rollout([
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 'scan-thread', cwd: root } },
  ]));
  const monitor = new CodexMonitor({
    config: { enabled: false, homeMode: 'manual', manualHome: root },
    onConfigChange: () => {},
  });
  try {
    monitor.updateConfig({ enabled: true, homeMode: 'manual', manualHome: root });
    await Promise.all(Array.from({ length: 25 }, () => monitor.scan(true)));
    const snapshot = monitor.getSnapshot();
    assert.equal(snapshot.enabled, true);
    assert.equal(snapshot.connected, true);
    assert.equal(snapshot.homeLabel, '手动目录');
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
