# 🔍 代码审核请求 — Electron+PixiJS 自定义模式

请审核以下桌面宠物应用的「自定义模式」代码，用中文回复，按严重程度排序（🔴严重/🟡中等/🟢低）。

## 项目背景
Electron + PixiJS 桌面宠物应用，自定义模式包含：
- 皮肤转换器（上传图片→自动拆分为6种表情）
- 像素画布编辑器（画笔/橡皮/填充/吸色，支持1-8像素画笔）
- 表情编辑器（加载现有皮肤→编辑→导出）
- 全屏标记窗口（独立BrowserWindow，IPC中继）

## 代码 1：皮肤加载（异步多文件）
```javascript
skinFilesInput?.addEventListener('change', (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const applyAll = document.getElementById('applyAllCheckbox')?.checked || false;
    const resMode = loadResMode?.value || 'original';
    const customResSize = parseInt(loadResCustom?.value || '64', 10);
    const nameMap = {};
    EXPRESSIONS.forEach(exp => {
      nameMap[exp.id.toLowerCase()] = exp.id;
      nameMap[exp.id.toLowerCase() + '.png'] = exp.id;
    });
    let loadedCount = 0;
    const total = files.length;
    
    function applyOneImage(matchId, grid, size) {
      if (applyAll) {
        EXPRESSIONS.forEach(exp => {
          exprData[exp.id] = { grid: cloneGrid(grid), size, loaded: true };
        });
      } else {
        exprData[matchId] = { grid: cloneGrid(grid), size, loaded: true };
      }
    }
    
    function onAllDone() {
      refreshAllThumbnails();
      if (currentExprId && exprData[currentExprId] && exprData[currentExprId].loaded) {
        pixelGrid = cloneGrid(exprData[currentExprId].grid);
        requestAnimationFrame(function() {
          exprPixelScale = getExprBaseScale();
          exprZoomPercent = 100;
          exprZoomLabel.textContent = '100%';
          resizeExprCanvas();
        });
      }
      finishSkinLoad();
    }
    
    Array.from(files).forEach(file => {
      const stem = file.name.replace(/\.png$/i, '').toLowerCase();
      const matchId = nameMap[stem] || nameMap[stem + '.png'];
      if (!matchId) { loadedCount++; if (loadedCount >= total) onAllDone(); return; }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          let targetW = img.width, targetH = img.height;
          if (resMode === 'custom') { targetW = customResSize; targetH = customResSize; }
          const size = Math.max(targetW, targetH);
          const grid = createEmptyGrid(size);
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = targetW; tmpCanvas.height = targetH;
          const tmpCtx = tmpCanvas.getContext('2d');
          tmpCtx.imageSmoothingEnabled = false;
          tmpCtx.drawImage(img, 0, 0, targetW, targetH);
          const imgData = tmpCtx.getImageData(0, 0, targetW, targetH);
          for (let y = 0; y < targetH; y++) {
            for (let x = 0; x < targetW; x++) {
              const i = (y * targetW + x) * 4;
              if (imgData.data[i+3] > 128)
                grid[y][x] = 'rgb('+imgData.data[i]+','+imgData.data[i+1]+','+imgData.data[i+2]+')';
              else grid[y][x] = null;
            }
          }
          applyOneImage(matchId, grid, size);
          loadedCount++;
          if (loadedCount >= total) onAllDone();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
});
```

## 代码 2：表达式选择（延迟布局）
```javascript
function selectExpression(exprId) {
    if (currentExprId && exprData[currentExprId]) {
      exprData[currentExprId].grid = cloneGrid(pixelGrid);
    }
    currentExprId = exprId;
    const data = exprData[exprId];
    document.querySelectorAll('.expression-card').forEach(c => {
      c.classList.toggle('active', c.dataset.id === exprId);
    });
    expressionEditor.style.display = '';
    pixelGrid = cloneGrid(data.grid);
    exprZoomPercent = 100;
    exprZoomLabel.textContent = '100%';
    resetExprPan();
    requestAnimationFrame(function() {
      exprPixelScale = getExprBaseScale();
      resizeExprCanvas();
    });
}
```

## 代码 3：画笔大小绘制
```javascript
function exprDrawPixel(x, y, color) {
    const size = getExprSize();
    const half = Math.floor(exprBrushSize / 2);
    for (let dy = -half; dy < exprBrushSize - half; dy++) {
      for (let dx = -half; dx < exprBrushSize - half; dx++) {
        const px = x + dx, py = y + dy;
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
```

