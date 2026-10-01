/**
 * charm-foil.js — 宠物挂饰的透明全息反光资产（随皮肤生成）
 *
 * 效果配方（用户确认的 v6 效果图）：宠物平时是原色精灵；摆动掠过反光角时
 * 表面泛起彩虹衍射反光，原图常驻；反光纹理以 SCREEN 合成，
 * 透明底不再随翻转盖黑图案；边缘套银虹彩金属描边。
 *
 * 资产全部由 canvas 2d 一次性生成（与效果图 node 配方同源），运行时是
 * 纯 Sprite：无逐帧像素操作。生成输入是皮肤 idle 帧，皮肤切换时重建。
 *
 * 层级（均以皮肤 idle 形状裁剪，形状 mask 由调用方用 idle 纹理 Sprite 提供）：
 *   foil  — 透明箔面（3 道微弯彩虹反光 + 亮部微弱金色反光）
 *   band  — 斜向彩虹光带（运行时横向移动扫过）
 *   edge  — 银虹彩描边（alpha 膨胀环带，银渐变 × 轮廓位置色相偏移）
 */

const FOIL_SCALE = 3;   // 纹理分辨率 = 皮肤帧 × 3（抗像素锯齿）
const EDGE_PAD = 10;    // 银边纹理的外扩边距（膨胀 2px×3 + 余量）

