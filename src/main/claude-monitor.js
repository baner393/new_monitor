import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import {
  CLAUDE_ACTIVITY,
  CLAUDE_CONNECTION,
  CLAUDE_REPLY_TRANSPORT,
  buildClaudeVisibleTasks,
  normalizeClaudeIntegrationConfig,
  normalizeClaudeTask,
  resolveClaudeActivity,
  sortClaudeUnreadEvents,
} from '../shared/claude-integration.js';
import { sanitizeProjectName, sanitizeTaskTitle } from '../shared/codex-integration.js';

const MAX_SESSION_FILES = 160;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_MESSAGES = 500;
const RUNNING_STALE_MS = 45 * 60 * 1000;
const DEFAULT_POLL_MS = 3000;
const CLAUDE_PERMISSION_MODES = new Set(['default', 'manual', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions']);
const CLAUDE_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultracode']);

function cleanText(value, limit = 100_000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, limit);
}

export function normalizeClaudePermissionMode(value) {
  const mode = cleanText(value, 40);
  return CLAUDE_PERMISSION_MODES.has(mode) ? mode : '';
}

export function normalizeClaudeEffort(value) {
  const effort = cleanText(value, 20).toLowerCase();
  return CLAUDE_EFFORT_LEVELS.has(effort) ? effort : '';
}

export function buildClaudeDirectArgs({ sessionId = '', message = '', permissionMode = '', effort = '' } = {}) {
  const args = [
    '-p', '--resume', cleanText(sessionId, 240),
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
  ];
  const normalizedMode = normalizeClaudePermissionMode(permissionMode);
  if (normalizedMode) args.push('--permission-mode', normalizedMode);
  // Do not forward transcript effort as a CLI override. Claude Code can resume
  // sessions through gateways whose thinking schema differs from the local CLI;
  // --effort takes precedence over the working user/project configuration and
  // can make the follow-up request after a tool result fail with API 400.
  void effort;
  args.push(cleanText(message));
  return args;
}

export function formatClaudeManagedError(diagnostic, { effort = '', retried = false } = {}) {
  const cleaned = String(diagnostic || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/sk-[A-Za-z0-9_-]+/g, 'TOKEN')
    .replace(/\s+/g, ' ')
    .trim();
  if (/(?:\b400\b|bad\s*request|invalid_request)/i.test(cleaned)
    && /['"]?type['"]?.{0,80}(?:enabled|disabled).{0,40}auto/i.test(cleaned)) {
    return 'Claude Code API 400：模型网关拒绝了本次请求中的 thinking 类型。Monitor 直连已停止覆盖推理强度，请更新客户端后重新建立直连。';
  }
  if (/(?:\b400\b|bad\s*request|invalid_request)/i.test(cleaned)
    && /effort|thinking|reasoning/i.test(cleaned)) {
    return retried
      ? `Claude Code API 400：当前模型不接受 ${normalizeClaudeEffort(effort) || '该'} 推理强度，降级到 low 后仍失败。`
      : `Claude Code API 400：当前模型不接受 ${normalizeClaudeEffort(effort) || '该'} 推理强度。`;
  }
  return cleaned ? `Claude Code 直连失败：${cleaned.slice(0, 500)}` : 'Claude Code 直连进程异常退出。';
}

function timestampMs(value, fallback = 0) {
  if (Number.isFinite(Number(value))) {
    const number = Number(value);
    return number < 1e12 ? number * 1000 : number;
  }
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseLine(line) {
  try { return JSON.parse(line); }
  catch { return null; }
}

function stringifyToolValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return cleanText(value);
  try { return cleanText(JSON.stringify(value, null, 2)); }
  catch { return cleanText(String(value)); }
}

function messageContentBlocks(message) {
  if (typeof message?.content === 'string') return [{ type: 'text', text: message.content }];
  return Array.isArray(message?.content) ? message.content : [];
}

function appendMessage(state, role, message, createdAtMs, kind = 'message', id = '') {
  const text = cleanText(message);
  if (!text) return;
  const key = `${role}:${kind}:${text}`;
  const previous = state.messages.at(-1);
  if (previous?.key === key && Math.abs(createdAtMs - previous.createdAtMs) < 2000) return;
  state.messages.push({
    id: id || `claude:${state.sessionId || 'session'}:${createdAtMs}:${state.messages.length}`,
    role,
    kind,
    message: text,
    createdAtMs,
    key,
  });
  if (state.messages.length > MAX_MESSAGES) state.messages.splice(0, state.messages.length - MAX_MESSAGES);
}

export function createClaudeTranscriptState({ filePath = '', modifiedAtMs = 0 } = {}) {
  return {
    filePath,
    modifiedAtMs,
    sessionId: path.basename(filePath, path.extname(filePath)),
    cwd: '',
    title: '',
    firstPrompt: '',
    entrypoint: '',
    messages: [],
    pendingTools: new Map(),
    lastActivityAtMs: modifiedAtMs,
    lastUserAtMs: 0,
    lastAssistantAtMs: 0,
    lastFinishedAtMs: 0,
    lastFinishedEventKey: '',
    lastTerminalAssistantAtMs: 0,
    lastFailureAtMs: 0,
    lastFailureEventKey: '',
    lastMessageUuid: '',
    permissionMode: '',
    effort: '',
    model: '',
  };
}

function applyClaudeRow(state, row) {
  if (!row || row.isSidechain === true) return;
  state.sessionId = cleanText(row.sessionId || row.session_id || state.sessionId, 240);
  state.cwd = cleanText(row.cwd || state.cwd, 2048);
  state.entrypoint = cleanText(row.entrypoint || state.entrypoint, 80);
  state.permissionMode = cleanText(row.permissionMode || state.permissionMode, 40);
  state.effort = normalizeClaudeEffort(row.effort || state.effort);
  const at = timestampMs(row.timestamp, state.modifiedAtMs);
  state.lastActivityAtMs = Math.max(state.lastActivityAtMs, at);
  if (row.uuid) state.lastMessageUuid = String(row.uuid);

  if (row.type === 'custom-title') {
    state.title = cleanText(row.customTitle, 200);
    return;
  }
  if (row.type === 'ai-title' && !state.title) {
    state.title = cleanText(row.aiTitle, 200);
    return;
  }
  if (row.type === 'permission-mode') {
    state.permissionMode = cleanText(row.permissionMode, 40);
    return;
  }
  if (row.type === 'system') {
    if (row.subtype === 'turn_duration' && at >= state.lastFinishedAtMs) {
      state.lastFinishedAtMs = at;
      if (state.lastTerminalAssistantAtMs < state.lastUserAtMs) {
        state.lastFinishedEventKey = cleanText(row.uuid || row.messageId || at, 240);
      }
    }
    if ((row.subtype === 'api_error' || row.error) && at >= state.lastFailureAtMs) {
      state.lastFailureAtMs = at;
      state.lastFailureEventKey = cleanText(row.uuid || row.messageId || at, 240);
    }
    return;
  }
  if (row.type === 'assistant') {
    const rowModel = cleanText(row.message?.model || row.model, 200);
    if (rowModel && rowModel !== '<synthetic>') state.model = rowModel;
    state.lastAssistantAtMs = Math.max(state.lastAssistantAtMs, at);
    if ((row.isApiErrorMessage || row.error) && at >= state.lastFailureAtMs) {
      state.lastFailureAtMs = at;
      state.lastFailureEventKey = cleanText(row.uuid || at, 240);
    }
    const blocks = messageContentBlocks(row.message);
    let hasAssistantText = false;
    for (const block of blocks) {
      if (block?.type === 'text') {
        if (cleanText(block.text)) hasAssistantText = true;
        appendMessage(state, 'assistant', block.text, at, 'message', row.uuid);
      } else if (block?.type === 'thinking') {
        appendMessage(state, 'tool', block.thinking || block.text, at, 'thinking', `${row.uuid || at}:thinking`);
      } else if (block?.type === 'tool_use') {
        const toolName = cleanText(block.name || 'tool', 100);
        const toolText = stringifyToolValue(block.input);
        appendMessage(
          state,
          'tool',
          toolText ? `${toolName}\n${toolText}` : toolName,
          at,
          toolName === 'AskUserQuestion' ? 'question' : 'tool-call',
          block.id || `${row.uuid || at}:tool`,
        );
        if (block.id) state.pendingTools.set(String(block.id), { name: toolName, input: block.input, createdAtMs: at });
      }
    }
    if (hasAssistantText
      && (row.message?.stop_reason === 'end_turn' || row.message?.stop_reason === 'stop_sequence')
      && at >= state.lastFinishedAtMs) {
      state.lastFinishedAtMs = at;
      state.lastFinishedEventKey = cleanText(row.uuid || at, 240);
      state.lastTerminalAssistantAtMs = at;
    }
    return;
  }
  if (row.type !== 'user') return;
  const blocks = messageContentBlocks(row.message);
  let actualUserText = false;
  for (const block of blocks) {
    if (block?.type === 'tool_result') {
      const toolId = String(block.tool_use_id || '');
      if (toolId) state.pendingTools.delete(toolId);
      appendMessage(
        state,
        'tool',
        stringifyToolValue(block.content),
        at,
        'tool-result',
        row.uuid || `${at}:result`,
      );
    } else if (block?.type === 'text' || typeof block === 'string') {
      const text = typeof block === 'string' ? block : block.text;
      if (row.isMeta === true) continue;
      appendMessage(state, 'user', text, at, 'message', row.uuid);
      if (!state.firstPrompt) state.firstPrompt = cleanText(text, 200);
      actualUserText = true;
    }
  }
  if (actualUserText) state.lastUserAtMs = Math.max(state.lastUserAtMs, at);
}

export function parseClaudeTranscript(text, {
  filePath = '',
  modifiedAtMs = 0,
  enabledAtMs = 0,
  readEventIds = new Set(),
  nowMs = Date.now(),
} = {}) {
  const state = createClaudeTranscriptState({ filePath, modifiedAtMs });
  for (const line of String(text || '').split(/\r?\n/)) applyClaudeRow(state, parseLine(line));
  const sessionId = state.sessionId || path.basename(filePath, path.extname(filePath));
  if (!sessionId) return null;
  const pendingQuestion = [...state.pendingTools.values()].find((tool) => tool.name === 'AskUserQuestion');
  const unfinished = state.lastUserAtMs > state.lastFinishedAtMs;
  const running = unfinished && nowMs - state.lastActivityAtMs <= RUNNING_STALE_MS;
  const failed = state.lastFailureAtMs >= state.lastFinishedAtMs && state.lastFailureAtMs > state.lastUserAtMs;
  const activity = pendingQuestion ? CLAUDE_ACTIVITY.NEEDS_INPUT
    : failed ? CLAUDE_ACTIVITY.BLOCKED
      : running ? CLAUDE_ACTIVITY.RUNNING : CLAUDE_ACTIVITY.SILENT;
  const task = normalizeClaudeTask({
    id: sessionId,
    sessionId,
    title: state.title || state.firstPrompt || 'Claude Code 会话',
    project: sanitizeProjectName(state.cwd),
    cwd: state.cwd,
    entrypoint: state.entrypoint,
    permissionMode: state.permissionMode,
    effort: state.effort,
    model: state.model,
    activity,
    updatedAtMs: state.lastActivityAtMs,
    messages: state.messages.map(({ key, ...message }) => message),
    managed: false,
  });
  let unread = null;
  const completedAtMs = failed ? state.lastFailureAtMs : state.lastFinishedAtMs;
  const finishedCurrentTurn = state.lastUserAtMs > 0 && completedAtMs >= state.lastUserAtMs;
  const finalAssistantMessage = [...state.messages].reverse()
    .find((message) => message.role === 'assistant' && message.kind === 'message')?.message || '';
  if (!pendingQuestion && finishedCurrentTurn && completedAtMs >= enabledAtMs && completedAtMs > 0) {
    const resultActivity = failed ? CLAUDE_ACTIVITY.BLOCKED : CLAUDE_ACTIVITY.READY;
    const eventKey = failed ? state.lastFailureEventKey : state.lastFinishedEventKey;
    const eventId = `${sessionId}:${eventKey || completedAtMs}:${resultActivity}`;
    if (!readEventIds.has(eventId)) {
      unread = {
        id: eventId,
        threadId: sessionId,
        sessionId,
        provider: 'claude',
        title: task.title,
        project: task.project,
        activity: resultActivity,
        kind: failed ? 'failed' : 'completed',
        message: failed ? 'Claude Code 任务运行出错，请打开会话查看详情。'
          : finalAssistantMessage || 'Claude Code 已完成本轮任务。',
        createdAtMs: completedAtMs,
        managed: false,
        canReply: false,
      };
    }
  } else if (pendingQuestion) {
    const eventId = `${sessionId}:${pendingQuestion.createdAtMs}:question`;
    if (!readEventIds.has(eventId)) {
      unread = {
        id: eventId,
        threadId: sessionId,
        sessionId,
        provider: 'claude',
        title: task.title,
        project: task.project,
        activity: CLAUDE_ACTIVITY.NEEDS_INPUT,
        kind: 'question',
        message: 'Claude Code 正在等待你的回答。',
        createdAtMs: pendingQuestion.createdAtMs,
        managed: false,
        canReply: false,
        questions: Array.isArray(pendingQuestion.input?.questions) ? pendingQuestion.input.questions : [],
      };
    }
  }
  if (failed && !unread) task.activity = CLAUDE_ACTIVITY.SILENT;
  return { task, unread };
}

export function resolveClaudeHome(config, env = process.env, homeDirectory = os.homedir()) {
  const normalized = normalizeClaudeIntegrationConfig(config);
  const candidates = normalized.homeMode === 'manual'
    ? [normalized.manualHome]
    : [env.CLAUDE_CONFIG_DIR, path.join(homeDirectory, '.claude')];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const resolved = path.resolve(String(candidate));
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
    } catch { /* Profiles and removable drives can disappear while Monitor runs. */ }
  }
  return null;
}

