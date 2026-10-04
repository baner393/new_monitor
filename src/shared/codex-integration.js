export const CODEX_INTEGRATION_CONFIG_VERSION = 4;

export const CODEX_ACTIVITY = Object.freeze({
  DISCONNECTED: 'disconnected',
  SILENT: 'silent',
  RUNNING: 'running',
  NEEDS_INPUT: 'needsInput',
  READY: 'ready',
  BLOCKED: 'blocked',
});

export const CODEX_CONNECTION = Object.freeze({
  DISCONNECTED: 'disconnected',
  WAITING_IDLE: 'waitingIdle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  TEMPORARY_READ_ONLY: 'temporaryReadOnly',
  ERROR: 'error',
});

export const CODEX_REPLY_TRANSPORT = Object.freeze({
  DIRECT: 'direct',
  DESKTOP: 'desktop',
});

export const CODEX_NEW_MESSAGE_VIEW = Object.freeze({
  CONVERSATION: 'conversation',
  TASK_ACTIVITY: 'tasks',
});

export const CODEX_SEND_SHORTCUT = Object.freeze({
  ENTER: 'enter',
  CTRL_ENTER: 'ctrl-enter',
});

export const CODEX_REASONING_EFFORTS = Object.freeze([
  'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
]);

export const DEFAULT_CODEX_INTEGRATION_CONFIG = Object.freeze({
  version: CODEX_INTEGRATION_CONFIG_VERSION,
  enabled: false,
  homeMode: 'auto',
  manualHome: '',
  managedReplies: true,
  bypassPermissions: false,
  replyTransport: CODEX_REPLY_TRANSPORT.DIRECT,
  sendShortcut: CODEX_SEND_SHORTCUT.ENTER,
  newMessageView: CODEX_NEW_MESSAGE_VIEW.CONVERSATION,
  enabledAtMs: 0,
  notificationMode: 'important',
  localeMode: 'codex',
  desiredThreadIds: Object.freeze([]),
  readEventIds: Object.freeze([]),
  notifiedEventIds: Object.freeze([]),
  sessionPreferences: Object.freeze({}),
});

const ACTIVITY_PRIORITY = Object.freeze({
  [CODEX_ACTIVITY.NEEDS_INPUT]: 0,
  [CODEX_ACTIVITY.BLOCKED]: 1,
  [CODEX_ACTIVITY.READY]: 2,
  [CODEX_ACTIVITY.RUNNING]: 3,
  [CODEX_ACTIVITY.SILENT]: 4,
  [CODEX_ACTIVITY.DISCONNECTED]: 5,
});

function cleanText(value, maxLength = 4000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function boundedStringList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, maxLength)).filter(Boolean))].slice(-maxItems);
}

export function normalizeCodexSessionPreference(value = {}) {
  const effort = String(value?.effort || '').toLowerCase();
  return { effort: CODEX_REASONING_EFFORTS.includes(effort) ? effort : 'inherit' };
}

function normalizeCodexSessionPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  for (const [rawId, preference] of Object.entries(value).slice(-128)) {
    const id = cleanText(rawId, 240);
    if (id) normalized[id] = normalizeCodexSessionPreference(preference);
  }
  return normalized;
}

export function normalizeCodexIntegrationConfig(value = {}) {
  const enabled = value.enabled === true;
  const enabledAtMs = Number.isFinite(Number(value.enabledAtMs))
    ? Math.max(0, Number(value.enabledAtMs))
    : 0;
  return {
    version: CODEX_INTEGRATION_CONFIG_VERSION,
    enabled,
    homeMode: value.homeMode === 'manual' ? 'manual' : 'auto',
    manualHome: cleanText(value.manualHome, 1024),
    managedReplies: value.managedReplies !== false,
    bypassPermissions: value.bypassPermissions === true,
    replyTransport: value.replyTransport === CODEX_REPLY_TRANSPORT.DESKTOP
      ? CODEX_REPLY_TRANSPORT.DESKTOP
      : CODEX_REPLY_TRANSPORT.DIRECT,
    sendShortcut: value.sendShortcut === CODEX_SEND_SHORTCUT.CTRL_ENTER
      ? CODEX_SEND_SHORTCUT.CTRL_ENTER
      : CODEX_SEND_SHORTCUT.ENTER,
    newMessageView: value.newMessageView === CODEX_NEW_MESSAGE_VIEW.TASK_ACTIVITY
      ? CODEX_NEW_MESSAGE_VIEW.TASK_ACTIVITY
      : CODEX_NEW_MESSAGE_VIEW.CONVERSATION,
    enabledAtMs: enabled && enabledAtMs <= 0 ? Date.now() : enabledAtMs,
    notificationMode: 'important',
    localeMode: 'codex',
    desiredThreadIds: boundedStringList(value.desiredThreadIds, 128, 240),
    readEventIds: boundedStringList(value.readEventIds, 1024, 240),
    notifiedEventIds: boundedStringList(value.notifiedEventIds, 1024, 240),
    sessionPreferences: normalizeCodexSessionPreferences(value.sessionPreferences),
  };
}

