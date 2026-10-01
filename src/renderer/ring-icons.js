/** 九项轮盘图标：统一的 24×24 圆角线条 SVG。 */
import * as PIXI from 'pixi.js';

const ICON_SVG = {
  monitor: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M9 21h6M12 18v3M6 8h5M6 11h3"/>',
  gear: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.5 1.5m10.4 10.4 1.5 1.5m0-13.4-1.5 1.5M6.8 17.2l-1.5 1.5"/><circle cx="12" cy="12" r="8" stroke-opacity=".65"/>',
  palette: '<path d="M12 3a9 9 0 1 0 9 9c0-1.4-1.2-2.2-2.5-1.7-2 .8-2.9-.2-2.9-1.4 0-1.4 1.3-2.2 1.3-3.2C16.9 4.2 14.7 3 12 3Z"/><circle cx="6.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="7.8" cy="16" r="1"/>',
  eyeOff: '<path d="M3 12c2.2-3.8 5.2-5.7 9-5.7s6.8 1.9 9 5.7c-2.2 3.8-5.2 5.7-9 5.7S5.2 15.8 3 12Z"/><circle cx="12" cy="12" r="2.7"/><path d="M3 3 21 21"/>',
  chat: '<path d="M4 4h16v13H9l-5 4V4Z"/><path d="M8 9h8M8 13h5"/>',
  tag: '<path d="M3 4h10l8 8-9 9-9-9V4Z"/><circle cx="8" cy="9" r="1.4"/>',
  toggle: '<rect x="2.5" y="7" width="19" height="10" rx="5"/><circle cx="15.5" cy="12" r="3"/>',
  book: '<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/>',
  brush: '<path d="m4 20 5-1 10-10-4-4L5 15l-1 5ZM13 7l4 4M16 4l2-2 4 4-2 2"/>',
};

const textures = new Map();
const ICON_RESOLUTION = 3;

/** 构造轮盘时一次性创建纹理，避免首次展开才启动 SVG 解码。 */
export function preloadRingIconTextures() {
  for (const [key, path] of Object.entries(ICON_SVG)) {
    if (textures.has(key)) continue;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    textures.set(key, PIXI.Texture.from(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, {
      resolution: ICON_RESOLUTION,
      resourceOptions: { scale: ICON_RESOLUTION },
      scaleMode: PIXI.SCALE_MODES.LINEAR,
    }));
  }
}

export function getRingIconTexture(iconKey) {
  return textures.get(iconKey) || PIXI.Texture.WHITE;
}