export function resolveClaudeExecutables(env = process.env, homeDirectory = os.homedir()) {
  const candidates = [env.CLAUDE_CLI_PATH];
  if (process.platform === 'win32') {
    const roots = [
      path.join(env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
      path.join(env.APPDATA || path.join(homeDirectory, 'AppData', 'Roaming'), 'npm'),
    ];
    for (const root of roots) {
      candidates.push(
        path.join(root, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
        path.join(root, 'claude.exe'),
      );
    }
    candidates.push(
      path.join(homeDirectory, '.local', 'bin', 'claude.exe'),
      path.join(env.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local'), 'Programs', 'Claude', 'claude.exe'),
    );
    candidates.push('claude.exe');
  } else {
    candidates.push(
      path.join(homeDirectory, '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      'claude',
    );
  }
  return [...new Set(candidates.filter(Boolean).map(String))];
}

function processAlive(pid) {
  try { process.kill(Number(pid), 0); return true; }
  catch { return false; }
}

export function readClaudeSessionOwners(claudeHome) {
  const owners = new Map();
  const root = path.join(claudeHome, 'sessions');
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return owners; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(root, entry.name), 'utf8'));
      const pid = Number(data.pid);
      const sessionId = cleanText(data.sessionId, 240);
      if (!sessionId || !Number.isInteger(pid) || pid <= 0 || !processAlive(pid)) continue;
      owners.set(sessionId, {
        pid,
        cwd: cleanText(data.cwd, 2048),
        entrypoint: cleanText(data.entrypoint, 80),
        kind: cleanText(data.kind, 80),
        startedAt: cleanText(data.startedAt, 80),
        version: cleanText(data.version, 40),
        name: cleanText(data.name, 200),
        nameSource: cleanText(data.nameSource, 40),
      });
    } catch { /* A registry file may be replaced while being read. */ }
  }
  return owners;
}

