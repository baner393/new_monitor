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
    this.currentPinned = false;
    this.configOpen = false;
    this.bubblesSuppressed = false;
    this.anchor = { x: window.innerWidth / 2, y: 180 };
    this.alertFreshUntil = 0;
    this.lastMood = 'idle';
    this.unsubscribe = null;
    this.readInFlight = new Set();
    this.#build();
  }

  async initialize() {
    this.config = await window.electronAPI.codex.getConfig();
    this.snapshot = await window.electronAPI.codex.getStatus();
    this.unsubscribe = window.electronAPI.codex.onStatus((snapshot) => this.update(snapshot));
    this.update(this.snapshot);
  }

  destroy() {
    this.unsubscribe?.();
    this.root.remove();
  }

  #build() {
    this.root = element('div', 'codex-companion-root');
    this.root.setAttribute('aria-live', 'polite');

    this.badge = element('div', 'codex-pet-signal');
    this.badge.hidden = true;
    this.root.appendChild(this.badge);

    this.bubble = element('section', 'codex-message-bubble');
    this.bubble.hidden = true;
    this.bubble.innerHTML = `
      <header class="codex-bubble-head">
        <div class="codex-bubble-signal"></div>
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
        <div><div class="codex-config-kicker">PET LINK / CODEX</div><h2>Codex 接入</h2></div>
        <button class="codex-icon-button codex-config-close" type="button" aria-label="关闭配置">×</button>
      </header>
      <p class="codex-config-intro">同步本机对话。只有未读回复、等待操作和错误会自动弹出气泡。</p>
      <div class="codex-config-status"><span class="codex-status-light"></span><div><strong>正在检查</strong><small></small></div></div>
      <label class="codex-switch-row"><span><strong>启用对话同步</strong><small>运行过程保持安静，新消息才弹出</small></span><input class="codex-enabled" type="checkbox"><i></i></label>
      <div class="codex-config-section">
        <div class="codex-section-label">数据位置</div>
        <div class="codex-mode-buttons"><button type="button" data-mode="auto">自动检测</button><button type="button" data-mode="manual">手动选择</button></div>
        <div class="codex-path-line"><span class="codex-path-value">自动寻找当前用户的 .codex</span><button class="codex-select-home" type="button">选择目录</button></div>
      </div>
      <label class="codex-switch-row"><span><strong>允许气泡回复与审批</strong><small>完成后的继续对话将由宠物托管</small></span><input class="codex-managed" type="checkbox"><i></i></label>
      <div class="codex-config-note">接入只读取本机 Codex 文件，不需要 API Key，也不会修改 Codex 设置。</div>
      <footer class="codex-config-actions"><button class="codex-quiet-button codex-config-refresh" type="button">重新检测</button><button class="codex-save-button" type="button">保存接入</button></footer>
      <div class="codex-config-error" role="status"></div>
    `;
    this.root.appendChild(this.configPanel);
    document.body.appendChild(this.root);

    this.bubble.querySelector('.codex-bubble-close').addEventListener('click', () => this.closeCurrent(true));
    this.bubble.querySelector('.codex-open-app').addEventListener('click', () => window.electronAPI.codex.openApp());
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

    this.configPanel.querySelector('.codex-config-close').addEventListener('click', () => this.closeConfig());
    this.configPanel.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => this.#setPendingMode(button.dataset.mode));
    });
    this.configPanel.querySelector('.codex-select-home').addEventListener('click', () => this.#selectHome());
    this.configPanel.querySelector('.codex-save-button').addEventListener('click', () => this.#saveConfig());
    this.configPanel.querySelector('.codex-config-refresh').addEventListener('click', async () => {
      this.#setConfigBusy(true);
      try { this.update(await window.electronAPI.codex.refresh()); }
      finally { this.#setConfigBusy(false); }
    });
  }

  update(snapshot) {
    if (!snapshot) return;
    const previousId = this.currentEvent?.id;
    this.snapshot = snapshot;
    if (!this.currentPinned) {
      this.currentEvent = snapshot.unread?.find((event) => event.id === previousId)
        || snapshot.unread?.[0]
        || null;
    }
    if (this.currentEvent && this.currentEvent.id !== previousId) {
      this.alertFreshUntil = Date.now() + (this.currentEvent.activity === CODEX_ACTIVITY.READY ? 5000 : 3000);
      this.#renderBubble();
    } else if (!this.currentEvent) {
      this.bubble.hidden = true;
    }
    this.#renderBadge();
    this.#renderConfigStatus();
    this.#emitMood();
    this.updatePosition();
    this.onInteractionChange?.();
  }

  openConfig() {
    this.configOpen = true;
    this.configPanel.hidden = false;
    this.bubble.hidden = true;
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
    if (next) this.bubble.hidden = true;
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
  }

  containsPoint(x, y) {
    return [this.configPanel, this.bubble].some((node) => {
      if (node.hidden) return false;
      const bounds = node.getBoundingClientRect();
      return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    });
  }

  get capturesOutsideClicks() {
    return this.configOpen || (!this.bubble.hidden && this.bubble.contains(document.activeElement));
  }

  get mood() {
    if (this.bubblesSuppressed || this.configOpen) return 'idle';
    const activity = this.currentEvent?.activity || this.snapshot?.activity || CODEX_ACTIVITY.SILENT;
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
    const count = Number(this.snapshot?.unreadCount || 0);
    this.badge.hidden = count <= 0 || this.configOpen || this.bubblesSuppressed;
    if (this.badge.hidden) return;
    this.badge.textContent = count > 9 ? '9+' : String(count);
    this.badge.dataset.activity = this.snapshot?.activity || CODEX_ACTIVITY.READY;
  }

  #renderBubble() {
    const event = this.currentEvent;
    this.bubble.hidden = !event || this.configOpen || this.bubblesSuppressed;
    if (!event || this.configOpen || this.bubblesSuppressed) return;
    this.bubble.dataset.activity = event.activity;
    this.bubble.querySelector('.codex-bubble-project').textContent = event.project || 'Codex';
    this.bubble.querySelector('.codex-bubble-title').textContent = event.title || 'Codex 任务';
    this.bubble.querySelector('.codex-bubble-state').textContent = statusLabel(event.activity);
    this.bubble.querySelector('.codex-bubble-message').textContent = event.message || '';
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
    } else if (event.canReply) {
      compose.hidden = false;
      compose.querySelector('textarea').value = '';
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
    if (!event || !text) return;
    this.#setBubbleBusy(true);
    try {
      await window.electronAPI.codex.reply(event.threadId, text);
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
    if (markRead) await this.#markRead(event.id);
    this.currentEvent = null;
    this.currentPinned = false;
    if (this.bubble.contains(document.activeElement)) document.activeElement.blur();
    this.bubble.hidden = true;
    const next = this.snapshot?.unread?.find((item) => item.id !== event.id);
    if (next) {
      this.currentEvent = next;
      this.#renderBubble();
    }
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

  #onScroll() {
    this.#updatePageStatus();
    const scroller = this.bubble.querySelector('.codex-bubble-scroll');
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4 && this.currentEvent) {
      this.#markRead(this.currentEvent.id);
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
    this.configPanel.querySelector('.codex-enabled').checked = config.enabled === true;
    this.configPanel.querySelector('.codex-managed').checked = config.managedReplies !== false;
    this.configPanel.dataset.mode = config.homeMode || 'auto';
    this.configPanel.dataset.manualHome = config.manualHome || '';
    this.#setPendingMode(config.homeMode || 'auto');
    this.#renderConfigStatus();
  }

  #setPendingMode(mode) {
    this.configPanel.dataset.mode = mode === 'manual' ? 'manual' : 'auto';
    this.configPanel.querySelectorAll('[data-mode]').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === this.configPanel.dataset.mode);
    });
    const manual = this.configPanel.dataset.mode === 'manual';
    this.configPanel.querySelector('.codex-select-home').hidden = !manual;
    this.configPanel.querySelector('.codex-path-value').textContent = manual
      ? (this.configPanel.dataset.manualHome || '尚未选择目录')
      : '自动寻找当前用户的 .codex';
  }

  async #selectHome() {
    const selected = await window.electronAPI.codex.selectHome();
    if (!selected) return;
    this.configPanel.dataset.manualHome = selected;
    this.#setPendingMode('manual');
  }

  async #saveConfig() {
    this.#setConfigBusy(true);
    this.configPanel.querySelector('.codex-config-error').textContent = '';
    try {
      this.config = await window.electronAPI.codex.saveConfig({
        ...this.config,
        enabled: this.configPanel.querySelector('.codex-enabled').checked,
        managedReplies: this.configPanel.querySelector('.codex-managed').checked,
        homeMode: this.configPanel.dataset.mode,
        manualHome: this.configPanel.dataset.manualHome || '',
      });
      this.update(await window.electronAPI.codex.refresh());
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
    const connected = this.snapshot.connected;
    light.dataset.connected = connected ? 'true' : 'false';
    strong.textContent = connected ? 'Codex 已同步' : (this.snapshot.enabled ? '等待连接' : '尚未启用');
    const active = this.snapshot.tasks?.filter((task) => task.activity === CODEX_ACTIVITY.RUNNING).length || 0;
    small.textContent = connected
      ? `${this.snapshot.homeLabel} · ${active} 个运行中 · ${this.snapshot.unreadCount || 0} 条未读`
      : (this.snapshot.reason || '保存后开始同步');
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
