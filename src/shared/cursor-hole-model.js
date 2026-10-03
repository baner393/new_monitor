// Normalized coordinates keep the attachment in the same place across cursor sizes.
export function cursorProfileKey(role, id) { return `${role}:${id}`; }

export function normalizeCursorProfiles(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, profile] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*:[a-f0-9]{64}$/.test(key) || !profile) continue;
    const { u, v, radius } = profile;
    if ([u, v, radius].every(Number.isFinite) && u >= 0 && u <= 1 && v >= 0 && v <= 1 && radius >= 0.025 && radius <= 0.2) {
      result[key] = { u, v, radius };
    }
  }
  return result;
}

export function validateCursorHole(frames, profile) {
  if (!profile || ![profile.u, profile.v, profile.radius].every(Number.isFinite)
    || profile.u < 0 || profile.u > 1 || profile.v < 0 || profile.v > 1 || profile.radius < 0.025 || profile.radius > 0.2) {
    return { valid: false, reason: '孔位或孔径无效' };
  }
  if (!frames?.length) return { valid: false, reason: '没有可用的光标图像' };
  for (const frame of frames) {
    const { width, height, pixels, alpha, hotspot } = frame;
    if (!(width > 0 && height > 0) || (!pixels && !alpha)) return { valid: false, reason: '光标图像无法读取' };
    const cx = profile.u * width, cy = profile.v * height;
    const radius = profile.radius * Math.min(width, height);
    const canvas = cursorMountGeometry(frame, profile).canvas;
    if (canvas.width > 256 || canvas.height > 256) return { valid: false, reason: '完整挂环超出 Windows 光标画布上限，请缩小孔径或调整孔位' };
    const rim = radius * 1.4;
    if (cx - rim < 0 || cy - rim < 0 || cx + rim >= width || cy + rim >= height) return { valid: false, reason: '孔圈超出光标边缘，请缩小孔径' };
    if (hotspot && Math.hypot(cx - hotspot.x - 0.5, cy - hotspot.y - 0.5) <= rim + 1) return { valid: false, reason: '孔圈不能遮住点击尖端' };
    if (hotspot) {
      const geometry = cursorMountGeometry(frame, profile);
      const scale = geometry.ringScale;
      const rx = (hotspot.x + 0.5 - geometry.center.x - 0.2 * (hotspot.y + 0.5 - geometry.center.y)) / scale;
      const ry = (hotspot.y + 0.5 - geometry.center.y) / scale;
      if (rx >= 0 && Math.abs(Math.hypot(rx / 10, ry / 13) - 1) * 10 <= 2.7 + 1 / scale) return { valid: false, reason: '挂环不能遮住点击尖端，请调整孔位' };
    }
    let samples = 0, transparentSamples = 0;
    for (let y = Math.floor(cy - rim); y <= Math.ceil(cy + rim); y++) {
      for (let x = Math.floor(cx - rim); x <= Math.ceil(cx + rim); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const distance = Math.hypot(dx, dy);
        if (distance > rim) continue;
        samples++;
        if (distance < radius) {
          const geometry = cursorMountGeometry(frame, profile), scale = geometry.ringScale;
          for (const sy of [0.25, 0.75]) for (const sx of [0.25, 0.75]) {
            const px = x + sx, py = y + sy;
            const rx = (px - geometry.center.x - 0.2 * (py - geometry.center.y)) / scale;
            const ry = (py - geometry.center.y) / scale;
            if (Math.hypot(px - cx, py - cy) < radius && Math.abs(Math.hypot(rx / 10, ry / 13) - 1) * 10 > 1.1) transparentSamples++;
          }
        }
        if ((alpha ? alpha[y * width + x] : pixels[(y * width + x) * 4 + 3]) < 200) {
          return { valid: false, reason: '此位置不能在所有动画帧和尺寸中容纳完整孔圈' };
        }
      }
    }
    if (!samples || !transparentSamples) return { valid: false, reason: '光标太小，无法显示完整穿孔，请增大孔径' };
  }
  return { valid: true, reason: '' };
}

export function findDefaultCursorHole(frames) {
  // Search from the lower part of the art; use a small but visible hole first.
  for (const radius of [0.05, 0.06, 0.07, 0.08, 0.04, 0.03]) {
    for (let iy = 18; iy >= 2; iy--) {
      for (let ix = 2; ix <= 18; ix++) {
        const profile = { u: ix / 20, v: iy / 20, radius };
        if (validateCursorHole(frames, profile).valid) return profile;
      }
    }
  }
  return null;
}

export const CURSOR_RING_SHAPE = Object.freeze({ radiusX: 10, radiusY: 13, shear: 0.2, wire: 1.1, centerToAnchor: 15.7 });

