// Import blink state constants and modules at the top
import * as PIXI from 'pixi.js';
import { BaseTexture, SCALE_MODES } from 'pixi.js';
import './index.css';
const publicAssetUrl = (relativePath) => new URL(relativePath, window.location.href).href;
const idleSpriteUrl = publicAssetUrl('./assets/sprites/idle.png');
const hoverSpriteUrl = publicAssetUrl('./assets/sprites/hover.png');
const pullSpriteUrl = publicAssetUrl('./assets/sprites/pull.png');
const happySpriteUrl = publicAssetUrl('./assets/sprites/happy.png');
const painSpriteUrl = publicAssetUrl('./assets/sprites/pain.png');
const blinkSpriteUrl = publicAssetUrl('./assets/sprites/blink.png');
import { PhysicsEngine } from './physics.js';
import { RopeRenderer } from './rope.js';
import { StateMachine } from './state-machine.js';
import { InputManager } from './input.js';
import { Panel } from './panel.js';
import { SettingsPanel } from './settings.js';
import { ROPE_ELASTICITY_STEPS } from './settings.js';
import { SkinSelector } from './skin-selector.js';
import { CodexCompanion } from './codex-companion.js';
import { CodexMotionController, codexStatusSymbol } from './codex-motion.js';
import { PANEL_DRAG_CONTEXT, resolvePanelDragContext, resolvePanelDragSettledState } from './panel-drag-context.js';
import { CODEX_ACTIVITY } from '../shared/codex-integration.js';
import { resolveAmbientSwingEnabled } from '../shared/pet-settings-model.js';

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
  await window.electronAPI.initializeRendererInputSession();
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
let codexMood = 'idle';

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
      bodySprite.texture = codexMood === 'happy' ? happyTexture
        : codexMood === 'pain' ? painTexture
          : (codexMood === 'working' || codexMood === 'attention') ? hoverTexture : idleTexture;
      break;
    case 'HOVER':
      bodySprite.texture = codexMood === 'happy' ? happyTexture
        : codexMood === 'pain' ? painTexture : hoverTexture;
      break;
    case 'CODEX_CONFIG_OPENING':
    case 'CODEX_CONFIG_OPEN':
    case 'CODEX_CONFIG_CLOSING':
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

// Body sprite (main texture). The container is the rope/grip joint; the
// texture hangs below it so rotation has visible body inertia.
let currentGripPoint = { x: 0.5, y: 0.12 };
const bodySprite = new PIXI.Sprite(idleTexture);
bodySprite.anchor.set(currentGripPoint.x, currentGripPoint.y);
bodySprite.scale.set(2.5);
turtleContainer.addChild(bodySprite);

const codexMotion = new CodexMotionController();
const codexParticleGraphics = new PIXI.Graphics();
const codexStatusGraphics = new PIXI.Graphics();
const codexWorkGraphics = new PIXI.Graphics();
pixiApp.stage.addChild(codexParticleGraphics);
pixiApp.stage.addChild(codexWorkGraphics);
pixiApp.stage.addChild(codexStatusGraphics);
const codexParticles = [];
const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');

function spawnCodexParticles(kind, count, x, y) {
  if (reducedMotionQuery?.matches) return;
  const palette = {
    running: 0x66c9ff,
    needsInput: 0xffd166,
    ready: 0x69e0aa,
    blocked: 0xff6f70,
  };
  const color = palette[kind];
  if (!color) return;
  for (let index = 0; index < count; index++) {
    const angle = -Math.PI * (0.2 + Math.random() * 0.6);
    const speed = kind === 'ready' ? 24 + Math.random() * 28 : 10 + Math.random() * 18;
    codexParticles.push({
      x: Math.round(x + (Math.random() - 0.5) * 12),
      y: Math.round(y - 18 + (Math.random() - 0.5) * 8),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: kind === 'ready' ? 0.9 : 0.7,
      maxLife: kind === 'ready' ? 0.9 : 0.7,
      color,
      size: Math.random() > 0.55 ? 3 : 2,
    });
  }
  if (codexParticles.length > 20) codexParticles.splice(0, codexParticles.length - 20);
}

