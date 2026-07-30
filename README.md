# Turtle Monitor

Windows 桌面系统监控宠物，使用 Electron、PixiJS 和 Vite 构建。

## 版本边界

- 免费版：完整的桌宠、系统资源面板、设置和内置皮肤切换；不包含自定义模式页面和专属 IPC。
- 赞助版：包含免费版全部功能，并增加自定义模式、像素画布、区域标记和皮肤导入/编辑。

版本由构建期变量 `VITE_EDITION=free|sponsor` 决定。发布包必须通过包内检查，不能仅凭菜单是否显示来判断版本。

## 系统监控

资源面板显示 CPU 总占用与核心信息、内存和页面文件、各固定分区容量、磁盘 I/O、各网络接口实时吞吐、GPU/显存、系统运行时间、进程/线程、温度、功耗、风扇、电压、存储健康与电池信息。采集采用 Node 原生接口、Windows CIM、本地化性能计数器、累计计数差值、显卡厂商工具和 LibreHardwareMonitor 0.9.6 的多级回退。底层宿主独立运行；单个传感器或宿主异常不会阻塞桌宠和基础占用率。

面板右上角的“监控管理”页可逐类隐藏或显示数据，设置保存在 Electron `userData` 中。概览卡片会按 CPU/内存、GPU/磁盘、网络/分区、系统/传感器的阅读顺序自动补位，并随可见行数调整面板高度；仅保留一项时居中，全部关闭时显示明确入口提示。管理页同时显示标准/管理员权限、已读取传感器数量和读取源错误，并可由用户主动请求以管理员权限重启。状态含义已经拆开：台式机电池等不存在的设备显示“本机无此设备”；标准权限受限时显示权限提示；管理员权限下仍为空才显示“硬件 / 固件未开放”。不存在物理传感器或厂商固件没有导出的值不会伪造成 `0`。

仓库已经包含可直接运行的 x64 `.NET Framework 4.7.2` 传感器宿主，因此普通使用者拉取后只需 `npm ci` 和启动命令，不需要安装 .NET SDK。维护者需要重建该宿主时运行 `npm run build:sensor-host`；固定依赖、许可证与文件哈希见 `native/HardwareSensorHost`、`third_party/LibreHardwareMonitor` 和 `resources/hardware-sensor/manifest.json`。

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
- 硬件传感器宿主：源码开发从仓库 `resources/hardware-sensor` 读取；打包后从 `process.resourcesPath/hardware-sensor` 读取，不进入 ASAR。
- 设置和用户皮肤：Electron 的 `app.getPath('userData')`。
- 构建路径：全部从脚本文件或仓库根目录动态计算，不依赖盘符、用户名或固定工作区。

## 远端与基线

维护基线为远端分支 `stable-81e7580`。仓库 URL 必须保留账号前缀：

```text
https://baner393@github.com/baner393/new_monitor.git
```
