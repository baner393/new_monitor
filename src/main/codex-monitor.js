import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import {
  CODEX_ACTIVITY,
  CODEX_CONNECTION,
  CODEX_REPLY_TRANSPORT,
  buildCodexVisibleTasks,
  cleanCodexUserMessage,
  codexActivityFromThreadStatus,
  normalizeCodexIntegrationConfig,
  normalizeCodexSessionPreference,
  normalizeCodexLocale,
  resolveCodexActivity,
  sanitizeProjectName,
  sanitizeTaskTitle,
  sortCodexUnreadEvents,
} from '../shared/codex-integration.js';

const MAX_SESSION_FILES = 120;
const RECENT_SESSION_FILES = 32;
const MAX_INITIAL_FILE_BYTES = 4 * 1024 * 1024;
const DISCOVERY_INTERVAL_MS = 30_000;
const WATCH_DEBOUNCE_MS = 250;
const RUNNING_STALE_MS = 5 * 60 * 1000;
const CLIENT_RETRY_DELAYS = [1000, 2000, 5000, 10_000, 30_000];

function finiteTimestamp(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

export function parseCodexSessionIndex(text) {
  const titles = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const row = parseLine(line);
    const id = String(row?.id || '').trim();
    const rawTitle = String(row?.thread_name || '').trim();
    if (!id || !rawTitle) continue;
    const updatedAtMs = finiteTimestamp(row.updated_at, 0);
    const previous = titles.get(id);
    if (previous && previous.updatedAtMs > updatedAtMs) continue;
    titles.set(id, {
      title: sanitizeTaskTitle(rawTitle, 500),
      updatedAtMs,
    });
  }
  return titles;
}

async function readCodexSessionIndex(codexHome) {
  try {
    const text = await fs.promises.readFile(path.join(codexHome, 'session_index.jsonl'), 'utf8');
    return parseCodexSessionIndex(text);
  } catch {
    return new Map();
  }
}

function textFromMessageContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((item) => item?.type === 'output_text' || item?.type === 'input_text' || item?.type === 'text')
    .map((item) => String(item?.text || ''))
    .join('\n')
    .trim();
}

function timestampToMs(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  return finiteTimestamp(value, 0);
}

function messagesFromThread(thread) {
  const messages = [];
  let lastCreatedAtMs = 0;
  for (const [turnIndex, turn] of (thread?.turns || []).entries()) {
    for (const [itemIndex, item] of (turn?.items || []).entries()) {
      const type = String(item?.type || '');
      const role = type === 'userMessage' ? 'user'
        : type === 'agentMessage' ? 'assistant'
          : /tool|command/i.test(type) ? 'tool' : '';
      if (!role) continue;
      const message = role === 'user'
        ? cleanCodexUserMessage(textFromMessageContent(item.content) || item.text || item.message)
        : role === 'assistant'
          ? String(item.text || item.message || textFromMessageContent(item.content) || '').trim()
          : [
            String(item.name || item.tool || item.command || type).trim(),
            stringifyToolValue(item.output ?? item.result ?? item.content ?? item.arguments),
          ].filter(Boolean).join('\n');
      if (!message) continue;
      const timestamp = timestampToMs(item.createdAt || turn.startedAt || turn.completedAt || thread.updatedAt)
        || turnIndex * 1000;
      lastCreatedAtMs = Math.max(timestamp + itemIndex, lastCreatedAtMs + 1);
      messages.push({
        id: String(item.id || `app-server:${thread.id}:${messages.length}`),
        role,
        kind: role === 'tool' ? type : 'message',
        message,
        createdAtMs: lastCreatedAtMs,
      });
    }
  }
  return messages;
}

function activeTurnIdFromThread(thread) {
  const turns = thread?.turns || [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const status = String(turn?.status?.type || turn?.status || '').toLowerCase();
    if (['active', 'inprogress', 'running'].includes(status)) return String(turn.id || '');
  }
  const threadStatus = String(thread?.status?.type || thread?.status || '').toLowerCase();
  if (['active', 'inprogress', 'running'].includes(threadStatus)) return String(turns.at(-1)?.id || '');
  return '';
}

