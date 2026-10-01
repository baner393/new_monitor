import { normalizeHotkeyCombo } from './charm-keymap.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));

export const ROPE_ELASTICITY_STEPS = [
  0.001, 0.003, 0.006, 0.01, 0.02, 0.04,
  0.07, 0.12, 0.25, 0.5, 1, 2,
];

export const PET_SETTINGS_DEFAULTS = Object.freeze({
  turtleSize: 64,
  ropeLength: 150,
  gravity: 800,
  damping: 0.995,
  pulleyFriction: 0.92,
  ropeStiffness: 500,
  ropeDamping: 15,
  bounceRestitution: 0.6,
  airDamping: 0.98,
  ropeElasticity: 5,
  ambientSwingEnabled: true,
  panelMoveStable: true,
  // ── 挂饰模式 ──
  charmFlipEnergy: 50,      // 翻转灵敏度（0-100）
  charmFlipSpin: 50,        // 翻滚时长（0-100）
  charmIdleSway: 50,        // 静置摇摆幅度（0-100）
  charmGravityLink: 50,     // 重力链接感（0-100）
  charmThickness: 50,       // 卡牌厚度（0-100）
  charmFlipEnabled: true,   // 翻转效果开关
  charmHoloEnabled: true,   // 全息闪卡开关
  charmBackMaterial: 'metal',
  charmHotkeyEnabled: true, // 挂饰快捷键开关
  charmHotkey: 'Ctrl+Alt+A',
});

export const PET_SETTING_SECTIONS = Object.freeze([
  { id: 'quick', label: '快速调校', shortLabel: '快速', description: '用手感控制和预设快速得到想要的效果。' },
  { id: 'appearance', label: '外观与悬挂', shortLabel: '外观', description: '控制桌宠尺寸与静止悬挂高度。' },
  { id: 'classic', label: '经典模式', shortLabel: '经典', description: '顶边悬挂形态的物理手感，左键摆动与右键甩动分开调整。' },
  { id: 'charm', label: '挂饰模式', shortLabel: '挂饰', description: '鼠标挂饰的翻转手感、视觉效果与快捷键。' },
  { id: 'panel', label: '面板行为', shortLabel: '面板', description: '控制监控面板展开时的移动方式。' },
]);

// 分组内的小区块标题（字段用 group 归属）
export const PET_SETTING_GROUPS = Object.freeze({
  classic: { left: '左键摆动', right: '右键甩动' },
  charm: { feel: '翻转手感', visual: '视觉效果', hotkey: '快捷键' },
});

export const PET_SETTING_FIELDS = Object.freeze({
  turtleSize: { section: 'appearance', label: '桌宠大小', hint: '桌面上桌宠的显示尺寸', min: 24, max: 192, step: 2, unit: 'px' },
  ropeLength: { section: 'appearance', label: '悬挂高度', hint: '桌宠静止时绳子的默认长度', min: 30, max: 400, step: 5, unit: 'px' },
  ambientSwingEnabled: { section: 'appearance', label: '待机自摆动', hint: '空闲和悬停时保持轻微自然摆动；不影响拖拽和 Codex 主动状态动作', type: 'boolean' },
  gravity: { section: 'classic', group: 'left', label: '重力', hint: '数值越大，下落和摆动越有重量感', min: 200, max: 2000, step: 50, unit: 'px/s²' },
  damping: { section: 'classic', group: 'left', label: '摆动延续', hint: '越接近 1，摆动持续得越久', min: 0.9, max: 1, step: 0.005, unit: '' },
  ropeElasticity: { section: 'classic', group: 'left', label: '绳子弹性', hint: '1 最松软，12 最紧绷', min: 1, max: 12, step: 1, unit: '档' },
  pulleyFriction: { section: 'classic', group: 'right', label: '滑轮惯性', hint: '越大越容易保留水平移动速度', min: 0.8, max: 1, step: 0.01, unit: '' },
  ropeStiffness: { section: 'classic', group: 'right', label: '回拉力度', hint: '绳子被拉长后的回弹力量', min: 100, max: 1000, step: 50, unit: '' },
  ropeDamping: { section: 'classic', group: 'right', label: '回拉收敛', hint: '抑制弹簧往复振动的强度', min: 5, max: 30, step: 1, unit: '' },
  bounceRestitution: { section: 'classic', group: 'right', label: '碰撞弹力', hint: '桌宠碰到屏幕边缘后的反弹幅度', min: 0.1, max: 1, step: 0.1, unit: '' },
  airDamping: { section: 'classic', group: 'right', label: '空气阻力', hint: '越小阻力越大，甩动停止得越快', min: 0.9, max: 1, step: 0.01, unit: '' },
  panelMoveStable: { section: 'panel', label: '面板移动稳定', hint: '打开跟随宠物的面板时固定位置并暂停待机自摆动；拖动时使用稳定参数', type: 'boolean' },
  // ── 挂饰模式 ──
  charmFlipEnergy: { section: 'charm', group: 'feel', label: '翻转灵敏度', hint: '鼠标一动就翻 / 要用力甩才翻', min: 0, max: 100, step: 5, unit: '%' },
  charmFlipSpin: { section: 'charm', group: 'feel', label: '翻滚时长', hint: '翻转后翻滚持续的时间', min: 0, max: 100, step: 5, unit: '%' },
  charmIdleSway: { section: 'charm', group: 'feel', label: '静置摇摆', hint: '静止时挂牌轻轻摇晃的幅度', min: 0, max: 100, step: 5, unit: '%' },
  charmGravityLink: { section: 'charm', group: 'feel', label: '重力链接感', hint: '加速/甩动时挂牌随惯性倾斜的强度', min: 0, max: 100, step: 5, unit: '%' },
  charmThickness: { section: 'charm', group: 'visual', label: '卡牌厚度', hint: '翻转时露出的金属侧壁厚度', min: 0, max: 100, step: 5, unit: '%' },
  charmFlipEnabled: { section: 'charm', group: 'visual', label: '翻转效果', hint: '关闭后挂饰保持正面朝外，不翻滚', type: 'boolean' },
  charmHoloEnabled: { section: 'charm', group: 'visual', label: '全息闪卡', hint: '关闭后表面不泛起全息反光与光带', type: 'boolean' },
  charmBackMaterial: { section: 'charm', group: 'visual', label: '背面外观', hint: '选择金属背板，或使用与正面相同的图案', type: 'enum', options: [{ value: 'metal', label: '金属背面' }, { value: 'pattern', label: '与正面相同图案' }] },
  charmHotkeyEnabled: { section: 'charm', group: 'hotkey', label: '挂饰快捷键', hint: '按住组合键呼出环形菜单', type: 'boolean' },
  charmHotkey: { section: 'charm', group: 'hotkey', label: '快捷键组合', hint: '点击右侧按键框，按下新的组合即可更换', type: 'hotkey' },
});

