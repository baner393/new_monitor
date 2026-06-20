import * as PIXI from 'pixi.js';
import { BaseTexture, SCALE_MODES } from 'pixi.js';
import idleSpriteUrl from '../../assets/sprites/idle.png';
import { PhysicsEngine, DEFAULT_ROPE_LENGTH } from './physics.js';
import { RopeRenderer } from './rope.js';
import { StateMachine } from './state-machine.js';
import { InputManager } from './input.js';

// ── Pixel-art rendering settings ───────────────────────────────────────
BaseTexture.defaultOptions.scaleMode = SCALE_MODES.NEAREST;

// ── Constants ──────────────────────────────────────────────────────────
const ROPE_WIDTH = 4;
const TURTLE_SIZE = 64;

// ── Init PixiJS Application ───────────────────────────────────────────
const pixiApp = new PIXI.Application({
  backgroundAlpha: 0,
  antialias: false,
  resolution: 1,
  roundPixels: true,
  width: window.innerWidth,
  height: window.innerHeight,
});

document.getElementById('app').appendChild(pixiApp.view);

// ── Module Instances ───────────────────────────────────────────────────
const physics = new PhysicsEngine();
const stateMachine = new StateMachine();
const ropeGraphics = new PIXI.Graphics();
const ropeRenderer = new RopeRenderer(ropeGraphics);

// ── Debug graphics ─────────────────────────────────────────────────────
const debugGraphics = new PIXI.Graphics();
pixiApp.stage.addChild(debugGraphics);

// ── Layer Structure ────────────────────────────────────────────────────
const ropeContainer = new PIXI.Container();
pixiApp.stage.addChild(ropeContainer);
ropeContainer.addChild(ropeGraphics);

// ── Load sprite ────────────────────────────────────────────────────────
const texture = PIXI.Texture.from(idleSpriteUrl);
const sprite = new PIXI.Sprite(texture);
sprite.anchor.set(0.5, 0.5);
sprite.scale.set(2.5);  // Scale up 24x24 sprite to ~60x60 pixels
// Position at top-center of screen
sprite.x = window.innerWidth / 2;
sprite.y = 150;  // Near top of screen
sprite.eventMode = 'static';
sprite.cursor = 'pointer';
pixiApp.stage.addChild(sprite);

// ── Input Manager ──────────────────────────────────────────────────────
const inputManager = new InputManager({
  pixiApp,
  sprite,
  stateMachine,
  physics,
});
inputManager.enable();

// ── Transparent click-through ──────────────────────────────────────────
let isOverSprite = false;

document.addEventListener('mousemove', (e) => {
  if (stateMachine.getState() === 'PULLING') return;
  
  const bounds = sprite.getBounds();
  const over =
    e.clientX >= bounds.x &&
    e.clientX <= bounds.x + bounds.width &&
    e.clientY >= bounds.y &&
    e.clientY <= bounds.y + bounds.height;

  if (over && !isOverSprite) {
    isOverSprite = true;
    window.electronAPI.setIgnoreMouseEvents(false);
    sprite.emit('pointerover');
  } else if (!over && isOverSprite) {
    isOverSprite = false;
    window.electronAPI.setIgnoreMouseEvents(true);
    sprite.emit('pointerout');
  }
});

window.electronAPI.setIgnoreMouseEvents(true);

// ── GPU data receiver ──────────────────────────────────────────────────
window.electronAPI.onGPUData((data) => {
  console.log('[GPU Data]', data);
});

// ── Bounce animation state ─────────────────────────────────────────────
let bounceStartPos = null;
let bounceTime = 0;
const BOUNCE_DURATION = 0.8;
const MOMENTUM_STOP_THRESHOLD = 0.0005; // velocity below this → stop

function startBounce(fromX, fromY) {
  bounceStartPos = { x: fromX, y: fromY };
  bounceTime = 0;
}

