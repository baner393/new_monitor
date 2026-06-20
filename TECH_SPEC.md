# 技术规格 (TECH_SPEC)

> 配合 HANDOVER.md 使用

---

## 1. Electron 配置

### BrowserWindow 参数

```javascript
const win = new BrowserWindow({
  width: 200,
  height: 400,
  frame: false,                    // 无边框
  transparent: true,               // 透明背景
  alwaysOnTop: true,               // 置顶
  resizable: false,                // 禁止用户手动调整大小
  skipTaskbar: true,               // 不在任务栏显示
  hasShadow: false,                // 无阴影
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false
  }
})

// Windows 特定优化
win.setIgnoreMouseEvents(true, { forward: true })  // 透明区域穿透
```

### 透明穿透机制

渲染进程需要根据鼠标位置动态切换穿透状态：

```javascript
// renderer/main.js
document.addEventListener('mousemove', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY)
  const isInteractive = el && (
    el.closest('#turtle-hitbox') ||
    el.closest('#settings-panel') ||
    el.closest('#context-menu')
  )
  // 通知主进程切换穿透状态
  window.electronAPI.setIgnoreMouse(!isInteractive)
})
```

---

## 2. PixiJS 渲染配置

```javascript
const app = new PIXI.Application({
  width: 200,
  height: 800,           // 初始高度，后续动态调整
  backgroundAlpha: 0,    // 完全透明
  antialias: false,      // 像素风不开抗锯齿
  resolution: 1,         // 1:1 像素映射
  hello: false
})

// 像素风渲染设置
PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST
PIXI.settings.ROUND_PIXELS = true
```

### Layer 结构（从下到上）

```
Stage
├── ropeContainer      # 绳子（贝塞尔曲线）
├── pulleyContainer    # 滑轮（圆 + 线条）
├── turtleContainer    # 乌龟精灵 + 命中区域
├── panelContainer     # GPU 数据面板
└── particleContainer  # 粒子效果
```

---

## 3. 物理引擎规格

### 钟摆物理

```javascript
// 与旧项目完全一致的物理参数
const GRAVITY = 800          // 重力加速度
const DAMPING = 0.995        // 阻尼系数
const DEFAULT_ROPE_LENGTH = 80  // 默认绳长（像素）
const MIN_ROPE_LENGTH = 20
const MAX_ROPE_LENGTH = 200

// 钟摆更新（每帧调用）
function updatePendulum(dt) {
  if (state === 'PULLING') return  // 拖拽时不运行物理

  const maxOffset = currentWidth / 2 - TURTLE_SIZE / 2 - 5
  const maxAngle = Math.asin(Math.min(1, maxOffset / Math.max(ropeLength, 1)))

  // θ'' = -(g/L) * sin(θ)
  let alpha = -(GRAVITY / ropeLength) * Math.sin(pendulumAngle)

  // 状态相关扰动
  if (state === 'IDLE') alpha += 0.8 * Math.sin(time * 3.0)
  if (state === 'HOVER') alpha += 2.0 * Math.sin(time * 4.0)

  pendulumOmega += alpha * dt
  pendulumOmega *= DAMPING
  pendulumAngle += pendulumOmega * dt
  pendulumAngle = Math.max(-maxAngle, Math.min(maxAngle, pendulumAngle))
}
```

### 滑轮惯性

```javascript
const PULLEY_FRICTION = 0.92  // 滑轮摩擦系数

function updatePulleyMomentum(dt) {
  if (state !== 'PULLEY_MOMENTUM') return
  screenAnchorX += pulleyMomentumVelocity * dt
  pulleyMomentumVelocity *= PULLEY_FRICTION

  // 边界反弹
  const margin = 50
  if (screenAnchorX < margin) {
    screenAnchorX = margin
    pulleyMomentumVelocity = Math.abs(pulleyMomentumVelocity) * 0.5
  }
  if (screenAnchorX > screenWidth - margin) {
    screenAnchorX = screenWidth - margin
    pulleyMomentumVelocity = -Math.abs(pulleyMomentumVelocity) * 0.5
  }
}
```

### 弹簧回弹

```javascript
function easeOutBack(t) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
```

---

## 4. 状态机规格

```javascript
const STATES = {
  IDLE: 'idle',
  HOVER: 'hover',
  PULLING: 'pulling',
  BOUNCING: 'bouncing',
  EXPANDING: 'expanding',
  HAPPY: 'happy',
  PANEL_OPEN: 'panel_open',
  COLLAPSING: 'collapsing',
  PULLEY_MOMENTUM: 'pulley_momentum'
}

const TRANSITIONS = {
  IDLE: {
    TURTLE_HOVER: 'HOVER',
    LEFT_CLICK_TURTLE: 'PULLING'
  },
  HOVER: {
    TURTLE_LEAVE: 'IDLE',
    LEFT_CLICK_TURTLE: 'PULLING'
  },
  PULLING: {
    LEFT_RELEASE: 'BOUNCING',
    TIMEOUT_5S: 'BOUNCING'
  },
  BOUNCING: {
    BOUNCE_COMPLETE: (ctx) => ctx.pullExceeded ? 'EXPANDING' : 'IDLE'
  },
  EXPANDING: {
    PANEL_FULLY_OPEN: 'PANEL_OPEN'
  },
  PANEL_OPEN: {
    CLICK_OUTSIDE: 'COLLAPSING'
  },
  COLLAPSING: {
    PANEL_FULLY_CLOSED: 'IDLE'
  },
  PULLEY_MOMENTUM: {
    MOMENTUM_STOPPED: 'IDLE',
    LEFT_CLICK_TURTLE: 'PULLING'
  }
}
```

---

## 5. GPU 数据采集规格

### nvidia-smi 调用