function updateCodexParticles(dt) {
  codexParticleGraphics.clear();
  for (let index = codexParticles.length - 1; index >= 0; index--) {
    const particle = codexParticles[index];
    particle.life -= dt;
    if (particle.life <= 0) {
      codexParticles.splice(index, 1);
      continue;
    }
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 12 * dt;
    codexParticleGraphics.beginFill(particle.color, Math.max(0, particle.life / particle.maxLife));
    codexParticleGraphics.drawRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
    codexParticleGraphics.endFill();
  }
}

function drawCodexStatus(activity, frame, x, y) {
  codexStatusGraphics.clear();
  const symbol = codexStatusSymbol(activity, frame);
  if (!symbol.pixels.length) return;
  const pixel = 3;
  const originX = Math.round(x - 42);
  const originY = Math.round(y - 42);
  codexStatusGraphics.beginFill(0x0d1420, 0.9);
  codexStatusGraphics.drawRect(originX - 3, originY - 3, 21, 21);
  codexStatusGraphics.endFill();
  codexStatusGraphics.beginFill(symbol.color, 1);
  for (const [px, py] of symbol.pixels) {
    codexStatusGraphics.drawRect(originX + px * pixel, originY + py * pixel, pixel, pixel);
  }
  codexStatusGraphics.endFill();
}

function drawCodexWorkLayer(activity, frame, x, y, pulse = 0, reducedMotion = false) {
  codexWorkGraphics.clear();
  if (activity !== CODEX_ACTIVITY.RUNNING) return;
  const originX = Math.round(x + 31);
  const originY = Math.round(y + 4);
  codexWorkGraphics.beginFill(0x0d1420, 0.94);
  codexWorkGraphics.drawRect(originX, originY, 22, 17);
  codexWorkGraphics.endFill();
  codexWorkGraphics.lineStyle(2, 0x66c9ff, 0.9);
  codexWorkGraphics.drawRect(originX + 2, originY + 2, 18, 11);
  codexWorkGraphics.lineStyle(0);
  const scan = reducedMotion ? 1 : Math.abs(Math.floor(frame / 2)) % 3;
  codexWorkGraphics.beginFill(0x69e0aa, 0.72 + Math.min(0.28, pulse * 0.28));
  codexWorkGraphics.drawRect(originX + 5 + scan * 4, originY + 5, 3, 3);
  codexWorkGraphics.drawRect(originX + 4, originY + 14, 14, 2);
  codexWorkGraphics.endFill();
}

// Blink uses texture swap (blinkTexture has squinting eyes built in)
// No overlay needed

// ── Aliases for backward compatibility ─────────────────────────────
const sprite = turtleContainer; // InputManager uses sprite.x/y
Object.defineProperty(sprite, 'texture', {
  set(tex) { bodySprite.texture = tex; },
  get() { return bodySprite.texture; }
});

// ── System Monitor Panel ───────────────────────────────────────────────
const panel = new Panel({
  onConfigurationCommit: (config) => window.electronAPI.monitor?.saveConfiguration(config),
  onRequestElevation: () => window.electronAPI.monitor?.requestElevation(),
});
pixiApp.stage.addChild(panel.container);
try {
  const monitorConfiguration = await window.electronAPI.monitor?.getConfiguration();
  if (monitorConfiguration) panel.setConfiguration(monitorConfiguration);
} catch (error) {
  console.warn('[Monitor] Failed to load panel configuration:', error);
  try {
    const monitorVisibility = await window.electronAPI.monitor?.getVisibility();
    if (monitorVisibility) panel.setVisibility(monitorVisibility);
  } catch (legacyError) {
    console.warn('[Monitor] Failed to load legacy visibility settings:', legacyError);
  }
}
window.addEventListener('beforeunload', () => panel.commitPendingConfiguration());

// Codex uses a DOM overlay for selectable long messages, text input and
// approvals. It shares the transparent window, but only its visible bounds
// participate in hit testing.
const codexCompanion = new CodexCompanion({
  onInteractionChange: () => requestAnimationFrame(() => synchronizeMousePassthroughFromSystem(true)),
  onConfigClosed: () => {
    if (stateMachine.getState() === 'CODEX_CONFIG_OPEN') {
      stateMachine.transition('CLICK_OUTSIDE');
    }
  },
  onMoodChange: (mood) => {
    codexMood = mood;
    const state = stateMachine.getState();
    if (state === 'IDLE' || state === 'HOVER') setSpriteTextureForState(state);
  },
});
await codexCompanion.initialize();
window.addEventListener('beforeunload', () => codexCompanion.destroy());