export const PET_SETTINGS_PRESETS = Object.freeze({
  natural: { label: '自然', description: '均衡、熟悉的默认手感', values: { ...PET_SETTINGS_DEFAULTS } },
  soft: {
    label: '软Q', description: '绳感松软，回弹圆润',
    values: { ...PET_SETTINGS_DEFAULTS, gravity: 700, damping: 0.99, pulleyFriction: 0.9, ropeStiffness: 250, ropeDamping: 10, bounceRestitution: 0.7, airDamping: 0.98, ropeElasticity: 3 },
  },
  lively: {
    label: '活泼', description: '轻快、灵敏、弹跳明显',
    values: { ...PET_SETTINGS_DEFAULTS, gravity: 500, damping: 1, pulleyFriction: 0.98, ropeStiffness: 450, ropeDamping: 12, bounceRestitution: 0.9, airDamping: 1, ropeElasticity: 5 },
  },
  steady: {
    label: '稳重', description: '快速收敛，不易乱跳',
    values: { ...PET_SETTINGS_DEFAULTS, gravity: 1200, damping: 0.96, pulleyFriction: 0.84, ropeStiffness: 750, ropeDamping: 24, bounceRestitution: 0.3, airDamping: 0.94, ropeElasticity: 9 },
  },
});

export const QUICK_TUNING_DEFS = Object.freeze({
  weight: { label: '运动重量', low: '轻盈', high: '沉稳', hint: '同时调整重力与运动收敛速度' },
  tension: { label: '绳索质感', low: '松软', high: '紧致', hint: '同时调整弹性、回拉力度与回拉收敛' },
  bounce: { label: '碰撞反馈', low: '克制', high: '弹跳', hint: '同时调整碰撞弹力、空气阻力与滑轮惯性' },
});

function nearestElasticityStep(value) {
  if (Number.isInteger(value) && value >= 1 && value <= 12) return value;
  let nearest = 5;
  let distance = Infinity;
  ROPE_ELASTICITY_STEPS.forEach((candidate, index) => {
    const nextDistance = Math.abs(Number(value) - candidate);
    if (nextDistance < distance) {
      nearest = index + 1;
      distance = nextDistance;
    }
  });
  return nearest;
}

function snap(value, field) {
  const bounded = clamp(value, field.min, field.max);
  const decimals = String(field.step).split('.')[1]?.length || 0;
  return Number((Math.round(bounded / field.step) * field.step).toFixed(decimals));
}

