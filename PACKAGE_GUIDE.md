# Turtle Monitor 打包流程（electron-builder + NSIS）

## 项目路径
- Windows: 项目根目录（如 `%USERPROFILE%\new_monitor\`）

## 重要前提
- **必须在 Windows 下打包**（WSL 下 electron-builder 的 NSIS 工具链不可用）
- 直接在 Windows 终端/PowerShell/IDE 里运行

## 环境要求（Windows 侧）
- Node.js ≥ 18
- npm
- 项目已执行过 `npm install`

## 关键文件
| 文件 | 作用 |
|:----|:----|
| `scripts/build.mjs` | Vite 三阶段构建（main + preload + renderer）+ 字体/自定义模式复制 |
| `electron-builder.config.js` | electron-builder 配置（NSIS 安装器） |
| `forge.config.js` | ❌ 已废弃（仅留旧脚本做参照） |

## 可用命令

| 命令 | 版本 | 产出 |
|:----|:----|:----|
| `npm run build:free` | 🆓 | 仅 Vite 构建（`.vite/` 目录），不打包 |
| `npm run build:sponsor` | 💎 | 同上，含自定义模式 |
| `npm run dist:free` | 🆓 | ✅ `out\TurtleMonitor_free_Setup.exe`（NSIS 安装器） |
| `npm run dist:sponsor` | 💎 | ✅ `out\TurtleMonitor_sponsor_Setup.exe` |
| `npm run make:free` | 🆓 | ❌ 旧 Squirrel 安装器，已废弃 |
| `npm run make:sponsor` | 💎 | ❌ 同上 |

## 输出产物
```
out/
├── TurtleMonitor_free_Setup.exe           ← 🆓 NSIS 安装包
├── TurtleMonitor_free_Setup.exe.blockmap  ← 增量更新映射
├── TurtleMonitor_sponsor_Setup.exe        ← 💎 NSIS 安装包
├── TurtleMonitor_sponsor_Setup.exe.blockmap
└── win-unpacked/                          ← 绿色版（中间产物）
```

## 架构原理（双版本隔离）
```
electron-builder.config.js 读取 process.env.VITE_EDITION
  → files 条件选择：Free 排除 src/，Sponsor 保留 src/custom/**
  → artifactName: 'TurtleMonitor_{edition}_Setup.${ext}'
  → build.mjs 传递 __IS_SPONSOR__ 到 Vite 编译常量
  → 主进程 if (__IS_SPONSOR__) { ... } 条件编译
  → Free 版：tree-shaking 移除赞助代码
  → Sponsor 版：包含自定义模式代码 + src/custom/ 目录
```

## 关键依赖
- `cross-env` — 传递 `VITE_EDITION` 环境变量（Windows cmd 不支持 `KEY=val` 语法）
- `electron-builder` — NSIS 安装器构建
- `vite` — 主进程/预加载/渲染进程三阶段构建

---

## ⚠️ 已知坑 —— 必读

### ⚠️ cross-env 只对单个命令生效
```json
// ❌ 错误: electron-builder 拿不到 VITE_EDITION，产出一律叫 free_Setup
"dist:sponsor": "cross-env VITE_EDITION=sponsor node scripts/build.mjs && electron-builder build ..."

// ✅ 正确: 两个命令各包一次
"dist:sponsor": "cross-env VITE_EDITION=sponsor node scripts/build.mjs && cross-env VITE_EDITION=sponsor electron-builder build ..."
```

### ⚠️ 代码签名禁用
Windows 上 electron-builder 默认尝试代码签名，但项目无签名证书时会下载 `winCodeSign` 工具链并因无法解压 macOS 符号链接而报错。**必须在配置中禁用签名**：
```javascript
win: {
  sign: false,
  signAndEditExecutable: false,
  certificateFile: null,
}
```

### ⚠️ 锁定文件：不能删，只能重命名
electron-builder 前一次失败留下的 `out/win-unpacked/` 可能被 Explorer/antivirus 锁定，`rmdir`/`Remove-Item` 都删不掉。解法：
```cmd
rename out\win-unpacked win-unpacked-old
```
重命名后创建新目录，上次的旧目录待重启后自动释放。

### ⚠️ NSIS 配置属性名
- `allowToDir` 不存在 → 正确名 `allowToChangeInstallationDirectory`
- `oneClick: false` + `allowToChangeInstallationDirectory: true` = 弹出"选择安装目录"对话框

### ⚠️ 构建缓存
- Vite 构建有缓存，重复构建时 main/preload 几秒完成
- electron-builder 会缓存 electron 二进制和 NSIS 工具链（首次下载约 120MB）
- 如果修改了 Vite 构建配置，需清理 `.vite/` 目录再构建

---

## 🚨 必须一步到位：永远不要分开跑构建命令

**这是最重要的规则。** 分开跑每次都会产生回归（之前修好的东西又坏了），因为：

| 分开跑的问题 | 后果 |
|:---|:---|
| `build:sponsor` 只跑 Vite 编译 → 忘记跑 electron-builder | 安装包用的是旧 Vite 缓存，修复代码不存在 |
| 环境变量 `VITE_EDITION` 丢失 | 产出一律叫 `free_Setup`；`__IS_SPONSOR__` 为 false → 自定义模式代码被 tree-shake 掉 |
| rcedit 图标修复被跳过 | 装好后图标还是默认 Electron 花朵 |
| 旧的 `out/win-unpacked/` 残留 | electron-builder 可能复用旧 ASAR 而不是重新打包 |

**根本原因**：`npm run dist:sponsor` 是一个 **package.json 脚本链**（`build.mjs && electron-builder && set-icon-helper.js`），三件事在同一命令行进程中执行。分开跑意味着你手动拼凑这三步，环境变量和中间产物状态都无法保证一致。

```bash
# ✅ 必须：一步到位
npm run dist:sponsor

# ❌ 禁止：分开跑
npm run build:sponsor            # 只编译，没打包
npx electron-builder build ...   # VITE_EDITION 可能没传，rcedit 没跑
```

---

## 皮肤路径策略：只改写不改读（🚨 核心原则）

### 原则
1. **ASAR 路径永远只读**：`app.getAppPath()` 下的任何文件都不能写入（打包后是只读的）
2. **写操作必须走 userData**：所有文件写入（自定义皮肤 PNG、skins.json）都用 `app.getPath('userData')/skins/`
3. **读操作不动**：主窗口的皮肤选择器照常从 ASAR 加载——这保证内置皮肤始终正常
4. **自定义模式用 IPC 读 userData**：先试 userData，失败回退 ASAR

### 为什么不能统一走 userData？
试图让**读也走 userData**（通过 IPC 返回 `file://` 绝对路径）会引发 PixiJS 纹理在 Electron 渲染进程中加载失败——皮肤闪一下消失，只剩绳子。`file://` 路径在 Electron 中存在 CORS/安全限制。

---

## 验证方式

### 1. 基本验证
- 双击安装包 → 应弹出"选择安装目录"对话框
- 安装后启动 → 任务管理器确认 `Turtle Monitor.exe` 存在
- 修改设置/切换皮肤 → 关闭重启 → 确认设置未丢失

### 2. 版本差异检查
- Free 版 → 无 `src/custom/` 目录
- Sponsor 版 → 有 `src/custom/` 目录

### 3. 图标检查
`out/win-unpacked/Turtle Monitor.exe` 右键属性 → 乌龟图标

### 4. ⭐ 代码验证：提取 ASAR 确认修复已包含
```bash
# 解包 ASAR
cd out/win-unpacked/resources
npx asar extract app.asar app

# 检查关键修复代码是否存在
grep "userData.*skins\|SKINS_USER_PATH\|ensureWritableSkins" app/.vite/build/index.js

# 检查无残留的 app.getAppPath() 路径用于写入
grep -n "getAppPath.*\.vite.*renderer.*skins" app/.vite/build/index.js
# ✅ 应该出现 SKINS_APP_PATH（只读源路径）
# ❌ 不应该出现 SKINS_BASE_PATH = app.getAppPath()（写入路径）

# 清理
rm -rf app
```