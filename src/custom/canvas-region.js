// ── Fullscreen Region Marker (Two-Step: Region → Pixels) ─────
// Step 1: Drag to select bounding box region for left eye, right eye, mouth
// Step 2: Click/drag within region to select actual pixel positions
// Returns { leftEye, rightEye, mouth } each with { region, pixels }

(function () {
  'use strict';

  const imageCanvas = document.getElementById('imageCanvas');
  const imgCtx = imageCanvas.getContext('2d');
  const overlayCanvas = document.getElementById('overlayCanvas');
  const olCtx = overlayCanvas.getContext('2d');
  const canvasArea = document.getElementById('canvasArea');
  const regionLeftEyeBtn = document.getElementById('regionLeftEyeBtn');
  const regionRightEyeBtn = document.getElementById('regionRightEyeBtn');
  const regionMouthBtn = document.getElementById('regionMouthBtn');
  const pixelLeftEyeBtn = document.getElementById('pixelLeftEyeBtn');
  const pixelRightEyeBtn = document.getElementById('pixelRightEyeBtn');
  const pixelMouthBtn = document.getElementById('pixelMouthBtn');
  const clearBtn = document.getElementById('clearBtn');
  const confirmBtn = document.getElementById('confirmBtn');
  const resolutionSelect = document.getElementById('resolutionSelect');
  const regionStatus = document.getElementById('regionStatus');
  const statusText = document.getElementById('statusText');

  // ── State ──
  let originalImage = null;
  let gridSize = 64;
  let pixelScale = 8;
  let zoomPercent = 100;
  let pixelGrid = [];  // [y][x] = 'rgb(...)' | null

  // Data: { leftEye, rightEye, mouth } each = { region: {x,y,w,h}, pixels: Set<string> }
  const data = {
    leftEye:  { region: null, pixels: new Set() },
    rightEye: { region: null, pixels: new Set() },
    mouth:    { region: null, pixels: new Set() },
  };

  let mode = null;  // 'region-leftEye' | 'region-rightEye' | 'region-mouth' | 'pixel-leftEye' | 'pixel-rightEye' | 'pixel-mouth' | null
  let isDragging = false;
  let dragStart = null;
  let dragCur = null;

  const COLORS = {
    leftEye:  { fill: 'rgba(100,200,255,0.35)', stroke: '#66ccff', pixel: '#44aaff', label: '左眼' },
    rightEye: { fill: 'rgba(100,255,150,0.35)', stroke: '#66ff99', pixel: '#44dd88', label: '右眼' },
    mouth:    { fill: 'rgba(255,150,100,0.35)', stroke: '#ff9966', pixel: '#ff7744', label: '嘴巴' },
  };

  function setStatus(t) { if (statusText) statusText.textContent = t; }

  function updateStatus() {
    const p = [];
    for (const [key, c] of Object.entries(COLORS)) {
      const d = data[key];
      if (d.region && d.pixels.size > 0) p.push(c.label + ': ✓');
      else if (d.region) p.push(c.label + ': 区域已选');
    }
    if (regionStatus) regionStatus.textContent = p.join(' | ') || '未标记';
    // Enable confirm only if all 3 have both region + pixels
    const allDone = Object.keys(COLORS).every(k => data[k].region && data[k].pixels.size > 0);
    confirmBtn.disabled = !allDone;
  }

  function getKeyFromMode(m) {
    if (!m) return null;
    return m.replace('region-', '').replace('pixel-', '');
  }

  function isRegionMode(m) { return m && m.startsWith('region-'); }
  function isPixelMode(m) { return m && m.startsWith('pixel-'); }

  // ── Grid helpers ──
  function createEmptyGrid(size) {
    const g = [];
    for (let y = 0; y < size; y++) { g[y] = []; for (let x = 0; x < size; x++) g[y][x] = null; }
    return g;
  }

  function readImageToGrid(img, size) {
    const tc = document.createElement('canvas');
    tc.width = size; tc.height = size;
    const tctx = tc.getContext('2d');
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(img, 0, 0, size, size);
    const id = tctx.getImageData(0, 0, size, size);
    const g = createEmptyGrid(size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (id.data[i + 3] > 128) {
          g[y][x] = 'rgb(' + id.data[i] + ',' + id.data[i + 1] + ',' + id.data[i + 2] + ')';
        }
      }
    }
    return g;
  }

  // ── Zoom ──
  function getFitScale() {
    const areaW = canvasArea.clientWidth - 40;
    const areaH = canvasArea.clientHeight - 40;
    return Math.max(2, Math.floor(Math.min(areaW, areaH) / gridSize));
  }

  function setZoom(pct) {
    zoomPercent = Math.max(25, Math.min(1600, pct));
    const fitScale = getFitScale();
    pixelScale = Math.max(1, Math.round(fitScale * zoomPercent / 100));
    resizeCanvas();
  }

  function resizeCanvas() {
    imageCanvas.width = gridSize * pixelScale;
    imageCanvas.height = gridSize * pixelScale;
    overlayCanvas.width = imageCanvas.width;
    overlayCanvas.height = imageCanvas.height;
    overlayCanvas.style.width = imageCanvas.clientWidth + 'px';
    overlayCanvas.style.height = imageCanvas.clientHeight + 'px';
    imgCtx.imageSmoothingEnabled = false;
    redrawCanvas();
    drawOverlay();
  }

  function redrawCanvas() {
    imgCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const color = pixelGrid[y]?.[x];
        if (color) {
          imgCtx.fillStyle = color;
          imgCtx.fillRect(x * pixelScale, y * pixelScale, pixelScale, pixelScale);
        }
      }
    }
    // Grid lines
    if (pixelScale >= 3) {
      imgCtx.strokeStyle = 'rgba(255,255,255,0.1)';
      imgCtx.lineWidth = 0.5;
      for (let x = 0; x <= gridSize; x++) {
        imgCtx.beginPath();
        imgCtx.moveTo(x * pixelScale + 0.5, 0);
        imgCtx.lineTo(x * pixelScale + 0.5, imageCanvas.height);
        imgCtx.stroke();
      }
      for (let y = 0; y <= gridSize; y++) {
        imgCtx.beginPath();
        imgCtx.moveTo(0, y * pixelScale + 0.5);
        imgCtx.lineTo(imageCanvas.width, y * pixelScale + 0.5);
        imgCtx.stroke();
      }
    }
  }

  // ── Overlay ──
  function drawOverlay() {
    olCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    for (const [key, c] of Object.entries(COLORS)) {
      const d = data[key];
      // Draw region bounding box
      if (d.region) {
        const r = d.region;
        const x = r.x * pixelScale, y = r.y * pixelScale;
        const w = r.w * pixelScale, h = r.h * pixelScale;
        olCtx.strokeStyle = c.stroke;
        olCtx.lineWidth = 2;
        olCtx.setLineDash([4, 4]);
        olCtx.strokeRect(x, y, w, h);
        olCtx.setLineDash([]);
        olCtx.fillStyle = c.stroke;
        olCtx.font = 'bold 11px sans-serif';
        olCtx.fillText(c.label + ' 区域', x + 4, y - 4 > 12 ? y - 4 : y + 14);
      }
      // Draw selected pixels
      let drawn = 0;
      for (const pk of d.pixels) {
        const [px, py] = pk.split(',').map(Number);
        olCtx.fillStyle = c.pixel;
        olCtx.fillRect(px * pixelScale, py * pixelScale, pixelScale, pixelScale);
        olCtx.strokeStyle = c.stroke;
        olCtx.lineWidth = 1;
        olCtx.strokeRect(px * pixelScale + 0.5, py * pixelScale + 0.5, pixelScale - 1, pixelScale - 1);
        drawn++;
      }
      if (drawn > 0) console.log('[Overlay] Drawing', drawn, 'pixels for', key);
    }

    // Draw drag preview
    if (isDragging && dragStart && dragCur && isRegionMode(mode)) {
      const key = getKeyFromMode(mode);
      const c = COLORS[key];
      const x = Math.min(dragStart.x, dragCur.x) * pixelScale;
      const y = Math.min(dragStart.y, dragCur.y) * pixelScale;
      const w = (Math.abs(dragCur.x - dragStart.x) + 1) * pixelScale;
      const h = (Math.abs(dragCur.y - dragStart.y) + 1) * pixelScale;
      olCtx.fillStyle = c.fill;
      olCtx.fillRect(x, y, w, h);
      olCtx.strokeStyle = c.stroke;
      olCtx.lineWidth = 2;
      olCtx.strokeRect(x, y, w, h);
    }
  }

  // ── Grid coordinate from mouse ──
  function getGridPos(e) {
    const rect = overlayCanvas.getBoundingClientRect();
    const gx = Math.floor((e.clientX - rect.left) / (rect.width / gridSize));
    const gy = Math.floor((e.clientY - rect.top) / (rect.height / gridSize));
    return { x: Math.max(0, Math.min(gridSize - 1, gx)), y: Math.max(0, Math.min(gridSize - 1, gy)) };
  }

  // ── Mode management ──
  function enterMode(m) {
    // Toggle off if same mode clicked
    if (mode === m) {
      mode = null;
    } else {
      mode = m;
    }
    // Update button states
    regionLeftEyeBtn.classList.toggle('active-region', mode === 'region-leftEye');
    regionRightEyeBtn.classList.toggle('active-region', mode === 'region-rightEye');
    regionMouthBtn.classList.toggle('active-region', mode === 'region-mouth');
    pixelLeftEyeBtn.classList.toggle('active-pixel', mode === 'pixel-leftEye');
    pixelRightEyeBtn.classList.toggle('active-pixel', mode === 'pixel-rightEye');
    pixelMouthBtn.classList.toggle('active-pixel', mode === 'pixel-mouth');
    // Mark buttons as done if region/pixels are set
    const le = data.leftEye, re = data.rightEye, mo = data.mouth;
    regionLeftEyeBtn.classList.toggle('done', le.region && mode !== 'region-leftEye');
    regionRightEyeBtn.classList.toggle('done', re.region && mode !== 'region-rightEye');
    regionMouthBtn.classList.toggle('done', mo.region && mode !== 'region-mouth');
    pixelLeftEyeBtn.classList.toggle('done', le.pixels.size > 0 && mode !== 'pixel-leftEye');
    pixelRightEyeBtn.classList.toggle('done', re.pixels.size > 0 && mode !== 'pixel-rightEye');
    pixelMouthBtn.classList.toggle('done', mo.pixels.size > 0 && mode !== 'pixel-mouth');
    // Pointer events
    overlayCanvas.style.pointerEvents = mode ? 'auto' : 'none';
    overlayCanvas.style.cursor = mode ? 'crosshair' : '';
    // Status message
    if (isRegionMode(mode)) {
      const key = getKeyFromMode(mode);
      setStatus('在图片上拖拽框选 ' + COLORS[key].label + ' 区域...');
    } else if (isPixelMode(mode)) {
      const key = getKeyFromMode(mode);
      if (!data[key].region) {
        setStatus('⚠️ 请先框选 ' + COLORS[key].label + ' 区域');
        mode = null;
        // Re-update buttons after resetting mode
        pixelLeftEyeBtn.classList.remove('active-pixel');
        pixelRightEyeBtn.classList.remove('active-pixel');
        pixelMouthBtn.classList.remove('active-pixel');
        overlayCanvas.style.pointerEvents = 'none';
        overlayCanvas.style.cursor = '';
        updateStatus();
        drawOverlay();
        return;
      }
      setStatus('点击或拖拽选择 ' + COLORS[key].label + ' 像素位置... (已选 ' + data[key].pixels.size + ' 个)');
    } else {
      setStatus('就绪 — 先框选区域，再标记像素');
    }
    updateStatus();
    drawOverlay();
  }

  // ── Button events ──
  regionLeftEyeBtn.addEventListener('click', () => enterMode('region-leftEye'));
  regionRightEyeBtn.addEventListener('click', () => enterMode('region-rightEye'));
  regionMouthBtn.addEventListener('click', () => enterMode('region-mouth'));
  pixelLeftEyeBtn.addEventListener('click', () => enterMode('pixel-leftEye'));
  pixelRightEyeBtn.addEventListener('click', () => enterMode('pixel-rightEye'));
  pixelMouthBtn.addEventListener('click', () => enterMode('pixel-mouth'));

  clearBtn.addEventListener('click', () => {
    for (const k of Object.keys(data)) {
      data[k].region = null;
      data[k].pixels = new Set();
    }
    updateStatus();
    updateButtons();
    drawOverlay();
  });

  function updateButtons() {
    regionLeftEyeBtn.classList.remove('active-region', 'done');
    regionRightEyeBtn.classList.remove('active-region', 'done');
    regionMouthBtn.classList.remove('active-region', 'done');
    pixelLeftEyeBtn.classList.remove('active-pixel', 'done');
    pixelRightEyeBtn.classList.remove('active-pixel', 'done');
    pixelMouthBtn.classList.remove('active-pixel', 'done');
  }

  // ── Mouse events on overlay ──
  overlayCanvas.addEventListener('mousedown', (e) => {
    if (!mode || e.button !== 0) return;
    isDragging = true;
    dragStart = getGridPos(e);
    dragCur = { ...dragStart };
    drawOverlay();
  });

  overlayCanvas.addEventListener('mousemove', (e) => {
    if (!isDragging || !mode) return;
    dragCur = getGridPos(e);
    drawOverlay();
  });

  overlayCanvas.addEventListener('mouseup', (e) => {
    if (!isDragging || !mode || e.button !== 0) return;
    isDragging = false;
    const end = getGridPos(e);
    const key = getKeyFromMode(mode);

    if (isRegionMode(mode)) {
      // Region selection: store bounding box
      const x = Math.min(dragStart.x, end.x);
      const y = Math.min(dragStart.y, end.y);
      const w = Math.abs(end.x - dragStart.x) + 1;
      const h = Math.abs(end.y - dragStart.y) + 1;
      if (w >= 2 && h >= 2) {
        data[key].region = { x, y, w, h };
        // Auto-clear pixels when region changes
        data[key].pixels = new Set();
        setStatus(COLORS[key].label + ' 区域已设置 (' + w + '×' + h + ') — 现在标记像素');
      }
    } else if (isPixelMode(mode)) {
      // Pixel selection: add pixels within drag area
      const minX = Math.min(dragStart.x, end.x);
      const maxX = Math.max(dragStart.x, end.x);
      const minY = Math.min(dragStart.y, end.y);
      const maxY = Math.max(dragStart.y, end.y);
      const r = data[key].region;
      let added = 0;
      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          // Only add if within region and has actual pixel data
          if (r && px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h && pixelGrid[py]?.[px]) {
            data[key].pixels.add(px + ',' + py);
            added++;
          }
        }
      }
      console.log('[Region] Added', added, 'pixels for', key, '- total:', data[key].pixels.size);
      setStatus(COLORS[key].label + ' 已选择 ' + data[key].pixels.size + ' 个像素');
    }

    dragStart = dragCur = null;
    updateStatus();
    drawOverlay();
  });

  // ── Wheel zoom ──
  canvasArea.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(zoomPercent + (e.deltaY > 0 ? -10 : 10));
  }, { passive: false });

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoomPercent + 25); }
    else if (e.key === '-') { e.preventDefault(); setZoom(zoomPercent - 25); }
    else if (e.key === '0') { e.preventDefault(); setZoom(100); }
    else if (e.key === 'Escape') { window.close(); }
  });

  // ── Resolution selector ──
  resolutionSelect.addEventListener('change', () => {
    if (!originalImage) return;
    const val = resolutionSelect.value;
    gridSize = val === 'original' ? Math.max(originalImage.width, originalImage.height) : parseInt(val, 10);
    pixelGrid = readImageToGrid(originalImage, gridSize);
    // Clear all data on resolution change
    for (const k of Object.keys(data)) {
      data[k].region = null;
      data[k].pixels = new Set();
    }
    updateStatus();
    resizeCanvas();
    setStatus('分辨率: ' + gridSize + '×' + gridSize);
  });

  // ── Confirm ──
  confirmBtn.addEventListener('click', () => {
    // Convert pixel Sets to arrays for IPC, mapping back to original image coordinates
    const originalSize = Math.max(originalImage.width, originalImage.height);
    const scaleFactor = originalSize / gridSize;  // gridSize → original size

    const result = {};
    for (const [key, d] of Object.entries(data)) {
      // Scale region back to original coordinates
      let scaledRegion = null;
      if (d.region) {
        scaledRegion = {
          x: Math.round(d.region.x * scaleFactor),
          y: Math.round(d.region.y * scaleFactor),
          w: Math.round(d.region.w * scaleFactor),
          h: Math.round(d.region.h * scaleFactor),
        };
      }
      // Scale pixel coordinates back to original coordinates
      const scaledPixels = Array.from(d.pixels).map(s => {
        const [x, y] = s.split(',').map(Number);
        return {
          x: Math.round(x * scaleFactor),
          y: Math.round(y * scaleFactor),
        };
      });
      result[key] = { region: scaledRegion, pixels: scaledPixels };
    }

    console.log('[Confirm] Grid size:', gridSize, '→ Original:', originalSize, 'Scale:', scaleFactor);
    console.log('[Confirm] Left eye pixels:', result.leftEye.pixels.length);

    // Pass resolution along with region data
    result.resolution = gridSize;

    if (window.electronAPI?.regionMarkDone) {
      window.electronAPI.regionMarkDone(result);
    }
    window.close();
  });

  document.getElementById('closeBtn').addEventListener('click', () => {
    if (window.electronAPI?.regionMarkDone) {
      window.electronAPI.regionMarkDone(null);
    }
    window.close();
  });

  // ── Init ──
  async function init() {
    try {
      const data = await window.electronAPI.requestRegionImage();
      if (!data || !data.dataUrl) {
        setStatus('没有收到图片数据');
        return;
      }
      const img = new Image();
      img.onload = () => {
        originalImage = img;
        gridSize = Math.max(img.width, img.height);
        resolutionSelect.value = 'original';
        pixelGrid = readImageToGrid(img, gridSize);
        // Count non-null pixels
        let pixelCount = 0;
        for (let y = 0; y < gridSize; y++) for (let x = 0; x < gridSize; x++) {
          if (pixelGrid[y]?.[x]) pixelCount++;
        }
        console.log('[Init] Image loaded:', img.width, 'x', img.height, '- Grid:', gridSize, '- Pixels:', pixelCount);
        zoomPercent = 100;
        resizeCanvas();
        setStatus('图片已加载 (' + img.width + '×' + img.height + ') — 滚轮缩放');
      };
      img.src = data.dataUrl;
    } catch (err) {
      setStatus('加载失败: ' + err.message);
    }
  }

  init();
})();
