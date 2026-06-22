// ── Fullscreen Region Marker ──────────────────────────────
// Opens an image, lets user drag rectangles to mark eyes/mouth, sends back via IPC.

(function () {
  'use strict';

  const imageCanvas = document.getElementById('imageCanvas');
  const imgCtx = imageCanvas.getContext('2d');
  const overlayCanvas = document.getElementById('overlayCanvas');
  const olCtx = overlayCanvas.getContext('2d');
  const canvasArea = document.getElementById('canvasArea');
  const selectEyesBtn = document.getElementById('selectEyesBtn');
  const selectMouthBtn = document.getElementById('selectMouthBtn');
  const clearRegionsBtn = document.getElementById('clearRegionsBtn');
  const confirmBtn = document.getElementById('confirmBtn');
  const regionStatus = document.getElementById('regionStatus');
  const statusText = document.getElementById('statusText');

  const regions = { eyes: null, mouth: null };
  let mode = null; // 'eyes' | 'mouth' | null
  let dragStart = null;
  let dragCur = null;

  function setStatus(t) { if (statusText) statusText.textContent = t; }
  function updateStatus() {
    const p = [];
    if (regions.eyes) p.push('👁️ 眼睛: ' + regions.eyes.w + '×' + regions.eyes.h);
    if (regions.mouth) p.push('👄 嘴巴: ' + regions.mouth.w + '×' + regions.mouth.h);
    if (regionStatus) regionStatus.textContent = p.join(' | ') || '未标记';
  }

  // ── Button states ──
  function updateButtons() {
    selectEyesBtn.classList.toggle('active-eyes', mode === 'eyes');
    selectMouthBtn.classList.toggle('active-mouth', mode === 'mouth');
    overlayCanvas.style.pointerEvents = mode ? 'auto' : 'none';
    overlayCanvas.style.cursor = mode ? 'crosshair' : '';
    if (mode === 'eyes') setStatus('在图片上拖拽选择眼睛区域...');
    else if (mode === 'mouth') setStatus('在图片上拖拽选择嘴巴区域...');
    else setStatus('就绪 — 点击上方按钮开始标记');
    drawOverlay();
  }

  selectEyesBtn.addEventListener('click', () => {
    mode = (mode === 'eyes') ? null : 'eyes';
    updateButtons();
  });
  selectMouthBtn.addEventListener('click', () => {
    mode = (mode === 'mouth') ? null : 'mouth';
    updateButtons();
  });
  clearRegionsBtn.addEventListener('click', () => {
    regions.eyes = regions.mouth = null;
    updateStatus(); updateButtons();
  });

  // ── Overlay size sync ──
  function syncOverlay() {
    overlayCanvas.width = imageCanvas.width;
    overlayCanvas.height = imageCanvas.height;
    overlayCanvas.style.width = imageCanvas.clientWidth + 'px';
    overlayCanvas.style.height = imageCanvas.clientHeight + 'px';
    drawOverlay();
  }

  // ── Drawing overlay ──
  function drawOverlay() {
    olCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (regions.eyes) drawRect(regions.eyes, 'rgba(100,200,255,0.3)', '#66ccff', '眼睛');
    if (regions.mouth) drawRect(regions.mouth, 'rgba(255,150,100,0.3)', '#ff9966', '嘴巴');
    if (dragStart && dragCur && mode) {
      const x = Math.min(dragStart.x, dragCur.x);
      const y = Math.min(dragStart.y, dragCur.y);
      const w = Math.abs(dragCur.x - dragStart.x);
      const h = Math.abs(dragCur.y - dragStart.y);
      olCtx.fillStyle = mode === 'eyes' ? 'rgba(100,200,255,0.25)' : 'rgba(255,150,100,0.25)';
      olCtx.fillRect(x, y, w, h);
      olCtx.strokeStyle = mode === 'eyes' ? '#66ccff' : '#ff9966';
      olCtx.lineWidth = 2;
      olCtx.strokeRect(x, y, w, h);
    }
  }

  function drawRect(r, fill, stroke, label) {
    olCtx.fillStyle = fill;
    olCtx.fillRect(r.x, r.y, r.w, r.h);
    olCtx.strokeStyle = stroke;
    olCtx.lineWidth = 2;
    olCtx.strokeRect(r.x, r.y, r.w, r.h);
    olCtx.fillStyle = stroke;
    olCtx.font = 'bold 14px sans-serif';
    olCtx.fillText(label, r.x + 4, r.y + 18);
  }

  // ── Mouse events on overlay ──
  // Temporarily enable pointer events only when in mode
  const origPointerEvents = overlayCanvas.style.pointerEvents;

  overlayCanvas.addEventListener('mousedown', (e) => {
    if (!mode) return;
    const r = overlayCanvas.getBoundingClientRect();
    const sx = overlayCanvas.width / r.width;
    const sy = overlayCanvas.height / r.height;
    dragStart = { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    dragCur = { ...dragStart };
  });

  overlayCanvas.addEventListener('mousemove', (e) => {
    if (!mode || !dragStart) return;
    const r = overlayCanvas.getBoundingClientRect();
    const sx = overlayCanvas.width / r.width;
    const sy = overlayCanvas.height / r.height;
    dragCur = { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    drawOverlay();
  });

  overlayCanvas.addEventListener('mouseup', () => {
    if (!mode || !dragStart || !dragCur) return;
    const x = Math.round(Math.min(dragStart.x, dragCur.x));
    const y = Math.round(Math.min(dragStart.y, dragCur.y));
    const w = Math.round(Math.abs(dragCur.x - dragStart.x));
    const h = Math.round(Math.abs(dragCur.y - dragStart.y));
    if (w > 2 && h > 2) {
      regions[mode] = { x, y, w, h };
    }
    dragStart = dragCur = null;
    mode = null;
    updateStatus();
    updateButtons();
  });

  // ── Confirm → send back to main process ──
  confirmBtn.addEventListener('click', () => {
    if (window.electronAPI?.regionMarkDone) {
      window.electronAPI.regionMarkDone(regions);
    }
    window.close();
  });

  document.getElementById('closeBtn').addEventListener('click', () => {
    // Send null to indicate cancelled
    if (window.electronAPI?.regionMarkDone) {
      window.electronAPI.regionMarkDone(null);
    }
    window.close();
  });

  // ── Init: request image data from main process ──
  async function init() {
    try {
      const data = await window.electronAPI.requestRegionImage();
      if (!data || !data.dataUrl) {
        setStatus('没有收到图片数据');
        return;
      }
      const img = new Image();
      img.onload = () => {
        // Scale to fit screen, max 2x original
        const maxW = window.innerWidth - 40;
        const maxH = window.innerHeight - 120;
        let scale = Math.min(maxW / img.width, maxH / img.height, 4);
        scale = Math.max(1, Math.floor(scale)); // integer scale for pixel art
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        imageCanvas.width = w;
        imageCanvas.height = h;
        imgCtx.imageSmoothingEnabled = false;
        imgCtx.drawImage(img, 0, 0, w, h);
        syncOverlay();
        setStatus('图片已加载 (' + img.width + '×' + img.height + ') — 缩放 ' + scale + 'x');
      };
      img.src = data.dataUrl;
    } catch (err) {
      setStatus('加载失败: ' + err.message);
    }
  }

  init();
})();
