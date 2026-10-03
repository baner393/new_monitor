import { CODEX_ACTIVITY } from '../shared/codex-integration.js';

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

export function applyCodexMotionImpulse(physics, impulse) {
  const value = Number(impulse) || 0;
  if (!physics || !value) return false;
  if (physics.charmMode) {
    // The impulse is an angular-velocity change, matching pendulumOmega in
    // classic mode. Convert it to tangential px/s at the charm's current radius
    // so the turtle and the rope endpoint receive the same swing.
    const dx = physics.turtle.x - physics.pulley.x;
    const dy = physics.turtle.y - physics.pulley.y;
    const radius = Math.hypot(dx, dy);
    if (radius > 0.001) {
      physics.turtle.vx += value * dy;
      physics.turtle.vy -= value * dx;
    } else {
      const fallbackRadius = Math.max(1, physics.restRopeLength || physics.ropeLength || 1);
      physics.turtle.vx += value * fallbackRadius;
    }
  } else {
    physics.pendulumOmega += value;
  }
  return true;
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
    this.bodyAngle = 0;
    this.bodyOmega = 0;
    this.runningImpulseCycle = -1;
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
    this.runningImpulseCycle = -1;

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
    let bodyTarget = 0;
    let pendulumImpulse = 0;
    let effortDirection = 0;
    let workPulse = 0;

    if (this.sequence === 'blocked') {
      const dropLength = codexDropLength({ petHeight, baseY, viewportHeight });
      lengthOffset = blockedLengthAt(this.time, dropLength);
      if (this.time >= 1.35 && this.time < 4.35) {
        const step = Math.floor(((this.time - 1.35) / 3) * 12);
        const local = (((this.time - 1.35) / 3) * 12) % 1;
        bodyTarget = (step % 2 === 0 ? -1 : 1) * Math.sin(Math.min(local / 0.68, 1) * Math.PI) * 0.09;
        angleOffset = bodyTarget * 0.2;
      }
      if (this.time >= 4.8) this.sequence = '';
    } else if (this.sequence === 'ready') {
      const t = clamp(this.time / 0.9, 0, 1);
      lengthOffset = -Math.sin(t * Math.PI) * (1 - t * 0.35) * Math.min(18, petHeight * 0.25);
      bodyTarget = Math.sin(t * Math.PI * 2) * 0.055 * (1 - t);
      if (t >= 1) this.sequence = '';
    } else if (this.activity === CODEX_ACTIVITY.RUNNING) {
      const cycleDuration = 3.6;
      const cycle = Math.floor(this.time / cycleDuration);
      const local = this.time - cycle * cycleDuration;
      effortDirection = cycle % 2 === 0 ? 1 : -1;
      if (local < 0.55) {
        const preload = smoothstep(local / 0.55);
        bodyTarget = -effortDirection * 0.13 * preload;
        workPulse = preload * 0.45;
      } else if (local < 0.78) {
        const release = smoothstep((local - 0.55) / 0.23);
        bodyTarget = (-effortDirection * 0.13) * (1 - release) + effortDirection * 0.1 * release;
        workPulse = 0.45 + release * 0.55;
        if (this.runningImpulseCycle !== cycle) {
          this.runningImpulseCycle = cycle;
          pendulumImpulse = effortDirection * 0.22;
          this.emissions.push({ kind: 'running', count: 4, direction: effortDirection });
        }
      } else {
        const coast = clamp((local - 0.78) / 2.82, 0, 1);
        bodyTarget = effortDirection * Math.sin(coast * Math.PI * 3) * 0.035 * (1 - coast);
        workPulse = Math.max(0, 0.35 * (1 - coast));
      }
      const beat = cycle;
      if (beat !== this.lastRunningBeat) {
        this.lastRunningBeat = beat;
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

    const bodyAlpha = (bodyTarget - this.bodyAngle) * 42 - this.bodyOmega * 9;
    this.bodyOmega += bodyAlpha * safeDt;
    this.bodyAngle += this.bodyOmega * safeDt;
    this.bodyAngle = clamp(this.bodyAngle, -Math.PI / 15, Math.PI / 15);
    rotation = this.bodyAngle;

    return this.#frame({
      angleOffset,
      lengthOffset,
      rotation,
      pendulumImpulse,
      effortDirection,
      workPulse,
    });
  }

  drainEmissions() {
    return this.emissions.splice(0);
  }

  #frame({
    angleOffset = 0,
    lengthOffset = 0,
    rotation = 0,
    pendulumImpulse = 0,
    effortDirection = 0,
    workPulse = 0,
  } = {}) {
    return {
      activity: this.activity,
      angleOffset,
      lengthOffset,
      rotation,
      pendulumImpulse,
      effortDirection,
      workPulse,
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
