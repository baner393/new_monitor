(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TurtleExpressionGenerator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STRENGTH = Object.freeze({ subtle: 0.75, standard: 1, bold: 1.3 });
  const FEATURE_KEYS = Object.freeze(['leftEye', 'rightEye', 'mouth']);

  function cloneGrid(grid) {
    return Array.isArray(grid) ? grid.map((row) => Array.isArray(row) ? [...row] : []) : [];
  }

  function createGrid(size) {
    return Array.from({ length: size }, () => Array(size).fill(null));
  }

  function normalizeSize(value) {
    const size = Math.round(Number(value));
    return Number.isFinite(size) && size >= 8 && size <= 512 ? size : 0;
  }

  function pointKey(point) {
    return `${Math.round(point.x)},${Math.round(point.y)}`;
  }

  function parsePoint(value) {
    if (typeof value === 'string') {
      const [x, y] = value.split(',').map(Number);
      return { x: Math.round(x), y: Math.round(y) };
    }
    return { x: Math.round(Number(value?.x)), y: Math.round(Number(value?.y)) };
  }

  function normalizeRegion(region, size) {
    const x = Math.max(0, Math.min(size - 1, Math.round(Number(region?.x))));
    const y = Math.max(0, Math.min(size - 1, Math.round(Number(region?.y))));
    const w = Math.max(1, Math.min(size - x, Math.round(Number(region?.w))));
    const h = Math.max(1, Math.min(size - y, Math.round(Number(region?.h))));
    return { x, y, w, h };
  }

  function inBounds(size, x, y) {
    return x >= 0 && y >= 0 && x < size && y < size;
  }

  function inRegion(region, x, y) {
    return x >= region.x && y >= region.y && x < region.x + region.w && y < region.y + region.h;
  }

  function expandRegion(region, padding, size) {
    const x = Math.max(0, region.x - padding);
    const y = Math.max(0, region.y - padding);
    const right = Math.min(size, region.x + region.w + padding);
    const bottom = Math.min(size, region.y + region.h + padding);
    return { x, y, w: right - x, h: bottom - y };
  }

  function featureMeta(grid, feature, size) {
    const region = normalizeRegion(feature.region, size);
    const seen = new Set();
    const pixels = [];
    for (const raw of feature.pixels || []) {
      const point = parsePoint(raw);
      const key = pointKey(point);
      if (!seen.has(key) && inBounds(size, point.x, point.y) && inRegion(region, point.x, point.y)) {
        seen.add(key);
        pixels.push({ ...point, color: grid[point.y]?.[point.x] || null });
      }
    }
    if (!pixels.length) return { region, pixels, bounds: null, center: null, color: '#171922' };
    const xs = pixels.map((point) => point.x);
    const ys = pixels.map((point) => point.y);
    const bounds = {
      x: Math.min(...xs), y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs) + 1,
      h: Math.max(...ys) - Math.min(...ys) + 1,
    };
    const colors = new Map();
    for (const point of pixels) {
      if (point.color) colors.set(point.color, (colors.get(point.color) || 0) + 1);
    }
    const color = [...colors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '#171922';
    return {
      region, pixels, bounds,
      center: { x: bounds.x + (bounds.w - 1) / 2, y: bounds.y + (bounds.h - 1) / 2 },
      color,
    };
  }

  function nearestBackground(grid, excluded, size, x, y) {
    for (let radius = 1; radius <= 6; radius++) {
      const candidates = [];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const px = x + dx;
          const py = y + dy;
          if (!inBounds(size, px, py) || excluded.has(`${px},${py}`)) continue;
          const color = grid[py]?.[px];
          if (color) candidates.push(color);
        }
      }
      if (candidates.length) {
        const counts = new Map();
        for (const color of candidates) counts.set(color, (counts.get(color) || 0) + 1);
        return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }
    }
    return null;
  }

  function restoreFeatureBackground(grid, meta, size) {
    const excluded = new Set(meta.pixels.map(pointKey));
    for (const point of meta.pixels) {
      grid[point.y][point.x] = nearestBackground(grid, excluded, size, point.x, point.y);
    }
  }

  function setPixel(grid, size, region, x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (color && inBounds(size, x, y) && (!region || inRegion(region, x, y))) grid[y][x] = color;
  }

  function drawScaledFeature(grid, size, meta, factor) {
    restoreFeatureBackground(grid, meta, size);
    const drawn = new Set();
    for (const point of meta.pixels) {
      const x = Math.round(meta.center.x + (point.x - meta.center.x) * factor);
      const y = Math.round(meta.center.y + (point.y - meta.center.y) * factor);
      const color = point.color || meta.color;
      setPixel(grid, size, meta.region, x, y, color);
      drawn.add(`${x},${y}`);
    }
    if (factor > 1.2) {
      for (const key of [...drawn]) {
        const [x, y] = key.split(',').map(Number);
        if (!drawn.has(`${x + 2},${y}`) && drawn.has(`${x + 1},${y + 1}`)) {
          setPixel(grid, size, meta.region, x + 1, y, grid[y]?.[x]);
        }
      }
    }
  }

  function drawArc(grid, size, meta, direction, strength, region = meta.region) {
    restoreFeatureBackground(grid, meta, size);
    const width = Math.max(3, Math.min(region.w, Math.round(meta.bounds.w * (1 + 0.2 * strength))));
    const height = Math.max(2, Math.min(region.h, Math.round(Math.max(meta.bounds.h, width * 0.4))));
    const startX = Math.round(meta.center.x - (width - 1) / 2);
    for (let dx = 0; dx < width; dx++) {
      const t = width === 1 ? 0 : dx / (width - 1);
      const curve = 4 * t * (1 - t);
      const y = Math.round(meta.center.y + direction * (curve - 0.5) * Math.max(1, height / 2));
      setPixel(grid, size, region, startX + dx, y, meta.color);
      if (strength > 1.1 && dx > 0 && dx < width - 1) setPixel(grid, size, region, startX + dx, y + 1, meta.color);
    }
  }

  function drawPainEye(grid, size, meta, strength) {
    restoreFeatureBackground(grid, meta, size);
    const width = Math.max(3, Math.min(meta.region.w, Math.round(meta.bounds.w * (1 + 0.15 * strength))));
    const height = Math.max(3, Math.min(meta.region.h, Math.round(meta.bounds.h * (1 + 0.15 * strength))));
    const left = Math.round(meta.center.x - (width - 1) / 2);
    const top = Math.round(meta.center.y - (height - 1) / 2);
    for (let step = 0; step < Math.max(width, height); step++) {
      const x = left + Math.round(step * (width - 1) / Math.max(1, Math.max(width, height) - 1));
      const y1 = top + Math.round(step * (height - 1) / Math.max(1, Math.max(width, height) - 1));
      const y2 = top + height - 1 - Math.round(step * (height - 1) / Math.max(1, Math.max(width, height) - 1));
      setPixel(grid, size, meta.region, x, y1, meta.color);
      setPixel(grid, size, meta.region, x, y2, meta.color);
    }
  }

  function drawBlink(grid, size, meta, strength) {
    restoreFeatureBackground(grid, meta, size);
    const width = Math.max(2, Math.min(meta.region.w, Math.round(meta.bounds.w * (1 + 0.1 * strength))));
    const startX = Math.round(meta.center.x - (width - 1) / 2);
    const y = Math.round(meta.center.y);
    for (let dx = 0; dx < width; dx++) setPixel(grid, size, meta.region, startX + dx, y, meta.color);
  }

  function drawPullMouth(grid, size, meta, strength) {
    restoreFeatureBackground(grid, meta, size);
    const safe = expandRegion(meta.region, Math.max(2, Math.round(meta.bounds.h * 0.7)), size);
    const width = Math.max(3, Math.min(safe.w, Math.round(meta.bounds.w * (1.05 + 0.2 * strength))));
    const height = Math.max(3, Math.min(safe.h, Math.round(meta.bounds.h * (1.4 + 0.35 * strength))));
    const left = Math.round(meta.center.x - (width - 1) / 2);
    const top = Math.max(safe.y, Math.round(meta.center.y - height * 0.25));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = width <= 1 ? 0 : (x / (width - 1)) * 2 - 1;
        const ny = height <= 1 ? 0 : (y / (height - 1)) * 2 - 1;
        const distance = nx * nx + ny * ny;
        if (distance <= 1) setPixel(grid, size, safe, left + x, top + y, distance > 0.58 ? meta.color : '#321923');
      }
    }
    const tongueY = Math.min(safe.y + safe.h - 1, top + height - 1);
    const tongueWidth = Math.max(2, Math.floor(width * 0.55));
    const tongueLeft = Math.round(meta.center.x - (tongueWidth - 1) / 2);
    for (let x = 0; x < tongueWidth; x++) setPixel(grid, size, safe, tongueLeft + x, tongueY, '#ff80a0');
  }

  function validateGenerationInput(baseGrid, size, features) {
    const errors = [];
    const warnings = [];
    const normalizedSize = normalizeSize(size);
    if (!normalizedSize) errors.push('画布尺寸必须在 8–512 像素之间');
    if (!Array.isArray(baseGrid) || baseGrid.length !== normalizedSize
      || baseGrid.some((row) => !Array.isArray(row) || row.length !== normalizedSize)) {
      errors.push('基础皮肤网格与目标尺寸不一致');
    }
    if (!features || typeof features !== 'object') errors.push('缺少五官标记');
    if (!errors.length) {
      for (const key of FEATURE_KEYS) {
        const feature = features[key];
        if (!feature?.region) errors.push(`缺少${key === 'mouth' ? '嘴巴' : key === 'leftEye' ? '左眼' : '右眼'}区域`);
        else {
          const meta = featureMeta(baseGrid, feature, normalizedSize);
          if (!meta.pixels.length) errors.push(`${key === 'mouth' ? '嘴巴' : key === 'leftEye' ? '左眼' : '右眼'}没有有效像素`);
          else if (meta.pixels.length < 2) warnings.push(`${key} 标记像素过少，生成结果可能不稳定`);
        }
      }
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  function generateExpressions(baseGrid, size, features, options = {}) {
    const validation = validateGenerationInput(baseGrid, size, features);
    if (!validation.valid) throw new Error(validation.errors.join('；'));
    const strength = STRENGTH[options.strength] || STRENGTH.standard;
    const metas = Object.fromEntries(FEATURE_KEYS.map((key) => [key, featureMeta(baseGrid, features[key], size)]));
    const results = { idle: { grid: cloneGrid(baseGrid), size } };

    let grid = cloneGrid(baseGrid);
    drawScaledFeature(grid, size, metas.leftEye, 1 + 0.28 * strength);
    drawScaledFeature(grid, size, metas.rightEye, 1 + 0.28 * strength);
    drawScaledFeature(grid, size, metas.mouth, Math.max(0.72, 1 - 0.18 * strength));
    results.hover = { grid, size };

    grid = cloneGrid(baseGrid);
    drawScaledFeature(grid, size, metas.leftEye, 1 + 0.42 * strength);
    drawScaledFeature(grid, size, metas.rightEye, 1 + 0.42 * strength);
    drawPullMouth(grid, size, metas.mouth, strength);
    results.pull = { grid, size };

    grid = cloneGrid(baseGrid);
    drawArc(grid, size, metas.leftEye, 1, strength);
    drawArc(grid, size, metas.rightEye, 1, strength);
    drawArc(grid, size, metas.mouth, 1, strength, expandRegion(metas.mouth.region, 1, size));
    results.happy = { grid, size };

    grid = cloneGrid(baseGrid);
    drawPainEye(grid, size, metas.leftEye, strength);
    drawPainEye(grid, size, metas.rightEye, strength);
    results.pain = { grid, size };

    grid = cloneGrid(baseGrid);
    drawBlink(grid, size, metas.leftEye, strength);
    drawBlink(grid, size, metas.rightEye, strength);
    results.blink = { grid, size };

    return { results, warnings: validation.warnings };
  }

  return {
    cloneGrid,
    createGrid,
    generateExpressions,
    validateGenerationInput,
  };
});