async function collectSessionFiles(root) {
  const found = [];
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    let entries = [];
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const stat = await fs.promises.stat(fullPath);
          found.push({ path: fullPath, size: stat.size, modifiedAtMs: stat.mtimeMs });
        } catch { /* Session rotated during discovery. */ }
      }
    }
  }
  return found.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs).slice(0, MAX_SESSION_FILES);
}

async function readSessionText(file) {
  if (file.size <= MAX_FILE_BYTES) return fs.promises.readFile(file.path, 'utf8');
  const handle = await fs.promises.open(file.path, 'r');
  try {
    const headSize = Math.min(256 * 1024, file.size);
    const tailSize = Math.min(MAX_FILE_BYTES - headSize, file.size - headSize);
    const head = Buffer.alloc(headSize);
    const tail = Buffer.alloc(tailSize);
    await handle.read(head, 0, headSize, 0);
    await handle.read(tail, 0, tailSize, file.size - tailSize);
    const tailText = tail.toString('utf8').replace(/^[^\n]*\n?/, '');
    return `${head.toString('utf8')}\n${tailText}`;
  } finally { await handle.close(); }
}

export class ClaudeMonitor {
  constructor({ config, onConfigChange, pollIntervalMs = DEFAULT_POLL_MS, spawnImpl = spawn } = {}) {
    this.config = normalizeClaudeIntegrationConfig(config);
    this.onConfigChange = onConfigChange;
    this.pollIntervalMs = Math.max(1000, Number(pollIntervalMs) || DEFAULT_POLL_MS);
    this.spawnImpl = spawnImpl;
    this.window = null;
    this.running = false;
    this.timer = null;
    this.scanPromise = null;
    this.tasks = new Map();
    this.unread = new Map();
    this.fileCache = new Map();
    this.owners = new Map();
    this.managedProcesses = new Map();
    this.managedErrors = new Map();
    this.lastSnapshot = this.#emptySnapshot();
  }

