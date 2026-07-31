export const CODEX_INTEGRATION_CONFIG_VERSION = 2;

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

export const DEFAULT_CODEX_INTEGRATION_CONFIG = Object.freeze({
  version: CODEX_INTEGRATION_CONFIG_VERSION,
  enabled: false,
  homeMode: 'auto',
  manualHome: '',
  managedReplies: true,
  enabledAtMs: 0,
  notificationMode: 'important',
  localeMode: 'codex',
  desiredThreadIds: Object.freeze([]),
  readEventIds: Object.freeze([]),
  notifiedEventIds: Object.freeze([]),
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
    enabledAtMs: enabled && enabledAtMs <= 0 ? Date.now() : enabledAtMs,
    notificationMode: 'important',
    localeMode: 'codex',
    desiredThreadIds: boundedStringList(value.desiredThreadIds, 128, 240),
    readEventIds: boundedStringList(value.readEventIds, 1024, 240),
    notifiedEventIds: boundedStringList(value.notifiedEventIds, 1024, 240),
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

function taskCapabilities(task) {
  const connected = task.connectionState === CODEX_CONNECTION.CONNECTED;
  const ownedRequest = Boolean(task.hasOwnedRequest);
  return {
    reply: connected,
    approve: connected && ownedRequest,
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
      runningChildren: 0,
      capabilities: taskCapabilities(source),
    };
    delete task.messages;
    grouped.set(task.threadId, task);
  }

  for (const task of grouped.values()) {
    if (!task.parentThreadId || !grouped.has(String(task.parentThreadId))) continue;
    if (task.activity === CODEX_ACTIVITY.RUNNING) {
      const parent = grouped.get(String(task.parentThreadId));
      parent.runningChildren += 1;
      if (parent.activity === CODEX_ACTIVITY.SILENT) parent.activity = CODEX_ACTIVITY.RUNNING;
    }
  }

  for (const event of sortCodexUnreadEvents(unread)) {
    const threadId = String(event?.threadId || '');
    if (!threadId) continue;
    const current = grouped.get(threadId) || {
      id: threadId,
      threadId,
      title: event.title,
      project: event.project,
      activity: event.activity,
      updatedAtMs: event.createdAtMs,
      events: [],
      unreadCount: 0,
      runningChildren: 0,
      connectionState: CODEX_CONNECTION.DISCONNECTED,
      capabilities: { reply: false, approve: false, jump: true },
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
  const visibleTasks = all
    .filter((task) => {
      const child = task.parentThreadId && grouped.has(String(task.parentThreadId));
      const childNeedsOwnRow = task.unreadCount > 0
        || task.activity === CODEX_ACTIVITY.NEEDS_INPUT
        || task.activity === CODEX_ACTIVITY.BLOCKED;
      if (child && !childNeedsOwnRow) return false;
      return task.unreadCount > 0
        || task.activity === CODEX_ACTIVITY.RUNNING
        || task.activity === CODEX_ACTIVITY.NEEDS_INPUT
        || task.activity === CODEX_ACTIVITY.BLOCKED
        || task.connectionState !== CODEX_CONNECTION.DISCONNECTED;
    })
    .sort((left, right) => {
      const priority = activityPriority(left.activity) - activityPriority(right.activity);
      if (priority !== 0) return priority;
      return Number(right.updatedAtMs || 0) - Number(left.updatedAtMs || 0);
    });

  return {
    visibleTasks,
    runningCount: all.filter((task) => task.activity === CODEX_ACTIVITY.RUNNING).length,
    unreadTaskCount: all.filter((task) => task.unreadCount > 0).length,
  };
}

export function codexMoodForActivity(activity, { alertFresh = true } = {}) {
  switch (activity) {
    case CODEX_ACTIVITY.NEEDS_INPUT: return 'attention';
    case CODEX_ACTIVITY.BLOCKED: return alertFresh ? 'pain' : 'idle';
    case CODEX_ACTIVITY.READY: return alertFresh ? 'happy' : 'idle';
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

export function normalizeCodexLocale(value, fallback = 'zh-CN') {
  const locale = cleanText(value, 32).replace('_', '-');
  if (/^zh(?:-|$)/i.test(locale)) return 'zh-CN';
  if (/^en(?:-|$)/i.test(locale)) return 'en-US';
  return /^en(?:-|$)/i.test(fallback) ? 'en-US' : 'zh-CN';
}
