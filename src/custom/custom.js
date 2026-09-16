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
    if (!file || file.type !== 'image/png') {
      setStatus('请选择 PNG 格式的正面宠物皮肤');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxSide = Math.max(img.width, img.height);
        if (maxSide < 24 || maxSide > 512) {
          setStatus(`素材尺寸 ${img.width}×${img.height} 不在支持的 24–512 范围内`);
          return;
        }
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
        const shapeWarning = img.width === img.height ? '' : '；非正方形素材会缩放到方形目标画布';
        setStatus(`基础皮肤已加载: ${file.name} (${img.width}×${img.height})${shapeWarning}`);
        document.querySelectorAll('.generator-steps span').forEach((step, index) => step.classList.toggle('active', index === 1));
        // Show region controls for auto expression generator
        if (typeof showRegionControlsAfterLoad === 'function') showRegionControlsAfterLoad();
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
  const canvasImportBtn = document.getElementById('canvasImportBtn');
  const canvasImportInput = document.getElementById('canvasImportInput');
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

  function imageToGrid(image, size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, size, size);
    const imageData = context.getImageData(0, 0, size, size);
    const grid = createEmptyGrid(size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const offset = (y * size + x) * 4;
        if (imageData.data[offset + 3] > 128) {
          grid[y][x] = `rgb(${imageData.data[offset]},${imageData.data[offset + 1]},${imageData.data[offset + 2]})`;
        }
      }
    }
    return grid;
  }

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取 PNG 失败'));
      reader.onload = (event) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('解析 PNG 失败'));
        image.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function loadCanvasPng(file) {
    if (!file || file.type !== 'image/png') {
      setStatus('请选择 PNG 图片');
      return;
    }
    try {
      const image = await loadImageFile(file);
      const supportedSize = image.width === image.height && [...canvasSizeSelect.options]
        .some((option) => Number(option.value) === image.width);
      const targetSize = supportedSize ? image.width : canvasGridSize;
      if (supportedSize) canvasSizeSelect.value = String(targetSize);
      canvasGridSize = targetSize;
      pixelGrid = imageToGrid(image, targetSize);
      canvasHistory = [];
      canvasHistoryIndex = -1;
      resetCanvasPan();
      pixelScale = getCanvasBaseScale();
      canvasZoomPercent = 100;
      zoomLevelLabel.textContent = '100%';
      resizeCanvas();
      pushCanvasHistory();
      const resized = image.width !== targetSize || image.height !== targetSize;
      setStatus(`已导入 ${file.name}，可继续绘制${resized ? `（已像素化适配为 ${targetSize}×${targetSize}）` : ''}`);
    } catch (error) {
      setStatus(`导入 PNG 失败：${error.message}`);
    } finally {
      canvasImportInput.value = '';
    }
  }

  canvasImportBtn?.addEventListener('click', () => canvasImportInput?.click());
  canvasImportInput?.addEventListener('change', (event) => loadCanvasPng(event.target.files?.[0]));

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

  document.getElementById('canvasUseAsBaseBtn')?.addEventListener('click', () => {
    const canvas = gridToImageData(pixelGrid, canvasGridSize, canvasGridSize);
    canvas.toBlob((blob) => {
      if (!blob) {
        setStatus('当前画布转换失败');
        return;
      }
      loadConverterFile(new File([blob], 'drawn-base-skin.png', { type: 'image/png' }));
      switchTab('converter');
      setStatus('已将自由绘画结果送入表情生成向导');
    }, 'image/png');
  });

  document.getElementById('canvasSendToExpressionBtn')?.addEventListener('click', () => {
    const expressionId = document.getElementById('canvasTargetExpression')?.value || 'idle';
    if (!exprData[expressionId]) return;
    exprData[expressionId] = { grid: cloneGrid(pixelGrid), size: canvasGridSize, loaded: true };
    refreshThumbnail(expressionId);
    switchTab('expressions');
    selectExpression(expressionId);
    setStatus(`已将自由绘画结果加入 ${expressionId} 状态`);
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

      const statusDiv = document.createElement('div');
      statusDiv.className = 'state-status';
      statusDiv.textContent = '未加载 · 可直接绘制';

      card.appendChild(thumb);
      card.appendChild(nameDiv);
      card.appendChild(triggerDiv);
      card.appendChild(statusDiv);

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
    const card = document.querySelector(`.expression-card[data-id="${exprId}"]`);
    card?.classList.toggle('loaded', Boolean(data?.loaded));
    const status = card?.querySelector('.state-status');
    if (status) status.textContent = data?.dirty ? '已修改 · 尚未保存' : data?.loaded ? '已加载' : '未加载 · 可直接绘制';
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
    exprZoomLabel.textContent = '100%';
    resetExprPan();
    // Use rAF to ensure container has layout after display change
    requestAnimationFrame(function() {
      const fit = getExprBaseScale();
      exprPixelScale = fit;
      resizeExprCanvas();
    });
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
      commitExpressionEdit();
    }
  }

  function commitExpressionEdit() {
    if (!currentExprId || !exprData[currentExprId]) return;
    exprData[currentExprId].grid = cloneGrid(pixelGrid);
    exprData[currentExprId].loaded = true;
    exprData[currentExprId].dirty = true;
    refreshThumbnail(currentExprId);
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
    if (exprCurrentTool === 'fill') { exprFloodFill(x, y, exprPenColorInput.value); pushExprHistory(); commitExpressionEdit(); }
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
      commitExpressionEdit();
    }
  });

  exprCanvas?.addEventListener('mouseleave', () => {
    if (exprIsDrawing && currentExprId) {
      exprIsDrawing = false;
      pushExprHistory();
      commitExpressionEdit();
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

  async function loadSkinFramesIntoExpressionEditor(skin) {
    const stateMap = { idle: 'idle', hover: 'hover', pull: 'pull', happy: 'happy', pain: 'pain', blink_closed: 'blink', blink: 'blink' };
    let loaded = 0;
    await Promise.all(Object.entries(skin.frames || {}).map(async ([state, url]) => {
      const expressionId = stateMap[state];
      if (!expressionId || !exprData[expressionId]) return;
      const image = await new Promise((resolve, reject) => {
        const candidate = new Image();
        candidate.onload = () => resolve(candidate);
        candidate.onerror = () => reject(new Error(`读取 ${state} 失败`));
        candidate.src = url;
      });
      const size = Math.max(image.width, image.height, Number(skin.baseSize) || 0);
      exprData[expressionId] = { grid: imageToGrid(image, size), size, loaded: true };
      loaded++;
    }));
    refreshAllThumbnails();
    const firstLoaded = exprData.idle?.loaded ? 'idle' : EXPRESSIONS.find((item) => exprData[item.id]?.loaded)?.id || 'idle';
    switchTab('expressions');
    selectExpression(firstLoaded);
    return loaded;
  }

  document.getElementById('loadActiveSkinBtn')?.addEventListener('click', () => {
    // Repurposed: pick ONE image and load it into every expression state.
    _loadOneToAll = true;
    skinFilesInput?.click();
  });

  skinFilesInput?.addEventListener('change', (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const applyAll = document.getElementById('applyAllCheckbox')?.checked || false;
    // Capture resolution settings NOW (before async operations)
    const resMode = loadResMode?.value || 'original';
    const customResSize = parseInt(loadResCustom?.value || '64', 10);

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
    // Track only files that actually match an expression
    let matchedTotal = 0;
    let matchedDone = 0;

    // Helper: process one loaded image into exprData
    function applyOneImage(matchId, grid, size) {
      if (applyAll) {
        EXPRESSIONS.forEach(exp => {
          exprData[exp.id] = { grid: cloneGrid(grid), size, loaded: true };
        });
      } else {
        exprData[matchId] = { grid: cloneGrid(grid), size, loaded: true };
      }
      // Show debug info in status bar
      var debugStr = '📊 ';
      EXPRESSIONS.forEach(function(e){
        var d = exprData[e.id];
        debugStr += e.id + '=' + (d&&d.loaded?'✅':'⬜') + (d?'('+d.size+')':'') + ' ';
      });
      setStatus(debugStr);
    }

    // Helper: finalize after all MATCHED files loaded
    function onAllDone() {
      refreshAllThumbnails();
      // If currently editing an expression that was just loaded, reload pixelGrid
      // Also auto-select the last loaded expression if nothing was selected
      let needsEditorUpdate = false;
      if (currentExprId && exprData[currentExprId] && exprData[currentExprId].loaded) {
        pixelGrid = cloneGrid(exprData[currentExprId].grid);
        needsEditorUpdate = true;
      } else if (!currentExprId && matchedTotal === 1 && matchedDone >= matchedTotal) {
        // Auto-select the only loaded expression
        const onlyExpr = EXPRESSIONS.find(e => exprData[e.id]?.loaded);
        if (onlyExpr) {
          selectExpression(onlyExpr.id);
          needsEditorUpdate = true;
        }
      }
      if (needsEditorUpdate) {
        requestAnimationFrame(function() {
          exprPixelScale = getExprBaseScale();
          exprZoomPercent = 100;
          exprZoomLabel.textContent = '100%';
          resizeExprCanvas();
        });
      }
      const modeLabel = resMode === 'custom' ? ' → 缩放至 ' + customResSize + '×' + customResSize : '';
      setStatus('已加载 ' + loadedCount + ' 个表情' + modeLabel);
      finishSkinLoad();
    }

    // ── Load ONE image into ALL expression states ──
    if (_loadOneToAll) {
      _loadOneToAll = false;
      const file = files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const img = new Image();
          img.onload = () => {
            let targetSize = Math.max(img.width, img.height);
            if (resMode === 'custom') targetSize = customResSize;
            const grid = imageToGrid(img, targetSize);
            EXPRESSIONS.forEach(exp => {
              exprData[exp.id] = { grid: cloneGrid(grid), size: targetSize, loaded: true };
            });
            refreshAllThumbnails();
            // Refresh the editor if an expression is currently selected
            if (currentExprId && exprData[currentExprId]) {
              pixelGrid = cloneGrid(exprData[currentExprId].grid);
              requestAnimationFrame(function () {
                exprPixelScale = getExprBaseScale();
                exprZoomPercent = 100;
                exprZoomLabel.textContent = '100%';
                resetExprPan();
                resizeExprCanvas();
              });
            }
            const modeLabel = resMode === 'custom' ? ' → 缩放至 ' + customResSize + '×' + customResSize : '';
            setStatus('✅ 已将图片载入所有状态 (' + targetSize + '×' + targetSize + ')' + modeLabel);
            skinFilesInput.value = '';
          };
          img.onerror = () => {
            setStatus('❌ 读取图片失败: ' + file.name);
            skinFilesInput.value = '';
          };
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      }
      return;
    }

    Array.from(files).forEach(file => {
      // If loading into current expression, skip filename matching
      if (_loadToCurrentExpr) {
        if (currentExprId && exprData[currentExprId]) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
              const size = Math.max(img.width, img.height);
              // Use the shared sampler so scaling/positioning stays consistent
              // with loadSkinFramesIntoExpressionEditor (scales to fill the square).
              const grid = imageToGrid(img, size);
              exprData[currentExprId] = { grid, size, loaded: true };
              // Sync the editor buffer so switching expressions doesn't overwrite
              // the just-loaded frame with the stale pixelGrid (which previously
              // let the old/default skin leak back into this state).
              pixelGrid = cloneGrid(grid);
              refreshAllThumbnails();
              requestAnimationFrame(function () {
                exprPixelScale = getExprBaseScale();
                exprZoomPercent = 100;
                exprZoomLabel.textContent = '100%';
                resetExprPan();
                resizeExprCanvas();
              });
              setStatus('✅ 已加载到 ' + currentExprId + ' (' + size + '×' + size + ')');
              _loadToCurrentExpr = false;
            };
            img.onerror = () => {
              setStatus('❌ 读取图片失败: ' + file.name);
              _loadToCurrentExpr = false;
            };
            img.src = ev.target.result;
          };
          reader.readAsDataURL(file);
        }
        _loadToCurrentExpr = false;
        return;
      }

      const stem = file.name.replace(/\.png$/i, '').toLowerCase();
      const matchId = nameMap[stem] || nameMap[stem + '.png'];
      console.log('[SkinLoad] file=' + file.name + ' stem=' + stem + ' matchId=' + matchId + ' nameMap[stem]=' + nameMap[stem] + ' nameMap[stem+.png]=' + nameMap[stem + '.png']);
      if (!matchId) {
        loadedCount++;
        if (loadedCount >= total && matchedDone >= matchedTotal) onAllDone();
        return;
      }
      matchedTotal++;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          // Use captured resolution settings
          let targetW = img.width;
          let targetH = img.height;
          if (resMode === 'custom') {
            targetW = customResSize;
            targetH = customResSize;
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

          // Write directly to exprData (cloneGrid to avoid shared refs)
          applyOneImage(matchId, grid, size);
          console.log('[SkinLoad] applied matchId=' + matchId + ' size=' + size + ' applyAll=' + applyAll);
          loadedCount++;
          matchedDone++;
          if (matchedDone >= matchedTotal && loadedCount >= total) onAllDone();
        };
        img.onerror = () => {
          console.warn('[SkinLoad] Failed to load:', file.name);
          loadedCount++;
          matchedDone++;
          if (matchedDone >= matchedTotal && loadedCount >= total) onAllDone();
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

  // ══════════════════════════════════════════════════════════════
  // 5. Auto Expression Generator (皮肤转换器 → 自动生成表情)
  // ══════════════════════════════════════════════════════════════

  const selOverlay = document.getElementById('selectionOverlay');
  const selCtx = selOverlay?.getContext('2d');
  const regionControls = document.getElementById('regionControls');
  const selectEyesBtn = document.getElementById('selectEyesBtn');
  const selectMouthBtn = document.getElementById('selectMouthBtn');
  const clearRegionsBtn = document.getElementById('clearRegionsBtn');
  const regionStatus = document.getElementById('regionStatus');
  const generateExprBtn = document.getElementById('generateExprBtn');
  const autoExprPreview = document.getElementById('autoExprPreview');
  const autoExprGrid = document.getElementById('autoExprGrid');
  const exportAutoExprBtn = document.getElementById('exportAutoExprBtn');
  const applyToEditorBtn = document.getElementById('applyToEditorBtn');

  const autoExpr = {
    leftEye: { region: null, pixels: [] },
    rightEye: { region: null, pixels: [] },
    mouth: { region: null, pixels: [] },
    mode: null,
    resolution: null,  // from fullscreen marker, null = use original image size
    coordinateSpace: 'original',
    baseGrid: null, baseSize: 0, results: {},
  };
  let selStart = null, selCur = null;

  // Show region controls when converter image loads
  const origLoadConverterFile = loadConverterFile;
  // Patch: show region controls after image loads
  function showRegionControlsAfterLoad() {
    if (regionControls) {
      regionControls.style.display = '';
    }
    // Enable the selection buttons
    if (selectEyesBtn) selectEyesBtn.disabled = false;
    if (selectMouthBtn) selectMouthBtn.disabled = false;
    // Defer overlay sync to next frame so DOM has layout
    requestAnimationFrame(function() {
      syncOverlaySize();
    });
  }

  function syncOverlaySize() {
    if (!selOverlay || !originalCanvas) return;
    selOverlay.width = originalCanvas.width;
    selOverlay.height = originalCanvas.height;
    selOverlay.style.width = originalCanvas.clientWidth + 'px';
    selOverlay.style.height = originalCanvas.clientHeight + 'px';
    selOverlay.style.pointerEvents = autoExpr.mode ? 'auto' : 'none';
    drawSelOverlay();
  }

  function enterSelMode(mode) {
    autoExpr.mode = (autoExpr.mode === mode) ? null : mode;
    selectEyesBtn?.classList.toggle('active', autoExpr.mode === 'eyes');
    selectMouthBtn?.classList.toggle('active', autoExpr.mode === 'mouth');
    selOverlay.style.pointerEvents = autoExpr.mode ? 'auto' : 'none';
    selOverlay.style.cursor = autoExpr.mode ? 'crosshair' : '';
    regionStatus.textContent = autoExpr.mode === 'eyes' ? '在原图上拖拽选择眼睛区域...' :
                               autoExpr.mode === 'mouth' ? '在原图上拖拽选择嘴巴区域...' : '';
    selStart = selCur = null;
    drawSelOverlay();
  }

  selectEyesBtn?.addEventListener('click', () => enterSelMode('eyes'));
  selectMouthBtn?.addEventListener('click', () => enterSelMode('mouth'));

  clearRegionsBtn?.addEventListener('click', () => {
    autoExpr.leftEye = { region: null, pixels: [] };
    autoExpr.rightEye = { region: null, pixels: [] };
    autoExpr.mouth = { region: null, pixels: [] };
    autoExpr.resolution = null;
    autoExpr.coordinateSpace = 'original';
    updateRegionStatus(); updateGenerateBtn();
    drawSelOverlay();
    if (autoExprPreview) autoExprPreview.style.display = 'none';
  });

  // ── Fullscreen region marker ──
  const fullscreenMarkBtn = document.getElementById('fullscreenMarkBtn');
  fullscreenMarkBtn?.addEventListener('click', () => {
    if (!converterImage) { setStatus('请先加载一张图片'); return; }
    // Convert converterImage to dataUrl for the fullscreen window
    const tc = document.createElement('canvas');
    tc.width = converterImage.width;
    tc.height = converterImage.height;
    const tctx = tc.getContext('2d');
    tctx.drawImage(converterImage, 0, 0);
    const dataUrl = tc.toDataURL('image/png');
    if (window.electronAPI?.openRegionMarker) {
      window.electronAPI.openRegionMarker({ dataUrl });
      setStatus('已打开全屏标记窗口...');
    }
  });

  // Receive region results from fullscreen marker
  if (window.electronAPI?.onRegionResult) {
    window.electronAPI.onRegionResult((regions) => {
      if (regions && regions.leftEye && regions.rightEye && regions.mouth &&
          regions.leftEye.region && regions.rightEye.region && regions.mouth.region &&
          regions.leftEye.pixels?.length > 0 && regions.rightEye.pixels?.length > 0 && regions.mouth.pixels?.length > 0) {
        autoExpr.leftEye = regions.leftEye;
        autoExpr.rightEye = regions.rightEye;
        autoExpr.mouth = regions.mouth;
        // Store resolution from fullscreen marker
        if (regions.resolution) {
          autoExpr.resolution = regions.resolution;
        }
        autoExpr.coordinateSpace = regions.coordinateSpace || 'original';
        updateRegionStatus();
        updateGenerateBtn();
        drawSelOverlay();
        const le = regions.leftEye, re = regions.rightEye, mo = regions.mouth;
        const resInfo = regions.resolution ? ' 分辨率:' + regions.resolution : '';
        setStatus('标记已同步: 左眼(' + le.pixels.length + 'px) 右眼(' + re.pixels.length + 'px) 嘴巴(' + mo.pixels.length + 'px)' + resInfo);
      } else if (regions === null) {
        setStatus('标记已取消');
      }
    });
  }

  function updateRegionStatus() {
    const p = [];
    const features = [
      { key: 'leftEye', label: '👁️ 左眼' },
      { key: 'rightEye', label: '👁️ 右眼' },
      { key: 'mouth', label: '👄 嘴巴' },
    ];
    for (const f of features) {
      const d = autoExpr[f.key];
      if (d && d.region && d.pixels?.length > 0) p.push(f.label + ' ✓');
      else if (d && d.region) p.push(f.label + ' 区域');
    }
    regionStatus.textContent = p.join(' | ') || '未标记任何区域';
  }
  function updateGenerateBtn() {
    const ready = autoExpr.leftEye?.region && autoExpr.leftEye?.pixels?.length > 0 &&
                  autoExpr.rightEye?.region && autoExpr.rightEye?.pixels?.length > 0 &&
                  autoExpr.mouth?.region && autoExpr.mouth?.pixels?.length > 0;
    if (generateExprBtn) generateExprBtn.disabled = !ready;
  }

  // Overlay mouse events
  selOverlay?.addEventListener('mousedown', (e) => {
    if (!autoExpr.mode) return;
    const r = selOverlay.getBoundingClientRect();
    const sx = selOverlay.width / r.width, sy = selOverlay.height / r.height;
    selStart = { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    selCur = { ...selStart };
  });
  selOverlay?.addEventListener('mousemove', (e) => {
    if (!autoExpr.mode || !selStart) return;
    const r = selOverlay.getBoundingClientRect();
    const sx = selOverlay.width / r.width, sy = selOverlay.height / r.height;
    selCur = { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    drawSelOverlay();
  });
  selOverlay?.addEventListener('mouseup', () => {
    if (!autoExpr.mode || !selStart || !selCur) return;
    const x = Math.round(Math.min(selStart.x, selCur.x));
    const y = Math.round(Math.min(selStart.y, selCur.y));
    const w = Math.round(Math.abs(selCur.x - selStart.x));
    const h = Math.round(Math.abs(selCur.y - selStart.y));
    if (w > 2 && h > 2) {
      autoExpr[autoExpr.mode] = { x, y, w, h };
    }
    enterSelMode(null);
    updateRegionStatus(); updateGenerateBtn();
  });

  function drawSelOverlay() {
    if (!selCtx || !selOverlay) return;
    selCtx.clearRect(0, 0, selOverlay.width, selOverlay.height);
    const previewScale = autoExpr.coordinateSpace === 'target' && autoExpr.resolution
      ? Math.max(originalCanvas.width, originalCanvas.height) / autoExpr.resolution
      : 1;
    // Draw regions and pixels for each feature
    const features = [
      { key: 'leftEye', color: 'rgba(100,200,255,0.35)', stroke: '#66ccff', label: '左眼' },
      { key: 'rightEye', color: 'rgba(100,255,150,0.35)', stroke: '#66ff99', label: '右眼' },
      { key: 'mouth', color: 'rgba(255,150,100,0.35)', stroke: '#ff9966', label: '嘴巴' },
    ];
    for (const f of features) {
      const d = autoExpr[f.key];
      if (!d) continue;
      // Draw region bounding box
      if (d.region) {
        const r = {
          x: d.region.x * previewScale,
          y: d.region.y * previewScale,
          w: d.region.w * previewScale,
          h: d.region.h * previewScale,
        };
        selCtx.strokeStyle = f.stroke;
        selCtx.lineWidth = 2;
        selCtx.setLineDash([4, 4]);
        selCtx.strokeRect(r.x, r.y, r.w, r.h);
        selCtx.setLineDash([]);
        selCtx.fillStyle = f.stroke;
        selCtx.font = 'bold 10px sans-serif';
        selCtx.fillText(f.label, r.x + 2, r.y - 2 > 10 ? r.y - 2 : r.y + 12);
      }
      // Draw selected pixels
      if (d.pixels) {
        for (const p of d.pixels) {
          selCtx.fillStyle = f.stroke;
          selCtx.globalAlpha = 0.6;
          selCtx.fillRect(p.x * previewScale, p.y * previewScale, Math.max(1, previewScale), Math.max(1, previewScale));
          selCtx.globalAlpha = 1;
        }
      }
    }
    // Draw drag preview
    if (selStart && selCur && autoExpr.mode) {
      const x = Math.min(selStart.x, selCur.x), y = Math.min(selStart.y, selCur.y);
      const w = Math.abs(selCur.x - selStart.x), h = Math.abs(selCur.y - selStart.y);
      const modeColors = { eyes: 'rgba(100,200,255,0.3)', mouth: 'rgba(255,150,100,0.3)' };
      const modeStrokes = { eyes: '#66ccff', mouth: '#ff9966' };
      selCtx.fillStyle = modeColors[autoExpr.mode] || 'rgba(200,200,200,0.3)';
      selCtx.fillRect(x, y, w, h);
      selCtx.strokeStyle = modeStrokes[autoExpr.mode] || '#ccc';
      selCtx.lineWidth = 2;
      selCtx.strokeRect(x, y, w, h);
    }
  }
  function drawRegionRect(ctx, r, fill, stroke, label) {
    ctx.fillStyle = fill; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = stroke; ctx.font = 'bold 11px sans-serif';
    ctx.fillText(label, r.x + 3, r.y + 13);
  }

  // ── Pixel transformation helpers (Gemini优化版) ──
  // region = 安全沙盒（蒙版），pixelBounds = 变形基准

  // 解析像素坐标 "x,y" → {x, y}
  function parseKey(pk) {
    const [x, y] = pk.split(',').map(Number);
    return { x, y };
  }

  // 获取像素集合的元数据：bounding box + 几何中心 + 颜色
  function getPixelMeta(grid, pixelSet) {
    if (!pixelSet || pixelSet.size === 0) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let color = null;
    for (const pk of pixelSet) {
      const { x, y } = parseKey(pk);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (!color && grid[y]?.[x]) color = grid[y][x];
    }
    if (minX === Infinity) return null;
    return {
      x: minX, y: minY,
      w: maxX - minX + 1, h: maxY - minY + 1,
      cx: minX + (maxX - minX) / 2,
      cy: minY + (maxY - minY) / 2,
      color: color || 'rgb(0,0,0)'
    };
  }

  // 安全绘制像素（必须在 region 内且在画布内）
  function drawPixelSafe(grid, size, x, y, color, region) {
    if (x >= region.x && x < region.x + region.w &&
        y >= region.y && y < region.y + region.h &&
        x >= 0 && x < size && y >= 0 && y < size) {
      grid[y][x] = color;
    }
  }

  // 清除像素集合
  function clearPixelSet(grid, size, pixelSet) {
    for (const pk of pixelSet) {
      const { x, y } = parseKey(pk);
      if (y >= 0 && y < size && x >= 0 && x < size) grid[y][x] = null;
    }
  }

  // ═══ 核心表情生成算法 ═══

  /**
   * 1. 缩放方案 (Hover/Pull) — 基于像素骨架等比放大
   * 不填满 region，而是保留原形状按比例放大
   */
  function scalePixelsAdvanced(grid, size, region, pixelSet, factor) {
    const meta = getPixelMeta(grid, pixelSet);
    if (!meta) return;
    clearPixelSet(grid, size, pixelSet);
    // 基于几何中心等比放大每个像素
    for (const pk of pixelSet) {
      const { x, y } = parseKey(pk);
      const dx = x - meta.cx;
      const dy = y - meta.cy;
      const startX = Math.round(meta.cx + dx * factor);
      const startY = Math.round(meta.cy + dy * factor);
      // 根据倍数决定像素肥大度
      const thickness = Math.max(1, Math.round(factor));
      for (let tx = 0; tx < thickness; tx++) {
        for (let ty = 0; ty < thickness; ty++) {
          drawPixelSafe(grid, size, startX + tx, startY + ty, meta.color, region);
        }
      }
    }
  }

  /**
   * 2. 开心弯眼 (Happy) — 抛物线弧线算法
   * 丢弃原像素，直接在原位置绘制像素弧线 ∪
   */
  function drawHappyEye(grid, size, region, pixelSet) {
    const meta = getPixelMeta(grid, pixelSet);
    if (!meta) return;
    clearPixelSet(grid, size, pixelSet);
    // 弧线宽度参考原眼睛宽度，稍微加宽
    const w = Math.min(region.w, meta.w + 2);
    const h = Math.max(2, Math.round(w * 0.5));
    const startX = Math.round(meta.cx - w / 2);
    const startY = Math.round(meta.cy - h / 2) + 1;
    // 绘制开口向上的弧线 (笑眼 ∪)
    for (let dx = 0; dx < w; dx++) {
      const t = dx / (w - 1 || 1);
      const dy = Math.round(4 * h * t * (1 - t));
      const targetX = startX + dx;
      const targetY = startY + dy;  // 向下弯
      drawPixelSafe(grid, size, targetX, targetY, meta.color, region);
      // 加粗防断裂
      if (dx > 0 && dx < w - 1) {
        drawPixelSafe(grid, size, targetX, targetY + 1, meta.color, region);
      }
    }
  }

  /**
   * 3. 受伤眼睛 (Pain ><) — 基于 pixelBounds 而非 region
   * >< 大小参考原眼睛，紧凑覆盖眼眶
   */
  function drawPainEye(grid, size, region, pixelSet, isLeftEye) {
    const meta = getPixelMeta(grid, pixelSet);
    if (!meta) return;
    clearPixelSet(grid, size, pixelSet);
    // 限制 >< 尺寸：基于原眼睛大小，不盲目变大
    const sizeW = Math.min(region.w, Math.max(3, meta.w));
    const sizeH = Math.min(region.h, Math.max(3, meta.h));
    const cx = Math.floor(meta.cx);
    const cy = Math.floor(meta.cy);
    const half = Math.floor(sizeW / 2);
    // 绘制 > 或 <
    for (let dy = -half; dy <= half; dy++) {
      const dx = half - Math.abs(dy);
      let targetX;
      if (isLeftEye) {
        targetX = cx - half + dx;  // > 向右突
      } else {
        targetX = cx + half - dx;  // < 向左突
      }
      const targetY = cy + dy;
      drawPixelSafe(grid, size, targetX, targetY, meta.color, region);
      // 加粗
      drawPixelSafe(grid, size, targetX + (isLeftEye ? -1 : 1), targetY, meta.color, region);
    }
  }

  /**
   * 4. 眨眼 (Blink) — 清除像素，渲染层显示皮肤色
   */
  function drawBlinkEye(grid, size, pixelSet) {
    clearPixelSet(grid, size, pixelSet);
  }

  /**
   * 5. 吐舌头 (Pull) — 眼睛放大 + 嘴巴下方画舌头
   */
  function drawPullMouth(grid, size, region, pixelSet) {
    const meta = getPixelMeta(grid, pixelSet);
    if (!meta) return;
    scalePixelsAdvanced(grid, size, region, pixelSet, 1.2);
    // 在嘴巴下方画粉色舌头
    const tongueColor = '#FF80A0';
    const tongueWidth = Math.max(2, Math.floor(meta.w * 0.8));
    const startX = Math.round(meta.cx - tongueWidth / 2);
    const startY = meta.y + meta.h;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < tongueWidth; dx++) {
        drawPixelSafe(grid, size, startX + dx, startY + dy, tongueColor, region);
      }
    }
  }

  /**
   * 6. 添加舌头 (辅助)
   */
  function addTongue(grid, size, mouthRegion) {
    const { x, y, w, h } = mouthRegion;
    const ty = y + h;
    const tc = 'rgb(255,140,170)';
    for (let dx = Math.floor(w * 0.25); dx < Math.ceil(w * 0.75); dx++) {
      const gx = x + dx;
      if (ty < size && gx >= 0 && gx < size) grid[ty][gx] = tc;
      if (ty + 1 < size && gx >= 0 && gx < size) grid[ty + 1][gx] = tc;
    }
  }

  // ── Generate expressions ──
  generateExprBtn?.addEventListener('click', () => {
    const generator = window.TurtleExpressionGenerator;
    if (!generator) {
      setStatus('表情生成引擎未加载，请关闭自定义模式后重新打开');
      return;
    }
    if (generator) {
      try {
        const img = converterImage;
        if (!img) throw new Error('请先载入基础皮肤');
        const targetSize = autoExpr.resolution || Math.max(img.width, img.height);
        const baseGrid = createEmptyGrid(targetSize);
        const canvas = document.createElement('canvas');
        canvas.width = targetSize;
        canvas.height = targetSize;
        const context = canvas.getContext('2d');
        context.imageSmoothingEnabled = false;
        context.drawImage(img, 0, 0, targetSize, targetSize);
        const imageData = context.getImageData(0, 0, targetSize, targetSize);
        for (let y = 0; y < targetSize; y++) {
          for (let x = 0; x < targetSize; x++) {
            const offset = (y * targetSize + x) * 4;
            if (imageData.data[offset + 3] > 128) {
              baseGrid[y][x] = `rgb(${imageData.data[offset]},${imageData.data[offset + 1]},${imageData.data[offset + 2]})`;
            }
          }
        }
        const originalSize = Math.max(img.width, img.height);
        const scale = autoExpr.coordinateSpace === 'target' ? 1 : targetSize / originalSize;
        const scaleFeature = (feature) => ({
          region: {
            x: Math.round(feature.region.x * scale),
            y: Math.round(feature.region.y * scale),
            w: Math.max(1, Math.round(feature.region.w * scale)),
            h: Math.max(1, Math.round(feature.region.h * scale)),
          },
          pixels: feature.pixels.map((point) => ({ x: Math.round(point.x * scale), y: Math.round(point.y * scale) })),
        });
        const features = {
          leftEye: scaleFeature(autoExpr.leftEye),
          rightEye: scaleFeature(autoExpr.rightEye),
          mouth: scaleFeature(autoExpr.mouth),
        };
        const strength = document.getElementById('autoExprStrength')?.value || 'standard';
        const generated = generator.generateExpressions(baseGrid, targetSize, features, { strength });
        autoExpr.baseGrid = baseGrid;
        autoExpr.baseSize = targetSize;
        autoExpr.results = generated.results;
        for (const [exprId, result] of Object.entries(autoExpr.results)) {
          exprData[exprId] = { grid: cloneGrid(result.grid), size: result.size, loaded: true };
        }
        renderAutoExprPreview();
        refreshAllThumbnails();
        document.querySelectorAll('.generator-steps span').forEach((step, index) => step.classList.toggle('active', index === 2));
        setStatus(generated.warnings.length ? `已生成六种状态；${generated.warnings.join('；')}` : '已生成六种状态，请逐个检查');
      } catch (error) {
        setStatus(`生成前检查未通过：${error.message}`);
      }
      return;
    }
    if (!autoExpr.leftEye || !autoExpr.rightEye || !autoExpr.mouth || !converterImage) return;
    if (!autoExpr.leftEye.region || !autoExpr.rightEye.region || !autoExpr.mouth.region) return;
    if (!autoExpr.leftEye.pixels?.length || !autoExpr.rightEye.pixels?.length || !autoExpr.mouth.pixels?.length) return;

    // Build base grid from converter image
    const img = converterImage;
    // Use resolution from fullscreen marker if available, otherwise original size
    const targetSize = autoExpr.resolution || Math.max(img.width, img.height);
    const sz = targetSize;
    const baseGrid = createEmptyGrid(sz);
    const tc = document.createElement('canvas'); tc.width = sz; tc.height = sz;
    const tctx = tc.getContext('2d'); tctx.imageSmoothingEnabled = false;
    tctx.drawImage(img, 0, 0, sz, sz);
    const id = tctx.getImageData(0, 0, sz, sz);
    for (let py = 0; py < sz; py++) for (let px = 0; px < sz; px++) {
      const i = (py * sz + px) * 4;
      if (id.data[i + 3] > 128) baseGrid[py][px] = 'rgb(' + id.data[i] + ',' + id.data[i+1] + ',' + id.data[i+2] + ')';
    }

    // Scale coordinates from original image space to target resolution
    const originalSize = Math.max(img.width, img.height);
    const coordScale = sz / originalSize;
    function scaleCoord(c) {
      return { x: Math.round(c.x * coordScale), y: Math.round(c.y * coordScale) };
    }
    function scaleRegion(r) {
      return r ? { x: Math.round(r.x * coordScale), y: Math.round(r.y * coordScale),
                    w: Math.max(1, Math.round(r.w * coordScale)), h: Math.max(1, Math.round(r.h * coordScale)) } : null;
    }

    // Extract regions and pixel sets (scaled to target resolution)
    const leftEyeRegion = scaleRegion(autoExpr.leftEye.region);
    const rightEyeRegion = scaleRegion(autoExpr.rightEye.region);
    const mouthRegion = scaleRegion(autoExpr.mouth.region);
    const leftEyePixels = new Set(autoExpr.leftEye.pixels.map(p => { const s = scaleCoord(p); return s.x + ',' + s.y; }));
    const rightEyePixels = new Set(autoExpr.rightEye.pixels.map(p => { const s = scaleCoord(p); return s.x + ',' + s.y; }));
    const mouthPixels = new Set(autoExpr.mouth.pixels.map(p => { const s = scaleCoord(p); return s.x + ',' + s.y; }));

    autoExpr.results = {};
    autoExpr.results.idle = { grid: cloneGrid(baseGrid), size: sz };

    // Hover: eyes enlarge (基于像素骨架放大，保留形状)
    let g = cloneGrid(baseGrid);
    scalePixelsAdvanced(g, sz, leftEyeRegion, leftEyePixels, 1.3);
    scalePixelsAdvanced(g, sz, rightEyeRegion, rightEyePixels, 1.3);
    scalePixelsAdvanced(g, sz, mouthRegion, mouthPixels, 0.8);
    autoExpr.results.hover = { grid: g, size: sz };

    // Pull: surprise, eyes+mouth enlarge + tongue
    g = cloneGrid(baseGrid);
    scalePixelsAdvanced(g, sz, leftEyeRegion, leftEyePixels, 1.4);
    scalePixelsAdvanced(g, sz, rightEyeRegion, rightEyePixels, 1.4);
    drawPullMouth(g, sz, mouthRegion, mouthPixels);
    autoExpr.results.pull = { grid: g, size: sz };

    // Happy: eyes become ∪ shape (抛物线弧线), mouth curves up
    g = cloneGrid(baseGrid);
    drawHappyEye(g, sz, leftEyeRegion, leftEyePixels);
    drawHappyEye(g, sz, rightEyeRegion, rightEyePixels);
    // Mouth: scale down slightly + shift up for smile
    scalePixelsAdvanced(g, sz, mouthRegion, mouthPixels, 0.9);
    autoExpr.results.happy = { grid: g, size: sz };

    // Pain: eyes become >< shape (基于pixelBounds)
    g = cloneGrid(baseGrid);
    drawPainEye(g, sz, leftEyeRegion, leftEyePixels, true);
    drawPainEye(g, sz, rightEyeRegion, rightEyePixels, false);
    autoExpr.results.pain = { grid: g, size: sz };

    // Blink: clear eye pixels (渲染层显示皮肤色)
    g = cloneGrid(baseGrid);
    drawBlinkEye(g, sz, leftEyePixels);
    drawBlinkEye(g, sz, rightEyePixels);
    autoExpr.results.blink = { grid: g, size: sz };

    // 同步生成结果到 exprData，让编辑器也能加载
    for (const [exprId, result] of Object.entries(autoExpr.results)) {
      exprData[exprId] = { grid: cloneGrid(result.grid), size: result.size, loaded: true };
    }

    renderAutoExprPreview();
    setStatus('已生成 6 个表情');
  });

  function renderAutoExprPreview() {
    if (!autoExprGrid) return;
    autoExprGrid.innerHTML = '';
    if (autoExprPreview) autoExprPreview.style.display = '';
    const expDefs = [
      { id: 'idle', name: 'Idle', trigger: '默认待机', color: '#66cc66' },
      { id: 'hover', name: 'Hover', trigger: '鼠标悬停（卖萌）', color: '#cccc66' },
      { id: 'pull', name: 'Pull', trigger: '拖拽（惊讶）', color: '#cc6666' },
      { id: 'happy', name: 'Happy', trigger: '开心', color: '#66cccc' },
      { id: 'pain', name: 'Pain', trigger: '受伤', color: '#cc66cc' },
      { id: 'blink', name: 'Blink', trigger: '随机眨眼', color: '#999999' },
    ];
    expDefs.forEach(def => {
      const data = autoExpr.results[def.id];
      if (!data) return;
      const card = document.createElement('div');
      card.style.cssText = 'text-align:center; padding:8px; background:rgba(10,12,18,0.6); border:1px solid rgba(64,64,88,0.3);';
      const cvs = document.createElement('canvas');
      cvs.width = 64; cvs.height = 64;
      cvs.style.cssText = 'image-rendering:pixelated; width:64px; height:64px;';
      const ctx = cvs.getContext('2d');
      // Checkerboard bg
      for (let cy = 0; cy < 64; cy += 8) for (let cx = 0; cx < 64; cx += 8) {
        ctx.fillStyle = ((cx/8 + cy/8) % 2 === 0) ? '#ccc' : '#999';
        ctx.fillRect(cx, cy, 8, 8);
      }
      // Draw pixels
      const scale = 64 / data.size;
      for (let py = 0; py < data.size; py++) for (let px = 0; px < data.size; px++) {
        const c = data.grid[py]?.[px];
        if (c) { ctx.fillStyle = c; ctx.fillRect(Math.floor(px*scale), Math.floor(py*scale), Math.ceil(scale), Math.ceil(scale)); }
      }
      const nameDiv = document.createElement('div');
      nameDiv.style.cssText = 'font-size:12px; margin-top:6px; color:' + def.color + ';';
      nameDiv.textContent = def.name;
      const trigDiv = document.createElement('div');
      trigDiv.style.cssText = 'font-size:10px; color:#888; margin-top:2px;';
      trigDiv.textContent = def.trigger;
      const editButton = document.createElement('button');
      editButton.className = 'btn';
      editButton.style.cssText = 'margin-top:7px; padding:4px 8px; min-height:26px; font-size:10px;';
      editButton.textContent = '检查并编辑';
      editButton.addEventListener('click', () => {
        exprData[def.id] = { grid: cloneGrid(data.grid), size: data.size, loaded: true };
        refreshThumbnail(def.id);
        switchTab('expressions');
        selectExpression(def.id);
        setStatus(`正在校对 ${def.id} 状态`);
      });
      card.appendChild(cvs); card.appendChild(nameDiv); card.appendChild(trigDiv); card.appendChild(editButton);
      autoExprGrid.appendChild(card);
    });
  }

  // Export auto-generated expressions
  exportAutoExprBtn?.addEventListener('click', () => {
    let count = 0;
    for (const [id, data] of Object.entries(autoExpr.results)) {
      const out = gridToImageData(data.grid, data.size, data.size);
      downloadCanvas(out, id + '.png');
      count++;
    }
    setStatus('已导出 ' + count + ' 个表情');
  });

  // Apply to expression editor
  applyToEditorBtn?.addEventListener('click', () => {
    for (const [id, data] of Object.entries(autoExpr.results)) {
      exprData[id] = { grid: cloneGrid(data.grid), size: data.size, loaded: true };
    }
    refreshAllThumbnails();
    switchTab('expressions');
    selectExpression('idle');
    setStatus('六种状态已应用到表情编辑器，请逐个校对');
  });

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

  // ── Load image into currently selected expression ──
  const loadCurrentSkinBtn = document.getElementById('loadCurrentSkinBtn');
  const currentSkinLabel = document.getElementById('currentSkinLabel');

  // Reuse the existing skinFilesInput for file picking
  let _loadToCurrentExpr = false;
  let _loadOneToAll = false;
  loadCurrentSkinBtn?.addEventListener('click', () => {
    if (!currentExprId) {
      setStatus('⚠ 请先点击一个表情卡片（如 idle/hover/pull）选中它');
      return;
    }
    currentSkinLabel.textContent = '→ ' + currentExprId;
    _loadToCurrentExpr = true;
    skinFilesInput?.click();
  });

  // ── Import expressions into skin library ──
  const importToLibraryBtn = document.getElementById('importToLibraryBtn');
  const importLibStatus = document.getElementById('importLibStatus');
  const importLibSkinId = document.getElementById('importLibSkinId');
  const importLibSkinName = document.getElementById('importLibSkinName');
  const importLibRes = document.getElementById('importLibRes');

  importToLibraryBtn?.addEventListener('click', async () => {
    try {
      if (!window.electronAPI?.skinSavePng) {
        importLibStatus.textContent = '❌ electronAPI 不可用';
        return;
      }
      let skinId = importLibSkinId.value.trim();
      if (!skinId) {
        importLibStatus.textContent = '⚠ 请输入皮肤 ID';
        return;
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(skinId)) {
        importLibStatus.textContent = '⚠ ID 只能包含字母、数字、下划线和连字符';
        return;
      }
      if (['turtle', 'cat'].includes(skinId)) {
        importLibStatus.textContent = '⚠ 不能覆盖内置皮肤';
        return;
      }
      const displayName = importLibSkinName.value.trim() || skinId;
      const resVal = parseInt(importLibRes.value, 10);

      // Save current editor state first
      if (currentExprId && exprData[currentExprId]) {
        exprData[currentExprId].grid = cloneGrid(pixelGrid);
      }

      importToLibraryBtn.disabled = true;
      importLibStatus.textContent = '正在导出并导入皮肤库...';

      // Generate and save PNGs for each loaded expression
      const frames = {};
      let saved = 0;
      for (const exp of EXPRESSIONS) {
        const data = exprData[exp.id];
        // 只要数据存在就保存（无论是从文件加载还是手动绘制）
        if (!data) continue;

        // Determine output size
        let outSize = data.size;
        if (resVal > 0) {
          outSize = resVal;
        }

        // Generate PNG
        const canvas = document.createElement('canvas');
        canvas.width = outSize;
        canvas.height = outSize;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;

        if (outSize !== data.size) {
          // Draw on intermediate canvas then scale
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = data.size;
          tmpCanvas.height = data.size;
          const tmpCtx = tmpCanvas.getContext('2d');
          for (let y = 0; y < data.size; y++) {
            for (let x = 0; x < data.size; x++) {
              const c = data.grid[y]?.[x];
              if (c) {
                tmpCtx.fillStyle = c;
                tmpCtx.fillRect(x, y, 1, 1);
              }
            }
          }
          ctx.drawImage(tmpCanvas, 0, 0, outSize, outSize);
        } else {
          for (let y = 0; y < outSize; y++) {
            for (let x = 0; x < outSize; x++) {
              const c = data.grid[y]?.[x];
              if (c) {
                ctx.fillStyle = c;
                ctx.fillRect(x, y, 1, 1);
              }
            }
          }
        }

        // Convert to base64 (strip data:image/png;base64, header)
        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1];

        const saveResult = await window.electronAPI.skinSavePng(skinId, exp.id, base64);
        if (saveResult.success) {
          // Map blink → blink_closed (file name is blink.png, state key is blink_closed)
          const stateKey = exp.id === 'blink' ? 'blink_closed' : exp.id;
          frames[stateKey] = saveResult.path;
          data.dirty = false;
          saved++;
        } else {
          console.warn('[SkinLib] Failed to save:', exp.id, saveResult.error);
        }
      }

      if (saved === 0) {
        importLibStatus.textContent = '⚠ 没有已加载的表情可保存';
        importToLibraryBtn.disabled = false;
        return;
      }

      // Auto-detect baseSize
      const idleData = exprData.idle;
      const baseSize = idleData && idleData.loaded ? idleData.size : (resVal > 0 ? resVal : 24);
      const TARGET_SIZE = 64;
      const scale = TARGET_SIZE / baseSize;

      // Update skins.json
      const config = await window.electronAPI.skinImportReadJson();
      if (!config.skins) config.skins = [];
      const existingIndex = config.skins.findIndex(s => s.id === skinId);
      const skinEntry = {
        id: skinId,
        name: skinId,
        displayName,
        author: '自定义',
        description: '从表情编辑器导入',
        frames,
        preview: frames.idle || frames.blink_closed || Object.values(frames)[0],
        scale,
        baseSize,
      };

      if (existingIndex >= 0) {
        config.skins[existingIndex] = skinEntry;
        importLibStatus.textContent = '✅ 已更新皮肤库: ' + displayName;
      } else {
        config.skins.push(skinEntry);
        importLibStatus.textContent = '✅ 已导入皮肤库: ' + displayName;
      }

      await window.electronAPI.skinImportWriteJson(config);
      refreshAllThumbnails();
      importToLibraryBtn.disabled = false;
      setStatus('✅ 已导入 ' + saved + ' 个表情到皮肤库: ' + displayName);
    } catch (err) {
      console.error('[SkinLib] Import error:', err);
      importLibStatus.textContent = '❌ 导入失败: ' + (err.message || '未知错误');
      importToLibraryBtn.disabled = false;
    }
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
          exprData[id].dirty = true;
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
  // Skin Import Module
  // ══════════════════════════════════════════════════════════════

  const SKIN_STATE_MAP = {
    'idle.png': 'idle', 'normal.png': 'idle', 'default.png': 'idle',
    'hover.png': 'hover', 'mouse.png': 'hover',
    'pull.png': 'pull', 'drag.png': 'pull',
    'happy.png': 'happy', 'smile.png': 'happy',
    'pain.png': 'pain', 'hurt.png': 'pain',
    'blink.png': 'blink_closed', 'blink_closed.png': 'blink_closed', 'closed.png': 'blink_closed',
  };

  let skinImportData = {
    folderPath: null,
    files: {},      // { stateKey: fileName }
    detectedImages: {}, // { stateKey: Image }
  };

  const skinImportDropZone = document.getElementById('skinImportDropZone');
  const skinImportDetectedBox = document.getElementById('skinImportDetectedBox');
  const skinImportDetected = document.getElementById('skinImportDetected');
  const skinImportFormBox = document.getElementById('skinImportFormBox');
  const skinImportActionBox = document.getElementById('skinImportActionBox');
  const skinImportBtn = document.getElementById('skinImportBtn');
  const skinImportStatus = document.getElementById('skinImportStatus');
  const skinLibraryList = document.getElementById('skinLibraryList');
  const skinImportId = document.getElementById('skinImportId');
  const skinImportName = document.getElementById('skinImportName');
  const skinImportAuthor = document.getElementById('skinImportAuthor');
  const skinImportDesc = document.getElementById('skinImportDesc');
  

  // Folder selection
  skinImportDropZone?.addEventListener('click', async () => {
    console.log('[SkinImport] Drop zone clicked');
    if (!window.electronAPI?.skinImportSelectFolder) {
      console.error('[SkinImport] skinImportSelectFolder API not available');
      return;
    }
    try {
      const folderPath = await window.electronAPI.skinImportSelectFolder();
      console.log('[SkinImport] Selected folder:', folderPath);
      if (!folderPath) return;
      skinImportData.folderPath = folderPath;

      // Read files in folder
      const files = await window.electronAPI.skinImportReadFiles(folderPath);
      if (!files || !files.length) {
        skinImportStatus.textContent = '文件夹为空';
        return;
      }

      // Detect state files
      skinImportData.files = {};
      skinImportData.detectedImages = {};
      const detected = [];

      for (const file of files) {
        const lower = file.toLowerCase();
        if (lower.endsWith('.png')) {
          const stateKey = SKIN_STATE_MAP[lower];
          if (stateKey) {
            skinImportData.files[stateKey] = file;
            detected.push({ stateKey, fileName: file });
          }
        }
      }

      if (!detected.length) {
        skinImportStatus.textContent = '未识别到状态文件（需要 idle.png 等）';
        skinImportDetectedBox.style.display = 'none';
        skinImportFormBox.style.display = 'none';
        skinImportActionBox.style.display = 'none';
        return;
      }

      // Show detected files
      skinImportDetectedBox.style.display = '';
      skinImportDetected.innerHTML = detected.map(d =>
        `<div>✅ ${d.fileName} → <span style="color:var(--title-color)">${d.stateKey}</span></div>`
      ).join('');

      // Auto-fill ID from folder name
      const folderName = folderPath.split(/[\\/]/).pop() || 'imported-skin';
      skinImportId.value = folderName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
      skinImportName.value = folderName;

      // Show form
      skinImportFormBox.style.display = '';
      skinImportActionBox.style.display = '';
      skinImportBtn.disabled = false;
      skinImportStatus.textContent = `已识别 ${detected.length} 个状态文件`;
    } catch (err) {
      console.error('[SkinImport] Error:', err);
      skinImportStatus.textContent = '❌ 错误: ' + err.message;
    }
  });

  // Import button
  skinImportBtn?.addEventListener('click', async () => {
    try {
      if (!skinImportData.folderPath || !window.electronAPI?.skinImportCopy) return;

    const skinId = skinImportId.value.trim();
    const displayName = skinImportName.value.trim() || skinId;
    const author = skinImportAuthor.value.trim() || 'Unknown';
    const description = skinImportDesc.value.trim() || '';
    const baseSize = 24; // will be auto-detected from idle image below

    if (!skinId) {
      skinImportStatus.textContent = '⚠ 请输入皮肤ID';
      return;
    }

    // Validate ID format
    if (!/^[a-zA-Z0-9_-]+$/.test(skinId)) {
      skinImportStatus.textContent = '⚠ ID 只能包含字母、数字、下划线和连字符';
      return;
    }

    skinImportBtn.disabled = true;
    skinImportStatus.textContent = '导入中...';

    // Copy files
    const filesToCopy = Object.values(skinImportData.files);
    const copyResult = await window.electronAPI.skinImportCopy(
      skinImportData.folderPath, skinId, filesToCopy
    );

    if (!copyResult.success) {
      skinImportStatus.textContent = '❌ 复制失败: ' + copyResult.error;
      skinImportBtn.disabled = false;
      return;
    }

    // Build frames object
    const frames = {};
    for (const [stateKey, fileName] of Object.entries(skinImportData.files)) {
      frames[stateKey] = `assets/skins/${skinId}/${fileName}`;
    }

    // Read existing skins.json
    let config = await window.electronAPI.skinImportReadJson();
    if (!config.skins) config.skins = [];

    // Protect built-in skins from being overwritten
    if (['turtle', 'cat'].includes(skinId)) {
      skinImportStatus.textContent = `⚠ "${skinId}" 是内置皮肤，不能覆盖。请使用其他 ID`;
      skinImportBtn.disabled = false;
      return;
    }

    // Auto-detect baseSize from idle image if not set
    let detectedBaseSize = baseSize;
    if (skinImportData.files.idle) {
      try {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          // Fix: convert Windows backslashes to forward slashes for valid file:// URL
          const normPath = skinImportData.folderPath.replace(/\\/g, '/');
          img.src = 'file:///' + normPath + '/' + skinImportData.files.idle;
        });
        detectedBaseSize = Math.max(img.width, img.height);
      } catch (e) {
        // Use user-provided value if detection fails
      }
    }

    // Calculate scale: normalize to TARGET_SIZE (64px display)
    const TARGET_SIZE = 64;
    const autoScale = TARGET_SIZE / detectedBaseSize;

    // Check for duplicate ID
    const existingIndex = config.skins.findIndex(s => s.id === skinId);
    const skinEntry = {
      id: skinId,
      name: skinId,
      displayName,
      author,
      description,
      frames,
      preview: frames.idle || Object.values(frames)[0],
      scale: autoScale,
      baseSize: detectedBaseSize,
    };

    if (existingIndex >= 0) {
      // Update existing
      config.skins[existingIndex] = skinEntry;
      skinImportStatus.textContent = `✅ 已更新皮肤: ${displayName}`;
    } else {
      // Add new
      config.skins.push(skinEntry);
      skinImportStatus.textContent = `✅ 已导入皮肤: ${displayName}`;
    }

    // Write skins.json
    const writeResult = await window.electronAPI.skinImportWriteJson(config);
    if (!writeResult.success) {
      skinImportStatus.textContent = '❌ 写入 skins.json 失败: ' + writeResult.error;
      skinImportBtn.disabled = false;
      return;
    }

    // Refresh skin library
    loadSkinLibrary(config.skins);

    // The imported files are already copied locally. Load that exact saved skin
    // into editable expression frames before clearing the import selection.
    const importedSkin = await window.electronAPI?.skinGetFrames?.(skinId);
    if (importedSkin?.success) {
      const loaded = await loadSkinFramesIntoExpressionEditor(importedSkin);
      skinImportStatus.textContent = `已导入 ${displayName}，并载入 ${loaded} 个状态供继续编辑`;
      setStatus(`已导入皮肤库并打开表情编辑：${displayName}`);
    }

    // Notify main window to reload skins
    // The main window will re-fetch skins.json on next skin selector open
    skinImportBtn.disabled = false;

    // Reset form for next import
    skinImportData = { folderPath: null, files: {}, detectedImages: {} };
  } catch (err) {
      console.error('[SkinImport] Import error:', err);
      skinImportStatus.textContent = '❌ 导入失败: ' + (err.message || '未知错误');
      skinImportBtn.disabled = false;
    }
  });

  // ═══ Skin Library Management ═══
  const BUILT_IN_SKINS = ['turtle', 'cat'];

  // Load and display skin library
  async function loadSkinLibrary(skins) {
    if (!skinLibraryList) return;
    if (!skins) {
      const config = await window.electronAPI?.skinImportReadJson();
      skins = config?.skins || [];
    }

    if (!skins.length) {
      skinLibraryList.innerHTML = '<div style="font-size:12px; color:#666; padding:12px;">皮肤库为空</div>';
      return;
    }

    // Separate built-in and custom skins
    const builtIn = skins.filter(s => BUILT_IN_SKINS.includes(s.id));
    const custom = skins.filter(s => !BUILT_IN_SKINS.includes(s.id));

    let html = '';

    // Built-in skins section
    if (builtIn.length) {
      html += `<div style="font-size:11px; color:#888; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid var(--border-mid);">🔒 内置皮肤（不可删除）</div>`;
      html += '<div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:16px;">';
      for (const skin of builtIn) {
        html += renderSkinCard(skin, false);
      }
      html += '</div>';
    }

    // Custom skins section
    if (custom.length) {
      html += `<div style="font-size:11px; color:#888; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid var(--border-mid);">📥 自定义皮肤</div>`;
      html += '<div style="display:flex; flex-wrap:wrap; gap:10px;">';
      for (const skin of custom) {
        html += renderSkinCard(skin, true);
      }
      html += '</div>';
    } else if (!builtIn.length) {
      html += '<div style="font-size:12px; color:#666; padding:12px;">暂无自定义皮肤</div>';
    } else {
      html += '<div style="font-size:12px; color:#666; padding:12px;">暂无自定义皮肤，使用上方导入功能添加</div>';
    }

    skinLibraryList.innerHTML = html;

    // Bind delete buttons
    skinLibraryList.querySelectorAll('[data-delete-skin]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const skinId = btn.getAttribute('data-delete-skin');
        const skinName = btn.getAttribute('data-skin-name') || skinId;
        if (!confirm(`确定要删除皮肤「${skinName}」吗？此操作不可恢复。`)) return;

        // Delete from skins.json
        const config = await window.electronAPI?.skinImportReadJson();
        if (config && config.skins) {
          config.skins = config.skins.filter(s => s.id !== skinId);
          await window.electronAPI.skinImportWriteJson(config);
        }

        // Delete folder
        await window.electronAPI.skinImportDelete(skinId);

        // Refresh list
        loadSkinLibrary(config?.skins);
        setStatus(`已删除皮肤: ${skinName}`);
      });
    });

    skinLibraryList.querySelectorAll('[data-edit-skin]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const skinId = btn.getAttribute('data-edit-skin');
        const skinName = btn.getAttribute('data-skin-name') || skinId;
        try {
          btn.disabled = true;
          const skin = await window.electronAPI?.skinGetFrames?.(skinId);
          if (!skin?.success) throw new Error(skin?.error || '读取皮肤失败');
          const loaded = await loadSkinFramesIntoExpressionEditor(skin);
          setStatus(`已载入 ${skinName} 的 ${loaded} 个状态，可继续编辑`);
        } catch (error) {
          setStatus(`载入 ${skinName} 失败：${error.message}`);
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  function renderSkinCard(skin, canDelete) {
    const isBuiltIn = BUILT_IN_SKINS.includes(skin.id);
    return `
      <div style="display:flex; align-items:center; gap:10px; padding:10px 14px; background:rgba(20,22,32,0.6); border:1px solid var(--border-mid); border-radius:4px; min-width:200px; flex:1; max-width:320px;">
        <img src="${skin.preview}" style="width:40px; height:40px; image-rendering:pixelated; border-radius:2px; background:rgba(0,0,0,0.3);" onerror="this.style.display='none'">
        <div style="flex:1; min-width:0;">
          <div style="font-size:13px; font-weight:bold; color:var(--text-color); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${skin.displayName || skin.id}</div>
          <div style="font-size:10px; color:#888; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${skin.author || 'Unknown'} · ${skin.id}</div>
          ${skin.description ? `<div style="font-size:10px; color:#666; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${skin.description}</div>` : ''}
        </div>
        <button class="btn" data-edit-skin="${skin.id}" data-skin-name="${skin.displayName || skin.id}" title="载入表情编辑器" style="padding:4px 8px; font-size:11px; flex-shrink:0;">编辑</button>
        ${canDelete ? `<button class="btn" data-delete-skin="${skin.id}" data-skin-name="${skin.displayName || skin.id}" title="删除皮肤" style="padding:4px 8px; font-size:11px; color:#cc6666; border-color:#663333; flex-shrink:0;">🗑️</button>` : `<span style="font-size:10px; color:#555; flex-shrink:0;">内置</span>`}
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  // Init
  // ══════════════════════════════════════════════════════════════

  function init() {
    buildExpressionCards();
    initDrawCanvas();
    selectExpression('idle');
    // Load skin library
    if (window.electronAPI?.skinImportReadJson) {
      loadSkinLibrary();
    }
    setStatus('就绪 — 可从基础皮肤、自由绘画或现有状态开始');
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
