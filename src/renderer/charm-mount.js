/**
 * charm-mount.js — 鼠标挂环（穿孔鼠标挂饰的金属钥匙扣环）
 *
 * 质感方案：高质量 SVG（多段金属渐变 + 高光弧 + 内壁反光 + split-ring 开口
 * 端面）经 data URL 渲染成 PIXI 纹理，运行时是纯 Sprite 贴图——每帧只改
 * position，没有 Graphics 重绘/tessellation 开销。SVG 的渐变能力远超
 * Graphics 逐段弧线，金属感由「斜跨线性渐变 + 顶部高光带 + 底部暗部 +
 * 内外缘描边」合成（图标库式的少而精，避免细碎色带噪点）。
 *
 * 锚点约定：绳固定端（physics.pulley）= 环底。纹理 44x44，环心 (22,22)，
 * 环底 (22, 37.7)——Sprite anchor (0.5, 0.857) 使 position 即锚点。
 * 光标到锚点偏移 (16, 27)。
 */

import * as PIXI from 'pixi.js';

export const CHARM_MOUNT_ANCHOR_OFFSET = { x: 16, y: 27 };

const MOUNT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
  <defs>
    <linearGradient id="m" x1="0.9" y1="0.1" x2="0" y2="0.95">
      <stop offset="0" stop-color="#f5f8fb"/>
      <stop offset="0.35" stop-color="#c3ccd8"/>
      <stop offset="0.65" stop-color="#7d8794"/>
      <stop offset="1" stop-color="#414954"/>
    </linearGradient>
  </defs>
  <circle cx="22" cy="22" r="13" fill="none" stroke="#171c24" stroke-width="7.5" stroke-opacity="0.9"/>
  <path d="M 12.74 30.5 A 13 13 0 1 1 17.5 35.26" fill="none" stroke="url(#m)" stroke-width="5"/>
  <circle cx="22" cy="22" r="15.7" fill="none" stroke="#2a313c" stroke-width="0.8"/>
  <circle cx="22" cy="22" r="10.4" fill="none" stroke="#313945" stroke-width="1"/>
  <path d="M 30.5 11.5 A 13 13 0 0 1 34.9 27.3" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M 22.6 35.3 A 13 13 0 0 0 32.4 31.2" fill="none" stroke="#cdd5df" stroke-opacity="0.5" stroke-width="1" stroke-linecap="round"/>
  <circle cx="12.74" cy="30.5" r="1.15" fill="#8d97a4"/>
  <circle cx="17.5" cy="35.26" r="1.15" fill="#d5dce4"/>
</svg>`;

// 光源在右：系统光标盖住环的左半，可见部分是右半+底部——高光带放在右侧
// 弧段（-45°~75°）才能在遮挡后依然呈现金属亮面。

let mountTexture = null;

function getMountTexture() {
  if (!mountTexture) {
    const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(MOUNT_SVG)}`;
    mountTexture = PIXI.Texture.from(dataUrl);
  }
  return mountTexture;
}

/** 创建挂环 Sprite（anchor 对齐环底；position 即绳锚点）。随窗口销毁由 PIXI GC。 */
export function createCharmMountSprite() {
  const sprite = new PIXI.Sprite(getMountTexture());
  sprite.anchor.set(0.5, 37.7 / 44);
  sprite.visible = false;
  return sprite;
}
