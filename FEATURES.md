# Turtle Monitor 功能全景

> 最后更新: 2026-08-17
> 技术栈: Electron + PixiJS 7 + Vite 6 + LibreHardwareMonitor 0.9.6

---

## 一、版本体系

| 版本 | 产品名 | App ID | 可执行文件 | 自定义模式 |
|:---|:---|:---|:---|:---|
| 🆓 **Free** | Turtle Monitor | `com.turtlemonitor.app` | `TurtleMonitorFree.exe` | ❌ 无 |
| 💎 **Sponsor** | Turtle Monitor Sponsor | `com.turtlemonitor.sponsor` | `TurtleMonitorSponsor.exe` | ✅ 有 |

**共享功能**：桌宠、系统监控、监控管理器、Codex 集成、皮肤切换。

---

## 二、桌面宠物系统

### 2.1 物理引擎 (`physics.js`)
- **钟摆物理**：重力加速度 800 px/s²，阻尼系数 0.995，绳长 40-300px
- **右键甩动物理**：弹簧刚度 500，弹簧阻尼 15，空气阻尼 0.98
- **滑轮摩擦**：0.92
- **环境摆动**：可开关

### 2.2 状态机 (`state-machine.js`)
- **13 种状态**：IDLE → HOVER → PULLING → BOUNCING / EXPANDING → PANEL_OPEN → COLLAPSING
- **滑轮交互**：PULLEY_DRAG / PULLEY_MOMENTUM / PULLEY_PHYSICS
- **Codex 配置**：CODEX_CONFIG_OPENING / CODEX_CONFIG_OPEN / CODEX_CONFIG_CLOSING
- **附加状态**：HAPPY（保留用途）

### 2.3 绳子渲染 (`rope.js`)
- 贝塞尔曲线两段式渲染
- Minecraft 像素风格编织绳，3D 着色（高光/阴影）
- 拖拽时绳子变紧，保持最小弧度

### 2.4 精灵动画
- 6 帧状态：idle / hover / pull / happy / pain / blink
- PixiJS NEAREST 缩放保持像素质感
- 像素画分辨率：24×24（乌龟）或 96×96（猫），缩放系数 1.0-2.5

### 2.5 交互系统 (`input.js`)
- 左键拖拽乌龟
- 右键甩动（滑轮模式）
- 点击穿透（透明窗口区域）
- 像素级碰撞检测 + 边缘容差

---

## 三、系统监控面板

### 3.1 传感器种类（8 类）
| 类别 | 数据来源 | 可视化 |
|:---|:---|:---|
| CPU | 性能计数器 + LibreHardwareMonitor | 使用率 + 温度 + 频率 |
| 内存 | 系统计数 | 容量条 + 页面文件 |
| GPU | 显卡厂商工具 + LibreHardwareMonitor | 使用率 + 温度 + 显存 |
| 存储 | CIM + DiskInfoToolkit | 容量条 + 分区 |
| 网络 | 系统累计计数 | 速度动效 + 上下行 |
| 散热 | LibreHardwareMonitor | 风扇转速 + 温度 |
| 功耗 | LibreHardwareMonitor | 功率读数 |
| 电池 | 系统计数 | 剩余容量条（反向告警） |

### 3.2 视觉反馈系统
- **容量条**：75% 后连续转暖黄，90% 后深红告警
- **温度条**：冷蓝 → 青绿 → 暖黄 → 红色，支持逐设备覆盖阈值
- **动态效果**：网络/磁盘/风扇使用像素生态动效，速度分 5 档（静止/低/中/高/爆发）
- **降档迟滞**：升档立即生效，降档带迟滞避免闪烁

### 3.3 布局管理
- **4 种预设**：极简、性能、硬件、全量
- **自定义布局**：拖拽排序 + 显隐切换
- **草稿机制**：直接返回/收起/刷新前提交，取消恢复快照
- **配置持久化**：`MonitorPanelConfigV2`，设备临时缺失不丢失用户设置

### 3.4 管理页面（3 页）
- **布局页**：预设选择 + 卡片排序 + 显隐
- **传感器页**：明细类别管理 + 速度动效 + 逐设备温区阈值
- **权限页**：读取数量 + 硬件节点 + 读取错误 + 管理员权限提升入口

### 3.5 数据采集架构
- 多级回退：Node 原生接口 → Windows CIM → 性能计数器 → 显卡工具 → LibreHardwareMonitor
- 同指标只选最直接来源
- 缺失原因区分：设备不存在 / 首次采样 / 权限拒绝 / 查询失败 / 传感器空值 / 固件未公开

---

## 四、皮肤系统

### 4.1 内置皮肤
| 皮肤 ID | 名称 | 预览 | 缩放 | 抓取点 |
|:---|:---|:---|:---|:---|
| turtle | 乌龟（默认） | ✅ | 2.5x | (0.5, 0.12) |
| cat | 小猫 | ✅ | 1.0x | (0.5, 0.09) |
| spidey | 蜘蛛侠 | ✅（新加入） | - | - |

### 4.2 皮肤选择器 (`skin-selector.js`)
- 全屏 overlay 网格展示
- 预览图 + 名称 + 描述
- 切换后自动保存
- 支持线上皮肤库加载

### 4.3 皮肤发布器（独立工具）
- `tools/skin-publisher/` 独立 Electron 入口
- 校验 → 写入内置皮肤 → 发布到线上皮肤库
- 通过 Cloudflare Wrangler 上传到 R2 + D1
- 不存储凭据在应用或仓库中

