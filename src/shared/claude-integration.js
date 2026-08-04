import {
  CODEX_ACTIVITY,
  CODEX_CONNECTION,
  CODEX_NEW_MESSAGE_VIEW,
  CODEX_REPLY_TRANSPORT,
  buildCodexVisibleTasks,
  resolveCodexActivity,
  sanitizeProjectName,
  sanitizeTaskTitle,
  sortCodexUnreadEvents,
} from './codex-integration.js';

export const CLAUDE_INTEGRATION_CONFIG_VERSION = 3;
export const CLAUDE_ACTIVITY = CODEX_ACTIVITY;
export const CLAUDE_CONNECTION = CODEX_CONNECTION;
export const CLAUDE_REPLY_TRANSPORT = CODEX_REPLY_TRANSPORT;
export const CLAUDE_NEW_MESSAGE_VIEW = CODEX_NEW_MESSAGE_VIEW;
export const CLAUDE_SEND_SHORTCUT = Object.freeze({
  ENTER: 'enter',
  CTRL_ENTER: 'ctrl-enter',
});
export const CLAUDE_THINKING_MODE = Object.freeze({
  AUTO: 'auto',
  INHERIT: 'inherit',
  DISABLED: 'disabled',
  CUSTOM: 'custom',
});
export const CLAUDE_EFFORT_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

export const DEFAULT_CLAUDE_INTEGRATION_CONFIG = Object.freeze({
  version: CLAUDE_INTEGRATION_CONFIG_VERSION,
  enabled: false,
  homeMode: 'auto',
  manualHome: '',
  managedReplies: true,
  bypassPermissions: false,
  replyTransport: CLAUDE_REPLY_TRANSPORT.DIRECT,
  sendShortcut: CLAUDE_SEND_SHORTCUT.ENTER,
  enabledAtMs: 0,
  desiredSessionIds: Object.freeze([]),
  readEventIds: Object.freeze([]),
  notifiedEventIds: Object.freeze([]),
  sessionPreferences: Object.freeze({}),
});

function cleanText(value, maxLength = 4000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function boundedStringList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, maxLength)).filter(Boolean))].slice(-maxItems);
}

export function normalizeClaudeSessionPreference(value = {}) {
  const thinkingMode = Object.values(CLAUDE_THINKING_MODE).includes(value?.thinkingMode)
    ? value.thinkingMode : CLAUDE_THINKING_MODE.AUTO;
  const effort = CLAUDE_EFFORT_LEVELS.includes(String(value?.effort || '').toLowerCase())
    ? String(value.effort).toLowerCase() : 'high';
  return { thinkingMode, effort };
}

function normalizeClaudeSessionPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).slice(-128);
  const normalized = {};
  for (const [rawId, preference] of entries) {
    const id = cleanText(rawId, 240);
    if (id) normalized[id] = normalizeClaudeSessionPreference(preference);
  }
  return normalized;
}

export function normalizeClaudeIntegrationConfig(value = {}) {
  const enabled = value.enabled === true;
  const enabledAtMs = Number.isFinite(Number(value.enabledAtMs))
    ? Math.max(0, Number(value.enabledAtMs))
    : 0;
  return {
    version: CLAUDE_INTEGRATION_CONFIG_VERSION,
    enabled,
    homeMode: value.homeMode === 'manual' ? 'manual' : 'auto',
    manualHome: cleanText(value.manualHome, 1024),
    managedReplies: value.managedReplies !== false,
    bypassPermissions: value.bypassPermissions === true,
    replyTransport: value.replyTransport === CLAUDE_REPLY_TRANSPORT.DESKTOP
      ? CLAUDE_REPLY_TRANSPORT.DESKTOP
      : CLAUDE_REPLY_TRANSPORT.DIRECT,
    sendShortcut: value.sendShortcut === CLAUDE_SEND_SHORTCUT.CTRL_ENTER
      ? CLAUDE_SEND_SHORTCUT.CTRL_ENTER
      : CLAUDE_SEND_SHORTCUT.ENTER,
    enabledAtMs: enabled && enabledAtMs <= 0 ? Date.now() : enabledAtMs,
    desiredSessionIds: boundedStringList(value.desiredSessionIds, 128, 240),
    readEventIds: boundedStringList(value.readEventIds, 1024, 240),
    notifiedEventIds: boundedStringList(value.notifiedEventIds, 1024, 240),
    sessionPreferences: normalizeClaudeSessionPreferences(value.sessionPreferences),
  };
}

export function buildClaudeVisibleTasks(tasks = [], unread = []) {
  return buildCodexVisibleTasks(tasks, unread);
}

export function resolveClaudeActivity(options = {}) {
  return resolveCodexActivity(options);
}

export function sortClaudeUnreadEvents(events = []) {
  return sortCodexUnreadEvents(events);
}

export function normalizeClaudeTask(task = {}) {
  const id = cleanText(task.id || task.sessionId, 240);
  return {
    ...task,
    id,
    threadId: id,
    sessionId: id,
    provider: 'claude',
    title: sanitizeTaskTitle(task.title || 'Claude Code 会话'),
    project: task.project || sanitizeProjectName(task.cwd),
  };
}
