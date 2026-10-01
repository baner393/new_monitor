import { PhysicsEngine } from './physics.js';
import {
  PET_SETTING_FIELDS,
  PET_SETTING_GROUPS,
  PET_SETTING_SECTIONS,
  PET_SETTINGS_DEFAULTS,
  PET_SETTINGS_PRESETS,
  QUICK_TUNING_DEFS,
  ROPE_ELASTICITY_STEPS,
  PetSettingsDraft,
  applyPetSettingsPreset,
  applyQuickTuning,
  deriveQuickTunings,
  detectPetSettingsPreset,
  normalizePetSettings,
  scalePreviewRopeLength,
} from '../shared/pet-settings-model.js';
import { comboFromKeyboardEvent } from '../shared/charm-keymap.js';

export { ROPE_ELASTICITY_STEPS };

const PANEL_WIDTH = 900;
const PANEL_HEIGHT = 620;

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function formatValue(value, field) {
  if (field.type === 'boolean') return value ? '开启' : '关闭';
  const decimals = field.step < 1 ? String(field.step).split('.')[1]?.length || 0 : 0;
  return `${Number(value).toFixed(decimals)}${field.unit ? ` ${field.unit}` : ''}`;
}

function eventPoint(canvas, event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

export class SettingsPanel {
  constructor({ onReplayOnboarding = null, onVisibilityChange = null } = {}) {
    this._values = { ...PET_SETTINGS_DEFAULTS };
    this._originalValues = { ...PET_SETTINGS_DEFAULTS };
    this._draft = new PetSettingsDraft(this._values);
    this._section = 'quick';
    this._open = false;
    this._animating = false;
    this._closeTimer = null;
    this._previewFrame = null;
    this._previewLastAt = performance.now();
    this._previewReleasedAt = 0;
    this._previewPhysics = new PhysicsEngine();
    this._previewDragging = false;
    this._reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
    this._onReplayOnboarding = typeof onReplayOnboarding === 'function' ? onReplayOnboarding : null;
    this._onVisibilityChange = typeof onVisibilityChange === 'function' ? onVisibilityChange : null;
    this._build();
    this._loading = this._loadSettings();
    this._startPreviewLoop();
  }

  _build() {
    this.root = element('div', 'pet-settings-root');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');

    this.panel = element('section', 'pet-settings-panel');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-labelledby', 'pet-settings-title');
    this.panel.tabIndex = -1;
    this.container = this.panel;
    this.root.appendChild(this.panel);

    const header = element('header', 'pet-settings-header');
    const titleGroup = element('div', 'pet-settings-title-group');
    titleGroup.append(element('div', 'pet-settings-kicker', 'TURTLE RIG / DESKTOP PET'));
    const title = element('h2', '', '桌宠调校台');
    title.id = 'pet-settings-title';
    titleGroup.append(title);
    header.append(titleGroup);
    this.status = element('div', 'pet-settings-status', '设置已同步');
    this.status.dataset.dirty = 'false';
    header.append(this.status);
    this.closeButton = element('button', 'pet-settings-close', '×');
    this.closeButton.type = 'button';
    this.closeButton.setAttribute('aria-label', '取消并关闭设置');
    this.closeButton.addEventListener('click', () => this._cancel());
    header.append(this.closeButton);
    this.panel.append(header);

    const body = element('div', 'pet-settings-body');
    this.nav = element('nav', 'pet-settings-nav');
    this.nav.setAttribute('aria-label', '设置分类');
    for (const section of PET_SETTING_SECTIONS) {
      const button = element('button', 'pet-settings-nav-button');
      button.type = 'button';
      button.dataset.section = section.id;
      button.innerHTML = `<span>${section.label}</span><small>${section.description}</small>`;
      button.addEventListener('click', () => this._setSection(section.id));
      this.nav.append(button);
    }
    body.append(this.nav);

    this.workspace = element('main', 'pet-settings-workspace');
    body.append(this.workspace);

    const preview = element('aside', 'pet-settings-preview');
    const previewHead = element('div', 'pet-settings-preview-head');
    const previewCopy = element('div');
    previewCopy.append(element('div', 'pet-settings-kicker', 'LIVE PHYSICS'));
    previewCopy.append(element('strong', '', '手感预览'));
    previewHead.append(previewCopy);
    this.replayButton = element('button', 'pet-settings-replay', '重新测试');
    this.replayButton.type = 'button';
    this.replayButton.addEventListener('click', () => this._resetPreview(true));
    previewHead.append(this.replayButton);
    preview.append(previewHead);

    this.canvas = element('canvas', 'pet-settings-preview-canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', '可拖动的桌宠物理效果预览，按回车重新测试');
    this.canvas.addEventListener('pointerdown', (event) => this._previewPointerDown(event));
    this.canvas.addEventListener('pointermove', (event) => this._previewPointerMove(event));
    this.canvas.addEventListener('pointerup', (event) => this._previewPointerUp(event));
    this.canvas.addEventListener('pointercancel', (event) => this._previewPointerUp(event));
    this.canvas.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this._resetPreview(true);
      }
    });
    preview.append(this.canvas);
    this.previewHint = element('p', 'pet-settings-preview-hint', '拖动桌宠并松手，立即感受当前参数');
    preview.append(this.previewHint);
    body.append(preview);
    this.panel.append(body);

    const footer = element('footer', 'pet-settings-footer');
    const footerHelp = element('div', 'pet-settings-footer-help');
    this.resetButton = element('button', 'pet-settings-reset', '恢复默认');
    this.resetButton.type = 'button';
    this.resetButton.addEventListener('click', () => this._reset());
    this.onboardingButton = element('button', 'pet-settings-onboarding', '新手指引');
    this.onboardingButton.type = 'button';
    this.onboardingButton.addEventListener('click', () => {
      this._cancel();
      this._onReplayOnboarding?.();
    });
    footerHelp.append(this.resetButton, this.onboardingButton);
    footer.append(footerHelp);
    const actions = element('div', 'pet-settings-actions');
    this.cancelButton = element('button', 'pet-settings-cancel', '取消');
    this.cancelButton.type = 'button';
    this.cancelButton.addEventListener('click', () => this._cancel());
    this.saveButton = element('button', 'pet-settings-save', '应用设置');
    this.saveButton.type = 'button';
    this.saveButton.addEventListener('click', () => this._save());
    actions.append(this.cancelButton, this.saveButton);
    footer.append(actions);
    this.panel.append(footer);
    document.body.appendChild(this.root);

    this.root.addEventListener('mousedown', (event) => {
      if (event.target === this.root) this._cancel();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this._open) this._cancel();
    });

    this._previewImage = new Image();
    this._previewImage.decoding = 'async';
    this._previewImage.src = new URL('./assets/sprites/idle.png', window.location.href).href;
    this._previewImage.addEventListener('load', () => this._drawPreview());
    this._renderSection();
    this._syncUi();
  }

  _setSection(sectionId) {
    if (!PET_SETTING_SECTIONS.some((section) => section.id === sectionId)) return;
    this._section = sectionId;
    this._renderSection();
    // Replace the section first so the old section's scroll anchor cannot
    // restore its position after the workspace has been cleared.
    this.workspace.scrollTop = 0;
    this._syncUi();
  }

  _renderSection() {
    const section = PET_SETTING_SECTIONS.find((item) => item.id === this._section) || PET_SETTING_SECTIONS[0];
    this.workspace.replaceChildren();
    const heading = element('div', 'pet-settings-section-head');
    heading.append(element('div', 'pet-settings-kicker', section.id === 'quick' ? 'START HERE' : 'PRECISE CONTROL'));
    heading.append(element('h3', '', section.label));
    heading.append(element('p', '', section.description));
    this.workspace.append(heading);

    if (section.id === 'quick') this._renderQuickControls();
    else this._renderPreciseControls(section.id);
  }

  _renderQuickControls() {
    const presetBlock = element('section', 'pet-settings-block');
    const label = element('div', 'pet-settings-block-label', '选择一个起点');
    label.append(element('span', '', '随后仍可精确调整'));
    presetBlock.append(label);
    const presets = element('div', 'pet-settings-presets');
    for (const [id, preset] of Object.entries(PET_SETTINGS_PRESETS)) {
      const button = element('button', 'pet-settings-preset');
      button.type = 'button';
      button.dataset.preset = id;
      button.innerHTML = `<strong>${preset.label}</strong><small>${preset.description}</small>`;
      button.addEventListener('click', () => {
        this._applyValues(applyPetSettingsPreset(this._values, id));
      });
      presets.append(button);
    }
    presetBlock.append(presets);
    this.workspace.append(presetBlock);

    const tuningBlock = element('section', 'pet-settings-block pet-settings-tuning-block');
    tuningBlock.append(element('div', 'pet-settings-block-label', '调整整体手感'));
    const values = deriveQuickTunings(this._values);
    for (const [key, definition] of Object.entries(QUICK_TUNING_DEFS)) {
      tuningBlock.append(this._createRangeControl({
        key: `quick:${key}`,
        label: definition.label,
        hint: definition.hint,
        min: 0,
        max: 100,
        step: 1,
        value: values[key],
        low: definition.low,
        high: definition.high,
        formatter: (value) => `${Math.round(value)}%`,
        onInput: (value) => this._applyValues(applyQuickTuning(this._values, key, value), false),
      }));
    }
    this.workspace.append(tuningBlock);
  }

  _renderPreciseControls(sectionId) {
    const fields = Object.entries(PET_SETTING_FIELDS).filter(([, field]) => field.section === sectionId);
    // 按 group 分小区块（经典模式 = 左键/右键；挂饰 = 手感/视觉/快捷键）
    const groups = PET_SETTING_GROUPS[sectionId];
    const grouped = new Map();
    for (const entry of fields) {
      const g = entry[1].group || '_';
      if (!grouped.has(g)) grouped.set(g, []);
      grouped.get(g).push(entry);
    }
    for (const [groupId, groupFields] of grouped) {
      if (groups?.[groupId]) {
        const blockLabel = element('div', 'pet-settings-block-label', groups[groupId]);
        this.workspace.append(blockLabel);
      }
      const list = element('section', 'pet-settings-block pet-settings-field-list');
      for (const [key, field] of groupFields) {
        if (field.type === 'boolean') list.append(this._createSwitchControl(key, field));
        else if (field.type === 'hotkey') list.append(this._createHotkeyControl(key, field));
        else if (field.type === 'enum') list.append(this._createSelectControl(key, field));
        else list.append(this._createRangeControl({
          key,
          ...field,
          value: this._values[key],
          formatter: (value) => formatValue(value, field),
          onInput: (value) => this._applyValues({ ...this._values, [key]: value }, false),
        }));
      }
      this.workspace.append(list);
    }
  }

  _createSelectControl(key, field) {
    const row = element('div', 'pet-settings-range');
    row.dataset.control = key;
    const copy = element('div', 'pet-settings-control-copy');
    copy.append(element('strong', '', field.label));
    copy.append(element('small', '', field.hint));
    const select = element('select', 'pet-settings-hotkey-button');
    select.setAttribute('aria-label', field.label);
    for (const option of field.options) {
      const node = element('option', '', option.label);
      node.value = option.value;
      select.append(node);
    }
    select.value = this._values[key];
    select.addEventListener('change', () => this._applyValues({ ...this._values, [key]: select.value }, false));
    row.append(copy, select);
    return row;
  }

  _createHotkeyControl(key, field) {
    const row = element('div', 'pet-settings-range pet-settings-hotkey');
    row.dataset.control = key;
    const copy = element('div', 'pet-settings-control-copy');
    copy.append(element('strong', '', field.label));
    copy.append(element('small', '', field.hint));
    row.append(copy);

    const button = element('button', 'pet-settings-hotkey-button', String(this._values[key] || ''));
    button.type = 'button';
    button.setAttribute('aria-label', `${field.label}，点击后按下新组合`);
    const stopRecording = () => {
      button.dataset.recording = 'false';
      button.textContent = String(this._values[key] || '');
      // 录制结束，恢复全局快捷键钩子
      window.electronAPI?.charmHotkeyRecording?.(false);
    };
    button.addEventListener('click', () => {
      button.dataset.recording = 'true';
      button.textContent = '按下新组合…（Esc 取消）';
      button.focus();
      // 录制期间屏蔽全局钩子：否则按下旧组合会误开环形菜单
      window.electronAPI?.charmHotkeyRecording?.(true);
    });
    button.addEventListener('blur', stopRecording);
    button.addEventListener('keydown', (event) => {
      if (button.dataset.recording !== 'true') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') { stopRecording(); return; }
      const combo = comboFromKeyboardEvent(event);
      if (!combo) return; // 纯修饰键或无修饰键：继续等
      this._applyValues({ ...this._values, [key]: combo });
      stopRecording();
    });
    row.append(button);
    return row;
  }

  _createRangeControl(options) {
    const row = element('div', 'pet-settings-range');
    row.dataset.control = options.key;
    const copy = element('div', 'pet-settings-control-copy');
    copy.append(element('strong', '', options.label));
    copy.append(element('small', '', options.hint));
    row.append(copy);
    const output = element('output', 'pet-settings-value', options.formatter(options.value));
    row.append(output);
    const rangeWrap = element('div', 'pet-settings-range-wrap');
    if (options.low) rangeWrap.append(element('span', '', options.low));
    const input = element('input');
    input.type = 'range';
    input.min = String(options.min);
    input.max = String(options.max);
    input.step = String(options.step);
    input.value = String(options.value);
    input.setAttribute('aria-label', options.label);
    input.addEventListener('input', () => {
      const value = Number(input.value);
      output.textContent = options.formatter(value);
      options.onInput(value);
    });
    rangeWrap.append(input);
    if (options.high) rangeWrap.append(element('span', '', options.high));
    row.append(rangeWrap);
    return row;
  }

  _createSwitchControl(key, field) {
    const label = element('label', 'pet-settings-switch');
    const copy = element('span', 'pet-settings-control-copy');
    copy.append(element('strong', '', field.label));
    copy.append(element('small', '', field.hint));
    label.append(copy);
    const input = element('input');
    input.type = 'checkbox';
    input.checked = Boolean(this._values[key]);
    input.addEventListener('change', () => this._applyValues({ ...this._values, [key]: input.checked }));
    label.append(input);
    label.append(element('i', ''));
    return label;
  }

  _applyValues(values, rerender = true) {
    const previousScrollTop = this.workspace.scrollTop;
    this._values = this._draft.update(values);
    this._syncPreviewSettings();
    if (rerender) {
      this._renderSection();
      this.workspace.scrollTop = previousScrollTop;
    }
    this._syncUi();
  }

  _syncUi() {
    const dirty = this._draft.dirty;
    this.status.textContent = dirty ? '有未应用更改' : '设置已同步';
    this.status.dataset.dirty = String(dirty);
    this.saveButton.disabled = !dirty;
    this.saveButton.textContent = dirty ? '应用设置' : '已应用';
    const preset = detectPetSettingsPreset(this._values);
    for (const button of this.nav.querySelectorAll('.pet-settings-nav-button')) {
      const selected = button.dataset.section === this._section;
      button.dataset.active = String(selected);
      button.setAttribute('aria-current', selected ? 'page' : 'false');
    }
    for (const button of this.workspace.querySelectorAll('.pet-settings-preset')) {
      const selected = button.dataset.preset === preset;
      button.dataset.active = String(selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  async _loadSettings() {
    const draft = this._draft;
    const loadId = this._loadId = (this._loadId || 0) + 1;
    try {
      const saved = await window.electronAPI?.settings?.get?.();
      if (!saved || loadId !== this._loadId || this._draft !== draft || draft.dirty) return;
      this._values = normalizePetSettings(saved);
      this._originalValues = { ...this._values };
      this._draft = new PetSettingsDraft(this._values);
      this._renderSection();
      this._syncPreviewSettings(true);
      this._syncUi();
    } catch (error) {
      console.warn('[Settings] Failed to load settings:', error);
    }
  }

  async _save() {
    if (this._saving) return;
    await this._loading;
    if (this._saving) return;
    if (!this._draft.dirty) {
      this.close();
      return;
    }
    this.saveButton.disabled = true;
    this.saveButton.textContent = '正在应用…';
    this._saving = true;
    try {
      const patch = Object.fromEntries(Object.entries(this._values)
        .filter(([key, value]) => value !== this._draft.snapshot[key]));
      const saved = await window.electronAPI.settings.apply(patch);
      this._values = normalizePetSettings(saved);
      this._draft = new PetSettingsDraft(this._values);
      this._originalValues = { ...this._values };
      this._syncUi();
      this.close();
    } catch (error) {
      console.error('[Settings] Save failed:', error);
      this.status.textContent = '应用失败，请重试';
      this.status.dataset.dirty = 'error';
      this.saveButton.disabled = false;
      this.saveButton.textContent = '重新应用';
    } finally {
      this._saving = false;
    }
  }

  _reset() {
    this._applyValues(PET_SETTINGS_DEFAULTS);
    this.status.textContent = '默认值已载入，应用后生效';
  }

  _cancel() {
    this._values = this._draft.cancel();
    this._originalValues = { ...this._values };
    this._renderSection();
    this._syncPreviewSettings(true);
    this._syncUi();
    this.close();
  }

  _syncPreviewSettings(reset = false) {
    const physics = this._previewPhysics;
    physics.gravity = this._values.gravity;
    physics.damping = this._values.damping;
    physics.pulleyFriction = this._values.pulleyFriction;
    physics.ropeStiffness = this._values.ropeStiffness;
    physics.ropeDamping = this._values.ropeDamping;
    physics.ropeBounceRest = this._values.bounceRestitution;
    physics.airDamping = this._values.airDamping;
    physics.ropeElasticity = ROPE_ELASTICITY_STEPS[this._values.ropeElasticity - 1];
    if (reset || !Number.isFinite(physics.turtle.x) || physics.turtle.x === 0) {
      this._resetPreview(false);
    } else {
      const { height } = this._previewSize();
      const ropeLength = scalePreviewRopeLength(this._values.ropeLength, height);
      if (Math.abs(physics.restRopeLength - ropeLength) > 0.5) {
        const dx = physics.turtle.x - physics.pulley.x;
        const dy = physics.turtle.y - physics.pulley.y;
        const angle = Math.atan2(dx, dy);
        physics.restRopeLength = ropeLength;
        physics.ropeLength = ropeLength;
        physics.turtle.x = physics.pulley.x + Math.sin(angle) * ropeLength;
        physics.turtle.y = physics.pulley.y + Math.cos(angle) * ropeLength;
      }
    }
    this._drawPreview();
  }

  _previewSize() {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      width: Math.max(180, Math.round(bounds.width || 240)),
      height: Math.max(220, Math.round(bounds.height || 330)),
    };
  }

  _resetPreview(announce = false) {
    const { width, height } = this._previewSize();
    const physics = this._previewPhysics;
    const ropeLength = scalePreviewRopeLength(this._values.ropeLength, height);
    physics.reset();
    physics.restRopeLength = ropeLength;
    physics.ropeLength = ropeLength;
    physics.screenAnchorX = 0.5;
    physics.pulley.x = width / 2;
    physics.pulley.y = 35;
    physics.turtle.x = width / 2 + Math.min(42, width * 0.14);
    physics.turtle.y = Math.min(height - 42, physics.pulley.y + ropeLength - 8);
    physics.turtle.vx = announce && !this._reducedMotion ? 115 : 0;
    physics.turtle.vy = announce && !this._reducedMotion ? -35 : 0;
    physics.setContext({ state: 'PULLEY_PHYSICS', windowWidth: width, windowHeight: height, turtleSize: Math.min(84, Math.max(46, this._values.turtleSize * 0.65)) });
    this._previewDragging = false;
    this._previewReleasedAt = performance.now();
    if (announce) this.previewHint.textContent = '已重新释放桌宠，观察回弹和收敛';
    this._syncPreviewSettings(false);
  }

  _previewPointerDown(event) {
    const point = eventPoint(this.canvas, event);
    this.canvas.setPointerCapture?.(event.pointerId);
    this._previewPhysics.setContext({ state: 'PULLEY_DRAG' });
    this._previewPhysics.startDrag(point.x, point.y);
    this._previewDragging = true;
    this.previewHint.textContent = '正在拖动：移动快一点，松手后效果更明显';
    this._drawPreview();
  }

  _previewPointerMove(event) {
    if (!this._previewDragging) return;
    const point = eventPoint(this.canvas, event);
    this._previewPhysics.updateDrag(point.x, point.y, 1 / 60);
    this._drawPreview();
  }

  _previewPointerUp(event) {
    if (!this._previewDragging) return;
    this.canvas.releasePointerCapture?.(event.pointerId);
    this._previewPhysics.release();
    this._previewPhysics.setContext({ state: 'PULLEY_PHYSICS' });
    this._previewDragging = false;
    this._previewReleasedAt = performance.now();
    this.previewHint.textContent = '观察当前回弹；可再次拖动测试';
  }

  _startPreviewLoop() {
    const tick = (now) => {
      const dt = Math.min(0.033, Math.max(0, (now - this._previewLastAt) / 1000));
      this._previewLastAt = now;
      if (this._open && !this._previewDragging && !this._reducedMotion) {
        this._previewPhysics.updatePulleyPhysics(dt);
      }
      if (this._open) this._drawPreview();
      this._previewFrame = requestAnimationFrame(tick);
    };
    this._previewFrame = requestAnimationFrame(tick);
  }

  _drawPreview() {
    if (!this.canvas?.isConnected) return;
    const { width, height } = this._previewSize();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this._previewPhysics.setContext({ windowWidth: width, windowHeight: height });
    }
    const context = this.canvas.getContext('2d');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#0b1016';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(102, 227, 138, 0.075)';
    context.lineWidth = 1;
    for (let x = 12; x < width; x += 16) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
    }
    for (let y = 12; y < height; y += 16) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
    context.fillStyle = '#17212b';
    context.fillRect(16, 18, width - 32, 8);
    context.fillStyle = '#66e38a';
    context.fillRect(Math.round(this._previewPhysics.pulley.x) - 9, 17, 18, 10);

    const physics = this._previewPhysics;
    context.strokeStyle = '#9eb0bd';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(physics.pulley.x, physics.pulley.y);
    context.lineTo(physics.turtle.x, physics.turtle.y);
    context.stroke();

    const size = Math.min(84, Math.max(46, this._values.turtleSize * 0.65));
    context.imageSmoothingEnabled = false;
    if (this._previewImage.complete && this._previewImage.naturalWidth > 0) {
      context.drawImage(this._previewImage, physics.turtle.x - size / 2, physics.turtle.y - size / 2, size, size);
    } else {
      context.fillStyle = '#2f8f53';
      context.fillRect(physics.turtle.x - size * 0.34, physics.turtle.y - size * 0.25, size * 0.68, size * 0.5);
      context.fillStyle = '#66e38a';
      context.fillRect(physics.turtle.x - size * 0.22, physics.turtle.y - size * 0.36, size * 0.44, size * 0.72);
    }
    context.fillStyle = 'rgba(203, 215, 226, 0.7)';
    context.font = '10px Consolas, monospace';
    context.fillText(`L ${Math.round(this._values.ropeLength)} PX`, 12, height - 13);
    context.textAlign = 'center';
    context.fillText(`G ${Math.round(this._values.gravity)}`, width / 2, height - 13);
    context.textAlign = 'right';
    context.fillText(`K ${Math.round(this._values.ropeStiffness)}`, width - 12, height - 13);
    context.textAlign = 'left';
  }

  setPosition() {
    // The DOM panel is viewport-centered and responsive by design.
  }

  open() {
    clearTimeout(this._closeTimer);
    this._originalValues = { ...this._values };
    this._draft = new PetSettingsDraft(this._values);
    this._open = true;
    this._animating = true;
    this.root.hidden = false;
    this.root.setAttribute('aria-hidden', 'false');
    this._renderSection();
    this.workspace.scrollTop = 0;
    this._syncUi();
    this._syncPreviewSettings(true);
    requestAnimationFrame(() => {
      this.root.classList.add('is-open');
      this._animating = false;
      this.panel.focus({ preventScroll: true });
    });
    this._onVisibilityChange?.();
    this._loading = this._loadSettings();
    return this._loading;
  }

  close() {
    if (!this._open && !this._animating) return;
    this._open = false;
    this._animating = true;
    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
    clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => {
      this.root.hidden = true;
      this._animating = false;
      this._onVisibilityChange?.();
    }, this._reducedMotion ? 0 : 180);
  }

  settleForRefresh() {
    clearTimeout(this._closeTimer);
    this._animating = false;
    this.root.hidden = !this._open;
    this.root.classList.toggle('is-open', this._open);
    this.root.setAttribute('aria-hidden', String(!this._open));
    return this._open;
  }

  updateAnimation() {
    // CSS owns the panel transition; the preview has an isolated animation loop.
  }

  containsPoint(x, y) {
    if (!this._open) return false;
    const bounds = this.panel.getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  }

  setPreviewImage(source) {
    const value = String(source || '').trim();
    if (!value) return;
    const url = new URL(value, window.location.href).href;
    if (this._previewImage.src === url) return;
    this._previewImage.src = url;
  }

  get isAnimating() { return this._animating; }
  get isOpen() { return this._open; }
  get width() { return this.panel.getBoundingClientRect().width || PANEL_WIDTH; }
  get height() { return this.panel.getBoundingClientRect().height || PANEL_HEIGHT; }
  getValue(key) { return this._values[key] ?? PET_SETTINGS_DEFAULTS[key]; }
  getValues() { return { ...this._values }; }
}