### 4.4 订阅皮肤系统
- **价格梯子**：皮肤月付 1 元 / 年付 9.8 元；创作者月付 4.2 元 / 季付 7.7 元 / 年付 24.5 元
- **服务端**：`licensemonitor.b100.top`（Cloudflare Worker + D1 + R2）
- **设备绑定**：Ed25519 授权信封
- **能力矩阵**：皮肤更新 / 创作者工具 / 自定义皮肤切换 / 保留自定义皮肤

---

## 五、AI 集成

### 5.1 Codex 接入
- **自动定位**：发现本机 `.codex` 数据目录
- **任务同步**：增量日志同步，不重复扫描
- **气泡通知**：新回复/等待/受阻显示透明气泡，可滚动翻页
- **情绪映射**：运行中 → hover，等待 → 注意，完成 → happy，受阻 → pain
- **面板联动**：硬件面板/设置/皮肤打开时收起气泡

### 5.2 Claude Code 接入
- **会话控制**：独立的 effort 滑块 + thinking 模式
- **桌面兼容**：UIA 自动化发送，支持 ProseMirror 编辑器
- **进程管理**：VS Code/Claude Code 进程发现 + 深链激活

### 5.3 发送模式
- **Direct 模式**：通过 Monitor 的 App Server 直接发送
- **Desktop 模式**：客户端兼容模式，通过 UIA 操作真实客户端

---

## 六、自定义模式（赞助版独有）

### 6.1 像素画布
- 全屏画布 (`canvas-fullscreen.html/js`)
- 区域标记 (`canvas-region.html/js`)
- PNG 导入 → 自适应网格 → undo 历史

### 6.2 表情编辑器
- 共享皮肤帧加载器
- 支持导入皮肤帧 → 直接编辑
- 表情生成器 (`expression-generator.js`)

---

## 七、构建与发布

### 7.1 构建命令
| 命令 | 用途 |
|:---|:---|
| `npm run start:free` | 开发启动 Free 版 |
| `npm run start:sponsor` | 开发启动 Sponsor 版 |
| `npm run build:free` | 源码构建 Free 版 |
| `npm run build:sponsor` | 源码构建 Sponsor 版 |
| `npm run dist:free` | 打包 Free 安装包 |
| `npm run dist:sponsor` | 打包 Sponsor 安装包 |
| `npm run dist` | 打包双版本 |
| `npm run verify` | 项目门禁验证 |
| `npm run verify:artifacts` | 安装包门禁验证 |
| `npm run skin-publisher` | 启动皮肤发布器 |
| `npm run build:sensor-host` | 重建传感器宿主 |

### 7.2 版本隔离原理
- `VITE_EDITION=free|sponsor` → `__IS_SPONSOR__` 编译常量
- Free 版 tree-shaking 移除赞助代码
- 不同 App ID / 产品名 / 可执行文件名
- `userData` 目录相互隔离

### 7.3 输出产物
```
out/
├── free/TurtleMonitor-Free-Setup.exe
├── free/win-unpacked/TurtleMonitorFree.exe
├── sponsor/TurtleMonitor-Sponsor-Setup.exe
└── sponsor/win-unpacked/TurtleMonitorSponsor.exe
```

---

## 八、架构要点

### 8.1 运行时架构
```
Electron 主进程
├── 透明窗口生命周期 + 软刷新
├── 分层传感器采样
├── 持久化配置 + 版本门控
├── 硬件传感器宿主管理/UAC 提权
└── Codex Monitor
          │
          ▼ IPC (preload)
PixiJS 渲染进程
├── 桌宠/绳子/物理/状态机
├── 监控面板/详情/布局/视觉效果
└── Codex 气泡/视图状态/联动
```

### 8.2 数据路径
- **内置只读**：ASAR 内，通过 `app.getAppPath()` 定位
- **传感器宿主**：`process.resourcesPath/hardware-sensor`
- **用户数据**：`app.getPath('userData')`
- **构建路径**：动态计算，不依赖盘符/用户名

### 8.3 关键约束
- 透明窗口必须 fail open 到鼠标穿透
- 读不到硬件数据要说明具体原因，不用 0 冒充
- Codex 只对关键未读弹气泡，手动打开的详情不被后台刷新关闭
- 路径不写死盘符/用户名/工作区

---

## 九、订阅与授权

### 9.1 订阅服务架构
```
Cloudflare Worker (licensemonitor.b100.top)
├── D1 数据库（订阅记录 + 皮肤发布）
├── R2 存储（皮肤包文件）
└── 公开目录 + 预览端点
```

### 9.2 授权状态
- 目前 `license.js` 是 RSA 预留实验代码，未启用
- 订阅功能（皮肤下载）已部署运行
- 皮肤发布器通过本地 Wrangler 认证，不存储凭据

---

## 十、项目文档索引

| 文档 | 内容 |
|:---|:---|
| `README.md` | 项目总览 |
| `BUILDING.md` | 构建与发布指南 |
| `PACKAGE_GUIDE.md` | 打包流程（NSIS） |
| `DEPLOY-SECURITY.md` | 版本边界与授权 |
| `DEVELOPER-SKIN-PUBLISHER.md` | 皮肤发布器使用 |
| `HANDOFF.md` | 项目交接文档 |
| `AGENTS.md` | 仓库工作规则 |
| `FEATURES.md` | 本文件——功能全景 |
| `.project-memory/` | 项目记忆（ADR/合同/证据） |