export function normalizePetSettings(value = {}) {
  const normalized = { ...PET_SETTINGS_DEFAULTS };
  for (const [key, field] of Object.entries(PET_SETTING_FIELDS)) {
    if (value[key] === undefined) continue;
    if (field.type === 'boolean') {
      normalized[key] = Boolean(value[key]);
    } else if (field.type === 'hotkey') {
      const combo = normalizeHotkeyCombo(value[key]);
      if (combo) normalized[key] = combo;
    } else if (field.type === 'enum') {
      if (field.options.some((option) => option.value === value[key])) normalized[key] = value[key];
    } else {
      normalized[key] = snap(value[key], field);
    }
  }
  normalized.ropeElasticity = nearestElasticityStep(value.ropeElasticity ?? normalized.ropeElasticity);
  return normalized;
}

export function scalePreviewRopeLength(ropeLength, canvasHeight) {
  const field = PET_SETTING_FIELDS.ropeLength;
  const normalizedLength = clamp(ropeLength, field.min, field.max);
  const minimumPreviewLength = 58;
  const maximumPreviewLength = Math.max(minimumPreviewLength, Number(canvasHeight) - 100);
  const progress = (normalizedLength - field.min) / (field.max - field.min);
  return minimumPreviewLength + (maximumPreviewLength - minimumPreviewLength) * progress;
}

export function resolveAmbientSwingEnabled(settings = {}, followPanelOpen = false) {
  const ambientSwingEnabled = settings.ambientSwingEnabled !== false;
  const stabilizePanel = settings.panelMoveStable !== false && followPanelOpen === true;
  return ambientSwingEnabled && !stabilizePanel;
}

function mix(min, max, value) {
  return min + (max - min) * clamp(value, 0, 100) / 100;
}

function ratio(value, min, max) {
  return clamp((Number(value) - min) / (max - min), 0, 1) * 100;
}

export function applyQuickTuning(settings, key, amount) {
  const next = normalizePetSettings(settings);
  const value = clamp(amount, 0, 100);
  if (key === 'weight') {
    next.gravity = snap(mix(350, 1550, value), PET_SETTING_FIELDS.gravity);
    next.damping = snap(mix(1, 0.94, value), PET_SETTING_FIELDS.damping);
  } else if (key === 'tension') {
    next.ropeElasticity = Math.round(mix(1, 12, value));
    next.ropeStiffness = snap(mix(150, 950, value), PET_SETTING_FIELDS.ropeStiffness);
    next.ropeDamping = snap(mix(7, 28, value), PET_SETTING_FIELDS.ropeDamping);
  } else if (key === 'bounce') {
    next.bounceRestitution = snap(mix(0.2, 1, value), PET_SETTING_FIELDS.bounceRestitution);
    next.airDamping = snap(mix(0.92, 1, value), PET_SETTING_FIELDS.airDamping);
    next.pulleyFriction = snap(mix(0.84, 1, value), PET_SETTING_FIELDS.pulleyFriction);
  }
  return next;
}

export function deriveQuickTunings(settings) {
  const value = normalizePetSettings(settings);
  return {
    weight: Math.round((ratio(value.gravity, 350, 1550) + ratio(1 - value.damping, 0, 0.06)) / 2),
    tension: Math.round((ratio(value.ropeElasticity, 1, 12)
      + ratio(value.ropeStiffness, 150, 950)
      + ratio(value.ropeDamping, 7, 28)) / 3),
    bounce: Math.round((ratio(value.bounceRestitution, 0.2, 1)
      + ratio(value.airDamping, 0.92, 1)
      + ratio(value.pulleyFriction, 0.84, 1)) / 3),
  };
}

export function applyPetSettingsPreset(settings, presetId) {
  const preset = PET_SETTINGS_PRESETS[presetId];
  if (!preset) return normalizePetSettings(settings);
  const physicalValues = Object.fromEntries(Object.entries(preset.values)
    .filter(([key]) => PET_SETTING_FIELDS[key].section === 'classic'));
  return normalizePetSettings({ ...settings, ...physicalValues });
}

function settingsEqual(left, right) {
  return Object.keys(PET_SETTINGS_DEFAULTS).every((key) => {
    if (typeof left[key] === 'number') return Math.abs(left[key] - right[key]) < 1e-9;
    return left[key] === right[key];
  });
}

export function detectPetSettingsPreset(settings) {
  const value = normalizePetSettings(settings);
  return Object.entries(PET_SETTINGS_PRESETS)
    .find(([, preset]) => Object.entries(PET_SETTING_FIELDS)
      .filter(([, field]) => field.section === 'classic')
      .every(([key]) => Math.abs(value[key] - preset.values[key]) < 1e-9))?.[0] || 'custom';
}

export class PetSettingsDraft {
  constructor(settings) {
    this.snapshot = normalizePetSettings(settings);
    this.draft = { ...this.snapshot };
  }

  get dirty() { return !settingsEqual(this.snapshot, this.draft); }

  update(settings) {
    this.draft = normalizePetSettings(settings);
    return { ...this.draft };
  }

  commit() {
    this.snapshot = { ...this.draft };
    return { ...this.snapshot };
  }

  cancel() {
    this.draft = { ...this.snapshot };
    return { ...this.draft };
  }
}