function createRolloutState(filePath = '', modifiedAtMs = 0) {
  const fileThreadId = path.basename(filePath || '').match(/([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/i)?.[1] || '';
  return {
    filePath,
    modifiedAtMs,
    partial: '',
    threadId: fileThreadId,
    parentThreadId: '',
    cwd: '',
    model: '',
    name: '',
    title: '',
    isInternal: false,
    lastAgentMessage: '',
    lastStartedAtMs: 0,
    lastFinishedAtMs: 0,
    lastFinishTimestampKnown: false,
    lastActivityAtMs: modifiedAtMs,
    lastTurnId: '',
    lastFinishKind: '',
    messages: [],
    messageKeys: new Set(),
    historyComplete: true,
  };
}

function appendMessage(state, role, value, timestamp, kind = 'message') {
  const message = role === 'user'
    ? cleanCodexUserMessage(value)
    : String(value || '').trim();
  if (!message || !['user', 'assistant', 'tool'].includes(role)) return;
  const createdAtMs = finiteTimestamp(timestamp, state.modifiedAtMs);
  const normalizedMessage = message.replace(/\s+/g, ' ').trim();
  const timeBucket = Math.floor(createdAtMs / 10_000);
  const keys = [-1, 0, 1].map((offset) => `${role}:${kind}:${timeBucket + offset}:${normalizedMessage}`);
  if (keys.some((key) => state.messageKeys.has(key))) return;
  state.messageKeys.add(`${role}:${kind}:${timeBucket}:${normalizedMessage}`);
  state.messages.push({
    id: `${state.threadId || 'thread'}:${state.messages.length}:${createdAtMs}`,
    role,
    kind,
    message,
    createdAtMs,
  });
  if (role === 'user' && !state.title) state.title = message;
  if (role === 'assistant') state.lastAgentMessage = message;
}

function stringifyToolValue(value, maxLength = 24_000) {
  let text = '';
  if (typeof value === 'string') text = value;
  else if (Array.isArray(value)) text = textFromMessageContent(value) || JSON.stringify(value, null, 2);
  else if (value !== undefined && value !== null) {
    try { text = JSON.stringify(value, null, 2); }
    catch { text = String(value); }
  }
  text = String(text || '').trim();
  return text.length > maxLength
    ? `${text.slice(0, maxLength)}\n… 工具内容过长，已显示前 ${maxLength} 个字符`
    : text;
}

function toolCallText(payload) {
  const name = String(payload?.name || payload?.tool || 'tool');
  const input = stringifyToolValue(payload?.input ?? payload?.arguments);
  return input ? `${name}\n${input}` : name;
}

function toolOutputText(payload) {
  return stringifyToolValue(payload?.output ?? payload?.result ?? payload?.content);
}

export function buildCodexTurnPermissionOverrides(bypassPermissions = false) {
  return bypassPermissions
    ? { approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } }
    : { approvalPolicy: 'on-request' };
}

export function buildCodexTurnReasoningOverrides(preference) {
  const { effort } = normalizeCodexSessionPreference(preference);
  return effort === 'inherit' ? {} : { effort };
}

function applyRolloutRow(state, row) {
  if (!row) return;
  const timestamp = finiteTimestamp(row.timestamp, state.modifiedAtMs);
  state.lastActivityAtMs = Math.max(state.lastActivityAtMs, timestamp);
  const payload = row.payload || {};

  if (row.type === 'session_meta') {
    state.threadId ||= String(payload.id || payload.session_id || '');
    state.parentThreadId ||= String(payload.parent_thread_id || payload.parentThreadId || '');
    state.cwd ||= String(payload.cwd || '');
    state.name ||= String(payload.name || payload.thread_name || '');
    const internalSubagent = String(payload.source?.subagent?.other || '').toLowerCase();
    state.isInternal ||= ['guardian', 'auto_review', 'approvals_reviewer'].includes(internalSubagent);
    return;
  }
  if (row.type === 'turn_context') {
    state.cwd = String(payload.cwd || state.cwd || '');
    state.model = String(payload.model || state.model || '');
    state.lastTurnId = String(payload.turn_id || state.lastTurnId || '');
    return;
  }
  if (row.type === 'event_msg') {
    if (payload.type === 'user_message') appendMessage(state, 'user', payload.message, timestamp);
    else if (payload.type === 'agent_message') appendMessage(state, 'assistant', payload.message, timestamp);
    else if (payload.type === 'task_started') {
      state.lastStartedAtMs = Math.max(state.lastStartedAtMs, finiteTimestamp(payload.started_at, timestamp));
      state.lastTurnId = String(payload.turn_id || state.lastTurnId || '');
      state.lastFinishKind = '';
    } else if (payload.type === 'task_complete') {
      const completedAtMs = Math.max(
        finiteTimestamp(payload.completed_at, 0),
        finiteTimestamp(row.timestamp, 0),
      );
      state.lastFinishedAtMs = Math.max(state.lastFinishedAtMs, completedAtMs || state.modifiedAtMs);
      state.lastFinishTimestampKnown = completedAtMs > 0;
      state.lastTurnId = String(payload.turn_id || state.lastTurnId || '');
      state.lastFinishKind = 'completed';
      if (payload.last_agent_message) appendMessage(state, 'assistant', payload.last_agent_message, timestamp);
    } else if (payload.type === 'turn_aborted') {
      const finishedAtMs = finiteTimestamp(row.timestamp, 0);
      state.lastFinishedAtMs = Math.max(state.lastFinishedAtMs, finishedAtMs || state.modifiedAtMs);
      state.lastFinishTimestampKnown = finishedAtMs > 0;
      state.lastTurnId = String(payload.turn_id || state.lastTurnId || '');
      state.lastFinishKind = 'aborted';
    }
    return;
  }
  if (row.type === 'response_item' && payload.type === 'message'
    && (payload.role === 'user' || payload.role === 'assistant')) {
    appendMessage(state, payload.role, textFromMessageContent(payload.content), timestamp);
  } else if (row.type === 'response_item' && payload.type === 'custom_tool_call') {
    appendMessage(state, 'tool', toolCallText(payload), timestamp, 'tool-call');
  } else if (row.type === 'response_item' && payload.type === 'custom_tool_call_output') {
    appendMessage(state, 'tool', toolOutputText(payload), timestamp, 'tool-result');
  }
}

function applyRolloutChunk(state, chunk, { flush = false } = {}) {
  const combined = `${state.partial}${String(chunk || '')}`;
  const lines = combined.split(/\r?\n/);
  state.partial = flush ? '' : (lines.pop() || '');
  if (flush && lines.at(-1) === '') lines.pop();
  for (const line of lines) applyRolloutRow(state, parseLine(line));
  if (flush && state.partial) {
    applyRolloutRow(state, parseLine(state.partial));
    state.partial = '';
  }
}

function snapshotRolloutState(state, { enabledAtMs = 0, readEventIds = new Set(), nowMs = Date.now() } = {}) {
  if (state.isInternal) return null;
  const threadId = state.threadId
    || path.basename(state.filePath || '', path.extname(state.filePath || ''));
  if (!threadId) return null;
  const updatedAtMs = Math.max(
    state.lastActivityAtMs,
    state.lastFinishedAtMs,
    state.lastStartedAtMs,
    state.modifiedAtMs,
  );
  const running = state.lastStartedAtMs > state.lastFinishedAtMs
    && nowMs - updatedAtMs <= RUNNING_STALE_MS;
  const task = {
    id: threadId,
    parentThreadId: state.parentThreadId || null,
    title: sanitizeTaskTitle(state.name || state.title),
    project: sanitizeProjectName(state.cwd),
    model: state.model || '',
    activity: running ? CODEX_ACTIVITY.RUNNING : CODEX_ACTIVITY.SILENT,
    updatedAtMs,
    managed: false,
    messages: state.messages,
    historyComplete: state.historyComplete,
  };
  let unread = null;
  if (!running && state.lastFinishKind && state.lastFinishTimestampKnown
    && state.lastFinishedAtMs >= enabledAtMs) {
    const activity = state.lastFinishKind === 'completed' ? CODEX_ACTIVITY.READY : CODEX_ACTIVITY.BLOCKED;
    const eventId = `${threadId}:${state.lastTurnId || state.lastFinishedAtMs}:${activity}`;
    if (!readEventIds.has(eventId)) {
      unread = {
        id: eventId,
        threadId,
        turnId: state.lastTurnId || null,
        title: task.title,
        project: task.project,
        activity,
        kind: state.lastFinishKind,
        message: state.lastFinishKind === 'completed'
          ? (state.lastAgentMessage || '任务已经完成。')
          : '任务已中断，请打开 Codex 查看具体原因。',
        createdAtMs: state.lastFinishedAtMs,
        managed: false,
        canReply: false,
      };
    }
  }
  return { task, unread };
}

export function parseCodexRollout(text, options = {}) {
  const state = createRolloutState(options.filePath, options.modifiedAtMs);
  applyRolloutChunk(state, text, { flush: true });
  return snapshotRolloutState(state, options);
}

export function resolveCodexHome(config, env = process.env, homeDirectory = os.homedir()) {
  const normalized = normalizeCodexIntegrationConfig(config);
  const candidates = normalized.homeMode === 'manual'
    ? [normalized.manualHome]
    : [env.CODEX_HOME, path.join(homeDirectory, '.codex')];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const resolved = path.resolve(String(candidate));
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
    } catch {
      // A roaming or removable profile can disappear between launches.
    }
  }
  return null;
}

async function collectSessionFiles(root) {
  const found = [];
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const stat = await fs.promises.stat(fullPath);
          found.push({ path: fullPath, modifiedAtMs: stat.mtimeMs, size: stat.size });
        } catch {
          // A session can rotate between directory enumeration and stat.
        }
      }
    }
  }
  return found
    .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)
    .slice(0, MAX_SESSION_FILES);
}

