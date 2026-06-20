# 🐢 Turtle Monitor → Electron 迁移交接文档

> **创建时间**: 2026-06-20
> **状态**: 待启动（PoC 阶段）
> **旧项目路径**: `D:\all\lightframe\Monitor\turtle_monitor\`（Python + tkinter，~2000 行）
> **新项目路径**: `D:\all\lightframe\new_monitor\`（Electron + PixiJS）

---

## 一、项目背景

Turtle Monitor 是一个 tkinter 像素风乌龟 GPU 监控桌面宠物。在 12 次提交的交互改造后，遇到了 tkinter 框架的天花板：

- 透明窗口在 Windows 上做得很痛苦（黑边/锯齿）
- Canvas 坐标系与窗口坐标系频繁冲突
- 物理模拟与 UI 刷新率耦合
- 重绘时机导致 flicker

**决定迁移到 Electron + PixiJS**，追求更高的动画和交互上限。

---

## 二、技术决策（已确认）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 框架 | **Electron** | 前端技术栈，动画生态最强 |
| 渲染引擎 | **PixiJS v7** | 稳定成熟，2D 渲染性能优秀 |
| 构建工具 | **Electron Forge + Vite** | 官方推荐，热更新快 |
| 透明穿透 | 透明区域穿透，乌龟/UI 可交互 | 桌宠标准做法 |
| 设置面板 | **HTML/CSS 覆盖层** | 原生交互 + CSS 动效 |
| 像素风策略 | 混合：像素精灵 + 矢量绳子/UI | 视觉层次最丰富 |
| 绳子视觉 | 平滑贝塞尔曲线 + 纹理 | 自然感最强 |
| 音效 | 基础音效（拖拽/释放/面板展开） | 锦上添花 |
| GPU 监控 | **nvidia-smi** + PowerShell WMI 兜底 | 用户显卡为 NVIDIA |
| 平台 | **仅 Windows** | 不需要跨平台 |
| 打包体积 | 不敏感 | Electron ~150MB 可接受 |

---

## 三、架构设计

```
┌─────────────────────────────────────────────┐
│  Main Process (Node.js)                     │
│  ├─ BrowserWindow (frameless+transparent)   │
│  ├─ GPU Monitor (nvidia-smi polling)        │
│  ├─ Settings Store (JSON)                   │
│  └─ Global Hotkey (RegisterHotKey)          │
└──────────────┬──────────────────────────────┘
               │ IPC (contextBridge)
┌──────────────▼──────────────────────────────┐
│  Renderer Process                            │
│  ├─ PixiJS Stage                             │
│  │   ├─ Rope Layer (贝塞尔曲线+纹理)          │
│  │   ├─ Turtle Layer (像素精灵动画)           │
│  │   ├─ Pulley Layer (滑轮视觉)              │
│  │   └─ Particle Layer (交互粒子效果)         │
│  ├─ Physics Engine (钟摆+滑轮惯性, 纯数学)    │
│  ├─ State Machine (状态驱动动画)              │
│  ├─ HTML Overlay (设置面板, 毛玻璃CSS)        │
│  └─ Input Manager (鼠标事件+拖拽)             │
└─────────────────────────────────────────────┘
```

### 核心分离原则

1. **物理层**：纯数学计算，归一化坐标（0.0~1.0），不依赖任何 UI
2. **渲染层**：PixiJS，将物理坐标 × 当前窗口尺寸 → 屏幕像素
3. **输入层**：捕获鼠标事件，驱动状态机
4. **数据层**：nvidia-smi 轮询，通过 IPC 推送到渲染进程

---

## 四、目录结构

```
turtle_electron/
├── forge.config.js              # Electron Forge 配置
├── vite.main.config.js          # 主进程 Vite 配置
├── vite.renderer.config.js      # 渲染进程 Vite 配置
├── package.json
├── src/
│   ├── main/                    # 主进程
│   │   ├── index.js             # 入口：窗口创建 + IPC + 托盘
│   │   ├── gpu-monitor.js       # nvidia-smi 轮询 + 数据解析
│   │   ├── store.js             # 设置持久化（JSON）
│   │   └── hotkey.js            # 全局热键（Windows RegisterHotKey）
│   └── renderer/                # 渲染进程
│       ├── index.html           # HTML 入口
│       ├── main.js              # PixiJS 初始化 + 主循环
│       ├── physics.js           # 钟摆 + 滑轮惯性物理引擎
│       ├── state-machine.js     # 状态定义 + 转换逻辑
│       ├── turtle.js            # 乌龟精灵管理 + 动画状态
│       ├── rope.js              # 绳子渲染（贝塞尔 + 纹理）
│       ├── panel.js             # GPU 数据面板（PixiJS 绘制）
│       ├── pulley.js            # 滑轮视觉效果
│       ├── particles.js         # 粒子效果系统
│       ├── input.js             # 鼠标事件 + 拖拽管理
│       ├── audio.js             # 音效管理
│       └── styles/
│           ├── settings.css     # 设置面板样式
│           └── global.css       # 全局样式（透明背景等）
├── assets/
│   ├── sprites/                 # 乌龟精灵图（从旧项目迁移）
│   │   ├── idle.png
│   │   ├── hover.png
│   │   ├── pull.png
│   │   ├── happy.png
│   │   └── pain.png
│   ├── rope/
│   │   └── texture.png          # 绳子纹理
│   ├── sounds/                  # 音效文件
│   │   ├── pull.wav
│   │   ├── release.wav
│   │   └── panel-open.wav
│   └── fonts/
│       └── Mojang-Regular.ttf   # 像素字体
├── scripts/
│   └── nvidia-smi-parser.js     # GPU 数据解析
└── docs/
    ├── HANDOVER.md              # 本文档
    ├── TECH_SPEC.md             # 技术规格
    ├── MIGRATION_PLAN.md        # 迁移计划
    └── DECISIONS.md             # 决策记录
