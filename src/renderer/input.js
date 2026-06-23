/**
 * input.js — Input Manager
 *
 * Uses DOM events directly for reliable operation with Electron's
 * transparent window (setIgnoreMouseEvents + forward:true).
 *
 * Supports:
 *   - Left-click drag → PULLING → BOUNCING
 *   - Right-click drag on turtle → PULLEY_DRAG → PULLEY_PHYSICS (new throw model)
 *   - Right-click on empty space → Electron context menu
 */

import { VelocityTracker } from './velocity-tracker.js';

const PULL_THRESHOLD = 80;

export class InputManager {
  constructor({ pixiApp, sprite, stateMachine, physics }) {
    this.pixiApp = pixiApp;
    this.sprite = sprite;
    this.stateMachine = stateMachine;
    this.physics = physics;

    this._enabled = false;
    this._isDragging = false;
    this._destroyed = false;
    this._dragStart = { x: 0, y: 0 };
    this._dragOffset = { x: 0, y: 0 };
    this._dragVelocity = { x: 0, y: 0 }; // Track drag velocity for release
    this._lastDragPos = { x: 0, y: 0 };
    this._lastDragTime = 0;
    this._pullExceeded = false;
    this._lastPullExceeded = false;  // Saved value for BOUNCE_COMPLETE

    // ── Right-click (pulley / throw) drag state ──
    this._isRightDragging = false;
    this._rightDragStartX = 0;           // screen X where right-drag began
    this._rightDragStartY = 0;           // screen Y where right-drag began
    this._rightDragAnchorStart = 0;      // physics.screenAnchorX at drag start
    this._rightDragMoved = false;
    this._rightDragTime = 0;

    // ── VelocityTracker for right-click throw ──
    this._rightVelocityTracker = new VelocityTracker(3000);

    // Bind handlers
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
  }

  // Public getter for pullExceeded
  get pullExceeded() { return this._pullExceeded; }

  enable() {
    if (this._enabled || this._destroyed) return;
    this._enabled = true;
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('contextmenu', this._onContextMenu);
  }

  disable() {
    if (!this._enabled) return;
    this._enabled = false;
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('contextmenu', this._onContextMenu);
    this._resetDrag();
    this._resetRightDrag();
  }

  destroy() {
    this._destroyed = true;
    this.disable();
    this.pixiApp = null;
    this.sprite = null;
    this.stateMachine = null;
    this.physics = null;
  }

  // ── Hit test ──────────────────────────────────────────────────────────
  _isOverSprite(x, y) {
    if (!this.sprite) return false;
    const b = this.sprite.getBounds();
    return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
  }

  // ── Context Menu (default prevention) ────────────────────────────────

  _onContextMenu(e) {
    if (this._destroyed) return;
    // Always prevent default context menu — we handle right-click ourselves
    e.preventDefault();
  }

  // ── Event Handlers ────────────────────────────────────────────────────

  _onMouseDown(e) {
    if (this._destroyed) return;

    // ── Right button (button === 2) ──
    if (e.button === 2) {
      e.preventDefault();

      if (this._isOverSprite(e.clientX, e.clientY)) {
        // Right-click on turtle → start throw drag
        const state = this.stateMachine.getState();
        if (state !== 'IDLE' && state !== 'HOVER' && state !== 'PULLEY_MOMENTUM' && state !== 'PULLEY_PHYSICS') return;

        this._isRightDragging = true;
        this._rightDragStartX = e.clientX;
        this._rightDragStartY = e.clientY;
        this._rightDragAnchorStart = this.physics.screenAnchorX;
        this._rightDragMoved = false;
        this._rightDragTime = performance.now();

        // Initialize VelocityTracker for throw
        this._rightVelocityTracker.clear();
        this._rightVelocityTracker.addSample(e.clientX, e.clientY);

        // Start physics drag — turtle follows mouse
        this.physics.startDrag(e.clientX, e.clientY);

        window.electronAPI.setIgnoreMouseEvents(false);
        this.stateMachine.transition('RIGHT_CLICK_TURTLE');

        console.log('[Input] THROW_DRAG started at', e.clientX, e.clientY,
          'anchorX=', this.physics.screenAnchorX.toFixed(3));
      }
      return;
    }

    // ── Left button (button === 0) ──
    if (e.button !== 0) return;
    const state = this.stateMachine.getState();
    if (state !== 'IDLE' && state !== 'HOVER') return;
    if (!this._isOverSprite(e.clientX, e.clientY)) return;

    this._isDragging = true;
    this._dragStart = { x: e.clientX, y: e.clientY };
    this._dragOffset = {
      x: this.sprite.x - e.clientX,
      y: this.sprite.y - e.clientY,
    };
    this._dragVelocity = { x: 0, y: 0 };
    this._lastDragPos = { x: e.clientX, y: e.clientY };
    this._lastDragTime = performance.now();
    this._pullExceeded = false;
    this._pullTarget = { x: this.sprite.x, y: this.sprite.y };

    // Notify main process to disable mouse passthrough
    window.electronAPI.setIgnoreMouseEvents(false);
    
    this.stateMachine.transition('LEFT_CLICK_TURTLE');
    // No need to expand window - it's already full-screen

    console.log('[Input] PULLING started at', e.clientX, e.clientY);
  }

