import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import {
  buildClaudeDirectArgs,
  ClaudeMonitor,
  formatClaudeManagedError,
  parseClaudeTranscript,
  resolveClaudeHome,
} from '../src/main/claude-monitor.js';
import {
  claudeVsCodeUri,
  launchClaudeTerminalSession,
  resolveClaudeIdeTarget,
  submitClaudeClientClipboard,
} from '../src/main/claude-client-bridge.js';
import {
  CLAUDE_ACTIVITY,
  CLAUDE_REPLY_TRANSPORT,
  CLAUDE_SEND_SHORTCUT,
  normalizeClaudeIntegrationConfig,
} from '../src/shared/claude-integration.js';
import { combineProviderSnapshots } from '../src/renderer/codex-companion.js';

function transcript(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n');
}

test('Claude configuration is portable and bounds persisted state', () => {
  const config = normalizeClaudeIntegrationConfig({
    enabled: true,
    homeMode: 'manual',
    manualHome: ' C:\\Users\\demo\\.claude ',
    replyTransport: 'desktop',
    desiredSessionIds: ['one', 'one', 'two'],
    readEventIds: Array.from({ length: 1100 }, (_, index) => `event-${index}`),
  });
  assert.equal(config.version, 2);
  assert.equal(config.manualHome, 'C:\\Users\\demo\\.claude');
  assert.equal(config.replyTransport, CLAUDE_REPLY_TRANSPORT.DESKTOP);
  assert.equal(config.sendShortcut, CLAUDE_SEND_SHORTCUT.ENTER);
  assert.deepEqual(config.desiredSessionIds, ['one', 'two']);
  assert.equal(config.readEventIds.length, 1024);
  assert.ok(config.enabledAtMs > 0);
});

test('Claude send shortcut defaults to Enter and preserves Ctrl+Enter selection', () => {
  assert.equal(normalizeClaudeIntegrationConfig({}).sendShortcut, CLAUDE_SEND_SHORTCUT.ENTER);
  assert.equal(
    normalizeClaudeIntegrationConfig({ sendShortcut: 'ctrl-enter' }).sendShortcut,
    CLAUDE_SEND_SHORTCUT.CTRL_ENTER,
  );
});

test('Claude transcript keeps user, thinking, tools, result and full final answer', () => {
  const parsed = parseClaudeTranscript(transcript([
    { type: 'user', sessionId: 'session-one', cwd: 'C:\\work\\demo', timestamp: '2026-08-01T01:00:00Z', message: { content: '请检查项目' } },
    { type: 'assistant', sessionId: 'session-one', timestamp: '2026-08-01T01:00:01Z', message: { content: [
      { type: 'thinking', thinking: '正在分析' },
      { type: 'tool_use', id: 'tool-one', name: 'Bash', input: { command: 'npm test' } },
    ] } },
    { type: 'user', sessionId: 'session-one', timestamp: '2026-08-01T01:00:02Z', message: { content: [
      { type: 'tool_result', tool_use_id: 'tool-one', content: 'tests passed' },
    ] } },
    { type: 'assistant', sessionId: 'session-one', uuid: 'final-one', timestamp: '2026-08-01T01:00:03Z', message: { stop_reason: 'end_turn', content: [
      { type: 'text', text: '检查完成，全部测试通过。' },
    ] } },
  ]), {
    filePath: 'C:\\fake\\session-one.jsonl',
    enabledAtMs: Date.parse('2026-08-01T00:00:00Z'),
  });
  assert.equal(parsed.task.id, 'session-one');
  assert.equal(parsed.task.project, 'demo');
  assert.equal(parsed.task.activity, CLAUDE_ACTIVITY.SILENT);
  assert.deepEqual(parsed.task.messages.map(({ role, kind }) => [role, kind]), [
    ['user', 'message'],
    ['tool', 'thinking'],
    ['tool', 'tool-call'],
    ['tool', 'tool-result'],
    ['assistant', 'message'],
  ]);
  assert.equal(parsed.unread.activity, CLAUDE_ACTIVITY.READY);
  assert.equal(parsed.unread.message, '检查完成，全部测试通过。');
});