export function cursorMountGeometry(frame, profile) {
  const hole = { x: profile.u * frame.width, y: profile.v * frame.height, radius: profile.radius * Math.min(frame.width, frame.height) };
  const ringScale = hole.radius / 2.5;
  const center = { x: hole.x + CURSOR_RING_SHAPE.radiusY * CURSOR_RING_SHAPE.shear * ringScale, y: hole.y + CURSOR_RING_SHAPE.radiusY * ringScale };
  const origin = { x: Math.max(0, Math.ceil(15 * ringScale - center.x)), y: Math.max(0, Math.ceil(4 * ringScale - hole.y)) };
  // Windows rounds odd cursor bitmap dimensions down. Padding to even dimensions
  // preserves every source pixel and leaves the original hotspot unchanged.
  const canvas = { origin, width: Math.ceil((Math.max(frame.width, Math.ceil(center.x + 15 * ringScale)) + origin.x) / 2) * 2, height: Math.ceil((Math.max(frame.height, Math.ceil(hole.y + 30 * ringScale)) + origin.y) / 2) * 2 };
  const anchor = { x: center.x + CURSOR_RING_SHAPE.shear * CURSOR_RING_SHAPE.radiusY * ringScale,
    y: center.y + CURSOR_RING_SHAPE.radiusY * ringScale };
  return { hole, center, canvas, ringScale, mountOffset: { x: hole.x - (frame.hotspot?.x || 0), y: hole.y - (frame.hotspot?.y || 0) }, anchor,
    ringGeometry: { centerFromAnchor: { x: center.x - anchor.x, y: center.y - anchor.y },
      // Contact the metal strand's center, not its antialiased transparent edge.
      radiusX: CURSOR_RING_SHAPE.radiusX * ringScale, radiusY: CURSOR_RING_SHAPE.radiusY * ringScale, shear: CURSOR_RING_SHAPE.shear } };
}

export function resizeCursorFrame(frame, width, height = width) {
  if (frame.width === width && frame.height === height) return frame;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (Math.min(frame.height - 1, Math.floor(y * frame.height / height)) * frame.width + Math.min(frame.width - 1, Math.floor(x * frame.width / width))) * 4;
    pixels.set(frame.pixels.subarray(source, source + 4), (y * width + x) * 4);
  }
  return { ...frame, width, height, hotspot: { x: Math.floor((frame.hotspot?.x || 0) * width / frame.width), y: Math.floor((frame.hotspot?.y || 0) * height / frame.height) }, pixels };
}

export function punchCursorPixels(frame, profile) {
  const { hole, center, ringScale: scale, canvas } = cursorMountGeometry(frame, profile);
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  // Painter's ordering is the same as Pixi's scene graph (MIT). Baking the rigid
  // mount into the native image also makes cursor and ring one OS compositor item.
  // https://github.com/pixijs/pixijs/tree/v7.4.3/packages/display
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const sum = [0, 0, 0, 0];
    for (const sy of [0.25, 0.75]) for (const sx of [0.25, 0.75]) {
      const px = x + sx - canvas.origin.x, py = y + sy - canvas.origin.y;
      const rx = (px - center.x - CURSOR_RING_SHAPE.shear * (py - center.y)) / scale;
      const ry = (py - center.y) / scale;
      const ellipse = Math.hypot(rx / CURSOR_RING_SHAPE.radiusX, ry / CURSOR_RING_SHAPE.radiusY);
      const strand = Math.abs(ellipse - 1) * CURSOR_RING_SHAPE.radiusX;
      const front = rx >= 0;
      const metal = strand <= CURSOR_RING_SHAPE.wire;
      const edge = strand > 0.85;
      const highlight = Math.max(0, 1 - Math.abs(strand - 0.4) / 0.4);
      const tone = edge ? 48 : Math.round(112 + highlight * 125 + Math.max(0, -ry / 13) * 12);
      const wire = [tone, Math.min(255, tone + 7), Math.min(255, tone + 15), 255];
      let color = metal && !front ? wire : [0, 0, 0, 0];
      const ix = Math.floor(px), iy = Math.floor(py);
      const distance = Math.hypot(px - hole.x, py - hole.y);
      if (ix >= 0 && iy >= 0 && ix < frame.width && iy < frame.height && distance >= hole.radius) {
        const offset = (iy * frame.width + ix) * 4, alpha = frame.pixels[offset + 3] / 255;
        if (alpha) {
          const shadow = front && strand > 1.1 && strand < 1.9 ? 0.58 : 1;
          const a = alpha + color[3] / 255 * (1 - alpha);
          color = [0, 1, 2].map(channel => (frame.pixels[offset + channel] * shadow * alpha + color[channel] * color[3] / 255 * (1 - alpha)) / a).concat(a * 255);
        }
      }
      if (distance >= hole.radius && distance <= hole.radius * 1.4) {
        const light = Math.round(125 + 100 * (hole.x - px + hole.y - py) / (Math.max(distance, 0.01) * 1.42));
        color = [light, Math.min(255, light + 6), Math.min(255, light + 13), 255];
      }
      if (metal && front) color = wire;
      if (frame.hotspot && ix === frame.hotspot.x && iy === frame.hotspot.y) {
        color = [...frame.pixels.subarray((iy * frame.width + ix) * 4, (iy * frame.width + ix) * 4 + 4)];
      }
      for (let channel = 0; channel < 3; channel++) sum[channel] += color[channel] * color[3] / 255;
      sum[3] += color[3];
    }
    const offset = (y * canvas.width + x) * 4;
    for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = sum[3] ? Math.round(sum[channel] * 255 / sum[3]) : 0;
    pixels[offset + 3] = Math.round(sum[3] / 4);
  }
  return { ...frame, width: canvas.width, height: canvas.height, hotspot: { x: (frame.hotspot?.x || 0) + canvas.origin.x, y: (frame.hotspot?.y || 0) + canvas.origin.y }, pixels };
}
