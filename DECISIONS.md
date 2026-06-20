# 决策记录 (DECISIONS)

> 记录所有技术决策及其理由，供后续参考

---

## 2026-06-20：框架选型决策

### 背景
旧项目使用 Python + tkinter Canvas，遇到以下问题：
1. 透明窗口在 Windows 上有黑边/锯齿
2. Canvas 坐标系与窗口坐标系频繁冲突
3. 物理模拟与 UI 刷新率耦合
4. 重绘时机导致 flicker
5. 2000 行单文件难以维护

### 候选方案
- A. 继续 tkinter 修补
- B. PyQt/PySide6
- C. Electron + PixiJS
- D. Tauri + Canvas
- E. Godot
- F. Pygame

### 最终决策
**Electron + PixiJS** (方案 C)

### 决策理由
1. **动画上限最高**：前端动画生态（GSAP、PixiJS、CSS 动效）碾压其他方案
2. **用户需求匹配**：用户要求"动画和交互越好看、越高级越好"
3. **Agent 友好**：HTML/CSS/JS 对 AI agent 来说最容易编写和调试
4. **体积不敏感**：用户明确表示 Electron ~150MB 可接受
5. **仅 Windows**：不需要考虑跨平台，减少 Electron 的劣势

### 淘汰理由
- tkinter：性能和特性天花板太低
- PyQt/PySide6：动画能力不如前端生态
- Tauri：需要 Rust，开发成本高
- Godot：大炮打蚊子，GPU 数据集成复杂
- Pygame：无法做透明置顶窗口
- Electron（方案 C）胜出原因：最成熟的桌面应用框架 + 最强的动画渲染能力

---

## 2026-06-20：PixiJS 版本决策

### 决策
**PixiJS v7**

### 理由
- v8 虽然支持 WebGPU，但文档和插件生态还在完善
- 像素风桌宠不需要 WebGPU 的极致性能
- v7 稳定成熟，社区资源丰富

---

## 2026-06-20：构建工具决策

### 决策
**Electron Forge + Vite**

### 理由
- Electron Forge 是官方推荐的脚手架
- Vite 热更新速度快，开发体验好
- 配置简洁，不需要复杂的 webpack 配置

---

## 2026-06-20：渲染策略决策

### 决策
**混合渲染：像素精灵 + 矢量绳子/UI**

### 理由
- 像素精灵保持桌宠的特色和可爱感
- 绳子用 PixiJS Graphics API 的贝塞尔曲线，比旧项目的分段线条更自然
- UI 面板用 HTML/CSS，可以实现毛玻璃、动画等现代效果
- 三种渲染方式各取所长

---

## 2026-06-20：设置面板实现决策

### 决策
**HTML/CSS 覆盖层**（不用 PixiJS 绘制）

### 理由
- HTML 表单原生支持滑块、输入框、按钮等交互
- CSS 可以实现毛玻璃（backdrop-filter）、MC 风格边框
- 不需要自己实现滑块拖拽逻辑
- 可以用 CSS transition 做展开/收起动画

---

## 2026-06-20：GPU 监控方案决策

### 决策
**nvidia-smi + PowerShell WMI 兜底**

### 理由
- 用户显卡为 NVIDIA
- nvidia-smi 是最准确的 GPU 数据源
- WMI 作为兜底方案，可以监控 CPU/RAM
- child_process.exec 调用系统命令，延迟可接受（~100ms）

---

## 2026-06-20：透明穿透策略决策

### 决策
**透明区域穿透，乌龟/UI 区域可交互**

### 理由
- 桌宠标准做法
- Electron 的 `setIgnoreMouseEvents(true, { forward: true })` 支持此模式
- 需要动态切换：鼠标在乌龟上时可交互，在空白处穿透

---

## 2026-06-20：音效策略决策

### 决策
**基础音效**（拖拽/释放/面板展开）

### 理由
- 锦上添花，不过度
- 使用 Web Audio API，不需要额外依赖
- 音效文件小，不影响打包体积
- 用户可以后续自行添加更多音效

---

## 2026-06-20：项目结构决策

### 决策
**主进程/渲染进程分离，渲染进程内按模块拆分**

### 理由
- 主进程负责：窗口管理、系统交互、GPU 数据采集
- 渲染进程负责：所有视觉渲染和用户交互
- 渲染进程内按功能模块拆分：physics.js、turtle.js、rope.js 等
- 避免旧项目 2000 行单文件的问题
- 每个模块职责单一，便于维护和测试

---

## 待决策事项

### 精灵格式
- 旧精灵是 Python 数组格式（sprite_data.py）
- 需要转换为 PNG spritesheet
- 决策：写转换脚本，保持 16x16 分辨率

### 全局热键
- Electron 的 globalShortcut 在某些情况下可能与系统快捷键冲突
- 决策：选择冷门组合键（如 Ctrl+Shift+Alt+T）
- 备选：使用 N-API 调用 Windows RegisterHotKey

### 多显示器支持
- 旧项目假设单显示器
- 决策：PoC 阶段不考虑，完整迁移时再处理