function hsl(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const lerp = (a, b, f) => a + (b - a) * f;
const mix = (c1, c2, f) => [lerp(c1[0], c2[0], f), lerp(c1[1], c2[1], f), lerp(c1[2], c2[2], f)];
const clamp255 = (v) => Math.max(0, Math.min(255, v));
function rainbow(t) {
  const RAINBOW = [
    [255, 120, 200], [170, 110, 255], [90, 200, 255], [90, 230, 210], [255, 215, 120],
  ];
  const n = RAINBOW.length;
  const x = ((t % 1) + 1) % 1 * n;
  const i = Math.floor(x) % n;
  const f = x - Math.floor(x);
  return mix(RAINBOW[i], RAINBOW[(i + 1) % n], f);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * 生成挂饰箔资产。
 * @param {HTMLImageElement|HTMLCanvasElement} skinFrame 皮肤 idle 帧
 * @returns {{ foil: HTMLCanvasElement, band: HTMLCanvasElement, edge: HTMLCanvasElement,
 *            back: HTMLCanvasElement, backSheen: HTMLCanvasElement,
 *            size: number, pad: number, grip: {x:number,y:number} }}
 */
export function buildFoilAssets(skinFrame, grip = { x: 0.5, y: 0.12 }) {
  const W = skinFrame.width, H = skinFrame.height;
  const S = W * FOIL_SCALE;
  const SH = H * FOIL_SCALE;

  // 放大的精灵底图（nearest 保像素）
  const base = makeCanvas(S, SH);
  const bctx = base.getContext('2d');
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(skinFrame, 0, 0, S, SH);
  const baseData = bctx.getImageData(0, 0, S, SH);

  // alpha / luma 场 + 可见像素紧致边界（侧棱贴可见轮廓而非帧缘）
  const alpha = new Float32Array(S * SH);
  const luma = new Float32Array(S * SH);
  let minX = S, maxX = -1, minY = SH, maxY = -1;
  for (let i = 0; i < S * SH; i++) {
    alpha[i] = baseData.data[i * 4 + 3] / 255;
    luma[i] = (0.299 * baseData.data[i * 4] + 0.587 * baseData.data[i * 4 + 1] + 0.114 * baseData.data[i * 4 + 2]) / 255 * alpha[i];
    if (alpha[i] > 0.1) {
      const x = i % S, y = (i / S) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  // 背板只借用轮廓 alpha，绝不读取正面颜色或亮度，动画图案不会透到背面。
  const back = makeCanvas(S, SH);
  const backCtx = back.getContext('2d');
  const backImage = backCtx.createImageData(S, SH);
  const backSheen = makeCanvas(S, SH);
  const sheenCtx = backSheen.getContext('2d');
  const sheenImage = sheenCtx.createImageData(S, SH);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x, di = i << 2;
      const a = alpha[i];
      if (a <= 0.05) continue;
      const u = x / S, v = y / SH;
      // 银色明暗截面：窄亮肩、宽暗部、第二道弱反射，细拉丝保持低对比。
      const coord = u * 0.82 + v * 0.28;
      const shoulder = Math.exp(-Math.pow((coord - 0.28) / 0.085, 2));
      const broad = Math.exp(-Math.pow((coord - 0.77) / 0.23, 2));
      const brush = Math.sin(y * 1.7 + Math.sin(x * 0.037) * 0.5) * 3;
      const silver = 116 + shoulder * 101 + broad * 53 - v * 18 + brush;
      backImage.data[di] = clamp255(silver);
      backImage.data[di + 1] = clamp255(silver + 5);
      backImage.data[di + 2] = clamp255(silver + 12);
      backImage.data[di + 3] = Math.round(a * 255);
      const glint = Math.exp(-Math.pow((coord - 0.46) / 0.09, 2));
      sheenImage.data[di] = 242;
      sheenImage.data[di + 1] = 248;
      sheenImage.data[di + 2] = 255;
      sheenImage.data[di + 3] = Math.round(a * glint * 255);
    }
  }
  backCtx.putImageData(backImage, 0, 0);
  sheenCtx.putImageData(sheenImage, 0, 0);

  // ── 箔面：只有局部反光，透明背景不能遮盖原图 ──
  const foil = makeCanvas(S, SH);
  const fctx = foil.getContext('2d');
  const fimg = fctx.createImageData(S, SH);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const di = i << 2;
      const a = alpha[i];
      if (a <= 0.05) { fimg.data[di + 3] = 0; continue; }
      let c = [0, 0, 0];
      let reflection = 0;
      // 3 道微弯彩虹条纹（发光）
      for (const [strip, width] of [[0.22, 0.05], [0.5, 0.032], [0.78, 0.055]]) {
        const coord = x / S * 0.7 + y / SH * 0.5 + Math.sin(y / SH * 6.28 + strip * 9) * 0.04;
        const dist = Math.abs(((coord % 1) + 1) % 1 - strip);
        const dd = Math.min(dist, 1 - dist);
        if (dd < width) {
          const k = 1 - dd / width;
          c = rainbow(strip * 1.7);
          reflection = Math.max(reflection, k * k * 0.65);
        }
      }
      // 只保留轻微的亮部金色反光，不增加不透明底色。
      const L = luma[i] / Math.max(a, 0.001);
      if (L > 0.55) {
        const gold = (L - 0.55) / 0.45 * 0.04;
        c = mix(c, [255, 224, 150], gold);
        reflection = Math.max(reflection, gold);
      }
      fimg.data[di] = clamp255(c[0]); fimg.data[di + 1] = clamp255(c[1]); fimg.data[di + 2] = clamp255(c[2]);
      fimg.data[di + 3] = Math.round(a * reflection * 255);
    }
  }
  fctx.putImageData(fimg, 0, 0);

  // ── 光带：斜向彩虹 + 白闪（可移动 Sprite，透明底）──
  const bandW = S * 2, bandH = SH;
  const band = makeCanvas(bandW, bandH);
  const bandCtx = band.getContext('2d');
  const bg = bandCtx.createLinearGradient(0, 0, bandW, bandH);
  bg.addColorStop(0.30, 'rgba(255,120,200,0)');
  bg.addColorStop(0.44, 'rgba(170,110,255,0.6)');
  bg.addColorStop(0.52, 'rgba(90,220,255,0.6)');
  bg.addColorStop(0.62, 'rgba(255,215,120,0.45)');
  bg.addColorStop(0.72, 'rgba(255,255,255,0)');
  bandCtx.fillStyle = bg;
  bandCtx.fillRect(0, 0, bandW, bandH);
  // 白闪窄条
  const wg = bandCtx.createLinearGradient(0, 0, bandW, bandH);
  wg.addColorStop(0.56, 'rgba(255,255,255,0)');
  wg.addColorStop(0.6, 'rgba(255,255,255,0.75)');
  wg.addColorStop(0.64, 'rgba(255,255,255,0)');
  bandCtx.fillStyle = wg;
  bandCtx.fillRect(0, 0, bandW, bandH);

  // ── 银虹彩边：膨胀环带 ──
  const EP = EDGE_PAD;
  const edge = makeCanvas(S + EP * 2, SH + EP * 2);
  const ectx = edge.getContext('2d');
  const eimg = ectx.createImageData(S + EP * 2, SH + EP * 2);
  const EW = S + EP * 2, EH = SH + EP * 2;
  for (let y = 0; y < EH; y++) {
    for (let x = 0; x < EW; x++) {
      const di = (y * EW + x) << 2;
      // 膨胀 2px（源尺度 ×3 → 6px 纹理尺度）
      let d = 0, al = 0;
      for (let dy = -6; dy <= 6; dy += 2) {
        for (let dx = -6; dx <= 6; dx += 2) {
          const nx = x - EP + dx, ny = y - EP + dy;
          if (nx < 0 || ny < 0 || nx >= S || ny >= SH) continue;
          const v = alpha[ny * S + nx];
          if (v > d) d = v;
          if (nx === x - EP + dx && ny === y - EP + dy && v > al && Math.abs(dx) <= 3 && Math.abs(dy) <= 3) al = v;
        }
      }
      if (d > 0.05 && al <= 0.05) {
        const t = (x / EW + y / EH) / 2;
        let c = mix([244, 248, 252], [138, 148, 162], t);
        const [hr, hg, hb] = hsl(((t * 2.4) % 1 + 1) % 1, 0.45, 0.74);
        c = mix(c, [hr, hg, hb], 0.3);
        eimg.data[di] = c[0]; eimg.data[di + 1] = c[1]; eimg.data[di + 2] = c[2];
        eimg.data[di + 3] = Math.round(d * 255);
      } else eimg.data[di + 3] = 0;
    }
  }
  ectx.putImageData(eimg, 0, 0);

  return {
    foil, band, edge, back, backSheen, size: S, frameW: W, frameH: H, pad: EDGE_PAD, grip,
    // 可见像素紧致边界（源帧像素坐标）：厚度侧棱贴这个轮廓
    tight: { lx: minX / FOIL_SCALE, rx: (maxX + 1) / FOIL_SCALE, ty: minY / FOIL_SCALE, by: (maxY + 1) / FOIL_SCALE },
  };
}

