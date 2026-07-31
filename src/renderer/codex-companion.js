import {
  CODEX_ACTIVITY,
  CODEX_CONNECTION,
  codexMoodForActivity,
  normalizeCodexLocale,
} from '../shared/codex-integration.js';
import {
  closeCodexTask,
  createCodexViewState,
  openCodexTask,
  reconcileCodexViewState,
} from './codex-view-state.js';

function element(tag, className, text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

const TEXT = {
  'zh-CN': {
    liveTasks: '任务动态', emptyTasks: '目前没有运行中、未读或已连接的任务', close: '关闭', back: '返回任务列表',
    openCodex: '打开 Codex', previousPage: '上一页', nextPage: '下一页', send: '发送', replyPlaceholder: '直接回复这个任务…',
    configTitle: '连接 Codex', configIntro: '同步全部任务；只有建立可操作连接的任务才能在气泡中直接回复和批准。',
    sync: '消息同步', control: '气泡回复与批准', enable: '启用 Codex 接入', disable: '断开同步', reconnect: '重新检测',
    dataLocation: '对话数据位置', selectHome: '选择其他目录', restoreAuto: '恢复自动检测', advanced: '高级设置',
    allowControl: '允许气泡回复与批准', allowControlNote: '连接已有任务时会等待它空闲，避免与 Codex 同时操作。',
    localOnly: '数据只在本机读取，不需要 API Key。未连接的任务仍会提醒，并可准确跳转到 Codex。',
    autoPath: '当前用户的 .codex（自动检测）', noPath: '尚未选择目录', connect: '连接', disconnect: '断开', retry: '重试',
    noMessages: '暂时还没有可显示的回复。', loadOlder: '加载更早消息', you: '你', codex: 'Codex',
    submitAnswers: '提交回答', choose: '请选择', custom: '自己输入…', inputAnswer: '输入回答', answerAll: '请完成所有问题后再提交',
    accept: '本次允许', acceptForSession: '本次会话允许', decline: '拒绝', cancel: '拒绝并停止',
    goHandle: '前往 Codex 处理', sent: '消息已发送，正在等待 Codex 回复。', handled: '操作已提交，等待 Codex 继续。',
    statusRunning: '运行中', statusNeedsInput: '等待你', statusReady: '新回复', statusBlocked: '遇到问题', statusDisconnected: '未连接', statusSilent: '已同步',
    connDisconnected: '未连接', connWaitingIdle: '等待任务空闲', connConnecting: '正在连接', connConnected: '已连接',
    connReadOnly: 'Codex 正在运行，暂时只读', connError: '连接出错', childRunning: '个子任务运行中',
    connected: 'Codex 消息已同步', attention: '接入需要处理', readyConnect: '已准备好连接', controlReady: '控制通道已就绪',
    controlWaiting: '消息正常；控制通道后台连接中', disabled: '尚未启用', messagesNormal: '同步正常', tasksLabel: '任务连接',
  },
  'en-US': {
    liveTasks: 'Task activity', emptyTasks: 'No running, unread, or connected tasks', close: 'Close', back: 'Back to tasks',
    openCodex: 'Open Codex', previousPage: 'Previous', nextPage: 'Next', send: 'Send', replyPlaceholder: 'Reply to this task…',
    configTitle: 'Connect Codex', configIntro: 'Sync every task. Inline reply and approval are available after a control connection is established.',
    sync: 'Message sync', control: 'Bubble reply and approval', enable: 'Enable Codex integration', disable: 'Stop syncing', reconnect: 'Check again',
    dataLocation: 'Conversation data location', selectHome: 'Choose another folder', restoreAuto: 'Use automatic detection', advanced: 'Advanced settings',
    allowControl: 'Allow bubble replies and approvals', allowControlNote: 'Existing tasks wait until idle before connecting, preventing simultaneous control.',
    localOnly: 'Data stays on this computer and needs no API key. Unconnected tasks can still notify and open in Codex.',
    autoPath: 'Current user .codex (automatic)', noPath: 'No folder selected', connect: 'Connect', disconnect: 'Disconnect', retry: 'Retry',
    noMessages: 'No visible response yet.', loadOlder: 'Load earlier messages', you: 'You', codex: 'Codex',
    submitAnswers: 'Submit answers', choose: 'Choose', custom: 'Enter another answer…', inputAnswer: 'Enter answer', answerAll: 'Answer every question before submitting',
    accept: 'Allow once', acceptForSession: 'Allow for session', decline: 'Decline', cancel: 'Decline and stop',
    goHandle: 'Handle in Codex', sent: 'Message sent. Waiting for Codex.', handled: 'Action submitted. Waiting for Codex to continue.',
    statusRunning: 'Running', statusNeedsInput: 'Needs you', statusReady: 'New reply', statusBlocked: 'Problem', statusDisconnected: 'Disconnected', statusSilent: 'Synced',
    connDisconnected: 'Not connected', connWaitingIdle: 'Waiting until idle', connConnecting: 'Connecting', connConnected: 'Connected',
    connReadOnly: 'Codex is running; temporarily read-only', connError: 'Connection error', childRunning: 'child tasks running',
    connected: 'Codex messages are synced', attention: 'Integration needs attention', readyConnect: 'Ready to connect', controlReady: 'Control channel ready',
    controlWaiting: 'Messages are synced; control is connecting in the background', disabled: 'Not enabled', messagesNormal: 'Sync is healthy', tasksLabel: 'Task connections',
  },
};

export class CodexCompanion {
  constructor({ onInteractionChange, onConfigClosed, onMoodChange } = {}) {
    this.onInteractionChange = onInteractionChange;
    this.onConfigClosed = onConfigClosed;
    this.onMoodChange = onMoodChange;
    this.config = null;
    this.snapshot = null;
    this.viewState = createCodexViewState();
    this.trayOpen = false;
    this.configOpen = false;
    this.bubblesSuppressed = false;
    this.anchor = { x: window.innerWidth / 2, y: 180 };
    this.alertFreshUntil = 0;
    this.lastMood = 'idle';
    this.unsubscribe = null;
    this.readInFlight = new Set();
    this.notifiedInFlight = new Set();
    this.drafts = new Map();
    this.messagePages = new Map();
    this.positionKeys = new Map();
    this.sizes = new Map();
    this.locale = normalizeCodexLocale(navigator.language);
    this.#build();
  }

  t(key) { return TEXT[this.locale]?.[key] || TEXT['zh-CN'][key] || key; }

  async initialize() {
    this.config = await window.electronAPI.codex.getConfig();
    this.snapshot = await window.electronAPI.codex.getStatus();
    this.unsubscribe = window.electronAPI.codex.onStatus((snapshot) => this.update(snapshot));
    this.update(this.snapshot);
  }

  destroy() {
    this.unsubscribe?.();
    this.resizeObserver?.disconnect();
    this.root.remove();
  }

  #build() {
    this.root = element('div', 'codex-companion-root');
    this.root.setAttribute('aria-live', 'polite');

    this.badge = element('button', 'codex-pet-signal');
    this.badge.type = 'button';
    this.badge.hidden = true;
    this.root.appendChild(this.badge);

    this.taskTray = element('section', 'codex-task-tray');
    this.taskTray.hidden = true;
    this.taskTray.innerHTML = `
      <header class="codex-tray-head">
        <div><div class="codex-config-kicker">LIVE TASKS</div><strong class="codex-live-title"></strong></div>
        <button class="codex-icon-button codex-tray-close" type="button">×</button>
      </header>
      <div class="codex-task-list"></div>
      <div class="codex-task-empty"></div>`;
    this.root.appendChild(this.taskTray);

    this.bubble = element('section', 'codex-message-bubble');
    this.bubble.hidden = true;
    this.bubble.innerHTML = `
      <header class="codex-bubble-head">
        <div class="codex-bubble-signal"></div>
        <button class="codex-icon-button codex-task-back" type="button">←</button>
        <div class="codex-bubble-heading"><div class="codex-bubble-project"></div><div class="codex-bubble-title"></div></div>
        <div class="codex-bubble-state"></div>
        <button class="codex-icon-button codex-bubble-close" type="button">×</button>
      </header>
      <button class="codex-load-older" type="button" hidden></button>
      <div class="codex-bubble-scroll" tabindex="0"><div class="codex-message-list"></div><div class="codex-bubble-empty"></div></div>
      <div class="codex-bubble-notice"></div>
      <div class="codex-bubble-questions"></div>
      <div class="codex-bubble-compose"><textarea rows="2" maxlength="12000"></textarea><button class="codex-send-button" type="button"></button></div>
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
        <div><div class="codex-config-kicker">PET LINK / CODEX</div><h2 class="codex-config-title"></h2></div>
        <button class="codex-icon-button codex-config-close" type="button">×</button>
      </header>
      <p class="codex-config-intro"></p>
      <div class="codex-link-rail" aria-hidden="true"><span>PET</span><i></i><span>CODEX</span></div>
      <div class="codex-config-status" data-state="checking"><span class="codex-status-light"></span><div><strong></strong><small></small></div></div>
      <div class="codex-capability-grid">
        <div><span class="codex-sync-label"></span><strong class="codex-sync-state"></strong></div>
        <div><span class="codex-control-label"></span><strong class="codex-reply-state"></strong></div>
      </div>
      <div class="codex-connect-actions"><button class="codex-save-button codex-connect-button" type="button"></button><button class="codex-quiet-button codex-disconnect-button" type="button" hidden></button></div>
      <section class="codex-thread-connections"><div class="codex-section-label codex-task-connection-label"></div><div class="codex-connection-list"></div></section>
      <div class="codex-location-card">
        <div class="codex-section-label codex-data-location-label"></div><div class="codex-path-value"></div>
        <div class="codex-location-actions"><button class="codex-select-home" type="button"></button><button class="codex-quiet-button codex-use-auto" type="button" hidden></button></div>
      </div>
      <details class="codex-advanced"><summary></summary>
        <label class="codex-switch-row"><span><strong class="codex-control-setting-label"></strong><small class="codex-control-setting-note"></small></span><input class="codex-managed" type="checkbox"><i></i></label>
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

    this.badge.addEventListener('click', () => this.toggleTaskTray());
    this.taskTray.querySelector('.codex-tray-close').addEventListener('click', () => this.closeTaskTray());
    this.bubble.querySelector('.codex-task-back').addEventListener('click', async () => {
      await this.#closeDetail(true);
      this.trayOpen = true;
      this.#renderTaskTray();
    });
    this.bubble.querySelector('.codex-bubble-close').addEventListener('click', () => this.#closeDetail(true));
    this.bubble.querySelector('.codex-open-app').addEventListener('click', () => this.#openInCodex());
    this.bubble.querySelector('.codex-page-up').addEventListener('click', () => this.#page(-1));
    this.bubble.querySelector('.codex-page-down').addEventListener('click', () => this.#page(1));
    this.bubble.querySelector('.codex-load-older').addEventListener('click', () => this.#loadMessages(true));
    this.bubble.querySelector('.codex-send-button').addEventListener('click', () => this.#sendText());
    this.bubble.querySelector('textarea').addEventListener('input', (event) => {
      if (this.viewState.threadId) this.drafts.set(this.viewState.threadId, event.target.value);
    });
    this.bubble.querySelector('textarea').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.#sendText();
      }
    });
    this.bubble.querySelector('.codex-bubble-scroll').addEventListener('scroll', () => this.#onScroll());

    this.configPanel.querySelector('.codex-config-close').addEventListener('click', () => this.closeConfig());
    this.configPanel.querySelector('.codex-select-home').addEventListener('click', () => this.#selectHome());
    this.configPanel.querySelector('.codex-use-auto').addEventListener('click', async () => {
      this.#setPendingMode('auto');
      await this.#commitConfig({ enabled: true });
    });
    this.configPanel.querySelector('.codex-connect-button').addEventListener('click', () => this.#commitConfig({ enabled: true }));
    this.configPanel.querySelector('.codex-disconnect-button').addEventListener('click', () => this.#commitConfig({ enabled: false }));
    this.configPanel.querySelector('.codex-managed').addEventListener('change', () => this.#commitConfig({ enabled: this.config?.enabled === true }));
    this.configPanel.querySelector('.codex-advanced').addEventListener('toggle', () => this.updatePosition(true));
    this.configPanel.querySelector('.codex-config-refresh').addEventListener('click', async () => {
      this.#setConfigBusy(true);
      try { this.update(await window.electronAPI.codex.refresh()); }
      finally { this.#setConfigBusy(false); }
    });
    this.#localizeStatic();
  }

  #localizeStatic() {
    this.badge.setAttribute('aria-label', this.t('liveTasks'));
    this.taskTray.querySelector('.codex-live-title').textContent = this.t('liveTasks');
    this.taskTray.querySelector('.codex-task-empty').textContent = this.t('emptyTasks');
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
    this.configPanel.querySelector('.codex-config-note').textContent = this.t('localOnly');
    this.configPanel.querySelector('.codex-config-refresh').textContent = this.t('reconnect');
    this.configPanel.querySelector('.codex-disconnect-button').textContent = this.t('disable');
  }

  update(snapshot) {
    if (!snapshot) return;
    this.snapshot = snapshot;
    const nextLocale = normalizeCodexLocale(snapshot.locale, navigator.language);
    if (nextLocale !== this.locale) {
      this.locale = nextLocale;
      this.#localizeStatic();
    }
    const previousEventId = this.viewState.eventId;
    this.viewState = reconcileCodexViewState(this.viewState, snapshot, {
      allowNotification: !this.configOpen && !this.bubblesSuppressed,
    });
    if (this.viewState.mode === 'notification' && this.viewState.eventId
      && this.viewState.eventId !== previousEventId) {
      this.alertFreshUntil = Date.now() + 6000;
      this.#markNotified(this.viewState.eventId);
    }
    this.#renderBadge();
    this.#renderTaskTray();
    this.#renderConfigStatus();
    this.#renderConnectionList();
    if (this.viewState.mode !== 'closed') this.#renderBubble();
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
    this.viewState = reconcileCodexViewState(this.viewState, this.snapshot, { allowNotification: true });
    if (this.viewState.mode === 'notification' && this.viewState.eventId) {
      this.alertFreshUntil = Date.now() + 6000;
      this.#markNotified(this.viewState.eventId);
    }
    if (this.viewState.mode !== 'closed') this.#renderBubble();
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
      this.viewState = reconcileCodexViewState(this.viewState, this.snapshot, { allowNotification: true });
      if (this.viewState.mode === 'notification' && this.viewState.eventId) {
        this.alertFreshUntil = Date.now() + 6000;
        this.#markNotified(this.viewState.eventId);
      }
      if (this.trayOpen) this.#renderTaskTray();
      else if (this.viewState.mode !== 'closed') this.#renderBubble();
    }
    this.#renderBadge();
    this.#emitMood();
    this.onInteractionChange?.();
  }

  updateFrame() { this.#emitMood(); this.updatePosition(); }
  setAnchor(x, y) { this.anchor = { x, y }; this.updatePosition(); }

  #place(node, x, y, force = false) {
    const key = `${Math.round(x)},${Math.round(y)}`;
    if (!force && this.positionKeys.get(node) === key) return;
    this.positionKeys.set(node, key);
    node.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  updatePosition(force = false) {
    const bubbleWidth = 430;
    const configWidth = 448;
    const preferRight = this.anchor.x < window.innerWidth - bubbleWidth - 90;
    const bubbleLeft = preferRight ? this.anchor.x + 54 : this.anchor.x - bubbleWidth - 54;
    const bubbleHeight = this.sizes.get(this.bubble)?.height || 430;
    const configHeight = this.sizes.get(this.configPanel)?.height || 560;
    const trayHeight = this.sizes.get(this.taskTray)?.height || 300;
    this.bubble.dataset.side = preferRight ? 'right' : 'left';
    this.#place(this.bubble, clamp(bubbleLeft, 12, window.innerWidth - bubbleWidth - 12), clamp(this.anchor.y - 92, 62, window.innerHeight - bubbleHeight - 12), force);
    this.#place(this.configPanel, clamp(this.anchor.x - configWidth / 2, 12, window.innerWidth - configWidth - 12), clamp(this.anchor.y + 58, 62, window.innerHeight - configHeight - 12), force);
    this.#place(this.badge, this.anchor.x + 29, this.anchor.y - 42, force);
    this.taskTray.dataset.side = preferRight ? 'right' : 'left';
    this.#place(this.taskTray, clamp(bubbleLeft, 12, window.innerWidth - 360 - 12), clamp(this.anchor.y - 70, 62, window.innerHeight - trayHeight - 12), force);
  }

  containsPoint(x, y) {
    return [this.configPanel, this.bubble, this.taskTray, this.badge].some((node) => {
      if (node.hidden) return false;
      const bounds = node.getBoundingClientRect();
      return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    });
  }

  ownsEvent(event) {
    return Boolean(event?.composedPath?.().includes(this.root)
      || (event?.target instanceof Node && this.root.contains(event.target)));
  }

  get capturesOutsideClicks() { return this.configOpen || this.trayOpen; }
  get pausesPetMotion() {
    return this.configOpen
      || this.trayOpen
      || (!this.bubble.hidden
        && (this.bubble.matches(':hover') || this.bubble.contains(document.activeElement)));
  }
  get activity() { return this.config?.enabled === true ? (this.snapshot?.activity || CODEX_ACTIVITY.SILENT) : CODEX_ACTIVITY.SILENT; }
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

  #connectionLabel(state) {
    return ({
      [CODEX_CONNECTION.WAITING_IDLE]: this.t('connWaitingIdle'),
      [CODEX_CONNECTION.CONNECTING]: this.t('connConnecting'),
      [CODEX_CONNECTION.CONNECTED]: this.t('connConnected'),
      [CODEX_CONNECTION.TEMPORARY_READ_ONLY]: this.t('connReadOnly'),
      [CODEX_CONNECTION.ERROR]: this.t('connError'),
    })[state] || this.t('connDisconnected');
  }

  #renderBadge() {
    const unreadCount = Number(this.snapshot?.unreadTaskCount ?? this.snapshot?.unreadCount ?? 0);
    const runningCount = Number(this.snapshot?.runningCount || 0);
    const count = unreadCount > 0 ? unreadCount : runningCount;
    this.badge.hidden = count <= 0 || this.configOpen || this.bubblesSuppressed;
    if (this.badge.hidden) return;
    this.badge.textContent = count > 9 ? '9+' : String(count);
    this.badge.dataset.mode = unreadCount > 0 ? 'unread' : 'running';
    this.badge.dataset.activity = unreadCount > 0 ? (this.snapshot?.activity || CODEX_ACTIVITY.READY) : CODEX_ACTIVITY.RUNNING;
    this.badge.setAttribute('aria-label', `${count} · ${unreadCount > 0 ? this.t('statusReady') : this.t('statusRunning')}`);
  }

  toggleTaskTray() {
    if (this.configOpen || this.bubblesSuppressed) return;
    this.trayOpen = !this.trayOpen;
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
    const tasks = this.snapshot?.visibleTasks || [];
    host.replaceChildren();
    for (const task of tasks) {
      const button = element('button', 'codex-task-item');
      button.type = 'button';
      button.dataset.activity = task.activity || CODEX_ACTIVITY.SILENT;
      button.innerHTML = '<span class="codex-task-state" aria-hidden="true"></span><span class="codex-task-copy"><strong></strong><small></small></span><span class="codex-task-count"></span>';
      button.querySelector('strong').textContent = task.title || 'Codex';
      const children = task.runningChildren > 0 ? ` · ${task.runningChildren} ${this.t('childRunning')}` : '';
      button.querySelector('small').textContent = `${task.project || 'Codex'} · ${this.#statusLabel(task.activity)}${children}`;
      const count = button.querySelector('.codex-task-count');
      count.textContent = task.unreadCount > 0 ? String(task.unreadCount) : (task.activity === CODEX_ACTIVITY.RUNNING ? 'RUN' : 'LINK');
      count.dataset.mode = task.unreadCount > 0 ? 'unread' : 'running';
      button.addEventListener('click', () => this.#openTask(task));
      host.appendChild(button);
    }
    this.taskTray.querySelector('.codex-task-empty').hidden = tasks.length > 0;
  }

  #openTask(task) {
    this.#saveScroll();
    this.viewState = openCodexTask(this.viewState, task);
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
    this.bubble.dataset.activity = event.activity || task?.activity || CODEX_ACTIVITY.SILENT;
    this.bubble.querySelector('.codex-bubble-project').textContent = event.project || task?.project || 'Codex';
    this.bubble.querySelector('.codex-bubble-title').textContent = event.title || task?.title || 'Codex';
    this.bubble.querySelector('.codex-bubble-state').textContent = this.#statusLabel(event.activity || task?.activity);
    this.bubble.querySelector('.codex-inline-error').textContent = '';
    const textarea = this.bubble.querySelector('textarea');
    if (document.activeElement !== textarea) textarea.value = this.drafts.get(this.viewState.threadId) || '';

    const compose = this.bubble.querySelector('.codex-bubble-compose');
    const questions = this.bubble.querySelector('.codex-bubble-questions');
    const actions = this.bubble.querySelector('.codex-bubble-actions');
    const notice = this.bubble.querySelector('.codex-bubble-notice');
    questions.replaceChildren();
    actions.replaceChildren();
    compose.hidden = true;
    notice.textContent = '';

    if (event.kind === 'question' && event.requestId && event.supported !== false) this.#renderQuestions(event, questions);
    else if (event.requestId && event.supported !== false) this.#renderApprovalActions(event, actions);
    else if (event.requestId && event.supported === false) this.#renderOpenCodexAction(actions);
    else if (task?.capabilities?.reply === true || event.canReply === true) compose.hidden = false;
    else if (task?.connectionState && task.connectionState !== CODEX_CONNECTION.CONNECTED) notice.textContent = this.#connectionLabel(task.connectionState);

    const page = this.messagePages.get(this.viewState.threadId);
    if (!page?.loaded) this.#loadMessages(false, true);
    else this.#renderMessages();
    this.updatePosition(true);
    this.onInteractionChange?.();
  }

  async #loadMessages(older = false, force = false) {
    const threadId = this.viewState.threadId;
    if (!threadId) return;
    const current = this.messagePages.get(threadId) || { messages: [], nextCursor: null, total: 0, loaded: false, loading: false, scrollTop: null };
    if (current.loading || (older && current.loaded && current.nextCursor === null)) return;
    if (!force && !older && current.loaded) return;
    current.loading = true;
    this.messagePages.set(threadId, current);
    const scroller = this.bubble.querySelector('.codex-bubble-scroll');
    const previousHeight = scroller.scrollHeight;
    try {
      const result = await window.electronAPI.codex.getMessages(threadId, older ? current.nextCursor : null, 50);
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
      this.#renderMessages();
      requestAnimationFrame(() => {
        if (older) scroller.scrollTop += scroller.scrollHeight - previousHeight;
        else if (current.scrollTop !== null) scroller.scrollTop = current.scrollTop;
        else scroller.scrollTop = scroller.scrollHeight;
        this.#updatePageStatus();
      });
    } catch (error) {
      this.#showBubbleError(error?.message || String(error));
    } finally {
      current.loading = false;
    }
  }

  #renderMessages() {
    const page = this.messagePages.get(this.viewState.threadId);
    const host = this.bubble.querySelector('.codex-message-list');
    const empty = this.bubble.querySelector('.codex-bubble-empty');
    host.replaceChildren();
    for (const message of page?.messages || []) {
      const article = element('article', 'codex-message-item');
      article.dataset.role = message.role;
      article.append(element('div', 'codex-message-role', message.role === 'user' ? this.t('you') : this.t('codex')));
      article.append(element('div', 'codex-message-text', message.message));
      host.appendChild(article);
    }
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
    const button = element('button', 'codex-save-button', this.t('goHandle'));
    button.type = 'button';
    button.addEventListener('click', () => this.#openInCodex());
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
      await window.electronAPI.codex.respond(event.requestId, response);
      await this.#markRead(event.id);
      this.viewState = {
        ...this.viewState,
        event: { ...event, requestId: null, kind: 'task', activity: CODEX_ACTIVITY.RUNNING, message: this.t('handled') },
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
    this.#setBubbleBusy(true);
    try {
      await window.electronAPI.codex.reply(threadId, text);
      textarea.value = '';
      this.drafts.delete(threadId);
      if (this.viewState.eventId) await this.#markRead(this.viewState.eventId);
      this.viewState = {
        ...this.viewState,
        event: { ...this.viewState.event, requestId: null, kind: 'task', activity: CODEX_ACTIVITY.RUNNING, message: this.t('sent') },
      };
      await this.#loadMessages(false, true);
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
    this.readInFlight.add(eventId);
    try { await window.electronAPI.codex.markRead(eventId); }
    finally { this.readInFlight.delete(eventId); }
  }

  async #markNotified(eventId) {
    if (!eventId || this.notifiedInFlight.has(eventId)) return;
    this.notifiedInFlight.add(eventId);
    try { await window.electronAPI.codex.markNotified(eventId); }
    finally { this.notifiedInFlight.delete(eventId); }
  }

  async #markThreadRead(threadId) {
    const events = this.snapshot?.unread?.filter((event) => event.threadId === threadId) || [];
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

  async #openInCodex() {
    try { await window.electronAPI.codex.openApp(this.viewState.threadId, this.viewState.event?.title); }
    catch (error) { this.#showBubbleError(error?.message || String(error)); }
  }

  #fillConfig() {
    const config = this.config || {};
    this.configPanel.querySelector('.codex-managed').checked = config.managedReplies !== false;
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
      ? (this.configPanel.dataset.manualHome || this.t('noPath')) : this.t('autoPath');
    this.configPanel.querySelector('.codex-use-auto').hidden = !manual;
  }

  async #selectHome() {
    const selected = await window.electronAPI.codex.selectHome();
    if (!selected) return;
    this.configPanel.dataset.manualHome = selected;
    this.#setPendingMode('manual');
    await this.#commitConfig({ enabled: true });
  }

  async #commitConfig({ enabled = this.config?.enabled === true } = {}) {
    this.#setConfigBusy(true);
    this.configPanel.querySelector('.codex-config-error').textContent = '';
    try {
      this.config = await window.electronAPI.codex.saveConfig({
        ...this.config,
        enabled,
        managedReplies: this.configPanel.querySelector('.codex-managed').checked,
        homeMode: this.configPanel.dataset.mode,
        manualHome: this.configPanel.dataset.manualHome || '',
      });
      this.update(await window.electronAPI.codex.refresh());
      this.#fillConfig();
    } catch (error) { this.configPanel.querySelector('.codex-config-error').textContent = error?.message || String(error); }
    finally { this.#setConfigBusy(false); }
  }

  #renderConfigStatus() {
    if (!this.configPanel || !this.snapshot) return;
    const strong = this.configPanel.querySelector('.codex-config-status strong');
    const small = this.configPanel.querySelector('.codex-config-status small');
    const light = this.configPanel.querySelector('.codex-status-light');
    const connected = this.snapshot.connected === true;
    const enabled = this.config?.enabled === true;
    const state = connected ? 'connected' : enabled ? 'attention' : 'ready';
    this.configPanel.querySelector('.codex-config-status').dataset.state = state;
    light.dataset.state = state;
    strong.textContent = connected ? this.t('connected') : enabled ? this.t('attention') : this.t('readyConnect');
    const active = this.snapshot.tasks?.filter((task) => task.activity === CODEX_ACTIVITY.RUNNING).length || 0;
    small.textContent = connected
      ? `${this.snapshot.homeLabel} · ${active} ${this.t('statusRunning')} · ${this.snapshot.unreadCount || 0} ${this.t('statusReady')}`
      : enabled ? (this.snapshot.reason || this.t('controlWaiting')) : this.t('disabled');
    this.configPanel.querySelector('.codex-sync-state').textContent = connected ? this.t('messagesNormal') : enabled ? this.t('connConnecting') : this.t('disabled');
    this.configPanel.querySelector('.codex-reply-state').textContent = !this.config?.managedReplies
      ? this.t('disabled') : this.snapshot.controlConnected ? this.t('controlReady') : enabled ? this.t('controlWaiting') : this.t('disabled');
    const connectButton = this.configPanel.querySelector('.codex-connect-button');
    connectButton.hidden = connected;
    connectButton.textContent = this.t('enable');
    this.configPanel.querySelector('.codex-disconnect-button').hidden = !enabled;
  }

  #renderConnectionList() {
    if (!this.configPanel || !this.configOpen) return;
    const host = this.configPanel.querySelector('.codex-connection-list');
    host.replaceChildren();
    for (const task of (this.snapshot?.tasks || [])) {
      const row = element('div', 'codex-connection-row');
      row.dataset.state = task.connectionState || CODEX_CONNECTION.DISCONNECTED;
      const copy = element('div', 'codex-connection-copy');
      copy.append(element('strong', '', task.title || 'Codex'));
      const status = task.connectionError || this.#connectionLabel(task.connectionState);
      copy.append(element('small', '', `${task.project || 'Codex'} · ${status}`));
      const connected = task.connectionState !== CODEX_CONNECTION.DISCONNECTED;
      const button = element('button', connected ? 'codex-quiet-button' : 'codex-save-button', connected ? this.t('disconnect') : this.t('connect'));
      button.type = 'button';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const snapshot = connected
            ? await window.electronAPI.codex.disconnectThread(task.id)
            : await window.electronAPI.codex.connectThread(task.id);
          this.config = await window.electronAPI.codex.getConfig();
          this.update(snapshot);
        } catch (error) { this.configPanel.querySelector('.codex-config-error').textContent = error?.message || String(error); }
        finally { button.disabled = false; }
      });
      row.append(copy, button);
      host.appendChild(row);
    }
    const section = this.configPanel.querySelector('.codex-thread-connections');
    section.hidden = host.childElementCount === 0;
  }

  #setBubbleBusy(busy) {
    this.bubble.classList.toggle('busy', busy);
    this.bubble.querySelectorAll('button, textarea, select, input').forEach((node) => { node.disabled = busy; });
  }
  #setConfigBusy(busy) {
    this.configPanel.classList.toggle('busy', busy);
    this.configPanel.querySelectorAll('button, input').forEach((node) => { node.disabled = busy; });
  }
  #showBubbleError(message) { this.bubble.querySelector('.codex-inline-error').textContent = message; }
}