function updateBounce(dt) {
  if (!bounceStartPos) return null;
  
  bounceTime += dt;
  const t = Math.min(bounceTime / BOUNCE_DURATION, 1);
  
  // Spring-damped oscillation
  const decay = Math.exp(-t * 5);
  const oscillation = Math.cos(t * 12) * decay;
  
  // Target position (pendulum at default rope length)
  const anchorX = physics.screenAnchorX * window.innerWidth;
  const anchorY = 0;
  const targetX = anchorX + Math.sin(physics.pendulumAngle) * DEFAULT_ROPE_LENGTH;
  const targetY = anchorY + Math.cos(physics.pendulumAngle) * DEFAULT_ROPE_LENGTH;
  
  // Interpolate with oscillation
  const currentX = targetX + (bounceStartPos.x - targetX) * oscillation * (1 - t);
  const currentY = targetY + (bounceStartPos.y - targetY) * oscillation * (1 - t);
  
  // Gradually return rope length to default
  physics.ropeLength = DEFAULT_ROPE_LENGTH + (physics.ropeLength - DEFAULT_ROPE_LENGTH) * (1 - t);
  
  if (t >= 1) {
    bounceStartPos = null;
    physics.ropeLength = DEFAULT_ROPE_LENGTH;
    return { x: targetX, y: targetY, done: true };
  }
  return { x: currentX, y: currentY, done: false };
}

// ── Listen for state transitions to capture bounce start ────────────────
let prevState = 'IDLE';

function onStateChange() {
  const newState = stateMachine.getState();
  
  // Capture bounce start position on PULLING → BOUNCING transition
  if (prevState === 'PULLING' && newState === 'BOUNCING') {
    startBounce(sprite.x, sprite.y);
    // Calculate pendulumAngle from actual pull end position
    const anchorX = physics.screenAnchorX * window.innerWidth;
    const anchorY = 0;
    const dx = sprite.x - anchorX;
    const dy = sprite.y - anchorY;
    physics.pendulumAngle = Math.atan2(dx, dy);
    physics.ropeLength = Math.sqrt(dx * dx + dy * dy);
    physics.pendulumOmega = 0;
    console.log(`[BOUNCE] Start: sprite(${sprite.x.toFixed(0)}, ${sprite.y.toFixed(0)}), anchor(${anchorX.toFixed(0)}, ${anchorY}), angle=${physics.pendulumAngle.toFixed(3)}, dist=${physics.ropeLength.toFixed(0)}`);
  }
  
  // Log pulley state transitions
  if (newState === 'PULLEY_DRAG' && prevState !== 'PULLEY_DRAG') {
    console.log(`[PULLEY] DRAG started, anchorX=${physics.screenAnchorX.toFixed(3)}`);
  }
  if (newState === 'PULLEY_MOMENTUM' && prevState !== 'PULLEY_MOMENTUM') {
    console.log(`[PULLEY] MOMENTUM started, velocity=${physics.pulleyMomentumVelocity.toFixed(4)}`);
  }

  prevState = newState;
}

// ── Game Loop ──────────────────────────────────────────────────────────
let elapsed = 0;
let frameCount = 0;

