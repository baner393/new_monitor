export const MONITOR_PANEL_CONFIG_VERSION = 2;

export const CARD_IDS = Object.freeze([
  'cpu', 'memory', 'gpu', 'network', 'storage', 'cooling', 'power', 'battery',
]);

export const DEFAULT_CARD_ORDER = Object.freeze([...CARD_IDS]);

export const CARD_LABELS = Object.freeze({
  cpu: 'CPU',
  memory: '内存',
  gpu: 'GPU',
  network: '网络',
  storage: '存储',
  cooling: '散热',
  power: '功耗',
  battery: '电池',
});

export const PRESET_CARDS = Object.freeze({
  minimal: Object.freeze(['cpu', 'memory', 'storage', 'network']),
  performance: Object.freeze(['cpu', 'memory', 'gpu', 'network', 'storage', 'cooling']),
  hardware: Object.freeze(['cpu', 'gpu', 'storage', 'cooling', 'power', 'battery']),
  full: Object.freeze([...CARD_IDS]),
});

export const PRESET_LABELS = Object.freeze({
  minimal: '极简',
  performance: '性能',
  hardware: '硬件',
  full: '全量',
  custom: '自定义',
});

export const DEFAULT_TEMPERATURE_THRESHOLDS = Object.freeze({
  cpu: Object.freeze([35, 60, 75, 90]),
  gpu: Object.freeze([35, 60, 75, 88]),
  storage: Object.freeze([25, 40, 55, 70]),
  motherboard: Object.freeze([30, 50, 65, 80]),
  unknown: Object.freeze([30, 55, 75, 90]),
});