test('Claude AskUserQuestion is exposed as a needs-input event', () => {
  const parsed = parseClaudeTranscript(transcript([
    { type: 'user', sessionId: 'question-session', timestamp: '2026-08-01T01:00:00Z', message: { content: '开始' } },
    { type: 'assistant', sessionId: 'question-session', timestamp: '2026-08-01T01:00:01Z', message: { content: [{
      type: 'tool_use', id: 'question-one', name: 'AskUserQuestion', input: {
        questions: [{ id: 'choice', question: '选择模式', options: [{ label: 'A' }, { label: 'B' }] }],
      },
    }] } },
  ]));
  assert.equal(parsed.task.activity, CLAUDE_ACTIVITY.NEEDS_INPUT);
  assert.equal(parsed.unread.kind, 'question');
  assert.equal(parsed.unread.questions[0].question, '选择模式');
});

test('Claude tool activity after a previous turn does not emit repeated completion events', () => {
  const completedRows = [
    { type: 'user', sessionId: 'tool-chain', timestamp: '2026-08-01T01:00:00Z', message: { content: 'first' } },
    { type: 'assistant', sessionId: 'tool-chain', uuid: 'first-final', timestamp: '2026-08-01T01:00:01Z', message: {
      stop_reason: 'end_turn', content: [{ type: 'text', text: 'first done' }],
    } },
  ];
  const completed = parseClaudeTranscript(transcript(completedRows), {
    enabledAtMs: Date.parse('2026-08-01T00:00:00Z'),
  });
  assert.match(completed.unread.id, /first-final:ready$/);

  const running = parseClaudeTranscript(transcript([
    ...completedRows,
    { type: 'user', sessionId: 'tool-chain', uuid: 'second-user', timestamp: '2026-08-01T01:01:00Z', message: { content: 'second' } },
    { type: 'assistant', sessionId: 'tool-chain', uuid: 'second-thinking', timestamp: '2026-08-01T01:01:01Z', message: {
      stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'working' }],
    } },
    { type: 'assistant', sessionId: 'tool-chain', uuid: 'second-tool', timestamp: '2026-08-01T01:01:02Z', message: {
      stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'call-two', name: 'Bash', input: { command: 'npm test' } }],
    } },
    { type: 'user', sessionId: 'tool-chain', uuid: 'second-result', timestamp: '2026-08-01T01:01:03Z', message: {
      content: [{ type: 'tool_result', tool_use_id: 'call-two', content: 'ok' }],
    } },
  ]), {
    enabledAtMs: Date.parse('2026-08-01T00:00:00Z'),
    nowMs: Date.parse('2026-08-01T01:01:04Z'),
  });
  assert.equal(running.task.activity, CLAUDE_ACTIVITY.RUNNING);
  assert.equal(running.unread, null);
});

test('Claude completion identity remains stable when turn-duration metadata is appended', () => {
  const rows = [
    { type: 'user', sessionId: 'stable-complete', timestamp: '2026-08-01T01:00:00Z', message: { content: 'work' } },
    { type: 'assistant', sessionId: 'stable-complete', uuid: 'stable-final', timestamp: '2026-08-01T01:00:01Z', message: {
      stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }],
    } },
  ];
  const options = { enabledAtMs: Date.parse('2026-08-01T00:00:00Z') };
  const before = parseClaudeTranscript(transcript(rows), options);
  const after = parseClaudeTranscript(transcript([
    ...rows,
    { type: 'system', subtype: 'turn_duration', sessionId: 'stable-complete', uuid: 'duration-row', timestamp: '2026-08-01T01:00:02Z' },
  ]), options);
  assert.equal(after.unread.id, before.unread.id);
});