## 代码 4：自动表情生成（像素变换）
```javascript
function scaleRegion(grid, size, region, factor) {
    const { x, y, w, h } = region;
    const nw = Math.max(1, Math.round(w * factor));
    const nh = Math.max(1, Math.round(h * factor));
    const ox = x + Math.floor((w - nw) / 2);
    const oy = y + Math.floor((h - nh) / 2);
    const src = document.createElement('canvas'); src.width = w; src.height = h;
    const sctx = src.getContext('2d');
    for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
      const c = grid[y+sy]?.[x+sx];
      if (c) { sctx.fillStyle = c; sctx.fillRect(sx, sy, 1, 1); }
    }
    const dst = document.createElement('canvas'); dst.width = nw; dst.height = nh;
    const dctx = dst.getContext('2d'); dctx.imageSmoothingEnabled = false;
    dctx.drawImage(src, 0, 0, nw, nh);
    for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
      if (y+sy < size && x+sx < size) grid[y+sy][x+sx] = null;
    }
    const img = dctx.getImageData(0, 0, nw, nh);
    for (let dy = 0; dy < nh; dy++) for (let dx = 0; dx < nw; dx++) {
      const i = (dy*nw+dx)*4;
      if (img.data[i+3] > 128) {
        const gx = ox+dx, gy = oy+dy;
        if (gx>=0 && gx<size && gy>=0 && gy<size)
          grid[gy][gx] = 'rgb('+img.data[i]+','+img.data[i+1]+','+img.data[i+2]+')';
      }
    }
}

function curveRegion(grid, size, region, dir) {
    const { x, y, w, h } = region;
    for (let dx = 0; dx < w; dx++) {
      const dist = Math.abs(dx - w / 2) / (w / 2);
      const shift = Math.round(dist * dir);
      if (shift !== 0) shiftColumn(grid, size, x + dx, y, h, shift);
    }
}

function replaceWithPainEyes(grid, size, region) {
    const { x, y, w, h } = region;
    clearRegion(grid, region);
    const half = Math.floor(w / 2);
    const eyeColor = grid[y]?.[x] || 'rgb(0,0,0)';
    for (let dy = 0; dy < h; dy++) {
      const t = h > 1 ? dy / (h - 1) : 0.5;
      const indent = Math.round(t * half * 0.6);
      // Left eye: > shape
      const gx1 = x + half - 1 - indent;
      const gx2 = x + half - 1 - indent + 1;
      if (gx1 >= x && gx1 < x + half && y + dy >= 0 && y + dy < size) grid[y + dy][gx1] = eyeColor;
      if (gx2 >= x && gx2 < x + half && y + dy >= 0 && y + dy < size) grid[y + dy][gx2] = eyeColor;
      // Right eye: < shape
      const gx3 = x + half + indent;
      const gx4 = x + half + indent - 1;
      if (gx3 >= x + half && gx3 < x + w && y + dy >= 0 && y + dy < size) grid[y + dy][gx3] = eyeColor;
      if (gx4 >= x + half && gx4 < x + w && y + dy >= 0 && y + dy < size) grid[y + dy][gx4] = eyeColor;
    }
}
```

## 代码 5：全屏标记窗口 IPC
```javascript
// 主进程
let regionWindow;
let pendingRegionImage = null;
function openRegionMarker(imageData) {
  if (regionWindow && !regionWindow.isDestroyed()) { regionWindow.focus(); return; }
  pendingRegionImage = imageData;
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  regionWindow = new BrowserWindow({
    width, height, frame: false, backgroundColor: '#0e1018',
    title: '标记区域 — 全屏模式',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(app.getAppPath(), 'src', 'custom', 'preload.js'),
    },
  });
  regionWindow.webContents.setZoomFactor(1);
  regionWindow.loadFile(path.join(app.getAppPath(), 'src', 'custom', 'canvas-region.html'));
  regionWindow.on('closed', () => { regionWindow = null; pendingRegionImage = null; });
}
ipcMain.on('open-region-marker', (event, imageData) => openRegionMarker(imageData));
ipcMain.handle('region-request-image', () => pendingRegionImage || { dataUrl: null });
ipcMain.on('region-mark-done', (event, regions) => {
  if (customWindow && !customWindow.isDestroyed()) {
    customWindow.webContents.send('region-result', regions);
  }
});

// 转换器Tab JS
fullscreenMarkBtn?.addEventListener('click', () => {
    if (!converterImage) { setStatus('请先加载一张图片'); return; }
    const tc = document.createElement('canvas');
    tc.width = converterImage.width; tc.height = converterImage.height;
    const tctx = tc.getContext('2d'); tctx.drawImage(converterImage, 0, 0);
    const dataUrl = tc.toDataURL('image/png');
    if (window.electronAPI?.openRegionMarker) {
      window.electronAPI.openRegionMarker({ dataUrl });
    }
});
if (window.electronAPI?.onRegionResult) {
    window.electronAPI.onRegionResult((regions) => {
      if (regions && regions.eyes && regions.mouth) {
        autoExpr.eyes = regions.eyes;
        autoExpr.mouth = regions.mouth;
        updateRegionStatus(); updateGenerateBtn(); drawSelOverlay();
      }
    });
}
```

## 请检查
1. 🔴 严重 bug 或逻辑错误
2. 🟡 内存泄漏（临时 canvas/ImageBitmap 未释放）
3. 🟡 异步竞态条件
4. 🟢 用户体验问题
5. 🟢 改进建议和最佳实践
