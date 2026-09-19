/**
 * ring-icons.js — 环形菜单像素图标（24×24 crispEdges）
 *
 * SVG 路径逐字照抄 mockup（.project-memory/proposals/radial-menu-mockup.html
 * 的 ICON 对象，设计文档 §1.5 定稿），运行时经 data URL 转成 PIXI 纹理。
 * 模块加载即预热全部纹理（SVG 图像异步解码，开环时必须已就绪）。
 */
import * as PIXI from 'pixi.js';

const ICON_COLOR = '#e8eefc';

function svgWrap(inner) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" shape-rendering="crispEdges" fill="${ICON_COLOR}">${inner}</svg>`,
  )}`;
}

const ICON_SVG = {
  monitor: `
    <rect x="3" y="5" width="18" height="12" rx="1" fill="none" stroke="${ICON_COLOR}" stroke-width="2"/>
    <rect x="6" y="8" width="4" height="6" fill="${ICON_COLOR}"/>
    <rect x="12" y="8" width="2" height="2" fill="${ICON_COLOR}"/>
    <rect x="12" y="12" width="6" height="2" fill="${ICON_COLOR}"/>
    <line x1="10" y1="17" x2="10" y2="20" stroke="${ICON_COLOR}" stroke-width="2"/>
    <line x1="14" y1="17" x2="14" y2="20" stroke="${ICON_COLOR}" stroke-width="2"/>`,
  gear: `
    <rect x="10" y="2" width="4" height="3" fill="${ICON_COLOR}"/>
    <rect x="10" y="19" width="4" height="3" fill="${ICON_COLOR}"/>
    <rect x="2" y="10" width="3" height="4" fill="${ICON_COLOR}"/>
    <rect x="19" y="10" width="3" height="4" fill="${ICON_COLOR}"/>
    <rect x="4" y="4" width="3" height="3" fill="${ICON_COLOR}"/>
    <rect x="17" y="4" width="3" height="3" fill="${ICON_COLOR}"/>
    <rect x="4" y="17" width="3" height="3" fill="${ICON_COLOR}"/>
    <rect x="17" y="17" width="3" height="3" fill="${ICON_COLOR}"/>
    <rect x="8" y="8" width="8" height="8" fill="none" stroke="${ICON_COLOR}" stroke-width="2"/>
    <rect x="10" y="10" width="4" height="4" fill="${ICON_COLOR}"/>`,
  palette: `
    <path d="M12 3 A9 9 0 1 0 21 12 L17 12 A1.5 1.5 0 0 0 15.5 13.5 L15.5 15 A1.5 1.5 0 0 0 14 16.5 L8 16.5 A3 3 0 0 1 5 13.5 A9 9 0 0 1 12 3 Z"
          fill="none" stroke="${ICON_COLOR}" stroke-width="2"/>
    <rect x="6" y="9" width="3" height="3" fill="${ICON_COLOR}"/>
    <rect x="10" y="6" width="3" height="3" fill="${ICON_COLOR}"/>
    <rect x="15" y="9" width="3" height="3" fill="${ICON_COLOR}"/>`,
  eyeOff: `
    <path d="M3 12 C5 7 8 5 12 5 C16 5 19 7 21 12 C19 17 16 19 12 19 C8 19 5 17 3 12 Z"
          fill="none" stroke="${ICON_COLOR}" stroke-width="2"/>
    <rect x="11" y="11" width="2" height="2" fill="${ICON_COLOR}"/>
    <line x1="4" y1="4" x2="20" y2="20" stroke="${ICON_COLOR}" stroke-width="2.5"/>`,
  tag: `
    <path d="M11 3 L20 3 L20 12 L12 20 L3 11 Z" fill="none" stroke="${ICON_COLOR}" stroke-width="2"/>
    <rect x="14" y="6" width="3" height="3" fill="${ICON_COLOR}"/>`,
  toggle: `
    <rect x="3" y="8" width="18" height="8" rx="4" fill="none" stroke="${ICON_COLOR}" stroke-width="2"/>
    <circle cx="8" cy="12" r="3" fill="${ICON_COLOR}"/>`,
  book: `
    <path d="M4 3 L11 3 L11 21 L4 21 Z" fill="none" stroke="${ICON_COLOR}" stroke-width="2"/>
    <path d="M13 3 L20 3 L20 21 L13 21 Z" fill="none" stroke="${ICON_COLOR}" stroke-width="2"/>`,
  brush: `
    <path d="M3 21 L8 16 L17 7 L19 5 L15 9 L6 18 Z" fill="${ICON_COLOR}"/>
    <rect x="16" y="3" width="6" height="6" rx="1" fill="none" stroke="${ICON_COLOR}" stroke-width="2"/>`,
  chat: `
    <path d="M3 4 L21 4 L21 15 L11 15 L6 20 L6 15 L3 15 Z" fill="none" stroke="${ICON_COLOR}" stroke-width="2" stroke-linejoin="round"/>
    <rect x="6" y="7" width="9" height="2" fill="${ICON_COLOR}"/>
    <rect x="6" y="10" width="6" height="2" fill="${ICON_COLOR}"/>`,
};

const textures = new Map();

/** 预热全部图标纹理（模块加载即调用一次）。 */
export function preloadRingIconTextures() {
  for (const [key, inner] of Object.entries(ICON_SVG)) {
    if (!textures.has(key)) {
      textures.set(key, PIXI.Texture.from(svgWrap(inner)));
    }
  }
}

export function getRingIconTexture(iconKey) {
  return textures.get(iconKey) || PIXI.Texture.WHITE;
}