test('old or acknowledged Claude failures do not keep the pet blocked forever', () => {
  const text = transcript([
    { type: 'user', sessionId: 'failed-session', timestamp: '2026-07-01T01:00:00Z', message: { content: '运行' } },
    { type: 'system', subtype: 'api_error', sessionId: 'failed-session', timestamp: '2026-07-01T01:00:01Z', error: 'offline' },
  ]);
  const old = parseClaudeTranscript(text, { enabledAtMs: Date.parse('2026-08-01T00:00:00Z') });
  assert.equal(old.unread, null);
  assert.equal(old.task.activity, CLAUDE_ACTIVITY.SILENT);
  const fresh = parseClaudeTranscript(text, { enabledAtMs: Date.parse('2026-07-01T00:00:00Z') });
  const acknowledged = parseClaudeTranscript(text, {
    enabledAtMs: Date.parse('2026-07-01T00:00:00Z'),
    readEventIds: new Set([fresh.unread.id]),
  });
  assert.equal(acknowledged.unread, null);
  assert.equal(acknowledged.task.activity, CLAUDE_ACTIVITY.SILENT);
});

test('Claude home resolution honors manual and environment directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-claude-home-'));
  try {
    assert.equal(resolveClaudeHome({ enabled: true, homeMode: 'manual', manualHome: root }), path.resolve(root));
    assert.equal(resolveClaudeHome({ enabled: true }, { CLAUDE_CONFIG_DIR: root }, os.tmpdir()), path.resolve(root));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Claude VS Code target and URI preserve the exact session and prompt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-claude-ide-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(path.join(root, 'ide'), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(root, 'ide', 'active.lock'), JSON.stringify({
    pid: process.pid,
    ideName: 'Cursor',
    workspaceFolders: [workspace],
  }));
  try {
    const target = resolveClaudeIdeTarget(root, path.join(workspace, 'child'));
    assert.equal(target.scheme, 'cursor');
    assert.equal(target.pid, process.pid);
    assert.equal(resolveClaudeIdeTarget(root, path.join(root, 'different-workspace')), null);
    const uri = claudeVsCodeUri({ sessionId: 'session / 中文', prompt: '继续 修复', scheme: target.scheme });
    assert.equal(uri, 'cursor://anthropic.claude-code/open?session=session+%2F+%E4%B8%AD%E6%96%87&prompt=%E7%BB%A7%E7%BB%AD+%E4%BF%AE%E5%A4%8D');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Claude client bridge carries focus, paste and shortcut controls', async () => {
  let invocation;
  const result = await submitClaudeClientClipboard({
    processId: 42,
    paste: false,
    shortcut: 'ctrl-enter',
    preferForeground: true,
    focusDelayMs: 125,
    execFileImpl: (executable, args, options, callback) => {
      invocation = { executable, args, options };
      callback(null, JSON.stringify({ submitted: true, processId: 42, submitMethod: 'ctrl-enter' }), '');
    },
  });
  assert.equal(result.submitted, true);
  assert.equal(invocation.options.env.MONITOR_CLAUDE_PROCESS_ID, '42');
  assert.equal(invocation.options.env.MONITOR_CLAUDE_PASTE, '0');
  assert.equal(invocation.options.env.MONITOR_CLAUDE_SHORTCUT, 'ctrl-enter');
  assert.equal(invocation.options.env.MONITOR_CLAUDE_PREFER_FOREGROUND, '1');
  assert.equal(invocation.options.env.MONITOR_CLAUDE_FOCUS_DELAY_MS, '125');
});

test('Claude terminal launcher resumes the same session with the prompt', () => {
  let invocation;
  const child = { pid: 73, unrefCalled: false, unref() { this.unrefCalled = true; } };
  const result = launchClaudeTerminalSession({
    executable: 'claude', cwd: 'C:\\work', sessionId: 'session-one', prompt: '继续',
    spawnImpl: (executable, args, options) => { invocation = { executable, args, options }; return child; },
  });
  assert.deepEqual(invocation.args, ['--resume', 'session-one', '继续']);
  assert.equal(invocation.options.detached, true);
  assert.equal(child.unrefCalled, true);
  assert.equal(result.processId, 73);
});

