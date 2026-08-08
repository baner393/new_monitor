# Turtle Monitor 项目交接

这份文档用于把当前项目完整交给下一个 Codex 窗口。机器可读事实、配置结构和状态机位于 [`.project-memory/START-HERE.md`](.project-memory/START-HERE.md)。

## 当前交接点

当前维护分支和远端基线已经同步，但交接文档与最新 Codex 修复仍在未提交工作区；权威提交、远端地址与工作区状态见 [`.project-memory/evidence/repository.json`](.project-memory/evidence/repository.json)。最新工作树完成了完整消息展示、默认折叠工具流量，以及只在客户端兼容模式统一到 Codex 客户端任务的发送闭环。

验证结果见 [`.project-memory/evidence/verification.md`](.project-memory/evidence/verification.md)。本轮没有制作安装包，也不要把旧 `out/` 产物当成当前提交的交付物。

## 下一窗口先做什么

1. 阅读仓库根目录 `AGENTS.md` 和 [`.project-memory/START-HERE.md`](.project-memory/START-HERE.md)。
2. 用带 `safe.directory` 的 Git 命令核对分支、提交、远端和工作区；不要假定窗口摘要仍然最新。
3. 先理解用户的新要求，再只打开架构图中相关文件；不要重新扫描或重写整个项目。
4. 修改后运行相关单元测试，再运行 `npm test`、`npm run verify`，必要时验证两个源码版本。
5. 只有用户在当前请求里明确要求打包时，才执行 `dist*` 或安装包验证。
6. 用户要求推送时，提交到维护分支并推送；remote 必须保留 `baner393@` 用户名前缀。

## 不可丢失的产品约束

- 免费版和赞助版是两个正式版本；赞助版才有自定义/开发者入口。完整矩阵见 [`.project-memory/contracts/editions.json`](.project-memory/contracts/editions.json)。
- 两个版本共用硬件监控、管理器、动效和 Codex 接入逻辑。
- 开发者皮肤发布器已拆为独立工具；不要从主应用右键菜单寻找它。Agent 应先阅读 [`DEVELOPER-SKIN-PUBLISHER.md`](DEVELOPER-SKIN-PUBLISHER.md)。
- 桌宠渲染帧率不能为了省电而降低；后台数据读取可以分级、缓存和降频。
- 所有路径必须跨电脑工作，不写死盘符、用户名或当前工作区。
- 刷新必须同时完成数据刷新和界面状态整理，并保持点击穿透安全；相关决策见 `ADR-0002`。
- 硬件数据能读到就正确归类并完整保留；读不到要说明具体原因，不用笼统占位，也不用 `0` 冒充缺失。
- Codex 只对关键未读主动弹气泡；手动打开的详情不能被后台刷新关掉；任务运行数与未读数分开。
- 未读角标只负责提醒，不是会话入口。左键配置中的“任务与会话”列表必须允许零未读任务通过左侧任务按钮进入现有详情；右侧连接/断开或“打开 Codex”按钮保持独立，不能用整行点击切换连接。
- 交互控件的鼠标按下和抬起都要隔离，不能误触宠物左键配置页。

## 重点风险区

- 透明全屏窗口、点击穿透和刷新生命周期高度耦合。改动 `main.js`、`input.js`、`window-lifecycle.js` 后必须做多次刷新回归。
- 管理员硬件读取依赖 UAC、子进程、命名管道和超时。不要把整个 Electron 应用永久提升；只提升硬件读取器。
- Codex 接入同时处理本地 JSONL 和 App Server。避免每轮重扫日志、伪造审批编号或接管外部仍在运行的任务。
- 只有 `direct` 回复通道使用 Monitor 的 App Server。`desktop` 客户端兼容模式严禁启动第二 App Server；它打开精确任务，识别 `ChatGPT.exe`/`Codex.exe`，优先深链激活的前台进程，从窗口树主动查找并聚焦 ProseMirror 编辑框，以 UTF-8 Base64 传文并用 UIA 精确写入/回读，再 Invoke 发送按钮。仅在按钮不可调用时按顺序尝试 Enter 与 Ctrl+Enter，且必须检查未清空才重试。不得加入屏幕坐标、固定 PID/路径、窗口尺寸、DPI 或本地化标题假设。失败必须保留草稿并显示错误。
- 客户端兼容模式只有在目标任务的本地会话日志出现发送时间之后的完全相同用户消息时才报告成功；真实闭环证据见 [`.project-memory/evidence/verification.md`](.project-memory/evidence/verification.md)。
- 打包历史上容易丢图标、字体、皮肤和硬件读取器。源码构建通过不等于安装包通过。
- `README.md` 和 `BUILDING.md` 在某些 PowerShell 默认编码下会显示乱码；读取时显式使用 UTF-8，不要据此误改原文件。

## 推荐工作节奏

先查看 `git diff` 和受影响测试；先修复根因并增加回归测试，再做源码启动验证。UI 修改需要同时检查透明气泡层、宠物交互层和鼠标穿透。数据修改需要同时检查采集源、归一化、缺失原因、卡片摘要和详情页原始数据。

若需要继续完善本交接包，按 `project-memory` 的 update 流程，只更新语义变化涉及的合同、证据和变更记录，最后执行 snapshot/check。
