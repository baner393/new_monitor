import { CODEX_ACTIVITY } from '../shared/codex-integration.js';

export function createCodexViewState() {
  return {
    threadId: '',
    eventId: '',
    mode: 'closed',
    event: null,
  };
}

export function unreadEventsForThread(snapshot, threadId) {
  return (snapshot?.unread || []).filter((event) => String(event?.threadId || '') === String(threadId || ''));
}

function taskFor(snapshot, threadId) {
  return (snapshot?.tasks || []).find((task) => (task.threadId || task.id) === threadId)
    || (snapshot?.visibleTasks || []).find((task) => (task.threadId || task.id) === threadId)
    || null;
}

function eventFor(snapshot, eventId) {
  return (snapshot?.unread || []).find((event) => event.id === eventId) || null;
}

function actionableRequestFor(snapshot, threadId) {
  return (snapshot?.unread || []).find((event) => (
    String(event?.threadId || '') === String(threadId || '')
    && Boolean(event?.requestId)
    && event?.supported !== false
    && event?.activity === CODEX_ACTIVITY.NEEDS_INPUT
  )) || null;
}

function currentEvent(event, task) {
  if (!event || !task) return event;
  return {
    ...event,
    title: task.title || event.title,
    project: task.project || event.project,
  };
}

function taskEvent(task, previous = null) {
  if (!task) return previous;
  return {
    ...(previous || {}),
    id: previous?.id || `task:${task.threadId || task.id}`,
    threadId: task.threadId || task.id,
    sourceThreadId: task.sourceId || task.threadId || task.id,
    provider: task.provider || previous?.provider || 'codex',
    title: task.title,
    project: task.project,
    activity: task.activity || CODEX_ACTIVITY.SILENT,
    kind: 'task',
    message: previous?.message || '',
    canReply: task.capabilities?.reply === true || task.canReply === true,
    requestId: null,
    supported: true,
    createdAtMs: task.updatedAtMs,
  };
}

export function openCodexTask(state, task) {
  const threadId = String(task?.threadId || task?.id || '');
  if (!threadId) return state;
  const unreadEvent = task.events?.[0] || null;
  return {
    threadId,
    eventId: unreadEvent?.id || `task:${threadId}`,
    mode: 'manual',
    event: unreadEvent || taskEvent(task),
  };
}

export function closeCodexTask() {
  return createCodexViewState();
}

export function reconcileCodexViewState(state, snapshot, { allowNotification = true } = {}) {
  if (state?.mode === 'manual' && state.threadId) {
    const task = taskFor(snapshot, state.threadId);
    const current = actionableRequestFor(snapshot, state.threadId) || eventFor(snapshot, state.eventId);
    return {
      ...state,
      eventId: current?.id || state.eventId,
      event: currentEvent(current, task) || taskEvent(task, state.event),
    };
  }
  if (state?.mode === 'notification' && state.threadId) {
    const task = taskFor(snapshot, state.threadId);
    const current = actionableRequestFor(snapshot, state.threadId) || eventFor(snapshot, state.eventId);
    return {
      ...state,
      eventId: current?.id || state.eventId,
      event: currentEvent(current, task) || taskEvent(task, state.event),
    };
  }
  if (!allowNotification) return state || createCodexViewState();
  const alert = snapshot?.alerts?.[0];
  if (!alert) return state || createCodexViewState();
  const task = taskFor(snapshot, String(alert.threadId || ''));
  return {
    threadId: String(alert.threadId || ''),
    eventId: String(alert.id || ''),
    mode: 'notification',
    event: currentEvent(alert, task),
  };
}
