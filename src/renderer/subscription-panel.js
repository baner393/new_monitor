const PLAN_COPY = Object.freeze({
  skins: {
    name: '皮肤会员',
    eyebrow: 'SKIN SIGNAL',
    description: '持续收到官方宠物、动作和皮肤修复。',
    features: ['订阅期间的新皮肤', '官方皮肤动作更新', '到期后已下载皮肤仍可使用'],
    products: [
      { key: 'skins_monthly', label: '月付', price: '¥1' },
      { key: 'skins_yearly', label: '年付', price: '¥9', recommended: true },
    ],
  },
  creator: {
    name: '创作会员',
    eyebrow: 'CREATOR RIG',
    description: '把自己的角色真正接入桌面宠物工作流。',
    features: ['包含全部皮肤会员权益', '绘画、生成与表情编辑', '皮肤导入、管理和自定义切换'],
    products: [
      { key: 'creator_monthly', label: '月付', price: '¥3' },
      { key: 'creator_quarterly', label: '季度', price: '¥7' },
      { key: 'creator_yearly', label: '年付', price: '¥19', recommended: true },
    ],
  },
});

function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function formatDate(timestamp) {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(timestamp));
}

function statusLabel(status) {
  if (status?.tier === 'creator') return '创作会员';
  if (status?.tier === 'skins') return '皮肤会员';
  return '免费版';
}

export class SubscriptionPanel {
  constructor({ onVisibilityChange = () => {} } = {}) {
    this._open = false;
    this._busy = false;
    this._status = null;
    this._selected = { skins: 'skins_yearly', creator: 'creator_yearly' };
    this._onVisibilityChange = onVisibilityChange;
    this._build();
    window.electronAPI?.subscription?.onChanged?.((status) => {
      this._status = status;
      this._renderStatus();
    });
  }

  _build() {
    this.root = node('div', 'subscription-root');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.panel = node('section', 'subscription-panel');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-labelledby', 'subscription-title');
    this.panel.tabIndex = -1;

    const header = node('header', 'subscription-header');
    const title = node('div', 'subscription-title');
    title.append(node('span', 'subscription-kicker', 'TURTLE MEMBERSHIP / 版本与订阅'));
    const heading = node('h2', '', '让这只小海龟继续长出新能力');
    heading.id = 'subscription-title';
    title.append(heading);
    header.append(title);
    this.currentBadge = node('div', 'subscription-current', '免费版');
    header.append(this.currentBadge);
    const close = node('button', 'subscription-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭版本与订阅');
    close.addEventListener('click', () => this.close());
    header.append(close);
    this.panel.append(header);

    const body = node('div', 'subscription-body');
    const route = node('div', 'subscription-route');
    route.setAttribute('aria-label', '版本成长路径');
    for (const [tier, label] of [['free', '免费使用'], ['skins', '皮肤更新'], ['creator', '自由创作']]) {
      const stop = node('div', 'subscription-stop');
      stop.dataset.tier = tier;
      stop.append(node('i', ''));
      stop.append(node('strong', '', label));
      route.append(stop);
    }
    body.append(route);

    const intro = node('div', 'subscription-intro');
    this.summary = node('div');
    this.summary.append(node('span', 'subscription-kicker', 'CURRENT SIGNAL'));
    this.summaryTitle = node('strong', '', '当前使用免费版');
    this.summary.append(this.summaryTitle);
    this.summaryDetail = node('small', '', 'Codex、Claude Code 与硬件监控保持完整可用。');
    this.summary.append(this.summaryDetail);
    intro.append(this.summary);
    this.refreshButton = node('button', 'subscription-refresh', '检查订阅状态');
    this.refreshButton.type = 'button';
    this.refreshButton.addEventListener('click', () => this._refresh());
    intro.append(this.refreshButton);
    body.append(intro);

    this.cards = node('div', 'subscription-cards');
    for (const tier of ['skins', 'creator']) this.cards.append(this._buildPlanCard(tier));
    body.append(this.cards);
    this.notice = node('p', 'subscription-notice', '订阅通过爱发电完成。付款后回到软件，升级会自动生效。');
    body.append(this.notice);
    this.bindingBox = node('div', 'subscription-binding');
    this.bindingBox.hidden = true;
    this.bindingBox.append(node('strong', '', '订单留言绑定码'));
    this.bindingCode = node('code', 'subscription-binding-code');
    this.bindingBox.append(this.bindingCode);
    this.copyBinding = node('button', 'subscription-binding-copy', '复制绑定码');
    this.copyBinding.type = 'button';
    this.copyBinding.addEventListener('click', async () => {
      const value = this.bindingCode.textContent.trim();
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        this.copyBinding.textContent = '已复制';
        window.setTimeout(() => { this.copyBinding.textContent = '复制绑定码'; }, 1600);
      } catch {
        this.copyBinding.textContent = '请手动复制';
      }
    });
    this.bindingBox.append(this.copyBinding);
    this.bindingBox.append(node('small', '', '请把绑定码粘贴到爱发电订单留言中。没有留言绑定码，付款不会自动关联到本设备。'));
    body.append(this.bindingBox);
    this.panel.append(body);

    const footer = node('footer', 'subscription-footer');
    this.device = node('span', '', '设备授权：0 / 2');
    footer.append(this.device);
    footer.append(node('span', '', '已创作的宠物与作品不会因到期被删除'));
    this.panel.append(footer);
    this.root.append(this.panel);
    document.body.append(this.root);

