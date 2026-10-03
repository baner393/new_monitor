// Reuses PixiJS 7 sprite/mask/mesh primitives (MIT):
// https://github.com/pixijs/pixijs/tree/v7.4.3/packages
import * as PIXI from 'pixi.js';
import { PhysicsEngine } from './physics.js';
import { RopeRenderer } from './rope.js';
import { charmRopeAttachment } from './ring-rope.js';
import { buildFoilAssets, buildSlabTexture, buildSlabGeometry } from './charm-foil.js';
import { createFlipState, updateFlip, applyFlip, syncLayerScales, knobsToFlipConfig } from './charm-flip.js';
import { METAL_VERTEX, METAL_FRAGMENT } from './charm-metal.js';
import { ROPE_ELASTICITY_STEPS } from '../shared/pet-settings-model.js';
import { cursorProfileKey, validateCursorHole, findDefaultCursorHole, punchCursorPixels, cursorMountGeometry } from '../shared/cursor-hole-model.js';

export class CharmPreview {
  constructor(host, onProfile, onHint) {
    this.host = host;
    this.onProfile = onProfile;
    this.onHint = onHint;
    this.mode = 'edit';
    this.frames = [];
    this.values = {};
    this.physics = new PhysicsEngine();
    this.physics.charmMode = true;
    this.flip = createFlipState();
    this.app = new PIXI.Application({ width: 240, height: 330, backgroundAlpha: 0, antialias: true, autoStart: false, resolution: window.devicePixelRatio || 1, autoDensity: true });
    this.app.stop();
    this.app.view.className = 'pet-settings-preview-canvas';
    this.app.view.setAttribute('aria-label', '挂饰穿孔预览，点击或拖动选取孔位');
    this.app.view.tabIndex = 0;
    this.app.view.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); this.reset(); return; }
      if (this.mode !== 'edit' || !this.profile) return;
      const delta = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -0.01], ArrowDown: [0, 0.01] }[event.key];
      if (delta) { event.preventDefault(); this.tryProfile({ ...this.profile, u: this.profile.u + delta[0], v: this.profile.v + delta[1] }); }
    });
    host.append(this.app.view);
    this.rope = new PIXI.Graphics();
    this.ropeRenderer = new RopeRenderer(this.rope);
    this.cursor = new PIXI.Sprite(PIXI.Texture.EMPTY);
    this.pet = new PIXI.Container();
    this.app.stage.addChild(this.rope, this.cursor, this.pet);
    this.pointer = { x: 0, y: 0 };
    this.app.view.addEventListener('pointerdown', event => {
      this.dragging = true;
      this.app.view.setPointerCapture(event.pointerId);
      this.move(event);
    });
    this.app.view.addEventListener('pointermove', event => { if (this.dragging) this.move(event); });
    for (const name of ['pointerup', 'pointercancel']) this.app.view.addEventListener(name, event => {
      this.dragging = false;
      if (this.app.view.hasPointerCapture(event.pointerId)) this.app.view.releasePointerCapture(event.pointerId);
    });
  }

  async setRole(role) {
    const generation = this.generation = (this.generation || 0) + 1;
    this.role = role;
    this.frames = [];
    this.valid = false;
    for (const texture of this.cursorTextures || []) texture.destroy(true);
    this.cursorTextures = [];
    this.cursor.visible = false;
    this.onHint('正在读取光标主题…');
    try {
      const frames = await Promise.all((role?.frames || []).map(async frame => {
        const image = new Image();
        image.src = frame.dataUrl;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = frame.width; canvas.height = frame.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        return { ...frame, pixels: context.getImageData(0, 0, frame.width, frame.height).data };
      }));
      if (generation !== this.generation) return;
      this.frames = frames;
      this.profileSignature = null;
      this.defaultProfile = role.defaultProfile || findDefaultCursorHole(frames);
      this.setValues(this.values);
    } catch {
      if (generation === this.generation) this.onHint('无法读取此光标图案，请重新读取主题');
    }
  }

  setValues(values) {
    this.values = values;
    if (!this.role || !this.frames.length) return;
    const profile = values.charmCursorProfiles?.[cursorProfileKey(this.role.role, this.role.id)] || this.defaultProfile;
    this.profile = profile;
    const validation = validateCursorHole(this.role.masks?.length ? this.role.masks : this.frames, profile);
    this.valid = validation.valid;
    this.onHint(validation.valid ? (this.mode === 'edit' ? '放大定位：点击或拖动孔位，孔圈须位于所有动画帧内' : '按住并移动光标，试甩当前挂饰') : validation.reason);
    const signature = JSON.stringify(profile);
    if (this.profileSignature !== signature) {
      this.profileSignature = signature;
      this.rebuildCursor();
    }
    const p = this.physics;
    for (const key of ['gravity', 'damping', 'pulleyFriction', 'ropeStiffness', 'ropeDamping', 'airDamping']) p[key] = values[key];
    p.ropeElasticity = ROPE_ELASTICITY_STEPS[values.ropeElasticity - 1];
    p.ropeBounceRest = values.bounceRestitution;
  }

  setMode(mode) {
    this.mode = mode;
    this.pointer = { x: 0, y: 0 };
    this.reset();
    this.setValues(this.values);
  }

  rebuildCursor() {
    for (const texture of this.cursorTextures || []) texture.destroy(true);
    this.cursorTextures = this.frames.map(frame => {
      const output = this.valid ? punchCursorPixels(frame, this.profile) : frame;
      const canvas = document.createElement('canvas');
      canvas.width = output.width; canvas.height = output.height;
      const context = canvas.getContext('2d');
      context.putImageData(new ImageData(new Uint8ClampedArray(output.pixels), output.width, output.height), 0, 0);
      return PIXI.Texture.from(canvas);
    });
  }

  move(event) {
    const rect = this.app.view.getBoundingClientRect();
    const x = (event.clientX - rect.left) * this.app.screen.width / rect.width;
    const y = (event.clientY - rect.top) * this.app.screen.height / rect.height;
    if (this.mode === 'play') { this.pointer = { x, y }; return; }
    if (!this.frames.length || !this.cursor.width) return;
    const frame = this.frames[0], scale = this.cursor.scale.x;
    const profile = { u: (x - this.cursorOrigin.x) / (frame.width * scale), v: (y - this.cursorOrigin.y) / (frame.height * scale), radius: this.profile?.radius || 0.04 };
    this.tryProfile(profile);
  }

  tryProfile(profile) {
    const validation = validateCursorHole(this.role?.masks?.length ? this.role.masks : this.frames, profile);
    if (!validation.valid) { this.onHint(validation.reason); return false; }
    this.onProfile(cursorProfileKey(this.role.role, this.role.id), profile);
    return true;
  }

  setRadius(radius) { return this.tryProfile({ ...(this.profile || { u: 0.5, v: 0.5 }), radius }); }

  reset() {
    this.physics.reset();
    this.physics.charmMode = true;
    this.flip = createFlipState();
    this.initialized = false;
  }

  async setPet(source, grip = { x: 0.5, y: 0.12 }) {
    const generation = this.petGeneration = (this.petGeneration || 0) + 1;
    const image = new Image(); image.src = source;
    await image.decode();
    if (generation !== this.petGeneration) return;
    const oldTextures = new Set();
    for (const child of this.pet.removeChildren()) {
      if (child.texture) oldTextures.add(child.texture);
      if (child instanceof PIXI.Mesh) child.shader.destroy();
      child.destroy();
    }
    for (const texture of oldTextures) texture.destroy(true);
    const a = buildFoilAssets(image, grip);
    this.petSize = { width: a.frameW || a.size, height: a.frameH || a.size };
    const sprite = (texture, anchor = a.grip) => {
      const item = new PIXI.Sprite(PIXI.Texture.from(texture));
      item.anchor.set(anchor.x, anchor.y); return item;
    };
    const body = sprite(image), mask = sprite(image), backMask = sprite(image);
    mask.renderable = backMask.renderable = false;
    const back = sprite(a.back), backSheen = sprite(a.backSheen), foil = sprite(a.foil), backFoil = sprite(a.foil);
    const band = sprite(a.band, { x: 0, y: 0 }), backBand = sprite(a.band, { x: 0, y: 0 });
    foil.mask = band.mask = mask; backFoil.mask = backBand.mask = backMask;
    for (const item of [foil, backFoil, band, backBand]) item.blendMode = PIXI.BLEND_MODES.SCREEN;
    const slab = buildSlabTexture(image), geometry = buildSlabGeometry(slab, a.grip);
    const texture = PIXI.Texture.from(slab), slices = [];
    for (let i = 0; i < 14; i++) {
      const slice = new PIXI.SimpleMesh(texture, geometry.vertices.slice(), geometry.uvs.slice(), geometry.indices.slice());
      slice.geometry.addAttribute('aContourSlope', geometry.slopes.slice(), 2);
      slice.geometry.addAttribute('aDepthCoordinate', geometry.depthCoordinates.slice(), 1);
      slice.shader.destroy();
      slice.shader = new PIXI.MeshMaterial(texture, { program: PIXI.Program.from(METAL_VERTEX, METAL_FRAGMENT), uniforms: {
        uMetalYaw: new Float32Array([1, 0]), uMetalRotation: new Float32Array([1, 0]), uMetalDepth: (i + 0.5) / 14,
        uMetalHeight: slab.height, uMetalBandWidth: 1 / 14, uMetalDepthDirection: 1,
      } });
      slice.slabVertices = geometry.vertices; slice.metalUniforms = slice.shader.uniforms;
      slices.push(slice);
    }
    this.layers = { body, mask, backMask, back, backSheen, foil, band, backFoil, backBand, slices, container: this.pet };
    this.pet.addChild(...slices, back, backSheen, body, foil, band, backFoil, backBand, mask, backMask);
    this.assets = a;
  }

  update(dt, now) {
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(180, Math.round(rect.width || 240)), height = Math.max(220, Math.round(rect.height || 330));
    if (width !== this.app.screen.width || height !== this.app.screen.height) this.app.renderer.resize(width, height);
    const p = this.physics;
    const frame = this.frames[0];
    const enlarged = this.mode === 'edit';
    const cursorWidth = enlarged ? Math.min(width * 0.6, 130) : (this.role?.displaySize || 32);
    const scale = frame ? cursorWidth / frame.width : 1;
    const cx = this.pointer.x || width * 0.45, cy = this.pointer.y || 28;
    const geometry = frame && this.profile ? cursorMountGeometry(frame, this.profile) : { anchor: { x: 0, y: 0 }, ringScale: 1 };
    const ringScale = geometry.ringScale * scale;
    const ringGeometry = geometry.ringGeometry && { ...geometry.ringGeometry,
      centerFromAnchor: { x: geometry.ringGeometry.centerFromAnchor.x * scale, y: geometry.ringGeometry.centerFromAnchor.y * scale },
      radiusX: geometry.ringGeometry.radiusX * scale, radiusY: geometry.ringGeometry.radiusY * scale };
    if (this.cursorTextures?.length) {
      const steps = this.role.steps?.length ? this.role.steps : [{ frameIndex: 0, durationMs: 100 }];
      const total = steps.reduce((sum, step) => sum + Math.max(1, step.durationMs), 0);
      let time = now % total, index = 0;
      for (const step of steps) { index = step.frameIndex; time -= Math.max(1, step.durationMs); if (time < 0) break; }
      this.cursor.texture = this.cursorTextures[index] || this.cursorTextures[0];
      this.cursorOrigin = { x: cx - cursorWidth / 2, y: cy };
      const origin = this.valid ? geometry.canvas.origin : { x: 0, y: 0 };
      this.cursor.scale.set(scale); this.cursor.position.set(this.cursorOrigin.x - origin.x * scale, cy - origin.y * scale);
      this.cursor.visible = true;
    }
    const anchor = { x: (this.cursorOrigin?.x || 0) + geometry.anchor.x * scale, y: cy + geometry.anchor.y * scale };
    p.setContext({ state: 'IDLE', windowWidth: width, windowHeight: height, turtleSize: this.values.turtleSize * 0.65 });
    p.restRopeLength = p.ropeLength = Math.min(height * 0.52, Math.max(30, this.values.ropeLength * 0.65));
    if (!this.initialized) {
      p.pulley.x = anchor.x; p.pulley.y = anchor.y;
      p.turtle.x = anchor.x; p.turtle.y = anchor.y + p.restRopeLength;
      this.initialized = true;
    }
    p.setCharmAnchor(anchor, ringScale, ringGeometry);
    if (enlarged) {
      p.turtle.x = anchor.x; p.turtle.y = anchor.y + p.restRopeLength;
      p.turtle.vx = p.turtle.vy = 0;
    } else p.updateCharmStep(dt);
    this.pet.position.set(p.turtle.x, p.turtle.y);
    this.pet.visible = this.rope.visible = this.valid;
    const attachment = charmRopeAttachment(anchor, p.turtle, ringScale, ringGeometry);
    this.ropeRenderer.draw(attachment.x, attachment.y, p.turtle.x, p.turtle.y, RopeRenderer.calcSagAmount(p.ropeLength), 4);
    if (this.layers) {
      const config = knobsToFlipConfig(this.values), layers = this.layers;
      const baseScale = this.values.turtleSize * 0.65 / Math.max(this.petSize.width, this.petSize.height);
      syncLayerScales(layers, baseScale);
      layers.band.y = layers.backBand.y = -this.assets.grip.y * this.petSize.height * baseScale;
      layers.back.texture = config.backMaterial === 'pattern' ? layers.body.texture : PIXI.Texture.from(this.assets.back);
      updateFlip(this.flip, dt, Math.hypot(p.turtle.vx, p.turtle.vy), Math.max(-1, Math.min(1, p.turtle.vx / 320)), { x: (p.turtle.vx - (this.lastVx || 0)) / Math.max(dt, 0.001), y: (p.turtle.vy - (this.lastVy || 0)) / Math.max(dt, 0.001) }, config);
      this.lastVx = p.turtle.vx; this.lastVy = p.turtle.vy;
      const holo = this.values.charmHoloEnabled !== false;
      for (const key of ['foil', 'band', 'backFoil', 'backBand']) if (!holo) layers[key].visible = false;
      applyFlip({ ...layers, ...(!holo ? { foil: null, band: null, backFoil: null, backBand: null } : {}) }, this.flip, { baseScale, edgeBase: baseScale / 3, thickness: Math.max(2, Math.min(9, this.petSize.width * baseScale * config.thicknessRatio)), span: this.petSize.width * baseScale, backMaterial: config.backMaterial, holoIntensity: config.holoIntensity });
    }
    this.app.render();
  }
}