test('Claude Monitor direct mode resumes the selected local session', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-claude-direct-'));
  const project = path.join(root, 'projects', 'demo');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'direct-session.jsonl'), transcript([
    { type: 'user', sessionId: 'direct-session', cwd: root, timestamp: new Date().toISOString(), message: { content: '第一条消息' } },
  ]));
  let invocation;
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = () => {};
  const monitor = new ClaudeMonitor({
    config: { enabled: true, homeMode: 'manual', manualHome: root, enabledAtMs: Date.now() - 1000 },
    spawnImpl: (executable, args, options) => {
      invocation = { executable, args, options };
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  try {
    await monitor.scan(true);
    const cachedParse = monitor.fileCache.get(path.join(project, 'direct-session.jsonl'))?.parsed;
    await monitor.scan(true);
    assert.equal(monitor.fileCache.get(path.join(project, 'direct-session.jsonl'))?.parsed, cachedParse);
    monitor.connectSession('direct-session');
    const result = await monitor.reply('direct-session', '继续处理');
    assert.equal(result.accepted, true);
    assert.equal(result.mode, 'turn-start');
    assert.ok(invocation.args.includes('--resume'));
    assert.ok(invocation.args.includes('direct-session'));
    assert.equal(invocation.args.at(-1), '继续处理');
    assert.equal(invocation.options.cwd, root);
  } finally {
    monitor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Claude direct arguments inherit gateway thinking settings instead of overriding effort', () => {
  assert.deepEqual(buildClaudeDirectArgs({
    sessionId: 'session-one', message: 'continue', permissionMode: 'plan', effort: 'max',
  }), [
    '-p', '--resume', 'session-one', '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages', '--permission-mode', 'plan', 'continue',
  ]);
  const args = buildClaudeDirectArgs({
    sessionId: 'session-one', message: 'continue', permissionMode: 'unexpected', effort: 'turbo',
  });
  assert.equal(args.includes('--permission-mode'), false);
  assert.equal(args.includes('--effort'), false);
});

test('Claude transcript exposes the session permission, effort and model', () => {
  const parsed = parseClaudeTranscript(transcript([
    { type: 'user', sessionId: 'metadata-session', cwd: 'C:\\work', timestamp: '2026-08-03T01:00:00Z', message: { content: 'work' } },
    { type: 'assistant', sessionId: 'metadata-session', permissionMode: 'acceptEdits', effort: 'high', timestamp: '2026-08-03T01:00:01Z', message: {
      model: 'gateway-model', stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }],
    } },
  ]));
  assert.equal(parsed.task.permissionMode, 'acceptEdits');
  assert.equal(parsed.task.effort, 'high');
  assert.equal(parsed.task.model, 'gateway-model');
});

test('Claude managed errors are readable and redact API keys', () => {
  const message = formatClaudeManagedError('API Error: 400 unsupported effort; sk-ant-secretvalue', {
    effort: 'max', retried: true,
  });
  assert.match(message, /400/);
  assert.match(message, /low/);
  assert.doesNotMatch(message, /secretvalue/);
});

test('Claude managed errors identify gateway thinking-type incompatibility', () => {
  const message = formatClaudeManagedError("API Error: 400 'type' must be in [\"enabled\", \"disabled\", \"auto\"]");
  assert.match(message, /thinking/);
  assert.match(message, /停止覆盖推理强度/);
});

test('combined task snapshots retain provider identity and priority', () => {
  const snapshot = combineProviderSnapshots({
    codex: {
      configured: true, enabled: true, connected: true, activity: 'running', updatedAtMs: 1,
      tasks: [{ id: 'same', title: 'Codex task', activity: 'running', updatedAtMs: 1 }],
      unread: [], alerts: [], unreadCount: 0, runningCount: 1, visibleTasks: [{ id: 'same' }],
    },
    claude: {
      configured: true, enabled: true, connected: true, activity: 'needsInput', updatedAtMs: 2,
      tasks: [{ id: 'same', title: 'Claude task', activity: 'needsInput', updatedAtMs: 2 }],
      unread: [{ id: 'event', threadId: 'same', activity: 'needsInput', createdAtMs: 2 }],
      alerts: [], unreadCount: 1, runningCount: 0, visibleTasks: [{ id: 'same' }],
    },
  });
  assert.equal(snapshot.activity, CLAUDE_ACTIVITY.NEEDS_INPUT);
  assert.deepEqual(snapshot.tasks.map((task) => task.id).sort(), ['claude:same', 'codex:same']);
  assert.equal(snapshot.unread[0].provider, 'claude');
  assert.equal(snapshot.unread[0].threadId, 'claude:same');
  assert.equal(snapshot.providerCounts.claude.unread, 1);
});
