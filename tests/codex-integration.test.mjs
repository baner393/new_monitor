import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import { CodexMonitor, parseCodexRollout, resolveCodexHome } from '../src/main/codex-monitor.js';
import { StateMachine } from '../src/renderer/state-machine.js';
import { InputManager } from '../src/renderer/input.js';
import {
  CODEX_ACTIVITY,
  CODEX_CONNECTION,
  buildCodexVisibleTasks,
  cleanCodexUserMessage,
  codexMoodForActivity,
  normalizeCodexIntegrationConfig,
  resolveCodexActivity,
  sortCodexUnreadEvents,
} from '../src/shared/codex-integration.js';
import { CodexMotionController, codexDropLength, codexStatusSymbol } from '../src/renderer/codex-motion.js';
import {
  closeCodexTask,
  createCodexViewState,
  openCodexTask,
  reconcileCodexViewState,
} from '../src/renderer/codex-view-state.js';

function rollout(lines) {
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

test('Codex config is portable, versioned and bounds persisted read events', () => {
  const normalized = normalizeCodexIntegrationConfig({
    enabled: true,
    homeMode: 'manual',
    manualHome: ' C:\\Users\\demo\\.codex ',
    readEventIds: [...Array.from({ length: 1100 }, (_, index) => `event-${index}`), 'event-1099'],
  });
  assert.equal(normalized.version, 2);
  assert.equal(normalized.homeMode, 'manual');
  assert.equal(normalized.manualHome, 'C:\\Users\\demo\\.codex');
  assert.equal(normalized.readEventIds.length, 1024);
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
  assert.equal(parsed.unread.canReply, false);
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

test('Codex parser removes internal scaffolding and keeps only real user-facing roles', () => {
  const wrapped = `<recommended_plugins>internal English list</recommended_plugins>\n# AGENTS.md instructions\n<INSTRUCTIONS>hidden rules</INSTRUCTIONS>\n<environment_context>hidden machine data</environment_context>\n请修复这个问题`;
  assert.equal(cleanCodexUserMessage(wrapped), '请修复这个问题');
  const parsed = parseCodexRollout(rollout([
    { timestamp: '2026-07-31T01:00:00Z', type: 'session_meta', payload: { id: 'filtered', cwd: 'D:\\work\\app' } },
    { timestamp: '2026-07-31T01:00:01Z', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'internal developer English' }] } },
    { timestamp: '2026-07-31T01:00:02Z', type: 'event_msg', payload: { type: 'user_message', message: wrapped } },
    { timestamp: '2026-07-31T01:00:03Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: wrapped }] } },
    { timestamp: '2026-07-31T01:00:04Z', type: 'event_msg', payload: { type: 'agent_message', message: '已经修复。' } },
  ]));
  assert.equal(parsed.task.title, '请修复这个问题');
  assert.deepEqual(parsed.task.messages.map((message) => message.message), ['请修复这个问题', '已经修复。']);
});

test('internal Codex approval-review tasks never become user conversations', () => {
  const parsed = parseCodexRollout(rollout([
    {
      timestamp: '2026-07-31T01:00:00Z',
      type: 'session_meta',
      payload: {
        id: 'guardian-thread',
        parent_thread_id: 'parent-thread',
        source: { subagent: { other: 'guardian' } },
      },
    },
    { timestamp: '2026-07-31T01:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: 'internal approval transcript' } },
  ]));
  assert.equal(parsed, null);
});

test('manually opened Codex detail survives fifty snapshots and only explicit close clears it', () => {
  const task = { id: 'thread-stable', title: '稳定详情', project: 'app', activity: CODEX_ACTIVITY.RUNNING };
  let view = openCodexTask(createCodexViewState(), task);
  for (let index = 0; index < 50; index++) {
    view = reconcileCodexViewState(view, {
      tasks: [{ ...task, activity: index > 20 ? CODEX_ACTIVITY.SILENT : CODEX_ACTIVITY.RUNNING }],
      visibleTasks: [],
      unread: [],
      alerts: [],
    });
    assert.equal(view.mode, 'manual');
    assert.equal(view.threadId, 'thread-stable');
  }
  assert.equal(closeCodexTask().mode, 'closed');
});

test('notification detail remains visible after its event is resolved', () => {
  const event = { id: 'alert-1', threadId: 'thread-1', title: '等待批准', activity: CODEX_ACTIVITY.NEEDS_INPUT, requestId: '7' };
  let view = reconcileCodexViewState(createCodexViewState(), { alerts: [event], unread: [event], tasks: [] });
  assert.equal(view.mode, 'notification');
  view = reconcileCodexViewState(view, {
    alerts: [], unread: [], tasks: [{ id: 'thread-1', title: '等待批准', activity: CODEX_ACTIVITY.RUNNING }],
  });
  assert.equal(view.mode, 'notification');
  assert.equal(view.event.requestId, null);
});

test('a new alert never replaces the task currently being read', () => {
  const first = { id: 'alert-first', threadId: 'thread-1', title: 'First', message: 'keep me', activity: CODEX_ACTIVITY.READY };
  const second = { id: 'alert-second', threadId: 'thread-1', title: 'Second', message: 'queue me', activity: CODEX_ACTIVITY.BLOCKED };
  let view = reconcileCodexViewState(createCodexViewState(), { alerts: [first], unread: [first], tasks: [] });
  view = reconcileCodexViewState(view, {
    alerts: [second],
    unread: [second],
    tasks: [{ id: 'thread-1', title: 'Thread', activity: CODEX_ACTIVITY.SILENT }],
  });
  assert.equal(view.eventId, 'alert-first');
  assert.equal(view.event.message, 'keep me');
});

test('quiet child tasks are grouped under their parent while actionable children stay visible', () => {
  const summary = buildCodexVisibleTasks([
    { id: 'parent', activity: CODEX_ACTIVITY.SILENT, updatedAtMs: 4 },
    { id: 'child-running', parentThreadId: 'parent', activity: CODEX_ACTIVITY.RUNNING, updatedAtMs: 5 },
    { id: 'child-input', parentThreadId: 'parent', activity: CODEX_ACTIVITY.NEEDS_INPUT, updatedAtMs: 6 },
  ], [{ id: 'input', threadId: 'child-input', activity: CODEX_ACTIVITY.NEEDS_INPUT, createdAtMs: 6 }]);
  assert.equal(summary.visibleTasks.some((task) => task.threadId === 'child-running'), false);
  assert.equal(summary.visibleTasks.some((task) => task.threadId === 'child-input'), true);
  assert.equal(summary.visibleTasks.find((task) => task.threadId === 'parent').runningChildren, 1);
});

test('running motion injects alternating physical impulses and respects reduced motion', () => {
  const motion = new CodexMotionController();
  motion.setState(CODEX_ACTIVITY.RUNNING, 'run');
  const impulses = [];
  let maxRotation = 0;
  for (let index = 0; index < 180; index++) {
    const frame = motion.update(0.05, { enabled: true, petHeight: 64, baseY: 150, viewportHeight: 600 });
    if (frame.pendulumImpulse) impulses.push(frame.pendulumImpulse);
    maxRotation = Math.max(maxRotation, Math.abs(frame.rotation));
  }
  assert.ok(impulses.length >= 2);
  assert.ok(impulses.some((value) => value > 0));
  assert.ok(impulses.some((value) => value < 0));
  assert.ok(maxRotation > 0.06);
  const reduced = motion.update(0.05, { enabled: true, reducedMotion: true });
  assert.equal(reduced.pendulumImpulse, 0);
  assert.equal(reduced.rotation, 0);
});

test('Codex monitor reuses unchanged files, reads only appended bytes and paginates messages', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-cache-'));
  const sessions = path.join(root, 'sessions', '2026', '07', '31');
  const file = path.join(sessions, 'rollout.jsonl');
  fs.mkdirSync(sessions, { recursive: true });
  const initial = `${rollout([
    { timestamp: '2026-07-31T01:00:00Z', type: 'session_meta', payload: { id: 'cache-thread', cwd: root } },
    ...Array.from({ length: 55 }, (_, index) => ({
      timestamp: `2026-07-31T01:00:${String(index % 60).padStart(2, '0')}Z`,
      type: 'event_msg',
      payload: { type: index % 2 ? 'agent_message' : 'user_message', message: `message-${index}` },
    })),
  ])}\n`;
  fs.writeFileSync(file, initial);
  const monitor = new CodexMonitor({ config: { version: 2, enabled: true, homeMode: 'manual', manualHome: root } });
  try {
    await monitor.scan(true);
    const first = monitor.getDiagnostics();
    await Promise.all(Array.from({ length: 25 }, () => monitor.scan(true)));
    const unchanged = monitor.getDiagnostics();
    assert.equal(unchanged.bytesRead, first.bytesRead);
    assert.equal(unchanged.filesParsed, first.filesParsed);

    const appended = `${rollout([
      { timestamp: '2026-07-31T01:01:00Z', type: 'event_msg', payload: { type: 'agent_message', message: 'appended-message' } },
      { timestamp: '2026-07-31T01:02:00Z', type: 'event_msg', payload: { type: 'user_message', message: 'message-0' } },
    ])}\n`;
    fs.appendFileSync(file, appended);
    await monitor.scan(true);
    const changed = monitor.getDiagnostics();
    assert.equal(changed.bytesRead - unchanged.bytesRead, Buffer.byteLength(appended));
    const latest = await monitor.getMessages('cache-thread', { limit: 50 });
    assert.equal(latest.messages.length, 50);
    assert.ok(latest.nextCursor);
    const older = await monitor.getMessages('cache-thread', { cursor: latest.nextCursor, limit: 50 });
    assert.ok(older.messages.length > 0);
    assert.equal(latest.messages.at(-1).message, 'message-0');
    assert.equal([...older.messages, ...latest.messages].filter((message) => message.message === 'message-0').length, 2);
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('existing running task waits for idle before a managed connection can resume it', async () => {
  class FakeAppServer extends EventEmitter {
    async connect() {}
    async request(method) {
      if (method === 'thread/resume') return { thread: { status: { type: 'idle' }, name: 'Connected task' } };
      return {};
    }
    stop() {}
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-connect-'));
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 'running.jsonl'), `${rollout([
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 'running-connect', cwd: root } },
    { timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-live' } },
  ])}\n`);
  const monitor = new CodexMonitor({
    config: { version: 2, enabled: true, homeMode: 'manual', manualHome: root },
    appServerFactory: () => new FakeAppServer(),
  });
  try {
    await monitor.scan(true);
    await monitor.connectThread('running-connect');
    assert.equal(monitor.getSnapshot().tasks[0].connectionState, CODEX_CONNECTION.WAITING_IDLE);
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('App Server system errors become one clear blocked notification', async () => {
  class FakeAppServer extends EventEmitter {
    async connect() {}
    async request(method) {
      if (method === 'thread/resume') return { thread: { status: { type: 'idle' }, name: 'Error task' } };
      return {};
    }
    stop() {}
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-error-'));
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 'idle.jsonl'), `${rollout([
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 'error-thread', cwd: root } },
  ])}\n`);
  const server = new FakeAppServer();
  const monitor = new CodexMonitor({
    config: { version: 2, enabled: true, homeMode: 'manual', manualHome: root },
    appServerFactory: () => server,
  });
  try {
    await monitor.scan(true);
    await monitor.connectThread('error-thread');
    await new Promise((resolve) => setTimeout(resolve, 0));
    server.emit('notification', {
      method: 'thread/status/changed',
      params: { threadId: 'error-thread', status: { type: 'systemError', message: 'provider stopped' } },
    });
    const snapshot = monitor.getSnapshot();
    assert.equal(snapshot.activity, CODEX_ACTIVITY.BLOCKED);
    assert.equal(snapshot.unread.filter((event) => event.kind === 'failed').length, 1);
    assert.equal(snapshot.unread.find((event) => event.kind === 'failed').message, 'provider stopped');
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('App Server catalog adds older tasks and hydrates their messages only on demand', async () => {
  class FakeAppServer extends EventEmitter {
    async connect() {}
    async request(method, params) {
      if (method === 'thread/list') {
        return {
          data: [{ id: 'catalog-only', name: 'Older named task', preview: 'old preview', updatedAt: 10, status: { type: 'notLoaded' } }],
          nextCursor: null,
        };
      }
      if (method === 'thread/read' && params.threadId === 'catalog-only') {
        return { thread: { id: 'catalog-only', turns: [{
          startedAt: 20,
          items: [
            { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '历史问题' }] },
            { id: 'agent-1', type: 'agentMessage', text: '历史回答' },
          ],
        }] } };
      }
      if (method === 'thread/resume') return { thread: { status: { type: 'idle' } } };
      return {};
    }
    stop() {}
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-catalog-'));
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 'seed.jsonl'), `${rollout([
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 'seed-thread', cwd: root } },
  ])}\n`);
  const monitor = new CodexMonitor({
    config: { version: 2, enabled: true, homeMode: 'manual', manualHome: root },
    appServerFactory: () => new FakeAppServer(),
  });
  try {
    await monitor.scan(true);
    await monitor.connectThread('seed-thread');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(monitor.getSnapshot().tasks.some((task) => task.id === 'catalog-only' && task.title === 'Older named task'));
    const page = await monitor.getMessages('catalog-only', { limit: 50 });
    assert.deepEqual(page.messages.map((message) => message.message), ['历史问题', '历史回答']);
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