async function readRange(filePath, start, length) {
  if (length <= 0) return '';
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function readCodexLocale(codexHome) {
  try {
    const config = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    const match = config.match(/^\s*localeOverride\s*=\s*["']([^"']+)["']/m);
    return normalizeCodexLocale(match?.[1], Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return normalizeCodexLocale('', Intl.DateTimeFormat().resolvedOptions().locale);
  }
}

function findCliPathInConfig(codexHome) {
  try {
    const config = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    const match = config.match(/^cli_path\s*=\s*["']([^"']+)["']/m);
    return match?.[1] ? path.resolve(match[1]) : null;
  } catch { return null; }
}

function resolveCodexExecutables(codexHome) {
  const candidates = [];
  const configured = findCliPathInConfig(codexHome);
  if (configured) candidates.push(configured);
  if (process.env.CODEX_CLI_PATH) candidates.push(path.resolve(process.env.CODEX_CLI_PATH));
  if (process.platform === 'win32') {
    const binRoot = path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'OpenAI', 'Codex', 'bin',
    );
    try {
      const versions = fs.readdirSync(binRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(binRoot, entry.name, 'codex.exe'))
        .filter((candidate) => fs.existsSync(candidate))
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
      candidates.push(...versions);
    } catch {
      // PATH remains the portable fallback.
    }
  }
  candidates.push(process.platform === 'win32' ? 'codex.exe' : 'codex');
  return [...new Set(candidates)];
}

class CodexAppServerClient extends EventEmitter {
  constructor(codexHome) {
    super();
    this.codexHome = codexHome;
    this.child = null;
    this.reader = null;
    this.nextId = 10_000;
    this.pending = new Map();
    this.connecting = null;
    this.intentionalStop = false;
  }

  async connect() {
    if (this.child && !this.child.killed) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.#connectCandidates().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async #connectCandidates() {
    let lastError = null;
    for (const executable of resolveCodexExecutables(this.codexHome)) {
      try {
        await this.#spawnAndInitialize(executable);
        return;
      } catch (error) {
        lastError = error;
        this.stop();
      }
    }
    throw new Error(`Codex 双向连接启动失败：${lastError?.message || '没有找到可用的 Codex CLI'}`);
  }

  #spawnAndInitialize(executable) {
    return new Promise((resolve, reject) => {
      this.intentionalStop = false;
      const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
        cwd: this.codexHome,
        env: { ...process.env, CODEX_HOME: this.codexHome },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child = child;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      child.once('error', fail);
      child.once('exit', (code) => {
        const error = new Error(`Codex App Server 已退出（${code ?? 'unknown'}）`);
        const wasConnected = settled;
        if (!settled) fail(error);
        this.#rejectPending(error);
        if (wasConnected && !this.intentionalStop) this.emit('disconnect', error);
      });
      child.stderr.on('data', (chunk) => {
        const message = String(chunk || '').trim();
        if (message) this.emit('diagnostic', message.slice(0, 500));
      });
      this.reader = readline.createInterface({ input: child.stdout });
      this.reader.on('line', (line) => this.#onLine(line));
      const timeout = setTimeout(() => fail(new Error('Codex App Server 初始化超时')), 20_000);
      this.request('initialize', {
        clientInfo: { name: 'new_monitor', title: 'Turtle Monitor', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      }, 19_000).then(() => {
        if (settled) return;
        this.sendNotification('initialized', {});
        clearTimeout(timeout);
        settled = true;
        resolve();
      }).catch((error) => {
        clearTimeout(timeout);
        fail(error);
      });
    });
  }

  #onLine(line) {
    const message = parseLine(line);
    if (!message) return;
    if (message.method && message.id !== undefined) {
      this.emit('server-request', message);
      return;
    }
    if (message.id !== undefined && this.pending.has(String(message.id))) {
      const pending = this.pending.get(String(message.id));
      this.pending.delete(String(message.id));
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error.message || 'Codex 请求失败'));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) this.emit('notification', message);
  }

  #write(message) {
    if (!this.child?.stdin?.writable) throw new Error('Codex 双向连接尚未就绪');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeoutMs = 12_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`${method} 请求超时`));
      }, timeoutMs);
      this.pending.set(String(id), { resolve, reject, timeout });
      try { this.#write({ id, method, params }); }
      catch (error) {
        clearTimeout(timeout);
        this.pending.delete(String(id));
        reject(error);
      }
    });
  }

  sendNotification(method, params) { this.#write({ method, params }); }
  sendServerResponse(id, result) { this.#write({ id, result }); }

  #rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  stop() {
    this.intentionalStop = true;
    this.reader?.close();
    this.reader = null;
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
    this.#rejectPending(new Error('Codex 双向连接已关闭'));
  }
}

export class CodexMonitor {
  constructor({ config, onConfigChange, pollIntervalMs = DISCOVERY_INTERVAL_MS, appServerFactory } = {}) {
    this.migratingFromV1 = Number(config?.version || 1) < 2;
    this.config = normalizeCodexIntegrationConfig(config);
    this.onConfigChange = onConfigChange;
    this.pollIntervalMs = Math.max(5000, pollIntervalMs);
    this.appServerFactory = appServerFactory || ((home) => new CodexAppServerClient(home));
    this.window = null;
    this.timer = null;
    this.running = false;
    this.watcher = null;
    this.watchedRoot = '';
    this.watchDebounce = null;
    this.scanPromise = null;
    this.scanAgain = false;
    this.scanAgainForce = false;
    this.fileCache = new Map();
    this.knownFiles = new Map();
    this.changedPaths = new Set();
    this.lastDiscoveryAtMs = 0;
    this.tasks = new Map();
    this.catalogTasks = new Map();
    this.catalogSynced = false;
    this.reasoningModels = [];
    this.reasoningModelsSynced = false;
    this.managedTasks = new Map();
    this.managedMessages = new Map();
    this.managedUnread = new Map();
    this.pendingRequests = new Map();
    this.connectionStates = new Map();
    this.client = null;
    this.clientReady = false;
    this.clientRetryTimer = null;
    this.clientRetryIndex = 0;
    this.bytesRead = 0;
    this.filesParsed = 0;
    this.locale = 'zh-CN';
    this.lastSnapshot = this.#emptySnapshot();
  }

  setWindow(window) {
    this.window = window;
    this.#sendSnapshot();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.scan();
    if (this.config.enabled) this.#startClientLifecycle();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.watchDebounce) clearTimeout(this.watchDebounce);
    if (this.clientRetryTimer) clearTimeout(this.clientRetryTimer);
    this.timer = null;
    this.watchDebounce = null;
    this.clientRetryTimer = null;
    this.#closeWatcher();
    this.client?.stop();
    this.client = null;
    this.clientReady = false;
    this.catalogSynced = false;
  }

  getConfig() {
    return {
      ...this.config,
      desiredThreadIds: [...this.config.desiredThreadIds],
      readEventIds: [...this.config.readEventIds],
      notifiedEventIds: [...this.config.notifiedEventIds],
    };
  }

  updateConfig(next) {
    const previousConfig = this.config;
    const wasEnabled = this.config.enabled;
    this.config = normalizeCodexIntegrationConfig({ ...this.config, ...next });
    if (!wasEnabled && this.config.enabled) this.config.enabledAtMs = Date.now();
    this.#persistConfig();
    if (!this.config.enabled) {
      this.tasks.clear();
      this.catalogTasks.clear();
      this.catalogSynced = false;
      this.managedUnread.clear();
      this.connectionStates.clear();
      this.client?.stop();
      this.client = null;
      this.clientReady = false;
    } else {
      const homeChanged = previousConfig.homeMode !== this.config.homeMode
        || previousConfig.manualHome !== this.config.manualHome;
      const controlDisabled = previousConfig.managedReplies && !this.config.managedReplies;
      const desktopCompatibilityEnabled = previousConfig.replyTransport !== CODEX_REPLY_TRANSPORT.DESKTOP
        && this.config.replyTransport === CODEX_REPLY_TRANSPORT.DESKTOP;
      if (this.client && (homeChanged || controlDisabled || desktopCompatibilityEnabled)) {
        this.client.stop();
        this.client = null;
        this.clientReady = false;
        this.catalogSynced = false;
      }
      if (!this.config.managedReplies || this.config.replyTransport === CODEX_REPLY_TRANSPORT.DESKTOP) {
        if (this.clientRetryTimer) clearTimeout(this.clientRetryTimer);
        this.clientRetryTimer = null;
        this.connectionStates.clear();
        this.catalogTasks.clear();
        this.managedTasks.clear();
        this.managedMessages.clear();
        this.managedUnread.clear();
        this.pendingRequests.clear();
      }
      if (this.running) this.#startClientLifecycle();
    }
    this.scan(true);
    return this.getConfig();
  }

  getSnapshot() { return structuredClone(this.lastSnapshot); }

  async getMessages(threadId, { cursor = null, limit = 50 } = {}) {
    const id = String(threadId || '');
    const task = this.tasks.get(id);
    if (this.clientReady && this.catalogTasks.has(id)
      && (!(task?.messages?.length) || task?.historyComplete === false)) {
      await this.#hydrateThreadMessages(id);
    }
    const fileMessages = this.tasks.get(id)?.messages || [];
    const managedMessages = this.managedMessages.get(id) || [];
    const lastSeenAt = new Map();
    const messages = [...fileMessages, ...managedMessages]
      .sort((left, right) => Number(left.createdAtMs || 0) - Number(right.createdAtMs || 0))
      .filter((message) => {
        const key = `${message.role}:${message.message}`;
        const timestamp = Number(message.createdAtMs || 0);
        const previous = lastSeenAt.get(key);
        if (Number.isFinite(previous) && Math.abs(timestamp - previous) <= 10_000) return false;
        lastSeenAt.set(key, timestamp);
        return true;
      });
    const pageSize = Math.min(100, Math.max(1, Number(limit) || 50));
    const end = cursor === null ? messages.length : Math.min(messages.length, Math.max(0, Number(cursor) || 0));
    const start = Math.max(0, end - pageSize);
    return {
      threadId: id,
      messages: messages.slice(start, end),
      nextCursor: start > 0 ? String(start) : null,
      total: messages.length,
    };
  }

