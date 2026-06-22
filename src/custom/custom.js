// ── Custom Mode: Pixel Art Editor ─────────────────────────────
// Full IIFE — tabs, skin converter, pixel canvas, expression editor

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  // Constants & Shared Helpers
  // ══════════════════════════════════════════════════════════════

  const EXPR_DEFAULT_SIZE = 24;

  const EXPRESSIONS = [
    { id: 'idle',   name: 'Idle',   trigger: '默认待机状态',          states: ['idle'] },
    { id: 'hover',  name: 'Hover',  trigger: '鼠标悬停时触发',        states: ['hover'] },
    { id: 'pull',   name: 'Pull',   trigger: '拖拽时触发',            states: ['pull'] },
    { id: 'happy',  name: 'Happy',  trigger: '双击或长时间悬停',      states: ['happy'] },
    { id: 'pain',   name: 'Pain',   trigger: '受到伤害时触发',        states: ['pain'] },
    { id: 'blink',  name: 'Blink',  trigger: '随机眨眼动画',          states: ['blink'] },
  ];

  function createEmptyGrid(size) {
    const grid = [];
    for (let y = 0; y < size; y++) {
      grid[y] = [];
      for (let x = 0; x < size; x++) grid[y][x] = null;
    }
    return grid;
  }

  function cloneGrid(grid) {
    return grid.map(row => [...row]);
  }

  function setStatus(text) {
    const el = document.getElementById('statusText');
    if (el) el.textContent = text;
  }

  function gridToImageData(grid, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = grid[y]?.[x];
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    return canvas;
  }

  function downloadCanvas(canvas, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  // ══════════════════════════════════════════════════════════════
  // 1. Tab Switching
  // ══════════════════════════════════════════════════════════════

  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.tab-panel');
  let activeTab = 'converter';

  function switchTab(tabId) {
    activeTab = tabId;
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    panels.forEach(p => p.classList.toggle('active', p.id === 'panel-' + tabId));
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Close button
  document.getElementById('closeBtn')?.addEventListener('click', () => window.close());

  // ══════════════════════════════════════════════════════════════
  // 2. Skin Converter (Tab 1)
  // ══════════════════════════════════════════════════════════════

  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const converterPreview = document.getElementById('converterPreview');
  const originalCanvas = document.getElementById('originalCanvas');
  const convertedCanvas = document.getElementById('convertedCanvas');
  const converterInfo = document.getElementById('converterInfo');
  const convertBtn = document.getElementById('convertBtn');
  const convertPreviewBtn = document.getElementById('convertPreviewBtn');

  let converterImage = null;

  // Drag & drop + click
  dropZone?.addEventListener('click', () => fileInput?.click());
  dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) loadConverterFile(file);
  });

  fileInput?.addEventListener('change', (e) => {
    if (e.target.files?.[0]) loadConverterFile(e.target.files[0]);
  });

  function loadConverterFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        converterImage = img;
        // Show original
        originalCanvas.width = img.width;
        originalCanvas.height = img.height;
        originalCanvas.getContext('2d').drawImage(img, 0, 0);
        // Show converted (pixelated at native res)
        convertedCanvas.width = img.width;
        convertedCanvas.height = img.height;
        const cctx = convertedCanvas.getContext('2d');
        cctx.imageSmoothingEnabled = false;
        cctx.drawImage(img, 0, 0);
        converterInfo.textContent = `${img.width}×${img.height} px`;
        converterPreview.style.display = '';
        convertBtn.disabled = false;
        convertPreviewBtn.disabled = false;
        setStatus(`皮肤已加载: ${file.name} (${img.width}×${img.height})`);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  convertBtn?.addEventListener('click', () => {
    if (!converterImage) return;
    downloadCanvas(convertedCanvas, 'idle.png');
    setStatus('已导出 idle.png');
  });

  convertPreviewBtn?.addEventListener('click', () => {
    if (!converterImage) return;
    setStatus(`预览: ${converterImage.width}×${converterImage.height} — idle 帧`);
  });

  // ══════════════════════════════════════════════════════════════
  // 3. Pixel Canvas (Tab 2)
  // ══════════════════════════════════════════════════════════════

  const drawCanvas = document.getElementById('drawCanvas');
  const drawCtx = drawCanvas.getContext('2d');
  const canvasContainer = document.getElementById('canvasContainer');
  const penColorInput = document.getElementById('penColor');
  const toolPenBtn = document.getElementById('toolPen');
  const toolEraserBtn = document.getElementById('toolEraser');
  const toolFillBtn = document.getElementById('toolFill');
  const toolEyedropperBtn = document.getElementById('toolEyedropper');
  const toolUndoBtn = document.getElementById('toolUndo');
  const toolClearBtn = document.getElementById('toolClear');
  const zoomLevelLabel = document.getElementById('zoomLevel');
  const zoomInBtn = document.getElementById('toolZoomIn');
  const zoomOutBtn = document.getElementById('toolZoomOut');
  const fullscreenBtn = document.getElementById('toolFullscreen');
  const exportCanvasBtn = document.getElementById('exportCanvasBtn');
  const canvasSizeSelect = document.getElementById('canvasSize');

  let canvasGridSize = 64;
  let pixelGrid = createEmptyGrid(canvasGridSize);
  let pixelScale = 8;
  let canvasZoomPercent = 100;
  let canvasCurrentTool = 'pen';
  let canvasIsDrawing = false;
  let canvasHistory = [];
  let canvasHistoryIndex = -1;
  let canvasBrushSize = 1;

  // Panning state
  let canvasIsPanning = false;
  let canvasPanStartX = 0;
  let canvasPanStartY = 0;
  let canvasPanOffsetX = 0;
  let canvasPanOffsetY = 0;
  let canvasPanOriginX = 0;
  let canvasPanOriginY = 0;

  function getCanvasBaseScale() {
    if (!canvasContainer) return 8;
    const areaW = canvasContainer.clientWidth - 40;
    const areaH = canvasContainer.clientHeight - 40;
    return Math.max(2, Math.floor(Math.min(areaW, areaH) / canvasGridSize));
  }

  function setCanvasZoom(pct) {
    canvasZoomPercent = Math.max(25, Math.min(800, pct));
    const fit = getCanvasBaseScale();
    pixelScale = Math.max(1, Math.round(fit * canvasZoomPercent / 100));
    resizeCanvas();
    zoomLevelLabel.textContent = canvasZoomPercent + '%';
  }

  function resetCanvasPan() {
    canvasPanOffsetX = 0;
    canvasPanOffsetY = 0;
    drawCanvas.style.transform = '';
  }

  function initDrawCanvas() {
    canvasGridSize = parseInt(canvasSizeSelect?.value || '64', 10);
    pixelGrid = createEmptyGrid(canvasGridSize);
    canvasHistory = [];
    canvasHistoryIndex = -1;
    resetCanvasPan();
    const fit = getCanvasBaseScale();
    pixelScale = fit;
    canvasZoomPercent = 100;
    zoomLevelLabel.textContent = '100%';
    resizeCanvas();
    pushCanvasHistory();
    setStatus(`画布初始化: ${canvasGridSize}×${canvasGridSize}`);
  }

  function resizeCanvas() {
    drawCanvas.width = canvasGridSize * pixelScale;
    drawCanvas.height = canvasGridSize * pixelScale;
    drawCtx.imageSmoothingEnabled = false;
    redrawCanvas();
  }

  function redrawCanvas() {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    for (let y = 0; y < canvasGridSize; y++) {
      for (let x = 0; x < canvasGridSize; x++) {
        const c = pixelGrid[y]?.[x];
        if (c) {
          drawCtx.fillStyle = c;
          drawCtx.fillRect(x * pixelScale, y * pixelScale, pixelScale, pixelScale);
        }
      }
    }
    drawCanvasGridLines();
  }

  function drawCanvasGridLines() {
    if (pixelScale < 4) return;
    drawCtx.strokeStyle = 'rgba(255,255,255,0.08)';
    drawCtx.lineWidth = 0.5;
    for (let x = 0; x <= canvasGridSize; x++) {
      drawCtx.beginPath();
      drawCtx.moveTo(x * pixelScale + 0.5, 0);
      drawCtx.lineTo(x * pixelScale + 0.5, drawCanvas.height);
      drawCtx.stroke();
    }
    for (let y = 0; y <= canvasGridSize; y++) {
      drawCtx.beginPath();
      drawCtx.moveTo(0, y * pixelScale + 0.5);
      drawCtx.lineTo(drawCanvas.width, y * pixelScale + 0.5);
      drawCtx.stroke();
    }
  }

  function pushCanvasHistory() {
    const snap = cloneGrid(pixelGrid);
    canvasHistory = canvasHistory.slice(0, canvasHistoryIndex + 1);
    canvasHistory.push(snap);
    canvasHistoryIndex = canvasHistory.length - 1;
    if (canvasHistory.length > 50) { canvasHistory.shift(); canvasHistoryIndex--; }
  }

  function canvasUndo() {
    if (canvasHistoryIndex > 0) {
      canvasHistoryIndex--;
      pixelGrid = cloneGrid(canvasHistory[canvasHistoryIndex]);
      redrawCanvas();
    }
  }

  function canvasGetPixelPos(e) {
    const rect = drawCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / pixelScale);
    const y = Math.floor((e.clientY - rect.top) / pixelScale);
    return { x: Math.max(0, Math.min(canvasGridSize - 1, x)), y: Math.max(0, Math.min(canvasGridSize - 1, y)) };
  }

  function canvasDrawPixel(x, y, color) {
    const half = Math.floor(canvasBrushSize / 2);
    for (let dy = -half; dy < canvasBrushSize - half; dy++) {
      for (let dx = -half; dx < canvasBrushSize - half; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || px >= canvasGridSize || py < 0 || py >= canvasGridSize) continue;
        pixelGrid[py][px] = color;
        drawCtx.fillStyle = color;
        drawCtx.fillRect(px * pixelScale, py * pixelScale, pixelScale, pixelScale);
        if (pixelScale >= 4) {
          drawCtx.strokeStyle = 'rgba(255,255,255,0.08)';
          drawCtx.lineWidth = 0.5;
          drawCtx.strokeRect(px * pixelScale + 0.5, py * pixelScale + 0.5, pixelScale, pixelScale);
        }
      }
    }
  }

  function canvasErasePixel(x, y) {
    const half = Math.floor(canvasBrushSize / 2);
    for (let dy = -half; dy < canvasBrushSize - half; dy++) {
      for (let dx = -half; dx < canvasBrushSize - half; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || px >= canvasGridSize || py < 0 || py >= canvasGridSize) continue;
        pixelGrid[py][px] = null;
        drawCtx.clearRect(px * pixelScale, py * pixelScale, pixelScale, pixelScale);
      }
    }
  }

  function canvasFloodFill(startX, startY, fillColor) {
    const startColor = pixelGrid[startY]?.[startX] || null;
    if (startColor === fillColor) return;
    const stack = [[startX, startY]];
    const visited = new Set();
    while (stack.length > 0) {
      const [cx, cy] = stack.pop();
      const key = cx + ',' + cy;
      if (visited.has(key)) continue;
      if (cx < 0 || cx >= canvasGridSize || cy < 0 || cy >= canvasGridSize) continue;
      if (pixelGrid[cy][cx] !== startColor) continue;
      visited.add(key);
      pixelGrid[cy][cx] = fillColor;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    redrawCanvas();
  }

  function selectCanvasTool(tool) {
    canvasCurrentTool = tool;
    [toolPenBtn, toolEraserBtn, toolFillBtn, toolEyedropperBtn].forEach(b => b?.classList.remove('active'));
    if (tool === 'pen') toolPenBtn?.classList.add('active');
    else if (tool === 'eraser') toolEraserBtn?.classList.add('active');
    else if (tool === 'fill') toolFillBtn?.classList.add('active');
    else if (tool === 'eyedropper') toolEyedropperBtn?.classList.add('active');
  }

  toolPenBtn?.addEventListener('click', () => selectCanvasTool('pen'));
  toolEraserBtn?.addEventListener('click', () => selectCanvasTool('eraser'));
  toolFillBtn?.addEventListener('click', () => selectCanvasTool('fill'));
  toolEyedropperBtn?.addEventListener('click', () => selectCanvasTool('eyedropper'));
  toolUndoBtn?.addEventListener('click', canvasUndo);
  toolClearBtn?.addEventListener('click', () => {
    pixelGrid = createEmptyGrid(canvasGridSize);
    redrawCanvas();
    pushCanvasHistory();
  });

  // Drawing events (left-click only)
  drawCanvas?.addEventListener('mousedown', (e) => {
    if (e.button === 2) return;
    const { x, y } = canvasGetPixelPos(e);
    if (canvasCurrentTool === 'eyedropper') {
      // Pick color from grid
      const color = pixelGrid[y]?.[x];
      if (color) {
        penColorInput.value = color;
        selectCanvasTool('pen');
        setStatus('已吸取颜色: ' + color);
      }
      return;
    }
    canvasIsDrawing = true;
    if (canvasCurrentTool === 'fill') { canvasFloodFill(x, y, penColorInput.value); pushCanvasHistory(); }
    else if (canvasCurrentTool === 'pen') canvasDrawPixel(x, y, penColorInput.value);
    else canvasErasePixel(x, y);
  });

  drawCanvas?.addEventListener('mousemove', (e) => {
    if (!canvasIsDrawing) return;
    const { x, y } = canvasGetPixelPos(e);
    if (canvasCurrentTool === 'pen') canvasDrawPixel(x, y, penColorInput.value);
    else if (canvasCurrentTool === 'eraser') canvasErasePixel(x, y);
  });

  drawCanvas?.addEventListener('mouseup', (e) => {
    if (e.button === 0 && canvasIsDrawing) { canvasIsDrawing = false; pushCanvasHistory(); }
  });

  drawCanvas?.addEventListener('mouseleave', () => {
    if (canvasIsDrawing) { canvasIsDrawing = false; pushCanvasHistory(); }
  });

  // Right-click panning
  canvasContainer?.addEventListener('contextmenu', (e) => e.preventDefault());

  canvasContainer?.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      canvasIsPanning = true;
      canvasPanStartX = e.clientX;
      canvasPanStartY = e.clientY;
      canvasPanOriginX = canvasPanOffsetX;
      canvasPanOriginY = canvasPanOffsetY;
      canvasContainer.style.cursor = 'grabbing';
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!canvasIsPanning) return;
    canvasPanOffsetX = canvasPanOriginX + (e.clientX - canvasPanStartX);
    canvasPanOffsetY = canvasPanOriginY + (e.clientY - canvasPanStartY);
    drawCanvas.style.transform = 'translate(' + canvasPanOffsetX + 'px, ' + canvasPanOffsetY + 'px)';
  });

  document.addEventListener('mouseup', (e) => {
    if (e.button === 2 && canvasIsPanning) {
      canvasIsPanning = false;
      if (canvasContainer) canvasContainer.style.cursor = '';
    }
  });

  // Zoom
  canvasContainer?.addEventListener('wheel', (e) => {
    e.preventDefault();
    setCanvasZoom(canvasZoomPercent + (e.deltaY > 0 ? -10 : 10));
  }, { passive: false });

  zoomInBtn?.addEventListener('click', () => setCanvasZoom(canvasZoomPercent + 25));
  zoomOutBtn?.addEventListener('click', () => setCanvasZoom(canvasZoomPercent - 25));

  // Canvas size change
  canvasSizeSelect?.addEventListener('change', () => initDrawCanvas());

  // Canvas brush size
  document.getElementById('canvasBrushSize')?.addEventListener('change', (e) => {
    canvasBrushSize = parseInt(e.target.value, 10) || 1;
    setStatus('画笔大小: ' + canvasBrushSize + '×' + canvasBrushSize);
  });

  // Expression brush size
  document.getElementById('exprBrushSize')?.addEventListener('change', (e) => {
    exprBrushSize = parseInt(e.target.value, 10) || 1;
    setStatus('画笔大小: ' + exprBrushSize + '×' + exprBrushSize);
  });

  // ── Resolution mode toggle for skin loading ──
  const loadResMode = document.getElementById('loadResMode');
  const loadResCustom = document.getElementById('loadResCustom');
  loadResMode?.addEventListener('change', () => {
    const isCustom = loadResMode.value === 'custom';
    if (loadResCustom) loadResCustom.style.display = isCustom ? '' : 'none';
  });

  // Export
  exportCanvasBtn?.addEventListener('click', () => {
    const out = gridToImageData(pixelGrid, canvasGridSize, canvasGridSize);
    downloadCanvas(out, 'pixel-skin.png');
    setStatus('已导出 pixel-skin.png');
  });

  // Fullscreen via IPC
  fullscreenBtn?.addEventListener('click', () => {
    if (window.electronAPI?.openCanvasWindow) {
      window.electronAPI.openCanvasWindow({ size: canvasGridSize, grid: cloneGrid(pixelGrid) });
      setStatus('已打开全屏画布窗口');
    } else {
      setStatus('electronAPI 不可用');
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 4. Expression Editor (Tab 3)
  // ══════════════════════════════════════════════════════════════

  const expressionGrid = document.getElementById('expressionGrid');
  const expressionEditor = document.getElementById('expressionEditor');
  const exprCanvas = document.getElementById('exprCanvas');
  const exprCtx = exprCanvas?.getContext('2d');
  const exprCanvasContainer = document.getElementById('exprCanvasContainer');
  const exprPenColorInput = document.getElementById('exprPenColor');
  const exprToolPenBtn = document.getElementById('exprToolPen');
  const exprToolEraserBtn = document.getElementById('exprToolEraser');
  const exprToolFillBtn = document.getElementById('exprToolFill');
  const exprToolEyedropperBtn = document.getElementById('exprToolEyedropper');
  const exprToolUndoBtn = document.getElementById('exprToolUndo');
  const exprZoomLabel = document.getElementById('exprZoomLabel');
  const exprZoomInBtn = document.getElementById('exprZoomIn');
  const exprZoomOutBtn = document.getElementById('exprZoomOut');
  const exprFullscreenBtn = document.getElementById('exprFullscreenBtn');
  const exprExportBtn = document.getElementById('exprExportBtn');
  const triggerInfo = document.getElementById('triggerInfo');
  const loadSkinsBtn = document.getElementById('loadSkinsBtn');
  const exportAllBtn = document.getElementById('exportAllBtn');
  const skinFilesInput = document.getElementById('skinFilesInput');

  let currentExprId = null;
  const cardCanvases = {};

  // exprData: { [id]: { grid, size, loaded } }
  const exprData = {};
  EXPRESSIONS.forEach(exp => {
    exprData[exp.id] = {
      grid: createEmptyGrid(EXPR_DEFAULT_SIZE),
      size: EXPR_DEFAULT_SIZE,
      loaded: false,
    };
  });

  // Expression canvas state
  let exprPixelScale = 8;
  let exprZoomPercent = 100;
  let exprCurrentTool = 'pen';
  let exprIsDrawing = false;
  let exprHistory = {};
  let exprHistoryIndex = {};
  let exprBrushSize = 1;

  // Expression panning
  let exprIsPanning = false;
  let exprPanStartX = 0;
  let exprPanStartY = 0;
  let exprPanOffsetX = 0;
  let exprPanOffsetY = 0;
  let exprPanOriginX = 0;
  let exprPanOriginY = 0;

  function getExprSize() {
    if (!currentExprId || !exprData[currentExprId]) return EXPR_DEFAULT_SIZE;
    return exprData[currentExprId].size;
  }

  // ── Build expression cards ──
  function buildExpressionCards() {
    expressionGrid.innerHTML = '';
    EXPRESSIONS.forEach(exp => {
      const card = document.createElement('div');
      card.className = 'expression-card';
      card.dataset.id = exp.id;

      // Thumbnail canvas with checkerboard bg
      const thumb = document.createElement('canvas');
      thumb.width = 48;
      thumb.height = 48;
      thumb.style.width = '48px';
      thumb.style.height = '48px';
      cardCanvases[exp.id] = thumb;

      const nameDiv = document.createElement('div');
      nameDiv.className = 'name';
      nameDiv.textContent = exp.name;

      const triggerDiv = document.createElement('div');
      triggerDiv.className = 'trigger';
      triggerDiv.textContent = exp.trigger;

      card.appendChild(thumb);
      card.appendChild(nameDiv);
      card.appendChild(triggerDiv);

      card.addEventListener('click', () => selectExpression(exp.id));
      expressionGrid.appendChild(card);
    });
    refreshAllThumbnails();
  }

  function drawCheckerboard(ctx, w, h, square) {
    for (let y = 0; y < h; y += square) {
      for (let x = 0; x < w; x += square) {
        ctx.fillStyle = ((x / square + y / square) % 2 === 0) ? '#cccccc' : '#999999';
        ctx.fillRect(x, y, square, square);
      }
    }
  }

  function refreshThumbnail(exprId) {
    const thumb = cardCanvases[exprId];
    if (!thumb) return;
    const data = exprData[exprId];
    const ctx = thumb.getContext('2d');
    ctx.clearRect(0, 0, 48, 48);
    drawCheckerboard(ctx, 48, 48, 6);
    if (data && data.grid) {
      const scale = 48 / data.size;
      for (let y = 0; y < data.size; y++) {
        for (let x = 0; x < data.size; x++) {
          const c = data.grid[y]?.[x];
          if (c) {
            ctx.fillStyle = c;
            ctx.fillRect(Math.floor(x * scale), Math.floor(y * scale), Math.ceil(scale), Math.ceil(scale));
          }
        }
      }
    }
  }

  function refreshAllThumbnails() {
    EXPRESSIONS.forEach(exp => refreshThumbnail(exp.id));
  }

  function selectExpression(exprId) {
    // Save current expression data before switching
    if (currentExprId && exprData[currentExprId]) {
      exprData[currentExprId].grid = cloneGrid(pixelGrid);
    }

    currentExprId = exprId;
    const data = exprData[exprId];

    // Update card active states
    document.querySelectorAll('.expression-card').forEach(c => {
      c.classList.toggle('active', c.dataset.id === exprId);
    });

    // Show editor
    expressionEditor.style.display = '';

    // Load grid
    pixelGrid = cloneGrid(data.grid);

    // Update trigger info
    const exp = EXPRESSIONS.find(e => e.id === exprId);
    if (exp && triggerInfo) {
      triggerInfo.innerHTML =
        '<div><span class="trigger-badge ' + exp.id + '">' + exp.name + '</span></div>' +
        '<div style="margin-top:6px; font-size:11px; color:#aaa;">' + exp.trigger + '</div>' +
        '<div style="margin-top:4px; font-size:11px; color:#666;">尺寸: ' + data.size + '×' + data.size + '</div>' +
        '<div style="margin-top:2px; font-size:11px; color:#666;">状态: ' + exp.states.join(', ') + '</div>';
    }

    // Reset expr zoom
    exprZoomPercent = 100;
    const fit = getExprBaseScale();
    exprPixelScale = fit;
    exprZoomLabel.textContent = '100%';
    resetExprPan();
    resizeExprCanvas();
    setStatus('选中表情: ' + exprId + ' (' + data.size + '×' + data.size + ')');
  }

  function getExprBaseScale() {
    if (!exprCanvasContainer) return 8;
    const areaW = exprCanvasContainer.clientWidth - 40;
    const areaH = exprCanvasContainer.clientHeight - 40;
    const size = getExprSize();
    return Math.max(2, Math.floor(Math.min(areaW, areaH) / size));
  }

  function setExprZoom(pct) {
    exprZoomPercent = Math.max(25, Math.min(800, pct));
    const fit = getExprBaseScale();
    exprPixelScale = Math.max(1, Math.round(fit * exprZoomPercent / 100));
    resizeExprCanvas();
    exprZoomLabel.textContent = exprZoomPercent + '%';
  }

  function resetExprPan() {
    exprPanOffsetX = 0;
    exprPanOffsetY = 0;
    if (exprCanvas) exprCanvas.style.transform = '';
  }

  function resizeExprCanvas() {
    const size = getExprSize();
    exprCanvas.width = size * exprPixelScale;
    exprCanvas.height = size * exprPixelScale;
    exprCtx.imageSmoothingEnabled = false;
    redrawExprCanvas();
  }

  function redrawExprCanvas() {
    const size = getExprSize();
    exprCtx.clearRect(0, 0, exprCanvas.width, exprCanvas.height);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const c = pixelGrid[y]?.[x];
        if (c) {
          exprCtx.fillStyle = c;
          exprCtx.fillRect(x * exprPixelScale, y * exprPixelScale, exprPixelScale, exprPixelScale);
        }
      }
    }
    // Grid lines
    if (exprPixelScale >= 4) {
      exprCtx.strokeStyle = 'rgba(255,255,255,0.08)';
      exprCtx.lineWidth = 0.5;
      for (let x = 0; x <= size; x++) {
        exprCtx.beginPath();
        exprCtx.moveTo(x * exprPixelScale + 0.5, 0);
        exprCtx.lineTo(x * exprPixelScale + 0.5, exprCanvas.height);
        exprCtx.stroke();
      }
      for (let y = 0; y <= size; y++) {
        exprCtx.beginPath();
        exprCtx.moveTo(0, y * exprPixelScale + 0.5);
        exprCtx.lineTo(exprCanvas.width, y * exprPixelScale + 0.5);
        exprCtx.stroke();
      }
    }
  }

  function pushExprHistory() {
    if (!currentExprId) return;
    if (!exprHistory[currentExprId]) { exprHistory[currentExprId] = []; exprHistoryIndex[currentExprId] = -1; }
    const snaps = exprHistory[currentExprId];
    let idx = exprHistoryIndex[currentExprId];
    const snap = cloneGrid(pixelGrid);
    const trimmed = snaps.slice(0, idx + 1);
    trimmed.push(snap);
    exprHistory[currentExprId] = trimmed;
    exprHistoryIndex[currentExprId] = trimmed.length - 1;
    if (trimmed.length > 50) { trimmed.shift(); exprHistoryIndex[currentExprId]--; }
  }

  function exprUndo() {
    if (!currentExprId) return;
    const idx = exprHistoryIndex[currentExprId] ?? -1;
    if (idx > 0) {
      exprHistoryIndex[currentExprId] = idx - 1;
      pixelGrid = cloneGrid(exprHistory[currentExprId][exprHistoryIndex[currentExprId]]);
      redrawExprCanvas();
    }
  }

  function exprGetPixelPos(e) {
    const rect = exprCanvas.getBoundingClientRect();
    const size = getExprSize();
    const x = Math.floor((e.clientX - rect.left) / exprPixelScale);
    const y = Math.floor((e.clientY - rect.top) / exprPixelScale);
    return { x: Math.max(0, Math.min(size - 1, x)), y: Math.max(0, Math.min(size - 1, y)) };
  }

  function exprDrawPixel(x, y, color) {
    const size = getExprSize();
    const half = Math.floor(exprBrushSize / 2);
    for (let dy = -half; dy < exprBrushSize - half; dy++) {
      for (let dx = -half; dx < exprBrushSize - half; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || px >= size || py < 0 || py >= size) continue;
        pixelGrid[py][px] = color;
        exprCtx.fillStyle = color;
        exprCtx.fillRect(px * exprPixelScale, py * exprPixelScale, exprPixelScale, exprPixelScale);
        if (exprPixelScale >= 4) {
          exprCtx.strokeStyle = 'rgba(255,255,255,0.08)';
          exprCtx.lineWidth = 0.5;
          exprCtx.strokeRect(px * exprPixelScale + 0.5, py * exprPixelScale + 0.5, exprPixelScale, exprPixelScale);
        }
      }
    }
  }

  function exprErasePixel(x, y) {
    const size = getExprSize();
    const half = Math.floor(exprBrushSize / 2);
    for (let dy = -half; dy < exprBrushSize - half; dy++) {
      for (let dx = -half; dx < exprBrushSize - half; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || px >= size || py < 0 || py >= size) continue;
        pixelGrid[py][px] = null;
        exprCtx.clearRect(px * exprPixelScale, py * exprPixelScale, exprPixelScale, exprPixelScale);
      }
    }
  }

  function exprFloodFill(startX, startY, fillColor) {
    const size = getExprSize();
    const startColor = pixelGrid[startY]?.[startX] || null;
    if (startColor === fillColor) return;
    const stack = [[startX, startY]];
    const visited = new Set();
    while (stack.length > 0) {
      const [cx, cy] = stack.pop();
      const key = cx + ',' + cy;
      if (visited.has(key)) continue;
      if (cx < 0 || cx >= size || cy < 0 || cy >= size) continue;
      if (pixelGrid[cy][cx] !== startColor) continue;
      visited.add(key);
      pixelGrid[cy][cx] = fillColor;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    redrawExprCanvas();
  }

  function selectExprTool(tool) {
    exprCurrentTool = tool;
    [exprToolPenBtn, exprToolEraserBtn, exprToolFillBtn, exprToolEyedropperBtn].forEach(b => b?.classList.remove('active'));
    if (tool === 'pen') exprToolPenBtn?.classList.add('active');
    else if (tool === 'eraser') exprToolEraserBtn?.classList.add('active');
    else if (tool === 'fill') exprToolFillBtn?.classList.add('active');
    else if (tool === 'eyedropper') exprToolEyedropperBtn?.classList.add('active');
  }

  exprToolPenBtn?.addEventListener('click', () => selectExprTool('pen'));
  exprToolEraserBtn?.addEventListener('click', () => selectExprTool('eraser'));
  exprToolFillBtn?.addEventListener('click', () => selectExprTool('fill'));
  exprToolEyedropperBtn?.addEventListener('click', () => selectExprTool('eyedropper'));
  exprToolUndoBtn?.addEventListener('click', exprUndo);

  // Expression drawing events
  exprCanvas?.addEventListener('mousedown', (e) => {
    if (e.button === 2) return;
    if (!currentExprId) return;
    const { x, y } = exprGetPixelPos(e);
    if (exprCurrentTool === 'eyedropper') {
      const color = exprData[currentExprId]?.grid[y]?.[x];
      if (color) {
        exprPenColorInput.value = color;
        selectExprTool('pen');
        setStatus('已吸取颜色: ' + color);
      }
      return;
    }
    exprIsDrawing = true;
    if (exprCurrentTool === 'fill') { exprFloodFill(x, y, exprPenColorInput.value); pushExprHistory(); refreshThumbnail(currentExprId); }
    else if (exprCurrentTool === 'pen') exprDrawPixel(x, y, exprPenColorInput.value);
    else exprErasePixel(x, y);
  });

  exprCanvas?.addEventListener('mousemove', (e) => {
    if (!exprIsDrawing || !currentExprId) return;
    const { x, y } = exprGetPixelPos(e);
    if (exprCurrentTool === 'pen') exprDrawPixel(x, y, exprPenColorInput.value);
    else if (exprCurrentTool === 'eraser') exprErasePixel(x, y);
  });

  exprCanvas?.addEventListener('mouseup', (e) => {
    if (e.button === 0 && exprIsDrawing && currentExprId) {
      exprIsDrawing = false;
      pushExprHistory();
      refreshThumbnail(currentExprId);
    }
  });

  exprCanvas?.addEventListener('mouseleave', () => {
    if (exprIsDrawing && currentExprId) {
      exprIsDrawing = false;
      pushExprHistory();
      refreshThumbnail(currentExprId);
    }
  });

  // Expression panning
  exprCanvasContainer?.addEventListener('contextmenu', (e) => e.preventDefault());

  exprCanvasContainer?.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      exprIsPanning = true;
      exprPanStartX = e.clientX;
      exprPanStartY = e.clientY;
      exprPanOriginX = exprPanOffsetX;
      exprPanOriginY = exprPanOffsetY;
      exprCanvasContainer.style.cursor = 'grabbing';
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!exprIsPanning) return;
    exprPanOffsetX = exprPanOriginX + (e.clientX - exprPanStartX);
    exprPanOffsetY = exprPanOriginY + (e.clientY - exprPanStartY);
    exprCanvas.style.transform = 'translate(' + exprPanOffsetX + 'px, ' + exprPanOffsetY + 'px)';
  });

  document.addEventListener('mouseup', (e) => {
    if (e.button === 2 && exprIsPanning) {
      exprIsPanning = false;
      if (exprCanvasContainer) exprCanvasContainer.style.cursor = '';
    }
  });

  // Expression zoom
  exprCanvasContainer?.addEventListener('wheel', (e) => {
    e.preventDefault();
    setExprZoom(exprZoomPercent + (e.deltaY > 0 ? -10 : 10));
  }, { passive: false });

  exprZoomInBtn?.addEventListener('click', () => setExprZoom(exprZoomPercent + 25));
  exprZoomOutBtn?.addEventListener('click', () => setExprZoom(exprZoomPercent - 25));

  // Expression export (single)
  exprExportBtn?.addEventListener('click', () => {
    if (!currentExprId) return;
    // Save current pixelGrid to exprData
    exprData[currentExprId].grid = cloneGrid(pixelGrid);
    const data = exprData[currentExprId];
    const out = gridToImageData(data.grid, data.size, data.size);
    downloadCanvas(out, currentExprId + '.png');
    setStatus('已导出 ' + currentExprId + '.png');
  });

  // Expression fullscreen via IPC
  exprFullscreenBtn?.addEventListener('click', () => {
    if (!currentExprId) return;
    exprData[currentExprId].grid = cloneGrid(pixelGrid);
    if (window.electronAPI?.openCanvasWindow) {
      window.electronAPI.openCanvasWindow({
        size: getExprSize(),
        grid: cloneGrid(pixelGrid),
        expressionId: currentExprId,
      });
      setStatus('已打开全屏画布: ' + currentExprId);
    } else {
      setStatus('electronAPI 不可用');
    }
  });

  // ── Load existing skins ──
  loadSkinsBtn?.addEventListener('click', () => skinFilesInput?.click());

  skinFilesInput?.addEventListener('change', (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const applyAll = document.getElementById('applyAllCheckbox')?.checked || false;

    // Map: filename stem → expression id
    const nameToId = {};
    EXPRESSIONS.forEach(exp => { nameToId[exp.id] = exp.id; });
    // Also allow "idle.png" → "idle" etc
    const nameMap = {};
    EXPRESSIONS.forEach(exp => {
      nameMap[exp.id.toLowerCase()] = exp.id;
      nameMap[exp.id.toLowerCase() + '.png'] = exp.id;
    });

    let loadedCount = 0;
    const total = files.length;

    Array.from(files).forEach(file => {
      const stem = file.name.replace(/\.png$/i, '').toLowerCase();
      const matchId = nameMap[stem] || nameMap[stem + '.png'];
      if (!matchId) {
        loadedCount++;
        if (loadedCount >= total) finishSkinLoad();
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          // Read resolution mode
          const resMode = loadResMode?.value || 'original';
          let targetW = img.width;
          let targetH = img.height;
          if (resMode === 'custom') {
            const customSize = parseInt(loadResCustom?.value || '64', 10);
            targetW = customSize;
            targetH = customSize;
          }
          const size = Math.max(targetW, targetH);
          const grid = createEmptyGrid(size);
          // Draw image pixel by pixel (with optional resize)
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = targetW;
          tmpCanvas.height = targetH;
          const tmpCtx = tmpCanvas.getContext('2d');
          tmpCtx.imageSmoothingEnabled = false; // pixel-art resize
          tmpCtx.drawImage(img, 0, 0, targetW, targetH);
          const imgData = tmpCtx.getImageData(0, 0, targetW, targetH);
          for (let y = 0; y < targetH; y++) {
            for (let x = 0; x < targetW; x++) {
              const i = (y * targetW + x) * 4;
              const r = imgData.data[i];
              const g = imgData.data[i + 1];
              const b = imgData.data[i + 2];
              const a = imgData.data[i + 3];
              if (a > 128) {
                grid[y][x] = 'rgb(' + r + ',' + g + ',' + b + ')';
              } else {
                grid[y][x] = null;
              }
            }
          }

          if (applyAll) {
            EXPRESSIONS.forEach(exp => {
              exprData[exp.id] = {
                grid: cloneGrid(grid),
                size: size,
                loaded: true
              };
            });
            const modeLabel = resMode === 'custom' ? ' → 缩放至 ' + targetW + '×' + targetH : '';
            setStatus('已加载: ' + file.name + ' → 应用到所有状态 (' + img.width + '×' + img.height + modeLabel + ')');
          } else {
            exprData[matchId] = { grid, size, loaded: true };
            const modeLabel = resMode === 'custom' ? ' → 缩放至 ' + targetW + '×' + targetH : '';
            setStatus('已加载: ' + file.name + ' → ' + matchId + ' (' + img.width + '×' + img.height + modeLabel + ')');
          }
          refreshAllThumbnails();
          loadedCount++;
          if (loadedCount >= total) finishSkinLoad();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  });

  function finishSkinLoad() {
    refreshAllThumbnails();
    setStatus('所有皮肤已加载完成');
    skinFilesInput.value = '';
  }

  // ── Export all expressions ──
  exportAllBtn?.addEventListener('click', () => {
    // Save current grid first
    if (currentExprId && exprData[currentExprId]) {
      exprData[currentExprId].grid = cloneGrid(pixelGrid);
    }

    let exported = 0;
    EXPRESSIONS.forEach(exp => {
      const data = exprData[exp.id];
      if (!data || !data.loaded) return;
      const out = gridToImageData(data.grid, data.size, data.size);
      downloadCanvas(out, exp.id + '.png');
      exported++;
    });

    setStatus(exported > 0 ? '已导出 ' + exported + ' 个表情' : '没有已加载的表情可导出');
  });

  // ══════════════════════════════════════════════════════════════
  // Global Keyboard Shortcuts
  // ══════════════════════════════════════════════════════════════

  document.addEventListener('keydown', (e) => {
    // Don't intercept when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    // Zoom keys work for whichever canvas is active
    const isExprTab = activeTab === 'expressions' && currentExprId;

    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      if (isExprTab) setExprZoom(exprZoomPercent + 25);
      else if (activeTab === 'canvas') setCanvasZoom(canvasZoomPercent + 25);
    } else if (e.key === '-') {
      e.preventDefault();
      if (isExprTab) setExprZoom(exprZoomPercent - 25);
      else if (activeTab === 'canvas') setCanvasZoom(canvasZoomPercent - 25);
    } else if (e.key === '0') {
      e.preventDefault();
      if (isExprTab) setExprZoom(100);
      else if (activeTab === 'canvas') setCanvasZoom(100);
    } else if (e.key === 'b' || e.key === 'B') {
      if (isExprTab) selectExprTool('pen');
      else if (activeTab === 'canvas') selectCanvasTool('pen');
    } else if (e.key === 'e' || e.key === 'E') {
      if (isExprTab) selectExprTool('eraser');
      else if (activeTab === 'canvas') selectCanvasTool('eraser');
    } else if (e.key === 'g' || e.key === 'G') {
      if (isExprTab) selectExprTool('fill');
      else if (activeTab === 'canvas') selectCanvasTool('fill');
    } else if (e.key === 'i' || e.key === 'I') {
      if (isExprTab) selectExprTool('eyedropper');
      else if (activeTab === 'canvas') selectCanvasTool('eyedropper');
    } else if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      if (isExprTab) exprUndo();
      else if (activeTab === 'canvas') canvasUndo();
    }
  });

  // ══════════════════════════════════════════════════════════════
  // IPC: Grid Updates from Fullscreen Window
  // ══════════════════════════════════════════════════════════════

  if (window.electronAPI?.onGridUpdated) {
    window.electronAPI.onGridUpdated((payload) => {
      if (!payload || !payload.grid) return;

      if (payload.expressionId) {
        // Update expression grid
        const id = payload.expressionId;
        if (exprData[id]) {
          exprData[id].grid = cloneGrid(payload.grid);
          exprData[id].loaded = true;
          refreshThumbnail(id);
          // If currently editing this expression, reload it
          if (currentExprId === id) {
            pixelGrid = cloneGrid(payload.grid);
            redrawExprCanvas();
          }
          setStatus('已从全屏窗口更新: ' + id);
        }
      } else {
        // Update main canvas grid
        pixelGrid = cloneGrid(payload.grid);
        redrawCanvas();
        setStatus('已从全屏窗口更新画布');
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Init
  // ══════════════════════════════════════════════════════════════

  function init() {
    buildExpressionCards();
    initDrawCanvas();
    setStatus('就绪 — 选择标签页开始编辑');
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
