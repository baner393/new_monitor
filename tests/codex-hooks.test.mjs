import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CODEX_HOOK_EVENTS,
  buildCodexHookCommands,
  mergeCodexHooksConfig,
  prepareCodexHooksPlan,
  removeCodexHooksConfig,
  sanitizeCodexHookEvent,
  readCodexHookEvents,
  syncCodexHooks,
  writeCodexHookEvent,
} from '../src/main/codex-hooks.mjs';

const commandOptions = {
  scriptPath: '/opt/Turtle Monitor/codex-hooks.mjs',
  nodeExecutablePath: '/opt/Turtle Monitor/electron',
  eventDirectory: '/home/user/.local/share/Turtle Monitor/codex-events',
  platform: 'linux',
};

test('Codex hook payload keeps only lifecycle identifiers and local timestamp', () => {
  const payload = sanitizeCodexHookEvent({
    session_id: ' session-1 ',
    turn_id: 'turn-2',
    hook_event_name: 'UserPromptSubmit',
    cwd: 'D:\\work',
    prompt: 'do not store this prompt',
    transcript_path: 'do-not-store-this-transcript',
    permission_mode: 'default',
    api_key: 'secret',
  }, { now: () => Date.UTC(2026, 9, 2, 0, 0, 0) });

  assert.deepEqual(payload, {
    session_id: 'session-1',
    turn_id: 'turn-2',
    hook_event_name: 'UserPromptSubmit',
    timestamp: '2026-10-02T00:00:00.000Z',
  });
  assert.deepEqual(sanitizeCodexHookEvent({
    hook_event_name: 'Stop',
    last_assistant_message: 'do not store this message',
  }, { now: () => Date.UTC(2026, 9, 2, 0, 0, 0) }), {
    hook_event_name: 'Stop',
    timestamp: '2026-10-02T00:00:00.000Z',
  });
  for (const hookEventName of ['PreToolUse', 'PostToolUse']) {
    assert.equal(sanitizeCodexHookEvent({
      hook_event_name: hookEventName,
      tool_name: 'Bash',
      tool_input: { command: 'must not be stored' },
    })?.hook_event_name, hookEventName);
  }
  assert.equal(sanitizeCodexHookEvent({ hook_event_name: 'Unknown' }), null);
  assert.equal(sanitizeCodexHookEvent(null), null);
});

test('Codex hook config merges idempotently and preserves unrelated hooks', () => {
  const existing = {
    description: 'user hooks',
    unrelated: { keep: true },
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'keep-me' }] }],
      PermissionRequest: [{
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'existing-approval-hook' }],
      }],
    },
  };
  const first = mergeCodexHooksConfig(existing, commandOptions);
  const second = mergeCodexHooksConfig(first, commandOptions);

  assert.equal(existing.hooks.UserPromptSubmit, undefined);
  assert.deepEqual(second.description, 'user hooks');
  assert.deepEqual(second.unrelated, { keep: true });
  assert.equal(second.hooks.SessionStart[0].hooks[0].command, 'keep-me');
  assert.equal(second.hooks.PermissionRequest[0].hooks[0].command, 'existing-approval-hook');
  for (const eventName of CODEX_HOOK_EVENTS) {
    const owned = second.hooks[eventName].flatMap((group) => group.hooks)
      .filter((handler) => String(handler.commandWindows || '').includes('EncodedCommand'));
    assert.equal(owned.length, 1, `${eventName} should have one monitor hook`);
    assert.equal(owned[0].async, !['UserPromptSubmit', 'PermissionRequest'].includes(eventName));
  }
});

test('Codex hook removal only removes matching monitor handlers', () => {
  const installed = mergeCodexHooksConfig({
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'other-stop-handler' }] }],
    },
  }, commandOptions);
  const removed = removeCodexHooksConfig(installed, commandOptions);
  const removedAgain = removeCodexHooksConfig(removed, commandOptions);

  assert.deepEqual(removedAgain.hooks, {
    Stop: [{ hooks: [{ type: 'command', command: 'other-stop-handler' }] }],
  });
  const plan = prepareCodexHooksPlan(installed, commandOptions, 'remove');
  assert.equal(plan.eventDirectory, commandOptions.eventDirectory);
  assert.equal(JSON.parse(plan.json).hooks.Stop[0].hooks[0].command, 'other-stop-handler');
});

