import {
  ONBOARDING_STEP_SETS,
  completeOnboardingStep,
  createDefaultOnboardingState,
  isOnboardingComplete,
  normalizeOnboardingState,
} from '../shared/onboarding-model.js';

const CLASSIC_LESSONS = Object.freeze({
  'left-click': {
    eyebrow: '先认识任务入口',
    title: '左键点我',
    description: '打开 Codex 与 Claude Code 的任务连接。',
    gesture: 'left',
    hint: '轻点一下，不需要拖动',
  },
  'pull-down': {
    eyebrow: '再看看电脑状态',
    title: '按住左键，向下拉',
    description: '拉过一小段距离，就会展开监控面板。',
    gesture: 'pull',
    hint: '按住 · 下拉 · 松手',
  },
  'right-click': {
    eyebrow: '最后找到更多功能',
    title: '右键点我',
    description: '打开设置、皮肤、订阅和退出菜单。',
    gesture: 'right',
    hint: '按住右键拖动，还能甩动宠物',
  },
});

const CHARM_LESSONS = Object.freeze({
  'charm-follow': {
    eyebrow: '先认识你的挂件',
    title: '移动鼠标',
    description: '宠物挂在金属环下，跟着光标摆动。',
    gesture: 'charm-follow',
    hint: '随意晃一晃鼠标',
  },
  'charm-ring': {
    eyebrow: '再学会呼出圆盘',
    title: '按住 Ctrl+Alt+A',
    description: '宠物钉成圆心，移动鼠标画弧瞄准，松手触发。',
    gesture: 'charm-ring',
    hint: '按住 · 画弧 · 松手',
  },
  'charm-agent': {
    eyebrow: '最后进入任务',
    title: '圆盘选「任务对话」',
    description: '瞄准它松手，直接打开 Codex 与 Claude 的任务对话。',
    gesture: 'charm-agent',
    hint: '瞄准 · 松手',
  },
});

