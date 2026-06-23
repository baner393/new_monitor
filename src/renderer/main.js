// Import blink state constants and modules at the top
import * as PIXI from 'pixi.js';
import { BaseTexture, SCALE_MODES } from 'pixi.js';
import idleSpriteUrl from '../../assets/sprites/idle.png';
import hoverSpriteUrl from '../../assets/sprites/hover.png';
import pullSpriteUrl from '../../assets/sprites/pull.png';
import happySpriteUrl from '../../assets/sprites/happy.png';
import painSpriteUrl from '../../assets/sprites/pain.png';
import blinkSpriteUrl from '../../assets/sprites/blink.png';
import { PhysicsEngine } from './physics.js';
import { RopeRenderer } from './rope.js';
import { StateMachine } from './state-machine.js';
import { InputManager } from './input.js';
import { Panel } from './panel.js';
import { SettingsPanel } from './settings.js';
import { SkinSelector } from './skin-selector.js';

// ── Font loading gate ─────────────────────────────────────────────────
async function waitForFonts() {
  try {
    await document.fonts.load('16px "Mojang"');
    await document.fonts.load('16px "Unifont"');
    await document.fonts.ready;
    console.log('[Fonts] Loaded: Mojang + Unifont');
  } catch (e) {
    console.warn('[Fonts] Loading failed, using fallbacks:', e);
  }
}