test('Windows hook command safely encodes paths with spaces and quotes', () => {
  const paths = {
    scriptPath: "C:\\Program Files\\Turtle O'Clock\\codex-hooks.mjs",
    nodeExecutablePath: 'C:\\Program Files\\Turtle Monitor\\Turtle Monitor.exe',
    eventDirectory: "C:\\Users\\A User\\AppData\\Turtle's Events",
    platform: 'win32',
  };
  const commands = buildCodexHookCommands(paths);
  const encoded = commands.commandWindows.match(/-EncodedCommand ([A-Za-z0-9+/=]+)$/)?.[1];
  assert.ok(encoded);
  assert.doesNotMatch(commands.commandWindows, /['"]|Program Files|Turtle's/);
  const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
  assert.match(decoded, /C:\\Program Files\\Turtle O''Clock\\codex-hooks\.mjs/);
  assert.match(decoded, /C:\\Program Files\\Turtle Monitor\\Turtle Monitor\.exe/);
  assert.match(decoded, /C:\\Users\\A User\\AppData\\Turtle''s Events/);
});

test('hook event is written atomically with no prompt or transcript fields', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-hooks-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const eventDirectory = path.join(root, 'events');
  const result = await writeCodexHookEvent({
    session_id: 'session-1',
    turn_id: 'turn-2',
    hook_event_name: 'Stop',
    cwd: root,
    stop_hook_active: false,
    prompt: 'private prompt',
    transcript_path: 'private transcript',
  }, eventDirectory, { now: () => Date.UTC(2026, 9, 2, 0, 0, 0) });

  assert.ok(result.path.endsWith('.json'));
  const entries = await fs.readdir(eventDirectory);
  assert.deepEqual(entries, [path.basename(result.path)]);
  const persisted = JSON.parse(await fs.readFile(result.path, 'utf8'));
  assert.deepEqual(Object.keys(persisted), [
    'session_id',
    'turn_id',
    'hook_event_name',
    'timestamp',
  ]);
  assert.doesNotMatch(JSON.stringify(persisted), /private prompt|private transcript/);
  assert.equal(await writeCodexHookEvent({ hook_event_name: 'Unknown' }, eventDirectory), null);
});

test('hook script CLI reads Codex stdin and stores only the sanitized event', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-hooks-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const eventDirectory = path.join(root, 'events');
  const scriptPath = path.resolve('src/main/codex-hooks.mjs');
  const result = spawnSync(process.execPath, [scriptPath, '--event-directory', eventDirectory], {
    input: JSON.stringify({
      session_id: 'session-cli',
      turn_id: 'turn-cli',
      hook_event_name: 'Interrupt',
      cwd: root,
      prompt: 'must stay out of the event file',
      transcript_path: 'must stay out of the event file',
    }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const [filename] = await fs.readdir(eventDirectory);
  const saved = JSON.parse(await fs.readFile(path.join(eventDirectory, filename), 'utf8'));
  assert.equal(saved.session_id, 'session-cli');
  assert.equal(saved.hook_event_name, 'Interrupt');
  assert.equal('prompt' in saved, false);
  assert.equal('transcript_path' in saved, false);
});

test('Codex hooks configuration is written idempotently and removed without disturbing user hooks', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-hooks-config-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, '.codex');
  const eventDirectory = path.join(root, 'events');
  await fs.mkdir(codexHome, { recursive: true });
  const initial = {
    featureFlag: true,
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'keep-user-hook' }] }] },
  };
  await fs.writeFile(path.join(codexHome, 'hooks.json'), `${JSON.stringify(initial, null, 2)}\n`);
  const options = {
    ...commandOptions,
    scriptPath: path.join(root, 'codex-hooks.mjs'),
    nodeExecutablePath: process.execPath,
    eventDirectory,
    platform: process.platform,
  };

  const installed = await syncCodexHooks({ codexHome, enabled: true, options });
  assert.equal(installed.changed, true);
  assert.equal((await syncCodexHooks({ codexHome, enabled: true, options })).changed, false);
  await assert.doesNotReject(() => fs.access(eventDirectory));
  const config = JSON.parse(await fs.readFile(installed.configPath, 'utf8'));
  assert.equal(config.featureFlag, true);
  assert.equal(config.hooks.Stop[0].hooks[0].command, 'keep-user-hook');
  assert.equal(config.hooks.Stop[1].hooks[0].commandWindows.includes('EncodedCommand'), true);

  const removed = await syncCodexHooks({ codexHome, enabled: false, options });
  const final = JSON.parse(await fs.readFile(removed.configPath, 'utf8'));
  assert.deepEqual(final.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'keep-user-hook' }] }] });
});

