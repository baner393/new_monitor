import { CODEX_ACTIVITY, codexMoodForActivity } from '../shared/codex-integration.js';

function element(tag, className, text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function statusLabel(activity) {
  return ({
    [CODEX_ACTIVITY.RUNNING]: '运行中',
    [CODEX_ACTIVITY.NEEDS_INPUT]: '等待你',
    [CODEX_ACTIVITY.READY]: '新回复',
    [CODEX_ACTIVITY.BLOCKED]: '遇到问题',
    [CODEX_ACTIVITY.DISCONNECTED]: '未连接',
  })[activity] || '已连接';
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export class CodexCompanion {
  constructor({ onInteractionChange, onConfigClosed, onMoodChange } = {}) {
    this.onInteractionChange = onInteractionChange;
    this.onConfigClosed = onConfigClosed;
    this.onMoodChange = onMoodChange;
    this.config = null;
    this.snapshot = null;
    this.currentEvent = null;
    this.currentThreadId = '';
    this.currentPinned = false;
    this.trayOpen = false;
    this.configOpen = false;
    this.bubblesSuppressed = false;
    this.anchor = { x: window.innerWidth / 2, y: 180 };
    this.alertFreshUntil = 0;
    this.lastMood = 'idle';
    this.unsubscribe = null;
    this.readInFlight = new Set();
    this.autoCloseTimer = null;
    this.initializedSnapshot = false;
    this.#build();
  }

  async initialize() {
    this.config = await window.electronAPI.codex.getConfig();
    this.snapshot = await window.electronAPI.codex.getStatus();
    this.unsubscribe = window.electronAPI.codex.onStatus((snapshot) => this.update(snapshot));
    this.update(this.snapshot);
  }

  destroy() {
    if (this.autoCloseTimer) clearTimeout(this.autoCloseTimer);
    this.unsubscribe?.();
    this.root.remove();
  }

  #build() {
    this.root = element('div', 'codex-companion-root');
    this.root.setAttribute('aria-live', 'polite');

    this.badge = element('button', 'codex-pet-signal');
    this.badge.type = 'button';
    this.badge.setAttribute('aria-label', '展开 Codex 任务');
    this.badge.hidden = true;
    this.root.appendChild(this.badge);

    this.taskTray = element('section', 'codex-task-tray');
    this.taskTray.hidden = true;
    this.taskTray.innerHTML = `
      <header class="codex-tray-head">
        <div><div class="codex-config-kicker">LIVE TASKS</div><strong>Codex 动态</strong></div>
        <button class="codex-icon-button codex-tray-close" type="button" aria-label="收起任务列表">×</button>
      </header>
      <div class="codex-task-list"></div>
      <div class="codex-task-empty">目前没有运行中或未读任务</div>
    `;
    this.root.appendChild(this.taskTray);

    this.bubble = element('section', 'codex-message-bubble');
    this.bubble.hidden = true;
    this.bubble.innerHTML = `
      <header class="codex-bubble-head">
        <div class="codex-bubble-signal"></div>
        <button class="codex-icon-button codex-task-back" type="button" aria-label="返回任务列表">‹</button>
        <div class="codex-bubble-heading">
          <div class="codex-bubble-project"></div>
          <div class="codex-bubble-title"></div>
        </div>
        <div class="codex-bubble-state"></div>
        <button class="codex-icon-button codex-bubble-close" type="button" aria-label="关闭并标记已读">×</button>
      </header>
      <div class="codex-bubble-scroll" tabindex="0"><div class="codex-bubble-message"></div></div>
      <div class="codex-bubble-questions"></div>
      <div class="codex-bubble-compose">
        <textarea rows="2" maxlength="12000" placeholder="直接回复这个任务…"></textarea>
        <button class="codex-send-button" type="button">发送</button>
      </div>
      <footer class="codex-bubble-footer">
        <button class="codex-quiet-button codex-page-up" type="button">上一页</button>
        <span class="codex-page-status">滚动查看完整回复</span>
        <button class="codex-quiet-button codex-page-down" type="button">下一页</button>
        <button class="codex-quiet-button codex-open-app" type="button">打开 Codex</button>
      </footer>
      <div class="codex-bubble-actions"></div>
      <div class="codex-inline-error" role="status"></div>
    `;
    this.root.appendChild(this.bubble);

    this.configPanel = element('section', 'codex-config-panel');
    this.configPanel.hidden = true;
    this.configPanel.innerHTML = `
      <header class="codex-config-head">
        <div><div class="codex-config-kicker">PET LINK / CODEX</div><h2>连接 Codex</h2></div>
        <button class="codex-icon-button codex-config-close" type="button" aria-label="关闭配置">×</button>
      </header>
      <p class="codex-config-intro">连接后，桌宠只在 Codex 有新回复、等待操作或遇到问题时提醒你。</p>
      <div class="codex-link-rail" aria-hidden="true"><span>PET</span><i></i><span>CODEX</span></div>
      <div class="codex-config-status" data-state="checking"><span class="codex-status-light"></span><div><strong>正在寻找本机 Codex</strong><small>检查对话目录与连接状态</small></div></div>
      <div class="codex-capability-grid">
        <div><span>消息同步</span><strong class="codex-sync-state">等待检测</strong></div>
        <div><span>气泡回复与批准</span><strong class="codex-reply-state">等待检测</strong></div>
      </div>
      <div class="codex-connect-actions">
        <button class="codex-save-button codex-connect-button" type="button">启用并连接 Codex</button>
        <button class="codex-quiet-button codex-disconnect-button" type="button" hidden>断开同步</button>
      </div>
      <div class="codex-location-card">
        <div class="codex-section-label">对话数据位置</div>
        <div class="codex-path-value">当前用户的 .codex（自动检测）</div>
        <div class="codex-location-actions"><button class="codex-select-home" type="button">选择其他目录</button><button class="codex-quiet-button codex-use-auto" type="button" hidden>恢复自动检测</button></div>
      </div>
      <details class="codex-advanced">
        <summary>高级设置</summary>
        <label class="codex-switch-row"><span><strong>允许气泡回复与批准</strong><small>需要时连接本机 Codex，不影响消息读取</small></span><input class="codex-managed" type="checkbox"><i></i></label>
        <div class="codex-config-note">数据只在本机读取，不需要 API Key。关闭回复权限后，桌宠仍会显示未读消息。</div>
      </details>
      <footer class="codex-config-actions"><button class="codex-quiet-button codex-config-refresh" type="button">重新检测</button></footer>
      <div class="codex-config-error" role="status"></div>
    `;
    this.root.appendChild(this.configPanel);
    document.body.appendChild(this.root);

    this.badge.addEventListener('click', () => this.toggleTaskTray());
    this.taskTray.querySelector('.codex-tray-close').addEventListener('click', () => this.closeTaskTray());
    this.bubble.querySelector('.codex-task-back').addEventListener('click', () => {
      this.bubble.hidden = true;
      this.trayOpen = true;
      this.#renderTaskTray();
      this.updatePosition();
      this.onInteractionChange?.();
    });
    this.bubble.querySelector('.codex-bubble-close').addEventListener('click', () => this.closeCurrent(true));
    this.bubble.querySelector('.codex-open-app').addEventListener('click', async () => {
      const task = this.#currentTask();
      const result = await window.electronAPI.codex.openApp(
        task?.threadId || this.currentEvent?.threadId,
        task?.title || this.currentEvent?.title,
      );
      if (result?.copiedThread) {
        this.bubble.querySelector('.codex-page-status').textContent = '已打开 Codex，并复制任务信息';
      }
    });
    this.bubble.querySelector('.codex-page-up').addEventListener('click', () => this.#page(-1));
    this.bubble.querySelector('.codex-page-down').addEventListener('click', () => this.#page(1));
    this.bubble.querySelector('.codex-send-button').addEventListener('click', () => this.#sendText());
    this.bubble.querySelector('textarea').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.#sendText();
      }
    });
    this.bubble.querySelector('.codex-bubble-scroll').addEventListener('scroll', () => this.#onScroll());
    this.bubble.addEventListener('pointerenter', () => this.#cancelAutoClose());
    this.bubble.addEventListener('focusin', () => this.#cancelAutoClose());

    this.configPanel.querySelector('.codex-config-close').addEventListener('click', () => this.closeConfig());
    this.configPanel.querySelector('.codex-select-home').addEventListener('click', () => this.#selectHome());
    this.configPanel.querySelector('.codex-use-auto').addEventListener('click', async () => {
      this.#setPendingMode('auto');
      await this.#commitConfig({ enabled: true });
    });
    this.configPanel.querySelector('.codex-connect-button').addEventListener('click', () => this.#commitConfig({ enabled: true }));
    this.configPanel.querySelector('.codex-disconnect-button').addEventListener('click', () => this.#commitConfig({ enabled: false }));
    this.configPanel.querySelector('.codex-managed').addEventListener('change', () => this.#commitConfig({ enabled: this.config?.enabled === true }));
    this.configPanel.querySelector('.codex-advanced').addEventListener('toggle', () => {
      this.updatePosition();
      this.onInteractionChange?.();
    });
    this.configPanel.querySelector('.codex-config-refresh').addEventListener('click', async () => {
      this.#setConfigBusy(true);
      try { this.update(await window.electronAPI.codex.refresh()); }
      finally { this.#setConfigBusy(false); }
    });
  }

  update(snapshot) {
    if (!snapshot) return;
    const previousUnreadIds = new Set(this.snapshot?.unread?.map((event) => event.id) || []);
    const previousId = this.currentEvent?.id;
    this.snapshot = snapshot;
    const newEvent = snapshot.unread?.find((event) => !previousUnreadIds.has(event.id));
    const persistedEvent = snapshot.unread?.find((event) => event.id === previousId);
    if (this.currentPinned && this.currentEvent) {
      this.currentEvent = { ...this.currentEvent, ...(persistedEvent || {}) };
    } else if (persistedEvent) {
      this.currentEvent = persistedEvent;
    } else if (newEvent || (!this.initializedSnapshot && snapshot.unread?.length)) {
      this.currentEvent = newEvent || snapshot.unread[0];
      this.currentThreadId = this.currentEvent.threadId;
      this.trayOpen = false;
      this.alertFreshUntil = Date.now() + (this.currentEvent.activity === CODEX_ACTIVITY.READY ? 6000 : 3000);
      this.#renderBubble();
      this.#scheduleAutoClose(this.currentEvent);
    } else if (previousId) {
      this.currentEvent = null;
      this.currentThreadId = '';
      this.bubble.hidden = true;
    }
    this.initializedSnapshot = true;
    this.#renderBadge();
    this.#renderTaskTray();
    this.#renderConfigStatus();
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
    this.updatePosition();
    this.onInteractionChange?.();
  }

  closeConfig({ notify = true } = {}) {
    if (!this.configOpen) return;
    this.configOpen = false;
    this.configPanel.hidden = true;
    this.#renderBadge();
    if (this.currentEvent) this.#renderBubble();
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
    }
    else if (this.trayOpen && !this.configOpen) this.#renderTaskTray();
    else if (this.currentEvent && !this.configOpen) this.#renderBubble();
    this.#renderBadge();
    this.#emitMood();
    this.onInteractionChange?.();
  }

  updateFrame() {
    this.#emitMood();
    this.updatePosition();
  }

  setAnchor(x, y) {
    this.anchor = { x, y };
    this.updatePosition();
  }

  updatePosition() {
    const bubbleWidth = 430;
    const configWidth = 438;
    const preferRight = this.anchor.x < window.innerWidth - bubbleWidth - 90;
    const bubbleLeft = preferRight ? this.anchor.x + 54 : this.anchor.x - bubbleWidth - 54;
    const bubbleTop = this.anchor.y - 92;
    this.bubble.dataset.side = preferRight ? 'right' : 'left';
    this.bubble.style.left = `${clamp(bubbleLeft, 12, window.innerWidth - bubbleWidth - 12)}px`;
    this.bubble.style.top = `${clamp(bubbleTop, 62, window.innerHeight - Math.min(560, this.bubble.offsetHeight || 420) - 12)}px`;
    this.configPanel.style.left = `${clamp(this.anchor.x - configWidth / 2, 12, window.innerWidth - configWidth - 12)}px`;
    this.configPanel.style.top = `${clamp(this.anchor.y + 58, 62, window.innerHeight - Math.min(620, this.configPanel.offsetHeight || 520) - 12)}px`;
    this.badge.style.left = `${this.anchor.x + 24}px`;
    this.badge.style.top = `${this.anchor.y - 38}px`;
    this.taskTray.dataset.side = preferRight ? 'right' : 'left';
    this.taskTray.style.left = `${clamp(bubbleLeft, 12, window.innerWidth - 360 - 12)}px`;
    this.taskTray.style.top = `${clamp(this.anchor.y - 70, 62, window.innerHeight - Math.min(420, this.taskTray.offsetHeight || 280) - 12)}px`;
  }

  containsPoint(x, y) {
    return [this.configPanel, this.bubble, this.taskTray, this.badge].some((node) => {
      if (node.hidden) return false;
      const bounds = node.getBoundingClientRect();
      return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    });
  }

  get capturesOutsideClicks() {
    return this.configOpen || this.trayOpen || (!this.bubble.hidden && this.bubble.contains(document.activeElement));
  }

  get activity() {
    if (this.config?.enabled !== true) return CODEX_ACTIVITY.SILENT;
    return this.currentEvent?.activity || this.snapshot?.activity || CODEX_ACTIVITY.SILENT;
  }

  get motionEventKey() {
    if (this.currentEvent?.id) return this.currentEvent.id;
    if (this.activity === CODEX_ACTIVITY.RUNNING) {
      return (this.snapshot?.visibleTasks || [])
        .filter((task) => task.activity === CODEX_ACTIVITY.RUNNING)
        .map((task) => task.threadId || task.id)
        .sort()
        .join('|');
    }
    return this.activity;
  }

  get mood() {
    if (this.bubblesSuppressed || this.configOpen) return 'idle';
    const activity = this.activity;
    const alertFresh = activity === CODEX_ACTIVITY.NEEDS_INPUT || Date.now() < this.alertFreshUntil;
    return codexMoodForActivity(activity, { alertFresh });
  }

  #emitMood() {
    const mood = this.mood;
    if (mood === this.lastMood) return;
    this.lastMood = mood;
    this.onMoodChange?.(mood);
  }

  #renderBadge() {
    const unreadCount = Number(this.snapshot?.unreadTaskCount ?? this.snapshot?.unreadCount ?? 0);
    const runningCount = Number(this.snapshot?.runningCount
      ?? this.snapshot?.tasks?.filter((task) => task.activity === CODEX_ACTIVITY.RUNNING).length
      ?? 0);
    const count = unreadCount > 0 ? unreadCount : runningCount;
    this.badge.hidden = count <= 0 || this.configOpen || this.bubblesSuppressed;
    if (this.badge.hidden) return;
    this.badge.textContent = count > 9 ? '9+' : String(count);
    this.badge.dataset.mode = unreadCount > 0 ? 'unread' : 'running';
    this.badge.dataset.activity = unreadCount > 0
      ? (this.snapshot?.activity || CODEX_ACTIVITY.READY)
      : CODEX_ACTIVITY.RUNNING;
    this.badge.setAttribute('aria-label', unreadCount > 0
      ? `${unreadCount} 个未读或待处理任务，点击展开`
      : `${runningCount} 个任务运行中，点击展开`);
  }

  toggleTaskTray() {
    if (this.configOpen || this.bubblesSuppressed) return;
    this.trayOpen = !this.trayOpen;
    this.taskTray.hidden = !this.trayOpen;
    if (this.trayOpen) {
      this.bubble.hidden = true;
      this.#cancelAutoClose();
      this.#renderTaskTray();
    }
    this.updatePosition();
    this.onInteractionChange?.();
  }

  closeTaskTray() {
    this.trayOpen = false;
    this.taskTray.hidden = true;
    this.onInteractionChange?.();
  }

  #renderTaskTray() {
    if (!this.taskTray) return;
    this.taskTray.hidden = !this.trayOpen || this.configOpen || this.bubblesSuppressed;
    const host = this.taskTray.querySelector('.codex-task-list');
    const tasks = this.snapshot?.visibleTasks || [];
    host.replaceChildren();
    for (const task of tasks) {
      const button = element('button', 'codex-task-item');
      button.type = 'button';
      button.dataset.activity = task.activity || CODEX_ACTIVITY.SILENT;
      button.innerHTML = `
        <span class="codex-task-state" aria-hidden="true"></span>
        <span class="codex-task-copy"><strong></strong><small></small></span>
        <span class="codex-task-count"></span>
      `;
      button.querySelector('strong').textContent = task.title || 'Codex 任务';
      button.querySelector('small').textContent = `${task.project || 'Codex'} · ${statusLabel(task.activity)}`;
      const count = button.querySelector('.codex-task-count');
      count.textContent = task.unreadCount > 0 ? String(task.unreadCount) : 'RUN';
      count.dataset.mode = task.unreadCount > 0 ? 'unread' : 'running';
      button.addEventListener('click', () => this.#openTask(task));
      host.appendChild(button);
    }
    this.taskTray.querySelector('.codex-task-empty').hidden = tasks.length > 0;
  }

  #openTask(task) {
    const event = task.events?.[0] || {
      id: `task:${task.threadId || task.id}`,
      threadId: task.threadId || task.id,
      title: task.title,
      project: task.project,
      activity: task.activity,
      kind: 'task',
      message: task.activity === CODEX_ACTIVITY.RUNNING ? 'Codex 正在处理这个任务。' : '',
      canReply: task.canReply === true,
      createdAtMs: task.updatedAtMs,
    };
    this.currentEvent = event;
    this.currentThreadId = task.threadId || task.id;
    this.currentPinned = false;
    this.trayOpen = false;
    this.taskTray.hidden = true;
    this.#renderBubble();
    this.updatePosition();
    this.onInteractionChange?.();
  }

  #currentTask() {
    const id = this.currentThreadId || this.currentEvent?.threadId;
    return this.snapshot?.visibleTasks?.find((task) => (task.threadId || task.id) === id) || null;
  }

  #scheduleAutoClose(event) {
    this.#cancelAutoClose();
    if (!event || event.activity !== CODEX_ACTIVITY.READY) return;
    this.autoCloseTimer = setTimeout(() => {
      this.autoCloseTimer = null;
      if (this.bubble.contains(document.activeElement) || this.bubble.matches(':hover')) return;
      this.bubble.hidden = true;
      this.currentPinned = false;
      this.onInteractionChange?.();
    }, 6000);
  }

  #cancelAutoClose() {
    if (this.autoCloseTimer) clearTimeout(this.autoCloseTimer);
    this.autoCloseTimer = null;
  }

  #renderBubble() {
    const event = this.currentEvent;
    this.bubble.hidden = !event || this.configOpen || this.bubblesSuppressed;
    if (!event || this.configOpen || this.bubblesSuppressed) return;
    this.bubble.dataset.activity = event.activity;
    this.bubble.querySelector('.codex-bubble-project').textContent = event.project || 'Codex';
    this.bubble.querySelector('.codex-bubble-title').textContent = event.title || 'Codex 任务';
    this.bubble.querySelector('.codex-bubble-state').textContent = statusLabel(event.activity);
    const task = this.#currentTask();
    const messages = task?.messages || [];
    this.bubble.querySelector('.codex-bubble-message').textContent = messages.length
      ? messages.map((item) => `${item.role === 'user' ? '你' : 'Codex'}\n${item.message}`).join('\n\n')
      : (event.message || '暂时还没有可显示的回复。');
    this.bubble.querySelector('.codex-inline-error').textContent = '';
    const compose = this.bubble.querySelector('.codex-bubble-compose');
    const questions = this.bubble.querySelector('.codex-bubble-questions');
    const actions = this.bubble.querySelector('.codex-bubble-actions');
    questions.replaceChildren();
    actions.replaceChildren();
    compose.hidden = true;

    if (event.kind === 'question' && event.requestId) {
      this.#renderQuestions(event, questions);
    } else if (event.requestId) {
      this.#renderApprovalActions(event, actions);
    } else if (event.canReply || task?.canReply) {
      compose.hidden = false;
    }
    requestAnimationFrame(() => {
      const scroller = this.bubble.querySelector('.codex-bubble-scroll');
      scroller.scrollTop = 0;
      this.#updatePageStatus();
      this.updatePosition();
      this.onInteractionChange?.();
    });
  }

  #renderQuestions(event, host) {
    for (const question of event.questions || []) {
      const row = element('label', 'codex-question-row');
      const prompt = element('span', 'codex-question-prompt', question.question || '请选择');
      row.appendChild(prompt);
      const select = element('select', 'codex-question-input');
      select.dataset.questionId = question.id;
      for (const option of question.options || []) {
        const node = element('option', '', option.label);
        node.value = option.label;
        select.appendChild(node);
      }
      const custom = element('option', '', '自己输入…');
      custom.value = '__custom__';
      select.appendChild(custom);
      const input = element('input', 'codex-question-custom');
      input.placeholder = '输入回答';
      input.hidden = true;
      select.addEventListener('change', () => { input.hidden = select.value !== '__custom__'; });
      row.append(select, input);
      host.appendChild(row);
    }
    const send = element('button', 'codex-save-button', '提交回答');
    send.type = 'button';
    send.addEventListener('click', () => this.#submitQuestions(event));
    host.appendChild(send);
  }

  #renderApprovalActions(event, host) {
    const decisions = (event.availableDecisions || []).filter((item) => typeof item === 'string');
    const labels = {
      accept: '本次允许',
      acceptForSession: '本次会话允许',
      decline: '拒绝',
      cancel: '拒绝并停止',
    };
    for (const decision of decisions.length ? decisions : ['accept', 'acceptForSession', 'decline']) {
      if (!labels[decision]) continue;
      const button = element('button', decision.startsWith('accept') ? 'codex-save-button' : 'codex-quiet-button', labels[decision]);
      button.type = 'button';
      button.addEventListener('click', () => this.#respond(event, { decision }));
      host.appendChild(button);
    }
  }

  async #submitQuestions(event) {
    const answers = {};
    for (const select of this.bubble.querySelectorAll('.codex-question-input')) {
      const custom = select.parentElement.querySelector('.codex-question-custom');
      const answer = select.value === '__custom__' ? custom.value.trim() : select.value;
      if (!answer) {
        this.#showBubbleError('请完成所有问题后再提交');
        return;
      }
      answers[select.dataset.questionId] = { answers: [answer] };
    }
    await this.#respond(event, { answers });
  }

  async #respond(event, response) {
    this.#setBubbleBusy(true);
    try {
      await window.electronAPI.codex.respond(event.requestId, response);
      await this.#markRead(event.id);
      this.closeCurrent(false);
    } catch (error) {
      this.#showBubbleError(error?.message || String(error));
    } finally {
      this.#setBubbleBusy(false);
    }
  }

  async #sendText() {
    const event = this.currentEvent;
    const textarea = this.bubble.querySelector('textarea');
    const text = textarea.value.trim();
    const threadId = this.currentThreadId || event?.threadId;
    if (!threadId || !text) return;
    this.#setBubbleBusy(true);
    try {
      await window.electronAPI.codex.reply(threadId, text);
      textarea.value = '';
      await this.#markRead(event.id);
      this.closeCurrent(false);
    } catch (error) {
      this.#showBubbleError(error?.message || String(error));
    } finally {
      this.#setBubbleBusy(false);
    }
  }

  async closeCurrent(markRead) {
    const event = this.currentEvent;
    if (!event) return;
    if (markRead) await this.#markThreadRead(event.threadId);
    this.#cancelAutoClose();
    this.currentEvent = null;
    this.currentThreadId = '';
    this.currentPinned = false;
    if (this.bubble.contains(document.activeElement)) document.activeElement.blur();
    this.bubble.hidden = true;
    this.#emitMood();
    this.onInteractionChange?.();
  }

  async #markRead(eventId) {
    if (!eventId || this.readInFlight.has(eventId)) return;
    this.readInFlight.add(eventId);
    this.currentPinned = true;
    try {
      await window.electronAPI.codex.markRead(eventId);
    } finally {
      this.readInFlight.delete(eventId);
    }
  }

  async #markThreadRead(threadId) {
    const events = this.snapshot?.unread?.filter((event) => event.threadId === threadId) || [];
    await Promise.all(events.map((event) => this.#markRead(event.id)));
  }

  #onScroll() {
    this.#updatePageStatus();
    const scroller = this.bubble.querySelector('.codex-bubble-scroll');
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4 && this.currentEvent) {
      this.#markThreadRead(this.currentEvent.threadId);
    }
  }

  #page(direction) {
    const scroller = this.bubble.querySelector('.codex-bubble-scroll');
    scroller.scrollBy({ top: direction * Math.max(80, scroller.clientHeight * 0.82), behavior: 'smooth' });
  }

  #updatePageStatus() {
    const scroller = this.bubble.querySelector('.codex-bubble-scroll');
    const pages = Math.max(1, Math.ceil(scroller.scrollHeight / Math.max(1, scroller.clientHeight)));
    const page = Math.min(pages, Math.floor(scroller.scrollTop / Math.max(1, scroller.clientHeight)) + 1);
    this.bubble.querySelector('.codex-page-status').textContent = `${page} / ${pages}`;
  }

  #fillConfig() {
    const config = this.config || {};
    this.configPanel.querySelector('.codex-managed').checked = config.managedReplies !== false;
    this.configPanel.dataset.mode = config.homeMode || 'auto';
    this.configPanel.dataset.manualHome = config.manualHome || '';
    this.#setPendingMode(config.homeMode || 'auto');
    this.#renderConfigStatus();
  }

  #setPendingMode(mode) {
    this.configPanel.dataset.mode = mode === 'manual' ? 'manual' : 'auto';
    const manual = this.configPanel.dataset.mode === 'manual';
    this.configPanel.querySelector('.codex-path-value').textContent = manual
      ? (this.configPanel.dataset.manualHome || '尚未选择目录')
      : '当前用户的 .codex（自动检测）';
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
    } catch (error) {
      this.configPanel.querySelector('.codex-config-error').textContent = error?.message || String(error);
    } finally {
      this.#setConfigBusy(false);
    }
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
    strong.textContent = connected ? 'Codex 已连接' : enabled ? '接入需要处理' : '已准备好连接';
    const active = this.snapshot.tasks?.filter((task) => task.activity === CODEX_ACTIVITY.RUNNING).length || 0;
    small.textContent = connected
      ? `${this.snapshot.homeLabel} · ${active} 个运行中 · ${this.snapshot.unreadCount || 0} 条未读`
      : enabled
        ? (this.snapshot.reason || '正在等待 Codex 返回本地状态')
        : '程序会自动寻找当前用户的 .codex';
    this.configPanel.querySelector('.codex-sync-state').textContent = connected
      ? '同步正常'
      : enabled ? '等待连接' : '尚未启用';
    this.configPanel.querySelector('.codex-reply-state').textContent = !this.config?.managedReplies
      ? '已关闭'
      : connected ? '已允许 · 按需连接' : enabled ? '已允许 · 等待连接' : '连接后可用';
    const connectButton = this.configPanel.querySelector('.codex-connect-button');
    connectButton.hidden = connected;
    connectButton.textContent = enabled ? '重新连接 Codex' : '启用并连接 Codex';
    this.configPanel.querySelector('.codex-disconnect-button').hidden = !enabled;
  }

  #setBubbleBusy(busy) {
    this.bubble.classList.toggle('busy', busy);
    this.bubble.querySelectorAll('button, textarea, select, input').forEach((node) => { node.disabled = busy; });
  }

  #setConfigBusy(busy) {
    this.configPanel.classList.toggle('busy', busy);
    this.configPanel.querySelectorAll('button, input').forEach((node) => { node.disabled = busy; });
  }

  #showBubbleError(message) {
    this.bubble.querySelector('.codex-inline-error').textContent = message;
  }
}