// ── Settings Panel ─────────────────────────────────────────────────────
const settingsPanel = new SettingsPanel();
const petBehaviorSettings = {
  ambientSwingEnabled: true,
  panelMoveStable: true,
};

// Listen for open-settings from context menu
function openSettingsPanel() {
  console.log('[Settings] Opening settings panel from context menu');
  if (!settingsPanel.isOpen && !settingsPanel.isAnimating) {
    // Position at center of screen
    settingsPanel.setPosition(window.innerWidth / 2, window.innerHeight / 2);
    settingsPanel.open();
  }
}

window.electronAPI.onOpenSettings(openSettingsPanel);
if (import.meta.env.DEV) window.__openSettingsPanelForDiagnostics = openSettingsPanel;

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
let skinLoadRevision = 0;

function loadTexture(url) {
  const texture = PIXI.Texture.from(url);
  if (texture.baseTexture.valid) return Promise.resolve(texture);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Texture load timed out')), 5000);
    texture.baseTexture.once('loaded', () => {
      clearTimeout(timeout);
      resolve(texture);
    });
    texture.baseTexture.once('error', (error) => {
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error('Texture load failed'));
    });
  });
}

// Handle skin change
skinSelector.onSkinChange = async (skinId, skinConfig) => {
  console.log(`[Skin] Switching to: ${skinId}`, skinConfig);
  const frames = skinConfig.frames || skinConfig.sprites;
  if (frames) {
    settingsPanel.setPreviewImage(frames.idle);
    const revision = ++skinLoadRevision;
    let textures;
    try {
      textures = await Promise.all([
        loadTexture(frames.idle),
        loadTexture(frames.hover || frames.idle),
        loadTexture(frames.pull || frames.idle),
        loadTexture(frames.happy || frames.idle),
        loadTexture(frames.pain || frames.idle),
        loadTexture(frames.blink_closed || frames.blink || frames.idle),
      ]);
    } catch (error) {
      console.error(`[Skin] Failed to load ${skinId}; keeping current texture:`, error);
      return;
    }
    if (revision !== skinLoadRevision) return;

    [idleTexture, hoverTexture, pullTexture, happyTexture, painTexture, blinkTexture] = textures;
    // Apply idle texture immediately
    bodySprite.texture = idleTexture;

    // Apply skin-specific scale (normalize to target display size)
    // Respect saved turtleSize setting instead of hardcoded value
    const baseSize = skinConfig.baseSize || 24;
    currentSkinBaseSize = baseSize; // remember for settings
    const grip = skinConfig.gripPoint || { x: 0.5, y: 0.12 };
    currentGripPoint = {
      x: Math.min(0.9, Math.max(0.1, Number(grip.x) || 0.5)),
      y: Math.min(0.45, Math.max(0, Number(grip.y) || 0.12)),
    };
    bodySprite.anchor.set(currentGripPoint.x, currentGripPoint.y);
    // Get saved turtleSize from settings panel or use default
    const savedTurtleSize = settingsPanel._values?.turtleSize || 64;
    const skinScale = savedTurtleSize / baseSize;
    bodySprite.scale.set(skinScale);
    console.log(`[Skin] Scale: ${skinScale.toFixed(2)} (baseSize: ${baseSize}, turtleSize: ${savedTurtleSize})`);

    // Texture dimensions can become valid after the first startup frames. Re-run
    // the transparent-window hit test now that the visible bounds are final.
    synchronizeMousePassthroughFromSystem(true);
  }
};

// 皮肤恢复已在 skin-selector.loadSkins() 中完成（纹理 + 缩放一并触发）
// 此处不再重复设置 currentSkin

// Listen for open-skin-selector from context menu
window.electronAPI.onOpenSkinSelector(() => {
  console.log('[SkinSelector] Opening skin selector from context menu');
  if (!skinSelector.isOpen) {
    skinSelector.open();
  }
});

/**
 * Load saved settings from main process and apply them.
 * Called once at startup.
 */
