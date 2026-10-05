import {
  CODEX_ACTIVITY,
  CODEX_CONNECTION,
  CODEX_NEW_MESSAGE_VIEW,
  CODEX_REASONING_EFFORTS,
  buildCodexVisibleTasks,
  codexMoodForActivity,
  compactCodexTechnicalPreview,
  normalizeCodexLocale,
  normalizeCodexSessionPreference,
  resolveCodexActivity,
  shouldShowCodexConnectionList,
  sortCodexUnreadEvents,
} from '../shared/codex-integration.js';
import {
  closeCodexTask,
  createCodexViewState,
  openCodexTask,
  reconcileCodexViewState,
  unreadEventsForThread,
} from './codex-view-state.js';
import { renderMarkdown } from './markdown.js';
import {
  CLAUDE_EFFORT_LEVELS,
  CLAUDE_THINKING_MODE,
  normalizeClaudeSessionPreference,
} from '../shared/claude-integration.js';

function element(tag, className, text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

const PROVIDERS = Object.freeze({
  codex: { id: 'codex', name: 'Codex', mark: 'C' },
  claude: { id: 'claude', name: 'Claude Code', mark: '✦' },
});

export function codexConnectionAction(state) {
  if (state === CODEX_CONNECTION.ERROR) return 'retry';
  return state === CODEX_CONNECTION.DISCONNECTED ? 'connect' : 'disconnect';
}

export function providerTask(provider, task) {
  const sourceId = String(task?.threadId || task?.sessionId || task?.id || '');
  const sourceParentThreadId = String(task?.parentThreadId || '');
  return {
    ...task,
    id: `${provider}:${sourceId}`,
    threadId: `${provider}:${sourceId}`,
    sourceId,
    sourceParentThreadId,
    parentThreadId: sourceParentThreadId ? `${provider}:${sourceParentThreadId}` : '',
    provider,
    events: (task?.events || []).map((event) => providerEvent(provider, event)),
  };
}

export function providerEvent(provider, event) {
  const sourceThreadId = String(event?.threadId || event?.sessionId || '');
  return {
    ...event,
    id: `${provider}:${String(event?.id || '')}`,
    sourceEventId: String(event?.id || ''),
    threadId: `${provider}:${sourceThreadId}`,
    sourceThreadId,
    provider,
  };
}

export function combineProviderSnapshots(snapshots) {
  const tasks = [];
  const unread = [];
  const alerts = [];
  for (const provider of Object.keys(PROVIDERS)) {
    const snapshot = snapshots[provider];
    tasks.push(...(snapshot?.tasks || []).map((task) => providerTask(provider, task)));
    unread.push(...(snapshot?.unread || []).map((event) => providerEvent(provider, event)));
    alerts.push(...(snapshot?.alerts || []).map((event) => providerEvent(provider, event)));
  }
  const sortedUnread = sortCodexUnreadEvents(unread);
  const { rootTasks, rootUnread, ...summary } = buildCodexVisibleTasks(tasks, sortedUnread);
  const rootUnreadIds = new Set(rootUnread.map((event) => event.id));
  const rootAlerts = sortCodexUnreadEvents(alerts).filter((event) => rootUnreadIds.has(event.id));
  return {
    configured: Object.values(snapshots).some((snapshot) => snapshot?.configured),
    enabled: Object.values(snapshots).some((snapshot) => snapshot?.enabled),
    connected: Object.values(snapshots).some((snapshot) => snapshot?.connected),
    locale: snapshots.codex?.locale || 'zh-CN',
    activity: resolveCodexActivity({ connected: true, tasks: rootTasks, unread: rootUnread }),
    tasks: rootTasks,
    unread: rootUnread,
    alerts: rootAlerts,
    unreadCount: rootUnread.length,
    ...summary,
    providerCounts: Object.fromEntries(Object.keys(PROVIDERS).map((provider) => [provider, {
      tasks: summary.visibleTasks.filter((task) => task.provider === provider).length,
      unread: rootUnread.filter((event) => event.provider === provider).length,
      running: rootTasks.filter((task) => task.provider === provider
        && task.activity === CODEX_ACTIVITY.RUNNING).length,
    }])),
    updatedAtMs: Math.max(...Object.values(snapshots).map((snapshot) => Number(snapshot?.updatedAtMs || 0)), Date.now()),
  };
}

export function canReuseRenderedMessages({
  activeThreadId,
  renderedThreadId,
  previous,
  messages,
  provider,
  locale,
}) {
  return Boolean(activeThreadId)
    && renderedThreadId === activeThreadId
    && previous?.messages === messages
    && previous.provider === provider
    && previous.locale === locale;
}

const TEXT = {
  'zh-CN': {
    liveTasks: '任务中心', emptyTasks: '当前没有活跃任务', emptyHistory: '没有历史任务', noSearchResults: '没有匹配的任务', activeTasks: '活跃', historyTasks: '历史', searchTasks: '搜索任务或项目…', close: '关闭', back: '返回任务列表',
    openCodex: '打开 Codex', previousPage: '上一页', nextPage: '下一页', send: '发送', handoff: '后台通过 Codex 客户端发送', replyPlaceholder: '直接回复这个任务…', desktopPlaceholder: '输入后尝试后台提交到同一 Codex 任务…',
    configTitle: '连接 Codex', configIntro: '同步全部任务；只有建立可操作连接的任务才能在气泡中直接回复和批准。',
    sync: '消息同步', control: '气泡回复与批准', enable: '启用 Codex 接入', disable: '断开同步', reconnect: '重新检测',
    dataLocation: '对话数据位置', selectHome: '选择其他目录', restoreAuto: '恢复自动检测', advanced: '高级设置',
    allowControl: '允许气泡回复与批准', allowControlNote: '开启后，可在任务气泡中发送消息并处理 Codex 的确认请求。',
    replyTransport: '回复通道', replyDirect: 'Monitor 直连', replyDesktop: 'Codex 客户端后台发送',
    newMessageView: '新消息展示', newMessageConversation: '完整对话', newMessageTasks: '任务动态',
    newMessageConversationNote: '新消息到达时直接打开完整对话，可立即阅读和回复。',
    newMessageTasksNote: '新消息到达时打开任务动态，先查看全部任务再选择对话。',
    replyDirectNote: '消息发送后留在当前窗口，继续查看 Codex 的回复。',
    replyDesktopNote: '通过已运行且开放本机 CDP 的 Codex 客户端后台提交，不会主动打开或置前客户端，但可能切换 Codex 当前选中的任务；系统前台保持尚未实机验证。CDP 不可用或目标无法确认时会失败并保留草稿，不会改走 Monitor 直连。',
    cdpSetupTitle: '准备 Codex 客户端后台发送', cdpSetupNote: '需要重启 Codex 才能开放本机连接。脚本可能会关闭其他 ChatGPT 桌面窗口；请先保存相关未保存内容。桌宠里的回复草稿会保留。', cdpSetupButton: '重启 Codex 并启用连接', cdpSetupStarting: '正在等待确认并连接 Codex…', cdpSetupCancelled: '已取消，Codex 未重启。', cdpSetupReady: 'Codex 后台连接已就绪', cdpSetupFailed: 'Codex 后台连接未能就绪', cdpSetupTransportFailed: '但回复通道没有切换到 Codex 客户端，请手动选择“Codex 客户端后台发送”。',
    localOnly: '数据只在本机读取，不需要 API Key。未连接的任务仍会提醒，并可准确跳转到 Codex。',
    autoPath: '当前用户的 .codex（自动检测）', noPath: '尚未选择目录', connect: '连接', disconnect: '断开', retry: '重试',
    noMessages: '暂时还没有可显示的回复。', loadOlder: '加载更早消息', you: '你', codex: 'Codex', toolCall: '工具调用', toolResult: '工具结果',
    submitAnswers: '提交回答', choose: '请选择', custom: '自己输入…', inputAnswer: '输入回答', answerAll: '请完成所有问题后再提交',
    accept: '本次允许', acceptForSession: '本次会话允许', decline: '拒绝', cancel: '拒绝并停止', stopTurn: '停止任务', stoppingTurn: '正在停止…', stoppedTurn: '任务已停止。',
    goHandle: '前往 Codex 处理', sent: '消息已发送，正在等待 Codex 回复。', handedOff: '已通过后台 Codex 客户端在目标会话确认消息，正在等待回复。', desktopSubmitFailed: 'Codex 客户端/CDP 不可用，或未能确认目标会话收到消息。桌宠草稿已保留；请先检查 Codex 会话再重试，避免重复发送。', handled: '操作已提交，等待 Codex 继续。',
    statusRunning: '运行中', statusNeedsInput: '等待你', statusReady: '新回复', statusBlocked: '遇到问题', statusDisconnected: '未连接', statusSilent: '已同步',
    connDisconnected: '未连接', connWaitingIdle: '等待任务空闲', connConnecting: '正在连接', connConnected: '已连接',
    connReadOnly: 'Codex 正在运行，暂时只读', connError: '连接出错',
    subagentSummary: '子代理状态', subagentSummaryAria: '查看 {count} 个待处理子代理状态',
    subagentRunning: '运行中', subagentNeedsInput: '等待处理', subagentBlocked: '受阻',
    connected: 'Codex 消息已同步', attention: '接入需要处理', readyConnect: '已准备好连接', controlReady: '控制通道已就绪', clientUnified: '由 Codex 客户端统一',
    hookReview: '如果 Codex 弹出 Hooks 审核提示，请在 Codex 中审核并信任 Turtle Monitor；未审核的 Hooks 不会发送实时状态。', hookInstallFailed: 'Codex 实时状态接入失败',
    controlWaiting: '消息正常；控制通道后台连接中', disabled: '尚未启用', messagesNormal: '同步正常', tasksLabel: '任务与会话', openConversation: '查看对话',
  },
  'en-US': {
    liveTasks: 'Task hub', emptyTasks: 'No active tasks right now', emptyHistory: 'No history yet', noSearchResults: 'No matching tasks', activeTasks: 'Active', historyTasks: 'History', searchTasks: 'Search tasks or projects…', close: 'Close', back: 'Back to tasks',
    openCodex: 'Open Codex', previousPage: 'Previous', nextPage: 'Next', send: 'Send', handoff: 'Send through Codex client in background', replyPlaceholder: 'Reply to this task…', desktopPlaceholder: 'Try sending to the same Codex task in background…',
    configTitle: 'Connect Codex', configIntro: 'Sync every task. Inline reply and approval are available after a control connection is established.',
    sync: 'Message sync', control: 'Bubble reply and approval', enable: 'Enable Codex integration', disable: 'Stop syncing', reconnect: 'Check again',
    dataLocation: 'Conversation data location', selectHome: 'Choose another folder', restoreAuto: 'Use automatic detection', advanced: 'Advanced settings',
    allowControl: 'Allow bubble replies and approvals', allowControlNote: 'Send messages and handle Codex confirmation requests from a task bubble.',
    replyTransport: 'Reply channel', replyDirect: 'Monitor direct', replyDesktop: 'Codex client in background',
    newMessageView: 'New message view', newMessageConversation: 'Full conversation', newMessageTasks: 'Task activity',
    newMessageConversationNote: 'Open the full conversation when a new message arrives, ready to read and reply.',
    newMessageTasksNote: 'Open task activity first, then choose which conversation to read.',
    replyDirectNote: 'Stay in this window after sending and continue reading Codex replies here.',
    replyDesktopNote: 'Submits in the background through an already-running Codex client with local CDP enabled. It does not actively open or raise Codex, but may change the selected task; keeping the OS foreground unchanged has not been verified on the live app. If CDP is unavailable or the target cannot be confirmed, submission fails with the pet draft preserved and does not fall back to Monitor direct.',
    cdpSetupTitle: 'Prepare Codex client for background sending', cdpSetupNote: 'Codex must restart to enable its local connection. The helper may also close other ChatGPT desktop windows; save related work first. Pet reply drafts will be preserved.', cdpSetupButton: 'Restart Codex and enable connection', cdpSetupStarting: 'Waiting for confirmation and connecting Codex…', cdpSetupCancelled: 'Cancelled. Codex was not restarted.', cdpSetupReady: 'Codex background connection is ready', cdpSetupFailed: 'Codex background connection could not be enabled', cdpSetupTransportFailed: 'but the reply channel was not switched. Select “Codex client in background” manually.',
    localOnly: 'Data stays on this computer and needs no API key. Unconnected tasks can still notify and open in Codex.',
    autoPath: 'Current user .codex (automatic)', noPath: 'No folder selected', connect: 'Connect', disconnect: 'Disconnect', retry: 'Retry',
    noMessages: 'No visible response yet.', loadOlder: 'Load earlier messages', you: 'You', codex: 'Codex', toolCall: 'Tool call', toolResult: 'Tool result',
    submitAnswers: 'Submit answers', choose: 'Choose', custom: 'Enter another answer…', inputAnswer: 'Enter answer', answerAll: 'Answer every question before submitting',
    accept: 'Allow once', acceptForSession: 'Allow for session', decline: 'Decline', cancel: 'Decline and stop', stopTurn: 'Stop task', stoppingTurn: 'Stopping…', stoppedTurn: 'Task stopped.',
    goHandle: 'Handle in Codex', sent: 'Message sent. Waiting for Codex.', handedOff: 'The background Codex client confirmed the message in the target conversation. Waiting for a reply.', desktopSubmitFailed: 'Codex client/CDP is unavailable, or the target conversation could not be confirmed. The pet draft is preserved. Check Codex before retrying to avoid a duplicate.', handled: 'Action submitted. Waiting for Codex to continue.',
    statusRunning: 'Running', statusNeedsInput: 'Needs you', statusReady: 'New reply', statusBlocked: 'Problem', statusDisconnected: 'Disconnected', statusSilent: 'Synced',
    connDisconnected: 'Not connected', connWaitingIdle: 'Waiting until idle', connConnecting: 'Connecting', connConnected: 'Connected',
    connReadOnly: 'Codex is running; temporarily read-only', connError: 'Connection error',
    subagentSummary: 'Subagent status', subagentSummaryAria: 'Show status for {count} pending subagents',
    subagentRunning: 'Running', subagentNeedsInput: 'Needs input', subagentBlocked: 'Blocked',
    connected: 'Codex messages are synced', attention: 'Integration needs attention', readyConnect: 'Ready to connect', controlReady: 'Control channel ready', clientUnified: 'Unified through Codex client',
    hookReview: 'If Codex asks you to review Hooks, review and trust Turtle Monitor in Codex. Unreviewed Hooks cannot send live status.', hookInstallFailed: 'Could not set up live Codex status',
    controlWaiting: 'Messages are synced; control is connecting in the background', disabled: 'Not enabled', messagesNormal: 'Sync is healthy', tasksLabel: 'Tasks & conversations', openConversation: 'Open conversation',
  },
};

export class CodexCompanion {
  constructor({ onInteractionChange, onConfigClosed, onMoodChange } = {}) {
    this.onInteractionChange = onInteractionChange;
    this.onConfigClosed = onConfigClosed;
    this.onMoodChange = onMoodChange;
    this.config = null;
    this.configs = { codex: null, claude: null };
    this.snapshots = { codex: null, claude: null };
    this.activeProvider = 'codex';
    this.taskFilter = 'all';
    this.taskView = 'active';
    this.taskQuery = '';
    this.snapshot = null;
    this.viewState = createCodexViewState();
    this.trayOpen = false;
    this.configOpen = false;
    this.bubblesSuppressed = false;
    this.readingStabilityEnabled = true;
    this.pinnedFollowPositions = new Map();
    this.anchor = { x: window.innerWidth / 2, y: 180 };
    this.alertFreshUntil = 0;
    this.lastMood = 'idle';
    this.unsubscribes = [];
    this.readInFlight = new Set();
    this.notifiedInFlight = new Set();
    this.pendingDesktopReplies = new Map();
    this.drafts = new Map();
    this.messagePages = new Map();
    this.renderedMessageState = new Map();
    this.renderedThreadId = '';
    this.messageSelectionPointerDown = false;
    this.messageRenderPending = false;
    this.expandedToolMessages = new Set();
    this.inlineError = '';
    this.cdpSetupBusy = false;
    this.cdpSetupStatus = '';
    this.cdpSetupStatusType = 'idle';
    this.positionKeys = new Map();
    this.sizes = new Map();
    this.locale = normalizeCodexLocale(navigator.language);
    this.#build();
  }

  t(key) { return TEXT[this.locale]?.[key] || TEXT['zh-CN'][key] || key; }

  async initialize() {
    const [codexConfig, claudeConfig, codexSnapshot, claudeSnapshot] = await Promise.all([
      window.electronAPI.codex.getConfig(),
      window.electronAPI.claude.getConfig(),
      window.electronAPI.codex.getStatus(),
      window.electronAPI.claude.getStatus(),
    ]);
    this.configs = { codex: codexConfig, claude: claudeConfig };
    this.config = this.configs.codex;
    this.snapshots = { codex: codexSnapshot, claude: claudeSnapshot };
    this.unsubscribes = [
      window.electronAPI.codex.onStatus((snapshot) => this.updateProvider('codex', snapshot)),
      window.electronAPI.claude.onStatus((snapshot) => this.updateProvider('claude', snapshot)),
    ];
    this.#updateCombinedSnapshot();
  }

  destroy() {
    for (const unsubscribe of this.unsubscribes) unsubscribe?.();
    this.resizeObserver?.disconnect();
    window.removeEventListener('pointerup', this.handleMessagePointerEnd, true);
    window.removeEventListener('pointercancel', this.handleMessagePointerEnd, true);
    document.removeEventListener('selectionchange', this.handleMessageSelectionChange);
    this.root.remove();
  }

  updateProvider(provider, snapshot) {
    if (!PROVIDERS[provider] || !snapshot) return;
    this.snapshots[provider] = snapshot;
    this.#updateCombinedSnapshot();
  }

  #updateCombinedSnapshot() {
    this.update(combineProviderSnapshots(this.snapshots));
  }

  #api(provider = this.#currentProvider()) {
    return window.electronAPI[provider] || window.electronAPI.codex;
  }

  #currentProvider() {
    return this.viewState.event?.provider || this.#currentTask()?.provider || this.activeProvider || 'codex';
  }

  #currentSourceThreadId() {
    const task = this.#currentTask();
    return String(task?.sourceId || this.viewState.event?.sourceThreadId || this.viewState.threadId || '').replace(/^claude:/, '');
  }

  #renderEffortSlider(host, efforts, selected, onSelect) {
    host.replaceChildren();
    host.classList.add('agent-effort-slider');
    const selectedIndex = Math.max(0, efforts.indexOf(selected));
    host.style.setProperty('--effort-position', String(selectedIndex));
    host.style.setProperty('--effort-count', String(Math.max(1, efforts.length)));
    const range = element('input', 'agent-effort-range');
    range.type = 'range';
    range.min = '0';
    range.max = String(Math.max(0, efforts.length - 1));
    range.step = '1';
    range.value = String(selectedIndex);
    range.setAttribute('aria-label', this.locale === 'en-US' ? 'Reasoning effort' : '推理强度');
    range.addEventListener('input', () => {
      const effort = efforts[Number(range.value)] || efforts[0];
      host.dataset.value = effort;
      host.classList.toggle('agent-effort-max', effort === 'max' || effort === 'ultra');
      host.style.setProperty('--effort-position', range.value);
    });
    host.dataset.value = efforts[selectedIndex] || efforts[0] || '';
    host.classList.toggle('agent-effort-max', host.dataset.value === 'max' || host.dataset.value === 'ultra');
    range.addEventListener('change', () => onSelect(efforts[Number(range.value)] || efforts[0]));
    host.appendChild(range);
    const labels = element('div', 'agent-effort-labels');
    for (const effort of efforts) {
      const label = element('span', 'agent-effort-label', effort);
      label.dataset.effort = effort;
      if (effort === 'max' || effort === 'ultra') label.classList.add('agent-effort-peak');
      labels.appendChild(label);
    }
    host.appendChild(labels);
  }

  #renderClaudeThinkingControl(preserveSelection = false) {
    const task = this.#currentTask();
    const provider = task?.provider || this.viewState.event?.provider || this.#currentProvider();
    const config = this.configs.claude || {};
    const direct = config.replyTransport !== 'desktop';
    const sourceId = this.#currentSourceThreadId();
    const trigger = this.bubble.querySelector('.claude-thinking-trigger');
    const popover = this.bubble.querySelector('.claude-thinking-popover');
    const visible = provider === 'claude' && direct && Boolean(sourceId);
    trigger.hidden = !visible;
    if (!visible) {
      popover.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      return;
    }

    const stored = normalizeClaudeSessionPreference(config.sessionPreferences?.[sourceId]);
    const modeSelect = this.bubble.querySelector('.claude-thinking-mode');
    const effortHost = this.bubble.querySelector('.claude-effort');
    if (!preserveSelection) {
      modeSelect.value = stored.thinkingMode;
    }
    const mode = modeSelect.value || stored.thinkingMode;
    const labels = this.locale === 'en-US'
      ? { auto: 'Auto compatibility', inherit: 'Follow Claude Code', adaptive: 'Adaptive thinking', disabled: 'Thinking off' }
      : { auto: '自动兼容', inherit: '沿用 Claude Code', adaptive: '自适应思考', disabled: '关闭思考' };
    for (const option of modeSelect.options) option.textContent = labels[option.value] || option.value;
    trigger.textContent = this.locale === 'en-US' ? `Reasoning · ${labels[mode]}` : `推理 · ${labels[mode]}`;
    trigger.title = this.locale === 'en-US' ? 'Reasoning for this conversation' : '设置当前会话的推理方式';
    trigger.setAttribute('aria-expanded', String(!popover.hidden));
    this.bubble.querySelector('.claude-thinking-title').textContent = this.locale === 'en-US' ? 'Reasoning' : '推理设置';
    this.bubble.querySelector('.claude-thinking-mode-label').textContent = this.locale === 'en-US' ? 'Thinking mode' : '思考方式';
    this.bubble.querySelector('.claude-thinking-mode-help').textContent = this.locale === 'en-US' ? 'Only affects this conversation' : '仅影响当前会话';
    this.bubble.querySelector('.claude-effort-label').textContent = this.locale === 'en-US' ? 'Effort' : '推理强度';
    this.bubble.querySelector('.claude-effort-help').textContent = this.locale === 'en-US' ? 'Passed explicitly to Claude Code' : '显式传给 Claude Code';
    this.#renderEffortSlider(effortHost, CLAUDE_EFFORT_LEVELS, stored.effort, (effort) => this.#saveClaudeThinkingPreference(effort));
    const notes = this.locale === 'en-US'
      ? {
          auto: 'Uses normal Claude settings on official connections and disables thinking on third-party gateways to avoid thinking.type 400 errors.',
          inherit: 'Keeps the settings used by the original Claude Code environment.',
          disabled: 'Best compatibility for gateways or models that reject thinking parameters.',
          adaptive: 'Lets Claude Code adapt its thinking behavior while retaining the selected effort.',
        }
      : {
          auto: '官方连接沿用 Claude 设置；第三方网关关闭思考，避免 thinking.type 400。',
          inherit: '保持原 Claude Code 环境中的设置。',
          disabled: '适合不接受思考参数的网关或模型，兼容性最高。',
          adaptive: '允许 Claude Code 自适应思考，同时保留所选强度。',
        };
    this.bubble.querySelector('.claude-thinking-note').textContent = notes[mode] || notes.auto;
  }

  async #saveClaudeThinkingPreference(nextEffort = null) {
    const sourceId = this.#currentSourceThreadId();
    if (!sourceId || this.#currentProvider() !== 'claude') return;
    const modeSelect = this.bubble.querySelector('.claude-thinking-mode');
    const stored = normalizeClaudeSessionPreference(this.configs.claude?.sessionPreferences?.[sourceId]);
    const preference = normalizeClaudeSessionPreference({ thinkingMode: modeSelect.value, effort: nextEffort || stored.effort });
    modeSelect.disabled = true;
    this.bubble.querySelectorAll('.claude-effort button').forEach((button) => { button.disabled = true; });
    try {
      const current = this.configs.claude || {};
      this.configs.claude = await this.#api('claude').saveConfig({
        ...current,
        sessionPreferences: { ...(current.sessionPreferences || {}), [sourceId]: preference },
      });
      this.#renderClaudeThinkingControl();
    } catch (error) {
      this.#showBubbleError(error?.message || String(error));
    } finally {
      modeSelect.disabled = false;
      this.bubble.querySelectorAll('.claude-effort button').forEach((button) => { button.disabled = false; });
    }
  }

  #supportedCodexEfforts(task) {
    const models = this.snapshots.codex?.reasoningModels || [];
    const exact = models.find((item) => item.model === task?.model);
    const available = exact?.efforts?.length
      ? exact.efforts
      : [...new Set(models.flatMap((item) => item.efforts || []))];
    return CODEX_REASONING_EFFORTS.filter((effort) => !available.length || available.includes(effort));
  }

  #renderCodexReasoningControl() {
    const task = this.#currentTask();
    const config = this.configs.codex || {};
    const sourceId = this.#currentSourceThreadId();
    const direct = config.replyTransport !== 'desktop';
    const trigger = this.bubble.querySelector('.codex-reasoning-trigger');
    const popover = this.bubble.querySelector('.codex-reasoning-popover');
    const visible = this.#currentProvider() === 'codex' && direct && Boolean(sourceId);
    trigger.hidden = !visible;
    if (!visible) {
      popover.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      return;
    }

    const stored = normalizeCodexSessionPreference(config.sessionPreferences?.[sourceId]);
    const supported = this.#supportedCodexEfforts(task);
    const effectiveEffort = task?.model && !supported.includes(stored.effort) ? 'inherit' : stored.effort;
    const effortHost = this.bubble.querySelector('.codex-reasoning-effort');
    this.#renderEffortSlider(effortHost, supported, effectiveEffort === 'inherit' ? supported[0] : effectiveEffort, (effort) => this.#saveCodexReasoningPreference(effort));
    const modeSelect = this.bubble.querySelector('.codex-thinking-mode');
    modeSelect.value = effectiveEffort === 'inherit' ? 'inherit' : 'custom';
    modeSelect.options[0].textContent = this.locale === 'en-US' ? 'Follow Codex configuration' : '跟随 Codex 配置';
    modeSelect.options[1].textContent = this.locale === 'en-US' ? 'Use this conversation setting' : '使用本会话设置';
    const display = effectiveEffort === 'inherit'
      ? (this.locale === 'en-US' ? 'Follow configuration' : '跟随配置')
      : effectiveEffort;
    trigger.textContent = this.locale === 'en-US' ? `Reasoning · ${display}` : `推理 · ${display}`;
    trigger.title = this.locale === 'en-US' ? 'Reasoning effort for this conversation' : '设置当前会话的推理强度';
    trigger.setAttribute('aria-expanded', String(!popover.hidden));
    this.bubble.querySelector('.codex-reasoning-title').textContent = this.locale === 'en-US' ? 'Reasoning' : '推理设置';
    this.bubble.querySelector('.codex-thinking-mode-label').textContent = this.locale === 'en-US' ? 'Thinking mode' : '思考方式';
    this.bubble.querySelector('.codex-thinking-mode-help').textContent = this.locale === 'en-US' ? 'Choose where this conversation gets its reasoning setting' : '选择当前会话的思考设置来源';
    this.bubble.querySelector('.codex-reasoning-label').textContent = this.locale === 'en-US' ? 'Effort' : '推理强度';
    this.bubble.querySelector('.codex-reasoning-help').textContent = this.locale === 'en-US' ? 'Only affects this conversation' : '仅影响当前会话';
    this.bubble.querySelector('.codex-reasoning-note').textContent = effectiveEffort === 'inherit'
      ? (this.locale === 'en-US' ? 'Uses the model and effort already selected by Codex.' : '继续使用 Codex 中原本选择的模型与推理强度。')
      : (this.locale === 'en-US' ? 'Applied when the next new turn starts.' : '将在下一次新回合开始时应用。');
  }

  async #saveCodexReasoningPreference(nextEffort = 'inherit') {
    const sourceId = this.#currentSourceThreadId();
    if (!sourceId || this.#currentProvider() !== 'codex') return;
    const preference = normalizeCodexSessionPreference({ effort: nextEffort });
    this.bubble.querySelectorAll('.codex-reasoning-effort input, .codex-thinking-mode').forEach((node) => { node.disabled = true; });
    try {
      const current = await this.#api('codex').getConfig();
      this.configs.codex = await this.#api('codex').saveConfig({
        ...current,
        sessionPreferences: { ...(current.sessionPreferences || {}), [sourceId]: preference },
      });
      this.#renderCodexReasoningControl();
    } catch (error) {
      this.#showBubbleError(error?.message || String(error));
    } finally {
      this.bubble.querySelectorAll('.codex-reasoning-effort input, .codex-thinking-mode').forEach((node) => { node.disabled = false; });
    }
  }

  #build() {
    this.root = element('div', 'codex-companion-root');
    this.root.setAttribute('aria-live', 'polite');

    this.badge = element('button', 'codex-pet-signal');
    this.badge.type = 'button';
    this.badge.hidden = true;
    this.badge.innerHTML = '<span class="agent-hub-mark" aria-hidden="true">▤</span><span class="agent-badge agent-badge-codex" hidden><i>C</i><b>0</b></span><span class="agent-badge agent-badge-claude" hidden><i>✦</i><b>0</b></span>';
    this.root.appendChild(this.badge);

    this.taskTray = element('section', 'codex-task-tray');
    this.taskTray.hidden = true;
    this.taskTray.innerHTML = `
      <header class="codex-tray-head">
        <div><div class="codex-config-kicker">TASK HUB</div><strong class="codex-live-title"></strong></div>
        <button class="codex-icon-button codex-tray-config" type="button" aria-label="agent config">⚙</button>
        <button class="codex-icon-button codex-tray-close" type="button">×</button>
      </header>
      <div class="codex-task-views" role="tablist" aria-label="Task view">
        <button type="button" role="tab" data-view="active" class="active"></button>
        <button type="button" role="tab" data-view="history"></button>
      </div>
      <label class="codex-task-search"><span aria-hidden="true">⌕</span><input type="search" autocomplete="off"></label>
      <div class="agent-task-filters" role="tablist">
        <button type="button" data-provider="all" class="active">全部 <b>0</b></button>
        <button type="button" data-provider="codex"><i>C</i> Codex <b>0</b></button>
        <button type="button" data-provider="claude"><i>✦</i> Claude <b>0</b></button>
      </div>
      <div class="codex-task-list"></div>
      <div class="codex-task-empty"></div>`;
    this.root.appendChild(this.taskTray);

    this.bubble = element('section', 'codex-message-bubble');
    this.bubble.hidden = true;
    this.bubble.innerHTML = `
      <header class="codex-bubble-head">
        <div class="codex-bubble-signal"></div>
        <button class="codex-icon-button codex-task-back" type="button">←</button>
        <div class="codex-bubble-heading"><div class="codex-bubble-project"></div><div class="codex-bubble-title-row"><div class="codex-bubble-title"></div><button class="codex-reasoning-trigger" type="button" hidden></button><button class="claude-thinking-trigger" type="button" hidden></button></div></div>
        <div class="codex-bubble-state"></div>
        <button class="codex-icon-button codex-bubble-close" type="button">×</button>
      </header>
      <section class="claude-thinking-popover" hidden>
        <header><div><small>THIS CONVERSATION</small><strong class="claude-thinking-title"></strong></div><button class="codex-icon-button claude-thinking-close" type="button">脳</button></header>
        <label class="claude-thinking-field"><span><strong class="claude-thinking-mode-label"></strong><small class="claude-thinking-mode-help"></small></span><select class="claude-thinking-mode"><option value="auto"></option><option value="inherit"></option><option value="adaptive"></option><option value="disabled"></option></select></label>
        <section class="agent-effort-field claude-effort-field"><span><strong class="claude-effort-label"></strong><small class="claude-effort-help"></small></span><div class="claude-effort agent-effort-slider" role="group"></div></section>
        <div class="claude-thinking-note"></div>
      </section>
      <section class="codex-reasoning-popover" hidden>
        <header><div><small>THIS CONVERSATION</small><strong class="codex-reasoning-title"></strong></div><button class="codex-icon-button codex-reasoning-close" type="button">×</button></header>
        <label class="codex-thinking-field"><span><strong class="codex-thinking-mode-label"></strong><small class="codex-thinking-mode-help"></small></span><select class="codex-thinking-mode"><option value="inherit"></option><option value="custom"></option></select></label>
        <section class="agent-effort-field codex-reasoning-field"><span><strong class="codex-reasoning-label"></strong><small class="codex-reasoning-help"></small></span><div class="codex-reasoning-effort agent-effort-slider" role="group"></div></section>
        <div class="codex-reasoning-note"></div>
      </section>
      <button class="codex-load-older" type="button" hidden></button>
      <div class="codex-bubble-scroll" tabindex="0"><div class="codex-message-list"></div><div class="codex-bubble-empty"></div></div>
      <div class="codex-bubble-notice"></div>
      <div class="codex-bubble-questions"></div>
      <div class="codex-bubble-compose"><textarea rows="2" maxlength="12000"></textarea><div class="codex-compose-actions"><button class="codex-send-button" type="button"></button><button class="codex-stop-turn" type="button" hidden></button></div></div>
      <footer class="codex-bubble-footer">
        <button class="codex-quiet-button codex-page-up" type="button"></button>
        <span class="codex-page-status"></span>
        <button class="codex-quiet-button codex-page-down" type="button"></button>
        <button class="codex-quiet-button codex-open-app" type="button"></button>
      </footer>
      <div class="codex-bubble-actions"></div>
      <div class="codex-inline-error" role="status"></div>`;
    this.root.appendChild(this.bubble);

    this.configPanel = element('section', 'codex-config-panel');
    this.configPanel.hidden = true;
    this.configPanel.innerHTML = `
      <header class="codex-config-head">
        <div><div class="codex-config-kicker">PET LINK / AI TASKS</div><h2 class="codex-config-title"></h2></div>
        <button class="codex-icon-button codex-config-close" type="button">×</button>
      </header>
      <p class="codex-config-intro"></p>
      <div class="agent-provider-cards" role="tablist">
        <button type="button" data-provider="codex" class="active"><span class="agent-provider-mark">C</span><span><strong>Codex</strong><small class="agent-provider-codex-status"></small></span><i></i></button>
        <button type="button" data-provider="claude"><span class="agent-provider-mark">✦</span><span><strong>Claude Code</strong><small class="agent-provider-claude-status"></small></span><i></i></button>
      </div>
      <div class="codex-link-rail" aria-hidden="true"><span>PET</span><i></i><span class="agent-link-provider">CODEX</span></div>
      <div class="codex-config-status" data-state="checking"><span class="codex-status-light"></span><div><strong></strong><small></small></div></div>
      <div class="codex-capability-grid">
        <div><span class="codex-sync-label"></span><strong class="codex-sync-state"></strong></div>
        <div><span class="codex-control-label"></span><strong class="codex-reply-state"></strong></div>
      </div>
      <section class="codex-client-cdp" hidden>
        <div><strong class="codex-client-cdp-title"></strong><small class="codex-client-cdp-note"></small></div>
        <button class="codex-quiet-button codex-client-cdp-button" type="button"></button>
        <div class="codex-client-cdp-status" role="status" aria-live="polite"></div>
      </section>
      <div class="codex-connect-actions"><button class="codex-save-button codex-connect-button" type="button"></button><button class="codex-quiet-button codex-disconnect-button" type="button" hidden></button></div>
      <section class="codex-thread-connections"><div class="codex-section-label codex-task-connection-label"></div><div class="codex-connection-list"></div></section>
      <div class="codex-location-card">
        <div class="codex-section-label codex-data-location-label"></div><div class="codex-path-value"></div>
        <div class="codex-location-actions"><button class="codex-select-home" type="button"></button><button class="codex-quiet-button codex-use-auto" type="button" hidden></button></div>
      </div>
      <details class="codex-advanced"><summary></summary>
        <label class="codex-switch-row"><span><strong class="codex-control-setting-label"></strong><small class="codex-control-setting-note"></small></span><input class="codex-managed" type="checkbox"><i></i></label>
        <div class="codex-choice-row"><span><strong class="codex-new-message-view-label"></strong><small class="codex-new-message-view-note"></small></span><div class="codex-segmented codex-new-message-view" role="radiogroup"><label><input type="radio" name="codex-new-message-view" value="conversation"><span class="codex-new-message-conversation"></span></label><label><input type="radio" name="codex-new-message-view" value="tasks"><span class="codex-new-message-tasks"></span></label></div></div>
        <label class="codex-select-row"><span><strong class="codex-reply-transport-label"></strong><small class="codex-reply-transport-note"></small></span><select class="codex-reply-transport"><option value="direct"></option><option value="desktop"></option></select></label>
        <label class="codex-select-row agent-send-shortcut-row"><span><strong class="agent-send-shortcut-label"></strong><small class="agent-send-shortcut-note"></small></span><select class="agent-send-shortcut"><option value="enter">Enter</option><option value="ctrl-enter">Ctrl+Enter</option></select></label>
        <label class="codex-switch-row agent-bypass-row"><span><strong class="agent-bypass-label"></strong><small class="agent-bypass-note"></small></span><input class="agent-bypass-permissions" type="checkbox"><i></i></label>
        <div class="agent-bypass-warning" hidden></div>
        <div class="codex-config-note"></div>
      </details>
      <footer class="codex-config-actions"><button class="codex-quiet-button codex-config-refresh" type="button"></button></footer>
      <div class="codex-config-error" role="status"></div>`;
    this.root.appendChild(this.configPanel);
    document.body.appendChild(this.root);

    for (const eventName of ['pointerdown', 'mousedown', 'click', 'contextmenu']) {
      this.root.addEventListener(eventName, (event) => event.stopPropagation());
    }

    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => {
        for (const entry of entries) this.sizes.set(entry.target, entry.contentRect);
        this.updatePosition(true);
      })
      : null;
    for (const node of [this.bubble, this.taskTray, this.configPanel, this.badge]) this.resizeObserver?.observe(node);

    this.badge.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openTaskHub();
    });
    this.badge.querySelectorAll('.agent-badge').forEach((badge) => badge.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.taskFilter = badge.classList.contains('agent-badge-claude') ? 'claude' : 'codex';
      this.openTaskHub();
    }));
    this.taskTray.querySelectorAll('.agent-task-filters button').forEach((button) => button.addEventListener('click', () => {
      this.taskFilter = button.dataset.provider || 'all';
      this.#renderTaskTray();
    }));
    this.taskTray.querySelectorAll('.codex-task-views button').forEach((button) => button.addEventListener('click', () => {
      this.taskView = button.dataset.view === 'history' ? 'history' : 'active';
      this.#renderTaskTray();
    }));
    this.taskTray.querySelector('.codex-task-search input').addEventListener('input', (event) => {
      this.taskQuery = event.currentTarget.value.trim().toLocaleLowerCase();
      this.#renderTaskTray();
    });
    this.taskTray.querySelector('.codex-tray-close').addEventListener('click', () => this.closeTaskTray());
    // 挂饰模式下点击宠物的弹跳流程不可达，config 面板从这里补一个入口。
    this.taskTray.querySelector('.codex-tray-config').addEventListener('click', () => this.openConfig());
    this.bubble.querySelector('.codex-task-back').addEventListener('click', async () => {
      await this.#closeDetail(true);
      this.trayOpen = true;
      this.#renderTaskTray();
    });
    this.bubble.querySelector('.codex-bubble-close').addEventListener('click', () => this.#closeDetail(true));
    this.bubble.querySelector('.codex-reasoning-trigger').addEventListener('click', () => {
      const popover = this.bubble.querySelector('.codex-reasoning-popover');
      popover.hidden = !popover.hidden;
      this.#renderCodexReasoningControl();
      this.updatePosition(true);
      this.onInteractionChange?.();
    });
    this.bubble.querySelector('.codex-reasoning-close').addEventListener('click', () => {
      this.bubble.querySelector('.codex-reasoning-popover').hidden = true;
      this.bubble.querySelector('.codex-reasoning-trigger').setAttribute('aria-expanded', 'false');
      this.updatePosition(true);
      this.onInteractionChange?.();
    });
    this.bubble.querySelector('.codex-thinking-mode').addEventListener('change', (event) => {
      if (event.target.value === 'inherit') this.#saveCodexReasoningPreference('inherit');
      else {
        const range = this.bubble.querySelector('.codex-reasoning-effort .agent-effort-range');
        const efforts = this.#supportedCodexEfforts(this.#currentTask());
        this.#saveCodexReasoningPreference(efforts[Number(range?.value)] || efforts[0]);
      }
    });
    this.bubble.querySelector('.claude-thinking-trigger').addEventListener('click', () => {
      const popover = this.bubble.querySelector('.claude-thinking-popover');
      popover.hidden = !popover.hidden;
      this.#renderClaudeThinkingControl();
      this.updatePosition(true);
      this.onInteractionChange?.();
    });
    this.bubble.querySelector('.claude-thinking-close').addEventListener('click', () => {
      this.bubble.querySelector('.claude-thinking-popover').hidden = true;
      this.bubble.querySelector('.claude-thinking-trigger').setAttribute('aria-expanded', 'false');
      this.updatePosition(true);
      this.onInteractionChange?.();
    });
    this.bubble.querySelector('.claude-thinking-mode').addEventListener('change', () => {
      this.#renderClaudeThinkingControl(true);
      this.#saveClaudeThinkingPreference();
    });
    this.bubble.querySelector('.codex-stop-turn').addEventListener('click', () => this.#interruptTurn());
    this.bubble.querySelector('.codex-open-app').addEventListener('click', () => this.#openInProvider());
    this.bubble.querySelector('.codex-page-up').addEventListener('click', () => this.#page(-1));
    this.bubble.querySelector('.codex-page-down').addEventListener('click', () => this.#page(1));
    this.bubble.querySelector('.codex-load-older').addEventListener('click', () => this.#loadMessages(true));
    this.bubble.querySelector('.codex-send-button').addEventListener('click', () => this.#sendText());
    this.bubble.querySelector('textarea').addEventListener('input', (event) => {
      if (this.viewState.threadId) this.drafts.set(this.viewState.threadId, event.target.value);
    });
    this.bubble.querySelector('textarea').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.shiftKey) return;
      const provider = this.#currentProvider();
      const shortcut = this.configs[provider]?.sendShortcut || 'enter';
      const shouldSend = shortcut === 'enter' || event.ctrlKey || event.metaKey;
      if (!shouldSend) return;
      event.preventDefault();
      this.#sendText();
    });
    this.bubble.querySelector('.codex-bubble-scroll').addEventListener('scroll', () => this.#onScroll());
    const messageList = this.bubble.querySelector('.codex-message-list');
    messageList.addEventListener('pointerdown', (event) => {
      if (event.button === 0 && event.target.closest?.('.codex-message-text')) {
        this.messageSelectionPointerDown = true;
      }
    });
    this.handleMessagePointerEnd = () => {
      if (!this.messageSelectionPointerDown) return;
      this.messageSelectionPointerDown = false;
      queueMicrotask(() => this.#flushPendingMessageRender());
    };
    this.handleMessageSelectionChange = () => this.#flushPendingMessageRender();
    window.addEventListener('pointerup', this.handleMessagePointerEnd, true);
    window.addEventListener('pointercancel', this.handleMessagePointerEnd, true);
    document.addEventListener('selectionchange', this.handleMessageSelectionChange);
    messageList.addEventListener('click', (event) => {
      const link = event.target.closest?.('.codex-markdown-link');
      if (!link) return;
      event.preventDefault();
      const href = link.dataset.href;
      if (href) this.#api().openLink(href).catch((error) => this.#showBubbleError(error?.message || String(error)));
    });

    this.configPanel.querySelectorAll('.agent-provider-cards button').forEach((button) => button.addEventListener('click', () => {
      this.activeProvider = button.dataset.provider === 'claude' ? 'claude' : 'codex';
      this.config = this.configs[this.activeProvider];
      this.#fillConfig();
      this.updatePosition(true);
    }));
    this.configPanel.querySelector('.codex-config-close').addEventListener('click', () => this.closeConfig());
    this.configPanel.querySelector('.codex-select-home').addEventListener('click', () => this.#selectHome());
    this.configPanel.querySelector('.codex-use-auto').addEventListener('click', async () => {
      this.#setPendingMode('auto');
      await this.#commitConfig({ enabled: true });
    });
    this.configPanel.querySelector('.codex-connect-button').addEventListener('click', () => this.#commitConfig({ enabled: true }));
    this.configPanel.querySelector('.codex-disconnect-button').addEventListener('click', () => this.#commitConfig({ enabled: false }));
    this.configPanel.querySelector('.codex-managed').addEventListener('change', () => this.#commitConfig({ enabled: this.config?.enabled === true }));
    this.configPanel.querySelectorAll('.codex-new-message-view input').forEach((input) => {
      input.addEventListener('change', () => this.#commitConfig({ enabled: this.config?.enabled === true }));
    });
    this.configPanel.querySelector('.codex-reply-transport').addEventListener('change', () => this.#commitConfig({ enabled: this.config?.enabled === true }));
    this.configPanel.querySelector('.codex-client-cdp-button').addEventListener('click', () => this.#enableCodexClientCdp());
    this.configPanel.querySelector('.agent-send-shortcut').addEventListener('change', () => this.#commitConfig({ enabled: this.config?.enabled === true }));
    this.configPanel.querySelector('.agent-bypass-permissions').addEventListener('change', () => this.#commitConfig({ enabled: this.config?.enabled === true }));
    this.configPanel.querySelector('.codex-advanced').addEventListener('toggle', () => this.updatePosition(true));
    this.configPanel.querySelector('.codex-config-refresh').addEventListener('click', async () => {
      this.#setConfigBusy(true);
      try {
        this.snapshots[this.activeProvider] = await this.#api(this.activeProvider).refresh();
        this.#updateCombinedSnapshot();
      }
      finally { this.#setConfigBusy(false); }
    });
    this.#localizeStatic();
  }

  #localizeStatic() {
    this.badge.setAttribute('aria-label', this.t('liveTasks'));
    this.taskTray.querySelector('.codex-live-title').textContent = this.t('liveTasks');
    this.taskTray.querySelector('.codex-task-empty').textContent = this.t('emptyTasks');
    this.taskTray.querySelector('.codex-task-views [data-view="active"]').textContent = this.t('activeTasks');
    this.taskTray.querySelector('.codex-task-views [data-view="history"]').textContent = this.t('historyTasks');
    this.taskTray.querySelector('.codex-task-search input').placeholder = this.t('searchTasks');
    this.taskTray.querySelector('.codex-task-search input').setAttribute('aria-label', this.t('searchTasks'));
    this.taskTray.querySelector('.codex-tray-close').setAttribute('aria-label', this.t('close'));
    this.bubble.querySelector('.codex-task-back').setAttribute('aria-label', this.t('back'));
    this.bubble.querySelector('.codex-bubble-close').setAttribute('aria-label', this.t('close'));
    this.bubble.querySelector('.codex-open-app').textContent = this.t('openCodex');
    this.bubble.querySelector('.codex-page-up').textContent = this.t('previousPage');
    this.bubble.querySelector('.codex-page-down').textContent = this.t('nextPage');
    this.bubble.querySelector('.codex-load-older').textContent = this.t('loadOlder');
    this.bubble.querySelector('.codex-send-button').textContent = this.t('send');
    this.bubble.querySelector('textarea').placeholder = this.t('replyPlaceholder');
    this.configPanel.querySelector('.codex-config-title').textContent = this.t('configTitle');
    this.configPanel.querySelector('.codex-config-intro').textContent = this.t('configIntro');
    this.configPanel.querySelector('.codex-sync-label').textContent = this.t('sync');
    this.configPanel.querySelector('.codex-control-label').textContent = this.t('control');
    this.configPanel.querySelector('.codex-task-connection-label').textContent = this.t('tasksLabel');
    this.configPanel.querySelector('.codex-data-location-label').textContent = this.t('dataLocation');
    this.configPanel.querySelector('.codex-select-home').textContent = this.t('selectHome');
    this.configPanel.querySelector('.codex-use-auto').textContent = this.t('restoreAuto');
    this.configPanel.querySelector('.codex-advanced summary').textContent = this.t('advanced');
    this.configPanel.querySelector('.codex-control-setting-label').textContent = this.t('allowControl');
    this.configPanel.querySelector('.codex-control-setting-note').textContent = this.t('allowControlNote');
    this.configPanel.querySelector('.codex-new-message-view-label').textContent = this.t('newMessageView');
    this.configPanel.querySelector('.codex-new-message-conversation').textContent = this.t('newMessageConversation');
    this.configPanel.querySelector('.codex-new-message-tasks').textContent = this.t('newMessageTasks');
    this.configPanel.querySelector('.codex-reply-transport-label').textContent = this.t('replyTransport');
    this.configPanel.querySelector('.codex-reply-transport option[value="direct"]').textContent = this.t('replyDirect');
    this.configPanel.querySelector('.codex-reply-transport option[value="desktop"]').textContent = this.t('replyDesktop');
    this.configPanel.querySelector('.codex-config-note').textContent = this.t('localOnly');
    this.configPanel.querySelector('.codex-client-cdp-title').textContent = this.t('cdpSetupTitle');
    this.configPanel.querySelector('.codex-client-cdp-note').textContent = this.t('cdpSetupNote');
    this.configPanel.querySelector('.codex-client-cdp-button').textContent = this.t('cdpSetupButton');
    this.configPanel.querySelector('.codex-config-refresh').textContent = this.t('reconnect');
    this.configPanel.querySelector('.codex-disconnect-button').textContent = this.t('disable');
  }

  update(snapshot) {
    if (!snapshot) return;
    this.snapshot = snapshot;
    this.#reconcilePendingDesktopReplies(snapshot);
    const nextLocale = normalizeCodexLocale(snapshot.locale, navigator.language);
    if (nextLocale !== this.locale) {
      this.locale = nextLocale;
      this.#localizeStatic();
    }
    this.#presentNewMessages(!this.configOpen && !this.bubblesSuppressed);
    this.#renderBadge();
    this.#renderTaskTray();
    this.#renderConfigStatus();
    this.#renderConnectionList();
    if (this.viewState.mode !== 'closed') {
      this.#renderBubble();
      const page = this.messagePages.get(this.viewState.threadId);
      const sourceUpdatedAtMs = Number(this.#currentTask()?.updatedAtMs || 0);
      if (page?.loaded && sourceUpdatedAtMs > Number(page.sourceUpdatedAtMs || 0)) {
        page.sourceUpdatedAtMs = sourceUpdatedAtMs;
        void this.#loadMessages(false, true);
      }
    }
    this.#emitMood();
    this.updatePosition();
    this.onInteractionChange?.();
  }

  openConfig() {
    this.configOpen = true;
    this.configPanel.hidden = false;
    this.bubble.hidden = true;
    this.closeTaskTray();
    this.#renderBadge();
    this.#fillConfig();
    this.updatePosition(true);
    this.onInteractionChange?.();
  }

  closeConfig({ notify = true } = {}) {
    if (!this.configOpen) return;
    this.configOpen = false;
    this.configPanel.hidden = true;
    this.#renderBadge();
    this.#presentNewMessages(true);
    if (this.trayOpen) this.#renderTaskTray();
    else if (this.viewState.mode !== 'closed') this.#renderBubble();
    this.onInteractionChange?.();
    if (notify) this.onConfigClosed?.();
  }

  settleForRefresh() {
    const wasOpen = this.configOpen;
    if (wasOpen) this.closeConfig({ notify: false });
    return wasOpen;
  }

  setBubblesSuppressed(suppressed) {
    const next = suppressed === true;
    if (next === this.bubblesSuppressed) return;
    this.bubblesSuppressed = next;
    if (next) {
      this.bubble.hidden = true;
      this.taskTray.hidden = true;
    } else if (!this.configOpen) {
      this.#presentNewMessages(true);
      if (this.trayOpen) this.#renderTaskTray();
      else if (this.viewState.mode !== 'closed') this.#renderBubble();
    }
    this.#renderBadge();
    this.#emitMood();
    this.onInteractionChange?.();
  }

  updateFrame() { this.#emitMood(); this.updatePosition(); }
  setAnchor(x, y) { this.anchor = { x, y }; this.updatePosition(); }

  setReadingStability(enabled) {
    const next = enabled !== false;
    if (next === this.readingStabilityEnabled) return;
    this.readingStabilityEnabled = next;
    if (!next) this.pinnedFollowPositions.clear();
    this.updatePosition(true);
  }

  #presentNewMessages(allowPresentation) {
    const previousEventId = this.viewState.eventId;
    const useTaskActivity = this.configs.codex?.newMessageView === CODEX_NEW_MESSAGE_VIEW.TASK_ACTIVITY;
    if (useTaskActivity && this.viewState.mode === 'notification') this.viewState = closeCodexTask();
    this.viewState = reconcileCodexViewState(this.viewState, this.snapshot, {
      allowNotification: allowPresentation && !useTaskActivity,
    });
    if (!allowPresentation || this.viewState.mode === 'manual') return;
    if (useTaskActivity && this.snapshot?.alerts?.length) {
      this.trayOpen = true;
      this.bubble.hidden = true;
      this.alertFreshUntil = Date.now() + 6000;
      for (const alert of this.snapshot.alerts) this.#markNotified(alert.id);
      return;
    }
    if (this.viewState.mode === 'notification' && this.viewState.eventId
      && this.viewState.eventId !== previousEventId) {
      this.alertFreshUntil = Date.now() + 6000;
      this.#markNotified(this.viewState.eventId);
    }
  }

  #place(node, x, y, force = false) {
    const key = `${Math.round(x)},${Math.round(y)}`;
    if (!force && this.positionKeys.get(node) === key) return;
    this.positionKeys.set(node, key);
    node.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  #resolveFollowPosition(node, proposed, width, height, open) {
    const stable = this.readingStabilityEnabled && open;
    if (!stable) {
      this.pinnedFollowPositions.delete(node);
      return proposed;
    }
    if (!this.pinnedFollowPositions.has(node)) this.pinnedFollowPositions.set(node, { ...proposed });
    const pinned = this.pinnedFollowPositions.get(node);
    pinned.x = clamp(pinned.x, 12, window.innerWidth - width - 12);
    pinned.y = clamp(pinned.y, 62, window.innerHeight - height - 12);
    return pinned;
  }

  updatePosition(force = false) {
    const bubbleWidth = 430;
    const configWidth = 448;
    const preferRight = this.anchor.x < window.innerWidth - bubbleWidth - 90;
    const bubbleLeft = preferRight ? this.anchor.x + 54 : this.anchor.x - bubbleWidth - 54;
    const bubbleHeight = this.sizes.get(this.bubble)?.height || 430;
    const configHeight = this.sizes.get(this.configPanel)?.height || 560;
    const trayHeight = this.sizes.get(this.taskTray)?.height || 300;
    const bubblePosition = this.#resolveFollowPosition(this.bubble, {
      x: clamp(bubbleLeft, 12, window.innerWidth - bubbleWidth - 12),
      y: clamp(this.anchor.y - 92, 62, window.innerHeight - bubbleHeight - 12),
      side: preferRight ? 'right' : 'left',
    }, bubbleWidth, bubbleHeight, this.isConversationOpen);
    this.bubble.dataset.side = bubblePosition.side;
    this.#place(this.bubble, bubblePosition.x, bubblePosition.y, force);
    const configPosition = this.#resolveFollowPosition(this.configPanel, {
      x: clamp(this.anchor.x - configWidth / 2, 12, window.innerWidth - configWidth - 12),
      y: clamp(this.anchor.y + 58, 62, window.innerHeight - configHeight - 12),
    }, configWidth, configHeight, this.configOpen);
    this.#place(this.configPanel, configPosition.x, configPosition.y, force);
    this.#place(this.badge, this.anchor.x + 29, this.anchor.y - 42, force);
    const trayPosition = this.#resolveFollowPosition(this.taskTray, {
      x: clamp(bubbleLeft, 12, window.innerWidth - 360 - 12),
      y: clamp(this.anchor.y - 70, 62, window.innerHeight - trayHeight - 12),
      side: preferRight ? 'right' : 'left',
    }, 360, trayHeight, this.trayOpen && !this.taskTray.hidden);
    this.taskTray.dataset.side = trayPosition.side;
    this.#place(this.taskTray, trayPosition.x, trayPosition.y, force);
  }

  containsPoint(x, y, pad = 0) {
    return [this.configPanel, this.bubble, this.taskTray, this.badge].some((node) => {
      if (node.hidden) return false;
      const bounds = node.getBoundingClientRect();
      return x >= bounds.left - pad && x <= bounds.right + pad
        && y >= bounds.top - pad && y <= bounds.bottom + pad;
    });
  }

  ownsEvent(event) {
    return Boolean(event?.composedPath?.().includes(this.root)
      || (event?.target instanceof Node && this.root.contains(event.target)));
  }

  get capturesOutsideClicks() { return this.configOpen || this.trayOpen; }
  get isConversationOpen() { return !this.bubble.hidden && this.viewState.mode !== 'closed'; }
  get isFollowPanelOpen() { return this.configOpen || (this.trayOpen && !this.taskTray.hidden) || this.isConversationOpen; }
  get isReadingConversationOpen() { return !this.bubble.hidden && this.viewState.mode === 'manual'; }
  get pausesPetMotion() {
    return this.configOpen
      || this.trayOpen
      || (!this.bubble.hidden
        && (this.bubble.matches(':hover') || this.bubble.contains(document.activeElement)));
  }
  get activity() {
    if (!Object.values(this.configs).some((config) => config?.enabled === true)) return CODEX_ACTIVITY.SILENT;
    if (!this.pendingDesktopReplies.size) return this.snapshot?.activity || CODEX_ACTIVITY.SILENT;
    const pendingIds = new Set(this.pendingDesktopReplies.keys());
    const tasks = (this.snapshot?.tasks || []).map((task) => (
      pendingIds.has(String(task.threadId || task.id))
        ? { ...task, activity: CODEX_ACTIVITY.RUNNING }
        : task
    ));
    const unread = (this.snapshot?.unread || []).filter((event) => !pendingIds.has(String(event.threadId || '')));
    return resolveCodexActivity({ connected: this.snapshot?.connected !== false, tasks, unread });
  }

  #reconcilePendingDesktopReplies(snapshot) {
    for (const [threadId, pending] of this.pendingDesktopReplies) {
      const task = (snapshot?.tasks || []).find((item) => String(item.threadId || item.id) === threadId);
      if (!task) continue;
      const newUnread = (snapshot?.unread || []).some((event) => (
        String(event.threadId || '') === threadId
        && Number(event.createdAtMs || 0) > pending.submittedAtMs
      ));
      const statusUpdatedAfterSubmit = Number(task.activityUpdatedAtMs || 0) > pending.submittedAtMs;
      const activeStateConfirmed = statusUpdatedAfterSubmit && [
        CODEX_ACTIVITY.RUNNING,
        CODEX_ACTIVITY.NEEDS_INPUT,
        CODEX_ACTIVITY.BLOCKED,
        CODEX_ACTIVITY.READY,
      ].includes(task.activity);
      const finishedRunConfirmed = statusUpdatedAfterSubmit
        && pending.baselineActivity === CODEX_ACTIVITY.RUNNING
        && task.activity === CODEX_ACTIVITY.SILENT;
      if (newUnread || activeStateConfirmed || finishedRunConfirmed) {
        this.pendingDesktopReplies.delete(threadId);
      }
    }
  }
  get motionEventKey() {
    if (this.activity === CODEX_ACTIVITY.RUNNING) {
      return (this.snapshot?.visibleTasks || [])
        .filter((task) => task.activity === CODEX_ACTIVITY.RUNNING)
        .map((task) => task.threadId || task.id).sort().join('|');
    }
    return this.viewState.eventId || this.activity;
  }
  get mood() {
    if (this.bubblesSuppressed || this.configOpen) return 'idle';
    const alertFresh = this.activity === CODEX_ACTIVITY.NEEDS_INPUT || Date.now() < this.alertFreshUntil;
    return codexMoodForActivity(this.activity, { alertFresh });
  }

  #emitMood() {
    const mood = this.mood;
    if (mood === this.lastMood) return;
    this.lastMood = mood;
    this.onMoodChange?.(mood);
  }

  #statusLabel(activity) {
    return ({
      [CODEX_ACTIVITY.RUNNING]: this.t('statusRunning'),
      [CODEX_ACTIVITY.NEEDS_INPUT]: this.t('statusNeedsInput'),
      [CODEX_ACTIVITY.READY]: this.t('statusReady'),
      [CODEX_ACTIVITY.BLOCKED]: this.t('statusBlocked'),
      [CODEX_ACTIVITY.DISCONNECTED]: this.t('statusDisconnected'),
    })[activity] || this.t('statusSilent');
  }

  #connectionLabel(state, provider = 'codex') {
    return ({
      [CODEX_CONNECTION.WAITING_IDLE]: this.t('connWaitingIdle'),
      [CODEX_CONNECTION.CONNECTING]: this.t('connConnecting'),
      [CODEX_CONNECTION.CONNECTED]: this.t('connConnected'),
      [CODEX_CONNECTION.TEMPORARY_READ_ONLY]: provider === 'claude'
        ? (this.locale === 'en-US' ? 'Claude Code is running; temporarily read-only' : 'Claude Code 正在运行，暂时只读')
        : this.t('connReadOnly'),
      [CODEX_CONNECTION.ERROR]: this.t('connError'),
    })[state] || this.t('connDisconnected');
  }

  #renderBadge() {
    const counts = this.snapshot?.providerCounts || {};
    const active = Object.keys(PROVIDERS).filter((provider) => {
      const providerCount = counts[provider] || {};
      return Number(providerCount.unread || 0) > 0 || Number(providerCount.running || 0) > 0;
    });
    this.badge.hidden = this.configOpen || this.bubblesSuppressed;
    if (this.badge.hidden) return;
    this.badge.querySelector('.agent-hub-mark').hidden = active.length > 0;
    for (const provider of Object.keys(PROVIDERS)) {
      const providerCount = counts[provider] || {};
      const unread = Number(providerCount.unread || 0);
      const running = Number(providerCount.running || 0);
      const count = unread > 0 ? unread : running;
      const node = this.badge.querySelector(`.agent-badge-${provider}`);
      node.hidden = count <= 0;
      node.querySelector('b').textContent = count > 99 ? '99+' : String(count);
      node.dataset.mode = unread > 0 ? 'unread' : 'running';
    }
    this.badge.classList.toggle('single-provider', active.length === 1);
    this.badge.classList.toggle('hub-idle', active.length === 0);
    this.badge.dataset.activity = this.snapshot?.activity || CODEX_ACTIVITY.RUNNING;
    this.badge.setAttribute('aria-label', active.length
      ? `${this.t('liveTasks')}：${active.map((provider) => `${PROVIDERS[provider].name} ${counts[provider]?.unread || counts[provider]?.running || 0}`).join('，')}`
      : this.t('liveTasks'));
  }

  /**
   * 环形菜单「任务对话」入口打开任务中心；没有活跃任务时直接显示可搜索历史。
   */
  openAgentConversation() {
    if (this.configOpen || this.bubblesSuppressed) {
      console.log(`[Agent] openAgentConversation blocked: configOpen=${this.configOpen} bubblesSuppressed=${this.bubblesSuppressed}`);
      return;
    }
    const tasks = this.snapshot?.visibleTasks || [];
    if (tasks.length > 0) {
      this.#openTask(tasks[0]);
      return;
    }
    this.taskView = 'history';
    this.toggleTaskTray(true);
  }

  openTaskHub() {
    if (this.configOpen || this.bubblesSuppressed) return;
    this.trayOpen = true;
    this.taskView = (this.snapshot?.visibleTasks || []).length ? 'active' : 'history';
    this.bubble.hidden = true;
    this.#renderTaskTray();
    this.updatePosition(true);
    this.onInteractionChange?.();
  }

  toggleTaskTray(forceOpen = false) {    if (this.configOpen || this.bubblesSuppressed) return;
    const opening = forceOpen || !this.trayOpen;
    this.trayOpen = opening;
    if (opening) this.taskView = (this.snapshot?.visibleTasks || []).length ? 'active' : 'history';
    if (this.trayOpen) this.bubble.hidden = true;
    else if (this.viewState.mode !== 'closed') this.#renderBubble();
    this.#renderTaskTray();
    this.updatePosition(true);
    this.onInteractionChange?.();
  }

  closeTaskTray() {
    this.trayOpen = false;
    this.taskTray.hidden = true;
    if (!this.configOpen && this.viewState.mode !== 'closed' && !this.bubblesSuppressed) this.#renderBubble();
    this.onInteractionChange?.();
  }

  #renderTaskTray() {
    this.taskTray.hidden = !this.trayOpen || this.configOpen || this.bubblesSuppressed;
    const host = this.taskTray.querySelector('.codex-task-list');
    const activeTasks = this.snapshot?.visibleTasks || [];
    const activeIds = new Set(activeTasks.map((task) => String(task.threadId || task.id)));
    const historyTasks = (this.snapshot?.tasks || []).filter((task) => !activeIds.has(String(task.threadId || task.id)));
    const sourceTasks = this.taskView === 'history' ? historyTasks : activeTasks;
    const query = this.taskQuery;
    const tasks = sourceTasks
      .filter((task) => this.taskFilter === 'all' || task.provider === this.taskFilter)
      .filter((task) => !query || `${task.title || ''} ${task.project || ''} ${PROVIDERS[task.provider]?.name || ''} ${this.#statusLabel(task.activity)}`.toLocaleLowerCase().includes(query))
      .sort((left, right) => {
        const leftPriority = left.activity === CODEX_ACTIVITY.NEEDS_INPUT
          || left.activity === CODEX_ACTIVITY.BLOCKED
          || left.connectionState === CODEX_CONNECTION.ERROR ? 0 : 1;
        const rightPriority = right.activity === CODEX_ACTIVITY.NEEDS_INPUT
          || right.activity === CODEX_ACTIVITY.BLOCKED
          || right.connectionState === CODEX_CONNECTION.ERROR ? 0 : 1;
        return leftPriority - rightPriority || Number(right.updatedAtMs || 0) - Number(left.updatedAtMs || 0);
      });
    for (const button of this.taskTray.querySelectorAll('.codex-task-views button')) {
      button.classList.toggle('active', button.dataset.view === this.taskView);
      button.setAttribute('aria-selected', String(button.dataset.view === this.taskView));
      button.tabIndex = button.dataset.view === this.taskView ? 0 : -1;
    }
    for (const button of this.taskTray.querySelectorAll('.agent-task-filters button')) {
      const provider = button.dataset.provider || 'all';
      button.classList.toggle('active', provider === this.taskFilter);
      const count = provider === 'all' ? sourceTasks.length : sourceTasks.filter((task) => task.provider === provider).length;
      button.querySelector('b').textContent = String(count);
    }
    host.replaceChildren();
    for (const task of tasks) {
      const entry = element('div', 'codex-task-entry');
      const row = element('div', 'codex-task-row');
      const button = element('button', 'codex-task-item');
      button.type = 'button';
      button.dataset.provider = task.provider || 'codex';
      button.dataset.activity = task.activity || CODEX_ACTIVITY.SILENT;
      button.innerHTML = '<span class="codex-task-state" aria-hidden="true"></span><span class="agent-task-provider" aria-hidden="true"></span><span class="codex-task-copy"><strong></strong><small></small></span><span class="codex-task-count"></span>';
      button.querySelector('.agent-task-provider').textContent = PROVIDERS[task.provider]?.mark || 'C';
      button.querySelector('strong').textContent = task.title || PROVIDERS[task.provider]?.name || 'Codex';
      const status = task.connectionState === CODEX_CONNECTION.ERROR
        ? this.#connectionLabel(task.connectionState, task.provider)
        : this.#statusLabel(task.activity);
      button.querySelector('small').textContent = `${task.project || PROVIDERS[task.provider]?.name || 'Codex'} · ${status}`;
      const count = button.querySelector('.codex-task-count');
      count.textContent = task.unreadCount > 0 ? String(task.unreadCount) : (task.activity === CODEX_ACTIVITY.RUNNING ? 'RUN' : 'LINK');
      count.dataset.mode = task.unreadCount > 0 ? 'unread' : 'running';
      button.addEventListener('click', () => this.#openTask(task));
      row.appendChild(button);

      const subagents = task.subagentSummary;
      if (Number(subagents?.total) > 0) {
        row.classList.add('has-subagents');
        const toggle = element('button', 'codex-subagent-toggle', `↳${subagents.total}`);
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', 'false');
        const ariaLabel = this.t('subagentSummaryAria').replace('{count}', String(subagents.total));
        toggle.setAttribute('aria-label', ariaLabel);
        toggle.title = ariaLabel;
        const detail = element('div', 'codex-subagent-details');
        detail.hidden = true;
        const states = [
          ['running', 'subagentRunning'],
          ['needsInput', 'subagentNeedsInput'],
          ['blocked', 'subagentBlocked'],
        ];
        const counts = states
          .filter(([key]) => Number(subagents[key]) > 0)
          .map(([key, label]) => `${this.t(label)} ${subagents[key]}`)
          .join(' · ');
        detail.textContent = `${this.t('subagentSummary')} · ${counts}`;
        toggle.addEventListener('click', () => {
          detail.hidden = !detail.hidden;
          toggle.setAttribute('aria-expanded', String(!detail.hidden));
        });
        row.appendChild(toggle);
        entry.append(row, detail);
      } else {
        entry.appendChild(row);
      }
      host.appendChild(entry);
    }
    const empty = this.taskTray.querySelector('.codex-task-empty');
    empty.textContent = query
      ? this.t('noSearchResults')
      : this.taskView === 'history' ? this.t('emptyHistory') : this.t('emptyTasks');
    empty.hidden = tasks.length > 0;
  }

  #openTask(task) {
    this.#saveScroll();
    this.inlineError = '';
    this.viewState = openCodexTask(this.viewState, task);
    void this.#markThreadRead(this.viewState.threadId).catch(() => {});
    this.trayOpen = false;
    this.taskTray.hidden = true;
    this.#renderBubble();
    this.#loadMessages(false, true);
    this.updatePosition(true);
    this.onInteractionChange?.();
  }

  #currentTask() {
    const id = this.viewState.threadId;
    return this.snapshot?.tasks?.find((task) => (task.threadId || task.id) === id)
      || this.snapshot?.visibleTasks?.find((task) => (task.threadId || task.id) === id)
      || null;
  }

  #renderBubble() {
    const event = this.viewState.event;
    this.bubble.hidden = !event || this.configOpen || this.bubblesSuppressed || this.trayOpen;
    if (this.bubble.hidden) return;
    const task = this.#currentTask();
    const provider = task?.provider || event.provider || 'codex';
    const providerName = PROVIDERS[provider]?.name || 'Codex';
    this.bubble.dataset.provider = provider;
    this.bubble.dataset.activity = event.activity || task?.activity || CODEX_ACTIVITY.SILENT;
    this.bubble.querySelector('.codex-bubble-project').textContent = `${PROVIDERS[provider]?.mark || 'C'} ${providerName} · ${event.project || task?.project || providerName}`;
    this.bubble.querySelector('.codex-bubble-title').textContent = task?.title || event.title || providerName;
    this.bubble.querySelector('.codex-bubble-state').textContent = this.#statusLabel(event.activity || task?.activity);
    const stopButton = this.bubble.querySelector('.codex-stop-turn');
    stopButton.textContent = this.t('stopTurn');
    stopButton.hidden = task?.capabilities?.interrupt !== true;
    this.bubble.querySelector('.codex-inline-error').textContent = this.inlineError;
    const textarea = this.bubble.querySelector('textarea');
    const providerConfig = this.configs[provider] || {};
    const desktopCompatible = providerConfig.replyTransport === 'desktop';
    this.#renderCodexReasoningControl();
    this.#renderClaudeThinkingControl();
    this.bubble.querySelector('.codex-open-app').textContent = provider === 'claude' ? '打开 Claude Code' : this.t('openCodex');
    this.bubble.querySelector('.codex-send-button').textContent = provider === 'claude' && desktopCompatible
      ? (this.locale === 'en-US' ? 'Send through Claude Code' : '通过 Claude Code 发送')
      : this.t(desktopCompatible ? 'handoff' : 'send');
    const sendHint = (providerConfig.sendShortcut || 'enter') === 'ctrl-enter' ? 'Ctrl+Enter' : 'Enter';
    textarea.placeholder = provider === 'claude'
      ? (this.locale === 'en-US'
          ? `${desktopCompatible ? 'Reply through the same Claude Code session' : 'Reply to this Claude Code task'}… (${sendHint} to send)`
          : `${desktopCompatible ? '发送到 Claude Code 同一会话' : '回复这个 Claude Code 任务'}…（${sendHint} 发送）`)
      : `${this.t(desktopCompatible ? 'desktopPlaceholder' : 'replyPlaceholder')}${this.locale === 'en-US'
          ? ` (${sendHint} to send)` : `（${sendHint} 发送）`}`;
    if (document.activeElement !== textarea) textarea.value = this.drafts.get(this.viewState.threadId) || '';

    const compose = this.bubble.querySelector('.codex-bubble-compose');
    const questions = this.bubble.querySelector('.codex-bubble-questions');
    const actions = this.bubble.querySelector('.codex-bubble-actions');
    const notice = this.bubble.querySelector('.codex-bubble-notice');
    const actionableEvent = event?.requestId
      ? event
      : task?.events?.find((candidate) => candidate?.requestId && candidate?.supported !== false) || null;
    const approvalLike = ['commandApproval', 'fileApproval', 'permissionApproval', 'approval'].includes(event?.kind)
      || event?.activity === CODEX_ACTIVITY.NEEDS_INPUT;
    questions.replaceChildren();
    actions.replaceChildren();
    compose.hidden = true;
    notice.textContent = '';

    if (actionableEvent?.kind === 'question') this.#renderQuestions(actionableEvent, questions);
    else if (actionableEvent) this.#renderApprovalActions(actionableEvent, actions);
    else if (event?.requestId && event.supported === false) this.#renderOpenCodexAction(actions);
    else if (approvalLike) this.#renderOpenCodexAction(actions);
    else if (task?.capabilities?.reply === true || task?.capabilities?.interrupt === true) compose.hidden = false;
    else if (task?.connectionError) notice.textContent = task.connectionError;
    else if (task?.connectionState && task.connectionState !== CODEX_CONNECTION.CONNECTED) notice.textContent = this.#connectionLabel(task.connectionState, provider);
    this.bubble.querySelector('.codex-send-button').hidden = task?.capabilities?.reply !== true;
    textarea.hidden = task?.capabilities?.reply !== true;

    const page = this.messagePages.get(this.viewState.threadId);
    if (!page?.loaded) {
      this.#renderMessages(true);
      this.#loadMessages(false, true);
    }
    else this.#renderMessages();
    this.updatePosition(true);
    this.onInteractionChange?.();
  }

  async #loadMessages(older = false, force = false) {
    const threadId = this.viewState.threadId;
    if (!threadId) return;
    const task = this.#currentTask();
    const provider = task?.provider || this.viewState.event?.provider || 'codex';
    const sourceId = task?.sourceId || this.viewState.event?.sourceThreadId || threadId.replace(/^[^:]+:/, '');
    const current = this.messagePages.get(threadId) || {
      messages: [], nextCursor: null, total: 0, loaded: false, loading: false,
      scrollTop: null, sourceUpdatedAtMs: 0, refreshPending: false,
    };
    if (current.loading) {
      if (force && !older) current.refreshPending = true;
      return;
    }
    if (older && current.loaded && current.nextCursor === null) return;
    if (!force && !older && current.loaded) return;
    current.loading = true;
    this.messagePages.set(threadId, current);
    const scroller = this.bubble.querySelector('.codex-bubble-scroll');
    const previousHeight = scroller.scrollHeight;
    const wasAtBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 24;
    try {
      const result = await this.#api(provider).getMessages(sourceId, older ? current.nextCursor : null, 50);
      if (this.viewState.threadId !== threadId) return;
      const merged = older ? [...result.messages, ...current.messages] : result.messages;
      const seen = new Set();
      current.messages = merged.filter((message) => {
        const key = message.id || `${message.role}:${message.createdAtMs}:${message.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      current.nextCursor = result.nextCursor;
      current.total = result.total;
      current.loaded = true;
      current.sourceUpdatedAtMs = Math.max(
        Number(current.sourceUpdatedAtMs || 0),
        Number(this.#currentTask()?.updatedAtMs || 0),
      );
      this.#renderMessages();
      requestAnimationFrame(() => {
        if (older) scroller.scrollTop += scroller.scrollHeight - previousHeight;
        else if (wasAtBottom || current.scrollTop === null) scroller.scrollTop = scroller.scrollHeight;
        else scroller.scrollTop = current.scrollTop;
        this.#updatePageStatus();
      });
    } catch (error) {
      current.sourceUpdatedAtMs = 0;
      this.#showBubbleError(error?.message || String(error));
    } finally {
      current.loading = false;
      if (current.refreshPending) {
        current.refreshPending = false;
        queueMicrotask(() => this.#loadMessages(false, true));
      }
    }
  }

  #messageSelectionProtected() {
    if (this.renderedThreadId && this.renderedThreadId !== this.viewState.threadId) return false;
    if (this.messageSelectionPointerDown) return true;
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    const host = this.bubble.querySelector('.codex-message-list');
    return host.contains(selection.anchorNode) || host.contains(selection.focusNode);
  }

  #flushPendingMessageRender() {
    if (!this.messageRenderPending || this.#messageSelectionProtected()) return;
    this.#renderMessages(true);
  }

  #renderMessages(force = false) {
    const page = this.messagePages.get(this.viewState.threadId);
    const provider = this.#currentProvider();
    const host = this.bubble.querySelector('.codex-message-list');
    const empty = this.bubble.querySelector('.codex-bubble-empty');
    const messages = page?.messages || [];
    const previous = this.renderedMessageState.get(this.viewState.threadId);
    const unchanged = canReuseRenderedMessages({
      activeThreadId: this.viewState.threadId,
      renderedThreadId: this.renderedThreadId,
      previous,
      messages,
      provider,
      locale: this.locale,
    });
    if (!force && unchanged) {
      const older = this.bubble.querySelector('.codex-load-older');
      older.hidden = !page?.nextCursor;
      older.disabled = page?.loading === true;
      this.#updatePageStatus();
      return;
    }
    if (this.#messageSelectionProtected()) {
      this.messageRenderPending = true;
      return;
    }
    this.messageRenderPending = false;
    host.replaceChildren();
    for (const message of messages) {
      const article = element('article', 'codex-message-item');
      article.dataset.role = message.role;
      article.dataset.kind = message.kind || 'message';
      const roleLabel = message.role === 'user' ? this.t('you')
        : message.role === 'tool'
          ? (message.kind === 'tool-result' ? this.t('toolResult') : this.t('toolCall'))
          : (provider === 'claude' ? 'Claude Code' : this.t('codex'));
      if (message.role === 'tool') {
        const messageKey = message.id || `${message.role}:${message.createdAtMs}:${message.message}`;
        const disclosure = element('details', 'codex-tool-disclosure');
        disclosure.open = this.expandedToolMessages.has(messageKey);
        const summary = element('summary', 'codex-tool-summary');
        summary.append(
          element('span', 'codex-message-role', roleLabel),
          element('span', 'codex-tool-preview', compactCodexTechnicalPreview(message.message)),
        );
        const body = element('div', 'codex-message-text', message.message);
        disclosure.append(summary, body);
        disclosure.addEventListener('toggle', () => {
          if (disclosure.open) this.expandedToolMessages.add(messageKey);
          else this.expandedToolMessages.delete(messageKey);
        });
        article.append(disclosure);
        host.appendChild(article);
        continue;
      }
      article.append(element('div', 'codex-message-role', roleLabel));
      const body = element('div', 'codex-message-text');
      body.innerHTML = renderMarkdown(message.message);
      article.append(body);
      host.appendChild(article);
    }
    this.renderedMessageState.set(this.viewState.threadId, {
      messages,
      provider,
      locale: this.locale,
    });
    this.renderedThreadId = this.viewState.threadId;
    const eventText = this.viewState.event?.message;
    empty.textContent = host.childElementCount === 0 ? (eventText || this.t('noMessages')) : '';
    empty.hidden = host.childElementCount > 0;
    const older = this.bubble.querySelector('.codex-load-older');
    older.hidden = !page?.nextCursor;
    older.disabled = page?.loading === true;
    this.#updatePageStatus();
  }

  #renderQuestions(event, host) {
    for (const question of event.questions || []) {
      const row = element('label', 'codex-question-row');
      row.appendChild(element('span', 'codex-question-prompt', question.question || this.t('choose')));
      const select = element('select', 'codex-question-input');
      select.dataset.questionId = question.id;
      for (const option of question.options || []) {
        const node = element('option', '', option.label);
        node.value = option.label;
        select.appendChild(node);
      }
      const custom = element('option', '', this.t('custom'));
      custom.value = '__custom__';
      select.appendChild(custom);
      const input = element('input', 'codex-question-custom');
      input.placeholder = this.t('inputAnswer');
      input.hidden = true;
      select.addEventListener('change', () => { input.hidden = select.value !== '__custom__'; });
      row.append(select, input);
      host.appendChild(row);
    }
    const send = element('button', 'codex-save-button', this.t('submitAnswers'));
    send.type = 'button';
    send.addEventListener('click', () => this.#submitQuestions(event));
    host.appendChild(send);
  }

  #renderApprovalActions(event, host) {
    const labels = { accept: this.t('accept'), acceptForSession: this.t('acceptForSession'), decline: this.t('decline'), cancel: this.t('cancel') };
    const decisions = (event.availableDecisions || []).filter((item) => typeof item === 'string');
    for (const decision of decisions.length ? decisions : ['accept', 'acceptForSession', 'decline']) {
      if (!labels[decision]) continue;
      const button = element('button', decision.startsWith('accept') ? 'codex-save-button' : 'codex-quiet-button', labels[decision]);
      button.type = 'button';
      button.addEventListener('click', () => this.#respond(event, { decision }));
      host.appendChild(button);
    }
  }

  #renderOpenCodexAction(host) {
    const provider = this.#currentProvider();
    const button = element('button', 'codex-save-button', provider === 'claude' ? '前往 Claude Code 处理' : this.t('goHandle'));
    button.type = 'button';
    button.addEventListener('click', () => this.#openInProvider());
    host.appendChild(button);
  }

  async #submitQuestions(event) {
    const answers = {};
    for (const select of this.bubble.querySelectorAll('.codex-question-input')) {
      const custom = select.parentElement.querySelector('.codex-question-custom');
      const answer = select.value === '__custom__' ? custom.value.trim() : select.value;
      if (!answer) { this.#showBubbleError(this.t('answerAll')); return; }
      answers[select.dataset.questionId] = { answers: [answer] };
    }
    await this.#respond(event, { answers });
  }

  async #respond(event, response) {
    this.#setBubbleBusy(true);
    try {
      const provider = event.provider || this.#currentProvider();
      await this.#api(provider).respond(event.requestId, response);
      await this.#markRead(event.id);
      this.viewState = {
        ...this.viewState,
        event: { ...event, requestId: null, kind: 'task', activity: CODEX_ACTIVITY.RUNNING, message: this.t('handled') },
      };
      this.#renderBubble();
    } catch (error) { this.#showBubbleError(error?.message || String(error)); }
    finally { this.#setBubbleBusy(false); }
  }

  async #interruptTurn() {
    const task = this.#currentTask();
    const sourceId = task?.sourceId || this.viewState.event?.sourceThreadId || this.viewState.threadId.replace(/^[^:]+:/, '');
    const provider = this.#currentProvider();
    if (!sourceId || !this.#api(provider)?.interrupt) return;
    this.#setBubbleBusy(true);
    const stopButton = this.bubble.querySelector('.codex-stop-turn');
    stopButton.textContent = this.t('stoppingTurn');
    try {
      await this.#api(provider).interrupt(sourceId);
      this.inlineError = '';
      this.viewState = {
        ...this.viewState,
        event: {
          ...this.viewState.event,
          requestId: null,
          kind: 'task',
          activity: CODEX_ACTIVITY.SILENT,
          message: this.t('stoppedTurn'),
        },
      };
      this.#renderBubble();
    } catch (error) { this.#showBubbleError(error?.message || String(error)); }
    finally { this.#setBubbleBusy(false); }
  }

  async #sendText() {
    const textarea = this.bubble.querySelector('textarea');
    const text = textarea.value.trim();
    const threadId = this.viewState.threadId;
    if (!threadId || !text) return;
    const task = this.#currentTask();
    const provider = task?.provider || this.viewState.event?.provider || 'codex';
    const sourceId = task?.sourceId || this.viewState.event?.sourceThreadId || threadId.replace(/^[^:]+:/, '');
    const desktopReplyBaseline = provider === 'codex' ? {
      baselineActivity: task?.activity || CODEX_ACTIVITY.SILENT,
    } : null;
    this.#setBubbleBusy(true);
    try {
      const result = await this.#api(provider).reply(sourceId, text);
      const clientMode = result?.mode === 'desktop-submit' || result?.mode === 'client-submit';
      if (clientMode && result?.submitted !== true) {
        throw new Error(result?.submitError || result?.openError || (provider === 'claude'
          ? (this.locale === 'en-US'
              ? 'The message was copied and Claude Code opened, but automatic submission was not confirmed. The draft was preserved.'
              : '消息已复制并打开 Claude Code，但未确认自动提交；草稿已保留。')
          : this.t('desktopSubmitFailed')));
      }
      if (provider === 'codex' && result?.mode === 'desktop-submit') {
        const taskThreadId = `codex:${sourceId}`;
        this.pendingDesktopReplies.set(taskThreadId, {
          ...desktopReplyBaseline,
          submittedAtMs: Number(result.submittedAtMs || Date.now()),
        });
        this.#reconcilePendingDesktopReplies(this.snapshot);
        this.#emitMood();
      }
      this.inlineError = '';
      textarea.value = '';
      this.drafts.delete(threadId);
      if (this.viewState.eventId) await this.#markRead(this.viewState.eventId);
      this.viewState = {
        ...this.viewState,
        event: {
          ...this.viewState.event,
          requestId: null,
          kind: 'task',
          activity: CODEX_ACTIVITY.RUNNING,
          message: provider === 'claude'
            ? (clientMode ? '消息已通过 Claude Code 原窗口提交，正在等待回复。' : '消息已发送，正在等待 Claude Code 回复。')
            : this.t(clientMode ? 'handedOff' : 'sent'),
        },
      };
      if (!clientMode) await this.#loadMessages(false, true);
      this.#renderBubble();
    } catch (error) { this.#showBubbleError(error?.message || String(error)); }
    finally { this.#setBubbleBusy(false); }
  }

  async #closeDetail(markRead) {
    const threadId = this.viewState.threadId;
    this.#saveScroll();
    if (markRead && threadId) await this.#markThreadRead(threadId);
    this.viewState = closeCodexTask();
    if (this.bubble.contains(document.activeElement)) document.activeElement.blur();
    this.bubble.hidden = true;
    this.#emitMood();
    this.onInteractionChange?.();
  }

  async #markRead(eventId) {
    if (!eventId || eventId.startsWith('task:') || this.readInFlight.has(eventId)) return;
    const event = this.snapshot?.unread?.find((item) => item.id === eventId);
    const provider = event?.provider || String(eventId).split(':', 1)[0] || 'codex';
    const sourceEventId = event?.sourceEventId || String(eventId).replace(/^[^:]+:/, '');
    this.readInFlight.add(eventId);
    try { await this.#api(provider).markRead(sourceEventId); }
    finally { this.readInFlight.delete(eventId); }
  }

  async #markNotified(eventId) {
    if (!eventId || this.notifiedInFlight.has(eventId)) return;
    const event = this.snapshot?.alerts?.find((item) => item.id === eventId)
      || this.snapshot?.unread?.find((item) => item.id === eventId);
    const provider = event?.provider || String(eventId).split(':', 1)[0] || 'codex';
    const sourceEventId = event?.sourceEventId || String(eventId).replace(/^[^:]+:/, '');
    this.notifiedInFlight.add(eventId);
    try { await this.#api(provider).markNotified(sourceEventId); }
    finally { this.notifiedInFlight.delete(eventId); }
  }

  async #markThreadRead(threadId) {
    const events = unreadEventsForThread(this.snapshot, threadId);
    if (events.length) {
      const provider = events[0].provider || 'codex';
      const readIds = new Set(events.map((event) => event.sourceEventId || String(event.id).replace(/^[^:]+:/, '')));
      const sourceIds = new Set(events.map((event) => event.sourceThreadId || String(event.threadId).replace(/^[^:]+:/, '')));
      const providerSnapshot = this.snapshots[provider];
      if (providerSnapshot) {
        const unread = (providerSnapshot.unread || []).filter((event) => (
          !sourceIds.has(String(event.threadId || event.sessionId || ''))
        ));
        const alerts = (providerSnapshot.alerts || []).filter((event) => (
          !readIds.has(String(event.id || ''))
        ));
        this.snapshots[provider] = { ...providerSnapshot, unread, alerts, unreadCount: unread.length };
        this.#updateCombinedSnapshot();
      }
    }
    await Promise.all(events.map((event) => this.#markRead(event.id)));
  }

  #saveScroll() {
    const page = this.messagePages.get(this.viewState.threadId);
    if (page && !this.bubble.hidden) page.scrollTop = this.bubble.querySelector('.codex-bubble-scroll').scrollTop;
  }

  #onScroll() {
    const page = this.messagePages.get(this.viewState.threadId);
    if (page) page.scrollTop = this.bubble.querySelector('.codex-bubble-scroll').scrollTop;
    this.#updatePageStatus();
  }

  #page(direction) {
    const scroller = this.bubble.querySelector('.codex-bubble-scroll');
    scroller.scrollBy({ top: direction * Math.max(80, scroller.clientHeight * 0.82), behavior: 'smooth' });
  }

  #updatePageStatus() {
    const scroller = this.bubble.querySelector('.codex-bubble-scroll');
    const pageState = this.messagePages.get(this.viewState.threadId);
    const pages = Math.max(1, Math.ceil(scroller.scrollHeight / Math.max(1, scroller.clientHeight)));
    const page = Math.min(pages, Math.floor(scroller.scrollTop / Math.max(1, scroller.clientHeight)) + 1);
    this.bubble.querySelector('.codex-page-status').textContent = `${page} / ${pages} · ${pageState?.messages?.length || 0}/${pageState?.total || 0}`;
  }

  async #openInProvider() {
    const task = this.#currentTask();
    const provider = task?.provider || this.viewState.event?.provider || 'codex';
    const sourceId = task?.sourceId || this.viewState.event?.sourceThreadId || this.viewState.threadId.replace(/^[^:]+:/, '');
    try { await this.#api(provider).openApp(sourceId, task?.title || this.viewState.event?.title); }
    catch (error) { this.#showBubbleError(error?.message || String(error)); }
  }

  #fillConfig() {
    const provider = this.activeProvider === 'claude' ? 'claude' : 'codex';
    const providerMeta = PROVIDERS[provider];
    const config = this.configs[provider] || {};
    this.config = config;
    this.configPanel.dataset.provider = provider;
    this.configPanel.querySelector('.codex-config-title').textContent = this.locale === 'en-US'
      ? `${providerMeta.name} integration`
      : `${providerMeta.name} 接入设置`;
    this.configPanel.querySelector('.codex-config-intro').textContent = provider === 'claude'
      ? (this.locale === 'en-US' ? 'Read local Claude Code sessions and let the pet follow task activity.' : '读取本机 Claude Code 会话，并允许宠物跟随任务状态。')
      : this.t('configIntro');
    this.configPanel.querySelector('.codex-control-label').textContent = provider === 'claude'
      ? (this.locale === 'en-US' ? 'Bubble reply' : '气泡回复') : this.t('control');
    this.configPanel.querySelector('.codex-control-setting-label').textContent = provider === 'claude'
      ? (this.locale === 'en-US' ? 'Allow bubble replies' : '允许气泡回复') : this.t('allowControl');
    this.configPanel.querySelector('.codex-control-setting-note').textContent = provider === 'claude'
      ? (this.locale === 'en-US' ? 'Send through the local Claude Code CLI or an open Claude Code client.' : '通过本机 Claude Code CLI，或通过已打开的 Claude Code 客户端发送消息。')
      : this.t('allowControlNote');
    this.configPanel.querySelector('.codex-config-note').textContent = provider === 'claude'
      ? (this.locale === 'en-US' ? 'Session data is read only from the local .claude folder; no additional API key is needed.' : '会话数据只从本机 .claude 目录读取，不需要额外 API Key。')
      : this.t('localOnly');
    this.configPanel.querySelector('.agent-link-provider').textContent = provider === 'claude' ? 'CLAUDE' : 'CODEX';
    this.configPanel.querySelectorAll('.agent-provider-cards button').forEach((button) => {
      const active = button.dataset.provider === provider;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    this.configPanel.querySelector('.codex-managed').checked = config.managedReplies !== false;
    const sharedConfig = this.configs.codex || {};
    const newMessageView = sharedConfig.newMessageView === CODEX_NEW_MESSAGE_VIEW.TASK_ACTIVITY
      ? CODEX_NEW_MESSAGE_VIEW.TASK_ACTIVITY : CODEX_NEW_MESSAGE_VIEW.CONVERSATION;
    const newMessageChoice = this.configPanel.querySelector(`.codex-new-message-view input[value="${newMessageView}"]`);
    if (newMessageChoice) newMessageChoice.checked = true;
    this.configPanel.querySelector('.codex-new-message-view-note').textContent = this.t(
      newMessageView === CODEX_NEW_MESSAGE_VIEW.TASK_ACTIVITY ? 'newMessageTasksNote' : 'newMessageConversationNote',
    );
    const replyTransport = config.replyTransport === 'desktop' ? 'desktop' : 'direct';
    this.configPanel.querySelector('.codex-reply-transport').value = replyTransport;
    this.#renderClientCdpSetup(provider);
    this.configPanel.querySelector('.codex-reply-transport option[value="desktop"]').textContent = provider === 'claude'
      ? (this.locale === 'en-US' ? 'Claude Code client compatible' : 'Claude Code 客户端兼容') : this.t('replyDesktop');
    this.configPanel.querySelector('.codex-reply-transport-note').textContent = provider === 'claude'
      ? (this.locale === 'en-US'
          ? (replyTransport === 'desktop' ? 'Open the connected IDE first, then fall back to the matching terminal session.' : 'Monitor resumes this session through the local Claude Code CLI.')
          : (replyTransport === 'desktop' ? '优先唤起已连接的 IDE；没有 IDE 时恢复对应 Claude Code 终端会话。' : 'Monitor 通过本机 Claude Code CLI 续接此会话。'))
      : this.t(replyTransport === 'desktop' ? 'replyDesktopNote' : 'replyDirectNote');
    const sendShortcut = config.sendShortcut === 'ctrl-enter' ? 'ctrl-enter' : 'enter';
    this.configPanel.querySelector('.agent-send-shortcut').value = sendShortcut;
    this.configPanel.querySelector('.agent-send-shortcut-label').textContent = this.locale === 'en-US' ? 'Send shortcut' : '发送快捷键';
    this.configPanel.querySelector('.agent-send-shortcut-note').textContent = this.locale === 'en-US'
      ? (sendShortcut === 'enter' ? 'Enter sends; Shift+Enter inserts a new line.' : 'Ctrl+Enter sends; Enter inserts a new line.')
      : (sendShortcut === 'enter' ? 'Enter 发送；Shift+Enter 换行。' : 'Ctrl+Enter 发送；Enter 换行。');
    const bypassPermissions = config.bypassPermissions === true;
    const bypassInput = this.configPanel.querySelector('.agent-bypass-permissions');
    const bypassRow = this.configPanel.querySelector('.agent-bypass-row');
    const bypassWarning = this.configPanel.querySelector('.agent-bypass-warning');
    bypassInput.checked = bypassPermissions;
    bypassInput.disabled = replyTransport === 'desktop';
    bypassRow.classList.toggle('active', bypassPermissions && replyTransport === 'direct');
    this.configPanel.querySelector('.agent-bypass-label').textContent = this.locale === 'en-US'
      ? 'Bypass tool approvals' : '跳过工具审批（Bypass）';
    this.configPanel.querySelector('.agent-bypass-note').textContent = this.locale === 'en-US'
      ? (replyTransport === 'desktop'
          ? 'Client-compatible mode follows the original client settings.'
          : 'Direct turns run without approval prompts or sandbox restrictions.')
      : (replyTransport === 'desktop'
          ? '客户端兼容模式沿用原客户端权限设置。'
          : '开启后，Monitor 直连回合不再询问工具权限或应用沙箱限制。');
    bypassWarning.hidden = !bypassPermissions || replyTransport !== 'direct';
    bypassWarning.textContent = this.locale === 'en-US'
      ? `Bypass is active for ${providerMeta.name} direct replies. Tools can run immediately.`
      : `${providerMeta.name} 直连 Bypass 已开启，工具可能立即执行。`;
    this.configPanel.dataset.mode = config.homeMode || 'auto';
    this.configPanel.dataset.manualHome = config.manualHome || '';
    this.#setPendingMode(config.homeMode || 'auto');
    this.#renderConfigStatus();
    this.#renderConnectionList();
  }

  #setPendingMode(mode) {
    this.configPanel.dataset.mode = mode === 'manual' ? 'manual' : 'auto';
    const manual = this.configPanel.dataset.mode === 'manual';
    this.configPanel.querySelector('.codex-path-value').textContent = manual
      ? (this.configPanel.dataset.manualHome || this.t('noPath'))
      : this.activeProvider === 'claude' ? '自动检测 ~/.claude' : this.t('autoPath');
    this.configPanel.querySelector('.codex-use-auto').hidden = !manual;
  }

  async #selectHome() {
    const selected = await this.#api(this.activeProvider).selectHome();
    if (!selected) return;
    this.configPanel.dataset.manualHome = selected;
    this.#setPendingMode('manual');
    await this.#commitConfig({ enabled: true });
  }

  async #commitConfig({ enabled = this.config?.enabled === true, replyTransport } = {}) {
    this.#setConfigBusy(true);
    this.configPanel.querySelector('.codex-config-error').textContent = '';
    try {
      const selectedNewMessageView = this.configPanel.querySelector('.codex-new-message-view input:checked')?.value
        || CODEX_NEW_MESSAGE_VIEW.CONVERSATION;
      if (this.configs.codex?.newMessageView !== selectedNewMessageView) {
        const currentCodexConfig = await this.#api('codex').getConfig();
        this.configs.codex = await window.electronAPI.codex.saveConfig({
          ...currentCodexConfig,
          newMessageView: selectedNewMessageView,
        });
      }
      const provider = this.activeProvider;
      const currentProviderConfig = await this.#api(provider).getConfig();
      this.config = await this.#api(provider).saveConfig({
        ...currentProviderConfig,
        enabled,
        managedReplies: this.configPanel.querySelector('.codex-managed').checked,
        replyTransport: replyTransport || this.configPanel.querySelector('.codex-reply-transport').value,
        sendShortcut: this.configPanel.querySelector('.agent-send-shortcut').value,
        bypassPermissions: this.configPanel.querySelector('.agent-bypass-permissions').checked,
        homeMode: this.configPanel.dataset.mode,
        manualHome: this.configPanel.dataset.manualHome || '',
      });
      this.configs[provider] = this.config;
      this.snapshots[provider] = await this.#api(provider).refresh();
      this.#updateCombinedSnapshot();
      this.#fillConfig();
      return true;
    } catch (error) {
      this.configPanel.querySelector('.codex-config-error').textContent = error?.message || String(error);
      return false;
    }
    finally { this.#setConfigBusy(false); }
  }

  #renderConfigStatus() {
    if (!this.configPanel) return;
    for (const provider of Object.keys(PROVIDERS)) {
      const providerSnapshot = this.snapshots[provider] || {};
      const providerConfig = this.configs[provider] || {};
      const providerConnected = providerSnapshot.connected === true;
      const providerState = providerConnected ? 'connected' : providerConfig.enabled ? 'attention' : 'ready';
      const activityCount = Array.isArray(providerSnapshot.visibleTasks)
        ? providerSnapshot.visibleTasks.length : providerSnapshot.tasks?.length || 0;
      const card = this.configPanel.querySelector(`.agent-provider-cards button[data-provider="${provider}"]`);
      const status = card?.querySelector(`.agent-provider-${provider}-status`);
      if (card) card.dataset.state = providerState;
      if (status) status.textContent = providerConnected
        ? `${activityCount} 个动态 · ${providerSnapshot.unreadCount || 0} 条新消息`
        : providerConfig.enabled ? (providerSnapshot.reason || '正在连接') : '尚未启用';
    }
    const provider = this.activeProvider === 'claude' ? 'claude' : 'codex';
    const snapshot = this.snapshots[provider] || {};
    const config = this.configs[provider] || {};
    const strong = this.configPanel.querySelector('.codex-config-status strong');
    const small = this.configPanel.querySelector('.codex-config-status small');
    const light = this.configPanel.querySelector('.codex-status-light');
    const connected = snapshot.connected === true;
    const enabled = config.enabled === true;
    const state = connected ? 'connected' : enabled ? 'attention' : 'ready';
    this.configPanel.querySelector('.codex-config-status').dataset.state = state;
    light.dataset.state = state;
    const connectedLabel = this.locale === 'en-US' ? 'Messages synced' : '消息已同步';
    strong.textContent = `${PROVIDERS[provider].name} · ${connected ? connectedLabel : enabled ? this.t('attention') : this.t('readyConnect')}`;
    const active = snapshot.tasks?.filter((task) => task.activity === CODEX_ACTIVITY.RUNNING).length || 0;
    const connectionSummary = connected
      ? `${snapshot.homeLabel || PROVIDERS[provider].name} · ${active} ${this.t('statusRunning')} · ${snapshot.unreadCount || 0} ${this.t('statusReady')}`
      : enabled ? (snapshot.reason || this.t('controlWaiting')) : this.t('disabled');
    const hookNote = provider === 'codex'
      ? snapshot.hookStatus === 'error'
        ? `${this.t('hookInstallFailed')}: ${snapshot.hookError || ''}`
        : snapshot.hookStatus === 'installed' ? this.t('hookReview') : ''
      : '';
    small.textContent = [connectionSummary, hookNote].filter(Boolean).join(' · ');
    this.configPanel.querySelector('.codex-sync-state').textContent = snapshot.hookStatus === 'error'
      ? this.t('hookInstallFailed')
      : connected ? this.t('messagesNormal') : enabled ? this.t('connConnecting') : this.t('disabled');
    this.configPanel.querySelector('.codex-reply-state').textContent = !config.managedReplies
      ? this.t('disabled')
      : config.replyTransport === 'desktop'
        ? (provider === 'claude'
            ? (this.locale === 'en-US' ? 'Claude Code client compatible' : 'Claude Code 客户端兼容')
            : this.t('replyDesktop'))
        : snapshot.controlConnected ? this.t('controlReady') : enabled ? this.t('controlWaiting') : this.t('disabled');
    const connectButton = this.configPanel.querySelector('.codex-connect-button');
    connectButton.hidden = connected;
    connectButton.textContent = this.locale === 'en-US'
      ? `Enable ${PROVIDERS[provider].name}`
      : `启用 ${PROVIDERS[provider].name} 接入`;
    this.configPanel.querySelector('.codex-disconnect-button').hidden = !enabled;
  }

  #renderClientCdpSetup(provider = this.activeProvider) {
    const section = this.configPanel.querySelector('.codex-client-cdp');
    const button = section.querySelector('.codex-client-cdp-button');
    section.hidden = provider !== 'codex';
    button.disabled = this.cdpSetupBusy;
    this.configPanel.querySelectorAll('.agent-provider-cards button').forEach((providerButton) => {
      providerButton.disabled = this.cdpSetupBusy;
    });
    button.textContent = this.cdpSetupBusy ? this.t('cdpSetupStarting') : this.t('cdpSetupButton');
    const status = section.querySelector('.codex-client-cdp-status');
    status.textContent = this.cdpSetupStatus;
    status.dataset.state = this.cdpSetupStatusType;
  }

  async #enableCodexClientCdp() {
    if (this.cdpSetupBusy) return;
    this.cdpSetupBusy = true;
    this.cdpSetupStatus = this.t('cdpSetupStarting');
    this.cdpSetupStatusType = 'pending';
    this.#renderClientCdpSetup();
    try {
      const result = await window.electronAPI.codex.enableClientCdp();
      if (result?.cancelled) {
        this.cdpSetupStatus = this.t('cdpSetupCancelled');
        this.cdpSetupStatusType = 'idle';
      } else if (result?.success) {
        const transportReady = this.config?.replyTransport === 'desktop'
          || await this.#commitConfig({
            enabled: this.config?.enabled === true,
            replyTransport: 'desktop',
          });
        this.cdpSetupStatus = transportReady
          ? `${this.t('cdpSetupReady')} · ${result.debugAddress}`
          : `${this.t('cdpSetupReady')} · ${result.debugAddress} ${this.t('cdpSetupTransportFailed')}`;
        this.cdpSetupStatusType = transportReady ? 'success' : 'error';
      } else {
        throw new Error('Codex helper returned no readiness result.');
      }
    } catch (error) {
      this.cdpSetupStatus = `${this.t('cdpSetupFailed')}: ${error?.message || String(error)}`;
      this.cdpSetupStatusType = 'error';
    } finally {
      this.cdpSetupBusy = false;
      this.#renderClientCdpSetup();
    }
  }

  #renderConnectionList() {
    if (!this.configPanel || !this.configOpen) return;
    const provider = this.activeProvider === 'claude' ? 'claude' : 'codex';
    const providerName = PROVIDERS[provider].name;
    const snapshot = this.snapshots[provider] || {};
    const config = this.configs[provider] || {};
    const host = this.configPanel.querySelector('.codex-connection-list');
    host.replaceChildren();
    for (const sourceTask of (snapshot.tasks || [])) {
      const task = providerTask(provider, sourceTask);
      const row = element('div', 'codex-connection-row');
      row.dataset.state = task.connectionState || CODEX_CONNECTION.DISCONNECTED;
      const openButton = element('button', 'codex-connection-open');
      openButton.type = 'button';
      openButton.setAttribute('aria-label', `${this.t('openConversation')}: ${task.title || providerName}`);
      const copy = element('div', 'codex-connection-copy');
      copy.append(element('strong', '', task.title || providerName));
      const desktopCompatible = config.replyTransport === 'desktop';
      const status = desktopCompatible
        ? (provider === 'claude'
            ? (this.locale === 'en-US' ? 'Unified through Claude Code client' : '由 Claude Code 客户端统一')
            : this.t('clientUnified'))
        : task.connectionError || this.#connectionLabel(task.connectionState, provider);
      copy.append(element('small', '', `${task.project || providerName} · ${status}`));
      openButton.appendChild(copy);
      openButton.addEventListener('click', () => {
        this.closeConfig();
        this.#openTask(task);
      });
      const action = codexConnectionAction(task.connectionState);
      const connected = action === 'disconnect';
      const button = element(
        'button',
        desktopCompatible || connected ? 'codex-quiet-button' : 'codex-save-button',
        desktopCompatible ? `打开 ${providerName}` : action === 'retry' ? this.t('retry') : connected ? this.t('disconnect') : this.t('connect'),
      );
      button.type = 'button';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          if (desktopCompatible) {
            await this.#api(provider).openApp(task.sourceId, task.title);
            return;
          }
          const providerApi = this.#api(provider);
          const nextSnapshot = action === 'disconnect'
            ? await providerApi[provider === 'claude' ? 'disconnectSession' : 'disconnectThread'](task.sourceId)
            : await providerApi[provider === 'claude' ? 'connectSession' : 'connectThread'](task.sourceId);
          this.configs[provider] = await providerApi.getConfig();
          this.config = this.configs[provider];
          this.snapshots[provider] = nextSnapshot;
          this.#updateCombinedSnapshot();
        } catch (error) { this.configPanel.querySelector('.codex-config-error').textContent = error?.message || String(error); }
        finally { button.disabled = false; }
      });
      row.append(openButton, button);
      host.appendChild(row);
    }
    const section = this.configPanel.querySelector('.codex-thread-connections');
    section.hidden = !shouldShowCodexConnectionList(config.replyTransport, host.childElementCount);
  }

  #setBubbleBusy(busy) {
    this.bubble.classList.toggle('busy', busy);
    this.bubble.querySelectorAll('button, textarea, select, input').forEach((node) => { node.disabled = busy; });
  }
  #setConfigBusy(busy) {
    this.configPanel.classList.toggle('busy', busy);
    this.configPanel.querySelectorAll('button, input, select').forEach((node) => {
      const setupLocked = this.cdpSetupBusy && (
        node.classList.contains('codex-client-cdp-button')
        || node.closest('.agent-provider-cards')
      );
      node.disabled = busy || Boolean(setupLocked);
    });
  }
  #showBubbleError(message) {
    this.inlineError = String(message || '');
    this.bubble.querySelector('.codex-inline-error').textContent = this.inlineError;
  }
}