export const DEFAULT_SENSOR_VISIBILITY = Object.freeze({
  temperature: true,
  power: true,
  fan: true,
  voltage: true,
  storageHealth: true,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeOrder(order) {
  const valid = [];
  for (const id of Array.isArray(order) ? order : []) {
    if (CARD_IDS.includes(id) && !valid.includes(id)) valid.push(id);
  }
  for (const id of DEFAULT_CARD_ORDER) {
    if (!valid.includes(id)) valid.push(id);
  }
  return valid;
}

function normalizeThresholds(value, fallback) {
  const source = Array.isArray(value) ? value.map(Number) : [];
  if (source.length !== 4 || source.some((item) => !Number.isFinite(item))) return [...fallback];
  const normalized = [];
  for (let index = 0; index < source.length; index += 1) {
    const minimum = index === 0 ? -20 : normalized[index - 1] + 1;
    const maximum = 150 - (source.length - 1 - index);
    normalized.push(Math.max(minimum, Math.min(maximum, source[index])));
  }
  return normalized;
}

export function createDefaultMonitorPanelConfig(preset = 'performance') {
  const presetCards = PRESET_CARDS[preset] || PRESET_CARDS.performance;
  return {
    version: MONITOR_PANEL_CONFIG_VERSION,
    preset: PRESET_CARDS[preset] ? preset : 'performance',
    layout: {
      order: [...DEFAULT_CARD_ORDER],
      enabled: Object.fromEntries(CARD_IDS.map((id) => [id, presetCards.includes(id)])),
    },
    sensors: {
      visible: { ...DEFAULT_SENSOR_VISIBILITY },
      temperatureDefaults: clone(DEFAULT_TEMPERATURE_THRESHOLDS),
      temperatureOverrides: {},
    },
    motion: {
      enabled: true,
      mode: 'adaptive',
    },
  };
}

export function applyMonitorPreset(config, preset) {
  const normalized = normalizeMonitorPanelConfig(config);
  const cards = PRESET_CARDS[preset] || PRESET_CARDS.performance;
  normalized.preset = PRESET_CARDS[preset] ? preset : 'performance';
  normalized.layout.order = [...DEFAULT_CARD_ORDER];
  normalized.layout.enabled = Object.fromEntries(CARD_IDS.map((id) => [id, cards.includes(id)]));
  return normalized;
}

export function migrateLegacyMonitorVisibility(legacy, baseConfig = null) {
  const config = normalizeMonitorPanelConfig(baseConfig || createDefaultMonitorPanelConfig());
  if (!legacy || typeof legacy !== 'object') return config;

  const enabled = config.layout.enabled;
  if ('cpu' in legacy) enabled.cpu = legacy.cpu !== false;
  if ('memory' in legacy) enabled.memory = legacy.memory !== false;
  if ('gpu' in legacy) enabled.gpu = legacy.gpu !== false;
  if ('network' in legacy) enabled.network = legacy.network !== false;
  if ('disk' in legacy) enabled.storage = legacy.disk !== false;
  if ('battery' in legacy) enabled.battery = legacy.battery !== false;
  if ('fan' in legacy) enabled.cooling = legacy.fan !== false;
  if ('power' in legacy || 'voltage' in legacy) {
    const legacyPowerFlags = [];
    if ('power' in legacy) legacyPowerFlags.push(legacy.power !== false);
    if ('voltage' in legacy) legacyPowerFlags.push(legacy.voltage !== false);
    enabled.power = legacyPowerFlags.some(Boolean);
  }
  for (const key of Object.keys(DEFAULT_SENSOR_VISIBILITY)) {
    if (key in legacy) config.sensors.visible[key] = legacy[key] !== false;
  }
  config.preset = detectMonitorPreset(config);
  return config;
}

export function normalizeMonitorPanelConfig(value) {
  const fallback = createDefaultMonitorPanelConfig();
  if (!value || typeof value !== 'object') return fallback;

  const enabledSource = value.layout?.enabled || {};
  const visibleSource = value.sensors?.visible || {};
  const defaultsSource = value.sensors?.temperatureDefaults || {};
  const overridesSource = value.sensors?.temperatureOverrides || {};
  const temperatureDefaults = {};
  for (const [kind, thresholds] of Object.entries(DEFAULT_TEMPERATURE_THRESHOLDS)) {
    temperatureDefaults[kind] = normalizeThresholds(defaultsSource[kind], thresholds);
  }

  const temperatureOverrides = {};
  for (const [identifier, thresholds] of Object.entries(overridesSource)) {
    if (!identifier || typeof identifier !== 'string') continue;
    temperatureOverrides[identifier] = normalizeThresholds(thresholds, DEFAULT_TEMPERATURE_THRESHOLDS.unknown);
  }

  const config = {
    version: MONITOR_PANEL_CONFIG_VERSION,
    preset: typeof value.preset === 'string' ? value.preset : 'custom',
    layout: {
      order: normalizeOrder(value.layout?.order),
      enabled: Object.fromEntries(CARD_IDS.map((id) => [
        id,
        id in enabledSource ? enabledSource[id] !== false : fallback.layout.enabled[id],
      ])),
    },
    sensors: {
      visible: Object.fromEntries(Object.keys(DEFAULT_SENSOR_VISIBILITY)
        .map((key) => [
          key,
          key in visibleSource ? visibleSource[key] !== false : fallback.sensors.visible[key],
        ])),
      temperatureDefaults,
      temperatureOverrides,
    },
    motion: {
      enabled: value.motion?.enabled !== false,
      mode: 'adaptive',
    },
  };
  const detectedPreset = detectMonitorPreset(config);
  config.preset = value.preset === 'custom' ? 'custom' : detectedPreset;
  return config;
}

export function detectMonitorPreset(config) {
  const enabled = config?.layout?.enabled || {};
  const hasDefaultOrder = DEFAULT_CARD_ORDER.every((id, index) => config?.layout?.order?.[index] === id);
  if (!hasDefaultOrder) return 'custom';
  for (const [preset, cards] of Object.entries(PRESET_CARDS)) {
    if (CARD_IDS.every((id) => Boolean(enabled[id]) === cards.includes(id))) return preset;
  }
  return 'custom';
}

export function toLegacyMonitorVisibility(config) {
  const normalized = normalizeMonitorPanelConfig(config);
  return {
    cpu: normalized.layout.enabled.cpu,
    memory: normalized.layout.enabled.memory,
    gpu: normalized.layout.enabled.gpu,
    disk: normalized.layout.enabled.storage,
    network: normalized.layout.enabled.network,
    system: true,
    temperature: normalized.sensors.visible.temperature,
    power: normalized.layout.enabled.power && normalized.sensors.visible.power,
    fan: normalized.layout.enabled.cooling && normalized.sensors.visible.fan,
    voltage: normalized.layout.enabled.power && normalized.sensors.visible.voltage,
    storageHealth: normalized.sensors.visible.storageHealth,
    battery: normalized.layout.enabled.battery,
  };
}

export function cloneMonitorPanelConfig(config) {
  return clone(normalizeMonitorPanelConfig(config));
}