async function loadAndApplySettings() {
  try {
    const saved = await window.electronAPI.settings.get();
    if (saved) {
      console.log('[Settings] Loaded saved settings:', saved);
      applySettings(saved);
    }
  } catch (err) {
    console.warn('[Settings] Failed to load settings on startup:', err);
  }
}

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
  if (settings.ambientSwingEnabled !== undefined) {
    petBehaviorSettings.ambientSwingEnabled = settings.ambientSwingEnabled !== false;
  }
  if (settings.panelMoveStable !== undefined) {
    petBehaviorSettings.panelMoveStable = settings.panelMoveStable !== false;
    codexCompanion.setReadingStability(petBehaviorSettings.panelMoveStable);
  }
  if (settings.ropeElasticity !== undefined) {
    // 新版：档位(1~12) → 浮点值；旧版：直接是浮点值
    const step = settings.ropeElasticity;
    physics.ropeElasticity = (step >= 1 && step <= 12 && Number.isInteger(step))
      ? ROPE_ELASTICITY_STEPS[step - 1]
      : step;
    console.log(`[Settings] Rope elasticity: step=${step} → ${physics.ropeElasticity}`);
  }
  
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

  if (!settingsPanel.containsPoint(e.clientX, e.clientY)) {
    console.log('[Settings] Click outside → closing');
    settingsPanel._cancel(); // Cancel with restore
  }
}, true);

document.addEventListener('mousedown', (event) => {
  const insideCodex = codexCompanion.containsPoint(event.clientX, event.clientY);
  if (stateMachine.getState() === 'CODEX_CONFIG_OPEN' && !insideCodex) {
    stateMachine.transition('CLICK_OUTSIDE');
    return;
  }
  if (!insideCodex && codexCompanion.capturesOutsideClicks) {
    codexCompanion.closeTaskTray();
    document.activeElement?.blur?.();
    requestAnimationFrame(() => synchronizeMousePassthroughFromSystem(true));
  }
}, true);

// ── Input Manager ──────────────────────────────────────────────────────
const inputManager = new InputManager({
  pixiApp,
  sprite,
  stateMachine,
  physics,
  shouldIgnoreEvent: (event) => codexCompanion.ownsEvent(event),
});
inputManager.enable();

// ── Transparent click-through ──────────────────────────────────────────
let isOverSprite = false;
let lastMousePassthrough = true;

function synchronizeMousePassthrough(x, y, force = false) {
  const state = stateMachine.getState();
  if (state === 'PULLING' || state === 'PULLEY_DRAG') {
    window.electronAPI.setIgnoreMouseEvents(false);
    lastMousePassthrough = false;
    return false;
  }

  // Also keep mouse events when panel is open
  if (state === 'PANEL_OPEN' || state === 'EXPANDING' || state === 'COLLAPSING' || state === 'HAPPY') {
    window.electronAPI.setIgnoreMouseEvents(false);
    lastMousePassthrough = false;
    return false;
  }

  if (state === 'CODEX_CONFIG_OPENING' || state === 'CODEX_CONFIG_OPEN' || state === 'CODEX_CONFIG_CLOSING'
    || codexCompanion.capturesOutsideClicks) {
    window.electronAPI.setIgnoreMouseEvents(false);
    lastMousePassthrough = false;
    return false;
  }

  // Keep mouse events when settings panel is open
  if (settingsPanel.isOpen || settingsPanel.isAnimating) {
    window.electronAPI.setIgnoreMouseEvents(false);
    lastMousePassthrough = false;
    return false;
  }

  // Keep mouse events when skin selector is open
  if (skinSelector.isOpen) {
    window.electronAPI.setIgnoreMouseEvents(false);
    lastMousePassthrough = false;
    return false;
  }
  
  const bounds = sprite.getBounds();
  const overSprite =
    x >= bounds.x &&
    x <= bounds.x + bounds.width &&
    y >= bounds.y &&
    y <= bounds.y + bounds.height;
  const overCodex = codexCompanion.containsPoint(x, y);
  const ignore = !(overSprite || overCodex);
  const changed = overSprite !== isOverSprite;
  if (changed || force || ignore !== lastMousePassthrough) {
    isOverSprite = overSprite;
    lastMousePassthrough = ignore;
    window.electronAPI.setIgnoreMouseEvents(ignore);
    if (changed) sprite.emit(overSprite ? 'pointerover' : 'pointerout');
  }
  if (force) {
    console.log(`[Input] Cursor synchronized after load: ${ignore ? 'passthrough' : 'interactive'}`);
  }
  return ignore;
}