  setWindow(window) { this.window = window; this.#sendSnapshot(); }
  start() { if (this.running) return; this.running = true; void this.scan(true); }
  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const child of this.managedProcesses.values()) child.kill?.();
    this.managedProcesses.clear();
    this.managedErrors.clear();
  }
  getConfig() {
    return {
      ...this.config,
      desiredSessionIds: [...this.config.desiredSessionIds],
      readEventIds: [...this.config.readEventIds],
      notifiedEventIds: [...this.config.notifiedEventIds],
    };
  }
  updateConfig(next) {
    const previousHomeMode = this.config.homeMode;
    const previousManualHome = this.config.manualHome;
    const previousEnabledAtMs = this.config.enabledAtMs;
    const wasEnabled = this.config.enabled;
    this.config = normalizeClaudeIntegrationConfig({ ...this.config, ...next });
    if (!wasEnabled && this.config.enabled) this.config.enabledAtMs = Date.now();
    if (previousHomeMode !== this.config.homeMode
      || previousManualHome !== this.config.manualHome
      || previousEnabledAtMs !== this.config.enabledAtMs
      || wasEnabled !== this.config.enabled) this.fileCache.clear();
    this.#persistConfig();
    void this.scan(true);
    return this.getConfig();
  }
  getSnapshot() { return structuredClone(this.lastSnapshot); }

  async scan(force = false) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = this.#scanOnce(force).finally(() => {
      this.scanPromise = null;
      if (this.running) {
        this.timer = setTimeout(() => { this.timer = null; void this.scan(); }, this.pollIntervalMs);
        this.timer.unref?.();
      }
    });
    return this.scanPromise;
  }

  async #scanOnce(force) {
    if (!this.config.enabled) {
      this.tasks.clear();
      this.unread.clear();
      this.lastSnapshot = this.#emptySnapshot();
      this.#sendSnapshot();
      return;
    }
    const claudeHome = resolveClaudeHome(this.config);
    if (!claudeHome) {
      this.lastSnapshot = {
        ...this.#emptySnapshot(), configured: true, enabled: true,
        reason: this.config.homeMode === 'manual'
          ? '选择的 Claude Code 数据目录不存在'
          : '本机没有检测到 Claude Code 数据目录',
      };
      this.#sendSnapshot();
      return;
    }
    const projectsRoot = path.join(claudeHome, 'projects');
    this.owners = readClaudeSessionOwners(claudeHome);
    if (!fs.existsSync(projectsRoot)) {
      this.lastSnapshot = {
        ...this.#emptySnapshot(), configured: true, enabled: true, connected: true,
        homeLabel: this.config.homeMode === 'manual' ? '手动目录' : '自动检测',
        reason: 'Claude Code 已连接，但还没有本地会话记录',
      };
      this.#sendSnapshot();
      return;
    }
    const files = await collectSessionFiles(projectsRoot);
    const readIds = new Set(this.config.readEventIds);
    const currentFiles = new Set(files.map((file) => file.path));
    for (const cachedPath of this.fileCache.keys()) {
      if (!currentFiles.has(cachedPath)) this.fileCache.delete(cachedPath);
    }
    const nextTasks = new Map();
    const nextUnread = new Map();
    for (const file of files) {
      try {
        const cached = this.fileCache.get(file.path);
        const cacheHit = cached?.size === file.size && cached?.modifiedAtMs === file.modifiedAtMs;
        let canonical = cacheHit ? cached.parsed : null;
        if (!cacheHit) {
          canonical = parseClaudeTranscript(await readSessionText(file), {
            filePath: file.path,
            modifiedAtMs: file.modifiedAtMs,
            enabledAtMs: this.config.enabledAtMs,
            readEventIds: new Set(),
          });
          this.fileCache.set(file.path, { size: file.size, modifiedAtMs: file.modifiedAtMs, parsed: canonical });
        }
        if (!canonical) continue;
        const unread = canonical.unread && !readIds.has(canonical.unread.id) ? canonical.unread : null;
        const task = canonical.unread?.activity === CLAUDE_ACTIVITY.BLOCKED && !unread
          ? { ...canonical.task, activity: CLAUDE_ACTIVITY.SILENT }
          : canonical.task;
        const previous = nextTasks.get(task.id);
        if (!previous || task.updatedAtMs >= previous.updatedAtMs) nextTasks.set(task.id, task);
        if (unread) nextUnread.set(unread.id, unread);
      } catch (error) {
        if (force) console.warn('[Claude] Session read failed:', error.message);
      }
    }
    this.tasks = nextTasks;
    this.unread = nextUnread;
    this.#rebuildSnapshot();
  }

  #rebuildSnapshot() {
    const readIds = new Set(this.config.readEventIds);
    const notified = new Set(this.config.notifiedEventIds);
    const allUnread = sortClaudeUnreadEvents([...this.unread.values()].filter((event) => !readIds.has(event.id)));
    const desired = new Set(this.config.desiredSessionIds);
    const tasks = [...this.tasks.values()].map((task) => {
      const owner = this.owners.get(task.id);
      const hasBlockedUnread = allUnread.some((event) => event.threadId === task.id && event.activity === CLAUDE_ACTIVITY.BLOCKED);
      const managedError = this.managedErrors.get(task.id) || '';
      const currentTask = task.activity === CLAUDE_ACTIVITY.BLOCKED && !hasBlockedUnread && !managedError
        ? { ...task, activity: CLAUDE_ACTIVITY.SILENT } : task;
      const taskWithManagedError = managedError ? { ...currentTask, activity: CLAUDE_ACTIVITY.BLOCKED } : currentTask;
      const displayedTask = owner?.name ? { ...taskWithManagedError, title: sanitizeTaskTitle(owner.name) } : taskWithManagedError;
      const managed = this.managedProcesses.has(task.id);
      let connectionState = CLAUDE_CONNECTION.DISCONNECTED;
      if (this.config.replyTransport === CLAUDE_REPLY_TRANSPORT.DESKTOP) connectionState = CLAUDE_CONNECTION.CONNECTED;
      else if (desired.has(task.id)) {
        connectionState = owner && !managed
          ? CLAUDE_CONNECTION.TEMPORARY_READ_ONLY
          : CLAUDE_CONNECTION.CONNECTED;
      }
      const canReply = this.config.managedReplies === true
        && (this.config.replyTransport === CLAUDE_REPLY_TRANSPORT.DESKTOP
          || connectionState === CLAUDE_CONNECTION.CONNECTED);
      return {
        ...displayedTask,
        provider: 'claude',
        owner: owner || null,
        connectionState,
        connectionError: managedError || (owner && !managed && desired.has(task.id)
          ? '该会话正在原终端或 IDE 中运行，请使用客户端兼容模式'
          : ''),
        canReply,
        capabilities: { reply: canReply, approve: false, jump: true },
      };
    });
    const summary = buildClaudeVisibleTasks(tasks, allUnread);
    this.lastSnapshot = {
      configured: true,
      enabled: true,
      connected: true,
      controlConnected: tasks.some((task) => task.connectionState === CLAUDE_CONNECTION.CONNECTED),
      locale: 'zh-CN',
      homeLabel: this.config.homeMode === 'manual' ? '手动目录' : '自动检测',
      source: 'claude-sessions',
      provider: 'claude',
      activity: resolveClaudeActivity({ connected: true, tasks, unread: allUnread }),
      tasks: tasks.map(({ messages, ...task }) => task)
        .sort((left, right) => Number(right.updatedAtMs || 0) - Number(left.updatedAtMs || 0)),
      unread: allUnread,
      alerts: allUnread.filter((event) => !notified.has(event.id)),
      unreadCount: allUnread.length,
      ...summary,
      updatedAtMs: Date.now(),
      reason: '',
    };
    this.#sendSnapshot();
  }

  async getMessages(sessionId, { cursor = null, limit = 50 } = {}) {
    const id = String(sessionId || '');
    const messages = this.tasks.get(id)?.messages || [];
    const pageSize = Math.min(100, Math.max(1, Number(limit) || 50));
    const end = cursor === null ? messages.length : Math.min(messages.length, Math.max(0, Number(cursor) || 0));
    const start = Math.max(0, end - pageSize);
    return { threadId: id, sessionId: id, messages: messages.slice(start, end), nextCursor: start > 0 ? String(start) : null, total: messages.length };
  }

  markRead(eventId) {
    const id = cleanText(eventId, 240);
    if (!id) return this.getSnapshot();
    this.config = normalizeClaudeIntegrationConfig({
      ...this.config,
      readEventIds: [...this.config.readEventIds, id],
      notifiedEventIds: [...this.config.notifiedEventIds, id],
    });
    this.#persistConfig();
    this.#rebuildSnapshot();
    return this.getSnapshot();
  }
  markNotified(eventId) {
    const id = cleanText(eventId, 240);
    if (!id || this.config.notifiedEventIds.includes(id)) return this.getSnapshot();
    this.config = normalizeClaudeIntegrationConfig({ ...this.config, notifiedEventIds: [...this.config.notifiedEventIds, id] });
    this.#persistConfig();
    this.#rebuildSnapshot();
    return this.getSnapshot();
  }
  connectSession(sessionId) {
    const id = cleanText(sessionId, 240);
    if (!id || !this.tasks.has(id)) throw new Error('没有找到这个 Claude Code 会话');
    this.config = normalizeClaudeIntegrationConfig({ ...this.config, desiredSessionIds: [...this.config.desiredSessionIds, id] });
    this.#persistConfig();
    this.#rebuildSnapshot();
    return this.getSnapshot();
  }
  disconnectSession(sessionId) {
    const id = cleanText(sessionId, 240);
    this.config = normalizeClaudeIntegrationConfig({
      ...this.config,
      desiredSessionIds: this.config.desiredSessionIds.filter((item) => item !== id),
    });
    this.#persistConfig();
    this.#rebuildSnapshot();
    return this.getSnapshot();
  }

  async reply(sessionId, text) {
    const id = cleanText(sessionId, 240);
    const message = cleanText(text);
    if (!message) throw new Error('请输入要发送的内容');
    const task = this.tasks.get(id);
    if (!task) throw new Error('没有找到这个 Claude Code 会话');
    if (this.config.replyTransport === CLAUDE_REPLY_TRANSPORT.DESKTOP) {
      return { accepted: true, mode: 'client-submit', openClient: true, sessionId: id, threadId: id, owner: this.owners.get(id) || null };
    }
    if (!this.config.desiredSessionIds.includes(id)) throw new Error('请先为这个 Claude Code 会话建立 Monitor 直连');
    const owner = this.owners.get(id);
    if (owner && !this.managedProcesses.has(id)) {
      throw new Error('该会话正在原终端或 IDE 中运行，请切换到 Claude Code 客户端兼容模式');
    }
    if (this.managedProcesses.has(id)) throw new Error('Claude Code 正在处理上一条消息，请稍候再发送');

    let executable = resolveClaudeExecutables().find((candidate) => {
      if (!path.isAbsolute(candidate)) return true;
      try { return fs.existsSync(candidate); } catch { return false; }
    });
    if (!executable) throw new Error('没有找到 Claude Code CLI，请先安装或设置 CLAUDE_CLI_PATH');
    this.managedErrors.delete(id);
    await this.#startManagedTurn({
      id,
      message,
      task,
      executable,
      permissionMode: task.permissionMode,
    });
    return { accepted: true, mode: 'turn-start', openClient: false, sessionId: id, threadId: id };
  }

  async #startManagedTurn({ id, message, task, executable, permissionMode }) {
    const args = buildClaudeDirectArgs({ sessionId: id, message, permissionMode });
    const child = this.spawnImpl(executable, args, {
      cwd: task.cwd || os.homedir(),
      env: { ...process.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    this.managedProcesses.set(id, child);
    this.managedErrors.delete(id);
    const base = this.tasks.get(id);
    if (base) this.tasks.set(id, { ...base, activity: CLAUDE_ACTIVITY.RUNNING, updatedAtMs: Date.now() });
    let diagnostic = '';
    const collectDiagnostic = (chunk) => { diagnostic = `${diagnostic}${String(chunk || '')}`.slice(-6000); };
    child.stderr?.on('data', collectDiagnostic);
    child.stdout?.on('data', (chunk) => {
      const text = String(chunk || '');
      if (/\b400\b|bad\s*request|invalid_request|unsupported|not supported/i.test(text)) collectDiagnostic(text);
    });
    child.once('exit', (code) => {
      if (this.managedProcesses.get(id) !== child) return;
      this.managedProcesses.delete(id);
      if (!code || code === 0) {
        this.managedErrors.delete(id);
        void this.scan(true);
        return;
      }
      const errorMessage = formatClaudeManagedError(diagnostic || code);
      this.managedErrors.set(id, errorMessage);
      console.warn('[Claude] Managed turn exited:', errorMessage);
      void this.scan(true);
    });
    this.#rebuildSnapshot();
  }

  #persistConfig() { this.onConfigChange?.(this.getConfig()); }
  #emptySnapshot() {
    return {
      configured: false, enabled: false, connected: false, controlConnected: false,
      locale: 'zh-CN', homeLabel: '', source: 'none', provider: 'claude',
      activity: CLAUDE_ACTIVITY.DISCONNECTED, tasks: [], unread: [], alerts: [], unreadCount: 0,
      runningCount: 0, unreadTaskCount: 0, visibleTasks: [], updatedAtMs: Date.now(),
      reason: 'Claude Code 接入尚未启用',
    };
  }
  #sendSnapshot() {
    if (!this.window || this.window.isDestroyed() || this.window.webContents.isDestroyed()) return;
    this.window.webContents.send('claude-status', this.lastSnapshot);
  }
}
