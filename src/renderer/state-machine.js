/**
 * Turtle Monitor — Finite State Machine
 *
 * Pure-logic module (no UI dependencies).
 * Drives turtle interaction states for animation and behaviour control.
 *
 * States
 * ------
 *   IDLE             – default resting state
 *   HOVER            – cursor over turtle
 *   PULLING          – left-button held, dragging
 *   BOUNCING         – release / timeout → spring-back
 *   EXPANDING        – pull exceeded threshold → opening panel
 *   HAPPY            – (reserved for future use)
 *   PANEL_OPEN       – info panel fully visible
 *   COLLAPSING       – panel closing animation
 *   PULLEY_MOMENTUM  – physics-based momentum after release
 *   PULLEY_DRAG      – right-button held, dragging pulley
 *   PULLEY_PHYSICS   – right-click throw: turtle physics simulation
 *
 * Usage:
 *   import { StateMachine } from './state-machine.js';
 *   const sm = new StateMachine();
 *   sm.transition('TURTLE_HOVER');  // IDLE → HOVER
 *   sm.getState();                  // 'HOVER'
 *   sm.canTransition('TURTLE_LEAVE'); // true
 */

// ─── State Constants ────────────────────────────────────────────────

export const IDLE            = 'IDLE';
export const HOVER           = 'HOVER';
export const PULLING         = 'PULLING';
export const BOUNCING        = 'BOUNCING';
export const EXPANDING       = 'EXPANDING';
export const HAPPY           = 'HAPPY';
export const PANEL_OPEN      = 'PANEL_OPEN';
export const COLLAPSING      = 'COLLAPSING';
export const PULLEY_MOMENTUM = 'PULLEY_MOMENTUM';
export const PULLEY_DRAG     = 'PULLEY_DRAG';
export const PULLEY_PHYSICS  = 'PULLEY_PHYSICS';
export const PAIN            = 'PAIN';

/** All valid states as an array (handy for iteration / validation). */
export const ALL_STATES = [
  IDLE,
  HOVER,
  PULLING,
  BOUNCING,
  EXPANDING,
  HAPPY,
  PANEL_OPEN,
  COLLAPSING,
  PULLEY_MOMENTUM,
  PULLEY_DRAG,
  PULLEY_PHYSICS,
  PAIN,
];

// ─── Transition Table ───────────────────────────────────────────────
//
// Each key is a state; the value maps event names to either:
//   • a literal next-state string, or
//   • a function (context) => next-state string  (dynamic guard)

const TRANSITIONS = {
  [IDLE]: {
    TURTLE_HOVER:      HOVER,
    LEFT_CLICK_TURTLE: PULLING,
    RIGHT_CLICK_TURTLE: PULLEY_DRAG,
  },

  [HOVER]: {
    TURTLE_LEAVE:      IDLE,
    LEFT_CLICK_TURTLE: PULLING,
    RIGHT_CLICK_TURTLE: PULLEY_DRAG,
  },

  [PULLING]: {
    LEFT_RELEASE:      BOUNCING,
    TIMEOUT_5S:        BOUNCING,
  },

  [BOUNCING]: {
    BOUNCE_COMPLETE: (ctx) => (ctx && ctx.pullExceeded) ? EXPANDING : IDLE,
  },

  [EXPANDING]: {
    PANEL_FULLY_OPEN:  PANEL_OPEN,
  },

  // HAPPY state – shown when panel is expanding (sprite shows happy texture)
  [HAPPY]: {
    PANEL_FULLY_OPEN:  PANEL_OPEN,
    CLICK_OUTSIDE:     COLLAPSING,
  },

  [PANEL_OPEN]: {
    CLICK_OUTSIDE:     COLLAPSING,
  },

  [COLLAPSING]: {
    PANEL_FULLY_CLOSED: IDLE,
  },

  [PULLEY_MOMENTUM]: {
    MOMENTUM_STOPPED:   IDLE,
    LEFT_CLICK_TURTLE:  PULLING,
    RIGHT_CLICK_TURTLE: PULLEY_DRAG,
  },

  [PULLEY_DRAG]: {
    RIGHT_RELEASE:       PULLEY_PHYSICS,
    LEFT_CLICK_TURTLE:   PULLING,
  },

  [PULLEY_PHYSICS]: {
    PHYSICS_SETTLED:     IDLE,
    LEFT_CLICK_TURTLE:   PULLING,
    RIGHT_CLICK_TURTLE:  PULLEY_DRAG,
    TURTLE_HURT:         PAIN,
  },

  [PAIN]: {
    PAIN_TIMEOUT:        IDLE,
  },
};

// ─── StateMachine Class ─────────────────────────────────────────────

export class StateMachine {
  /**
   * @param {string} [initialState=IDLE] – starting state.
   */
  constructor(initialState = IDLE) {
    if (!TRANSITIONS[initialState]) {
      throw new Error(`StateMachine: unknown initial state "${initialState}"`);
    }
    this._state = initialState;
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Return the current state string.
   * @returns {string}
   */
  getState() {
    return this._state;
  }

  /**
   * Check whether `event` is a valid transition from the current state
   * (without actually performing it).
   *
   * @param {string} event
   * @returns {boolean}
   */
  canTransition(event) {
    const edges = TRANSITIONS[this._state];
    return edges ? event in edges : false;
  }

  /**
   * Attempt a state transition.
   *
   * @param {string}  event          – the event name (e.g. 'TURTLE_HOVER')
   * @param {Object}  [context={}]   – optional context bag passed to guard functions
   * @returns {string} the (possibly new) current state after transition
   * @throws {Error}  if the event is not valid in the current state
   */
  transition(event, context = {}) {
    const edges = TRANSITIONS[this._state];

    if (!edges || !(event in edges)) {
      throw new Error(
        `StateMachine: no transition for event "${event}" in state "${this._state}"`
      );
    }

    const target = edges[event];

    // Resolve dynamic guard (function) vs. literal string
    const nextState = typeof target === 'function' ? target(context) : target;

    // Validate that the guard returned a known state
    if (!TRANSITIONS[nextState]) {
      throw new Error(
        `StateMachine: guard for "${event}" returned unknown state "${nextState}"`
      );
    }

    this._state = nextState;
    return this._state;
  }

  /**
   * Reset to a given state (useful for testing / recovery).
   * @param {string} [state=IDLE]
   */
  reset(state = IDLE) {
    if (!TRANSITIONS[state]) {
      throw new Error(`StateMachine: cannot reset to unknown state "${state}"`);
    }
    this._state = state;
  }
}