```javascript
// main/gpu-monitor.js
const { exec } = require('child_process')

const NVIDIA_SMI_CMD = 'nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw --format=csv,noheader,nounits'

function pollGPU() {
  return new Promise((resolve, reject) => {
    exec(NVIDIA_SMI_CMD, { timeout: 3000 }, (err, stdout) => {
      if (err) return reject(err)
      const [name, temp, gpuUtil, memUtil, memUsed, memTotal, power] =
        stdout.trim().split(', ').map(s => s.trim())
      resolve({
        name,
        temperature: parseInt(temp),
        gpuUtilization: parseInt(gpuUtil),
        memoryUtilization: parseInt(memUtil),
        memoryUsed: parseInt(memUsed),
        memoryTotal: parseInt(memTotal),
        powerDraw: parseFloat(power)
      })
    })
  })
}

// 每 2 秒轮询
setInterval(async () => {
  try {
    const data = await pollGPU()
    win.webContents.send('gpu-data', data)
  } catch (e) {
    console.error('GPU poll failed:', e.message)
  }
}, 2000)
```

### 数据格式

```typescript
interface GPUData {
  name: string              // "NVIDIA GeForce RTX 3080"
  temperature: number       // 摄氏度
  gpuUtilization: number    // 百分比 0-100
  memoryUtilization: number // 百分比 0-100
  memoryUsed: number        // MB
  memoryTotal: number       // MB
  powerDraw: number         // 瓦特
}
```

---

## 6. 绳子渲染规格

### 贝塞尔曲线

```javascript
function drawRope(graphics, anchorX, anchorY, endX, endY, sagAmount) {
  graphics.clear()
  graphics.lineStyle(ROPE_WIDTH, 0x5C4033)  // 棕色

  const midX = (anchorX + endX) / 2
  const midY = (anchorY + endY) / 2 + sagAmount

  graphics.moveTo(anchorX, anchorY)
  graphics.bezierCurveTo(
    anchorX, anchorY + sagAmount * 0.5,    // 控制点1
    endX, endY - sagAmount * 0.3,          // 控制点2
    endX, endY                              // 终点
  )
}

// sagAmount 基于绳长和角速度动态计算
const sagAmount = Math.min(ropeLength * 0.03, 10) + Math.min(Math.abs(omega) * 2, 5)
```

### 交替颜色效果

用两条略微偏移的曲线实现绳子的编织感：

```javascript
// 主线（深棕色）
graphics.lineStyle(ROPE_WIDTH, 0x5C4033)
graphics.bezierCurveTo(...)

// 副线（浅棕色，偏移 1px）
graphics.lineStyle(ROPE_WIDTH - 1, 0x8B7355)
graphics.moveTo(anchorX + 1, anchorY)
graphics.bezierCurveTo(...)
```

---

## 7. 设置面板规格

### HTML 结构

```html
<div id="settings-panel" class="settings-panel hidden">
  <div class="settings-header">
    <span class="mc-title">⚙️ 设置</span>
  </div>
  <div class="settings-body">
    <div class="slider-group">
      <label>🐢 乌龟大小</label>
      <input type="range" id="turtle-size" min="24" max="96" step="2" value="48">
      <span class="value">48</span>
    </div>
    <!-- 更多滑块... -->
  </div>
  <div class="settings-footer">
    <button class="mc-btn save">保存</button>
    <button class="mc-btn reset">重置</button>
    <button class="mc-btn cancel">取消</button>
  </div>
</div>
```

### CSS 核心样式

```css
.settings-panel {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 280px;
  background: rgba(30, 30, 30, 0.95);
  backdrop-filter: blur(10px);
  border: 2px solid #555;
  border-radius: 4px;
  font-family: 'Mojang', monospace;
  color: #fff;
  /* MC 风格像素边框 */
  box-shadow:
    inset 2px 2px 0 #6a6a6a,
    inset -2px -2px 0 #1a1a1a;
}

.mc-btn {
  background: #555;
  color: #fff;
  border: none;
  padding: 6px 16px;
  font-family: 'Mojang', monospace;
  cursor: pointer;
  /* MC 3D 按钮效果 */
  box-shadow:
    inset -2px -2px 0 #333,
    inset 2px 2px 0 #777;
}
.mc-btn:active {
  box-shadow:
    inset 2px 2px 0 #333,
    inset -2px -2px 0 #777;
}
```

---

## 8. 音效规格

| 事件 | 音效 | 时长 |
|------|------|------|
| 左键按下乌龟 | `pull-start.wav` | ~100ms |
| 释放回弹 | `bounce.wav` | ~200ms |
| 面板展开 | `panel-open.wav` | ~300ms |
| 面板关闭 | `panel-close.wav` | ~200ms |
| 右键拖拽开始 | `pulley-start.wav` | ~100ms |
| 设置保存 | `click.wav` | ~50ms |

使用 Web Audio API 播放：

```javascript
const audioCtx = new AudioContext()
function playSound(name) {
  const audio = new Audio(`assets/sounds/${name}`)
  audio.volume = 0.3
  audio.play()
}
```

---

## 9. IPC 通信协议

| 通道 | 方向 | 数据 | 说明 |
|------|------|------|------|
| `gpu-data` | Main → Renderer | `GPUData` | GPU 数据推送 |
| `set-ignore-mouse` | Renderer → Main | `boolean` | 切换鼠标穿透 |
| `set-bounds` | Renderer → Main | `{width, height}` | 调整窗口大小 |
| `get-settings` | Renderer → Main | - | 请求设置 |
| `save-settings` | Renderer → Main | `Settings` | 保存设置 |
| `show-context-menu` | Renderer → Main | `{x, y}` | 显示右键菜单 |
| `quit-app` | Renderer → Main | - | 退出应用 |