```

---

## 五、功能迁移对照表

| 现有功能 (tkinter) | 新实现 (Electron+PixiJS) | 迁移难度 |
|---------------------|--------------------------|----------|
| `tk.Canvas.create_image` | `PIXI.Sprite` | 低 |
| `canvas.coords(sprite, x, y)` | `sprite.position.set(x, y)` | 低 |
| `canvas.create_line` 分段绘制 | `PIXI.Graphics` + `bezierCurveTo` | 中 |
| `root.geometry('WxH+X+Y')` | `win.setBounds({x,y,width,height})` | 低 |
| `root.bind('<B1-Motion>')` | PixiJS `pointermove` 事件 | 低 |
| `root.after(33, tick)` | `PIXI.Ticker` (自动 60fps) | 低 |
| `Toplevel` 设置窗口 | HTML overlay + CSS backdrop-filter | 中 |
| `tkinter.Menu` 右键菜单 | Electron `Menu.buildFromTemplate` | 低 |
| `subprocess nvidia-smi` | `child_process.exec('nvidia-smi')` | 低 |
| `ctypes RegisterHotKey` | Electron `globalShortcut` 或 N-API | 中 |
| `self.root.attributes('-alpha')` | CSS `opacity` + 透明窗口 | 低 |

---

## 六、状态机映射

旧项目的 8 个状态全部保留：

| 状态 | 触发条件 | 行为 |
|------|----------|------|
| `IDLE` | 默认 | 乌龟轻微摆动，显示 idle 精灵 |
| `HOVER` | 鼠标悬停乌龟 | 摆动加强，显示 hover 精灵 |
| `PULLING` | 左键按下乌龟并拖拽 | 乌龟跟随鼠标，窗口扩展，显示 pull 精灵 |
| `BOUNCING` | 释放拖拽 | 弹簧回弹动画，ease_out_back |
| `EXPANDING` | 回弹后拉伸超过阈值 | 面板展开动画 |
| `PANEL_OPEN` | 面板完全展开 | 显示 GPU 数据 |
| `COLLAPSING` | 点击非乌龟区域 | 面板收起动画 |
| `PULLEY_MOMENTUM` | 右键释放后 | 滑轮惯性衰减，显示 pain 精灵 |
| `HAPPY` | 面板展开前 300ms | 显示 happy 精灵 |

---

## 七、关键交互细节（必须保留）

### 左键交互
1. 点击乌龟 → 进入 PULLING
2. 拖拽 → 乌龟跟随鼠标，绳子拉伸，窗口扩展到 600px
3. 释放 → BOUNCING 回弹，如果拉伸超过阈值 → EXPANDING → PANEL_OPEN
4. 拉伸不足阈值 → 直接回 IDLE

### 右键交互
1. 右键点击乌龟 → 记录锚点
2. 右键拖拽 → 调整绳子位置（滑轮模拟）
3. 右键释放 → PULLEY_MOMENTUM 惯性衰减
4. 右键非乌龟区域 → 上下文菜单（刷新/设置/退出）

### 设置面板
- 滑块调整：乌龟大小、绳长、重力、阻尼、滑轮摩擦
- 保存/重置/取消按钮
- MC 风格 UI（像素边框、暗色主题）
- 右键拖拽关闭面板选项

---

## 八、需要从旧项目迁移的资源

| 资源 | 路径 | 说明 |
|------|------|------|
| 精灵数据 | `sprite_data.py` | 16x16 像素数组，需要转为 PNG |
| 像素字体 | `C:\Users\ban\AppData\Local\Microsoft\Windows\Fonts\Mojang-Regular.ttf` | Mojang 像素字体 |
| 配色方案 | `main.py` 中的颜色常量 | `#5C4033` 绳子棕色等 |
| 设置默认值 | `main.py` 中的常量 | `DEFAULT_ROPE_LENGTH=80` 等 |

---

## 九、PoC 验证目标

第一个可运行的 demo，验证技术可行性：

1. ✅ 透明无边框窗口 + 置顶
2. ✅ PixiJS 渲染一个静态乌龟精灵（从 sprite_data 转换）
3. ✅ 透明区域点击穿透（鼠标可以穿透到桌面）
4. ✅ 乌龟区域可拖拽
5. ✅ nvidia-smi 能读到 GPU 数据并在控制台打印

**PoC 完成后再进入完整迁移。**

---

## 十、风险与注意事项

1. **Electron 透明窗口在某些 Windows 版本上可能有性能问题** — 用 `--enable-gpu-rasterization` 解决
2. **nvidia-smi 调用有 ~100ms 延迟** — 需要异步轮询，不要阻塞渲染
3. **PixiJS 的 `setIgnoreMouseEvents` 需要与透明区域配合** — 可能需要动态切换
4. **旧精灵是 Python 数组格式** — 需要写脚本转为 PNG spritesheet
5. **全局热键在 Electron 中可能与系统快捷键冲突** — 需要选择冷门组合键

---

## 相关文件

- [技术规格](./TECH_SPEC.md)
- [迁移计划](./MIGRATION_PLAN.md)
- [决策记录](./DECISIONS.md)
- [旧项目代码](../Monitor/turtle_monitor/main.py)
- [旧项目精灵数据](../Monitor/turtle_monitor/sprite_data.py)
