// Import blink state constants and modules at the top
import * as PIXI from 'pixi.js';
import { BaseTexture, SCALE_MODES } from 'pixi.js';
import './index.css';
const publicAssetUrl = (assetPath) => {
  if (typeof assetPath !== 'string' || !assetPath.trim()) throw new TypeError('Asset path must be a non-empty string');
  if (/^(data:|file:|https?:\/\/)/i.test(assetPath)) return new URL(assetPath).href;
  if (window.location.protocol === 'file:') {
    return new URL(assetPath.replace(/^\/+/, ''), new URL('./', window.location.href)).href;
  }
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    return new URL(assetPath.replace(/^\/+/, '').replace(/^\.\//, ''), `${window.location.origin}/`).href;
  }
  return new URL(assetPath, window.location.href).href;
};
const idleSpriteUrl = publicAssetUrl('./assets/sprites/idle.png');
const hoverSpriteUrl = publicAssetUrl('./assets/sprites/hover.png');
const pullSpriteUrl = publicAssetUrl('./assets/sprites/pull.png');
const happySpriteUrl = publicAssetUrl('./assets/sprites/happy.png');
const painSpriteUrl = publicAssetUrl('./assets/sprites/pain.png');
const blinkSpriteUrl = publicAssetUrl('./assets/sprites/blink.png');
import { PhysicsEngine } from './physics.js';
import { RopeRenderer } from './rope.js';
import { StateMachine } from './state-machine.js';
import { InputManager, PET_HIT_PADDING, isEventOwnedByRoot, isPointWithinBounds } from './input.js';
import { Panel } from './panel.js';
import { SettingsPanel } from './settings.js';
import { ROPE_ELASTICITY_STEPS } from './settings.js';
import { SubscriptionPanel } from './subscription-panel.js';
import { OnboardingGuide } from './onboarding-guide.js';
import { SkinSelector } from './skin-selector.js';
import { CodexCompanion } from './codex-companion.js';
import { applyCodexMotionImpulse, CodexMotionController, codexStatusSymbol } from './codex-motion.js';
import { PANEL_DRAG_CONTEXT, resolvePanelDragContext, resolvePanelDragSettledState } from './panel-drag-context.js';
import { CODEX_ACTIVITY } from '../shared/codex-integration.js';
import { resolveAmbientSwingEnabled } from '../shared/pet-settings-model.js';
import { ANCHOR_MODES, DEFAULT_ROPE_LENGTHS } from '../shared/anchor-model.js';
import { resolveMousePassthrough } from './mouse-passthrough.js';
import { CharmAnchorSampler } from './charm-anchor.js';
import { createCharmMountSprite, CHARM_MOUNT_ANCHOR_OFFSET, resolveCharmMountPose } from './charm-mount.js';
import { buildFoilAssets, buildSlabTexture, buildSlabGeometry } from './charm-foil.js';
import { METAL_VERTEX, METAL_FRAGMENT } from './charm-metal.js';
import { createFlipState, updateFlip, applyFlip, syncLayerScales, knobsToFlipConfig, FLIP_DEFAULTS } from './charm-flip.js';
import { RingMenu } from './ring-menu.js';
import { preloadRingIconTextures } from './ring-icons.js';
import { charmRopeAttachment, ringRopeSag } from './ring-rope.js';

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
// 鼠标挂环（穿孔挂饰的金属环）：SVG 渐变纹理 Sprite，position 即绳锚点
// （环底）。系统光标（OS 硬件层）自然遮住环的左半——「穿在鼠标背后挂在
// 边缘」的遮挡关系由此形成。
const charmMountSprite = createCharmMountSprite();
pixiApp.stage.addChild(charmMountSprite);
let cursorMountState = { active: false, supported: false, mountOffset: CHARM_MOUNT_ANCHOR_OFFSET, ringScale: 1 };
window.electronAPI.cursorMount?.onState?.(state => { cursorMountState = state; });
window.electronAPI.cursorMount?.getState?.().then(state => { if (state) cursorMountState = state; }).catch(() => {});

// ── holo 箔层（暗场全息挂饰效果，随皮肤重建）────────────────────────
// 宠物平时是原色；摆动掠过反光相位时表面泛起暗场全息（近黑镜面 + 彩虹
// 条纹）与斜向光带，边缘套银虹彩描边。资产由 charm-foil.js 从皮肤 idle
// 帧生成；形状裁剪由 idle 纹理 Sprite 作 mask（ foil/band 各自引用）。
const flipState = createFlipState();
// 挂饰翻转配置（设置面板手感旋钮 → 底层参数；settings 广播时重建）
let flipConfig = { ...FLIP_DEFAULTS };
let charmHoloEnabled = true;
let prevMotion = 0;
const foilFx = {
  maskSprite: null, foil: null, band: null, edge: null,
  backTexture: null, backSheenTexture: null,
  slices: [], // 金属剪影切片（真厚度侧壁，随皮肤重建）
  frameH: 0, // 皮肤帧高（厚度侧棱/显示高度换算用）
  phase: Math.random() * Math.PI * 2, // 初始随机相位，避免多实例同闪
};
const foilFoilSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
const foilBandSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
const foilEdgeSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
const backSheenSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
const backFoilSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
const backBandSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
foilFoilSprite.visible = false;
foilBandSprite.visible = false;
foilEdgeSprite.visible = false;
backSheenSprite.visible = false;
backFoilSprite.visible = false;
backBandSprite.visible = false;
for (const reflection of [foilFoilSprite, foilBandSprite, backFoilSprite, backBandSprite]) {
  reflection.blendMode = PIXI.BLEND_MODES.SCREEN;
}
// 层序在材质重建时统一接线。

const SLAB_SLICE_COUNT = 14; // 切片堆叠层数（真厚度侧壁）

function rebuildFoilAssets(sourceImg, grip) {
  try {
    const assets = buildFoilAssets(sourceImg, grip);
    const foilTex = PIXI.Texture.from(assets.foil);
    const bandTex = PIXI.Texture.from(assets.band);
    const edgeTex = PIXI.Texture.from(assets.edge);
    const backTex = PIXI.Texture.from(assets.back, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    const backSheenTex = PIXI.Texture.from(assets.backSheen, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    // 纹理 = 皮肤帧 ×3；用 scale.y——applyFlip 每帧接管 scale.x（翻转压缩），重建时可能正处压缩态
    const displayScale = bodySprite.scale.y / 3;

    // 背板只保留皮肤轮廓，表情/眨眼帧不得写入金属背面。
    backSprite.texture = backTex;
    backSprite.anchor.set(assets.grip.x, assets.grip.y);
    backSprite.scale.set(displayScale);
    backSheenSprite.texture = backSheenTex;
    backSheenSprite.anchor.copyFrom(backSprite.anchor);
    backSheenSprite.scale.set(displayScale);
    foilFx.backTexture?.destroy(true);
    foilFx.backSheenTexture?.destroy(true);
    foilFx.backTexture = backTex;
    foilFx.backSheenTexture = backSheenTex;

    const maskSprite = new PIXI.Sprite(idleTexture);
    maskSprite.anchor.copyFrom(bodySprite.anchor);
    maskSprite.scale.copyFrom(bodySprite.scale);
    maskSprite.position.set(bodySprite.x, bodySprite.y);
    if (foilFx.maskSprite) foilFx.maskSprite.destroy();
    foilFx.maskSprite = maskSprite;
    turtleContainer.addChild(maskSprite);
    // 隐形 mask 必须用 renderable=false 而非 visible=false：
    // PIXI 7 的 Container.updateTransform 对 visible=false 的子节点直接
    // 跳过变换更新（child.visible && child.updateTransform），
    // 否则箔面/光带共用这个遮罩时，遮罩的世界坐标会冻结在创建时刻、
    // 宠物移动/旋转后 mask 仍停在原地，把已触发的光裁掉。
    maskSprite.renderable = false;

    if (foilFx.backMaskSprite) foilFx.backMaskSprite.destroy();
    const backMaskSprite = new PIXI.Sprite(idleTexture);
    backMaskSprite.anchor.copyFrom(bodySprite.anchor);
    backMaskSprite.scale.set(bodySprite.scale.y);
    backMaskSprite.renderable = false;
    foilFx.backMaskSprite = backMaskSprite;
    turtleContainer.addChild(backMaskSprite);

    foilFoilSprite.texture = foilTex;
    foilFoilSprite.anchor.set(assets.grip.x, assets.grip.y);
    foilFoilSprite.scale.set(displayScale);
    foilFoilSprite.position.set(0, 0);
    foilFoilSprite.mask = maskSprite;
    foilFoilSprite.visible = true;

    foilBandSprite.texture = bandTex;
    foilBandSprite.scale.set(displayScale);
    // band 纹理宽 = 2×精灵：顶部对齐精灵顶部（容器坐标 = -grip.y × 显示高）
    foilBandSprite.anchor.set(0, 0);
    const frameHeight = (assets.frameH || sourceImg.height) * 3;
    foilBandSprite.position.set(0, -assets.grip.y * frameHeight * displayScale);
    foilBandSprite.mask = maskSprite;
    foilBandSprite.visible = true;

    backFoilSprite.texture = foilTex;
    backFoilSprite.anchor.set(assets.grip.x, assets.grip.y);
    backFoilSprite.scale.set(displayScale);
    backFoilSprite.mask = backMaskSprite;
    backBandSprite.texture = bandTex;
    backBandSprite.anchor.set(0, 0);
    backBandSprite.scale.set(displayScale);
    backBandSprite.position.y = -assets.grip.y * frameHeight * displayScale;
    backBandSprite.mask = backMaskSprite;

    foilEdgeSprite.texture = edgeTex;
    // edge 纹理含 pad：精灵帧位于 pad 偏移处，anchor 换算对齐 grip 点
    const ax = (assets.pad + assets.grip.x * assets.size) / (assets.size + assets.pad * 2);
    const ay = (assets.pad + assets.grip.y * frameHeight) / (frameHeight + assets.pad * 2);
    foilEdgeSprite.anchor.set(ax, ay);
    foilEdgeSprite.scale.set(displayScale);
    foilEdgeSprite.position.set(bodySprite.x, bodySprite.y);

    // 行段网格覆盖完整深度，窄轮廓在90°也不会漏出两面之间的空隙。
    for (const old of foilFx.slices) {
      old.shader.destroy();
      old.destroy();
    }
    foilFx.slices = [];
    foilFx.slabTexture?.destroy(true);
    const slabCanvas = buildSlabTexture(sourceImg);
    const slabTex = PIXI.Texture.from(slabCanvas, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    foilFx.slabTexture = slabTex;
    const slabGeometry = buildSlabGeometry(slabCanvas, assets.grip);
    const metalProgram = PIXI.Program.from(METAL_VERTEX, METAL_FRAGMENT);
    for (let i = 0; i < SLAB_SLICE_COUNT; i++) {
      const slice = new PIXI.SimpleMesh(slabTex, slabGeometry.vertices.slice(),
        slabGeometry.uvs.slice(), slabGeometry.indices.slice());
      slice.geometry.addAttribute('aContourSlope', slabGeometry.slopes.slice(), 2);
      slice.geometry.addAttribute('aDepthCoordinate', slabGeometry.depthCoordinates.slice(), 1);
      slice.shader.destroy();
      slice.shader = new PIXI.MeshMaterial(slabTex, {
        program: metalProgram,
        uniforms: { uMetalYaw: new Float32Array([1, 0]), uMetalRotation: new Float32Array([1, 0]),
          uMetalDepth: (i + 0.5) / SLAB_SLICE_COUNT, uMetalHeight: slabCanvas.height,
          uMetalBandWidth: 1 / SLAB_SLICE_COUNT, uMetalDepthDirection: 1 },
      });
      slice.metalUniforms = slice.shader.uniforms;
      slice.slabVertices = slabGeometry.vertices;
      slice.scale.set(displayScale);
      slice.position.set(0, 0);
      slice.tint = 0xffffff;
      slice.visible = false;
      foilFx.slices.push(slice);
    }

    foilEdgeSprite.visible = true;
    foilFx.size = assets.size;
    foilFx.frameW = assets.frameW || assets.size;
    foilFx.frameH = assets.frameH || assets.size;
    // 层序修正（addChild 对已有子节点 = 移到顶层），底→顶：
    // 厚度切片 → 背板/背面高光 → 正面卡面 → 描边/箔/光带
    for (const slice of foilFx.slices) turtleContainer.addChild(slice);
    turtleContainer.addChild(backSprite);
    turtleContainer.addChild(backSheenSprite);
    turtleContainer.addChild(backFoilSprite);
    turtleContainer.addChild(backBandSprite);
    turtleContainer.addChild(bodySprite);
    turtleContainer.addChild(foilEdgeSprite);
    turtleContainer.addChild(foilFoilSprite);
    turtleContainer.addChild(foilBandSprite);
    syncLayerScales(foilLayers(), bodySprite.scale.y);
    console.log(`[CharmFoil] assets rebuilt (size ${assets.size})`);
  } catch (error) {
    console.error('[CharmFoil] asset build failed:', error);
  }
}

let prevTurtleVx = 0;
let prevTurtleVy = 0;
const charmAccel = { x: 0, y: 0 }; // 挂饰加速度（速度差分 + 平滑，重力链接驱动量）

// 闪卡全部层的统一视图（缩放同步用）
function foilLayers() {
  return {
    body: bodySprite, back: backSprite, backSheen: backSheenSprite, mask: foilFx.maskSprite,
    backFoil: backFoilSprite, backBand: backBandSprite, backMask: foilFx.backMaskSprite,
    foil: foilFoilSprite, band: foilBandSprite, edge: foilEdgeSprite,
    slices: foilFx.slices,
  };
}

function updateFoilFx(dt) {
  // 背面朝向时 applyFlip 会隐藏正面箔层；它不能成为更新早退条件，
  // 否则翻回正面前物理和可见性都会永久冻结。
  if (!foilFx.maskSprite || !foilFx.size) return;
  // 仅双面图案同步表情帧；金属模式始终使用独立背板。
  if (flipConfig.backMaterial === 'pattern') {
    backSprite.texture = bodySprite.texture;
    if (foilFx.backMaskSprite) foilFx.backMaskSprite.texture = bodySprite.texture;
  } else if (foilFx.backTexture) {
    backSprite.texture = foilFx.backTexture;
  }
  // 驱动量：挂饰用乌龟速度，经典用钟摆摆速
  const charmSpeed = Math.hypot(physics.turtle.vx, physics.turtle.vy);
  const pendSpeed = Math.abs(physics.pendulumOmega) * Math.max(20, physics.ropeLength);
  const motion = Math.max(charmSpeed, pendSpeed);
  const dirX = physics.turtle ? Math.max(-1, Math.min(1, physics.turtle.vx / 320)) : 0;

  // a = Δv/dt：重力 + 惯性力 + 向心力自动叠加在这个差分里
  if (Number.isFinite(dt) && dt > 0) {
    const rawAx = (physics.turtle.vx - prevTurtleVx) / dt;
    const rawAy = (physics.turtle.vy - prevTurtleVy) / dt;
    const k = Math.min(1, dt * 12);
    charmAccel.x += (rawAx - charmAccel.x) * k;
    charmAccel.y += (rawAy - charmAccel.y) * k;
  }
  prevTurtleVx = physics.turtle.vx;
  prevTurtleVy = physics.turtle.vy;

  const flip = updateFlip(flipState, dt, motion, dirX, isCharmMode() ? charmAccel : null, flipConfig);
  prevMotion = motion;

  const scale = bodySprite.scale.y; // 基准 scale（翻转只改 x）
  const displayW = (foilFx.frameW || currentSkinBaseSize) * scale;
  applyFlip(
    {
      body: bodySprite,
      back: backSprite,
      backSheen: backSheenSprite,
      backMask: foilFx.backMaskSprite,
      mask: foilFx.maskSprite,
      edge: foilEdgeSprite,
      slices: foilFx.slices,
      // 全息闪卡开关：关闭时不参与渲染映射（保留翻转与侧壁）
      foil: charmHoloEnabled ? foilFoilSprite : null,
      band: charmHoloEnabled ? foilBandSprite : null,
      backFoil: charmHoloEnabled ? backFoilSprite : null,
      backBand: charmHoloEnabled ? backBandSprite : null,
      container: turtleContainer,
    },
    flipState,
    {
      baseScale: scale,
      edgeBase: scale / 3, // 纹理 = 皮肤帧 ×3
      thickness: Math.max(2, Math.min(9, displayW * flipConfig.thicknessRatio)),
      span: displayW, // 光带扫动范围 = 精灵显示宽
      backMaterial: flipConfig.backMaterial,
      holoIntensity: flipConfig.holoIntensity,
    },
  );
}

// Body sprite (main texture). The container is the rope/grip joint; the
// texture hangs below it so rotation has visible body inertia.
let currentGripPoint = { x: 0.5, y: 0.12 };
const bodySprite = new PIXI.Sprite(idleTexture);
bodySprite.anchor.set(currentGripPoint.x, currentGripPoint.y);
bodySprite.scale.set(2.5);
// 背面由皮肤 alpha 生成金属背板，加载完成前不显示正面图案作为替代。
const backSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
backSprite.visible = false;
backSprite.anchor.copyFrom(bodySprite.anchor);
backSprite.scale.copyFrom(bodySprite.scale);
turtleContainer.addChild(backSprite);
turtleContainer.addChild(backSheenSprite);
turtleContainer.addChild(backFoilSprite);
turtleContainer.addChild(backBandSprite);
turtleContainer.addChild(bodySprite);
turtleContainer.addChild(foilEdgeSprite);
turtleContainer.addChild(foilFoilSprite);
turtleContainer.addChild(foilBandSprite);

if (import.meta.env.DEV) {
  window.__charmFlipDiagnostics = {
    flipState,
    charmAccel,
    foilFx,
    get flipConfig() { return flipConfig; },
    sprites: { back: backSprite, backSheen: backSheenSprite, edge: foilEdgeSprite, foil: foilFoilSprite, band: foilBandSprite, body: bodySprite },
  };
}

const codexMotion = new CodexMotionController();
const codexParticleGraphics = new PIXI.Graphics();
const codexStatusGraphics = new PIXI.Graphics();
const codexWorkGraphics = new PIXI.Graphics();
pixiApp.stage.addChild(codexParticleGraphics);
pixiApp.stage.addChild(codexWorkGraphics);
pixiApp.stage.addChild(codexStatusGraphics);

// ── Ring menu（环形菜单，最顶层）─────────────────────────────────────
preloadRingIconTextures();
const ringMenu = new RingMenu({
  renderer: pixiApp.renderer,
  getRadius: () => physics.restRopeLength,
  getPetClearance: () => bodySprite.height * (1 - currentGripPoint.y) + 36,
  getViewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
});
// The quiet dial sits behind the physical rope and pet; the interactive arc,
// buttons, and label remain above them, matching the HTML preview's depth.
pixiApp.stage.addChildAt(ringMenu.backgroundContainer, pixiApp.stage.getChildIndex(ropeContainer));
pixiApp.stage.addChild(ringMenu.container);
pixiApp.stage.addChild(ringMenu.labelContainer);
let ringWasActive = false;
let lastRingCenter = null;
let lastRingMountPosition = null;
let lastRingRopeAnchor = null;
let ringExit = null;
const charmMountBaseZIndex = pixiApp.stage.getChildIndex(charmMountSprite);
let charmMountRaisedForRing = false;
function setCharmMountRingLayer(raise) {
  if (raise === charmMountRaisedForRing) return;
  const currentIndex = pixiApp.stage.getChildIndex(charmMountSprite);
  const ringIndex = pixiApp.stage.getChildIndex(ringMenu.container);
  const targetIndex = raise
    ? ringIndex + (currentIndex < ringIndex ? 0 : 1)
    : charmMountBaseZIndex;
  pixiApp.stage.setChildIndex(charmMountSprite, Math.min(targetIndex, pixiApp.stage.children.length - 1));
  charmMountRaisedForRing = raise;
}
const codexParticles = [];
const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
ringMenu.setReducedMotion(reducedMotionQuery?.matches === true);
reducedMotionQuery?.addEventListener?.('change', (event) => ringMenu.setReducedMotion(event.matches));

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
if (import.meta.env.DEV) window.__codexCompanionForDiagnostics = codexCompanion;

// ── Settings Panel ─────────────────────────────────────────────────────
const onboardingGuide = new OnboardingGuide({
  settings: window.electronAPI.settings,
  isCharmMode: () => isCharmMode(),
  onVisibilityChange: () => requestAnimationFrame(() => synchronizeMousePassthroughFromSystem(true)),
});
const settingsPanel = new SettingsPanel({
  onReplayOnboarding: () => onboardingGuide.restart(),
  onVisibilityChange: () => requestAnimationFrame(() => synchronizeMousePassthroughFromSystem(true)),
});
const subscriptionPanel = new SubscriptionPanel({
  onVisibilityChange: () => requestAnimationFrame(() => synchronizeMousePassthroughFromSystem(true)),
});
const petBehaviorSettings = {
  ambientSwingEnabled: true,
  panelMoveStable: true,
};

// Listen for open-settings from context menu
function openSettingsPanel() {
  console.log('[Settings] Opening settings panel from context menu');
  if (subscriptionPanel.isOpen) subscriptionPanel.close();
  if (!settingsPanel.isOpen && !settingsPanel.isAnimating) {
    // Position at center of screen
    settingsPanel.setPosition(window.innerWidth / 2, window.innerHeight / 2);
    settingsPanel.open();
  }
}

window.electronAPI.onOpenSettings(openSettingsPanel);
if (import.meta.env.DEV) window.__openSettingsPanelForDiagnostics = openSettingsPanel;

function openSubscriptionPanel() {
  if (settingsPanel.isOpen) settingsPanel.close();
  subscriptionPanel.open();
  requestAnimationFrame(() => synchronizeMousePassthroughFromSystem(true));
}

window.electronAPI.onOpenSubscription(openSubscriptionPanel);
if (import.meta.env.DEV) window.__openSubscriptionPanelForDiagnostics = openSubscriptionPanel;

window.electronAPI.onOpenOnboarding(() => {
  if (settingsPanel.isOpen || settingsPanel.isAnimating) settingsPanel.close();
  if (subscriptionPanel.isOpen) subscriptionPanel.close();
  if (skinSelector.isOpen) skinSelector.close?.();
  codexCompanion.closeConfig?.({ notify: true });
  onboardingGuide.restart();
});
window.electronAPI.onContextMenuClosed(() => onboardingGuide.revealCompletion());
if (import.meta.env.DEV) window.__onboardingGuideForDiagnostics = onboardingGuide;

// Listen for settings-changed (applied from main process)
window.electronAPI.onSettingsChanged((settings) => {
  console.log('[Settings] Settings changed:', settings);
  applySettings(settings);
});

// ── Skin Selector ─────────────────────────────────────────────────────
const skinSelector = new SkinSelector({
  onVisibilityChange: () => requestAnimationFrame(() => synchronizeMousePassthroughFromSystem(true)),
});
document.body.appendChild(skinSelector.container);

// Load skins config
skinSelector.loadSkins(publicAssetUrl('./assets/skins/skins.json'));

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
    if (typeof frames.idle !== 'string' || !frames.idle.trim()) {
      console.error(`[Skin] Failed to load ${skinId}; idle asset path is missing`);
      return;
    }
    let idleUrl, hoverUrl, pullUrl, happyUrl, painUrl, blinkUrl;
    try {
      idleUrl = publicAssetUrl(frames.idle);
      hoverUrl = publicAssetUrl(frames.hover || frames.idle);
      pullUrl = publicAssetUrl(frames.pull || frames.idle);
      happyUrl = publicAssetUrl(frames.happy || frames.idle);
      painUrl = publicAssetUrl(frames.pain || frames.idle);
      blinkUrl = publicAssetUrl(frames.blink_closed || frames.blink || frames.idle);
    } catch (error) {
      console.error(`[Skin] Failed to load ${skinId}; invalid asset path:`, error);
      return;
    }
    settingsPanel.setPreviewImage(idleUrl);
    const revision = ++skinLoadRevision;
    let textures;
    try {
      textures = await Promise.all([
        loadTexture(idleUrl),
        loadTexture(hoverUrl),
        loadTexture(pullUrl),
        loadTexture(happyUrl),
        loadTexture(painUrl),
        loadTexture(blinkUrl),
      ]);
    } catch (error) {
      console.error(`[Skin] Failed to load ${skinId}; keeping current texture:`, error);
      return;
    }
    if (revision !== skinLoadRevision) return;

    [idleTexture, hoverTexture, pullTexture, happyTexture, painTexture, blinkTexture] = textures;
    // Apply idle texture immediately
    bodySprite.texture = idleTexture;
    backSprite.texture = PIXI.Texture.EMPTY;
    backSheenSprite.texture = PIXI.Texture.EMPTY;
    backSprite.visible = false;
    backSheenSprite.visible = false;

    // Apply skin-specific scale (normalize to target display size)
    // Respect saved turtleSize setting instead of hardcoded value
    const baseSize = skinConfig.baseSize || 24;
    currentSkinBaseSize = baseSize; // remember for settings
    const grip = skinConfig.gripPoint || { x: 0.5, y: 0.12 };
    currentGripPoint = {
      x: Math.min(0.9, Math.max(0.1, Number(grip.x) || 0.5)),
      y: Math.min(0.45, Math.max(0, Number(grip.y) || 0.12)),
    };
    settingsPanel.setPreviewImage(idleUrl, currentGripPoint);
    bodySprite.anchor.set(currentGripPoint.x, currentGripPoint.y);
    backSprite.anchor.copyFrom(bodySprite.anchor);
    // Get saved turtleSize from settings panel or use default
    const savedTurtleSize = settingsPanel._values?.turtleSize || 64;
    const skinScale = savedTurtleSize / baseSize;
    bodySprite.scale.set(skinScale);
    backSprite.scale.set(skinScale);
    console.log(`[Skin] Scale: ${skinScale.toFixed(2)} (baseSize: ${baseSize}, turtleSize: ${savedTurtleSize})`);

    // holo 箔资产随皮肤重建（idle 帧为源）
    const idleSource = idleTexture.baseTexture?.resource?.source;
    if (idleSource instanceof HTMLImageElement || idleSource instanceof HTMLCanvasElement) {
      rebuildFoilAssets(idleSource, currentGripPoint);
    }

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
      applySettings(saved, { isInitialLoad: true });
    }
  } catch (err) {
    console.warn('[Settings] Failed to load settings on startup:', err);
  }
}

// ── Anchor mode（经典顶边悬挂 / 挂饰跟随鼠标）─────────────────────────
// ropeLength 是「当前模式的绳长」：切换模式时渲染端记住各自的值并持久化，
// 避免经典 150 串进挂饰（挂饰默认 80）。
const charmAnchorSampler = new CharmAnchorSampler({
  getCursorPosition: () => window.electronAPI.getCursorPosition(),
});
// 挂饰指引第 1 课（移动鼠标）的累计位移
let charmGuideTravel = 0;
let charmGuideLastCursor = null;
const charmState = {
  mode: ANCHOR_MODES.TOP,
  ropeLengths: {
    [ANCHOR_MODES.TOP]: DEFAULT_ROPE_LENGTHS[ANCHOR_MODES.TOP],
    [ANCHOR_MODES.CURSOR]: DEFAULT_ROPE_LENGTHS[ANCHOR_MODES.CURSOR],
  },
};

function isCharmMode() {
  return charmState.mode === ANCHOR_MODES.CURSOR;
}

// 面板打开期间光标必然去操作面板内容，锚点必须冻结在原位，否则宠物会
// 跟着光标撞进面板；乌龟方程继续跑，宠物自然垂稳。
function charmAnchorFrozen() {
  return settingsPanel.isOpen || settingsPanel.isAnimating
    || subscriptionPanel.isOpen || skinSelector.isOpen
    || codexCompanion.capturesOutsideClicks;
}

/** 监控面板生命周期（EXPANDING→PANEL_OPEN→COLLAPSING）期间锚点同样冻结。 */
function monitorPanelStateActive(state) {
  return ['EXPANDING', 'HAPPY', 'PANEL_OPEN', 'COLLAPSING'].includes(state);
}

function setAnchorMode(nextMode, { persist = true } = {}) {
  if (nextMode !== ANCHOR_MODES.TOP && nextMode !== ANCHOR_MODES.CURSOR) return;
  if (nextMode === charmState.mode) return;
  charmState.mode = nextMode;

  if (nextMode === ANCHOR_MODES.CURSOR) {
    const cursor = charmAnchorSampler.sample() || lastCursorPosition
      || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    physics.enterCharmMode({ turtleX: sprite.x, turtleY: sprite.y, cursor });
    physics.ropeLength = charmState.ropeLengths[ANCHOR_MODES.CURSOR];
    physics.restRopeLength = charmState.ropeLengths[ANCHOR_MODES.CURSOR];
    console.log(`[Charm] anchor mode → cursor (rope ${physics.restRopeLength})`);
  } else {
    physics.exitCharmMode();
    physics.ropeLength = charmState.ropeLengths[ANCHOR_MODES.TOP];
    physics.restRopeLength = charmState.ropeLengths[ANCHOR_MODES.TOP];
    physics.pendulumAngle = 0;
    physics.pendulumOmega = 0;
    console.log(`[Charm] anchor mode → top (rope ${physics.restRopeLength})`);
  }
  // 指引按新模式切换课程（活动中重置到第一课；未激活时按需自动开始）
  onboardingGuide.onAnchorModeChanged?.();

  // 无论切换来源（托盘/设置同步），都把新模式与「新模式绳长」一并持久化——
  // 只写 ropeLength 的话，回环广播会带着旧 anchorMode 把切换翻回去。
  // settings-changed 回环再次进入 applySettings 时同值幂等，不会成环。
  if (persist) {
    window.electronAPI.settings.set('anchorMode', nextMode);
    window.electronAPI.settings.set('ropeLength', physics.restRopeLength);
    window.electronAPI.settings.save();
  }
}

// ── Ring menu 交互（角色互换模型）────────────────────────────────────
// Ctrl+Alt+A 按住开环（宠物钉死为圆心），松手按方位角触发。不新增状态机
// 状态（设计文档 §5.9.7）：环是 overlay，PANEL_OPEN 下也要能开。

function ringMenuBlockedByPanels() {
  return settingsPanel.isOpen || settingsPanel.isAnimating
    || subscriptionPanel.isOpen || skinSelector.isOpen
    || codexCompanion.capturesOutsideClicks;
}

function ringMenuCursor() {
  return charmAnchorSampler.sample() || lastCursorPosition;
}

function openRingMenu() {
  if (ringMenu.isOpen || ringMenuBlockedByPanels()) return;
  const state = stateMachine.getState();
  if (['PULLING', 'PULLEY_DRAG', 'BOUNCING', 'EXPANDING', 'COLLAPSING'].includes(state)) return;
  // 求值顺序陷阱（mockup openRing）：先取宠物位置，再开环
  ringMenu.open({ x: sprite.x, y: sprite.y }, ringMenuCursor());
  const center = ringMenu.ringCenter;
  onboardingGuide.completeGesture('charm-ring');
  console.log(`[Ring] open at (${center.x.toFixed(0)}, ${center.y.toFixed(0)})`);
}

function dispatchRingAction(actionId) {
  switch (actionId) {
    case 'panel':
      console.log('[Ring] act: panel → EXPANDING');
      stateMachine.transition('OPEN_PANEL');
      break;
    case 'settings':
      openSettingsPanel();
      break;
    case 'skin':
      if (settingsPanel.isOpen || settingsPanel.isAnimating) settingsPanel.close();
      if (subscriptionPanel.isOpen) subscriptionPanel.close();
      skinSelector.open?.();
      requestAnimationFrame(() => synchronizeMousePassthroughFromSystem(true));
      break;
    case 'hide':
      window.electronAPI.requestCharmHide?.();
      break;
    case 'sub':
      openSubscriptionPanel();
      break;
    case 'agent':
      console.log('[Ring] act: agent → conversation/tray');
      onboardingGuide.completeGesture('charm-agent');
      codexCompanion.openAgentConversation?.();
      break;
    case 'mode':
      setAnchorMode(isCharmMode() ? ANCHOR_MODES.TOP : ANCHOR_MODES.CURSOR);
      break;
    case 'help':
      if (settingsPanel.isOpen || settingsPanel.isAnimating) settingsPanel.close();
      if (subscriptionPanel.isOpen) subscriptionPanel.close();
      onboardingGuide.restart();
      break;
    case 'custom':
      window.electronAPI.requestCustomMode?.();
      break;
    default:
      break;
  }
}

function closeRingMenu() {
  if (!ringMenu.isOpen) return;
  const result = ringMenu.close();
  if (!result) return;
  if (result.reason === 'hit') {
    console.log(`[Ring] fire #${result.index} → ${result.action}`);
    dispatchRingAction(result.action);
  } else if (result.reason === 'mistap') {
    console.log('[Ring] mistap → cancelled');
  } else if (result.reason === 'dead-zone') {
    console.log('[Ring] dead zone → cancelled');
  }
}

window.electronAPI.onCharmHotkey?.(({ phase }) => {
  if (phase === 'down') openRingMenu();
  else if (phase === 'up') closeRingMenu();
});
if (import.meta.env.DEV) window.__ringMenuForDiagnostics = ringMenu;

/**
 * Apply settings to the physics engine and renderer.
 */
function applySettings(settings, { isInitialLoad = false } = {}) {
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
  // 挂饰模式：手感旋钮 → 翻转物理配置；全息开关独立
  flipConfig = knobsToFlipConfig(settings);
  if (settings.charmHoloEnabled !== undefined) {
    charmHoloEnabled = settings.charmHoloEnabled !== false;
    if (!charmHoloEnabled) {
      foilFoilSprite.alpha = 0;
      foilBandSprite.alpha = 0;
      backFoilSprite.alpha = 0;
      backBandSprite.alpha = 0;
      foilFoilSprite.visible = false;
      foilBandSprite.visible = false;
      backFoilSprite.visible = false;
      backBandSprite.visible = false;
    }
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
    // 纯尺寸变化不重建纹理：body/mask 用基准 scale，
    // 金属背板与其他材质层用 scale/3（纹理 ×3 预渲染）
    syncLayerScales(foilLayers(), scale);
    console.log(`[Settings] Turtle size: ${settings.turtleSize}, scale: ${scale.toFixed(2)} (baseSize: ${currentSkinBaseSize})`);
  }
  
  // Handle anchorMode FIRST — switching modes re-seeds physics positions and
  // rope length. A mode-switch broadcast carries the *previous* mode's
  // ropeLength (the write-back lands after the broadcast was snapshotted), so
  // on a switch frame the ropeLength below must be ignored, then re-persisted.
  // On the initial load the saved pair (anchorMode, ropeLength) is consistent.
  const switchingMode = !isInitialLoad
    && settings.anchorMode !== undefined
    && settings.anchorMode !== charmState.mode;
  if (settings.anchorMode !== undefined) {
    if (isInitialLoad && settings.ropeLength !== undefined) {
      charmState.ropeLengths[settings.anchorMode] = settings.ropeLength;
    }
    setAnchorMode(settings.anchorMode, { persist: !isInitialLoad });
  }

  if (settings.ropeLength !== undefined && !switchingMode) {
    charmState.ropeLengths[charmState.mode] = settings.ropeLength;
    physics.ropeLength = settings.ropeLength;
    physics.restRopeLength = settings.ropeLength;
    console.log(`[Settings] Rope length (${charmState.mode}): ${settings.ropeLength}`);
  }

  if (switchingMode) {
    // Persist the new mode's rope length; the echo broadcast is same-value idempotent.
    window.electronAPI.settings.set('ropeLength', physics.restRopeLength);
    window.electronAPI.settings.save();
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
  const overPet = isPointWithinBounds(bodySprite.getBounds(), event.clientX, event.clientY, PET_HIT_PADDING);
  if (stateMachine.getState() === 'CODEX_CONFIG_OPEN' && !insideCodex && !overPet) {
    stateMachine.transition('CLICK_OUTSIDE');
    return;
  }
  if (!insideCodex && codexCompanion.capturesOutsideClicks) {
    codexCompanion.closeTaskTray();
    // 挂饰模式下 config 面板从任务托盘打开，不走状态机——点外部一并关闭。
    // 经典模式的 config 由 CODEX_CONFIG_OPEN 状态机流转（上方分支处理）。
    if (stateMachine.getState() !== 'CODEX_CONFIG_OPEN') {
      codexCompanion.closeConfig({ notify: false });
    }
    document.activeElement?.blur?.();
    requestAnimationFrame(() => synchronizeMousePassthroughFromSystem(true));
  }
}, true);

// ── Input Manager ──────────────────────────────────────────────────────
const inputManager = new InputManager({
  pixiApp,
  sprite,
  hitTestBounds: () => bodySprite.getBounds(),
  stateMachine,
  physics,
  shouldIgnoreEvent: (event) => codexCompanion.ownsEvent(event)
    || isCharmMode()
    || onboardingGuide.ownsEvent(event)
    || isEventOwnedByRoot(event, settingsPanel.root),
  onGesture: (gesture) => onboardingGuide.completeGesture(gesture),
  onInteractionChange: () => requestAnimationFrame(() => synchronizeMousePassthroughFromSystem(true)),
  beforePetInteraction: () => {
    if (stateMachine.getState() !== 'CODEX_CONFIG_OPEN') return;
    codexCompanion.closeConfig({ notify: false });
    stateMachine.reset('IDLE');
    prevState = 'IDLE';
    setSpriteTextureForState('IDLE');
  },
});
inputManager.enable();

// ── Transparent click-through ──────────────────────────────────────────
const CHARM_BADGE_HOVER_PADDING = 8;
let isOverSprite = false;
let lastMousePassthrough = true;
let lastCursorPosition = null;
let mouseSyncInFlight = false;

function applyMousePassthrough(ignore, force = false) {
  if (force || ignore !== lastMousePassthrough) {
    lastMousePassthrough = ignore;
    window.electronAPI.setIgnoreMouseEvents(ignore);
  }
  return ignore;
}

function synchronizeMousePassthrough(x, y, force = false) {
  const state = stateMachine.getState();
  const bounds = bodySprite.getBounds();
  // 挂饰模式下宠物贴着光标走，overSprite 恒真会把窗口切成可交互吃掉桌面
  // 点击——挂饰全程 click-through，宠物本体不参与命中测试。
  const overSprite = !isCharmMode() && isPointWithinBounds(bounds, x, y, PET_HIT_PADDING);
  // Use visible bounds only: the charm badge moves with the pet, and an
  // expanded hit slop around it can intercept clicks from nearby desktop UI.
  const overCodex = codexCompanion.containsPoint(x, y);
  const overOnboarding = onboardingGuide.containsPoint(x, y);
  const ignore = resolveMousePassthrough({
    state,
    capturesOutsideClicks: codexCompanion.capturesOutsideClicks,
    settingsOpen: settingsPanel.isOpen,
    settingsAnimating: settingsPanel.isAnimating,
    subscriptionOpen: subscriptionPanel.isOpen,
    skinSelectorOpen: skinSelector.isOpen,
    overSprite,
    overCompanion: overCodex,
    overOnboarding,
  });
  const changed = overSprite !== isOverSprite;
  if (changed) {
    isOverSprite = overSprite;
    // Pixi normally updates this during pointermove. The pet itself can move
    // under a stationary cursor, so mirror the hit-test result explicitly.
    pixiApp.view.style.cursor = overSprite ? 'pointer' : 'default';
    sprite.emit(overSprite ? 'pointerover' : 'pointerout');
  }
  applyMousePassthrough(ignore, force);
  if (force) {
    console.log(`[Input] Cursor synchronized after load: ${ignore ? 'passthrough' : 'interactive'}`);
  }
  return ignore;
}

function synchronizeMousePassthroughAtLatestCursor(force = false, announceReady = false) {
  const cursor = charmAnchorSampler.sample() || lastCursorPosition;
  const ignore = cursor
    ? synchronizeMousePassthrough(cursor.x, cursor.y, force)
    : lastMousePassthrough;
  if (cursor) lastCursorPosition = cursor;
  if (announceReady) window.electronAPI.markRendererInputReady(ignore);
  return ignore;
}

async function synchronizeMousePassthroughFromSystem(force = false, announceReady = false) {
  if (mouseSyncInFlight) return lastMousePassthrough;
  mouseSyncInFlight = true;
  const requestAt = charmAnchorSampler.beginScreenRequest(performance.now());
  try {
    const cursor = await window.electronAPI.getCursorPosition();
    if (!charmAnchorSampler.isScreenRequestCurrent(requestAt)) {
      return synchronizeMousePassthroughAtLatestCursor(force, announceReady);
    }
    if (cursor) {
      if (!charmAnchorSampler.noteScreenCursor(cursor.x, cursor.y, requestAt)) {
        return synchronizeMousePassthroughAtLatestCursor(force, announceReady);
      }
      lastCursorPosition = cursor;
    }
    const ignore = cursor ? synchronizeMousePassthrough(cursor.x, cursor.y, force) : true;
    if (!cursor) window.electronAPI.setIgnoreMouseEvents(true);
    if (announceReady) window.electronAPI.markRendererInputReady(ignore);
    return ignore;
  } catch (error) {
    if (!charmAnchorSampler.isScreenRequestCurrent(requestAt)) {
      return synchronizeMousePassthroughAtLatestCursor(force, announceReady);
    }
    console.warn('[Input] Failed to synchronize cursor after load:', error);
    window.electronAPI.setIgnoreMouseEvents(true);
    if (announceReady) window.electronAPI.markRendererInputReady(true);
    return true;
  } finally {
    mouseSyncInFlight = false;
  }
}

document.addEventListener('mousemove', (event) => {
  lastCursorPosition = { x: event.clientX, y: event.clientY };
  charmAnchorSampler.noteWindowCursor(event.clientX, event.clientY);
  // 挂饰指引第 1 课：累计光标位移，足够了就推进（guide 内部按当前步骤过滤）
  if (isCharmMode()) {
    if (charmGuideLastCursor) {
      charmGuideTravel += Math.hypot(event.clientX - charmGuideLastCursor.x, event.clientY - charmGuideLastCursor.y);
      if (charmGuideTravel >= 500) {
        charmGuideTravel = 0;
        onboardingGuide.completeGesture('charm-follow');
      }
    }
    charmGuideLastCursor = { x: event.clientX, y: event.clientY };
  } else {
    charmGuideLastCursor = null;
  }
  synchronizeMousePassthrough(event.clientX, event.clientY);
});

// When the transparent window is passing input through, Chromium may not send
// a renderer mousemove as the cursor enters the pet. Poll the system cursor so
// the window becomes interactive before the user clicks or begins a drag.
const mousePassthroughSyncTimer = window.setInterval(() => {
  void synchronizeMousePassthroughFromSystem();
}, 80);
window.addEventListener('beforeunload', () => window.clearInterval(mousePassthroughSyncTimer));

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

let latestSystemData = null;
window.electronAPI.onSystemData((data) => {
  latestSystemData = data;
  // 隐藏的面板不重建 PIXI 图形；下一次打开会立即使用这份缓存。
  if (panel.isOpen || panel.isAnimating) panel.update(data);
});
window.electronAPI.requestSystemData();

// ── Click-outside detection for closing the panel ──────────────────────
document.addEventListener('mousedown', (e) => {
  const state = stateMachine.getState();
  if (state !== 'PANEL_OPEN') return;

  // Don't close the system panel if settings panel is open
  if (settingsPanel.isOpen || settingsPanel.isAnimating || subscriptionPanel.isOpen) return;

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
  // → EXPANDING: pull exceeded threshold (click flow) or ring menu panel action
  if (newState === 'EXPANDING') {
    console.log('[Panel] EXPANDING — showing panel + HAPPY sprite');
    window.electronAPI.setMonitorActivity?.({ panelOpen: true });
    // Position panel below the sprite（挂饰锚点=光标滑轮；经典=顶边）
    const anchorX = isCharmMode() ? physics.pulley.x : physics.screenAnchorX * window.innerWidth;
    panel.setPosition(anchorX, sprite.y + 80);
    if (latestSystemData) panel.update(latestSystemData);
    panel.expand(() => {
      console.log('[Panel] Fully open → PANEL_OPEN');
      stateMachine.transition('PANEL_FULLY_OPEN');
    });
  }

  if (prevState === 'BOUNCING' && newState === 'CODEX_CONFIG_OPENING') {
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
      window.electronAPI.setMonitorActivity?.({ panelOpen: false });
      stateMachine.transition('PANEL_FULLY_CLOSED');
      synchronizeMousePassthroughFromSystem(true);
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
      codexFollowPanelOpen: codexCompanion.isFollowPanelOpen,
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
  if (_panelDragContext && prevState === 'PULLEY_DRAG' && newState !== 'PULLEY_PHYSICS') {
    restoreAttachedPanelDragPhysics();
    console.log('[PanelDrag] Right-click completed without a throw; stable physics restored');
  }
  if (_panelDragContext && prevState === 'PULLEY_PHYSICS'
      && newState === resolvePanelDragSettledState(_panelDragContext)) {
    const settledContext = _panelDragContext;
    restoreAttachedPanelDragPhysics();
    synchronizeMousePassthroughFromSystem(true);
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
    if (import.meta.env.DEV) console.log(`[FPS] ${Math.round(fpsCount / fpsTime)}`);
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

  const monitorFollowPanelOpen = ['EXPANDING', 'HAPPY', 'PANEL_OPEN', 'COLLAPSING'].includes(state);
  physics.ambientSwingEnabled = resolveAmbientSwingEnabled(
    petBehaviorSettings,
    monitorFollowPanelOpen || codexCompanion.isFollowPanelOpen,
  );

  const isCharm = isCharmMode();
  // Keep the pet and rope in the menu pose until the closing animation ends.
  const ringActive = ringMenu.isOpen || ringMenu.container.visible;
  const ringCenter = ringMenu.ringCenter;
  const ringAnchorBeforeUpdate = ringMenu.ropeAnchor;
  if (ringWasActive && !ringActive && lastRingCenter && !reducedMotionQuery?.matches) {
    ringExit = {
      age: 0,
      petOffset: null,
      mount: lastRingMountPosition,
      ropeAnchor: lastRingRopeAnchor,
    };
  } else if (ringExit) {
    ringExit.age = Math.min(0.18, ringExit.age + dt);
  }
  if (ringActive || reducedMotionQuery?.matches) ringExit = null;
  const ringExitWeight = ringExit ? (1 - ringExit.age / 0.18) ** 3 : 0;
  if (ringActive && ringCenter) lastRingCenter = ringCenter;
  ringWasActive = ringActive;

  // The OS cursor keeps moving while panels or pet interactions freeze physics.
  // Its rigid ring position therefore remains live in every charm state.
  if (isCharm) {
    charmAnchorSampler.pollOnce({ staleAfterMs: 16 });
    const cursor = charmAnchorSampler.sample();
    if (cursor) physics.setCharmAnchor({
      x: cursor.x + (cursorMountState.mountOffset?.x || 0),
      y: cursor.y + (cursorMountState.mountOffset?.y || 0),
    }, cursorMountState.ringScale || 1, cursorMountState.ringGeometry);
  }
  // Update physics (skipped during PULLING and BOUNCING)
  if (ringActive) {
    // 环形菜单开环：宠物钉死为圆心，全部物理静置（角色互换模型）
  } else if (!isCharm) {
    physics.updatePendulum(dt);
    physics.updatePulleyMomentum(dt);
  } else {
    // 挂饰模式：光标驱动滑轮（面板打开/面板态冻结锚点），乌龟跑同一套 2D 方程。
    // 锚点 = 环底（光标 + 环偏移），金属环画在锚点上、绳从环底垂下。
    physics.updateCharmStep(dt);

    // 疼表情：与 PULLEY_PHYSICS 分支同一通道（状态分支链之外）
    if (physics._justCollided && _painCooldown <= 0) {
      physics._justCollided = false;
      _showPainTimer = 0.4;
      _painCooldown = 0.8;
    }
    if (_painCooldown > 0) {
      _painCooldown -= dt;
    }
  }

  // Ring menu 推进（开环 + 收环动画都走这里）
  // 菜单打开时窗口仍 click-through，DOM mousemove 可能停发；把系统光标回退采样
  // 提升到逐帧单飞，并在有新鲜 DOM 坐标时自动退让给零延迟来源。
  if (ringMenu.isOpen) charmAnchorSampler.pollOnce({ staleAfterMs: 16 });
  ringMenu.update(dt, ringMenuCursor(), performance.now());

  // Update panel animation
  panel.updateAnimation(dt);

  // Update settings panel animation
  settingsPanel.updateAnimation(dt);

  // Compute rope anchor — charm: pulley = cursor + ring offset (1:1); classic: top edge
  // (offset 50px down because window extends 50px above screen to hide white border)
  const anchorX = isCharm ? physics.pulley.x : physics.screenAnchorX * window.innerWidth;
  const anchorY = isCharm ? physics.pulley.y : 50;

  // 环形菜单期间挂环仍附着在实时光标上，并绘制在扇区上方；收环动画结束后
  // 回到普通物理锚点，避免进入轮盘时挂饰突然消失。
  const mountPose = resolveCharmMountPose({
    isCharmMode: isCharm,
    ringVisible: ringActive,
    cursor: ringActive ? ringMenuCursor() : null,
    mountAnchor: physics.charmMountAnchor || physics.pulley,
    supported: cursorMountState.active && cursorMountState.supported,
    mountOffset: cursorMountState.mountOffset || CHARM_MOUNT_ANCHOR_OFFSET,
  });
  if (ringActive && mountPose.position) {
    lastRingMountPosition = { ...mountPose.position };
  } else if (!cursorMountState.ringEmbedded && ringExit?.mount && mountPose.position) {
    mountPose.position.x += (ringExit.mount.x - mountPose.position.x) * ringExitWeight;
    mountPose.position.y += (ringExit.mount.y - mountPose.position.y) * ringExitWeight;
  }
  charmMountSprite.visible = mountPose.visible && !cursorMountState.ringEmbedded;
  charmMountSprite.scale.set(cursorMountState.ringScale || 1);
  const showCharm = !isCharm || (cursorMountState.active && cursorMountState.supported);
  turtleContainer.visible = showCharm;
  ropeContainer.visible = showCharm;
  if (mountPose.position) charmMountSprite.position.set(mountPose.position.x, mountPose.position.y);
  setCharmMountRingLayer(isCharm && ringActive);
  // During open and close, the actual rope crosses the annulus visibly. Move
  // only its layer; the cursor mount and floating label stay above it.

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

  // holo 箔效果驱动（相位/强度随运动速度；挂饰与经典模式统一）
  updateFoilFx(dt);

  // State-specific behavior
  // ── Hover detection (IDLE ↔ HOVER) ──────────────────────────────
  // Charm mode stays click-through, but still changes the sprite when the
  // system cursor rests over the card or its small Codex badge.
  if (state === 'IDLE' || state === 'HOVER') {
    let mx = 0, my = 0, hasCursorPosition = false;
    if (isCharm) {
      const cursor = charmAnchorSampler.sample() || lastCursorPosition;
      if (cursor) { mx = cursor.x; my = cursor.y; hasCursorPosition = true; }
    } else {
      try {
        const events = pixiApp.renderer && pixiApp.renderer.events;
        const p = events && events.pointer;
        if (p && typeof p.x === 'number') { mx = p.x; my = p.y; hasCursorPosition = true; }
      } catch (e) { /* ignore if events not available */ }
    }
    const petBounds = bodySprite.getBounds();
    const petPadding = isCharm ? 0 : PET_HIT_PADDING;
    const overPet = hasCursorPosition && isPointWithinBounds(petBounds, mx, my, petPadding);
    const badgeButton = isCharm ? codexCompanion.badge : null;
    const badgeButtonBounds = badgeButton && !badgeButton.hidden ? badgeButton.getBoundingClientRect() : null;
    const overBlueBadge = isCharm && hasCursorPosition
      && isPointWithinBounds(badgeButtonBounds, mx, my, CHARM_BADGE_HOVER_PADDING);
    const over = overPet || overBlueBadge;
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
    const totalEnergy = ringActive ? undefined : physics.updatePulleyPhysics(dt);

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
    if (!ringActive && Math.abs(physics.pulleyMomentumVelocity) < MOMENTUM_STOP_THRESHOLD) {
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
    
  } else if (isCharm) {
    // 挂饰 IDLE：位置由乌龟物理给出（ticker 前段已步进）
    sprite.x = physics.turtle.x;
    sprite.y = physics.turtle.y;
  } else {
    // IDLE/HOVER - pendulum drives position
    // Rope return: 0.5s smoothstep animation to default length
    updateRopeReturn(dt);
    const pendulumX = anchorX + Math.sin(physics.pendulumAngle) * physics.ropeLength;
    const pendulumY = anchorY + Math.cos(physics.pendulumAngle) * physics.ropeLength;
    sprite.x = pendulumX;
    sprite.y = pendulumY;
  }

  // Ring menu 开环：宠物钉死在圆心（覆盖一切状态分支的位置输出）
  if (ringActive && ringCenter) {
    sprite.x = ringCenter.x;
    sprite.y = ringCenter.y;
  }

  const codexMotionEnabled = (state === 'IDLE' || state === 'HOVER')
    && !ringActive
    && !settingsPanel.isOpen
    && !settingsPanel.isAnimating
    && !subscriptionPanel.isOpen
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
      applyCodexMotionImpulse(physics, motionFrame.pendulumImpulse);
    }
    const baseDx = sprite.x - anchorX;
    const baseDy = sprite.y - anchorY;
    const baseLength = Math.sqrt(baseDx * baseDx + baseDy * baseDy);
    const displayAngle = Math.atan2(baseDx, baseDy) + motionFrame.angleOffset;
    const displayLength = Math.max(1, baseLength + motionFrame.lengthOffset);
    sprite.x = anchorX + Math.sin(displayAngle) * displayLength;
    sprite.y = anchorY + Math.cos(displayAngle) * displayLength;
  }
  // Task-running tilt is a pet-level swing: rotate the whole charm stack so
  // the outline, foil, back plate and face share the same pivot. Rotating only
  // bodySprite leaves sibling metal layers behind and exposes a detached edge.
  turtleContainer.rotation = (foilFx.maskSprite ? flipState.tilt + flipState.spinZ * 0.55 : 0)
    + (codexMotionEnabled ? motionFrame.rotation : 0);
  // Edge clamping can shift the menu center away from the physical pet. Blend
  // the visible pet back after closing while its underlying physics resumes.
  if (ringExit) {
    if (!ringExit.petOffset) {
      ringExit.petOffset = {
        x: lastRingCenter.x - sprite.x,
        y: lastRingCenter.y - sprite.y,
      };
    }
    sprite.x += ringExit.petOffset.x * ringExitWeight;
    sprite.y += ringExit.petOffset.y * ringExitWeight;
  }
  bodySprite.x = 0;
  bodySprite.y = 0;
  const codexBodyBounds = bodySprite.getBounds();
  const codexVisualX = codexBodyBounds.x + codexBodyBounds.width / 2;
  const codexVisualY = codexBodyBounds.y + codexBodyBounds.height / 2;
  // 挂饰下指引卡片锚定屏幕固定点：卡片若锚定宠物（物理摆动）或锚点
  // （1:1 跟随光标），都会出现「光标永远追不上/晃到无法阅读」的问题。
  if (isCharm && !ringActive) {
    onboardingGuide.setAnchor(window.innerWidth / 2, window.innerHeight * 0.62);
  } else {
    onboardingGuide.setAnchor(codexVisualX, codexVisualY);
  }
  onboardingGuide.setPaused(
    !['IDLE', 'HOVER'].includes(state)
      || settingsPanel.isOpen
      || settingsPanel.isAnimating
      || subscriptionPanel.isOpen
      || skinSelector.isOpen
      || codexCompanion.capturesOutsideClicks,
  );
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
  ].includes(state) || settingsPanel.isOpen || settingsPanel.isAnimating || subscriptionPanel.isOpen || skinSelector.isOpen;
  codexCompanion.setBubblesSuppressed(suppressCodexBubbles);
  // 挂饰下 badge 必须保持锚定宠物：宠物物理滞后于光标，光标快速移向 badge
  // 时宠物还没追上，这段滞后就是命中窗口；若锚定 1:1 跟随光标的锚点，
  // badge 与光标相对位置恒定，将永远无法被点击。
  codexCompanion.setAnchor(codexVisualX, codexVisualY);
  codexCompanion.updateFrame();
  // The pet can move beneath a stationary physical cursor. Re-run the single
  // hit-test path after its final frame position is known so the transparent
  // window never keeps stale click-through state.
  if (lastCursorPosition) {
    synchronizeMousePassthrough(lastCursorPosition.x, lastCursorPosition.y);
  }
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

  // In classic mode the rope follows the ring direction. Charm mode instead
  // attaches it to the cursor's metal ring below.
  let ringAnchorApplied = false;
  if (ringActive && !isCharm) {
    const ringAnchor = ringMenu.ropeAnchor || ringAnchorBeforeUpdate;
    if (ringAnchor) {
      ropeAnchorX = ringAnchor.x;
      ropeAnchorY = ringAnchor.y;
      ringAnchorApplied = true;
    }
  } else if (!isCharm && ringExit?.ropeAnchor) {
    ropeAnchorX += (ringExit.ropeAnchor.x - ropeAnchorX) * ringExitWeight;
    ropeAnchorY += (ringExit.ropeAnchor.y - ropeAnchorY) * ringExitWeight;
  }

  // 挂饰模式：绳绕挂环滑动——绳的视觉起点 = 环缘上朝向乌龟的点。
  // 乌龟垂在下方时挂点即环底；被甩到锚点上方时挂点绕到环顶，绳不再
  // 从环中间穿过（真实挂环的行为）。
  if (isCharm && mountPose.visible && mountPose.position) {
    // During the menu the ring follows the real cursor. Attach the rope to
    // that same metal rim, so aiming stretches and turns the actual rope.
    const attachment = charmRopeAttachment(mountPose.position, sprite, cursorMountState.ringScale || 1, cursorMountState.ringGeometry);
    ropeAnchorX = attachment.x;
    ropeAnchorY = attachment.y;
  }
  if (ringActive) lastRingRopeAnchor = { x: ropeAnchorX, y: ropeAnchorY };

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

  // Charm mode: same tension term, plus a whip term driven by the turtle's
  // angular velocity around the anchor (系数照抄原版 omega*5 / 上限 15).
  if (isCharm && state === 'IDLE' && !ringActive) {
    const dx = sprite.x - ropeAnchorX;
    const dy = sprite.y - ropeAnchorY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const stretch = Math.max(0, dist - physics.restRopeLength);
    const tension = stretch / Math.max(1, physics.restRopeLength);
    const omegaTurtle = Math.abs(physics.turtle.vx * -dy + physics.turtle.vy * dx) / Math.max(1, dist * dist);
    const whip = Math.min(omegaTurtle * 5, 15);
    adjustedSag = (sag + whip) * Math.max(0.1, 1 - tension * 0.8);
  }

  // Aiming changes the visible rope length without changing physical length.
  // Near the pet it loosens; when pulled away it becomes almost taut.
  if (ringActive && isCharm) {
    adjustedSag = ringRopeSag(
      physics.restRopeLength,
      { x: ropeAnchorX, y: ropeAnchorY },
      sprite,
    );
  } else if (ringAnchorApplied) {
    adjustedSag = ringMenu.openSag;
  }

  ropeRenderer.draw(ropeAnchorX, ropeAnchorY, sprite.x, sprite.y, adjustedSag, ROPE_WIDTH);
  if (ringExit && ringExitWeight <= 0) ringExit = null;

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
  if (import.meta.env.DEV && frameCount % 60 === 0) {
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
  onboardingGuide.initialize();

} // end init

init();