// ── Init ──────────────────────────────────────────────────────────────
async function init() {
  await waitForFonts();

// ── Pixel-art rendering settings ───────────────────────────────────────
BaseTexture.defaultOptions.scaleMode = SCALE_MODES.NEAREST;

// ── Constants ──────────────────────────────────────────────────────────
const ROPE_WIDTH = 4;
const TURTLE_SIZE = 64;
const THROW_SETTLE_THRESHOLD = 5; // px/s total speed to settle physics

// ── Init PixiJS Application ───────────────────────────────────────────
const DPR = window.devicePixelRatio || 1;

const pixiApp = new PIXI.Application({
  backgroundAlpha: 0,
  antialias: false,
  resolution: DPR,
  autoDensity: true,
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

// ── Load sprites ───────────────────────────────────────────────────────
let idleTexture  = PIXI.Texture.from(idleSpriteUrl);
let hoverTexture = PIXI.Texture.from(hoverSpriteUrl);
let pullTexture  = PIXI.Texture.from(pullSpriteUrl);
let happyTexture = PIXI.Texture.from(happySpriteUrl);
let painTexture  = PIXI.Texture.from(painSpriteUrl);
let blinkTexture = PIXI.Texture.from(blinkSpriteUrl);

// ── State Machine Presets ──────────────────────────────────────────────
//
// 位置: src/renderer/main.js → setSpriteTextureForState()
// 作用: 根据状态机当前状态，自动切换精灵纹理
//
// 状态映射表:
//   IDLE, HOVER           → idle.png   (正常站立)
//   PULLING, BOUNCING     → pull.png   (被拉拽/回弹)
//   PULLEY_DRAG/PHYSICS   → pull.png   (右键拖拽/物理模拟)
//   HAPPY, EXPANDING      → happy.png  (开心/展开面板)
//   PANEL_OPEN, COLLAPSING→ happy.png  (面板打开/收起)
//
// 添加/修改: 在 switch 语句中添加新的 case，或修改现有 case 的纹理
// 可用纹理: idleTexture, hoverTexture, pullTexture, happyTexture, painTexture

function setSpriteTextureForState(state) {
  switch (state) {
    case 'IDLE':
      bodySprite.texture = idleTexture;
      break;
    case 'HOVER':
      bodySprite.texture = hoverTexture;
      break;
    case 'PULLING':
    case 'BOUNCING':
    case 'PULLEY_DRAG':
    case 'PULLEY_PHYSICS':
      bodySprite.texture = pullTexture;
      break;
    case 'HAPPY':
    case 'EXPANDING':
    case 'PANEL_OPEN':
    case 'COLLAPSING':
      bodySprite.texture = happyTexture;
      break;
    case 'PAIN':
      bodySprite.texture = painTexture;
      break;
    default:
      bodySprite.texture = idleTexture;
  }
}

// ── Turtle Container (body + eye layer) ─────────────────────────────
const turtleContainer = new PIXI.Container();
turtleContainer.x = window.innerWidth / 2;
turtleContainer.y = 150;
turtleContainer.eventMode = 'static';
turtleContainer.cursor = 'pointer';
pixiApp.stage.addChild(turtleContainer);

// Body sprite (main texture)
const bodySprite = new PIXI.Sprite(idleTexture);
bodySprite.anchor.set(0.5, 0.5);
bodySprite.scale.set(2.5);
turtleContainer.addChild(bodySprite);

// Blink uses texture swap (blinkTexture has squinting eyes built in)
// No overlay needed

// ── Aliases for backward compatibility ─────────────────────────────
const sprite = turtleContainer; // InputManager uses sprite.x/y
Object.defineProperty(sprite, 'texture', {
  set(tex) { bodySprite.texture = tex; },
  get() { return bodySprite.texture; }
});

// ── GPU Panel ──────────────────────────────────────────────────────────
const panel = new Panel();
pixiApp.stage.addChild(panel.container);

// ── Settings Panel ─────────────────────────────────────────────────────
const settingsPanel = new SettingsPanel();
pixiApp.stage.addChild(settingsPanel.container);

// Listen for open-settings from context menu
window.electronAPI.onOpenSettings(() => {
  console.log('[Settings] Opening settings panel from context menu');
  if (!settingsPanel.isOpen && !settingsPanel.isAnimating) {
    // Position at center of screen
    settingsPanel.setPosition(window.innerWidth / 2, window.innerHeight / 2);
    settingsPanel.open();
  }
});

// Listen for settings-changed (applied from main process)
window.electronAPI.onSettingsChanged((settings) => {
  console.log('[Settings] Settings changed:', settings);
  applySettings(settings);
});

// ── Skin Selector ─────────────────────────────────────────────────────
const skinSelector = new SkinSelector();
document.body.appendChild(skinSelector.container);

// Load skins config
skinSelector.loadSkins('./assets/skins/skins.json');

// Reload skins when imported from custom mode
if (window.electronAPI?.onSkinsReloaded) {
  window.electronAPI.onSkinsReloaded(() => {
    console.log('[SkinSelector] Reloading skins after import...');
    skinSelector.reload();
  });
}

// Track current skin's baseSize for settings panel scaling
let currentSkinBaseSize = 24; // default turtle baseSize (matches PNG dimensions)

// Handle skin change
skinSelector.onSkinChange = (skinId, skinConfig) => {
  console.log(`[Skin] Switching to: ${skinId}`, skinConfig);
  const frames = skinConfig.frames || skinConfig.sprites;
  if (frames) {
    // Reload textures from new skin paths
    idleTexture  = PIXI.Texture.from(frames.idle);
    hoverTexture = PIXI.Texture.from(frames.hover);
    pullTexture  = PIXI.Texture.from(frames.pull);
    happyTexture = PIXI.Texture.from(frames.happy);
    painTexture  = PIXI.Texture.from(frames.pain);
    blinkTexture = PIXI.Texture.from(frames.blink_closed || frames.blink);
    // Apply idle texture immediately
    bodySprite.texture = idleTexture;

    // Apply skin-specific scale (normalize to target display size)
    const TARGET_SIZE = 60; // pixels
    const baseSize = skinConfig.baseSize || 24;
    currentSkinBaseSize = baseSize; // remember for settings
    const skinScale = TARGET_SIZE / baseSize;
    bodySprite.scale.set(skinScale);
    console.log(`[Skin] Scale: ${skinScale.toFixed(2)} (baseSize: ${baseSize})`);
  }
};

// Restore last selected skin
const savedSkin = localStorage.getItem('selectedSkin');
if (savedSkin) {
  skinSelector.currentSkin = savedSkin;
}

// Listen for open-skin-selector from context menu
window.electronAPI.onOpenSkinSelector(() => {
  console.log('[SkinSelector] Opening skin selector from context menu');
  if (!skinSelector.isOpen) {
    skinSelector.open();
  }
});

// Load saved settings on startup
(async () => {
  try {
    const saved = await window.electronAPI.settings.get();
    if (saved) {
      console.log('[Settings] Loaded saved settings:', saved);
      applySettings(saved);
    }
  } catch (err) {
    console.warn('[Settings] Failed to load settings on startup:', err);
  }
})();

/**
 * Apply settings to the physics engine and renderer.
 */
function applySettings(settings) {
  if (settings.gravity !== undefined) physics.gravity = settings.gravity;
  if (settings.damping !== undefined) physics.damping = settings.damping;
  if (settings.pulleyFriction !== undefined) physics.pulleyFriction = settings.pulleyFriction;
  if (settings.ropeStiffness !== undefined) physics.ropeStiffness = settings.ropeStiffness;
  if (settings.ropeDamping !== undefined) physics.ropeDamping = settings.ropeDamping;
  if (settings.bounceRestitution !== undefined) physics.ropeBounceRest = settings.bounceRestitution;
  if (settings.airDamping !== undefined) physics.airDamping = settings.airDamping;
  if (settings.ropeElasticity !== undefined) physics.ropeElasticity = settings.ropeElasticity;
  
  // Handle turtleSize - update sprite scale (respect current skin's baseSize)
  if (settings.turtleSize !== undefined) {
    const scale = settings.turtleSize / currentSkinBaseSize;
    bodySprite.scale.set(scale);
    console.log(`[Settings] Turtle size: ${settings.turtleSize}, scale: ${scale.toFixed(2)} (baseSize: ${currentSkinBaseSize})`);
  }
  
  // Handle ropeLength - update default rope length in physics
  if (settings.ropeLength !== undefined) {
    physics.ropeLength = settings.ropeLength;
    physics.restRopeLength = settings.ropeLength;
    console.log(`[Settings] Rope length: ${settings.ropeLength}`);
  }
}

// Click-outside detection for settings panel
document.addEventListener('mousedown', (e) => {
  if (!settingsPanel.isOpen) return;

  const c = settingsPanel.container;
  const px = c.x;
  const py = c.y;
  const pw = settingsPanel.width;
  const ph = settingsPanel.height;

  const insidePanel =
    e.clientX >= px &&
    e.clientX <= px + pw &&
    e.clientY >= py &&
    e.clientY <= py + ph;

  if (!insidePanel) {
    console.log('[Settings] Click outside → closing');
    settingsPanel._cancel(); // Cancel with restore
  }
}, true);

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
  const state = stateMachine.getState();
  if (state === 'PULLING' || state === 'PULLEY_DRAG') return;

  // Also keep mouse events when panel is open
  if (state === 'PANEL_OPEN' || state === 'EXPANDING' || state === 'COLLAPSING' || state === 'HAPPY') return;

  // Keep mouse events when settings panel is open
  if (settingsPanel.isOpen || settingsPanel.isAnimating) return;

  // Keep mouse events when skin selector is open
  if (skinSelector.isOpen) return;
  
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
  panel.update(data);
});

// ── Click-outside detection for closing the panel ──────────────────────
document.addEventListener('mousedown', (e) => {
  const state = stateMachine.getState();
  if (state !== 'PANEL_OPEN') return;

  // Don't close GPU panel if settings panel is open
  if (settingsPanel.isOpen || settingsPanel.isAnimating) return;

  // Check if click is inside the panel bounds
  const c = panel.container;
  const px = c.x;
  const py = c.y;
  const pw = panel.width;
  const ph = panel.height;

  const insidePanel =
    e.clientX >= px &&
    e.clientX <= px + pw &&
    e.clientY >= py &&
    e.clientY <= py + ph;

  if (!insidePanel) {
    console.log('[Panel] Click outside → COLLAPSING');
    stateMachine.transition('CLICK_OUTSIDE');
  }
}, true); // useCapture so it fires before InputManager

// ── Bounce animation state ─────────────────────────────────────────────
let bounceStartPos = null;
let bounceTime = 0;
const BOUNCE_DURATION = 0.8;
const MOMENTUM_STOP_THRESHOLD = 0.0005; // velocity below this → stop

// ── Idle animation state (breathing + blinking) ─────────────────────
let breathTime = 0;
let blinkTimer = 0;
let nextBlinkAt = 3 + Math.random() * 2; // 3-5 seconds
let isBlinking = false;
let _wasOverSprite = false;  // Hover tracking
let _painCooldown = 0;      // Collision cooldown to prevent spam
let _showPainTimer = 0;     // Pain texture overlay (seconds remaining)
let blinkProgress = 0;
const BLINK_DURATION = 0.15; // 150ms

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
  
  // Target position (pendulum at user-configured rest rope length)
  const anchorX = physics.screenAnchorX * window.innerWidth;
  const anchorY = 0;
  const restLen = physics.restRopeLength;
  const targetX = anchorX + Math.sin(physics.pendulumAngle) * restLen;
  const targetY = anchorY + Math.cos(physics.pendulumAngle) * restLen;
  
  // Interpolate with oscillation
  const currentX = targetX + (bounceStartPos.x - targetX) * oscillation * (1 - t);
  const currentY = targetY + (bounceStartPos.y - targetY) * oscillation * (1 - t);
  
  // Gradually return rope length to user-configured rest length
  physics.ropeLength = restLen + (physics.ropeLength - restLen) * (1 - t);
  
  if (t >= 1) {
    bounceStartPos = null;
    physics.ropeLength = restLen;
    return { x: targetX, y: targetY, done: true };
  }
  return { x: currentX, y: currentY, done: false };
}

