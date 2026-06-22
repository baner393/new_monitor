// ── Fullscreen Pixel Canvas ──────────────────────────────────
// Receives grid data from custom mode window, allows drawing, sends back on save.

(function () {
  'use strict';

  const drawCanvas = document.getElementById('drawCanvas');
  const drawCtx = drawCanvas.getContext('2d');
  const canvasArea = document.getElementById('canvasArea');
  const penColorInput = document.getElementById('penColor');
  const toolPen = document.getElementById('toolPen');
  const toolEraser = document.getElementById('toolEraser');
  const toolFill = document.getElementById('toolFill');
  const toolUndo = document.getElementById('toolUndo');
  const toolClear = document.getElementById('toolClear');
  const zoomInBtn = document.getElementById('toolZoomIn');
  const zoomOutBtn = document.getElementById('toolZoomOut');
  const fitBtn = document.getElementById('toolFit');
  const zoomLabel = document.getElementById('zoomLevel');
  const sizeInfo = document.getElementById('sizeInfo');
  const saveBtn = document.getElementById('saveBtn');
  const statusText = document.getElementById('statusText');

  let drawSize = 64;
  let pixelScale = 8;
  let zoomPercent = 100;
  let currentTool = 'pen';
  let isDrawing = false;
  let pixelGrid = [];
  let history = [];
  let historyIndex = -1;
  let brushSize = 1;

  // Brush size selector
  document.getElementById('brushSize')?.addEventListener('change', (e) => {
    brushSize = parseInt(e.target.value, 10) || 1;
    setStatus('画笔大小: ' + brushSize + '×' + brushSize);
  });
  function setStatus(text) { statusText.textContent = text; }

  function createEmptyGrid(size) {
    const grid = [];
    for (let y = 0; y < size; y++) {
      grid[y] = [];
      for (let x = 0; x < size; x++) grid[y][x] = null;
    }
    return grid;
  }

  function cloneGrid(grid) { return grid.map(row => [...row]); }

  function getFitScale() {
    const areaW = canvasArea.clientWidth - 40;
    const areaH = canvasArea.clientHeight - 40;
    return Math.max(2, Math.floor(Math.min(areaW, areaH) / drawSize));
  }

  function resizeCanvas() {
    drawCanvas.width = drawSize * pixelScale;
    drawCanvas.height = drawSize * pixelScale;
    drawCtx.imageSmoothingEnabled = false;
    redrawCanvas();
  }

  function redrawCanvas() {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    for (let y = 0; y < drawSize; y++) {
      for (let x = 0; x < drawSize; x++) {
        const color = pixelGrid[y]?.[x];
        if (color) {
          drawCtx.fillStyle = color;
          drawCtx.fillRect(x * pixelScale, y * pixelScale, pixelScale, pixelScale);
        }
      }
    }
    drawGrid();
  }

  function drawGrid() {
    if (pixelScale < 4) return;
    drawCtx.strokeStyle = 'rgba(255,255,255,0.08)';
    drawCtx.lineWidth = 0.5;
    for (let x = 0; x <= drawSize; x++) {
      drawCtx.beginPath();
      drawCtx.moveTo(x * pixelScale + 0.5, 0);
      drawCtx.lineTo(x * pixelScale + 0.5, drawCanvas.height);
      drawCtx.stroke();
    }
    for (let y = 0; y <= drawSize; y++) {
      drawCtx.beginPath();
      drawCtx.moveTo(0, y * pixelScale + 0.5);
      drawCtx.lineTo(drawCanvas.width, y * pixelScale + 0.5);
      drawCtx.stroke();
    }
  }

  function saveHistory() {
    const snap = cloneGrid(pixelGrid);
    history = history.slice(0, historyIndex + 1);
    history.push(snap);
    historyIndex = history.length - 1;
    if (history.length > 100) { history.shift(); historyIndex--; }
  }

  function undo() {
    if (historyIndex > 0) {
      historyIndex--;
      pixelGrid = cloneGrid(history[historyIndex]);
      redrawCanvas();
    }
  }

  function getPixelPos(e) {
    const rect = drawCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / pixelScale);
    const y = Math.floor((e.clientY - rect.top) / pixelScale);
    return { x: Math.max(0, Math.min(drawSize - 1, x)), y: Math.max(0, Math.min(drawSize - 1, y)) };
  }

  function drawPixel(x, y, color) {
    const half = Math.floor(brushSize / 2);
    for (let dy = -half; dy < brushSize - half; dy++) {
      for (let dx = -half; dx < brushSize - half; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || px >= drawSize || py < 0 || py >= drawSize) continue;
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

  function erasePixel(x, y) {
    const half = Math.floor(brushSize / 2);
    for (let dy = -half; dy < brushSize - half; dy++) {
      for (let dx = -half; dx < brushSize - half; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || px >= drawSize || py < 0 || py >= drawSize) continue;
        pixelGrid[py][px] = null;
        drawCtx.clearRect(px * pixelScale, py * pixelScale, pixelScale, pixelScale);
      }
    }
  }

  function floodFill(startX, startY, fillColor) {
    const startColor = pixelGrid[startY]?.[startX] || null;
    if (startColor === fillColor) return;
    const stack = [[startX, startY]];
    const visited = new Set();
    while (stack.length > 0) {
      const [cx, cy] = stack.pop();
      const key = `${cx},${cy}`;
      if (visited.has(key)) continue;
      if (cx < 0 || cx >= drawSize || cy < 0 || cy >= drawSize) continue;
      if (pixelGrid[cy][cx] !== startColor) continue;
      visited.add(key);
      pixelGrid[cy][cx] = fillColor;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    redrawCanvas();
  }

  // Zoom
  function setZoom(pct) {
    zoomPercent = Math.max(25, Math.min(1600, pct));
    const fitScale = getFitScale();
    pixelScale = Math.max(1, Math.round(fitScale * zoomPercent / 100));
    resizeCanvas();
    zoomLabel.textContent = `${zoomPercent}%`;
  }

  zoomInBtn.addEventListener('click', () => setZoom(zoomPercent + 25));
  zoomOutBtn.addEventListener('click', () => setZoom(zoomPercent - 25));
  fitBtn.addEventListener('click', () => setZoom(100));

  canvasArea.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(zoomPercent + (e.deltaY > 0 ? -10 : 10));
  }, { passive: false });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(zoomPercent + 25); }
    else if (e.key === '-') { e.preventDefault(); setZoom(zoomPercent - 25); }
    else if (e.key === '0') { e.preventDefault(); setZoom(100); }
    else if (e.key === 'b' || e.key === 'B') { selectTool('pen'); }
    else if (e.key === 'e' || e.key === 'E') { selectTool('eraser'); }
    else if (e.key === 'g' || e.key === 'G') { selectTool('fill'); }
    else if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    else if (e.key === 'Escape') { saveAndClose(); }
  });

  // Tool selection
  function selectTool(tool) {
    currentTool = tool;
    [toolPen, toolEraser, toolFill].forEach(b => b.classList.remove('active'));
    if (tool === 'pen') toolPen.classList.add('active');
    else if (tool === 'eraser') toolEraser.classList.add('active');
    else if (tool === 'fill') toolFill.classList.add('active');
  }
  toolPen.addEventListener('click', () => selectTool('pen'));
  toolEraser.addEventListener('click', () => selectTool('eraser'));
  toolFill.addEventListener('click', () => selectTool('fill'));
  toolUndo.addEventListener('click', undo);
  toolClear.addEventListener('click', () => {
    pixelGrid = createEmptyGrid(drawSize);
    redrawCanvas();
    saveHistory();
  });

  // Drawing events (left click)
  drawCanvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) return; // right click handled by pan
    isDrawing = true;
    const { x, y } = getPixelPos(e);
    if (currentTool === 'fill') { floodFill(x, y, penColorInput.value); saveHistory(); }
    else if (currentTool === 'pen') drawPixel(x, y, penColorInput.value);
    else erasePixel(x, y);
  });
  drawCanvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const { x, y } = getPixelPos(e);
    if (currentTool === 'pen') drawPixel(x, y, penColorInput.value);
    else if (currentTool === 'eraser') erasePixel(x, y);
  });
  drawCanvas.addEventListener('mouseup', (e) => {
    if (e.button === 0 && isDrawing) { isDrawing = false; saveHistory(); }
  });
  drawCanvas.addEventListener('mouseleave', () => { if (isDrawing) { isDrawing = false; saveHistory(); } });

  // ── Right-click panning ──────────────────────────────────
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOffsetX = 0;
  let panOffsetY = 0;
  let panOriginX = 0;
  let panOriginY = 0;

  canvasArea.addEventListener('contextmenu', (e) => e.preventDefault());

  canvasArea.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOriginX = panOffsetX;
      panOriginY = panOffsetY;
      canvasArea.style.cursor = 'grabbing';
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    panOffsetX = panOriginX + (e.clientX - panStartX);
    panOffsetY = panOriginY + (e.clientY - panStartY);
    drawCanvas.style.transform = `translate(${panOffsetX}px, ${panOffsetY}px)`;
  });

  document.addEventListener('mouseup', (e) => {
    if (e.button === 2 && isPanning) {
      isPanning = false;
      canvasArea.style.cursor = '';
    }
  });

  // Reset pan on zoom change
  function resetPan() {
    panOffsetX = 0;
    panOffsetY = 0;
    drawCanvas.style.transform = '';
  }

  // Close / Save
  document.getElementById('closeBtn').addEventListener('click', saveAndClose);
  saveBtn.addEventListener('click', saveAndClose);

  function saveAndClose() {
    window.electronAPI.saveGridData(pixelGrid);
    window.close();
  }

  // ── Init: request grid data from main process ─────────────
  async function init() {
    try {
      const data = await window.electronAPI.requestGridData();
      drawSize = data.size || 64;
      pixelGrid = data.grid ? cloneGrid(data.grid) : createEmptyGrid(drawSize);
      sizeInfo.textContent = `${drawSize}×${drawSize}`;

      const fitScale = getFitScale();
      pixelScale = fitScale;
      zoomPercent = 100;
      zoomLabel.textContent = '100%';

      history = [];
      historyIndex = -1;
      resizeCanvas();
      saveHistory();
      setStatus(`全屏画布: ${drawSize}×${drawSize} — 滚轮缩放，Ctrl+Z 撤销，Esc 保存关闭`);
    } catch (err) {
      console.error('[Canvas] Failed to init:', err);
      setStatus('初始化失败: ' + err.message);
    }
  }

  init();

})();