  _onMouseMove(e) {
    if (this._destroyed) return;

    // ── Right-button throw drag ──
    if (this._isRightDragging) {
      const state = this.stateMachine.getState();
      if (state !== 'PULLEY_DRAG') return;

      // Track if mouse moved (for distinguishing click vs drag)
      const dx = e.clientX - this._rightDragStartX;
      const dy = e.clientY - this._rightDragStartY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        this._rightDragMoved = true;
      }

      // Record velocity sample
      this._rightVelocityTracker.addSample(e.clientX, e.clientY);

      // Update physics drag — turtle follows mouse, rope constraint propagates
      const dragNow = performance.now();
      const dragDt = Math.min((dragNow - this._rightDragTime) / 1000, 0.033);
      this._rightDragTime = dragNow;
      this.physics.updateDrag(e.clientX, e.clientY, dragDt);

      return;
    }

    // ── Left-button pull drag ──
    if (!this._isDragging) return;
    if (this.stateMachine.getState() !== 'PULLING') return;

    // Track velocity for release physics
    const now = performance.now();
    const dt = (now - this._lastDragTime) / 1000;
    if (dt > 0) {
      this._dragVelocity.x = (e.clientX - this._lastDragPos.x) / dt;
      this._dragVelocity.y = (e.clientY - this._lastDragPos.y) / dt;
    }
    this._lastDragPos = { x: e.clientX, y: e.clientY };
    this._lastDragTime = now;

    // Move sprite to follow cursor
    // Store raw target; game loop applies rope constraint before positioning sprite
    this._pullTarget = {
      x: e.clientX + this._dragOffset.x,
      y: e.clientY + this._dragOffset.y,
    };

    // Log every 10 moves
    if (this._moveCount === undefined) this._moveCount = 0;
    this._moveCount++;
    if (this._moveCount % 10 === 0) {
      console.log(`[Input] MOVE: mouse(${e.clientX}, ${e.clientY}), sprite(${this.sprite.x.toFixed(0)}, ${this.sprite.y.toFixed(0)}), offset(${this._dragOffset.x}, ${this._dragOffset.y})`);
    }

    // Track pull distance
    const dx = e.clientX - this._dragStart.x;
    const dy = e.clientY - this._dragStart.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist >= PULL_THRESHOLD) {
      this._pullExceeded = true;
    }
  }

  _onMouseUp(e) {
    if (this._destroyed) return;

    // ── Right button release ──
    if (e.button === 2) {
      if (this._isRightDragging) {
        this._isRightDragging = false;

        if (!this._rightDragMoved) {
          // No movement → this was a click, show context menu
          window.electronAPI.showContextMenu();
          this.stateMachine.transition('RIGHT_RELEASE');
        } else {
          // Mouse moved → this was a throw drag
          const state = this.stateMachine.getState();
          if (state === 'PULLEY_DRAG') {
            // Transfer mouse velocity to turtle via physics.release()
            this.physics.release();

            // Log the velocity
            const { vx, vy } = this._rightVelocityTracker.getVelocity();
            console.log('[Input] THROW_RELEASED, velocity=',
              `vx=${vx.toFixed(0)}, vy=${vy.toFixed(0)}`);

            // Restore mouse passthrough so blank-area clicks don't interfere
            window.electronAPI.setIgnoreMouseEvents(true);

            // Transition to PULLEY_PHYSICS (physics simulation state)
            this.stateMachine.transition('RIGHT_RELEASE');
          }
        }
      }
      return;
    }

    // ── Left button release ──
    if (e.button !== 0) return;
    if (!this._isDragging) return;
    this._isDragging = false;

    if (this.stateMachine.getState() === 'PULLING') {
      console.log('[Input] PULLING released, pullExceeded:', this._pullExceeded);
      // Save pullExceeded before reset for BOUNCE_COMPLETE transition
      this._lastPullExceeded = this._pullExceeded;
      this.stateMachine.transition('LEFT_RELEASE', { 
        pullExceeded: this._pullExceeded,
        velocity: { ...this._dragVelocity }
      });
      // Restore mouse passthrough
      window.electronAPI.setIgnoreMouseEvents(true);
    }

    // No need to restore window - it's already full-screen
    this._resetDrag();
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  _resetDrag() {
    this._isDragging = false;
    this._dragStart = { x: 0, y: 0 };
    this._dragOffset = { x: 0, y: 0 };
    this._dragVelocity = { x: 0, y: 0 };
    this._pullExceeded = false;
    this._pullTarget = null;  // raw target during PULLING
  }

  _resetRightDrag() {
    this._isRightDragging = false;
    this._rightDragStartX = 0;
    this._rightDragStartY = 0;
    this._rightDragAnchorStart = 0;
    this._rightDragMoved = false;
    this._rightVelocityTracker.clear();
  }

  // Note: _expandWindow() and _restoreWindow() were removed — they referenced
  // undefined constants (EXPANDED_HEIGHT, DEFAULT_HEIGHT) and were never called.
  // The window is already full-screen; no resizing is needed.
}