/**
 * 实心侧壁纹理：可见轮廓内填满金属渐变——
 * 沿高度的冷银渐变，alpha 保留宠物形状；倒角截面由翻转姿态的 tint 分层。
 * 行段网格沿投影深度轴展开 N 层，任意角度的侧壁都贴着轮廓。
 */
export function buildSlabTexture(skinFrame) {
  const W = skinFrame.width, H = skinFrame.height;
  const S = W * FOIL_SCALE, SH = H * FOIL_SCALE;
  const src = makeCanvas(S, SH);
  const sctx = src.getContext('2d');
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(skinFrame, 0, 0, S, SH);
  const srcData = sctx.getImageData(0, 0, S, SH);

  const c = makeCanvas(S, SH);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, SH);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x, di = i << 2;
      const a = srcData.data[di + 3] / 255;
      if (a <= 0.1) { img.data[di + 3] = 0; continue; }
      const t = y / SH;
      const col = mix([232, 238, 245], [160, 173, 190], t); // 实心侧壁保持银色，避免中段像黑色空腔
      img.data[di] = clamp255(col[0]); img.data[di + 1] = clamp255(col[1]); img.data[di + 2] = clamp255(col[2]);
      img.data[di + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 每个不透明行段一张四边形；深度展开时窄行也能覆盖完整侧壁。 */
export function buildSlabGeometry(texture, grip = { x: 0.5, y: 0.12 }) {
  const { width, height } = texture;
  const pixels = texture.getContext('2d').getImageData(0, 0, width, height).data;
  const vertices = [], uvs = [], indices = [];
  // 资产用 nearest 放大三倍，同一个源像素行只需一张四边形。
  for (let y = 0; y < height; y += FOIL_SCALE) {
    for (let x = 0; x < width;) {
      if (pixels[(y * width + x) * 4 + 3] <= 25) { x++; continue; }
      const left = x;
      while (x < width && pixels[(y * width + x) * 4 + 3] > 25) x++;
      const right = x, bottom = Math.min(height, y + FOIL_SCALE);
      const index = vertices.length / 2;
      vertices.push(left - grip.x * width, y - grip.y * height,
        right - grip.x * width, y - grip.y * height,
        right - grip.x * width, bottom - grip.y * height,
        left - grip.x * width, bottom - grip.y * height);
      // 横向只采样行段内部金属色，不让透明边缘随厚度展开。
      const u = (left + right) / (2 * width);
      uvs.push(u, (y + 0.5) / height, u, (y + 0.5) / height,
        u, (bottom - 0.5) / height, u, (bottom - 0.5) / height);
      indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
    }
  }
  return { vertices: new Float32Array(vertices), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}
