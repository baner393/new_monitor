import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const CODEX_HOOK_EVENTS = Object.freeze([
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'Interrupt',
  'PermissionRequest',
]);

const HOOK_EVENTS = new Set(CODEX_HOOK_EVENTS);
const HOOK_EVENT_ORDER = Object.freeze({
  UserPromptSubmit: 1,
  PreToolUse: 2,
  PermissionRequest: 3,
  PostToolUse: 4,
  Stop: 5,
  Interrupt: 6,
});
const DEFAULT_NODE_PATH = process.execPath;
const DEFAULT_SCRIPT_PATH = fileURLToPath(import.meta.url);
const MAX_ID_LENGTH = 256;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value, maxLength) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\0\r\n]/.test(normalized)) return '';
  return normalized;
}

function hookEventOrder(eventName) {
  return HOOK_EVENT_ORDER[eventName] || 0;
}

/** Return only the event fields the monitor needs. Hook prompts and transcripts are never copied. */
export function sanitizeCodexHookEvent(input, { now = Date.now } = {}) {
  if (!isRecord(input)) return null;
  const hookEventName = boundedString(input.hook_event_name, 64);
  if (!HOOK_EVENTS.has(hookEventName)) return null;

  const payload = {};
  const sessionId = boundedString(input.session_id, MAX_ID_LENGTH);
  const turnId = boundedString(input.turn_id, MAX_ID_LENGTH);
  if (sessionId) payload.session_id = sessionId;
  if (turnId) payload.turn_id = turnId;
  payload.hook_event_name = hookEventName;

  const timestampValue = typeof now === 'function' ? now() : now;
  const timestamp = new Date(timestampValue);
  if (Number.isNaN(timestamp.getTime())) return null;
  payload.timestamp = timestamp.toISOString();
  return payload;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function powershellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function absolutePath(value, platform, name) {
  const input = String(value || '');
  if (!input || /[\0\r\n]/.test(input)) throw new TypeError(`${name} must be an absolute path`);
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(input)) throw new TypeError(`${name} must be an absolute path`);
  return pathApi.normalize(input);
}

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function buildWindowsCommand(nodeExecutablePath, scriptPath, eventDirectory) {
  const powershellScript = [
    "$ErrorActionPreference = 'Stop'",
    "$env:ELECTRON_RUN_AS_NODE = '1'",
    `& ${powershellLiteral(nodeExecutablePath)} ${powershellLiteral(scriptPath)} --event-directory ${powershellLiteral(eventDirectory)}`,
    'exit $LASTEXITCODE',
  ].join(os.EOL);
  // Codex currently wraps Windows hook commands through cmd.exe. EncodedCommand
  // avoids embedded quotes, whose parsing is unreliable in that path.
  return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${encodePowerShell(powershellScript)}`;
}

export function buildCodexHookCommands({
  scriptPath = DEFAULT_SCRIPT_PATH,
  nodeExecutablePath = DEFAULT_NODE_PATH,
  eventDirectory,
  platform = process.platform,
} = {}) {
  const resolvedScriptPath = absolutePath(scriptPath, platform, 'scriptPath');
  const resolvedNodePath = absolutePath(nodeExecutablePath, platform, 'nodeExecutablePath');
  const resolvedEventDirectory = absolutePath(eventDirectory, platform, 'eventDirectory');
  const command = [
    'ELECTRON_RUN_AS_NODE=1',
    shellQuote(resolvedNodePath),
    shellQuote(resolvedScriptPath),
    '--event-directory',
    shellQuote(resolvedEventDirectory),
  ].join(' ');

  return {
    command,
    commandWindows: buildWindowsCommand(resolvedNodePath, resolvedScriptPath, resolvedEventDirectory),
    eventDirectory: resolvedEventDirectory,
  };
}

function commandHandler(commands, eventName) {
  const orderedEvents = new Set(['UserPromptSubmit', 'PermissionRequest']);
  return {
    type: 'command',
    command: commands.command,
    commandWindows: commands.commandWindows,
    async: !orderedEvents.has(eventName),
    timeout: 3,
  };
}

function isOurHandler(handler, commands) {
  return handler?.type === 'command'
    && handler.command === commands.command
    && handler.commandWindows === commands.commandWindows;
}

function removeOurGroups(groups, commands) {
  return groups
    .map((group) => {
      if (!isRecord(group) || !Array.isArray(group.hooks)) return group;
      const hooks = group.hooks.filter((handler) => !isOurHandler(handler, commands));
      return hooks.length === group.hooks.length ? group : { ...group, hooks };
    })
    .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0);
}

function copyConfig(config) {
  if (config === undefined || config === null) return {};
  if (!isRecord(config)) throw new TypeError('Codex hooks config must be a JSON object');
  if (config.hooks !== undefined && !isRecord(config.hooks)) {
    throw new TypeError('Codex hooks config "hooks" must be an object');
  }
  return { ...config, hooks: { ...(config.hooks || {}) } };
}

export function mergeCodexHooksConfig(existingConfig, options = {}) {
  const commands = buildCodexHookCommands(options);
  const config = copyConfig(existingConfig);
  for (const eventName of CODEX_HOOK_EVENTS) {
    const existingGroups = config.hooks[eventName];
    if (existingGroups !== undefined && !Array.isArray(existingGroups)) {
      throw new TypeError(`Codex hook event "${eventName}" must be an array`);
    }
    const groups = removeOurGroups(existingGroups || [], commands);
    groups.push({ hooks: [commandHandler(commands, eventName)] });
    config.hooks[eventName] = groups;
  }
  return config;
}

export function removeCodexHooksConfig(existingConfig, options = {}) {
  const commands = buildCodexHookCommands(options);
  const config = copyConfig(existingConfig);
  for (const eventName of CODEX_HOOK_EVENTS) {
    const existingGroups = config.hooks[eventName];
    if (existingGroups === undefined) continue;
    if (!Array.isArray(existingGroups)) {
      throw new TypeError(`Codex hook event "${eventName}" must be an array`);
    }
    const groups = removeOurGroups(existingGroups, commands);
    if (groups.length) config.hooks[eventName] = groups;
    else delete config.hooks[eventName];
  }
  return config;
}

export function prepareCodexHooksPlan(existingConfig, options = {}, action = 'install') {
  const commands = buildCodexHookCommands(options);
  const config = action === 'remove'
    ? removeCodexHooksConfig(existingConfig, options)
    : mergeCodexHooksConfig(existingConfig, options);
  return {
    action: action === 'remove' ? 'remove' : 'install',
    config,
    json: `${JSON.stringify(config, null, 2)}\n`,
    eventDirectory: commands.eventDirectory,
  };
}

export async function syncCodexHooks({ codexHome, enabled, options = {} } = {}) {
  if (!codexHome) return { changed: false, reason: 'Codex 数据目录不可用' };
  const configPath = path.join(path.resolve(codexHome), 'hooks.json');
  if (enabled && options.eventDirectory) {
    try { await fs.mkdir(options.eventDirectory, { recursive: true }); }
    catch (error) { return { changed: false, configPath, error: `无法创建 Codex 事件目录：${error.message}` }; }
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let originalText = null;
    let existingConfig = {};
    try {
      originalText = await fs.readFile(configPath, 'utf8');
      existingConfig = JSON.parse(originalText);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        const message = error instanceof SyntaxError
          ? `Codex Hooks 配置格式不受支持：${error.message}`
          : `无法读取 Codex hooks.json：${error.message}`;
        return { changed: false, configPath, error: message };
      }
    }

    let plan;
    try {
      if (!enabled && originalText === null) return { changed: false, configPath };
      plan = prepareCodexHooksPlan(existingConfig, options, enabled ? 'install' : 'remove');
    } catch (error) {
      return { changed: false, configPath, error: `Codex Hooks 配置格式不受支持：${error.message}` };
    }

    const temporaryPath = `${configPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, plan.json, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      let currentText = null;
      try { currentText = await fs.readFile(configPath, 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (currentText !== originalText) {
        await fs.rm(temporaryPath, { force: true });
        continue;
      }
      if (currentText === plan.json) {
        await fs.rm(temporaryPath, { force: true });
        return { changed: false, configPath };
      }
      await fs.rename(temporaryPath, configPath);
      return { changed: true, configPath, action: plan.action };
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
      return { changed: false, configPath, error: `无法更新 Codex hooks.json：${error.message}` };
    }
  }
  return { changed: false, configPath, error: 'Codex hooks.json 在更新期间持续变化；请稍后重试。' };
}

export async function readCodexHookEvents(eventDirectory, { maximumEvents = 512 } = {}) {
  if (!eventDirectory) return [];
  let entries;
  try { entries = await fs.readdir(eventDirectory, { withFileTypes: true }); }
  catch { return []; }
  const eventFiles = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(eventDirectory, entry.name);
    try {
      const stat = await fs.stat(filePath);
      eventFiles.push({ filePath, modifiedAtMs: stat.mtimeMs });
    } catch { /* A concurrently rotating event file can disappear. */ }
  }
  const parsedEvents = [];
  for (const { filePath, modifiedAtMs } of eventFiles) {
    try {
      const input = JSON.parse(await fs.readFile(filePath, 'utf8'));
      const event = sanitizeCodexHookEvent(input, { now: () => input.timestamp });
      if (event) parsedEvents.push({ event, filePath, modifiedAtMs });
    } catch { /* Ignore partial or manually edited files. */ }
  }
  const eventsBySession = new Map();
  const uncorrelated = [];
  const timestampOf = ({ event, modifiedAtMs }) => Date.parse(event.timestamp) || modifiedAtMs;
  for (const item of parsedEvents) {
    const sessionId = item.event.session_id;
    if (!sessionId) {
      uncorrelated.push(item);
      continue;
    }
    const sessionEvents = eventsBySession.get(sessionId) || [];
    sessionEvents.push(item);
    eventsBySession.set(sessionId, sessionEvents);
  }
  const retainedEvents = [];
  for (const sessionEvents of eventsBySession.values()) {
    const orderedEvents = sessionEvents.sort((left, right) => timestampOf(left) - timestampOf(right)
      || hookEventOrder(left.event.hook_event_name) - hookEventOrder(right.event.hook_event_name)
      || left.modifiedAtMs - right.modifiedAtMs
      || left.filePath.localeCompare(right.filePath));
    const latestPrompt = orderedEvents
      .filter(({ event }) => event.hook_event_name === 'UserPromptSubmit')
      .at(-1);
    const currentTurnId = String(latestPrompt?.event.turn_id || '');
    const currentEvents = latestPrompt
      ? orderedEvents.filter((item) => item === latestPrompt
        || (currentTurnId
          ? String(item.event.turn_id || '') === currentTurnId
          : timestampOf(item) >= timestampOf(latestPrompt)))
      : orderedEvents;
    const latest = currentEvents.at(-1);
    if (!latest) continue;
    retainedEvents.push(latest);
    if (latestPrompt && latestPrompt.filePath !== latest.filePath) retainedEvents.push(latestPrompt);
    const terminal = currentEvents
      .filter(({ event }) => ['Stop', 'Interrupt'].includes(event.hook_event_name))
      .reduce((previous, current) => {
        if (!previous) return current;
        const currentPriority = current.event.hook_event_name === 'Interrupt' ? 2 : 1;
        const previousPriority = previous.event.hook_event_name === 'Interrupt' ? 2 : 1;
        return currentPriority > previousPriority
          || (currentPriority === previousPriority && timestampOf(current) >= timestampOf(previous))
          ? current : previous;
      }, null);
    if (terminal && terminal.filePath !== latest.filePath) retainedEvents.push(terminal);
  }
  const retainedPaths = new Set([
    ...retainedEvents.map((item) => item.filePath),
    ...uncorrelated
      .sort((left, right) => timestampOf(right) - timestampOf(left))
      .slice(0, Math.max(1, Number(maximumEvents) || 512))
      .map((item) => item.filePath),
  ]);
  await Promise.all(eventFiles
    .filter(({ filePath }) => !retainedPaths.has(filePath))
    .map(({ filePath }) => fs.rm(filePath, { force: true }).catch(() => {})));
  return [...retainedEvents, ...uncorrelated.filter(({ filePath }) => retainedPaths.has(filePath))]
    .sort((left, right) => timestampOf(left) - timestampOf(right)
      || hookEventOrder(left.event.hook_event_name) - hookEventOrder(right.event.hook_event_name)
      || String(left.event.session_id || '').localeCompare(String(right.event.session_id || '')))
    .map(({ event }) => event);
}