export function activityPriority(activity) {
  return ACTIVITY_PRIORITY[activity] ?? ACTIVITY_PRIORITY[CODEX_ACTIVITY.SILENT];
}

export function sortCodexUnreadEvents(events = []) {
  return [...events].sort((left, right) => {
    const byPriority = activityPriority(left?.activity) - activityPriority(right?.activity);
    if (byPriority !== 0) return byPriority;
    return Number(left?.createdAtMs || 0) - Number(right?.createdAtMs || 0);
  });
}

export function resolveCodexActivity({ connected = true, tasks = [], unread = [] } = {}) {
  if (!connected) return CODEX_ACTIVITY.DISCONNECTED;
  const unreadSorted = sortCodexUnreadEvents(unread);
  if (unreadSorted.length) return unreadSorted[0].activity;
  for (const activity of [CODEX_ACTIVITY.NEEDS_INPUT, CODEX_ACTIVITY.BLOCKED, CODEX_ACTIVITY.RUNNING]) {
    if (tasks.some((task) => task?.activity === activity)) return activity;
  }
  return CODEX_ACTIVITY.SILENT;
}

export function codexActivityFromThreadStatus(status) {
  const type = String(status?.type || status || '').trim().toLowerCase();
  const flags = Array.isArray(status?.activeFlags)
    ? status.activeFlags.map((flag) => String(flag || '').replace(/[\s_-]/g, '').toLowerCase())
    : [];
  if (type === 'needsinput' || flags.some((flag) => ['waitingonapproval', 'waitingonuserinput'].includes(flag))) {
    return CODEX_ACTIVITY.NEEDS_INPUT;
  }
  if (['systemerror', 'blocked', 'failed', 'interrupted'].includes(type)) return CODEX_ACTIVITY.BLOCKED;
  if (['active', 'inprogress', 'running'].includes(type)) return CODEX_ACTIVITY.RUNNING;
  return CODEX_ACTIVITY.SILENT;
}

function taskCapabilities(task) {
  const connected = task.connectionState === CODEX_CONNECTION.CONNECTED;
  const ownedRequest = Boolean(task.hasOwnedRequest);
  return {
    // Desktop-compatible mode can reply through the owning client without an
    // App Server connection. Preserve the provider's explicit capability.
    reply: typeof task.canReply === 'boolean' ? task.canReply : connected,
    approve: connected && ownedRequest,
    interrupt: connected && Boolean(task.canInterrupt || task.activeTurnId),
    jump: true,
  };
}

export function buildCodexVisibleTasks(tasks = [], unread = []) {
  const grouped = new Map();
  for (const source of tasks || []) {
    if (!source?.id) continue;
    const task = {
      ...source,
      threadId: String(source.id),
      events: [],
      unreadCount: 0,
      subagentSummary: source.subagentSummary || null,
      capabilities: taskCapabilities(source),
    };
    delete task.messages;
    grouped.set(task.threadId, task);
  }

  for (const event of sortCodexUnreadEvents(unread)) {
    const threadId = String(event?.threadId || '');
    if (!threadId) continue;
    const current = grouped.get(threadId) || {
      id: threadId,
      threadId,
      provider: event.provider,
      title: event.title,
      project: event.project,
      activity: event.activity,
      updatedAtMs: event.createdAtMs,
      events: [],
      unreadCount: 0,
      subagentSummary: null,
      connectionState: CODEX_CONNECTION.DISCONNECTED,
      capabilities: { reply: false, approve: false, interrupt: false, jump: true },
    };
    current.title ||= event.title;
    current.project ||= event.project;
    current.updatedAtMs = Math.max(Number(current.updatedAtMs || 0), Number(event.createdAtMs || 0));
    if (activityPriority(event.activity) < activityPriority(current.activity)) current.activity = event.activity;
    current.events.push(event);
    current.unreadCount += 1;
    if (event.requestId && event.managed) {
      current.hasOwnedRequest = true;
      current.capabilities = { ...current.capabilities, approve: true };
    }
    grouped.set(threadId, current);
  }

  const all = [...grouped.values()];
  const isChildTask = (task) => Boolean(task.parentThreadId);
  const rootTaskFor = (task) => {
    let current = task;
    const visited = new Set([String(task.threadId || task.id)]);
    while (isChildTask(current)) {
      const parentId = String(current.parentThreadId);
      if (visited.has(parentId)) break;
      const parent = grouped.get(parentId);
      if (!parent) break;
      visited.add(parentId);
      current = parent;
    }
    return current;
  };
  const subagentSummaries = new Map();
  for (const task of all) {
    if (!isChildTask(task)) continue;
    let state = '';
    if (task.activity === CODEX_ACTIVITY.RUNNING) state = 'running';
    else if (task.activity === CODEX_ACTIVITY.NEEDS_INPUT) state = 'needsInput';
    else if (task.activity === CODEX_ACTIVITY.BLOCKED) state = 'blocked';
    if (!state) continue;
    const root = rootTaskFor(task);
    const rootId = String(root.threadId || root.id);
    const summary = subagentSummaries.get(rootId) || {
      running: 0,
      needsInput: 0,
      blocked: 0,
      total: 0,
    };
    summary[state] += 1;
    summary.total += 1;
    subagentSummaries.set(rootId, summary);
  }
  for (const [rootId, summary] of subagentSummaries) {
    const root = grouped.get(rootId);
    if (root) {
      root.subagentSummary = summary;
      root.runningChildren = summary.running;
    }
  }

  const rootTasks = all.filter((task) => !isChildTask(task));
  const actionableChildren = all.filter((task) => isChildTask(task)
    && (task.unreadCount > 0
      || task.activity === CODEX_ACTIVITY.NEEDS_INPUT
      || task.activity === CODEX_ACTIVITY.BLOCKED));
  const rootUnread = sortCodexUnreadEvents(unread).filter((event) => {
    const child = grouped.get(String(event?.threadId || ''));
    return !child || !isChildTask(child);
  });
  const visibleTasks = [...rootTasks, ...actionableChildren]
    .filter((task) => {
      return task.unreadCount > 0
        || task.activity === CODEX_ACTIVITY.RUNNING
        || task.activity === CODEX_ACTIVITY.NEEDS_INPUT
        || task.activity === CODEX_ACTIVITY.BLOCKED
        || Number(task.subagentSummary?.total) > 0
        || task.connectionState !== CODEX_CONNECTION.DISCONNECTED;
    })
    .sort((left, right) => {
      const leftNeedsAction = left.activity === CODEX_ACTIVITY.NEEDS_INPUT
        || left.activity === CODEX_ACTIVITY.BLOCKED
        || left.connectionState === CODEX_CONNECTION.ERROR;
      const rightNeedsAction = right.activity === CODEX_ACTIVITY.NEEDS_INPUT
        || right.activity === CODEX_ACTIVITY.BLOCKED
        || right.connectionState === CODEX_CONNECTION.ERROR;
      if (leftNeedsAction !== rightNeedsAction) return leftNeedsAction ? -1 : 1;
      const byRecentActivity = Number(right.updatedAtMs || 0) - Number(left.updatedAtMs || 0);
      if (byRecentActivity !== 0) return byRecentActivity;
      return String(left.threadId || left.id).localeCompare(String(right.threadId || right.id));
    });

  return {
    rootTasks,
    rootUnread,
    visibleTasks,
    runningCount: rootTasks.filter((task) => task.activity === CODEX_ACTIVITY.RUNNING).length,
    unreadTaskCount: rootTasks.filter((task) => task.unreadCount > 0).length,
  };
}

