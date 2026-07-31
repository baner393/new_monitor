import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import {
  CODEX_ACTIVITY,
  buildCodexVisibleTasks,
  normalizeCodexIntegrationConfig,
  resolveCodexActivity,
  sanitizeProjectName,
  sanitizeTaskTitle,
  sortCodexUnreadEvents,
} from '../shared/codex-integration.js';

const MAX_SESSION_FILES = 120;
const ROLLOUT_HEAD_BYTES = 96 * 1024;
const ROLLOUT_TAIL_BYTES = 1024 * 1024;
const RUNNING_STALE_MS = 5 * 60 * 1000;

function finiteTimestamp(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textFromMessageContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((item) => item?.type === 'output_text' || item?.type === 'input_text')
    .map((item) => String(item?.text || ''))
    .join('\n')
    .trim();
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function uniqueLines(head, tail) {
  if (!head) return tail || '';
  if (!tail || head === tail) return head;
  return `${head}\n${tail}`;
}

export function parseCodexRollout(text, {
  filePath = '',
  modifiedAtMs = 0,
  enabledAtMs = 0,
  readEventIds = new Set(),
} = {}) {
  let threadId = '';
  let cwd = '';
  let title = '';
  let lastAgentMessage = '';
  let lastStartedAtMs = 0;
  let lastFinishedAtMs = 0;
  let lastActivityAtMs = modifiedAtMs;
  let lastTurnId = '';
  let lastFinishKind = '';
  const messages = [];
  const messageKeys = new Set();

  const appendMessage = (role, value, timestamp) => {
    const message = String(value || '').trim();
    if (!message) return;
    const createdAtMs = finiteTimestamp(timestamp, modifiedAtMs);
    const key = `${role}:${createdAtMs}:${message}`;
    if (messageKeys.has(key)) return;
    messageKeys.add(key);
    messages.push({ id: key.slice(0, 240), role, message, createdAtMs });
    if (messages.length > 64) messages.shift();
  };

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const row = parseLine(rawLine);
    if (!row) continue;
    const timestamp = finiteTimestamp(row.timestamp, modifiedAtMs);
    lastActivityAtMs = Math.max(lastActivityAtMs, timestamp);
    const payload = row.payload || {};

    if (row.type === 'session_meta') {
      threadId ||= String(payload.id || payload.session_id || '');
      cwd ||= String(payload.cwd || '');
      continue;
    }
    if (row.type === 'turn_context') {
      cwd = String(payload.cwd || cwd || '');
      lastTurnId = String(payload.turn_id || lastTurnId || '');
      continue;
    }
    if (row.type === 'event_msg') {
      if (payload.type === 'user_message') {
        if (!title) title = String(payload.message || '').trim();
        appendMessage('user', payload.message, timestamp);
      } else if (payload.type === 'agent_message') {
        lastAgentMessage = String(payload.message || lastAgentMessage || '').trim();
        appendMessage('assistant', payload.message, timestamp);
      } else if (payload.type === 'task_started') {
        lastStartedAtMs = Math.max(lastStartedAtMs, finiteTimestamp(payload.started_at, timestamp));
        lastTurnId = String(payload.turn_id || lastTurnId || '');
      } else if (payload.type === 'task_complete') {
        lastFinishedAtMs = Math.max(lastFinishedAtMs, finiteTimestamp(payload.completed_at, timestamp));
        lastTurnId = String(payload.turn_id || lastTurnId || '');
        lastFinishKind = 'completed';
        lastAgentMessage = String(payload.last_agent_message || lastAgentMessage || '').trim();
      } else if (payload.type === 'turn_aborted') {
        lastFinishedAtMs = Math.max(lastFinishedAtMs, timestamp);
        lastTurnId = String(payload.turn_id || lastTurnId || '');
        lastFinishKind = 'aborted';
      }
      continue;
    }
    if (row.type === 'response_item' && payload.type === 'message') {
      const messageText = textFromMessageContent(payload.content);
      if (payload.role === 'user' && !title) title = messageText;
      if (payload.role === 'assistant' && messageText) lastAgentMessage = messageText;
      appendMessage(payload.role === 'assistant' ? 'assistant' : 'user', messageText, timestamp);
    }
  }

  if (!threadId) {
    threadId = path.basename(filePath || '', path.extname(filePath || ''));
  }
  if (!threadId) return null;

  const running = lastStartedAtMs > lastFinishedAtMs
    && Date.now() - Math.max(lastActivityAtMs, modifiedAtMs) <= RUNNING_STALE_MS;
  const task = {
    id: threadId,
    title: sanitizeTaskTitle(title),
    project: sanitizeProjectName(cwd),
    activity: running ? CODEX_ACTIVITY.RUNNING : CODEX_ACTIVITY.SILENT,
    updatedAtMs: Math.max(lastActivityAtMs, lastFinishedAtMs, lastStartedAtMs, modifiedAtMs),
    managed: false,
    messages,
  };

  let unread = null;
  if (lastFinishKind && lastFinishedAtMs >= enabledAtMs) {
    const activity = lastFinishKind === 'completed' ? CODEX_ACTIVITY.READY : CODEX_ACTIVITY.BLOCKED;
    const eventId = `${threadId}:${lastTurnId || lastFinishedAtMs}:${activity}`;
    if (!readEventIds.has(eventId)) {
      unread = {
        id: eventId,
        threadId,
        turnId: lastTurnId || null,
        title: task.title,
        project: task.project,
        activity,
        kind: lastFinishKind,
        message: lastFinishKind === 'completed'
          ? (lastAgentMessage || '任务已经完成。')
          : '任务已中断，打开 Codex 可查看具体原因。',
        createdAtMs: lastFinishedAtMs,
        managed: false,
        canReply: lastFinishKind === 'completed',
      };
    }
  }
  return { task, unread };
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
      // A configured path may be temporarily unavailable (for example, a
      // disconnected roaming profile). Continue with the next portable path.
    }
  }
  return null;
}