// ── Listen for state transitions to capture bounce start ────────────────
let prevState = 'IDLE';

function onStateChange() {
  const newState = stateMachine.getState();
  setSpriteTextureForState(newState);

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

  // ── Panel transitions ────────────────────────────────────────────
  // BOUNCING → EXPANDING: pull exceeded threshold, open panel
  if (prevState === 'BOUNCING' && newState === 'EXPANDING') {
    console.log('[Panel] EXPANDING — showing panel + HAPPY sprite');
    // Disable click-through while panel is open
    window.electronAPI.setIgnoreMouseEvents(false);
    // Position panel below the sprite
    const anchorX = physics.screenAnchorX * window.innerWidth;
    panel.setPosition(anchorX, sprite.y + 80);
    panel.expand(() => {
      console.log('[Panel] Fully open → PANEL_OPEN');
      stateMachine.transition('PANEL_FULLY_OPEN');
    });
  }

  // PANEL_OPEN → COLLAPSING: close panel
  if (prevState === 'PANEL_OPEN' && newState === 'COLLAPSING') {
    console.log('[Panel] COLLAPSING');
    panel.collapse(() => {
      console.log('[Panel] Fully closed → IDLE');
      window.electronAPI.setIgnoreMouseEvents(true);
      isOverSprite = false;
      stateMachine.transition('PANEL_FULLY_CLOSED');
    });
  }
  
  // PULLEY_DRAG → PULLEY_PHYSICS transition: initialize throw physics
  if (prevState === 'PULLEY_DRAG' && newState === 'PULLEY_PHYSICS') {
    console.log(`[THROW] Physics started: turtle(${physics.turtle.x.toFixed(0)}, ${physics.turtle.y.toFixed(0)}), vel(${physics.turtle.vx.toFixed(0)}, ${physics.turtle.vy.toFixed(0)})`);
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
let fpsTime = 0;
let fpsCount = 0;

pixiApp.ticker.add((delta) => {
  const dt = delta / 60;
  elapsed += dt;
  frameCount++;
  fpsCount++;
  fpsTime += dt;
  if (fpsTime >= 1.0) {
    console.log(`[FPS] ${Math.round(fpsCount / fpsTime)}`);
    fpsCount = 0;
    fpsTime = 0;
  }

  // Check for state transitions
  onStateChange();
  
  const state = stateMachine.getState();

  // Inject context into physics
  physics.setContext({
    state,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    turtleSize: TURTLE_SIZE,
  });

  // Update physics (skipped during PULLING and BOUNCING)
  physics.updatePendulum(dt);
  physics.updatePulleyMomentum(dt);

  // Update panel animation
  panel.updateAnimation(dt);

  // Update settings panel animation
  settingsPanel.updateAnimation(dt);

  // Compute rope anchor (top of window)
  const anchorX = physics.screenAnchorX * window.innerWidth;
  const anchorY = 0;

  // Calculate pull distance BEFORE updating physics
  const pullDist = (state === 'PULLING') ? 
    Math.sqrt((sprite.x - anchorX)**2 + (sprite.y - anchorY)**2) - physics.restRopeLength : 0;

  // ── Idle animations (breathing + blinking) ───────────────────────
  if (state === 'IDLE' || state === 'HOVER') {
    breathTime += dt;

    // Breathing: gentle vertical scale oscillation on container (body + eyes)
    const baseScale = bodySprite.scale.x; // base scale from settings
    const breathAmount = Math.sin(breathTime * 2) * 0.05; // ±5% (visible)
    const breathScale = baseScale * (1 + breathAmount);
    turtleContainer.scale.y = breathScale / baseScale; // normalize to 1.0±5%

    // Blinking: swap to blinkTexture (squinting eyes) for 150ms
    blinkTimer += dt;
    if (!isBlinking && blinkTimer >= nextBlinkAt) {
      isBlinking = true;
      blinkProgress = 0;
      bodySprite.texture = blinkTexture; // squinting eyes
    } else if (isBlinking) {
      blinkProgress += dt;
      if (blinkProgress >= BLINK_DURATION) {
        isBlinking = false;
        blinkTimer = 0;
        nextBlinkAt = 3 + Math.random() * 2;
        bodySprite.texture = idleTexture; // eyes open
      }
    }
  } else {
    // Non-idle: reset animation state
    breathTime = 0;
    blinkTimer = 0;
    isBlinking = false;
    // Restore normal scale
    turtleContainer.scale.y = 1;
  }

  // State-specific behavior
  // ── Hover detection (IDLE ↔ HOVER) ──
  if (state === 'IDLE' || state === 'HOVER') {
    let mx = 0, my = 0;
    try {
      const events = pixiApp.renderer && pixiApp.renderer.events;
      const p = events && events.pointer;
      if (p && typeof p.x === 'number') { mx = p.x; my = p.y; }
    } catch (e) { /* ignore if events not available */ }
    const b = bodySprite.getBounds();
    const over = mx >= b.x && mx <= b.x + b.width && my >= b.y && my <= b.y + b.height;
    if (over && !_wasOverSprite) {
      _wasOverSprite = true;
      if (state === 'IDLE') { try { stateMachine.transition('TURTLE_HOVER'); } catch (e) {} }
    } else if (!over && _wasOverSprite) {
      _wasOverSprite = false;
      if (state === 'HOVER') { try { stateMachine.transition('TURTLE_LEAVE'); } catch (e) {} }
    }
    _wasOverSprite = over;
  } else {
    _wasOverSprite = false;
  }

  // ── Pain texture overlay (0.4s flash, no state machine change) ──
  if (_showPainTimer > 0) {
    bodySprite.texture = painTexture;
    _showPainTimer -= dt;
  }

  if (state === 'PULLING') {
    // During PULLING, use raw target from input, apply rope constraint
    const target = inputManager._pullTarget;
    const tx = target ? target.x : sprite.x;
    const ty = target ? target.y : sprite.y;
    const dx = tx - anchorX;
    const dy = ty - anchorY;
    const rawDist = Math.sqrt(dx * dx + dy * dy);

    // Rope soft spring constraint: resist beyond restRopeLength
    if (rawDist > physics.restRopeLength && physics.restRopeLength > 0) {
      const stretch = rawDist - physics.restRopeLength;
      const k = physics.ropeElasticity;
      physics.ropeLength = physics.restRopeLength + stretch / (1 + k * stretch);

      // Constrain sprite position to the effective rope length
      if (rawDist > 0) {
        const scale = physics.ropeLength / rawDist;
        sprite.x = anchorX + dx * scale;
        sprite.y = anchorY + dy * scale;
      }
    } else {
      physics.ropeLength = rawDist;
      // No constraint — sprite follows target freely
      sprite.x = tx;
      sprite.y = ty;
    }
    physics.pendulumAngle = Math.atan2(dx, dy);
    
  } else if (state === 'PULLEY_DRAG') {
    // During PULLEY_DRAG, turtle follows mouse via physics.updateDrag()
    // Sprite position comes from physics turtle
    sprite.x = physics.turtle.x;
    sprite.y = physics.turtle.y;

  } else if (state === 'PULLEY_PHYSICS') {
    // ── New throw physics simulation ──
    const totalEnergy = physics.updatePulleyPhysics(dt);

    // Update sprite from physics turtle
    sprite.x = physics.turtle.x;
    sprite.y = physics.turtle.y;

    // Check if physics has settled
    if (totalEnergy !== undefined && totalEnergy < THROW_SETTLE_THRESHOLD) {
      console.log('[THROW] Settled, transitioning to IDLE');
      stateMachine.transition('PHYSICS_SETTLED');
    }

    // Pain on collision: flash texture overlay for 0.4s
    if (physics._justCollided && _painCooldown <= 0) {
      physics._justCollided = false;
      _showPainTimer = 0.4;
      _painCooldown = 0.8; // 0.8s cooldown before next pain
    }
    // Decrement cooldown
    if (_painCooldown > 0) {
      _painCooldown -= dt;
    }

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
          pullExceeded: inputManager._lastPullExceeded 
        });
      }
    }

  } else if (state === 'EXPANDING' || state === 'PANEL_OPEN' || state === 'COLLAPSING' || state === 'HAPPY') {
    // Keep sprite at rest position while panel is active
    const pendulumX = anchorX + Math.sin(physics.pendulumAngle) * physics.ropeLength;
    const pendulumY = anchorY + Math.cos(physics.pendulumAngle) * physics.ropeLength;
    sprite.x = pendulumX;
    sprite.y = pendulumY;

    // Update panel position to follow sprite
    panel.setPosition(anchorX, sprite.y + 80);
    
  } else {
    // IDLE/HOVER - pendulum drives position
    const pendulumX = anchorX + Math.sin(physics.pendulumAngle) * physics.ropeLength;
    const pendulumY = anchorY + Math.cos(physics.pendulumAngle) * physics.ropeLength;
    sprite.x = pendulumX;
    sprite.y = pendulumY;
  }

  // Draw rope with natural sag (or tension-based for throw physics)
  let ropeAnchorX = anchorX;
  let ropeAnchorY = anchorY;

  if (state === 'PULLEY_PHYSICS' || state === 'PULLEY_DRAG') {
    // Use pulley position as anchor during throw physics
    ropeAnchorX = physics.pulley.x;
    ropeAnchorY = physics.pulley.y;
  }

  const sag = RopeRenderer.calcSagAmount(
    physics.ropeLength,
    physics.pendulumOmega,
    pullDist,
    state
  );

  // For throw physics, adjust sag based on rope tension
  let adjustedSag = sag;
  if (state === 'PULLEY_PHYSICS') {
    const dx = sprite.x - ropeAnchorX;
    const dy = sprite.y - ropeAnchorY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const stretch = Math.max(0, dist - physics.restRopeLength);
    const tension = stretch / physics.restRopeLength; // 0 ~ 1+
    // Higher tension → less sag (rope becomes taut)
    adjustedSag = sag * Math.max(0.1, 1 - tension * 0.8);
  }

  ropeRenderer.draw(ropeAnchorX, ropeAnchorY, sprite.x, sprite.y, adjustedSag, ROPE_WIDTH);

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

  // Debug: Draw pulley and turtle positions during throw physics
  if (state === 'PULLEY_PHYSICS' || state === 'PULLEY_DRAG') {
    // Pulley marker (red)
    debugGraphics.lineStyle(0);
    debugGraphics.beginFill(0xff0000, 0.8);
    debugGraphics.drawCircle(physics.pulley.x, physics.pulley.y, 5);
    debugGraphics.endFill();

    // Velocity vector (green line from turtle)
    if (state === 'PULLEY_PHYSICS') {
      const vScale = 0.05;
      debugGraphics.lineStyle(2, 0x00ff00, 0.6);
      debugGraphics.moveTo(sprite.x, sprite.y);
      debugGraphics.lineTo(
        sprite.x + physics.turtle.vx * vScale,
        sprite.y + physics.turtle.vy * vScale
      );
    }
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

} // end init

init();