export function codexMoodForActivity(activity, { alertFresh = true } = {}) {
  switch (activity) {
    case CODEX_ACTIVITY.NEEDS_INPUT: return 'attention';
    case CODEX_ACTIVITY.BLOCKED: return alertFresh ? 'pain' : 'idle';
    // READY is backed by an unread completion event. Keep the pet in its
    // completed mood until that event is acknowledged; presentation can be
    // delayed while the companion panel or another pet animation is active.
    case CODEX_ACTIVITY.READY: return 'happy';
    case CODEX_ACTIVITY.RUNNING: return 'working';
    default: return 'idle';
  }
}

export function sanitizeTaskTitle(value, maxLength = 44) {
  const text = cleanText(value, 500).replace(/\s+/g, ' ');
  if (!text) return '未命名任务';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function sanitizeProjectName(cwd) {
  const normalized = cleanText(cwd, 2048).replace(/[\\/]+$/, '');
  if (!normalized) return '未指定项目';
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return sanitizeTaskTitle(segments.at(-1) || normalized, 32);
}

const STRUCTURAL_BLOCKS = [
  /<recommended_plugins>[\s\S]*?<\/recommended_plugins>/gi,
  /<app-context>[\s\S]*?<\/app-context>/gi,
  /<permissions instructions>[\s\S]*?<\/permissions instructions>/gi,
  /<collaboration_mode>[\s\S]*?<\/collaboration_mode>/gi,
  /<environment_context>[\s\S]*?<\/environment_context>/gi,
  /# AGENTS\.md instructions[\s\S]*?<\/INSTRUCTIONS>/gi,
];

export function cleanCodexUserMessage(value) {
  let text = cleanText(value, 100_000);
  for (const pattern of STRUCTURAL_BLOCKS) text = text.replace(pattern, '');
  text = text.trim();
  if (/^(?:<developer|<system|\[MODE:|You are Codex\b)/i.test(text)) return '';
  return text;
}

export function compactCodexTechnicalPreview(value, maxLength = 110) {
  const limit = Math.max(24, Number(maxLength) || 110);
  const text = cleanText(value, 100_000).replace(/\s+/g, ' ').trim();
  if (!text) return '—';
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function shouldShowCodexConnectionList(_replyTransport, taskCount) {
  return Number(taskCount) > 0;
}

export function normalizeCodexLocale(value, fallback = 'zh-CN') {
  const locale = cleanText(value, 32).replace('_', '-');
  if (/^zh(?:-|$)/i.test(locale)) return 'zh-CN';
  if (/^en(?:-|$)/i.test(locale)) return 'en-US';
  return /^en(?:-|$)/i.test(fallback) ? 'en-US' : 'zh-CN';
}