async function readRolloutWindow(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const headLength = Math.min(ROLLOUT_HEAD_BYTES, stat.size);
    const tailStart = Math.max(0, stat.size - ROLLOUT_TAIL_BYTES);
    const tailLength = Math.max(0, stat.size - tailStart);
    const head = Buffer.alloc(headLength);
    const tail = Buffer.alloc(tailLength);
    if (headLength) await handle.read(head, 0, headLength, 0);
    if (tailLength) await handle.read(tail, 0, tailLength, tailStart);
    return {
      text: uniqueLines(head.toString('utf8'), tail.toString('utf8')),
      modifiedAtMs: stat.mtimeMs,
    };
  } finally {
    await handle.close();
  }
}

async function collectSessionFiles(root) {
  const found = [];
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const stat = await fs.promises.stat(fullPath);
          found.push({ path: fullPath, modifiedAtMs: stat.mtimeMs });
        } catch {
          // The session may rotate between readdir and stat.
        }
      }
    }
  }
  return found
    .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)
    .slice(0, MAX_SESSION_FILES);
}

function findCliPathInConfig(codexHome) {
  try {
    const config = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    const match = config.match(/^cli_path\s*=\s*["']([^"']+)["']/m);
    return match?.[1] ? path.resolve(match[1]) : null;
  } catch {
    return null;
  }
}

function resolveCodexExecutables(codexHome) {
  const candidates = [];
  const configured = findCliPathInConfig(codexHome);
  if (configured) candidates.push(configured);
  if (process.env.CODEX_CLI_PATH) candidates.push(path.resolve(process.env.CODEX_CLI_PATH));
  if (process.platform === 'win32') {
    const binRoot = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
    try {
      const versions = fs.readdirSync(binRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(binRoot, entry.name, 'codex.exe'))
        .filter((candidate) => fs.existsSync(candidate))
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
      candidates.push(...versions);
    } catch {
      // Codex desktop may not be installed; PATH remains the final fallback.
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
    this.nextId = 10000;
    this.pending = new Map();
    this.connecting = null;
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
        if (!settled) fail(error);
        this.#rejectPending(error);
        this.emit('disconnect', error);
      });
      child.stderr.on('data', (chunk) => {
        const message = String(chunk || '').trim();
        if (message) this.emit('diagnostic', message.slice(0, 500));
      });
      this.reader = readline.createInterface({ input: child.stdout });
      this.reader.on('line', (line) => this.#onLine(line));

      const timeout = setTimeout(() => fail(new Error('Codex App Server 初始化超时')), 8000);
      this.request('initialize', {
        clientInfo: { name: 'new_monitor', title: 'Turtle Monitor', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      }, 7500).then(() => {
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

  request(method, params, timeoutMs = 12000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`${method} 请求超时`));
      }, timeoutMs);
      this.pending.set(String(id), { resolve, reject, timeout });
      try {
        this.#write({ id, method, params });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(String(id));
        reject(error);
      }
    });
  }

  sendNotification(method, params) {
    this.#write({ method, params });
  }

  sendServerResponse(id, result) {
    this.#write({ id, result });
  }

  #rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  stop() {
    this.reader?.close();
    this.reader = null;
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
    this.#rejectPending(new Error('Codex 双向连接已关闭'));
  }
}