async function synchronizeMousePassthroughFromSystem(force = false, announceReady = false) {
  try {
    const cursor = await window.electronAPI.getCursorPosition();
    const ignore = cursor ? synchronizeMousePassthrough(cursor.x, cursor.y, force) : true;
    if (!cursor) window.electronAPI.setIgnoreMouseEvents(true);
    if (announceReady) window.electronAPI.markRendererInputReady(ignore);
    return ignore;
  } catch (error) {
    console.warn('[Input] Failed to synchronize cursor after load:', error);
    window.electronAPI.setIgnoreMouseEvents(true);
    if (announceReady) window.electronAPI.markRendererInputReady(true);
    return true;
  }
}

document.addEventListener('mousemove', (event) => {
  synchronizeMousePassthrough(event.clientX, event.clientY);
});

// A reload can happen while the cursor is stationary over the turtle. Wait for
// two rendered frames, then hand hit testing back to this renderer exactly
// once. Skin texture completion performs a second deterministic sync above.
requestAnimationFrame(() => requestAnimationFrame(() => {
  synchronizeMousePassthroughFromSystem(true, true);
}));
window.electronAPI.setMonitorActivity?.({ panelOpen: false });

if (window.electronAPI?.onResyncMousePassthrough) {
  window.electronAPI.onResyncMousePassthrough(() => {
    synchronizeMousePassthroughFromSystem(true);
  });
}

// ── System snapshot receiver ───────────────────────────────────────────
const waitForRenderedFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
let softRefreshRunning = false;

if (window.electronAPI?.onSoftRefresh) {
  window.electronAPI.onSoftRefresh(async ({ requestId } = {}) => {
    if (softRefreshRunning) return;
    softRefreshRunning = true;
    try {
      panel.commitPendingConfiguration();
      const state = stateMachine.getState();
      const transientState = [
        'PULLING', 'BOUNCING', 'EXPANDING', 'COLLAPSING', 'PULLEY_DRAG',
        'CODEX_CONFIG_OPENING', 'CODEX_CONFIG_OPEN', 'CODEX_CONFIG_CLOSING',
      ].includes(state);

      inputManager.resetInteraction();
      codexCompanion.settleForRefresh();
      if (transientState) {
        const panelOpen = panel.settleForRefresh();
        window.electronAPI.setMonitorActivity?.({ panelOpen });
        settingsPanel.settleForRefresh();
        const recoveredState = panelOpen ? 'PANEL_OPEN' : 'IDLE';
        stateMachine.reset(recoveredState);
        prevState = recoveredState;
        setSpriteTextureForState(recoveredState);
        bounceStartPos = null;
        ropeReturnActive = false;
        restoreAttachedPanelDragPhysics();
      }

      window.electronAPI.requestSystemData();
      await waitForRenderedFrame();
      await waitForRenderedFrame();
      await synchronizeMousePassthroughFromSystem(true);
      window.electronAPI.completeSoftRefresh({ requestId, ok: true });
    } catch (error) {
      console.error('[Refresh] Soft refresh failed:', error);
      window.electronAPI.completeSoftRefresh({
        requestId,
        ok: false,
        error: error?.message || String(error),
      });
    } finally {
      softRefreshRunning = false;
    }
  });
}

window.electronAPI.onSystemData((data) => {
  panel.update(data);
});
window.electronAPI.requestSystemData();

