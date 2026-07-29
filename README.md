# Turtle Monitor

Windows 桌面系统监控宠物，使用 Electron、PixiJS 和 Vite 构建。

## 版本边界

- 免费版：完整的桌宠、系统资源面板、设置和内置皮肤切换；不包含自定义模式页面和专属 IPC。
- 赞助版：包含免费版全部功能，并增加自定义模式、像素画布、区域标记和皮肤导入/编辑。

版本由构建期变量 `VITE_EDITION=free|sponsor` 决定。发布包必须通过包内检查，不能仅凭菜单是否显示来判断版本。

## 系统监控

资源面板显示 CPU 总占用与核心信息、内存和页面文件、各固定分区容量、磁盘 I/O、各网络接口实时吞吐、GPU/显存、系统运行时间、进程/线程、热区与电池信息。采集采用 Node 原生接口、Windows CIM、性能计数器、累计计数差值和显卡厂商工具的多级回退；硬件或驱动未公开的传感器会显示“硬件未提供”，不会伪装成 `0`。

## 本地开发

要求 Node.js 22 或更高版本。

```powershell
npm ci
npm run start:free
npm run start:sponsor
```

`run.bat` 是免费版的便携启动入口，它会先切换到脚本所在目录，因此项目放在任意磁盘和目录都能运行。

## 构建

```powershell
npm run verify
npm run build:free
npm run build:sponsor
npm run dist
```

`npm run dist` 会依次清理、打包免费版和赞助版，并检查 ASAR 内的版本标记、赞助功能边界、字体、皮肤、精灵和安装包。产物分别写入 `out/free` 与 `out/sponsor`，不会互相覆盖。

详细说明见 [BUILDING.md](BUILDING.md)。授权代码目前只是未接入运行流程的预留模块，实际状态见 [DEPLOY-SECURITY.md](DEPLOY-SECURITY.md)。

## 数据路径

- 内置只读资源：随 ASAR 发布，通过 `app.getAppPath()` 定位。
- 设置和用户皮肤：Electron 的 `app.getPath('userData')`。
- 构建路径：全部从脚本文件或仓库根目录动态计算，不依赖盘符、用户名或固定工作区。

## 远端与基线

维护基线为远端分支 `stable-81e7580`。仓库 URL 必须保留账号前缀：

```text
https://baner393@github.com/baner393/new_monitor.git
```
