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
  panelMoveStable: true,
});

export const PET_SETTING_SECTIONS = Object.freeze([
  { id: 'quick', label: '快速调校', shortLabel: '快速', description: '用手感控制和预设快速得到想要的效果。' },
  { id: 'appearance', label: '外观与悬挂', shortLabel: '外观', description: '控制桌宠尺寸与静止悬挂高度。' },
  { id: 'left', label: '左键摆动', shortLabel: '左键', description: '调整拉拽后的摆动速度、延续时间和绳感。' },
  { id: 'right', label: '右键甩动', shortLabel: '右键', description: '调整甩动、碰撞和弹簧回拉的物理反馈。' },
  { id: 'panel', label: '面板行为', shortLabel: '面板', description: '控制监控面板展开时的移动方式。' },
]);

export const PET_SETTING_FIELDS = Object.freeze({
  turtleSize: { section: 'appearance', label: '桌宠大小', hint: '桌面上桌宠的显示尺寸', min: 24, max: 192, step: 2, unit: 'px' },
  ropeLength: { section: 'appearance', label: '悬挂高度', hint: '桌宠静止时绳子的默认长度', min: 30, max: 400, step: 5, unit: 'px' },
  gravity: { section: 'left', label: '重力', hint: '数值越大，下落和摆动越有重量感', min: 200, max: 2000, step: 50, unit: 'px/s²' },
  damping: { section: 'left', label: '摆动延续', hint: '越接近 1，摆动持续得越久', min: 0.9, max: 1, step: 0.005, unit: '' },
  ropeElasticity: { section: 'left', label: '绳子弹性', hint: '1 最松软，12 最紧绷', min: 1, max: 12, step: 1, unit: '档' },
  pulleyFriction: { section: 'right', label: '滑轮惯性', hint: '越大越容易保留水平移动速度', min: 0.8, max: 1, step: 0.01, unit: '' },
  ropeStiffness: { section: 'right', label: '回拉力度', hint: '绳子被拉长后的回弹力量', min: 100, max: 1000, step: 50, unit: '' },
  ropeDamping: { section: 'right', label: '回拉收敛', hint: '抑制弹簧往复振动的强度', min: 5, max: 30, step: 1, unit: '' },
  bounceRestitution: { section: 'right', label: '碰撞弹力', hint: '桌宠碰到屏幕边缘后的反弹幅度', min: 0.1, max: 1, step: 0.1, unit: '' },
  airDamping: { section: 'right', label: '空气阻力', hint: '越小阻力越大，甩动停止得越快', min: 0.9, max: 1, step: 0.01, unit: '' },
  panelMoveStable: { section: 'panel', label: '稳定移动面板', hint: '面板展开时使用稳定参数，避免拖动后剧烈弹跳', type: 'boolean' },
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
    normalized[key] = field.type === 'boolean'
      ? Boolean(value[key])
      : snap(value[key], field);
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
  return normalizePetSettings({ ...settings, ...preset.values });
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
    .find(([, preset]) => settingsEqual(value, normalizePetSettings(preset.values)))?.[0] || 'custom';
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