pixiApp.ticker.add((delta) => {
  const dt = delta / 60;
  elapsed += dt;
  frameCount++;

  // Check for state transitions
  onStateChange();
  
  const state = stateMachine.getState();

  // Inject context into physics
  physics.setContext({
    state,
    windowWidth: window.innerWidth,
    turtleSize: TURTLE_SIZE,
  });

  // Update physics (skipped during PULLING and BOUNCING)
  physics.updatePendulum(dt);
  physics.updatePulleyMomentum(dt);

  // Compute rope anchor (top of window)
  const anchorX = physics.screenAnchorX * window.innerWidth;
  const anchorY = 0;

  // Calculate pull distance BEFORE updating physics
  const pullDist = (state === 'PULLING') ? 
    Math.sqrt((sprite.x - anchorX)**2 + (sprite.y - anchorY)**2) - DEFAULT_ROPE_LENGTH : 0;

  // State-specific behavior
  if (state === 'PULLING') {
    // During PULLING, sprite is controlled by InputManager
    const dx = sprite.x - anchorX;
    const dy = sprite.y - anchorY;
    physics.ropeLength = Math.sqrt(dx * dx + dy * dy);
    physics.pendulumAngle = Math.atan2(dx, dy);
    
  } else if (state === 'PULLEY_DRAG') {
    // During PULLEY_DRAG, anchor is being moved by right-drag (InputManager updates physics.screenAnchorX)
    // Sprite follows pendulum at current anchor
    const pendulumX = anchorX + Math.sin(physics.pendulumAngle) * physics.ropeLength;
    const pendulumY = anchorY + Math.cos(physics.pendulumAngle) * physics.ropeLength;
    sprite.x = pendulumX;
    sprite.y = pendulumY;

  } else if (state === 'PULLEY_MOMENTUM') {
    // Pendulum drives position; anchor is sliding via physics.updatePulleyMomentum
    const pendulumX = anchorX + Math.sin(physics.pendulumAngle) * physics.ropeLength;
    const pendulumY = anchorY + Math.cos(physics.pendulumAngle) * physics.ropeLength;
    sprite.x = pendulumX;
    sprite.y = pendulumY;

    // Check if momentum has decayed enough to stop
    if (Math.abs(physics.pulleyMomentumVelocity) < MOMENTUM_STOP_THRESHOLD) {
      physics.pulleyMomentumVelocity = 0;
      console.log('[PULLEY] MOMENTUM stopped');
      stateMachine.transition('MOMENTUM_STOPPED');
    }

  } else if (state === 'BOUNCING') {
    // Update bounce animation
    const result = updateBounce(dt);
    if (result) {
      sprite.x = result.x;
      sprite.y = result.y;
      
      if (result.done) {
        // Bounce complete - transition to IDLE or EXPANDING
        stateMachine.transition('BOUNCE_COMPLETE', { 
          pullExceeded: inputManager.pullExceeded 
        });
      }
    }
    
  } else {
    // IDLE/HOVER - pendulum drives position
    const pendulumX = anchorX + Math.sin(physics.pendulumAngle) * physics.ropeLength;
    const pendulumY = anchorY + Math.cos(physics.pendulumAngle) * physics.ropeLength;
    sprite.x = pendulumX;
    sprite.y = pendulumY;
  }

  // Draw rope with natural sag
  const sag = RopeRenderer.calcSagAmount(physics.ropeLength, physics.pendulumOmega, pullDist, state);
  ropeRenderer.draw(anchorX, anchorY, sprite.x, sprite.y, sag, ROPE_WIDTH);

  // Debug: Draw window boundary during PULLING
  debugGraphics.clear();
  if (state === 'PULLING') {
    debugGraphics.lineStyle(3, 0x00ff00, 0.7);
    debugGraphics.drawRect(0, 0, window.innerWidth, window.innerHeight);
    
    debugGraphics.lineStyle(0);
    debugGraphics.beginFill(0xff0000, 0.9);
    debugGraphics.drawCircle(anchorX, anchorY, 6);
    debugGraphics.endFill();
    
    debugGraphics.beginFill(0x0088ff, 0.9);
    debugGraphics.drawCircle(sprite.x, sprite.y, 6);
    debugGraphics.endFill();
  }

  // Log every 60 frames
  if (frameCount % 60 === 0) {
    console.log(`[GameLoop] State: ${state}, Window: ${window.innerWidth}x${window.innerHeight}, Turtle: (${sprite.x.toFixed(0)}, ${sprite.y.toFixed(0)})`);
  }
});

// ── Resize handler ─────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  pixiApp.renderer.resize(window.innerWidth, window.innerHeight);
});

console.log('🐢 Turtle Monitor renderer ready');