// ── Click-outside detection for closing the panel ──────────────────────
document.addEventListener('mousedown', (e) => {
  const state = stateMachine.getState();
  if (state !== 'PANEL_OPEN') return;

  // Safety: ensure window captures mouse events so click-outside works
  window.electronAPI.setIgnoreMouseEvents(false);

  // Don't close the system panel if settings panel is open
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

// ── Rope return animation state ───────────────────────────────────────
let ropeReturnStartLen = 0;
let ropeReturnTime = 0;
const ROPE_RETURN_DURATION = 0.5; // 0.5s smooth transition
let ropeReturnActive = false;

function startRopeReturn() {
  ropeReturnStartLen = physics.ropeLength;
  ropeReturnTime = 0;
  ropeReturnActive = true;
}

function updateRopeReturn(dt) {
  if (!ropeReturnActive) return;
  ropeReturnTime += dt;
  const t = Math.min(ropeReturnTime / ROPE_RETURN_DURATION, 1);
  // Smoothstep: t²(3-2t) for buttery smooth easing
  const ease = t * t * (3 - 2 * t);
  physics.ropeLength = physics.restRopeLength + (ropeReturnStartLen - physics.restRopeLength) * (1 - ease);
  if (t >= 1) {
    physics.ropeLength = physics.restRopeLength;
    ropeReturnActive = false;
  }
}

// ── Attached-panel drag state (system monitor or Codex conversation) ─
let _panelDragContext = null;
let _panelDragStableApplied = false;
let _savedRopeStiffness = 500;    // restore after panel drag
let _savedAirDamping = 0.98;      // restore after panel drag

function restoreAttachedPanelDragPhysics() {
  if (_panelDragStableApplied) {
    physics.ropeStiffness = _savedRopeStiffness;
    physics.airDamping = _savedAirDamping;
  }
  _panelDragContext = null;
  _panelDragStableApplied = false;
}

// ── Idle animation state (breathing + blinking) ─────────────────────
let breathTime = 0;
let blinkTimer = 0;
let nextBlinkAt = 3 + Math.random() * 2; // 3-5 seconds
let isBlinking = false;
let _wasOverSprite = false;  // Hover tracking
let _painCooldown = 0;      // Collision cooldown to prevent spam
let _showPainTimer = 0;     // Pain texture overlay (seconds remaining)
let blinkProgress = 0;
let codexMotionWasEnabled = false;
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
  const anchorY = 50; // Must match game loop anchorY (window offset compensation)
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
  if (newState === prevState) return;
  setSpriteTextureForState(newState);

  // Capture bounce start position on PULLING → BOUNCING transition
  if (prevState === 'PULLING' && newState === 'BOUNCING') {
    startBounce(sprite.x, sprite.y);
    // Calculate pendulumAngle from actual pull end position
    const anchorX = physics.screenAnchorX * window.innerWidth;
    const anchorY = 50; // Must match game loop anchorY (window offset compensation)
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
    window.electronAPI.setMonitorActivity?.({ panelOpen: true });
    // Position panel below the sprite
    const anchorX = physics.screenAnchorX * window.innerWidth;
    panel.setPosition(anchorX, sprite.y + 80);
    panel.expand(() => {
      console.log('[Panel] Fully open → PANEL_OPEN');
      stateMachine.transition('PANEL_FULLY_OPEN');
    });
  }

  if (prevState === 'BOUNCING' && newState === 'CODEX_CONFIG_OPENING') {
    window.electronAPI.setIgnoreMouseEvents(false);
    codexCompanion.openConfig();
    stateMachine.transition('CODEX_CONFIG_OPENED');
  }

  if (newState === 'CODEX_CONFIG_CLOSING') {
    codexCompanion.closeConfig({ notify: false });
    stateMachine.transition('CODEX_CONFIG_CLOSED');
  }

  if (prevState === 'CODEX_CONFIG_CLOSING' && newState === 'IDLE') {
    synchronizeMousePassthroughFromSystem(true);
  }

  // PANEL_OPEN → COLLAPSING: close panel
  if (prevState === 'PANEL_OPEN' && newState === 'COLLAPSING') {
    console.log('[Panel] COLLAPSING');
    panel.collapse(() => {
      console.log('[Panel] Fully closed → IDLE');
      window.electronAPI.setIgnoreMouseEvents(true);
      isOverSprite = false;
      window.electronAPI.setMonitorActivity?.({ panelOpen: false });
      stateMachine.transition('PANEL_FULLY_CLOSED');
    });
  }
  
  // PULLEY_DRAG → PULLEY_PHYSICS transition: initialize throw physics
  if (prevState === 'PULLEY_DRAG' && newState === 'PULLEY_PHYSICS') {
    console.log(`[THROW] Physics started: turtle(${physics.turtle.x.toFixed(0)}, ${physics.turtle.y.toFixed(0)}), vel(${physics.turtle.vx.toFixed(0)}, ${physics.turtle.vy.toFixed(0)})`);
  }

  // PULLEY_PHYSICS → IDLE: sync pendulum angle from actual physical position
  // Prevents visual jump when switching from physical position to pendulum equation
  if (prevState === 'PULLEY_PHYSICS' && newState === 'IDLE') {
    const dx = physics.turtle.x - physics.pulley.x;
    const dy = physics.turtle.y - physics.pulley.y;
    physics.pendulumAngle = Math.atan2(dx, dy);
    physics.pendulumOmega = Math.sqrt(physics.turtle.vx * physics.turtle.vx + physics.turtle.vy * physics.turtle.vy) / physics.ropeLength;
    // Start 0.5s rope return animation (smoothly brings ropeLength to restRopeLength)
    startRopeReturn();
    console.log(`[PHYSICS→IDLE] Synced angle=${physics.pendulumAngle.toFixed(3)}, len=${physics.ropeLength.toFixed(0)}`);
  }

  // PULLEY_MOMENTUM → IDLE: also start rope return animation
  if (prevState === 'PULLEY_MOMENTUM' && newState === 'IDLE') {
    startRopeReturn();
    console.log(`[MOMENTUM→IDLE] Starting rope return`);
  }

  // PULLEY_DRAG with an attached panel → retain its return state and apply stable physics.
  if (newState === 'PULLEY_DRAG') {
    const monitorPanelOpen = ['PANEL_OPEN', 'EXPANDING', 'HAPPY', 'COLLAPSING'].includes(prevState);
    _panelDragContext = resolvePanelDragContext({
      monitorPanelOpen,
      codexConversationOpen: codexCompanion.isConversationOpen,
    });
  }
  if (_panelDragContext && newState === 'PULLEY_DRAG') {
    if (settingsPanel.getValue('panelMoveStable')) {
      _savedRopeStiffness = physics.ropeStiffness;
      _savedAirDamping = physics.airDamping;
      physics.ropeStiffness = 100;
      physics.airDamping = 0.9;
      _panelDragStableApplied = true;
      console.log(`[PanelDrag] ${_panelDragContext} attached, stable params: stiffness=100, damping=0.9`);
    } else {
      console.log(`[PanelDrag] ${_panelDragContext} attached, using current physics settings (stable mode off)`);
    }
  }

  if (_panelDragContext && prevState === 'PULLEY_DRAG' && newState === 'PULLEY_PHYSICS') {
    console.log(`[PanelDrag] Physics started with ${_panelDragContext} attached`);
  }
  if (_panelDragContext && prevState === 'PULLEY_PHYSICS'
      && newState === resolvePanelDragSettledState(_panelDragContext)) {
    const settledContext = _panelDragContext;
    restoreAttachedPanelDragPhysics();
    window.electronAPI.setIgnoreMouseEvents(false);
    console.log(`[PanelDrag] ${settledContext} settled, physics restored`);
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

  physics.ambientSwingEnabled = resolveAmbientSwingEnabled(
    petBehaviorSettings,
    codexCompanion.isReadingConversationOpen,
  );

  // Update physics (skipped during PULLING and BOUNCING)
  physics.updatePendulum(dt);
  physics.updatePulleyMomentum(dt);

  // Update panel animation
  panel.updateAnimation(dt);

  // Update settings panel animation
  settingsPanel.updateAnimation(dt);

  // Compute rope anchor (top of window; offset 50px down because window extends 50px above screen to hide white border)
  const anchorX = physics.screenAnchorX * window.innerWidth;
  const anchorY = 50;

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
        setSpriteTextureForState(state); // eyes open, preserving Codex activity mood
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

    // Panel follow: keep panel at turtle position during panel drag
    if (_panelDragContext === PANEL_DRAG_CONTEXT.MONITOR && panel.isOpen) {
      panel.setPosition(physics.pulley.x, sprite.y + 80);
    }

  } else if (state === 'PULLEY_PHYSICS') {
    // ── New throw physics simulation ──
    const totalEnergy = physics.updatePulleyPhysics(dt);

    // Update sprite from physics turtle
    sprite.x = physics.turtle.x;
    sprite.y = physics.turtle.y;

    // Panel follow during panel drag physics
    if (_panelDragContext === PANEL_DRAG_CONTEXT.MONITOR && panel.isOpen) {
      panel.setPosition(physics.pulley.x, sprite.y + 80);
    }

    // Check if physics has settled
    if (totalEnergy !== undefined && totalEnergy < THROW_SETTLE_THRESHOLD) {
      if (_panelDragContext) {
        const settledState = resolvePanelDragSettledState(_panelDragContext);
        if (settledState === 'PANEL_OPEN') stateMachine.reset(settledState);
        else stateMachine.transition('PHYSICS_SETTLED');
        console.log(`[PanelDrag] ${_panelDragContext} settled → ${settledState}`);
      } else {
        console.log('[THROW] Settled, transitioning to IDLE');
        stateMachine.transition('PHYSICS_SETTLED');
      }
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
    // Rope return: 0.5s smoothstep animation to default length
    updateRopeReturn(dt);
    const pendulumX = anchorX + Math.sin(physics.pendulumAngle) * physics.ropeLength;
    const pendulumY = anchorY + Math.cos(physics.pendulumAngle) * physics.ropeLength;
    sprite.x = pendulumX;
    sprite.y = pendulumY;
  }

  const codexMotionEnabled = (state === 'IDLE' || state === 'HOVER')
    && !settingsPanel.isOpen
    && !settingsPanel.isAnimating
    && !skinSelector.isOpen
    && !codexCompanion.pausesPetMotion;
  if (!codexMotionEnabled && codexMotionWasEnabled) codexMotion.cancelSequence();
  codexMotionWasEnabled = codexMotionEnabled;
  codexMotion.setState(codexCompanion.activity, codexCompanion.motionEventKey);
  const motionFrame = codexMotion.update(dt, {
    enabled: codexMotionEnabled,
    reducedMotion: reducedMotionQuery?.matches === true,
    petHeight: bodySprite.height || TURTLE_SIZE,
    baseY: sprite.y,
    viewportHeight: window.innerHeight,
  });
  if (codexMotionEnabled) {
    if (motionFrame.pendulumImpulse) {
      physics.pendulumOmega += motionFrame.pendulumImpulse;
    }
    const baseDx = sprite.x - anchorX;
    const baseDy = sprite.y - anchorY;
    const baseLength = Math.sqrt(baseDx * baseDx + baseDy * baseDy);
    const displayAngle = Math.atan2(baseDx, baseDy) + motionFrame.angleOffset;
    const displayLength = Math.max(1, baseLength + motionFrame.lengthOffset);
    sprite.x = anchorX + Math.sin(displayAngle) * displayLength;
    sprite.y = anchorY + Math.cos(displayAngle) * displayLength;
    bodySprite.rotation = motionFrame.rotation;
  } else {
    bodySprite.rotation = 0;
  }
  bodySprite.x = 0;
  bodySprite.y = 0;
  const codexBodyBounds = bodySprite.getBounds();
  const codexVisualX = codexBodyBounds.x + codexBodyBounds.width / 2;
  const codexVisualY = codexBodyBounds.y + codexBodyBounds.height / 2;
  for (const emission of codexMotion.drainEmissions()) {
    spawnCodexParticles(emission.kind, emission.count, codexVisualX, codexVisualY);
  }
  updateCodexParticles(dt);
  drawCodexWorkLayer(
    motionFrame.activity,
    motionFrame.symbolFrame,
    codexVisualX,
    codexVisualY,
    motionFrame.workPulse,
    reducedMotionQuery?.matches === true,
  );
  drawCodexStatus(motionFrame.activity, motionFrame.symbolFrame, codexVisualX, codexVisualY);

  const suppressCodexBubbles = [
    'EXPANDING', 'HAPPY', 'PANEL_OPEN', 'COLLAPSING',
    'CODEX_CONFIG_OPENING', 'CODEX_CONFIG_OPEN', 'CODEX_CONFIG_CLOSING',
  ].includes(state) || settingsPanel.isOpen || settingsPanel.isAnimating || skinSelector.isOpen;
  codexCompanion.setBubblesSuppressed(suppressCodexBubbles);
  codexCompanion.setAnchor(codexVisualX, codexVisualY);
  codexCompanion.updateFrame();
  if ((state === 'IDLE' || state === 'HOVER') && codexMood !== codexCompanion.mood) {
    codexMood = codexCompanion.mood;
    setSpriteTextureForState(state);
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

  // Load saved settings after full initialization
  loadAndApplySettings();

} // end init

init();