const LESSON_SETS = Object.freeze({ top: CLASSIC_LESSONS, cursor: CHARM_LESSONS });

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export class OnboardingGuide {
  constructor({ settings, isCharmMode = null, onVisibilityChange = null } = {}) {
    this.settings = settings;
    this.isCharmMode = typeof isCharmMode === 'function' ? isCharmMode : null;
    this.onVisibilityChange = typeof onVisibilityChange === 'function' ? onVisibilityChange : null;
    this.state = createDefaultOnboardingState();
    this.stateLoaded = false;
    this.sessionSteps = [];
    this.replaying = false;
    this.active = false;
    this.paused = false;
    this.finishing = false;
    this.awaitingContextMenuClose = false;
    this.anchor = { x: window.innerWidth / 2, y: 150 };
    this._startTimer = null;
    this._finishTimer = null;
    this._build();
  }

  _build() {
    this.root = element('div', 'pet-onboarding-root');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');

    this.card = element('section', 'pet-onboarding-card');
    this.card.setAttribute('role', 'region');
    this.card.setAttribute('aria-label', '新手操作指引');
    this.root.append(this.card);

    const head = element('header', 'pet-onboarding-head');
    this.progress = element('div', 'pet-onboarding-progress');
    this.progress.setAttribute('aria-label', '指引进度');
    // 两组课程各三课，进度结点固定 3 个（模式切换时复用）
    for (let index = 0; index < 3; index += 1) {
      const knot = element('i', 'pet-onboarding-knot');
      knot.setAttribute('aria-hidden', 'true');
      this.progress.append(knot);
    }
    head.append(this.progress);
    this.closeButton = element('button', 'pet-onboarding-close', '×');
    this.closeButton.type = 'button';
    this.closeButton.setAttribute('aria-label', '关闭，下次启动时再提醒');
    this.closeButton.addEventListener('click', () => this.defer());
    head.append(this.closeButton);
    this.card.append(head);

    const body = element('div', 'pet-onboarding-body');
    this.mouse = element('div', 'pet-onboarding-mouse');
    this.mouse.innerHTML = '<i class="mouse-left"></i><i class="mouse-right"></i><b></b><span>↓</span>';
    this.mouse.setAttribute('aria-hidden', 'true');
    body.append(this.mouse);
    const copy = element('div', 'pet-onboarding-copy');
    this.eyebrow = element('div', 'pet-onboarding-eyebrow');
    this.title = element('h2');
    this.description = element('p');
    this.hint = element('small');
    copy.append(this.eyebrow, this.title, this.description, this.hint);
    body.append(copy);
    this.card.append(body);

    const footer = element('footer', 'pet-onboarding-footer');
    this.counter = element('span');
    this.skipButton = element('button', 'pet-onboarding-skip', '跳过引导');
    this.skipButton.type = 'button';
    this.skipButton.addEventListener('click', () => this.skip());
    footer.append(this.counter, this.skipButton);
    this.card.append(footer);

    document.body.append(this.root);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isVisible) this.defer();
    });
  }

  async initialize(delay = 1800) {
    try {
      const saved = await this.settings?.get?.();
      this.state = normalizeOnboardingState(saved?.onboarding);
    } catch (error) {
      console.warn('[Onboarding] Failed to load state:', error);
    }
    this.stateLoaded = true;
    if (isOnboardingComplete(this.state, this._mode()) || this.state.dismissed) return;
    clearTimeout(this._startTimer);
    this._startTimer = setTimeout(() => this.start(), Math.max(0, delay));
  }

  start() {
    if (isOnboardingComplete(this.state, this._mode()) || this.state.dismissed) return;
    this.replaying = false;
    this.sessionSteps = [...this.state.completedSteps];
    this.finishing = false;
    this.active = true;
    this._render();
  }

  restart() {
    clearTimeout(this._startTimer);
    clearTimeout(this._finishTimer);
    this.replaying = true;
    this.sessionSteps = [];
    this.finishing = false;
    this.awaitingContextMenuClose = false;
    this.active = true;
    this.paused = false;
    this._render();
  }

  _mode() {
    return this.isCharmMode?.() ? 'cursor' : 'top';
  }

  _activeSteps() {
    return ONBOARDING_STEP_SETS[this._mode()];
  }

  _activeLessons() {
    return LESSON_SETS[this._mode()];
  }

  completeGesture(gesture) {
    if (!this.active || this.finishing || gesture !== this.currentStep) return false;
    if (!this.sessionSteps.includes(gesture)) this.sessionSteps.push(gesture);
    if (!this.replaying) {
      this.state = completeOnboardingStep(this.state, gesture);
      this._persist();
    }

    const modeSteps = this._activeSteps();
    if (modeSteps.every((step) => this.sessionSteps.includes(step))) {
      if (!this.replaying) {
        this.state = {
          ...normalizeOnboardingState(this.state),
          completedSteps: [...new Set([...this.state.completedSteps, ...modeSteps])],
          dismissed: false,
        };
        this._persist();
      }
      this.finishing = true;
      // 经典版完成页挂在「右键菜单关闭」上；挂饰版没有该事件，直接展示。
      this.awaitingContextMenuClose = this._mode() === 'top' && gesture === 'right-click';
      if (this._mode() === 'cursor') this.revealCompletion();
    }
    this._render();
    return true;
  }

  /**
   * 锚点模式切换：活动中的指引切回该模式第一课；未激活时若新模式组
   * 未完成且未被跳过，自动开始（老用户切到挂饰时补学挂饰课）。
   */
  onAnchorModeChanged() {
    if (this.replaying || !this.stateLoaded) return;
    if (this.active) {
      this.sessionSteps = [];
      this.finishing = false;
      this.awaitingContextMenuClose = false;
      this._render();
      return;
    }
    if (!isOnboardingComplete(this.state, this._mode()) && !this.state.dismissed) {
      this.start();
    }
  }

  revealCompletion() {
    if (!this.active || !this.finishing || !this.awaitingContextMenuClose) return;
    this.awaitingContextMenuClose = false;
    this._render();
    clearTimeout(this._finishTimer);
    this._finishTimer = setTimeout(() => this._hide(), 2200);
  }

  defer() {
    this._hide();
  }

  skip() {
    if (!this.replaying) {
      this.state = { ...normalizeOnboardingState(this.state), dismissed: true };
      this._persist();
    }
    this._hide();
  }

  setPaused(paused) {
    const next = Boolean(paused);
    if (next === this.paused) return;
    this.paused = next;
    this._syncVisibility();
  }

  setAnchor(x, y) {
    if (Number.isFinite(x)) this.anchor.x = x;
    if (Number.isFinite(y)) this.anchor.y = y;
    if (this.isVisible) this._position();
  }

  ownsEvent(event) {
    return Boolean(this.isVisible && event?.target && this.root.contains(event.target));
  }

  containsPoint(x, y) {
    if (!this.isVisible) return false;
    const bounds = this.card.getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  }

  _persist() {
    this.settings?.set?.('onboarding', normalizeOnboardingState(this.state));
    this.settings?.save?.();
  }

  _hide() {
    clearTimeout(this._finishTimer);
    this.active = false;
    this.finishing = false;
    this.awaitingContextMenuClose = false;
    this._syncVisibility();
  }

  _render() {
    if (!this.active) return this._syncVisibility();

    if (this.finishing) {
      [...this.progress.children].forEach((knot) => { knot.dataset.state = 'done'; });
      this.card.dataset.gesture = 'complete';
      const charm = this._mode() === 'cursor';
      this.eyebrow.textContent = charm ? '挂饰玩法都学会了' : '三个动作都学会了';
      this.title.textContent = '现在交给你啦';
      this.description.textContent = '随时可以在右键菜单或设置中重新查看。';
      this.hint.textContent = charm ? '甩一甩鼠标，挂件会跟着荡起来' : '右键拖动宠物，还藏着一个小彩蛋';
      this.counter.textContent = '完成';
      this.skipButton.hidden = true;
      this.closeButton.setAttribute('aria-label', '关闭指引');
    } else {
      const step = this.currentStep;
      const lesson = this._activeLessons()[step];
      const steps = this._activeSteps();
      const index = Math.max(0, steps.indexOf(step));
      this.card.dataset.gesture = lesson.gesture;
      this.eyebrow.textContent = lesson.eyebrow;
      this.title.textContent = lesson.title;
      this.description.textContent = lesson.description;
      this.hint.textContent = lesson.hint;
      this.counter.textContent = `${index + 1} / ${steps.length}`;
      this.skipButton.hidden = false;
      this.closeButton.setAttribute('aria-label', '关闭，下次启动时再提醒');
      [...this.progress.children].forEach((knot, knotIndex) => {
        knot.dataset.state = knotIndex < index ? 'done' : knotIndex === index ? 'active' : 'waiting';
      });
    }
    this._syncVisibility();
  }

  _syncVisibility() {
    const visible = this.active && !this.paused && !this.awaitingContextMenuClose;
    const changed = visible !== this.isVisible;
    this.root.hidden = !visible;
    this.root.setAttribute('aria-hidden', String(!visible));
    if (visible) requestAnimationFrame(() => this._position());
    if (changed) this.onVisibilityChange?.(visible);
  }

  _position() {
    if (!this.isVisible) return;
    const margin = 12;
    const gap = 58;
    const width = Math.max(0, Math.min(310, window.innerWidth - margin * 2));
    this.card.style.width = `${width}px`;
    const measuredHeight = this.card.getBoundingClientRect().height || 176;
    const placeRight = this.anchor.x < window.innerWidth / 2;
    const idealLeft = placeRight ? this.anchor.x + gap : this.anchor.x - width - gap;
    const left = Math.min(window.innerWidth - width - margin, Math.max(margin, idealLeft));
    const top = Math.min(
      Math.max(margin, window.innerHeight - measuredHeight - margin),
      Math.max(margin, this.anchor.y - 68),
    );
    this.card.style.left = `${Math.round(left)}px`;
    this.card.style.top = `${Math.round(top)}px`;
    this.card.dataset.side = placeRight ? 'right' : 'left';
  }

  get currentStep() {
    return this._activeSteps().find((step) => !this.sessionSteps.includes(step)) || null;
  }

  get isVisible() {
    return !this.root.hidden;
  }
}