export class CodexMonitor {
  constructor({ config, onConfigChange, pollIntervalMs = 1500 } = {}) {
    this.config = normalizeCodexIntegrationConfig(config);
    this.onConfigChange = onConfigChange;
    this.pollIntervalMs = pollIntervalMs;
    this.idlePollIntervalMs = Math.max(5000, pollIntervalMs);
    this.window = null;
    this.timer = null;
    this.running = false;
    this.watcher = null;
    this.watchedRoot = '';
    this.watchDebounce = null;
    this.scanPromise = null;
    this.scanAgain = false;
    this.tasks = new Map();
    this.managedTasks = new Map();
    this.managedUnread = new Map();
    this.pendingRequests = new Map();
    this.client = null;
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
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.watchDebounce) clearTimeout(this.watchDebounce);
    this.timer = null;
    this.watchDebounce = null;
    this.#closeWatcher();
    this.client?.stop();
    this.client = null;
  }

  getConfig() {
    return { ...this.config, readEventIds: [...this.config.readEventIds] };
  }

  updateConfig(next) {
    const wasEnabled = this.config.enabled;
    this.config = normalizeCodexIntegrationConfig({ ...this.config, ...next });
    if (!wasEnabled && this.config.enabled) this.config.enabledAtMs = Date.now();
    this.onConfigChange?.(this.getConfig());
    if (!this.config.enabled) {
      this.tasks.clear();
      this.managedUnread.clear();
      this.client?.stop();
      this.client = null;
    }
    this.scan(true);
    return this.getConfig();
  }

  getSnapshot() {
    return structuredClone(this.lastSnapshot);
  }

  scan(force = false) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.scanPromise) {
      if (force) this.scanAgain = true;
      return this.scanPromise;
    }
    this.scanPromise = (async () => {
      let nextForce = force;
      do {
        this.scanAgain = false;
        await this.#scanOnce(nextForce);
        nextForce = true;
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
          reason: this.config.homeMode === 'manual'
            ? '选择的 Codex 数据目录不存在'
            : '本机没有检测到 Codex 数据目录',
        };
        this.#sendSnapshot();
        return;
      }
      const sessionsRoot = path.join(codexHome, 'sessions');
      if (!fs.existsSync(sessionsRoot)) {
        this.#watchSessions(codexHome);
        this.lastSnapshot = {
          ...this.#emptySnapshot(),
          configured: true,
          homeLabel: this.config.homeMode === 'manual' ? '手动目录' : '自动检测',
          reason: 'Codex 已连接，但还没有本地对话记录',
        };
        this.#sendSnapshot();
        return;
      }

      this.#watchSessions(sessionsRoot);

      const files = await collectSessionFiles(sessionsRoot);
      const readIds = new Set(this.config.readEventIds);
      const nextTasks = new Map();
      const unread = [];
      for (const file of files) {
        try {
          const window = await readRolloutWindow(file.path);
          const parsed = parseCodexRollout(window.text, {
            filePath: file.path,
            modifiedAtMs: window.modifiedAtMs,
            enabledAtMs: this.config.enabledAtMs,
            readEventIds: readIds,
          });
          if (!parsed) continue;
          nextTasks.set(parsed.task.id, parsed.task);
          if (parsed.unread) unread.push(parsed.unread);
        } catch (error) {
          if (force) console.warn('[Codex] Session read failed:', error.message);
        }
      }
      this.tasks = nextTasks;
      for (const [id, task] of this.managedTasks) this.tasks.set(id, { ...this.tasks.get(id), ...task });
      const unreadById = new Map([...unread, ...this.managedUnread.values()]
        .filter((event) => !readIds.has(event.id))
        .map((event) => [event.id, event]));
      const allUnread = [...unreadById.values()];
      const allTasks = [...this.tasks.values()];
      const tasks = allTasks
        .filter((task) => task.activity !== CODEX_ACTIVITY.SILENT)
        .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
      const sortedUnread = sortCodexUnreadEvents(allUnread);
      const taskSummary = buildCodexVisibleTasks(allTasks, sortedUnread);
      this.lastSnapshot = {
        configured: true,
        enabled: true,
        connected: true,
        homeLabel: this.config.homeMode === 'manual' ? '手动目录' : '自动检测',
        source: this.client ? 'managed+sessions' : 'sessions',
        activity: resolveCodexActivity({ connected: true, tasks, unread: sortedUnread }),
        tasks,
        unread: sortedUnread,
        unreadCount: sortedUnread.length,
        ...taskSummary,
        updatedAtMs: Date.now(),
        reason: '',
      };
      this.#sendSnapshot();
  }

  #scheduleScan() {
    if (!this.running || this.timer) return;
    const active = this.lastSnapshot.activity === CODEX_ACTIVITY.RUNNING
      || this.lastSnapshot.tasks?.some((task) => task.activity === CODEX_ACTIVITY.RUNNING);
    const delay = active ? this.pollIntervalMs : this.idlePollIntervalMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.scan();
    }, delay);
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
        if (this.watchDebounce) clearTimeout(this.watchDebounce);
        this.watchDebounce = setTimeout(() => {
          this.watchDebounce = null;
          this.scan(true);
        }, 120);
        this.watchDebounce.unref?.();
      });
      this.watchedRoot = resolved;
      this.watcher.on('error', () => this.#closeWatcher());
    } catch {
      this.#closeWatcher();
    }
  }

  #closeWatcher() {
    this.watcher?.close();
    this.watcher = null;
    this.watchedRoot = '';
  }

  markRead(eventId) {
    const id = String(eventId || '').slice(0, 240);
    if (!id) return this.getSnapshot();
    const next = [...this.config.readEventIds.filter((item) => item !== id), id].slice(-512);
    this.config = normalizeCodexIntegrationConfig({ ...this.config, readEventIds: next });
    this.managedUnread.delete(id);
    this.onConfigChange?.(this.getConfig());
    this.scan(true);
    return this.getSnapshot();
  }

  async reply(threadId, text) {
    const message = String(text || '').trim();
    if (!message) throw new Error('请输入要发送的内容');
    await this.#ensureClient();
    const id = String(threadId || '');
    const existing = this.managedTasks.get(id);
    if (existing?.activeTurnId) {
      await this.client.request('turn/steer', {
        threadId: id,
        expectedTurnId: existing.activeTurnId,
        input: [{ type: 'text', text: message }],
      });
      return { accepted: true, mode: 'steer' };
    }
    const resumed = await this.client.request('thread/resume', { threadId: id });
    const status = resumed?.thread?.status?.type;
    if (status === 'active' && !existing?.activeTurnId) {
      throw new Error('这个任务仍由 Codex 桌面端运行，请先在原任务中完成当前操作');
    }
    const result = await this.client.request('turn/start', {
      threadId: id,
      input: [{ type: 'text', text: message }],
    });
    const activeTurnId = result?.turn?.id || '';
    this.#setManagedTask(id, { activity: CODEX_ACTIVITY.RUNNING, activeTurnId, updatedAtMs: Date.now() });
    this.scan(true);
    return { accepted: true, mode: 'turn', turnId: activeTurnId };
  }

  async respond(requestId, response = {}) {
    const key = String(requestId || '');
    const pending = this.pendingRequests.get(key);
    if (!pending) throw new Error('这项请求已经结束或已在 Codex 中处理');
    let result;
    if (pending.method === 'item/tool/requestUserInput') {
      result = { answers: response.answers || {} };
    } else if (pending.method === 'item/permissions/requestApproval') {
      const accepted = response.decision === 'accept' || response.decision === 'acceptForSession';
      result = {
        permissions: accepted ? (pending.params.permissions || {}) : {},
        scope: response.decision === 'acceptForSession' ? 'session' : 'turn',
      };
    } else {
      const allowed = ['accept', 'acceptForSession', 'decline', 'cancel'];
      const decision = allowed.includes(response.decision) ? response.decision : 'decline';
      result = { decision };
    }
    this.client.sendServerResponse(pending.rawId, result);
    this.pendingRequests.delete(key);
    this.markRead(pending.eventId);
    return { accepted: true };
  }

  async #ensureClient() {
    if (!this.config.enabled) throw new Error('请先在左键配置页启用 Codex 接入');
    if (!this.config.managedReplies) throw new Error('请先开启“允许气泡回复与审批”');
    const codexHome = resolveCodexHome(this.config);
    if (!codexHome) throw new Error('没有找到 Codex 数据目录');
    if (!this.client) {
      this.client = new CodexAppServerClient(codexHome);
      this.client.on('notification', (message) => this.#handleNotification(message));
      this.client.on('server-request', (message) => this.#handleServerRequest(message));
      this.client.on('disconnect', () => {
        this.client = null;
        for (const task of this.managedTasks.values()) {
          task.activeTurnId = '';
          if (task.activity === CODEX_ACTIVITY.RUNNING) task.activity = CODEX_ACTIVITY.SILENT;
        }
        this.scan(true);
      });
    }
    await this.client.connect();
  }

  #setManagedTask(threadId, patch) {
    const base = this.tasks.get(threadId) || this.managedTasks.get(threadId) || {
      id: threadId,
      title: 'Codex 任务',
      project: '未指定项目',
      managed: true,
    };
    this.managedTasks.set(threadId, { ...base, ...patch, id: threadId, managed: true });
  }

  #handleNotification(message) {
    const method = message.method;
    const params = message.params || {};
    const threadId = String(params.threadId || params.thread?.id || '');
    if (!threadId) return;
    if (method === 'turn/started') {
      this.#setManagedTask(threadId, {
        activity: CODEX_ACTIVITY.RUNNING,
        activeTurnId: String(params.turn?.id || ''),
        agentText: '',
        updatedAtMs: Date.now(),
      });
    } else if (method === 'item/agentMessage/delta') {
      const task = this.managedTasks.get(threadId) || {};
      this.#setManagedTask(threadId, {
        activity: CODEX_ACTIVITY.RUNNING,
        agentText: `${task.agentText || ''}${String(params.delta || '')}`,
        updatedAtMs: Date.now(),
      });
    } else if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      const text = String(params.item?.text || params.item?.message || '').trim();
      if (text) this.#setManagedTask(threadId, { agentText: text, updatedAtMs: Date.now() });
    } else if (method === 'turn/completed') {
      const task = this.managedTasks.get(threadId) || this.tasks.get(threadId) || {};
      const turnId = String(params.turn?.id || task.activeTurnId || Date.now());
      const failed = ['failed', 'interrupted'].includes(params.turn?.status);
      const activity = failed ? CODEX_ACTIVITY.BLOCKED : CODEX_ACTIVITY.READY;
      const eventId = `${threadId}:${turnId}:${activity}`;
      this.#setManagedTask(threadId, {
        activity: CODEX_ACTIVITY.SILENT,
        activeTurnId: '',
        updatedAtMs: Date.now(),
      });
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
    } else if (method === 'thread/status/changed') {
      const status = params.status || {};
      const needsInput = status.type === 'active'
        && (status.activeFlags || []).some((flag) => flag === 'waitingOnApproval' || flag === 'waitingOnUserInput');
      this.#setManagedTask(threadId, {
        activity: needsInput ? CODEX_ACTIVITY.NEEDS_INPUT
          : status.type === 'active' ? CODEX_ACTIVITY.RUNNING : CODEX_ACTIVITY.SILENT,
        updatedAtMs: Date.now(),
      });
    }
    this.scan(true);
  }

  #handleServerRequest(message) {
    const method = String(message.method || '');
    const params = message.params || {};
    const threadId = String(params.threadId || '');
    if (!threadId) return;
    const requestId = String(message.id);
    const eventId = `managed-request:${requestId}`;
    let messageText = String(params.reason || '').trim();
    let kind = 'approval';
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
    } else {
      this.client.sendServerResponse(message.id, { decision: 'decline' });
      return;
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
      canReply: true,
      requestId,
      questions: method === 'item/tool/requestUserInput' ? params.questions || [] : [],
      availableDecisions: params.availableDecisions || ['accept', 'acceptForSession', 'decline'],
    };
    this.pendingRequests.set(requestId, { rawId: message.id, method, params, eventId });
    this.managedUnread.set(eventId, event);
    this.#setManagedTask(threadId, { activity: CODEX_ACTIVITY.NEEDS_INPUT, updatedAtMs: Date.now() });
    this.scan(true);
  }

  #emptySnapshot() {
    return {
      configured: false,
      enabled: false,
      connected: false,
      homeLabel: '',
      source: 'none',
      activity: CODEX_ACTIVITY.DISCONNECTED,
      tasks: [],
      unread: [],
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
