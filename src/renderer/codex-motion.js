import { CODEX_ACTIVITY } from '../shared/codex-integration.js';

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function blockedLengthAt(time, dropLength) {
  if (time < 0.45) return dropLength * Math.pow(time / 0.45, 2.25);
  if (time < 1.35) {
    const t = (time - 0.45) / 0.9;
    return dropLength * (1 - Math.cos(t * Math.PI * 4) * 0.17 * Math.pow(1 - t, 1.4));
  }
  if (time < 4.35) {
    const progress = (time - 1.35) / 3;
    const stepCount = 12;
    const scaled = clamp(progress, 0, 0.999999) * stepCount;
    const step = Math.floor(scaled);
    const local = scaled - step;
    const stepProgress = local < 0.68 ? smoothstep(local / 0.68) : 1;
    const climbed = (step + stepProgress) / stepCount;
    return dropLength * (1 - climbed);
  }
  if (time < 4.8) {
    const t = (time - 4.35) / 0.45;
    return Math.sin(t * Math.PI * 3) * (1 - t) * 3;
  }
  return 0;
}

export function codexDropLength({ petHeight = 64, baseY = 150, viewportHeight = 600 } = {}) {
  const desired = clamp(petHeight * 0.65, 28, 80);
  const available = Math.max(0, viewportHeight - baseY - petHeight / 2 - 16);
  return Math.min(desired, available);
}

export class CodexMotionController {
  constructor() {
    this.activity = CODEX_ACTIVITY.SILENT;
    this.eventKey = '';
    this.time = 0;
    this.sequence = '';
    this.emissions = [];
    this.lastRunningBeat = -1;
    this.lastInputBeat = -1;
  }

  setState(activity, eventKey = '') {
    const nextActivity = activity || CODEX_ACTIVITY.SILENT;
    const nextKey = String(eventKey || '');
    const changed = nextActivity !== this.activity || nextKey !== this.eventKey;
    if (!changed) return;

    const previousActivity = this.activity;
    this.activity = nextActivity;
    this.eventKey = nextKey;
    this.time = 0;
    this.lastRunningBeat = -1;
    this.lastInputBeat = -1;

    if (nextActivity === CODEX_ACTIVITY.BLOCKED
      && previousActivity !== CODEX_ACTIVITY.BLOCKED) {
      this.sequence = 'blocked';
      this.emissions.push({ kind: 'blocked', count: 3 });
    } else if (nextActivity === CODEX_ACTIVITY.READY) {
      this.sequence = 'ready';
      this.emissions.push({ kind: 'ready', count: 8 });
    } else {
      this.sequence = '';
    }
  }

  cancelSequence() {
    this.sequence = '';
    this.time = 0;
  }

  update(dt, {
    enabled = true,
    reducedMotion = false,
    petHeight = 64,
    baseY = 150,
    viewportHeight = 600,
  } = {}) {
    const safeDt = clamp(Number(dt) || 0, 0, 0.05);
    if (!enabled || reducedMotion) {
      return this.#frame();
    }
    this.time += safeDt;

    let angleOffset = 0;
    let lengthOffset = 0;
    let rotation = 0;

    if (this.sequence === 'blocked') {
      const dropLength = codexDropLength({ petHeight, baseY, viewportHeight });
      lengthOffset = blockedLengthAt(this.time, dropLength);
      if (this.time >= 1.35 && this.time < 4.35) {
        const step = Math.floor(((this.time - 1.35) / 3) * 12);
        const local = (((this.time - 1.35) / 3) * 12) % 1;
        rotation = (step % 2 === 0 ? -1 : 1) * Math.sin(Math.min(local / 0.68, 1) * Math.PI) * 0.045;
        angleOffset = rotation * 0.28;
      }
      if (this.time >= 4.8) this.sequence = '';
    } else if (this.sequence === 'ready') {
      const t = clamp(this.time / 0.9, 0, 1);
      lengthOffset = -Math.sin(t * Math.PI) * (1 - t * 0.35) * Math.min(18, petHeight * 0.25);
      rotation = Math.sin(t * Math.PI * 2) * 0.035 * (1 - t);
      if (t >= 1) this.sequence = '';
    } else if (this.activity === CODEX_ACTIVITY.RUNNING) {
      angleOffset = Math.sin(this.time * TAU / 2.4) * (Math.PI / 60);
      rotation = angleOffset * 0.45;
      const beat = Math.floor(this.time / 1.2);
      if (beat !== this.lastRunningBeat) {
        this.lastRunningBeat = beat;
        this.emissions.push({ kind: 'running', count: 2 });
      }
    } else if (this.activity === CODEX_ACTIVITY.NEEDS_INPUT) {
      const cycle = this.time % 2.8;
      const pulse = cycle < 0.62
        ? Math.max(0, Math.sin(cycle / 0.62 * Math.PI * 4))
        : 0;
      lengthOffset = -pulse * Math.min(8, petHeight * 0.12);
      const beat = Math.floor(this.time / 2.8);
      if (beat !== this.lastInputBeat) {
        this.lastInputBeat = beat;
        this.emissions.push({ kind: 'needsInput', count: 2 });
      }
    }

    return this.#frame({ angleOffset, lengthOffset, rotation });
  }

  drainEmissions() {
    return this.emissions.splice(0);
  }

  #frame({ angleOffset = 0, lengthOffset = 0, rotation = 0 } = {}) {
    return {
      activity: this.activity,
      angleOffset,
      lengthOffset,
      rotation,
      sequence: this.sequence,
      symbolFrame: Math.floor(this.time * 8),
    };
  }
}

export function codexStatusSymbol(activity, frame = 0) {
  const phase = Math.abs(Math.floor(frame)) % 4;
  if (activity === CODEX_ACTIVITY.RUNNING) {
    return { color: 0x66c9ff, pixels: [[0, 1], [1, 1], [2, 1], [phase % 3, 0], [(phase + 1) % 3, 2]] };
  }
  if (activity === CODEX_ACTIVITY.NEEDS_INPUT) {
    return { color: 0xffd166, pixels: [[0, 0], [1, 0], [2, 1], [1, 2], [1, phase === 0 ? 4 : 3]] };
  }
  if (activity === CODEX_ACTIVITY.READY) {
    return { color: 0x69e0aa, pixels: [[0, 2], [1, 3], [2, 2], [3, 1], [4, 0]] };
  }
  if (activity === CODEX_ACTIVITY.BLOCKED) {
    return { color: 0xff6f70, pixels: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2], [1, 3], [1, 4]] };
  }
  if (activity === CODEX_ACTIVITY.DISCONNECTED) {
    return { color: 0x91aabb, pixels: [[0, 0], [0, 1], [1, 2], [3, 2], [4, 1], [4, 0]] };
  }
  return { color: 0, pixels: [] };
}
