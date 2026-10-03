import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import {
  buildCodexTurnPermissionOverrides,
  buildCodexTurnReasoningOverrides,
  CodexMonitor,
  parseCodexRollout,
  parseCodexSessionIndex,
  resolveCodexHome,
} from '../src/main/codex-monitor.js';
import { StateMachine } from '../src/renderer/state-machine.js';
import { InputManager, PET_HIT_PADDING, isPointWithinBounds } from '../src/renderer/input.js';
import { PhysicsEngine } from '../src/renderer/physics.js';
import {
  CODEX_ACTIVITY,
  CODEX_CONNECTION,
  CODEX_NEW_MESSAGE_VIEW,
  CODEX_SEND_SHORTCUT,
  buildCodexVisibleTasks,
  cleanCodexUserMessage,
  compactCodexTechnicalPreview,
  codexMoodForActivity,
  normalizeCodexIntegrationConfig,
  normalizeCodexSessionPreference,
  resolveCodexActivity,
  shouldShowCodexConnectionList,
  sortCodexUnreadEvents,
} from '../src/shared/codex-integration.js';
import { CodexMotionController, codexDropLength, codexStatusSymbol } from '../src/renderer/codex-motion.js';
import { canReuseRenderedMessages } from '../src/renderer/codex-companion.js';
import {
  closeCodexTask,
  createCodexViewState,
  openCodexTask,
  reconcileCodexViewState,
} from '../src/renderer/codex-view-state.js';

test('conversation copy keeps stable message nodes and limits selection to message text', () => {
  const companionSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'renderer', 'codex-companion.js'),
    'utf8',
  );
  const cssSource = fs.readFileSync(path.join(process.cwd(), 'src', 'renderer', 'index.css'), 'utf8');
  assert.match(companionSource, /this\.renderedMessageState = new Map\(\)/);
  assert.match(companionSource, /if \(!force && unchanged\)/);
  assert.match(companionSource, /#messageSelectionProtected\(\)/);
  assert.match(companionSource, /this\.messageRenderPending = true/);
  assert.match(cssSource, /\.codex-message-bubble \{ user-select: none; \}/);
  assert.match(cssSource, /\.codex-message-text, \.codex-bubble-empty[\s\S]*user-select: text;/);
});

