const TEMPERATURE_COLORS = Object.freeze([
  0x4ebcff,
  0x4fd6b0,
  0xffc857,
  0xff4d5a,
]);

const SPEED_DEFAULTS = Object.freeze({
  networkDown: { baseline: 1024 * 1024, noise: 1024 },
  networkUp: { baseline: 512 * 1024, noise: 1024 },
  diskRead: { baseline: 10 * 1024 * 1024, noise: 4096 },
  diskWrite: { baseline: 10 * 1024 * 1024, noise: 4096 },
  fan: { baseline: 1800, noise: 50 },
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function channels(color) {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

export function interpolateColor(from, to, amount) {
  const ratio = clamp(Number(amount) || 0, 0, 1);
  const a = channels(from);
  const b = channels(to);
  const values = a.map((value, index) => Math.round(value + (b[index] - value) * ratio));
  return (values[0] << 16) | (values[1] << 8) | values[2];
}

export function capacityColor(identityColor, usage) {
  if (!Number.isFinite(usage)) return 0x59657b;
  const value = clamp(usage, 0, 100);
  if (value < 75) return identityColor;
  if (value < 85) return interpolateColor(identityColor, 0xffb84d, (value - 75) / 10);
  if (value < 90) return interpolateColor(0xffb84d, 0xc92f45, (value - 85) / 5);
  return 0xc92f45;
}

export function remainingCapacityColor(identityColor, remaining) {
  if (!Number.isFinite(remaining)) return 0x59657b;
  const value = clamp(remaining, 0, 100);
  if (value >= 30) return identityColor;
  if (value >= 15) return interpolateColor(0xffb84d, identityColor, (value - 15) / 15);
  return interpolateColor(0xc92f45, 0xffb84d, value / 15);
}

export function temperatureColor(value, thresholds) {
  if (!Number.isFinite(value)) return 0x59657b;
  const stops = Array.isArray(thresholds) && thresholds.length === 4
    ? thresholds
    : [30, 55, 75, 90];
  if (value <= stops[0]) return TEMPERATURE_COLORS[0];
  for (let index = 1; index < stops.length; index += 1) {
    if (value <= stops[index]) {
      const ratio = (value - stops[index - 1]) / Math.max(1, stops[index] - stops[index - 1]);
      return interpolateColor(TEMPERATURE_COLORS[index - 1], TEMPERATURE_COLORS[index], ratio);
    }
  }
  return TEMPERATURE_COLORS[TEMPERATURE_COLORS.length - 1];
}

export function temperatureRatio(value, thresholds) {
  if (!Number.isFinite(value)) return null;
  const stops = Array.isArray(thresholds) && thresholds.length === 4
    ? thresholds
    : [30, 55, 75, 90];
  return clamp((value - Math.max(-20, stops[0] - 15)) / Math.max(1, stops[3] - stops[0] + 15), 0, 1);
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

export class AdaptiveSpeedTracker {
  constructor({ windowSize = 150, minimumLearningSamples = 8, defaults = SPEED_DEFAULTS } = {}) {
    this.windowSize = windowSize;
    this.minimumLearningSamples = minimumLearningSamples;
    this.defaults = defaults;
    this.channels = new Map();
  }

  _state(channel) {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, {
        samples: [],
        tier: 0,
        target: 0,
        animated: 0,
        downgradeCount: 0,
        value: null,
        baseline: this.defaults[channel]?.baseline || 1,
      });
    }
    return this.channels.get(channel);
  }

  update(channel, rawValue) {
    const state = this._state(channel);
    const settings = this.defaults[channel] || { baseline: 1, noise: 0 };
    const value = rawValue === null || rawValue === undefined || rawValue === ''
      ? Number.NaN
      : Number(rawValue);
    state.value = Number.isFinite(value) && value >= 0 ? value : null;
    if (state.value === null) {
      state.target = 0;
      state.tier = 0;
      state.downgradeCount = 0;
      return this.snapshot(channel);
    }

    state.samples.push(state.value);
    if (state.samples.length > this.windowSize) state.samples.shift();
    const learned = state.samples.length >= this.minimumLearningSamples
      ? percentile(state.samples, 0.9)
      : null;
    state.baseline = Math.max(settings.baseline, learned || 0, settings.noise * 4);
    const ratio = state.value <= settings.noise ? 0 : state.value / state.baseline;
    const nextTier = ratio === 0 ? 0 : ratio < 0.15 ? 1 : ratio < 0.4 ? 2 : ratio < 0.75 ? 3 : 4;

    if (nextTier >= state.tier) {
      state.tier = nextTier;
      state.downgradeCount = 0;
    } else {
      state.downgradeCount += 1;
      if (state.downgradeCount >= 2) {
        state.tier = nextTier;
        state.downgradeCount = 0;
      }
    }
    state.target = state.tier;
    return this.snapshot(channel);
  }

  step(deltaSeconds) {
    const amount = 1 - Math.exp(-Math.max(0, deltaSeconds) * 6);
    for (const state of this.channels.values()) {
      state.animated += (state.target - state.animated) * amount;
      if (Math.abs(state.animated - state.target) < 0.002) state.animated = state.target;
    }
  }

  snapshot(channel) {
    const state = this._state(channel);
    return {
      value: state.value,
      baseline: state.baseline,
      tier: state.tier,
      animated: state.animated,
      sampleCount: state.samples.length,
    };
  }
}

export function paginate(items, page, pageSize) {
  const values = Array.isArray(items) ? items : [];
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(values.length / size));
  const normalizedPage = ((Math.floor(page) || 0) % pageCount + pageCount) % pageCount;
  return {
    items: values.slice(normalizedPage * size, normalizedPage * size + size),
    page: normalizedPage,
    pageCount,
  };
}