export async function writeCodexHookEvent(input, eventDirectory, options = {}) {
  const payload = sanitizeCodexHookEvent(input, options);
  if (!payload) return null;
  const directoryInput = String(eventDirectory || '');
  if (!directoryInput || /[\0\r\n]/.test(directoryInput)) {
    throw new TypeError('eventDirectory must be an absolute path');
  }
  const directory = path.resolve(directoryInput);

  await fs.mkdir(directory, { recursive: true });
  const filename = `${payload.timestamp.replaceAll(':', '-')}-${randomUUID()}.json`;
  const targetPath = path.join(directory, filename);
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return { path: targetPath, event: payload };
}

async function runHookCli() {
  const args = process.argv.slice(2);
  const directoryIndex = args.indexOf('--event-directory');
  const eventDirectory = directoryIndex >= 0 ? args[directoryIndex + 1] : '';
  if (!eventDirectory) {
    process.stderr.write('Codex hook event directory is missing.\n');
    process.exitCode = 2;
    return;
  }

  const hookStartedAtMs = Date.now();
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const parsed = JSON.parse(input);
    await writeCodexHookEvent(parsed, eventDirectory, { now: () => hookStartedAtMs });
  } catch (error) {
    process.stderr.write(`Codex hook event could not be stored: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === DEFAULT_SCRIPT_PATH) {
  runHookCli();
}