test('event reader keeps the current turn epoch and terminal evidence while compacting older files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-hooks-read-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeCodexHookEvent({
    session_id: 'session-read',
    turn_id: 'turn-read',
    hook_event_name: 'UserPromptSubmit',
    prompt: 'private prompt',
  }, root, { now: () => Date.UTC(2026, 9, 2, 0, 0, 0) });
  await writeCodexHookEvent({
    session_id: 'session-read',
    turn_id: 'turn-read',
    hook_event_name: 'Stop',
    last_assistant_message: 'private answer',
  }, root, { now: () => Date.UTC(2026, 9, 2, 0, 0, 1) });
  await writeCodexHookEvent({
    session_id: 'session-read',
    turn_id: 'turn-read',
    hook_event_name: 'Interrupt',
  }, root, { now: () => Date.UTC(2026, 9, 2, 0, 0, 1, 500) });
  await writeCodexHookEvent({
    session_id: 'session-read',
    turn_id: 'turn-read',
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'must not be stored' },
  }, root, { now: () => Date.UTC(2026, 9, 2, 0, 0, 2) });
  const events = await readCodexHookEvents(root);
  assert.deepEqual(events.map((event) => event.hook_event_name), ['UserPromptSubmit', 'Interrupt', 'PostToolUse']);
  assert.equal((await fs.readdir(root)).length, 3);
  assert.doesNotMatch(JSON.stringify(events), /private prompt|private answer/);

  await writeCodexHookEvent({
    session_id: 'session-read',
    turn_id: 'turn-next',
    hook_event_name: 'UserPromptSubmit',
  }, root, { now: () => Date.UTC(2026, 9, 2, 0, 0, 3) });
  await writeCodexHookEvent({
    session_id: 'session-read',
    turn_id: 'turn-read',
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
  }, root, { now: () => Date.UTC(2026, 9, 2, 0, 0, 4) });
  const nextTurnEvents = await readCodexHookEvents(root);
  assert.deepEqual(nextTurnEvents.map((event) => event.hook_event_name), ['UserPromptSubmit']);
  assert.equal((await fs.readdir(root)).length, 1);
});

test('event reader resolves same-millisecond permission and pre-tool events independently of file order', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-hooks-same-ms-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const timestamp = Date.UTC(2026, 9, 2, 0, 0, 5);
  for (const [sessionId, eventOrder] of [
    ['permission-first', ['PermissionRequest', 'PreToolUse']],
    ['pre-tool-first', ['PreToolUse', 'PermissionRequest']],
  ]) {
    await writeCodexHookEvent({
      session_id: sessionId,
      turn_id: 'same-turn',
      hook_event_name: 'UserPromptSubmit',
    }, root, { now: () => timestamp - 1000 });
    for (const hook_event_name of eventOrder) {
      await writeCodexHookEvent({
        session_id: sessionId,
        turn_id: 'same-turn',
        hook_event_name,
      }, root, { now: () => timestamp });
    }
  }

  const latestBySession = new Map();
  for (const event of await readCodexHookEvents(root)) latestBySession.set(event.session_id, event.hook_event_name);
  assert.equal(latestBySession.get('permission-first'), 'PermissionRequest');
  assert.equal(latestBySession.get('pre-tool-first'), 'PermissionRequest');
});

test('event reader preserves sessions beyond the former event limit', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-hooks-many-sessions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const firstTimestamp = Date.UTC(2026, 9, 2, 0, 0, 0);
  for (let index = 0; index < 520; index += 1) {
    await writeCodexHookEvent({
      session_id: `session-${index}`,
      hook_event_name: 'Stop',
    }, root, { now: () => firstTimestamp + index * 1000 });
  }
  const events = await readCodexHookEvents(root);
  assert.equal(events.length, 520);
  assert.equal((await fs.readdir(root)).length, 520);
});