    this.root.addEventListener('mousedown', (event) => {
      if (event.target === this.root) this.close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this._open) this.close();
    });
  }

  _buildPlanCard(tier) {
    const copy = PLAN_COPY[tier];
    const card = node('article', 'subscription-card');
    card.dataset.tier = tier;
    const heading = node('div', 'subscription-card-heading');
    const headingCopy = node('div');
    headingCopy.append(node('span', 'subscription-kicker', copy.eyebrow));
    headingCopy.append(node('h3', '', copy.name));
    heading.append(headingCopy);
    if (tier === 'creator') heading.append(node('span', 'subscription-best', '完整体验'));
    card.append(heading);
    card.append(node('p', 'subscription-description', copy.description));
    const features = node('ul', 'subscription-features');
    for (const feature of copy.features) features.append(node('li', '', feature));
    card.append(features);

    const prices = node('div', 'subscription-prices');
    prices.setAttribute('role', 'radiogroup');
    prices.setAttribute('aria-label', `${copy.name}付费周期`);
    for (const product of copy.products) {
      const label = node('label', 'subscription-price');
      if (product.recommended) label.dataset.recommended = 'true';
      const input = node('input');
      input.type = 'radio';
      input.name = `subscription-${tier}`;
      input.value = product.key;
      input.checked = this._selected[tier] === product.key;
      input.addEventListener('change', () => { this._selected[tier] = product.key; });
      const visual = node('span');
      visual.append(node('small', '', product.label));
      visual.append(node('strong', '', product.price));
      label.append(input, visual);
      prices.append(label);
    }
    card.append(prices);
    const action = node('button', 'subscription-action', `选择${copy.name}`);
    action.type = 'button';
    action.dataset.tier = tier;
    action.addEventListener('click', () => this._checkout(tier));
    card.append(action);
    return card;
  }

  async _load() {
    this._status = await window.electronAPI?.subscription?.get?.();
    this._renderStatus();
  }

  _renderStatus() {
    const status = this._status || { tier: 'free', status: 'initializing', capabilities: {} };
    this.currentBadge.textContent = statusLabel(status);
    this.currentBadge.dataset.tier = status.tier;
    this.root.dataset.tier = status.tier;
    this.summaryTitle.textContent = status.tier === 'free'
      ? '当前使用免费版'
      : `当前是${statusLabel(status)}`;
    if (status.status === 'grace') {
      this.summaryDetail.textContent = `离线保护期至 ${formatDate(status.graceUntilMs)}`;
    } else if (status.expiresAtMs) {
      this.summaryDetail.textContent = `权益有效期至 ${formatDate(status.expiresAtMs)}`;
    } else {
      this.summaryDetail.textContent = 'Codex、Claude Code 与硬件监控保持完整可用。';
    }
    this.device.textContent = `设备授权：${status.activeDevices || 0} / ${status.deviceLimit || 2}`;
    for (const stop of this.root.querySelectorAll('.subscription-stop')) {
      const order = { free: 0, skins: 1, creator: 2 };
      stop.dataset.active = String(order[stop.dataset.tier] <= order[status.tier || 'free']);
    }
    for (const button of this.root.querySelectorAll('.subscription-action')) {
      button.disabled = this._busy || !status.serviceConfigured;
      button.textContent = status.serviceConfigured
        ? `选择${PLAN_COPY[button.dataset.tier].name}`
        : '订阅服务配置中';
    }
    this.refreshButton.disabled = this._busy || !status.serviceConfigured;
    if (!status.serviceConfigured) {
      this.notice.textContent = '订阅入口尚未连接爱发电；免费功能和现有赞助版功能不受影响。';
    }
  }

  async _checkout(tier) {
    if (this._busy) return;
    this._busy = true;
    this.notice.textContent = '正在打开爱发电付款页面…';
    this._renderStatus();
    const result = await window.electronAPI?.subscription?.startCheckout?.(this._selected[tier]);
    this._busy = false;
    if (result?.success) {
      this.notice.textContent = result.bindingCode
        ? `请在爱发电订单留言中粘贴绑定码：${result.bindingCode}。付款完成后回到这里，点击“检查订阅状态”自动升级。`
        : '付款完成后回到这里，软件会自动确认并升级。';
    } else {
      this.notice.textContent = result?.error === 'subscription_service_not_configured'
        ? '订阅服务尚未配置，正式开放时这个按钮会直接进入爱发电。'
        : `打开订阅失败：${result?.error || '请稍后重试'}`;
    }
    if (result?.success && result.bindingCode) {
      this.bindingCode.textContent = result.bindingCode;
      this.bindingBox.hidden = false;
      this.notice.textContent = '第一步：复制绑定码。第二步：在爱发电付款页面的订单留言中粘贴绑定码。第三步：付款后回到这里点击“检查订阅状态”。';
    }
    this._renderStatus();
  }

  async _refresh() {
    if (this._busy) return;
    this._busy = true;
    this.refreshButton.textContent = '正在确认…';
    this._renderStatus();
    const result = await window.electronAPI?.subscription?.refresh?.();
    this._busy = false;
    this.refreshButton.textContent = '检查订阅状态';
    if (result?.status) this._status = result.status;
    this.notice.textContent = result?.success ? '订阅状态已更新。' : `状态更新失败：${result?.error || '请稍后重试'}`;
    this._renderStatus();
  }

  open() {
    if (this._open) return;
    this._open = true;
    this._onVisibilityChange(true);
    this.root.hidden = false;
    this.root.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      this.root.classList.add('is-open');
      this.panel.focus({ preventScroll: true });
    });
    this._load().catch((error) => {
      this.notice.textContent = `读取订阅状态失败：${error.message}`;
    });
  }

  close() {
    if (!this._open) return;
    this._open = false;
    this._onVisibilityChange(false);
    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => { if (!this._open) this.root.hidden = true; }, 180);
  }

  containsPoint(x, y) {
    if (!this._open) return false;
    const bounds = this.panel.getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  }

  get isOpen() { return this._open; }
}