test('shared agent panel exposes provider-scoped approvals and a direct-only bypass switch', () => {
  const companionSource = fs.readFileSync(path.join(process.cwd(), 'src', 'renderer', 'codex-companion.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(process.cwd(), 'src', 'main', 'preload.js'), 'utf8');
  const mainSource = fs.readFileSync(path.join(process.cwd(), 'src', 'main', 'index.js'), 'utf8');
  const cssSource = fs.readFileSync(path.join(process.cwd(), 'src', 'renderer', 'index.css'), 'utf8');
  assert.match(companionSource, /agent-bypass-permissions/);
  assert.match(companionSource, /this\.#api\(provider\)\.respond/);
  assert.match(companionSource, /const actionableEvent = event\?\.requestId/);
  assert.match(companionSource, /const approvalLike = \['commandApproval', 'fileApproval', 'permissionApproval', 'approval'\]/);
  assert.match(companionSource, /else if \(approvalLike\) this\.#renderOpenCodexAction\(actions\)/);
  assert.match(companionSource, /bypassInput\.disabled = replyTransport === 'desktop'/);
  assert.match(preloadSource, /claude-respond/);
  assert.match(preloadSource, /claude-interrupt/);
  assert.match(mainSource, /ipcMain\.handle\('claude-respond'/);
  assert.match(mainSource, /ipcMain\.handle\('claude-interrupt'/);
  assert.match(cssSource, /\.agent-bypass-warning/);
});

test('Claude conversations expose independent thinking and shared effort controls', () => {
  const companionSource = fs.readFileSync(path.join(process.cwd(), 'src', 'renderer', 'codex-companion.js'), 'utf8');
  const cssSource = fs.readFileSync(path.join(process.cwd(), 'src', 'renderer', 'index.css'), 'utf8');
  assert.match(companionSource, /claude-thinking-trigger/);
  assert.match(companionSource, /sessionPreferences:\s*\{[\s\S]*\[sourceId\]: preference/);
  assert.match(companionSource, /replyTransport !== 'desktop'/);
  assert.match(companionSource, /agent-effort-slider/);
  assert.doesNotMatch(companionSource, /claude-effort-field[^\n]*hidden/);
  assert.match(cssSource, /\.claude-thinking-popover/);
  assert.match(cssSource, /\.agent-effort-slider/);
  assert.match(cssSource, /data-effort=['"]max['"]/);
});

test('conversation render cache is reused only by the same provider-scoped thread', () => {
  const messages = [{ id: 'one', role: 'assistant', message: 'hello' }];
  const previous = { messages, provider: 'codex', locale: 'zh-CN' };
  assert.equal(canReuseRenderedMessages({
    activeThreadId: 'codex:thread-1',
    renderedThreadId: 'codex:thread-1',
    previous,
    messages,
    provider: 'codex',
    locale: 'zh-CN',
  }), true);
  assert.equal(canReuseRenderedMessages({
    activeThreadId: 'codex:thread-2',
    renderedThreadId: 'codex:thread-1',
    previous,
    messages,
    provider: 'codex',
    locale: 'zh-CN',
  }), false);
  assert.equal(canReuseRenderedMessages({
    activeThreadId: 'claude:thread-1',
    renderedThreadId: 'codex:thread-1',
    previous,
    messages,
    provider: 'claude',
    locale: 'zh-CN',
  }), false);
});

test('technical message previews collapse whitespace and bound the summary line', () => {
  assert.equal(compactCodexTechnicalPreview('  tool\n  call\tresult  '), 'tool call result');
  assert.equal(compactCodexTechnicalPreview('', 30), '—');
  const preview = compactCodexTechnicalPreview('x'.repeat(80), 30);
  assert.equal(preview.length, 30);
  assert.ok(preview.endsWith('…'));
});

test('task connection list remains visible in desktop compatible mode', () => {
  assert.equal(shouldShowCodexConnectionList('direct', 1), true);
  assert.equal(shouldShowCodexConnectionList('desktop', 1), true);
  assert.equal(shouldShowCodexConnectionList('desktop', 0), false);
});

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
  assert.equal(normalized.version, 4);
  assert.equal(normalized.homeMode, 'manual');
  assert.equal(normalized.manualHome, 'C:\\Users\\demo\\.codex');
  assert.equal(normalized.replyTransport, 'direct');
  assert.equal(normalized.sendShortcut, CODEX_SEND_SHORTCUT.ENTER);
  assert.equal(normalized.newMessageView, CODEX_NEW_MESSAGE_VIEW.CONVERSATION);
  assert.equal(normalized.readEventIds.length, 1024);
  assert.ok(normalized.enabledAtMs > 0);
  assert.equal(normalizeCodexIntegrationConfig({ replyTransport: 'desktop' }).replyTransport, 'desktop');
  assert.equal(normalizeCodexIntegrationConfig({ replyTransport: 'unknown' }).replyTransport, 'direct');
  assert.equal(normalizeCodexIntegrationConfig({ sendShortcut: 'ctrl-enter' }).sendShortcut, CODEX_SEND_SHORTCUT.CTRL_ENTER);
  assert.equal(normalizeCodexIntegrationConfig({ newMessageView: 'tasks' }).newMessageView, CODEX_NEW_MESSAGE_VIEW.TASK_ACTIVITY);
  assert.equal(normalizeCodexIntegrationConfig({ newMessageView: 'unknown' }).newMessageView, CODEX_NEW_MESSAGE_VIEW.CONVERSATION);
});

test('Codex config updates preserve connection and conversation state across stale concurrent saves', async () => {
  const monitor = new CodexMonitor({
    config: {
      version: 2,
      enabled: false,
      desiredThreadIds: ['kept-thread'],
      readEventIds: ['read-event'],
      notifiedEventIds: ['notified-event'],
      sessionPreferences: { 'thread-a': { effort: 'high' } },
    },
  });
  try {
    monitor.updateConfig({
      ...normalizeCodexIntegrationConfig({ enabled: false }),
      managedReplies: false,
      desiredThreadIds: [],
      readEventIds: [],
      notifiedEventIds: [],
      sessionPreferences: { 'thread-b': { effort: 'low' } },
    });
    const merged = monitor.getConfig();
    assert.deepEqual(merged.desiredThreadIds, ['kept-thread']);
    assert.deepEqual(merged.readEventIds, ['read-event']);
    assert.deepEqual(merged.notifiedEventIds, ['notified-event']);
    assert.deepEqual(merged.sessionPreferences, {
      'thread-a': { effort: 'high' },
      'thread-b': { effort: 'low' },
    });

    monitor.updateConfig({ ...merged, desiredThreadIds: [], readEventIds: [], sessionPreferences: {} }, {
      replacePersistentState: true,
    });
    assert.deepEqual(monitor.getConfig().desiredThreadIds, []);
    assert.deepEqual(monitor.getConfig().readEventIds, []);
    assert.deepEqual(monitor.getConfig().sessionPreferences, {});
    await monitor.scan(true);
  } finally {
    monitor.stop();
  }
});

test('Codex direct turns use on-request approvals unless bypass is enabled', () => {
  assert.deepEqual(buildCodexTurnPermissionOverrides(false), { approvalPolicy: 'on-request' });
  assert.deepEqual(buildCodexTurnPermissionOverrides(true), {
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'dangerFullAccess' },
  });
  assert.equal(normalizeCodexIntegrationConfig({ bypassPermissions: true }).bypassPermissions, true);
});

test('Codex reasoning effort is normalized per session and omitted when inherited', () => {
  assert.deepEqual(normalizeCodexSessionPreference({ effort: 'XHIGH' }), { effort: 'xhigh' });
  assert.deepEqual(normalizeCodexSessionPreference({ effort: 'unsupported' }), { effort: 'inherit' });
  assert.deepEqual(buildCodexTurnReasoningOverrides({ effort: 'inherit' }), {});
  assert.deepEqual(buildCodexTurnReasoningOverrides({ effort: 'max' }), { effort: 'max' });
  const config = normalizeCodexIntegrationConfig({
    sessionPreferences: { threadA: { effort: 'high' }, threadB: { effort: 'invalid' } },
  });
  assert.deepEqual(config.sessionPreferences, {
    threadA: { effort: 'high' },
    threadB: { effort: 'inherit' },
  });
});

test('Codex conversations expose the shared effort slider', () => {
  const companionSource = fs.readFileSync(path.join(process.cwd(), 'src', 'renderer', 'codex-companion.js'), 'utf8');
  const cssSource = fs.readFileSync(path.join(process.cwd(), 'src', 'renderer', 'index.css'), 'utf8');
  assert.match(companionSource, /codex-reasoning-trigger/);
  assert.match(companionSource, /codex-reasoning-popover/);
  assert.match(companionSource, /reasoningModels/);
  assert.match(companionSource, /agent-effort-slider/);
  assert.match(companionSource, /sessionPreferences:\s*\{[\s\S]*\[sourceId\]: preference/);
  assert.match(cssSource, /\.codex-reasoning-trigger/);
  assert.match(cssSource, /\.codex-reasoning-popover/);
  assert.match(cssSource, /\.agent-effort-slider/);
});

test('Codex conversation and settings saves merge against the latest persisted config', () => {
  const companionSource = fs.readFileSync(path.join(process.cwd(), 'src', 'renderer', 'codex-companion.js'), 'utf8');
  assert.match(companionSource, /const current = await this\.#api\('codex'\)\.getConfig\(\)/);
  assert.match(companionSource, /const currentProviderConfig = await this\.#api\(provider\)\.getConfig\(\)/);
  assert.match(companionSource, /const currentCodexConfig = await this\.#api\('codex'\)\.getConfig\(\)/);
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

test('an unread Codex completion keeps the pet happy when its alert presentation is delayed', () => {
  const activity = resolveCodexActivity({
    connected: true,
    tasks: [{ id: 'finished-thread', activity: CODEX_ACTIVITY.SILENT }],
    unread: [{
      id: 'finished-turn',
      threadId: 'finished-thread',
      activity: CODEX_ACTIVITY.READY,
      createdAtMs: 1,
    }],
  });

  assert.equal(activity, CODEX_ACTIVITY.READY);
  assert.equal(codexMoodForActivity(activity, { alertFresh: false }), 'happy');
});

test('Codex App Server activity reads waiting flags during initial and live status sync', async () => {
  const { codexActivityFromThreadStatus } = await import('../src/shared/codex-integration.js');
  assert.equal(typeof codexActivityFromThreadStatus, 'function');
  assert.equal(
    codexActivityFromThreadStatus({ type: 'active', activeFlags: ['waitingOnApproval'] }),
    CODEX_ACTIVITY.NEEDS_INPUT,
  );
  assert.equal(
    codexActivityFromThreadStatus({ type: 'active', activeFlags: ['waitingOnUserInput'] }),
    CODEX_ACTIVITY.NEEDS_INPUT,
  );
  assert.equal(codexActivityFromThreadStatus({ type: 'systemError' }), CODEX_ACTIVITY.BLOCKED);
  assert.equal(
    codexActivityFromThreadStatus({ type: 'systemError', activeFlags: ['waitingOnUserInput'] }),
    CODEX_ACTIVITY.NEEDS_INPUT,
  );
  assert.equal(codexActivityFromThreadStatus({ type: 'active' }), CODEX_ACTIVITY.RUNNING);
  assert.equal(codexActivityFromThreadStatus({ type: 'idle' }), CODEX_ACTIVITY.SILENT);
});

test('opening a task clears every unread event for that task immediately', async () => {
  const { unreadEventsForThread } = await import('../src/renderer/codex-view-state.js');
  assert.equal(typeof unreadEventsForThread, 'function');
  const snapshot = { unread: [
    { id: 'one', threadId: 'codex:thread-a' },
    { id: 'other', threadId: 'codex:thread-b' },
    { id: 'two', threadId: 'codex:thread-a' },
  ] };
  assert.deepEqual(
    unreadEventsForThread(snapshot, 'codex:thread-a').map((event) => event.id),
    ['one', 'two'],
  );
  const source = fs.readFileSync(path.join(process.cwd(), 'src', 'renderer', 'codex-companion.js'), 'utf8');
  const openTask = source.match(/#openTask\(task\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(openTask, /#markThreadRead\(this\.viewState\.threadId\)/);
});

test('connection rows offer retry for an errored Codex thread', async () => {
  const { codexConnectionAction } = await import('../src/renderer/codex-companion.js');
  assert.equal(typeof codexConnectionAction, 'function');
  assert.equal(codexConnectionAction(CODEX_CONNECTION.ERROR), 'retry');
  assert.equal(codexConnectionAction(CODEX_CONNECTION.DISCONNECTED), 'connect');
  assert.equal(codexConnectionAction(CODEX_CONNECTION.CONNECTED), 'disconnect');
  assert.equal(codexConnectionAction(CODEX_CONNECTION.TEMPORARY_READ_ONLY), 'disconnect');
});

test('running motion impulses move the charm turtle instead of touching unused pendulum state', async () => {
  const { applyCodexMotionImpulse } = await import('../src/renderer/codex-motion.js');
  assert.equal(typeof applyCodexMotionImpulse, 'function');
  const physics = new PhysicsEngine();
  physics.enterCharmMode({ turtleX: 100, turtleY: 180, cursor: { x: 100, y: 100 } });
  assert.equal(applyCodexMotionImpulse(physics, 0.22), true);
  assert.equal(physics.pendulumOmega, 0);
  assert.ok(physics.turtle.vx > 0);
  assert.equal(physics.turtle.vy, 0);

  const classic = new PhysicsEngine();
  assert.equal(applyCodexMotionImpulse(classic, -0.22), true);
  assert.equal(classic.pendulumOmega, -0.22);
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

test('a Codex rollout remains running when a long task has no recent log rows', () => {
  const startedAtMs = Date.now() - 6 * 60 * 1000;
  const parsed = parseCodexRollout(rollout([
    { timestamp: new Date(startedAtMs).toISOString(), type: 'session_meta', payload: { id: 'long-running-thread', cwd: 'C:\\work\\app' } },
    { timestamp: new Date(startedAtMs).toISOString(), type: 'event_msg', payload: { type: 'task_started', turn_id: 'long-running-turn' } },
  ]), {
    modifiedAtMs: startedAtMs,
    nowMs: Date.now(),
    enabledAtMs: startedAtMs - 1000,
  });

  assert.equal(parsed.task.activity, CODEX_ACTIVITY.RUNNING);
});

test('Codex rollout with an undated completion does not become unread from the file mtime', () => {
  const nowMs = Date.now();
  const undated = parseCodexRollout(rollout([
    { type: 'session_meta', payload: { id: 'undated-thread', cwd: 'C:\\work\\app' } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'undated-turn' } },
  ]), { modifiedAtMs: nowMs, enabledAtMs: nowMs - 1000 });
  assert.equal(undated.unread, null);

  const dated = parseCodexRollout(rollout([
    { timestamp: new Date(nowMs).toISOString(), type: 'session_meta', payload: { id: 'dated-thread', cwd: 'C:\\work\\app' } },
    { timestamp: new Date(nowMs).toISOString(), type: 'event_msg', payload: { type: 'task_complete', turn_id: 'dated-turn' } },
  ]), { modifiedAtMs: nowMs, enabledAtMs: nowMs - 1000 });
  assert.equal(dated.unread?.id, 'dated-thread:dated-turn:ready');
});

test('second-based Codex timestamps remain ordered after an aborted turn', () => {
  const enabledAtMs = Date.parse('2026-07-31T06:15:00Z');
  const base = [
    { timestamp: '2026-07-31T06:10:00Z', type: 'session_meta', payload: { id: 'seconds-thread', cwd: 'C:\\work\\app' } },
    { timestamp: '2026-07-31T06:11:00Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'old', started_at: 1785478260 } },
    { timestamp: '2026-07-31T06:12:00Z', type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 'old' } },
    { timestamp: '2026-07-31T06:19:45Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'current', started_at: 1785478785 } },
  ];
  const running = parseCodexRollout(rollout(base), {
    modifiedAtMs: Date.parse('2026-07-31T06:20:00Z'),
    nowMs: Date.parse('2026-07-31T06:20:00Z'),
    enabledAtMs,
  });
  assert.equal(running.task.activity, CODEX_ACTIVITY.RUNNING);

  const completed = parseCodexRollout(rollout([...base, {
    timestamp: '2026-07-31T06:25:00Z',
    type: 'event_msg',
    payload: { type: 'task_complete', turn_id: 'current', completed_at: 1785479100, last_agent_message: '最终总结' },
  }]), { modifiedAtMs: Date.parse('2026-07-31T06:25:00Z'), enabledAtMs });
  assert.equal(completed.unread?.message, '最终总结');
  assert.equal(completed.unread?.createdAtMs, 1785479100000);
});

test('Codex rollout keeps tool calls and tool results in chronological messages', () => {
  const parsed = parseCodexRollout(rollout([
    { timestamp: '2026-07-31T01:00:00Z', type: 'session_meta', payload: { id: 'tools-thread', cwd: 'C:\\work\\app' } },
    { timestamp: '2026-07-31T01:00:01Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '准备检查' }] } },
    { timestamp: '2026-07-31T01:00:02Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: '{"command":"npm test"}' } },
    { timestamp: '2026-07-31T01:00:03Z', type: 'response_item', payload: { type: 'custom_tool_call_output', output: [{ type: 'input_text', text: '94 tests passed' }] } },
    { timestamp: '2026-07-31T01:00:04Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '最终总结' }] } },
  ]));
  assert.deepEqual(parsed.task.messages.map(({ role, kind }) => [role, kind]), [
    ['assistant', 'message'],
    ['tool', 'tool-call'],
    ['tool', 'tool-result'],
    ['assistant', 'message'],
  ]);
  assert.match(parsed.task.messages[1].message, /npm test/);
  assert.match(parsed.task.messages[2].message, /94 tests passed/);
  assert.equal(parsed.task.messages.at(-1).message, '最终总结');
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

  const rightClick = new StateMachine();
  rightClick.transition('RIGHT_CLICK_TURTLE');
  rightClick.transition('RIGHT_CLICK_RELEASE', { returnState: 'IDLE' });
  assert.equal(rightClick.getState(), 'IDLE');

  const panelRightClick = new StateMachine('PANEL_OPEN');
  panelRightClick.transition('RIGHT_CLICK_TURTLE');
  panelRightClick.transition('RIGHT_CLICK_RELEASE', { returnState: 'PANEL_OPEN' });
  assert.equal(panelRightClick.getState(), 'PANEL_OPEN');
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

test('pet hit testing keeps a forgiving edge for stable left and right clicks', () => {
  const bounds = { x: 50, y: 50, width: 100, height: 100 };
  assert.equal(isPointWithinBounds(bounds, 50 - PET_HIT_PADDING, 100, PET_HIT_PADDING), true);
  assert.equal(isPointWithinBounds(bounds, 49 - PET_HIT_PADDING, 100, PET_HIT_PADDING), false);

  const input = new InputManager({
    pixiApp: {},
    sprite: { getBounds: () => bounds },
    stateMachine: {},
    physics: {},
  });
  assert.equal(input._isOverSprite(50 - PET_HIT_PADDING, 100), true);
});

test('a pet press can close an open follow panel without swallowing the same click', () => {
  let state = 'CODEX_CONFIG_OPEN';
  const transitions = [];
  const previousWindow = globalThis.window;
  globalThis.window = { electronAPI: { setIgnoreMouseEvents: () => {}, showContextMenu: () => {} } };
  const input = new InputManager({
    pixiApp: {},
    sprite: { x: 100, y: 100, getBounds: () => ({ x: 50, y: 50, width: 100, height: 100 }) },
    stateMachine: {
      getState: () => state,
      transition: (event) => {
        transitions.push(event);
        if (event === 'LEFT_CLICK_TURTLE') state = 'PULLING';
      },
    },
    physics: { screenAnchorX: 0.5, startDrag: () => {} },
    beforePetInteraction: () => { state = 'IDLE'; },
  });
  try {
    input._onMouseDown({ button: 0, clientX: 100, clientY: 100 });
    assert.equal(state, 'PULLING');
    state = 'CODEX_CONFIG_OPEN';
    input._onMouseDown({ button: 2, clientX: 100, clientY: 100, preventDefault: () => {} });
    assert.deepEqual(transitions, ['LEFT_CLICK_TURTLE', 'RIGHT_CLICK_TURTLE']);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
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

test('Codex session index keeps the latest desktop title for each task', () => {
  const titles = parseCodexSessionIndex([
    JSON.stringify({ id: 'thread-1', thread_name: '旧标题', updated_at: '2026-07-31T06:10:22Z' }),
    JSON.stringify({ id: 'thread-1', thread_name: 'Codex 客户端最终标题', updated_at: '2026-07-31T06:10:39Z' }),
    JSON.stringify({ id: 'thread-2', thread_name: '另一个任务', updated_at: '2026-07-31T06:10:30Z' }),
  ].join('\n'));
  assert.equal(titles.get('thread-1').title, 'Codex 客户端最终标题');
  assert.equal(titles.get('thread-2').title, '另一个任务');
});

test('desktop session index title overrides the rollout prompt title', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-title-'));
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 'title-thread.jsonl'), `${rollout([
    { timestamp: '2026-07-31T06:10:00Z', type: 'session_meta', payload: { id: 'title-thread', cwd: root } },
    { timestamp: '2026-07-31T06:10:01Z', type: 'event_msg', payload: { type: 'user_message', message: '一段很长的原始用户消息标题' } },
  ])}\n`);
  fs.writeFileSync(path.join(root, 'session_index.jsonl'), [
    JSON.stringify({ id: 'title-thread', thread_name: '旧客户端标题', updated_at: '2026-07-31T06:10:22Z' }),
    JSON.stringify({ id: 'title-thread', thread_name: 'Codex 当前窗口标题', updated_at: '2026-07-31T06:10:39Z' }),
  ].join('\n'));
  const monitor = new CodexMonitor({
    config: { version: 2, enabled: true, homeMode: 'manual', manualHome: root },
  });
  try {
    await monitor.scan(true);
    assert.equal(
      monitor.getSnapshot().tasks.find((task) => task.id === 'title-thread').title,
      'Codex 当前窗口标题',
    );
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
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

test('a zero-unread task opened from the connection list survives refreshes until explicitly closed', () => {
  const task = { id: 'thread-stable', title: '稳定详情', project: 'app', activity: CODEX_ACTIVITY.RUNNING };
  let view = openCodexTask(createCodexViewState(), task);
  assert.equal(view.eventId, 'task:thread-stable');
  assert.equal(view.event.kind, 'task');
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

test('an active task detail immediately promotes a same-thread approval request', () => {
  const task = { id: 'thread-approval', title: 'Current task', project: 'app', activity: CODEX_ACTIVITY.RUNNING };
  const approval = {
    id: 'approval-1',
    threadId: 'thread-approval',
    title: 'Current task',
    activity: CODEX_ACTIVITY.NEEDS_INPUT,
    kind: 'commandApproval',
    requestId: 'request-1',
    supported: true,
  };
  const view = reconcileCodexViewState(openCodexTask(createCodexViewState(), task), {
    tasks: [{ ...task, activity: CODEX_ACTIVITY.NEEDS_INPUT }],
    visibleTasks: [],
    unread: [approval],
    alerts: [approval],
  });
  assert.equal(view.mode, 'manual');
  assert.equal(view.eventId, 'approval-1');
  assert.equal(view.event.requestId, 'request-1');
  assert.equal(view.event.kind, 'commandApproval');
});

test('an open notification follows the current Codex task title after a rename', () => {
  const event = {
    id: 'rename-alert',
    threadId: 'thread-rename',
    title: '旧标题',
    message: '保留通知正文',
  };
  const view = reconcileCodexViewState(createCodexViewState(), {
    alerts: [event],
    unread: [event],
    tasks: [{ id: 'thread-rename', title: 'Codex 当前标题' }],
  });
  assert.equal(view.event.title, 'Codex 当前标题');
  assert.equal(view.event.message, '保留通知正文');
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

test('official lifecycle hooks correlate by session and turn and report a neutral stop', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-hooks-'));
  const sessions = path.join(root, 'sessions', '2026', '10', '02');
  const userDataPath = path.join(root, 'user-data');
  fs.mkdirSync(sessions, { recursive: true });
  const startedAt = Date.now() - 10_000;
  const completedAt = Date.now();
  fs.writeFileSync(path.join(sessions, 'thread-hook.jsonl'), `${rollout([
    { timestamp: new Date(startedAt).toISOString(), type: 'session_meta', payload: {
      id: 'thread-hook', session_id: 'session-hook', cwd: root,
    } },
    { timestamp: new Date(startedAt).toISOString(), type: 'event_msg', payload: {
      type: 'task_started', turn_id: 'turn-hook',
    } },
  ])}\n`);
  const monitor = new CodexMonitor({
    config: {
      version: 4, enabled: true, enabledAtMs: startedAt - 1000,
      homeMode: 'manual', manualHome: root,
    },
    userDataPath,
    runtimeSessionsReader: async () => [],
    hookEventsReader: async () => [{
      session_id: 'session-hook',
      turn_id: 'turn-hook',
      hook_event_name: 'Stop',
      timestamp: new Date(completedAt).toISOString(),
    }],
  });
  try {
    await monitor.scan(true);
    const snapshot = monitor.getSnapshot();
    assert.equal(snapshot.tasks.find((task) => task.id === 'thread-hook')?.activity, CODEX_ACTIVITY.SILENT);
    assert.equal(snapshot.unread[0]?.activity, CODEX_ACTIVITY.READY);
    assert.match(snapshot.unread[0]?.message || '', /没有提供可判定成功或失败/);
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Stop hook does not duplicate a rollout terminal result for the same turn', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-hook-dedup-'));
  const sessions = path.join(root, 'sessions', '2026', '10', '03');
  fs.mkdirSync(sessions, { recursive: true });
  const startedAt = Date.now() - 5000;
  const completedAt = Date.now() - 1000;
  const stoppedAt = Date.now();
  fs.writeFileSync(path.join(sessions, 'thread-hook-dedup.jsonl'), `${rollout([
    { timestamp: new Date(startedAt).toISOString(), type: 'session_meta', payload: {
      id: 'thread-hook-dedup', session_id: 'session-hook-dedup', cwd: root,
    } },
    { timestamp: new Date(startedAt).toISOString(), type: 'event_msg', payload: {
      type: 'task_started', turn_id: 'turn-hook-dedup',
    } },
    { timestamp: new Date(completedAt).toISOString(), type: 'event_msg', payload: {
      type: 'task_complete', turn_id: 'turn-hook-dedup', completed_at: completedAt,
    } },
  ])}\n`);
  const monitor = new CodexMonitor({
    config: {
      version: 4, enabled: true, enabledAtMs: startedAt - 1000,
      homeMode: 'manual', manualHome: root,
    },
    userDataPath: path.join(root, 'user-data'),
    runtimeSessionsReader: async () => [],
    hookEventsReader: async () => [{
      session_id: 'session-hook-dedup',
      turn_id: 'turn-hook-dedup',
      hook_event_name: 'Stop',
      timestamp: new Date(stoppedAt).toISOString(),
    }],
  });
  try {
    await monitor.scan(true);
    const snapshot = monitor.getSnapshot();
    assert.equal(snapshot.tasks.find((task) => task.id === 'thread-hook-dedup')?.activity, CODEX_ACTIVITY.SILENT);
    assert.equal(snapshot.unread.length, 1);
    assert.notEqual(snapshot.unread[0]?.kind, 'turn-ended');
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tool activity clears permission waits, late tool hooks cannot revive a stopped turn, and a new turn runs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-hook-permission-'));
  const sessions = path.join(root, 'sessions', '2026', '10', '02');
  fs.mkdirSync(sessions, { recursive: true });
  const startedAt = Date.now() - 10_000;
  const rolloutPath = path.join(sessions, 'thread-permission.jsonl');
  fs.writeFileSync(rolloutPath, `${rollout([
    { timestamp: new Date(startedAt).toISOString(), type: 'session_meta', payload: {
      id: 'thread-permission', session_id: 'session-permission', cwd: root,
    } },
    { timestamp: new Date(startedAt).toISOString(), type: 'event_msg', payload: {
      type: 'task_started', turn_id: 'turn-permission',
    } },
  ])}\n`);
  const permissionAt = Date.now() - 7000;
  const toolStartedAt = Date.now() - 6000;
  const interruptAt = Date.now() - 5000;
  const stopAt = Date.now() - 4500;
  const newTurnAt = Date.now() - 4000;
  const delayedToolAt = Date.now() - 3000;
  let events = [{
    session_id: 'session-permission',
    turn_id: 'turn-permission',
    hook_event_name: 'PermissionRequest',
    timestamp: new Date(permissionAt).toISOString(),
  }];
  const monitor = new CodexMonitor({
    config: {
      version: 4, enabled: true, enabledAtMs: startedAt - 1000,
      homeMode: 'manual', manualHome: root,
    },
    userDataPath: path.join(root, 'user-data'),
    runtimeSessionsReader: async () => [],
    hookEventsReader: async () => events,
  });
  try {
    await monitor.scan(true);
    assert.equal(monitor.getSnapshot().tasks.find((task) => task.id === 'thread-permission')?.activity, CODEX_ACTIVITY.NEEDS_INPUT);
    assert.equal(monitor.getSnapshot().unread.length, 1);

    fs.appendFileSync(rolloutPath, `${rollout([{
      timestamp: new Date(Date.now() - 6500).toISOString(),
      type: 'turn_context',
      payload: { cwd: root, model: 'test-model' },
    }])}\n`);
    await monitor.scan(true);
    assert.equal(monitor.getSnapshot().tasks.find((task) => task.id === 'thread-permission')?.activity, CODEX_ACTIVITY.NEEDS_INPUT);
    assert.equal(monitor.getSnapshot().unread.length, 1);

    const tiedPreToolUse = {
      session_id: 'session-permission',
      turn_id: 'turn-permission',
      hook_event_name: 'PreToolUse',
      timestamp: new Date(permissionAt).toISOString(),
      tool_name: 'Bash',
    };
    events = [...events, tiedPreToolUse];
    await monitor.scan(true);
    assert.equal(monitor.getSnapshot().tasks.find((task) => task.id === 'thread-permission')?.activity, CODEX_ACTIVITY.NEEDS_INPUT);
    events.reverse();
    await monitor.scan(true);
    assert.equal(monitor.getSnapshot().tasks.find((task) => task.id === 'thread-permission')?.activity, CODEX_ACTIVITY.NEEDS_INPUT);
    assert.equal(monitor.getSnapshot().unread.length, 1);

    events = [...events, {
      session_id: 'session-permission',
      turn_id: 'turn-permission',
      hook_event_name: 'PreToolUse',
      timestamp: new Date(toolStartedAt).toISOString(),
      tool_name: 'Bash',
      tool_input: { command: 'never persist this' },
    }];
    await monitor.scan(true);
    assert.equal(monitor.getSnapshot().tasks.find((task) => task.id === 'thread-permission')?.activity, CODEX_ACTIVITY.RUNNING);
    assert.equal(monitor.getSnapshot().unread.length, 0);

    const tiedPermissionAndPostToolUse = [
      {
        session_id: 'session-permission',
        turn_id: 'turn-permission',
        hook_event_name: 'PermissionRequest',
        timestamp: new Date(toolStartedAt).toISOString(),
      },
      {
        session_id: 'session-permission',
        turn_id: 'turn-permission',
        hook_event_name: 'PostToolUse',
        timestamp: new Date(toolStartedAt).toISOString(),
      },
    ];
    events = [...events, ...tiedPermissionAndPostToolUse];
    await monitor.scan(true);
    assert.equal(monitor.getSnapshot().tasks.find((task) => task.id === 'thread-permission')?.activity, CODEX_ACTIVITY.RUNNING);
    events.reverse();
    await monitor.scan(true);
    assert.equal(monitor.getSnapshot().tasks.find((task) => task.id === 'thread-permission')?.activity, CODEX_ACTIVITY.RUNNING);

    events = [...events, {
      session_id: 'session-permission',
      turn_id: 'turn-permission',
      hook_event_name: 'Interrupt',
      timestamp: new Date(interruptAt).toISOString(),
    }, {
      session_id: 'session-permission',
      turn_id: 'turn-permission',
      hook_event_name: 'Stop',
      timestamp: new Date(stopAt).toISOString(),
    }, {
      session_id: 'session-permission',
      turn_id: 'turn-permission',
      hook_event_name: 'PostToolUse',
      timestamp: new Date(delayedToolAt).toISOString(),
      tool_name: 'Bash',
      tool_output: 'never persist this',
    }];
    await monitor.scan(true);
    assert.equal(monitor.getSnapshot().tasks.find((task) => task.id === 'thread-permission')?.activity, CODEX_ACTIVITY.BLOCKED);
    assert.equal(monitor.getSnapshot().unread.length, 1);
    assert.equal(monitor.getSnapshot().unread[0]?.kind, 'interrupted');

    events = [...events, {
      session_id: 'session-permission',
      turn_id: 'turn-next',
      hook_event_name: 'UserPromptSubmit',
      timestamp: new Date(newTurnAt).toISOString(),
    }];
    await monitor.scan(true);
    assert.equal(monitor.getSnapshot().tasks.find((task) => task.id === 'thread-permission')?.activity, CODEX_ACTIVITY.RUNNING);
    assert.equal(monitor.getSnapshot().unread.length, 0);
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('new prompt hook supersedes an older rollout completion and resumes running state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-prompt-hook-'));
  const sessions = path.join(root, 'sessions', '2026', '10', '02');
  fs.mkdirSync(sessions, { recursive: true });
  const oldFinish = Date.now() - 60_000;
  const submittedAt = Date.now();
  fs.writeFileSync(path.join(sessions, 'thread-prompt.jsonl'), `${rollout([
    { timestamp: new Date(oldFinish - 10_000).toISOString(), type: 'session_meta', payload: {
      id: 'thread-prompt', session_id: 'session-prompt', cwd: root,
    } },
    { timestamp: new Date(oldFinish - 10_000).toISOString(), type: 'event_msg', payload: {
      type: 'task_started', turn_id: 'turn-old',
    } },
    { timestamp: new Date(oldFinish).toISOString(), type: 'event_msg', payload: {
      type: 'task_complete', turn_id: 'turn-old', completed_at: oldFinish,
    } },
  ])}\n`);
  const monitor = new CodexMonitor({
    config: {
      version: 4, enabled: true, enabledAtMs: submittedAt - 1000,
      homeMode: 'manual', manualHome: root,
    },
    userDataPath: path.join(root, 'user-data'),
    runtimeSessionsReader: async () => [],
    hookEventsReader: async () => [{
      session_id: 'session-prompt',
      turn_id: 'turn-new',
      hook_event_name: 'UserPromptSubmit',
      timestamp: new Date(submittedAt).toISOString(),
    }],
  });
  try {
    await monitor.scan(true);
    const snapshot = monitor.getSnapshot();
    assert.equal(snapshot.tasks.find((task) => task.id === 'thread-prompt')?.activity, CODEX_ACTIVITY.RUNNING);
    assert.equal(snapshot.unread.some((event) => event.turnId === 'turn-old'), false);
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Codex monitor installs its global hooks on enable and removes only them on disable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-hook-config-'));
  const userDataPath = path.join(root, 'user-data');
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  const monitor = new CodexMonitor({
    config: {
      version: 4,
      enabled: true,
      enabledAtMs: Date.now() - 1000,
      managedReplies: false,
      homeMode: 'manual',
      manualHome: root,
    },
    userDataPath,
    hookScriptPath: path.resolve('src/main/codex-hooks.mjs'),
    nodeExecutablePath: process.execPath,
    runtimeSessionsReader: async () => [],
  });
  try {
    monitor.start();
    await monitor.hookSyncPromise;
    const hooksPath = path.join(root, 'hooks.json');
    const installed = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    assert.ok(installed.hooks.UserPromptSubmit.length);
    assert.ok(installed.hooks.PreToolUse.length);
    assert.ok(installed.hooks.PostToolUse.length);
    assert.ok(installed.hooks.Stop.length);

    monitor.updateConfig({ enabled: false });
    await monitor.hookSyncPromise;
    const removed = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    assert.deepEqual(removed.hooks, {});
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Codex state database restores a quiet rollout outside the recent-file scan window', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-state-discovery-'));
  const sessionsRoot = path.join(root, 'sessions', '2026', '10', '02');
  fs.mkdirSync(sessionsRoot, { recursive: true });
  const nowMs = Date.now();
  let targetPath = '';
  for (let index = 0; index <= 120; index += 1) {
    const rolloutPath = path.join(sessionsRoot, `rollout-${index}.jsonl`);
    fs.writeFileSync(rolloutPath, `${rollout([
      { timestamp: new Date(nowMs - index * 10_000).toISOString(), type: 'session_meta', payload: {
        id: `thread-${index}`, session_id: `session-${index}`, cwd: root,
      } },
      ...(index === 120 ? [{
        timestamp: new Date(nowMs - index * 10_000).toISOString(),
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'quiet-old-turn' },
      }] : []),
    ])}\n`);
    const fileTime = new Date(index === 120 ? nowMs - 48 * 60 * 60 * 1000 : nowMs - index * 10_000);
    fs.utimesSync(rolloutPath, fileTime, fileTime);
    if (index === 120) targetPath = rolloutPath;
  }
  const monitor = new CodexMonitor({
    config: { version: 4, enabled: true, homeMode: 'manual', manualHome: root },
    runtimeSessionsReader: async () => [{
      id: 'thread-120',
      rolloutPath: targetPath,
      updatedAtMs: nowMs,
    }],
    hookEventsReader: async () => [],
  });
  try {
    await monitor.scan(true);
    const restored = monitor.getSnapshot().tasks.find((task) => task.id === 'thread-120');
    assert.equal(restored?.activity, CODEX_ACTIVITY.RUNNING);
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('existing running task accepts a window reply through turn steer when its active turn is known', async () => {
  class FakeAppServer extends EventEmitter {
    calls = [];
    async connect() {}
    async request(method, params) {
      this.calls.push({ method, params });
      if (method === 'thread/list') return { data: [], nextCursor: null };
      if (method === 'thread/resume') return {
        thread: {
          id: 'running-connect',
          status: { type: 'active' },
          name: 'Connected task',
          turns: [{ id: 'turn-live', status: { type: 'inProgress' }, items: [] }],
        },
      };
      if (method === 'turn/steer') return {};
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
  const server = new FakeAppServer();
  const monitor = new CodexMonitor({
    config: { version: 2, enabled: true, homeMode: 'manual', manualHome: root },
    appServerFactory: () => server,
  });
  try {
    await monitor.scan(true);
    await monitor.connectThread('running-connect');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(monitor.getSnapshot().tasks[0].connectionState, CODEX_CONNECTION.CONNECTED);
    const result = await monitor.reply('running-connect', '追加说明');
    assert.equal(result.mode, 'steer');
    assert.equal(server.calls.find((call) => call.method === 'turn/steer')?.params.expectedTurnId, 'turn-live');
    assert.equal(server.calls.find((call) => call.method === 'turn/steer')?.params.input[0].text, '追加说明');
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('idle direct replies reload the App Server so desktop compaction state is fresh', async () => {
  class FakeAppServer extends EventEmitter {
    calls = [];
    stopped = false;
    constructor(index) {
      super();
      this.index = index;
    }
    async connect() {}
    async request(method, params) {
      this.calls.push({ method, params });
      if (method === 'thread/list') return { data: [], nextCursor: null };
      if (method === 'model/list') return { data: [{ model: 'gpt-test', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }] };
      if (method === 'thread/resume') return {
        thread: { id: 'compacted-thread', status: { type: 'idle' }, name: 'Compacted task', turns: [] },
      };
      if (method === 'turn/start') return { turn: { id: 'fresh-turn' } };
      return {};
    }
    stop() { this.stopped = true; }
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-fresh-reply-'));
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 'idle.jsonl'), `${rollout([
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 'compacted-thread', cwd: root } },
  ])}\n`);
  const servers = [];
  const monitor = new CodexMonitor({
    config: { version: 4, enabled: true, homeMode: 'manual', manualHome: root, sessionPreferences: { 'compacted-thread': { effort: 'high' } } },
    appServerFactory: () => {
      const server = new FakeAppServer(servers.length);
      servers.push(server);
      return server;
    },
  });
  try {
    await monitor.scan(true);
    await monitor.connectThread('compacted-thread');
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const state = monitor.getSnapshot().tasks.find((task) => task.id === 'compacted-thread')?.connectionState;
      if (state === CODEX_CONNECTION.CONNECTED) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const result = await monitor.reply('compacted-thread', 'use the compacted state');
    assert.equal(result.mode, 'turn');
    assert.equal(result.turnId, 'fresh-turn');
    assert.equal(servers.length, 2);
    assert.equal(servers[0].stopped, true);
    assert.ok(servers[1].calls.some((call) => call.method === 'thread/resume'));
    assert.equal(servers[1].calls.find((call) => call.method === 'turn/start')?.params.input[0].text, 'use the compacted state');
    assert.equal(servers[1].calls.find((call) => call.method === 'turn/start')?.params.effort, 'high');
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pending approvals stay actionable, strip null permission grants, and allow interrupting the turn', async () => {
  class FakeAppServer extends EventEmitter {
    calls = [];
    responses = [];
    async connect() {}
    async request(method, params) {
      this.calls.push({ method, params });
      if (method === 'thread/list') return { data: [], nextCursor: null };
      if (method === 'thread/resume') return {
        thread: {
          id: 'approval-thread',
          status: { type: 'active' },
          turns: [{ id: 'approval-turn', status: { type: 'inProgress' }, items: [] }],
        },
      };
      return {};
    }
    sendServerResponse(id, result) { this.responses.push({ id, result }); }
    stop() {}
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-approval-'));
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 'approval.jsonl'), `${rollout([
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 'approval-thread', cwd: root } },
  ])}\n`);
  const server = new FakeAppServer();
  const monitor = new CodexMonitor({
    config: { version: 3, enabled: true, homeMode: 'manual', manualHome: root },
    appServerFactory: () => server,
  });
  try {
    await monitor.scan(true);
    await monitor.connectThread('approval-thread');
    await new Promise((resolve) => setTimeout(resolve, 0));
    server.emit('server-request', {
      id: 'approval-request',
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 'approval-thread',
        turnId: 'approval-turn',
        itemId: 'item-1',
        permissions: { network: { enabled: true }, fileSystem: null },
      },
    });
    const pending = monitor.getSnapshot().unread.find((event) => event.requestId === 'approval-request');
    assert.ok(pending);
    assert.equal(monitor.getSnapshot().tasks.find((task) => task.id === 'approval-thread')?.capabilities.interrupt, true);
    monitor.markRead(pending.id);
    assert.ok(monitor.getSnapshot().unread.some((event) => event.id === pending.id));

    await monitor.respond('approval-request', { decision: 'accept' });
    assert.deepEqual(server.responses, [{
      id: 'approval-request',
      result: { permissions: { network: { enabled: true } }, scope: 'turn' },
    }]);
    assert.equal(monitor.getSnapshot().unread.some((event) => event.id === pending.id), false);

    server.emit('server-request', {
      id: 'legacy-request',
      method: 'execCommandApproval',
      params: {
        conversationId: 'approval-thread',
        callId: 'legacy-call',
        command: ['npm.cmd', 'test'],
        reason: 'run checks',
      },
    });
    const legacy = monitor.getSnapshot().unread.find((event) => event.requestId === 'legacy-request');
    assert.equal(legacy?.kind, 'commandApproval');
    assert.match(legacy?.message || '', /run checks/);
    await monitor.respond('legacy-request', { decision: 'acceptForSession' });
    assert.deepEqual(server.responses.at(-1), {
      id: 'legacy-request',
      result: { decision: 'approved_for_session' },
    });

    const interrupted = await monitor.interrupt('approval-thread');
    assert.deepEqual(interrupted, {
      interrupted: true,
      threadId: 'approval-thread',
      turnId: 'approval-turn',
    });
    assert.deepEqual(server.calls.find((call) => call.method === 'turn/interrupt')?.params, {
      threadId: 'approval-thread',
      turnId: 'approval-turn',
    });
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('desktop reply transport never writes through a second App Server', async () => {
  class FakeAppServer extends EventEmitter {
    calls = [];
    async connect() {}
    async request(method, params) {
      this.calls.push({ method, params });
      if (method === 'thread/list') return { data: [], nextCursor: null };
      return {};
    }
    stop() {}
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-desktop-reply-'));
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 'desktop.jsonl'), `${rollout([
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 'desktop-reply', cwd: root } },
    { timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'agent_message', message: 'ready' } },
  ])}\n`);
  const server = new FakeAppServer();
  let factoryCalls = 0;
  const monitor = new CodexMonitor({
    config: {
      version: 2,
      enabled: true,
      homeMode: 'manual',
      manualHome: root,
      managedReplies: true,
      replyTransport: 'desktop',
      desiredThreadIds: ['desktop-reply'],
    },
    appServerFactory: () => {
      factoryCalls += 1;
      return server;
    },
  });
  try {
    await monitor.scan(true);
    monitor.start();
    assert.equal(factoryCalls, 0);
    assert.equal(monitor.clientRetryTimer, null);
    const task = monitor.getSnapshot().tasks.find((item) => item.id === 'desktop-reply');
    assert.equal(task?.capabilities.reply, true);
    const result = await monitor.reply('desktop-reply', '客户端发送这条消息');
    assert.deepEqual(result, {
      accepted: true,
      mode: 'desktop-submit',
      openDesktop: true,
      threadId: 'desktop-reply',
    });
    assert.deepEqual(server.calls, []);
    assert.equal(monitor.getSnapshot().tasks.find((item) => item.id === 'desktop-reply')?.connectionState, CODEX_CONNECTION.DISCONNECTED);
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('saved running connections automatically recover an active turn after startup', async () => {
  class FakeAppServer extends EventEmitter {
    async connect() {}
    async request(method) {
      if (method === 'thread/list') return {
        data: [{ id: 'running-auto', updatedAt: Date.now(), status: { type: 'active' } }],
        nextCursor: null,
      };
      if (method === 'thread/resume') return {
        thread: {
          id: 'running-auto',
          status: { type: 'active' },
          turns: [{ id: 'turn-auto', status: { type: 'inProgress' }, items: [] }],
        },
      };
      return {};
    }
    stop() {}
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-auto-connect-'));
  fs.mkdirSync(path.join(root, 'sessions'));
  const monitor = new CodexMonitor({
    config: {
      version: 2,
      enabled: true,
      homeMode: 'manual',
      manualHome: root,
      managedReplies: true,
      desiredThreadIds: ['running-auto'],
    },
    appServerFactory: () => new FakeAppServer(),
  });
  try {
    monitor.start();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (monitor.getSnapshot().tasks.find((task) => task.id === 'running-auto')?.connectionState === CODEX_CONNECTION.CONNECTED) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const task = monitor.getSnapshot().tasks.find((item) => item.id === 'running-auto');
    assert.equal(task?.connectionState, CODEX_CONNECTION.CONNECTED);
    assert.equal(task?.activity, CODEX_ACTIVITY.RUNNING);
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

    server.emit('notification', {
      method: 'turn/started',
      params: { threadId: 'error-thread', turn: { id: 'recovery-turn' } },
    });
    const recovered = monitor.getSnapshot();
    assert.equal(recovered.activity, CODEX_ACTIVITY.RUNNING);
    assert.equal(recovered.unread.filter((event) => event.activity === CODEX_ACTIVITY.BLOCKED).length, 0);
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

test('App Server catalog keeps waiting-on-input tasks out of the running state', async () => {
  class FakeAppServer extends EventEmitter {
    async connect() {}
    async request(method) {
      if (method === 'thread/list') return {
        data: [{
          id: 'waiting-catalog',
          updatedAt: Date.now(),
          status: { type: 'active', activeFlags: ['waitingOnApproval'] },
        }],
        nextCursor: null,
      };
      return {};
    }
    stop() {}
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-waiting-catalog-'));
  fs.mkdirSync(path.join(root, 'sessions'));
  const monitor = new CodexMonitor({
    config: { version: 2, enabled: true, homeMode: 'manual', manualHome: root },
    appServerFactory: () => new FakeAppServer(),
  });
  try {
    monitor.start();
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (monitor.getSnapshot().tasks.some((task) => task.id === 'waiting-catalog')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(
      monitor.getSnapshot().tasks.find((task) => task.id === 'waiting-catalog')?.activity,
      CODEX_ACTIVITY.NEEDS_INPUT,
    );
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('temporary read-only Codex connections retry and recover the active turn automatically', async () => {
  class FakeAppServer extends EventEmitter {
    calls = [];
    async connect() {}
    async request(method, params) {
      this.calls.push({ method, params });
      if (method === 'thread/resume') return {
        thread: {
          id: 'retry-running',
          status: { type: 'active' },
          turns: [{ id: 'retry-turn', status: { type: 'inProgress' }, items: [] }],
        },
      };
      return {};
    }
    stop() {}
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-retry-'));
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 'retry.jsonl'), `${rollout([
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 'retry-running', cwd: root } },
    { timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'task_started', turn_id: 'retry-turn' } },
  ])}\n`);
  const server = new FakeAppServer();
  const monitor = new CodexMonitor({
    config: {
      version: 2,
      enabled: true,
      homeMode: 'manual',
      manualHome: root,
      desiredThreadIds: ['retry-running'],
    },
    appServerFactory: () => server,
  });
  try {
    monitor.pollIntervalMs = 1;
    monitor.client = server;
    monitor.clientReady = true;
    monitor.catalogSynced = true;
    monitor.connectionStates.set('retry-running', {
      state: CODEX_CONNECTION.TEMPORARY_READ_ONLY,
      error: 'active turn id not available yet',
      retryAtMs: 0,
    });
    await monitor.scan(true);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (monitor.getSnapshot().tasks.find((task) => task.id === 'retry-running')?.connectionState === CODEX_CONNECTION.CONNECTED) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(server.calls.some((call) => call.method === 'thread/resume'));
    assert.equal(
      monitor.getSnapshot().tasks.find((task) => task.id === 'retry-running')?.connectionState,
      CODEX_CONNECTION.CONNECTED,
    );
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resuming a waiting App Server task preserves needs-input activity', async () => {
  class FakeAppServer extends EventEmitter {
    async connect() {}
    async request(method) {
      if (method === 'thread/list') return {
        data: [{ id: 'waiting-resume', updatedAt: Date.now(), status: { type: 'active' } }],
        nextCursor: null,
      };
      if (method === 'thread/resume') return {
        thread: {
          id: 'waiting-resume',
          status: { type: 'active', activeFlags: ['waitingOnApproval'] },
          turns: [{ id: 'waiting-turn', status: { type: 'inProgress' }, items: [] }],
        },
      };
      return {};
    }
    stop() {}
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-waiting-resume-'));
  fs.mkdirSync(path.join(root, 'sessions'));
  const monitor = new CodexMonitor({
    config: { version: 2, enabled: true, homeMode: 'manual', manualHome: root },
    appServerFactory: () => new FakeAppServer(),
  });
  try {
    monitor.start();
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (monitor.getSnapshot().tasks.some((task) => task.id === 'waiting-resume')) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await monitor.connectThread('waiting-resume');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      monitor.getSnapshot().tasks.find((task) => task.id === 'waiting-resume')?.activity,
      CODEX_ACTIVITY.NEEDS_INPUT,
    );
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('App Server history fallback timestamps preserve turn order', async () => {
  class FakeAppServer extends EventEmitter {
    async connect() {}
    async request(method, params) {
      if (method === 'thread/list') return {
        data: [{ id: 'ordered-history', updatedAt: Date.now(), status: { type: 'notLoaded' } }],
        nextCursor: null,
      };
      if (method === 'thread/read' && params.threadId === 'ordered-history') return {
        thread: {
          id: 'ordered-history',
          updatedAt: Date.now(),
          turns: [
            { items: [
              { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: '第一轮问题' }] },
              { id: 'a1', type: 'agentMessage', text: '第一轮回答' },
            ] },
            { items: [
              { id: 'u2', type: 'userMessage', content: [{ type: 'text', text: '第二轮问题' }] },
              { id: 'a2', type: 'agentMessage', text: '第二轮回答' },
            ] },
          ],
        },
      };
      if (method === 'thread/resume') return { thread: { id: 'seed-history', status: { type: 'idle' } } };
      return {};
    }
    stop() {}
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-history-order-'));
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 'seed.jsonl'), `${rollout([
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 'seed-history', cwd: root } },
  ])}\n`);
  const monitor = new CodexMonitor({
    config: { version: 2, enabled: true, homeMode: 'manual', manualHome: root },
    appServerFactory: () => new FakeAppServer(),
  });
  try {
    await monitor.scan(true);
    await monitor.connectThread('seed-history');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const page = await monitor.getMessages('ordered-history', { limit: 50 });
    assert.deepEqual(page.messages.map((message) => message.message), [
      '第一轮问题', '第一轮回答', '第二轮问题', '第二轮回答',
    ]);
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('App Server active state stays authoritative over an idle local rollout', async () => {
  class FakeAppServer extends EventEmitter {
    async connect() {}
    async request(method) {
      if (method === 'thread/list') return {
        data: [{ id: 'overlap', name: 'Live task', updatedAt: 1785479000, status: { type: 'active' } }],
        nextCursor: null,
      };
      if (method === 'thread/resume') return { thread: { id: 'overlap', status: { type: 'active' } } };
      if (method === 'thread/read') return { thread: { id: 'overlap', status: { type: 'active' }, turns: [] } };
      return {};
    }
    stop() {}
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-overlap-'));
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 'overlap.jsonl'), `${rollout([
    { timestamp: '2026-07-31T06:10:00Z', type: 'session_meta', payload: { id: 'overlap', cwd: root } },
    { timestamp: '2026-07-31T06:11:00Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'done' } },
    { timestamp: '2026-07-31T06:12:00Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'done' } },
  ])}\n`);
  const monitor = new CodexMonitor({
    config: { version: 2, enabled: true, homeMode: 'manual', manualHome: root },
    appServerFactory: () => new FakeAppServer(),
  });
  try {
    await monitor.scan(true);
    await monitor.connectThread('overlap');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const task = monitor.getSnapshot().tasks.find((item) => item.id === 'overlap');
    assert.equal(task.activity, CODEX_ACTIVITY.RUNNING);
    assert.equal(monitor.getSnapshot().runningCount, 1);
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a recent local completion wins over a stale active App Server catalog entry', async () => {
  class FakeAppServer extends EventEmitter {
    async connect() {}
    async request(method) {
      if (method === 'thread/list') return {
        data: [{ id: 'finished-local', name: 'Finished locally', updatedAt: Date.parse('2026-07-31T06:10:00Z') / 1000, status: { type: 'active' } }],
        nextCursor: null,
      };
      if (method === 'thread/resume') return { thread: { id: 'finished-local', status: { type: 'idle' } } };
      return {};
    }
    stop() {}
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-finished-local-'));
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 'finished-local.jsonl'), `${rollout([
    { timestamp: '2026-07-31T06:10:00Z', type: 'session_meta', payload: { id: 'finished-local', cwd: root } },
    { timestamp: '2026-07-31T06:11:00Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-done' } },
    { timestamp: '2026-07-31T06:12:00Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-done' } },
  ])}\n`);
  const monitor = new CodexMonitor({
    config: { version: 2, enabled: true, homeMode: 'manual', manualHome: root },
    appServerFactory: () => new FakeAppServer(),
  });
  try {
    await monitor.scan(true);
    await monitor.connectThread('finished-local');
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (monitor.getSnapshot().tasks.find((task) => task.id === 'finished-local')?.connectionState === CODEX_CONNECTION.CONNECTED) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(
      monitor.getSnapshot().tasks.find((task) => task.id === 'finished-local')?.activity,
      CODEX_ACTIVITY.SILENT,
    );
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a late active status does not revive a completed App Server turn', async () => {
  class FakeAppServer extends EventEmitter {
    async connect() {}
    async request(method) {
      if (method === 'thread/resume') return { thread: { status: { type: 'idle' } } };
      return {};
    }
    stop() {}
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-completion-race-'));
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 'completion-race.jsonl'), `${rollout([
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 'completion-race', cwd: root } },
  ])}\n`);
  const server = new FakeAppServer();
  const monitor = new CodexMonitor({
    config: { version: 2, enabled: true, homeMode: 'manual', manualHome: root },
    appServerFactory: () => server,
  });
  try {
    await monitor.scan(true);
    await monitor.connectThread('completion-race');
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (monitor.getSnapshot().tasks.find((task) => task.id === 'completion-race')?.connectionState === CODEX_CONNECTION.CONNECTED) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const completionEmittedAtMs = Date.now();
    server.emit('notification', {
      method: 'turn/started',
      params: { threadId: 'completion-race', turn: { id: 'turn-race' } },
    });
    server.emit('notification', {
      method: 'turn/completed',
      params: { threadId: 'completion-race', turn: { id: 'turn-race', status: 'completed' } },
    });
    server.emit('notification', {
      method: 'thread/status/changed',
      params: { threadId: 'completion-race', status: { type: 'active' } },
    });
    assert.equal(
      monitor.getSnapshot().tasks.find((task) => task.id === 'completion-race')?.activity,
      CODEX_ACTIVITY.SILENT,
    );

    server.emit('notification', {
      method: 'turn/completed',
      emittedAtMs: completionEmittedAtMs - 6_000,
      params: { threadId: 'completion-race', turn: { id: 'turn-next', status: 'completed' } },
    });
    server.emit('notification', {
      method: 'thread/status/changed',
      params: { threadId: 'completion-race', status: { type: 'active' } },
    });
    assert.equal(
      monitor.getSnapshot().tasks.find((task) => task.id === 'completion-race')?.activity,
      CODEX_ACTIVITY.SILENT,
    );

    server.emit('notification', {
      method: 'turn/completed',
      emittedAtMs: completionEmittedAtMs + 30,
      params: { threadId: 'completion-race', turn: { id: 'turn-next', status: 'completed' } },
    });
    server.emit('notification', {
      method: 'turn/started',
      emittedAtMs: completionEmittedAtMs + 40,
      params: { threadId: 'completion-race', turn: { id: 'turn-following' } },
    });
    assert.equal(
      monitor.getSnapshot().tasks.find((task) => task.id === 'completion-race')?.activity,
      CODEX_ACTIVITY.RUNNING,
    );
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('desired Codex connections and conversation preferences survive monitor recreation', async () => {
  class FakeAppServer extends EventEmitter {
    calls = [];
    async connect() {}
    async request(method) {
      this.calls.push(method);
      if (method === 'thread/list') return {
        data: [{ id: 'persisted-thread', updatedAt: Date.now(), status: { type: 'idle' } }],
        nextCursor: null,
      };
      if (method === 'thread/resume') return { thread: { id: 'persisted-thread', status: { type: 'idle' } } };
      return {};
    }
    stop() {}
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-monitor-codex-persist-'));
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 'persisted-thread.jsonl'), `${rollout([
    { timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: 'persisted-thread', cwd: root } },
  ])}\n`);
  let savedConfig = {
    version: 2,
    enabled: true,
    homeMode: 'manual',
    manualHome: root,
    sessionPreferences: { 'persisted-thread': { effort: 'high' } },
  };
  const servers = [];
  const makeMonitor = () => new CodexMonitor({
    config: savedConfig,
    onConfigChange: (config) => { savedConfig = config; },
    appServerFactory: () => {
      const server = new FakeAppServer();
      servers.push(server);
      return server;
    },
  });
  const waitUntilConnected = async (monitor) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (monitor.getSnapshot().tasks.find((task) => task.id === 'persisted-thread')?.connectionState === CODEX_CONNECTION.CONNECTED) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const first = makeMonitor();
  try {
    await first.scan(true);
    await first.connectThread('persisted-thread');
    await waitUntilConnected(first);
    assert.ok(savedConfig.desiredThreadIds.includes('persisted-thread'));
    first.stop();

    const reopened = makeMonitor();
    try {
      reopened.start();
      await waitUntilConnected(reopened);
      assert.ok(savedConfig.desiredThreadIds.includes('persisted-thread'));
      assert.equal(savedConfig.sessionPreferences['persisted-thread'].effort, 'high');
      assert.ok(servers.at(-1).calls.includes('thread/resume'), servers.at(-1).calls.join(', '));
      assert.equal(
        reopened.getSnapshot().tasks.find((task) => task.id === 'persisted-thread')?.connectionState,
        CODEX_CONNECTION.CONNECTED,
      );
    } finally {
      reopened.stop();
    }
  } finally {
    first.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
