# Turtle Monitor

Windows 桌面系统监控宠物，使用 Electron、PixiJS 和 Vite 构建。

## 版本边界

- 免费版：完整的桌宠、系统资源面板、设置和内置皮肤切换；不包含自定义模式页面和专属 IPC。
- 赞助版：包含免费版全部功能，并增加自定义模式、像素画布、区域标记和皮肤导入/编辑。

版本由构建期变量 `VITE_EDITION=free|sponsor` 决定。发布包必须通过包内检查，不能仅凭菜单是否显示来判断版本。

## 系统监控

资源面板使用 CPU、内存、GPU、存储、网络、散热、功耗和电池八类固定模板。存储占满一行，其余卡片使用半宽模板；不存在的 GPU、电池或风扇不会占用概览位置，但会在管理器中保留“未检测”状态。系统、主板、运行时间和进程信息位于标题区的系统明细页。点击任一卡片可进入整理摘要与分页原始传感器清单。

内存、页面文件、显存、磁盘总量、每个分区和电池均使用容量条。资源条在 75% 后连续转暖、90% 后进入深红告警；电池按“剩余量”反向告警。CPU、GPU 与存储温度使用连续冷蓝—青绿—暖黄—红色状态轨，并支持逐设备覆盖阈值。网络、磁盘和风扇只在局部轨道或图标内显示像素生态动效，速度由约五分钟运行期基线自动分为静止、低、中、高、爆发五档；升档立即生效、降档带迟滞，隐藏面板和 Windows 减少动态效果模式不会持续播放动画。

“监控管理”分为布局、传感器和权限三页。布局提供极简、性能、硬件、全量四种预设以及拖动排序、显隐和实时概览草稿；手工调整后标记为自定义。应用会持久化，取消会恢复进入管理器前的完整快照，直接返回概览、收起、刷新、正常退出或请求管理员重启前会提交当前草稿。传感器页管理明细类别、速度动效和逐设备温区；权限页显示读取数量、硬件节点、读取错误和权限提升入口。

配置以版本化 `MonitorPanelConfigV2` 保存在 Electron `userData` 中，并区分“期望显示”与“当前可显示”：设备暂时缺失时不会丢失用户设置，之后重新检测到会按原顺序自动出现。旧版 `monitorVisibility` 会在首次读取时自动迁移，旧接口仍保留兼容包装。免费版与赞助版共用同一套监控、管理和动效逻辑。

采集采用 Node 原生接口、Windows CIM、本地化性能计数器、累计计数差值、显卡厂商工具和 LibreHardwareMonitor 0.9.6 的多级回退。底层宿主独立运行；整理字段缺失时，概览会从完整原始传感器清单补齐可识别的温度、负载和功耗。单个传感器或宿主异常不会阻塞桌宠和基础占用率，也不会把不存在或未开放的值伪造成 `0`。

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

`build:free` 和 `build:sponsor` 只做对应版本的源码构建校验，不生成安装包。只有显式执行 `npm run dist` 才会依次清理、打包免费版和赞助版，并检查 ASAR 内的版本标记、赞助功能边界、字体、皮肤、精灵和安装包。产物分别写入 `out/free` 与 `out/sponsor`，不会互相覆盖。

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
