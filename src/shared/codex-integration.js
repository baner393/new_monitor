export const CODEX_INTEGRATION_CONFIG_VERSION = 1;

export const CODEX_ACTIVITY = Object.freeze({
  DISCONNECTED: 'disconnected',
  SILENT: 'silent',
  RUNNING: 'running',
  NEEDS_INPUT: 'needsInput',
  READY: 'ready',
  BLOCKED: 'blocked',
});

export const DEFAULT_CODEX_INTEGRATION_CONFIG = Object.freeze({
  version: CODEX_INTEGRATION_CONFIG_VERSION,
  enabled: false,
  homeMode: 'auto',
  manualHome: '',
  managedReplies: true,
  enabledAtMs: 0,
  readEventIds: Object.freeze([]),
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

export function normalizeCodexIntegrationConfig(value = {}) {
  const enabled = value.enabled === true;
  const enabledAtMs = Number.isFinite(Number(value.enabledAtMs))
    ? Math.max(0, Number(value.enabledAtMs))
    : 0;
  const readEventIds = Array.isArray(value.readEventIds)
    ? [...new Set(value.readEventIds.map((item) => cleanText(item, 240)).filter(Boolean))].slice(-512)
    : [];

  return {
    version: CODEX_INTEGRATION_CONFIG_VERSION,
    enabled,
    homeMode: value.homeMode === 'manual' ? 'manual' : 'auto',
    manualHome: cleanText(value.manualHome, 1024),
    managedReplies: value.managedReplies !== false,
    enabledAtMs: enabled && enabledAtMs <= 0 ? Date.now() : enabledAtMs,
    readEventIds,
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
  if (tasks.some((task) => task?.activity === CODEX_ACTIVITY.NEEDS_INPUT)) {
    return CODEX_ACTIVITY.NEEDS_INPUT;
  }
  if (tasks.some((task) => task?.activity === CODEX_ACTIVITY.BLOCKED)) {
    return CODEX_ACTIVITY.BLOCKED;
  }
  if (tasks.some((task) => task?.activity === CODEX_ACTIVITY.RUNNING)) {
    return CODEX_ACTIVITY.RUNNING;
  }
  return CODEX_ACTIVITY.SILENT;
}

export function codexMoodForActivity(activity, { alertFresh = true } = {}) {
  switch (activity) {
    case CODEX_ACTIVITY.NEEDS_INPUT:
      return 'attention';
    case CODEX_ACTIVITY.BLOCKED:
      return alertFresh ? 'pain' : 'idle';
    case CODEX_ACTIVITY.READY:
      return alertFresh ? 'happy' : 'idle';
    case CODEX_ACTIVITY.RUNNING:
      return 'working';
    default:
      return 'idle';
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