  getDiagnostics() {
    return {
      bytesRead: this.bytesRead,
      filesParsed: this.filesParsed,
      cachedFiles: this.fileCache.size,
    };
  }

  scan(force = false) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.scanPromise) {
      this.scanAgain = true;
      this.scanAgainForce ||= force;
      return this.scanPromise;
    }
    this.scanPromise = (async () => {
      let nextForce = force;
      do {
        this.scanAgain = false;
        this.scanAgainForce = false;
        await this.#scanOnce(nextForce);
        nextForce = this.scanAgainForce;
      } while (this.scanAgain);
    })().finally(() => {
      this.scanPromise = null;
      this.#scheduleScan();
    });
    return this.scanPromise;
  }

  async #scanOnce(force = false) {
    if (!this.config.enabled) {
      this.#closeWatcher();
      this.lastSnapshot = this.#emptySnapshot();
      this.#sendSnapshot();
      return;
    }
    const codexHome = resolveCodexHome(this.config);
    if (!codexHome) {
      this.#closeWatcher();
      this.lastSnapshot = {
        ...this.#emptySnapshot(),
        configured: true,
        enabled: true,
        reason: this.config.homeMode === 'manual'
          ? '选择的 Codex 数据目录不存在'
          : '本机没有检测到 Codex 数据目录',
      };
      this.#sendSnapshot();
      return;
    }
    this.locale = readCodexLocale(codexHome);
    const sessionsRoot = path.join(codexHome, 'sessions');
    if (!fs.existsSync(sessionsRoot)) {
      this.#watchSessions(codexHome);
      this.lastSnapshot = {
        ...this.#emptySnapshot(),
        configured: true,
        enabled: true,
        connected: true,
        locale: this.locale,
        homeLabel: this.config.homeMode === 'manual' ? '手动目录' : '自动检测',
        reason: 'Codex 已连接，但还没有本地对话记录',
      };
      this.#sendSnapshot();
      return;
    }

    this.#watchSessions(sessionsRoot);
    const nowMs = Date.now();
    const needsDiscovery = force
      || this.knownFiles.size === 0
      || nowMs - this.lastDiscoveryAtMs >= DISCOVERY_INTERVAL_MS;
    if (needsDiscovery) {
      const discovered = await collectSessionFiles(sessionsRoot);
      this.knownFiles = new Map(discovered.map((file) => [path.resolve(file.path), file]));
      this.changedPaths.clear();
      this.lastDiscoveryAtMs = nowMs;
    } else if (this.changedPaths.size) {
      const changed = [...this.changedPaths];
      this.changedPaths.clear();
      await Promise.all(changed.map(async (changedPath) => {
        try {
          const stat = await fs.promises.stat(changedPath);
          if (stat.isFile() && changedPath.endsWith('.jsonl')) {
            this.knownFiles.set(changedPath, {
              path: changedPath,
              modifiedAtMs: stat.mtimeMs,
              size: stat.size,
            });
          }
        } catch {
          this.knownFiles.delete(changedPath);
          this.fileCache.delete(changedPath);
        }
      }));
    }
    const desiredIds = new Set(this.config.desiredThreadIds);
    const files = [...this.knownFiles.values()]
      .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)
      .filter((file, index) => index < RECENT_SESSION_FILES
        || file.modifiedAtMs >= this.config.enabledAtMs
        || [...desiredIds].some((id) => file.path.includes(id)))
      .slice(0, MAX_SESSION_FILES);
    const readIds = new Set(this.config.readEventIds);
    const indexedTitles = await readCodexSessionIndex(codexHome);
    const nextTasks = new Map();
    const unread = [];
    const livePaths = new Set(files.map((file) => file.path));
    for (const cachedPath of this.fileCache.keys()) {
      if (!livePaths.has(cachedPath)) this.fileCache.delete(cachedPath);
    }
    for (const file of files) {
      try {
        const parsed = await this.#readCachedRollout(file, readIds);
        if (!parsed) continue;
        const existing = nextTasks.get(parsed.task.id);
        if (!existing || parsed.task.updatedAtMs >= existing.updatedAtMs) nextTasks.set(parsed.task.id, parsed.task);
        if (parsed.unread) unread.push(parsed.unread);
      } catch (error) {
        if (force) console.warn('[Codex] Session read failed:', error.message);
      }
    }
    this.tasks = new Map([...this.catalogTasks].map(([id, task]) => {
      const indexed = indexedTitles.get(id);
      return [id, indexed ? { ...task, title: indexed.title, hasSavedName: true } : task];
    }));
    for (const [id, task] of nextTasks) {
      const catalog = this.catalogTasks.get(id);
      const indexed = indexedTitles.get(id);
      this.tasks.set(id, {
        ...task,
        ...catalog,
        title: indexed?.title || (catalog?.hasSavedName ? catalog.title : task.title),
        hasSavedName: Boolean(indexed || catalog?.hasSavedName),
        messages: catalog?.messages?.length ? catalog.messages : task.messages,
        historyComplete: catalog?.messages?.length ? true : task.historyComplete,
        updatedAtMs: Math.max(Number(catalog?.updatedAtMs || 0), Number(task.updatedAtMs || 0)),
      });
    }
    await this.#reconcileDesiredConnections();
    this.#rebuildSnapshot(unread);
  }

  async #readCachedRollout(file, readIds) {
    let cached = this.fileCache.get(file.path);
    if (!cached || file.size < cached.offset) {
      const offset = Math.max(0, file.size - MAX_INITIAL_FILE_BYTES);
      const state = createRolloutState(file.path, file.modifiedAtMs);
      state.historyComplete = offset === 0;
      cached = { offset, modifiedAtMs: 0, state, skipFirstLine: offset > 0 };
    }
    if (file.size > cached.offset) {
      let chunk = await readRange(file.path, cached.offset, file.size - cached.offset);
      this.bytesRead += Buffer.byteLength(chunk);
      if (cached.skipFirstLine) {
        const newline = chunk.indexOf('\n');
        chunk = newline >= 0 ? chunk.slice(newline + 1) : '';
        cached.skipFirstLine = false;
      }
      cached.state.modifiedAtMs = file.modifiedAtMs;
      applyRolloutChunk(cached.state, chunk);
      cached.offset = file.size;
      cached.modifiedAtMs = file.modifiedAtMs;
      this.filesParsed += 1;
      this.fileCache.set(file.path, cached);
    } else if (!this.fileCache.has(file.path)) {
      this.fileCache.set(file.path, cached);
    }
    return snapshotRolloutState(cached.state, {
      enabledAtMs: this.config.enabledAtMs,
      readEventIds: readIds,
    });
  }

  #rebuildSnapshot(freshUnread = null) {
    const readIds = new Set(this.config.readEventIds);
    const parsedUnread = freshUnread || [...this.fileCache.values()]
      .map((entry) => snapshotRolloutState(entry.state, {
        enabledAtMs: this.config.enabledAtMs,
        readEventIds: readIds,
      })?.unread)
      .filter(Boolean);
    for (const [id, task] of this.managedTasks) this.tasks.set(id, { ...this.tasks.get(id), ...task });
    const unreadById = new Map([...parsedUnread, ...this.managedUnread.values()]
      .filter((event) => !readIds.has(event.id))
      .map((event) => [event.id, event]));
    const allUnread = sortCodexUnreadEvents([...unreadById.values()]);

    if (this.migratingFromV1) {
      if (allUnread.length) {
        this.config = normalizeCodexIntegrationConfig({
          ...this.config,
          notifiedEventIds: [...this.config.notifiedEventIds, ...allUnread.map((event) => event.id)],
        });
      }
      this.migratingFromV1 = false;
      this.#persistConfig();
    }

    const desired = new Set(
      this.config.managedReplies && this.config.replyTransport === CODEX_REPLY_TRANSPORT.DIRECT
        ? this.config.desiredThreadIds
        : [],
    );
    const allTasks = [...this.tasks.values()].map((task) => {
      const runtime = this.connectionStates.get(task.id);
      const connectionState = runtime?.state
        || (desired.has(task.id) ? CODEX_CONNECTION.CONNECTING : CODEX_CONNECTION.DISCONNECTED);
      const pendingRequest = [...this.pendingRequests.values()].find((request) => request.threadId === task.id);
      const pending = Boolean(pendingRequest);
      const canInterrupt = Boolean(task.activeTurnId || pendingRequest?.params?.turnId);
      const canReply = this.config.managedReplies === true
        && (this.config.replyTransport === CODEX_REPLY_TRANSPORT.DESKTOP
          || connectionState === CODEX_CONNECTION.CONNECTED);
      return {
        ...task,
        connectionState,
        connectionError: runtime?.error || '',
        hasOwnedRequest: pending,
        canInterrupt,
        canReply,
        capabilities: {
          reply: canReply,
          approve: connectionState === CODEX_CONNECTION.CONNECTED && pending,
          interrupt: connectionState === CODEX_CONNECTION.CONNECTED && canInterrupt,
          jump: true,
        },
      };
    });
    const taskSummary = buildCodexVisibleTasks(allTasks, allUnread);
    const notified = new Set(this.config.notifiedEventIds);
    this.lastSnapshot = {
      configured: true,
      enabled: true,
      connected: true,
      controlConnected: this.clientReady,
      locale: this.locale,
      homeLabel: this.config.homeMode === 'manual' ? '手动目录' : '自动检测',
      source: this.clientReady ? 'app-server+sessions' : 'sessions',
      reasoningModels: this.reasoningModels,
      activity: resolveCodexActivity({ connected: true, tasks: allTasks, unread: allUnread }),
      tasks: allTasks
        .map(({ messages, ...summary }) => summary)
        .sort((left, right) => Number(right.updatedAtMs || 0) - Number(left.updatedAtMs || 0)),
      unread: allUnread,
      alerts: allUnread.filter((event) => !notified.has(event.id)),
      unreadCount: allUnread.length,
      ...taskSummary,
      updatedAtMs: Date.now(),
      reason: '',
    };
    this.#sendSnapshot();
  }

  #scheduleScan() {
    if (!this.running || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.scan();
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  #watchSessions(root) {
    const resolved = path.resolve(root);
    if (this.watcher && this.watchedRoot === resolved) return;
    this.#closeWatcher();
    try {
      this.watcher = fs.watch(resolved, { recursive: process.platform === 'win32' }, (_event, fileName) => {
        const name = String(fileName || '');
        if (name && !/\.jsonl$|sessions/i.test(name)) return;
        if (name && name.endsWith('.jsonl')) this.changedPaths.add(path.resolve(resolved, name));
        if (this.watchDebounce) clearTimeout(this.watchDebounce);
        this.watchDebounce = setTimeout(() => {
          this.watchDebounce = null;
          this.scan(!name || !name.endsWith('.jsonl'));
        }, WATCH_DEBOUNCE_MS);
        this.watchDebounce.unref?.();
      });
      this.watchedRoot = resolved;
      this.watcher.on('error', () => this.#closeWatcher());
    } catch { this.#closeWatcher(); }
  }

  #closeWatcher() {
    this.watcher?.close();
    this.watcher = null;
    this.watchedRoot = '';
    this.knownFiles.clear();
    this.changedPaths.clear();
    this.lastDiscoveryAtMs = 0;
  }

  markRead(eventId) {
    const id = String(eventId || '').slice(0, 240);
    if (!id) return this.getSnapshot();
    const isPendingRequest = [...this.pendingRequests.values()].some((request) => request.eventId === id);
    this.config = normalizeCodexIntegrationConfig({
      ...this.config,
      readEventIds: isPendingRequest ? this.config.readEventIds : [...this.config.readEventIds, id],
      notifiedEventIds: [...this.config.notifiedEventIds, id],
    });
    if (!isPendingRequest) this.managedUnread.delete(id);
    this.#persistConfig();
    this.#rebuildSnapshot();
    return this.getSnapshot();
  }

  markNotified(eventId) {
    const id = String(eventId || '').slice(0, 240);
    if (!id || this.config.notifiedEventIds.includes(id)) return this.getSnapshot();
    this.config = normalizeCodexIntegrationConfig({
      ...this.config,
      notifiedEventIds: [...this.config.notifiedEventIds, id],
    });
    this.#persistConfig();
    this.#rebuildSnapshot();
    return this.getSnapshot();
  }

  async connectThread(threadId) {
    const id = String(threadId || '').trim();
    if (!id || !this.tasks.has(id)) throw new Error('没有找到这个 Codex 任务');
    if (!this.config.managedReplies) throw new Error('请先开启“允许气泡回复与批准”');
    if (this.config.replyTransport === CODEX_REPLY_TRANSPORT.DESKTOP) return this.getSnapshot();
    this.config = normalizeCodexIntegrationConfig({
      ...this.config,
      desiredThreadIds: [...this.config.desiredThreadIds, id],
    });
    this.#persistConfig();
    const task = this.tasks.get(id);
    this.connectionStates.set(id, {
      state: task.activity === CODEX_ACTIVITY.RUNNING
        ? CODEX_CONNECTION.WAITING_IDLE
        : CODEX_CONNECTION.CONNECTING,
      error: '',
    });
    this.#rebuildSnapshot();
    this.#startClientLifecycle();
    void this.#connectDesiredThread(id);
    return this.getSnapshot();
  }

  async disconnectThread(threadId) {
    const id = String(threadId || '').trim();
    this.config = normalizeCodexIntegrationConfig({
      ...this.config,
      desiredThreadIds: this.config.desiredThreadIds.filter((item) => item !== id),
    });
    this.#persistConfig();
    this.connectionStates.delete(id);
    if (this.clientReady) {
      try { await this.client.request('thread/unsubscribe', { threadId: id }, 5000); }
      catch { /* The thread may already be unloaded. */ }
    }
    this.#rebuildSnapshot();
    return this.getSnapshot();
  }

  async #reconcileDesiredConnections() {
    if (!this.config.managedReplies || this.config.replyTransport === CODEX_REPLY_TRANSPORT.DESKTOP) return;
    for (const id of this.config.desiredThreadIds) {
      const task = this.tasks.get(id);
      if (!task) continue;
      const current = this.connectionStates.get(id)?.state;
      const ownedActive = Boolean(this.managedTasks.get(id)?.activeTurnId);
      if (task.activity === CODEX_ACTIVITY.RUNNING && !ownedActive) {
        const runtime = this.connectionStates.get(id);
        const connectionState = current === CODEX_CONNECTION.CONNECTED
          ? CODEX_CONNECTION.TEMPORARY_READ_ONLY
          : current || CODEX_CONNECTION.WAITING_IDLE;
        const retryTemporaryReadOnly = connectionState === CODEX_CONNECTION.TEMPORARY_READ_ONLY
          && Number(runtime?.retryAtMs || 0) <= Date.now();
        if (retryTemporaryReadOnly) {
          this.connectionStates.set(id, { state: CODEX_CONNECTION.CONNECTING, error: '' });
          void this.#connectDesiredThread(id);
          continue;
        }
        this.connectionStates.set(id, { ...runtime, state: connectionState, error: '' });
        if (this.clientReady
          && ![CODEX_CONNECTION.CONNECTING, CODEX_CONNECTION.TEMPORARY_READ_ONLY].includes(connectionState)) {
          this.connectionStates.set(id, { state: CODEX_CONNECTION.CONNECTING, error: '' });
          void this.#connectDesiredThread(id);
        }
      } else if (this.clientReady && current !== CODEX_CONNECTION.CONNECTED) {
        void this.#connectDesiredThread(id);
      } else if (!this.clientReady && current !== CODEX_CONNECTION.ERROR) {
        this.connectionStates.set(id, { state: CODEX_CONNECTION.CONNECTING, error: '' });
      }
    }
  }

  async #connectDesiredThread(threadId) {
    if (this.config.replyTransport === CODEX_REPLY_TRANSPORT.DESKTOP) return;
    if (!this.config.desiredThreadIds.includes(threadId)) return;
    try {
      await this.#ensureClient();
      this.connectionStates.set(threadId, { state: CODEX_CONNECTION.CONNECTING, error: '' });
      this.#rebuildSnapshot();
      const resumed = await this.client.request('thread/resume', { threadId }, 15_000);
      const threadStatus = resumed?.thread?.status || {};
      const status = threadStatus.type;
      const active = status === 'active' || status === 'inProgress';
      let thread = resumed?.thread || null;
      let activeTurnId = activeTurnIdFromThread(thread);
      if (active && !activeTurnId) {
        thread = await this.#hydrateThreadMessages(threadId);
        activeTurnId = activeTurnIdFromThread(thread);
      }
      if (active && activeTurnId) {
        this.#setManagedTask(threadId, {
          activity: codexActivityFromThreadStatus(threadStatus),
          activeTurnId,
          updatedAtMs: Date.now(),
        });
        this.connectionStates.set(threadId, { state: CODEX_CONNECTION.CONNECTED, error: '' });
      } else {
        this.connectionStates.set(threadId, {
          state: active ? CODEX_CONNECTION.TEMPORARY_READ_ONLY : CODEX_CONNECTION.CONNECTED,
          error: active ? '任务正在 Codex 中运行，但暂未取得可追加消息的 turn 标识' : '',
          retryAtMs: active ? Date.now() + this.pollIntervalMs : 0,
        });
      }
      if (resumed?.thread?.name) {
        const base = this.tasks.get(threadId) || {};
        this.tasks.set(threadId, { ...base, title: sanitizeTaskTitle(resumed.thread.name) });
      }
    } catch (error) {
      this.connectionStates.set(threadId, { state: CODEX_CONNECTION.ERROR, error: error.message });
    }
    this.#rebuildSnapshot();
  }

  async reply(threadId, text) {
    const message = String(text || '').trim();
    if (!message) throw new Error('请输入要发送的内容');
    const id = String(threadId || '');
    const openDesktop = this.config.replyTransport === CODEX_REPLY_TRANSPORT.DESKTOP;
    if (!this.tasks.has(id)) throw new Error('没有找到这个 Codex 任务');
    if (openDesktop) return { accepted: true, mode: 'desktop-submit', openDesktop: true, threadId: id };
    if (this.connectionStates.get(id)?.state !== CODEX_CONNECTION.CONNECTED) {
      throw new Error('这个任务还没有建立可回复连接，请先连接或前往 Codex 处理');
    }
    await this.#ensureClient();
    let existing = this.managedTasks.get(id);
    if (!existing?.activeTurnId) {
      await this.#refreshClientBeforeIdleTurn(id);
      existing = this.managedTasks.get(id);
    }
    if (existing?.activeTurnId) {
      await this.client.request('turn/steer', {
        threadId: id,
        expectedTurnId: existing.activeTurnId,
        input: [{ type: 'text', text: message }],
      });
      this.#appendManagedMessage(id, 'user', message);
      this.#rebuildSnapshot();
      return { accepted: true, mode: 'steer', openDesktop, threadId: id };
    }
    const permissionOverrides = buildCodexTurnPermissionOverrides(this.config.bypassPermissions);
    const preference = normalizeCodexSessionPreference(this.config.sessionPreferences?.[id]);
    const model = String(this.tasks.get(id)?.model || '');
    const modelInfo = this.reasoningModels.find((item) => item.model === model);
    const reasoningOverrides = modelInfo?.efforts?.length && preference.effort !== 'inherit'
      && !modelInfo.efforts.includes(preference.effort)
      ? {}
      : buildCodexTurnReasoningOverrides(preference);
    const result = await this.client.request('turn/start', {
      threadId: id,
      input: [{ type: 'text', text: message }],
      ...permissionOverrides,
      ...reasoningOverrides,
    });
    const activeTurnId = result?.turn?.id || '';
    this.#appendManagedMessage(id, 'user', message);
    this.#setManagedTask(id, { activity: CODEX_ACTIVITY.RUNNING, activeTurnId, updatedAtMs: Date.now() });
    this.#rebuildSnapshot();
    return { accepted: true, mode: 'turn', turnId: activeTurnId, openDesktop, threadId: id };
  }

  async #refreshClientBeforeIdleTurn(threadId) {
    const hasOwnedWork = this.pendingRequests.size > 0
      || [...this.managedTasks.values()].some((task) => Boolean(task.activeTurnId));
    if (hasOwnedWork) return;

    this.client?.stop();
    this.client = null;
    this.clientReady = false;
    this.catalogSynced = false;
    for (const id of this.config.desiredThreadIds) {
      this.connectionStates.set(id, { state: CODEX_CONNECTION.CONNECTING, error: '' });
    }
    await this.#ensureClient();

    let thread = (await this.client.request('thread/resume', { threadId }, 15_000))?.thread || null;
    const status = thread?.status?.type;
    const active = status === 'active' || status === 'inProgress';
    let activeTurnId = activeTurnIdFromThread(thread);
    if (active && !activeTurnId) {
      thread = await this.#hydrateThreadMessages(threadId);
      activeTurnId = activeTurnIdFromThread(thread);
    }
    if (active && !activeTurnId) {
      this.connectionStates.set(threadId, { state: CODEX_CONNECTION.TEMPORARY_READ_ONLY, error: '' });
      this.#rebuildSnapshot();
      throw new Error('任务正在 Codex 中运行，请等待当前回复结束后再发送');
    }
    this.#setManagedTask(threadId, {
      activity: active ? CODEX_ACTIVITY.RUNNING : CODEX_ACTIVITY.SILENT,
      activeTurnId: activeTurnId || '',
      updatedAtMs: Date.now(),
    });
    this.connectionStates.set(threadId, { state: CODEX_CONNECTION.CONNECTED, error: '' });
    for (const id of this.config.desiredThreadIds) {
      if (id !== threadId) void this.#connectDesiredThread(id);
    }
    this.#rebuildSnapshot();
  }

  async respond(requestId, response = {}) {
    const key = String(requestId || '');
    const pending = this.pendingRequests.get(key);
    if (!pending) throw new Error('这项请求已经结束，或者已在 Codex 中处理');
    if (!pending.supported) throw new Error('这类请求需要前往 Codex 处理');
    let result;
    if (pending.method === 'item/tool/requestUserInput') {
      result = { answers: response.answers || {} };
    } else if (pending.method === 'item/permissions/requestApproval') {
      const accepted = response.decision === 'accept' || response.decision === 'acceptForSession';
      const requestedPermissions = pending.params.permissions || {};
      const grantedPermissions = Object.fromEntries(
        Object.entries(requestedPermissions).filter(([, value]) => value !== null && value !== undefined),
      );
      result = {
        permissions: accepted ? grantedPermissions : {},
        scope: response.decision === 'acceptForSession' ? 'session' : 'turn',
      };
    } else if (pending.method === 'execCommandApproval' || pending.method === 'applyPatchApproval') {
      const decisions = {
        accept: 'approved',
        acceptForSession: 'approved_for_session',
        decline: { denied: { rejection: 'User declined the request' } },
        cancel: 'abort',
      };
      result = { decision: decisions[response.decision] || decisions.decline };
    } else {
      const allowed = ['accept', 'acceptForSession', 'decline', 'cancel'];
      const decision = allowed.includes(response.decision) ? response.decision : 'decline';
      result = { decision };
    }
    this.client.sendServerResponse(pending.rawId, result);
    this.#resolvePendingRequest(key);
    return { accepted: true };
  }

  async interrupt(threadId) {
    const id = String(threadId || '').trim();
    if (!id) throw new Error('没有找到要停止的 Codex 任务');
    if (this.config.replyTransport === CODEX_REPLY_TRANSPORT.DESKTOP) {
      throw new Error('客户端兼容模式请在 Codex 客户端中停止任务');
    }
    await this.#ensureClient();
    const pendingForThread = [...this.pendingRequests.entries()]
      .filter(([, request]) => request.threadId === id);
    const task = this.managedTasks.get(id) || this.tasks.get(id) || {};
    const turnId = String(task.activeTurnId || pendingForThread[0]?.[1]?.params?.turnId || '');
    if (!turnId) throw new Error('这个任务当前没有可停止的回合');
    await this.client.request('turn/interrupt', { threadId: id, turnId }, 12_000);
    for (const [requestId] of pendingForThread) this.#resolvePendingRequest(requestId);
    this.#setManagedTask(id, {
      activity: CODEX_ACTIVITY.SILENT,
      activeTurnId: '',
      updatedAtMs: Date.now(),
    });
    this.#rebuildSnapshot();
    return { interrupted: true, threadId: id, turnId };
  }

  async #ensureClient() {
    if (!this.config.enabled) throw new Error('请先在左键配置页启用 Codex 接入');
    const codexHome = resolveCodexHome(this.config);
    if (!codexHome) throw new Error('没有找到 Codex 数据目录');
    if (!this.client) {
      this.client = this.appServerFactory(codexHome);
      this.client.on('notification', (message) => this.#handleNotification(message));
      this.client.on('server-request', (message) => this.#handleServerRequest(message));
      this.client.on('disconnect', (error) => this.#handleClientDisconnect(error));
      this.client.on('diagnostic', (message) => console.warn('[Codex App Server]', message));
    }
    await this.client.connect();
    this.clientReady = true;
    this.clientRetryIndex = 0;
    if (!this.catalogSynced) {
      try { await this.#syncThreadCatalog(); }
      catch {
        // Older App Server builds can still use rollout sync and direct connections.
        this.catalogSynced = true;
      }
    }
    if (!this.reasoningModelsSynced) {
      try {
        const result = await this.client.request('model/list', { limit: 100, includeHidden: true }, 15_000);
        this.reasoningModels = (result?.data || []).map((model) => ({
          model: String(model?.model || model?.id || ''),
          defaultEffort: String(model?.defaultReasoningEffort || ''),
          efforts: (model?.supportedReasoningEfforts || [])
            .map((item) => String(item?.reasoningEffort || ''))
            .filter(Boolean),
        })).filter((model) => model.model);
      } catch {
        // Older App Server builds still work with inherited thread settings.
      } finally {
        this.reasoningModelsSynced = true;
      }
    }
  }

  async #syncThreadCatalog() {
    const catalog = new Map();
    const seenCursors = new Set();
    let cursor = null;
    do {
      const result = await this.client.request('thread/list', {
        cursor,
        limit: 100,
        sortKey: 'updated_at',
        sortDirection: 'desc',
        sourceKinds: ['cli', 'vscode', 'appServer'],
        useStateDbOnly: true,
      }, 15_000);
      for (const thread of result?.data || []) {
        const id = String(thread?.id || '');
        if (!id) continue;
        const status = thread.status || {};
        const savedName = String(thread.name || '').trim();
        catalog.set(id, {
          id,
          parentThreadId: thread.parentThreadId || thread.forkedFromId || null,
          title: sanitizeTaskTitle(savedName || thread.preview),
          project: sanitizeProjectName(thread.cwd),
          model: String(thread.model || ''),
          activity: codexActivityFromThreadStatus(status),
          updatedAtMs: timestampToMs(thread.updatedAt || thread.createdAt),
          managed: false,
          messages: this.catalogTasks.get(id)?.messages || [],
          hasSavedName: Boolean(savedName),
        });
      }
      const nextCursor = result?.nextCursor ? String(result.nextCursor) : '';
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    } while (seenCursors.size < 100);
    this.catalogTasks = catalog;
    this.catalogSynced = true;
    for (const [id, catalogTask] of catalog) {
      const task = this.tasks.get(id);
      if (!task) this.tasks.set(id, catalogTask);
      else this.tasks.set(id, {
        ...task,
        ...catalogTask,
        title: catalogTask.hasSavedName ? catalogTask.title : task.title,
        messages: catalogTask.messages?.length ? catalogTask.messages : task.messages,
        historyComplete: catalogTask.messages?.length ? true : task.historyComplete,
        updatedAtMs: Math.max(Number(catalogTask.updatedAtMs || 0), Number(task.updatedAtMs || 0)),
      });
    }
  }

  async #hydrateThreadMessages(threadId) {
    try {
      const result = await this.client.request('thread/read', { threadId, includeTurns: true }, 15_000);
      const messages = messagesFromThread(result?.thread);
      if (!messages.length) return result?.thread || null;
      const catalog = this.catalogTasks.get(threadId);
      if (catalog) this.catalogTasks.set(threadId, { ...catalog, messages, historyComplete: true });
      const task = this.tasks.get(threadId);
      if (task) this.tasks.set(threadId, { ...task, messages, historyComplete: true });
      return result?.thread || null;
    } catch {
      // History viewing stays available from local rollout data when App Server is busy.
      return null;
    }
  }

  #startClientLifecycle() {
    if (!this.running || !this.config.enabled || !this.config.managedReplies
      || this.config.replyTransport === CODEX_REPLY_TRANSPORT.DESKTOP || this.clientReady) return;
    if (this.clientRetryTimer) return;
    this.clientRetryTimer = setTimeout(async () => {
      this.clientRetryTimer = null;
      try {
        await this.#ensureClient();
        await this.#reconcileDesiredConnections();
        this.#rebuildSnapshot();
      } catch (error) {
        this.clientReady = false;
        for (const id of this.config.desiredThreadIds) {
          this.connectionStates.set(id, { state: CODEX_CONNECTION.ERROR, error: error.message });
        }
        this.#rebuildSnapshot();
        this.clientRetryIndex = Math.min(this.clientRetryIndex + 1, CLIENT_RETRY_DELAYS.length - 1);
        this.#startClientLifecycle();
      }
    }, CLIENT_RETRY_DELAYS[this.clientRetryIndex] || CLIENT_RETRY_DELAYS.at(-1));
    this.clientRetryTimer.unref?.();
  }

  #handleClientDisconnect(error) {
    this.clientReady = false;
    this.client = null;
    this.catalogSynced = false;
    for (const id of this.config.desiredThreadIds) {
      this.connectionStates.set(id, { state: CODEX_CONNECTION.ERROR, error: error?.message || '连接已断开' });
    }
    for (const task of this.managedTasks.values()) task.activeTurnId = '';
    this.#rebuildSnapshot();
    if (this.config.replyTransport !== CODEX_REPLY_TRANSPORT.DESKTOP) this.#startClientLifecycle();
  }

  #setManagedTask(threadId, patch) {
    const base = this.tasks.get(threadId) || this.managedTasks.get(threadId) || {
      id: threadId,
      title: 'Codex 任务',
      project: '未指定项目',
      managed: true,
      messages: [],
    };
    this.managedTasks.set(threadId, { ...base, ...patch, id: threadId, managed: true });
  }

  #appendManagedMessage(threadId, role, message) {
    const list = this.managedMessages.get(threadId) || [];
    const key = `${role}:${message}`;
    const createdAtMs = Date.now();
    const duplicate = list.some((item) => `${item.role}:${item.message}` === key
      && Math.abs(createdAtMs - Number(item.createdAtMs || 0)) <= 10_000);
    if (duplicate) return;
    list.push({ id: `managed:${threadId}:${createdAtMs}:${list.length}`, role, message, createdAtMs });
    this.managedMessages.set(threadId, list);
  }

  #handleNotification(message) {
    const method = message.method;
    const params = message.params || {};
    if (method === 'serverRequest/resolved') {
      this.#resolvePendingRequest(String(params.requestId || ''));
      return;
    }
    const threadId = String(params.threadId || params.thread?.id || '');
    if (!threadId) return;
    if (method === 'turn/started') {
      for (const [eventId, event] of this.managedUnread) {
        if (event.threadId === threadId && event.activity === CODEX_ACTIVITY.BLOCKED) {
          this.managedUnread.delete(eventId);
        }
      }
      this.#setManagedTask(threadId, {
        activity: CODEX_ACTIVITY.RUNNING,
        activeTurnId: String(params.turn?.id || ''),
        agentText: '',
        updatedAtMs: Date.now(),
      });
      this.connectionStates.set(threadId, { state: CODEX_CONNECTION.CONNECTED, error: '' });
    } else if (method === 'item/agentMessage/delta') {
      const task = this.managedTasks.get(threadId) || {};
      this.#setManagedTask(threadId, {
        activity: CODEX_ACTIVITY.RUNNING,
        agentText: `${task.agentText || ''}${String(params.delta || '')}`,
        updatedAtMs: Date.now(),
      });
    } else if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      const text = String(params.item?.text || params.item?.message || '').trim();
      if (text) {
        this.#appendManagedMessage(threadId, 'assistant', text);
        this.#setManagedTask(threadId, { agentText: text, updatedAtMs: Date.now() });
      }
    } else if (method === 'turn/completed') {
      const task = this.managedTasks.get(threadId) || this.tasks.get(threadId) || {};
      const turnId = String(params.turn?.id || task.activeTurnId || Date.now());
      const failed = ['failed', 'interrupted'].includes(params.turn?.status);
      const activity = failed ? CODEX_ACTIVITY.BLOCKED : CODEX_ACTIVITY.READY;
      const eventId = `${threadId}:${turnId}:${activity}`;
      this.#setManagedTask(threadId, { activity: CODEX_ACTIVITY.SILENT, activeTurnId: '', updatedAtMs: Date.now() });
      this.managedUnread.set(eventId, {
        id: eventId,
        threadId,
        turnId,
        title: task.title || 'Codex 任务',
        project: task.project || '未指定项目',
        activity,
        kind: failed ? 'failed' : 'completed',
        message: failed ? '任务执行中断，请查看详情。' : (task.agentText || '任务已经完成。'),
        createdAtMs: Date.now(),
        managed: true,
        canReply: !failed,
      });
      this.connectionStates.set(threadId, { state: CODEX_CONNECTION.CONNECTED, error: '' });
    } else if (method === 'thread/status/changed') {
      const status = params.status || {};
      const activity = codexActivityFromThreadStatus(status);
      const systemError = activity === CODEX_ACTIVITY.BLOCKED;
      const ownActive = Boolean(this.managedTasks.get(threadId)?.activeTurnId);
      this.#setManagedTask(threadId, {
        activity,
        updatedAtMs: Date.now(),
      });
      if (systemError) {
        const task = this.managedTasks.get(threadId) || this.tasks.get(threadId) || {};
        const eventId = `${threadId}:${task.activeTurnId || 'system'}:${CODEX_ACTIVITY.BLOCKED}`;
        this.managedUnread.set(eventId, {
          id: eventId,
          threadId,
          turnId: task.activeTurnId || null,
          title: task.title || 'Codex 任务',
          project: task.project || '未指定项目',
          activity: CODEX_ACTIVITY.BLOCKED,
          kind: 'failed',
          message: String(status.error?.message || status.message || 'Codex 任务遇到系统错误，请查看详情。'),
          createdAtMs: Date.now(),
          managed: true,
          canReply: false,
        });
      }
      if (status.type === 'active' && !ownActive) {
        this.connectionStates.set(threadId, {
          state: CODEX_CONNECTION.TEMPORARY_READ_ONLY,
          error: '',
          retryAtMs: Date.now() + this.pollIntervalMs,
        });
      } else if (status.type !== 'active' && this.config.desiredThreadIds.includes(threadId)) {
        this.connectionStates.set(threadId, { state: CODEX_CONNECTION.CONNECTED, error: '' });
      }
    } else if (method === 'thread/name/updated') {
      const task = this.tasks.get(threadId);
      const title = sanitizeTaskTitle(params.name || params.thread?.name);
      if (task) this.tasks.set(threadId, { ...task, title, hasSavedName: true });
      const catalog = this.catalogTasks.get(threadId);
      if (catalog) this.catalogTasks.set(threadId, { ...catalog, title, hasSavedName: true });
    }
    this.#rebuildSnapshot();
  }

  #handleServerRequest(message) {
    const method = String(message.method || '');
    const params = message.params || {};
    const threadId = String(params.threadId || params.conversationId || '');
    if (!threadId) return;
    const requestId = String(message.id);
    const eventId = `managed-request:${requestId}`;
    let messageText = String(params.reason || '').trim();
    let kind = 'unsupported';
    let supported = true;
    if (method === 'item/tool/requestUserInput') {
      kind = 'question';
      messageText = (params.questions || []).map((question) => question.question).filter(Boolean).join('\n');
    } else if (method === 'item/commandExecution/requestApproval') {
      kind = 'commandApproval';
      messageText ||= params.command ? `Codex 请求运行：\n${params.command}` : 'Codex 请求运行一项操作。';
    } else if (method === 'item/fileChange/requestApproval') {
      kind = 'fileApproval';
      messageText ||= 'Codex 请求修改文件。';
    } else if (method === 'item/permissions/requestApproval') {
      kind = 'permissionApproval';
      messageText ||= 'Codex 请求额外的文件或网络权限。';
    } else if (method === 'execCommandApproval') {
      kind = 'commandApproval';
      const command = Array.isArray(params.command) ? params.command.join(' ') : String(params.command || '');
      messageText ||= command ? `Codex 请求运行：\n${command}` : 'Codex 请求运行一项操作。';
    } else if (method === 'applyPatchApproval') {
      kind = 'fileApproval';
      messageText ||= 'Codex 请求修改文件。';
    } else {
      supported = false;
      messageText ||= '这类请求需要前往 Codex 处理。';
    }
    const task = this.managedTasks.get(threadId) || this.tasks.get(threadId) || {};
    const event = {
      id: eventId,
      threadId,
      turnId: params.turnId || null,
      title: task.title || 'Codex 任务',
      project: task.project || '未指定项目',
      activity: CODEX_ACTIVITY.NEEDS_INPUT,
      kind,
      message: messageText || 'Codex 正在等待你的选择。',
      createdAtMs: Number(params.startedAtMs || Date.now()),
      managed: true,
      canReply: supported,
      requestId,
      supported,
      questions: method === 'item/tool/requestUserInput' ? params.questions || [] : [],
      availableDecisions: params.availableDecisions || ['accept', 'acceptForSession', 'decline', 'cancel'],
    };
    this.pendingRequests.set(requestId, {
      rawId: message.id,
      method,
      params,
      eventId,
      threadId,
      supported,
    });
    this.managedUnread.set(eventId, event);
    this.#setManagedTask(threadId, { activity: CODEX_ACTIVITY.NEEDS_INPUT, updatedAtMs: Date.now() });
    this.#rebuildSnapshot();
  }

  #resolvePendingRequest(requestId) {
    const pending = this.pendingRequests.get(String(requestId));
    if (!pending) return;
    this.pendingRequests.delete(String(requestId));
    this.managedUnread.delete(pending.eventId);
    const task = this.managedTasks.get(pending.threadId);
    if (task?.activity === CODEX_ACTIVITY.NEEDS_INPUT) task.activity = task.activeTurnId ? CODEX_ACTIVITY.RUNNING : CODEX_ACTIVITY.SILENT;
    this.#rebuildSnapshot();
  }

  #persistConfig() { this.onConfigChange?.(this.getConfig()); }

  #emptySnapshot() {
    return {
      configured: false,
      enabled: false,
      connected: false,
      controlConnected: false,
      locale: this.locale,
      homeLabel: '',
      source: 'none',
      reasoningModels: [],
      activity: CODEX_ACTIVITY.DISCONNECTED,
      tasks: [],
      unread: [],
      alerts: [],
      unreadCount: 0,
      runningCount: 0,
      unreadTaskCount: 0,
      visibleTasks: [],
      updatedAtMs: Date.now(),
      reason: 'Codex 接入尚未启用',
    };
  }

  #sendSnapshot() {
    if (!this.window || this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
    this.window.webContents.send('codex-status', this.lastSnapshot);
  }
}
