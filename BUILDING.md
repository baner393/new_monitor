# 构建与发布

## 环境

- Windows 10/11 x64
- Node.js 22+
- 首次安装：`npm ci`

仓库已提交运行所需的 `resources/hardware-sensor`，普通开发和启动不依赖本机 .NET SDK。只有更新传感器宿主源码或 LibreHardwareMonitor 版本时才需要 .NET SDK，并执行：

```powershell
npm run build:sensor-host
npm run verify
```

该命令固定构建 x64 `.NET Framework 4.7.2` 宿主，更新许可证副本和 SHA-256 清单。不要手工替换其中某个 DLL，否则项目门禁和安装包门禁会因清单不一致而失败。

依赖版本和完整依赖树由 `package.json` 与 `package-lock.json` 固定。不要手工复制 `node_modules`。

## 开发启动

开发者皮肤发布器是独立工具，不会进入主应用安装包。其他开发电脑的配置、启动、发布和排错步骤见 [`DEVELOPER-SKIN-PUBLISHER.md`](DEVELOPER-SKIN-PUBLISHER.md)。

```powershell
npm run start:free
npm run start:sponsor
```

Forge 只负责开发启动。正式发布统一由 Electron Builder 负责，避免 Forge/Squirrel 与 Builder/NSIS 产生两套不一致的资源规则。

只验证源码构建、不生成安装包时使用：

```powershell
npm run build:free
npm run build:sponsor
```

## 发布命令

```powershell
npm run verify
npm run dist
```

单独打包：

```powershell
npm run dist:free
npm run dist:sponsor
npm run verify:artifacts
```

输出：

```text
out/free/TurtleMonitor-Free-Setup.exe
out/free/win-unpacked/TurtleMonitorFree.exe
out/sponsor/TurtleMonitor-Sponsor-Setup.exe
out/sponsor/win-unpacked/TurtleMonitorSponsor.exe
```

免费版沿用 `com.turtlemonitor.app`；赞助版使用独立的 `com.turtlemonitor.sponsor`、产品名和可执行文件名，允许两个版本并存。两者的 Electron `userData` 目录也相互隔离。

## 发布检查单

1. `git status` 中没有意外生成文件。
2. `npm ci` 成功，`npm run verify` 通过。
3. `npm run dist` 退出码为 0；任何子进程失败都会终止，不再吞掉错误。
4. `npm run verify:artifacts` 通过。
5. `verify:artifacts` 同时确认传感器宿主位于 ASAR 外部、所有 DLL/许可证与清单哈希一致；缺文件或被替换会直接失败。
6. 分别启动两个 `win-unpacked` EXE，检查桌宠、八类系统卡片、卡片明细分页、四种布局预设、拖动/显隐/取消/直接关闭保存、传感器温区、权限状态、减少动态效果、设置、皮肤和图标；赞助版额外检查自定义模式，免费版确认没有该入口。
7. 对最终安装包计算并保存 SHA-256；正式发行时再做 Windows 代码签名。

运行时审计可使用：

```powershell
npm audit --omit=dev --registry=https://registry.npmjs.org
```

Forge 与 Electron Builder 的开发期依赖可能仍报告上游传递漏洞；不要直接执行会降级构建工具的 `npm audit fix --force`。应先升级到上游修复版本，再完整重跑双包门禁。

## 路径约定

源码和构建脚本只允许使用相对仓库根目录的路径、`import.meta.url`/`__dirname`、`app.getAppPath()` 与 `app.getPath(...)`。不得提交开发者机器的盘符或用户目录。
