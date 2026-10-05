# Turtle Monitor 项目交接

这份文档用于把当前项目完整交给下一个 Codex 窗口。机器可读事实、配置结构和状态机位于 [`.project-memory/START-HERE.md`](.project-memory/START-HERE.md)。

## 当前交接点

当前维护分支 `refactor/charm-v2` 已同步到提交 `0df83a0122aa1b539e45c68602bf8c12c0fd609d`。该提交加入 Codex 设置页 CDP 准备入口；版本号 `1.0.2`、项目校验脚本修正及 `.project-memory/` 资料仍保留在本地工作区，没有纳入该提交。Codex 客户端回复通道通过本地 CDP 连接，不回退到 Monitor App Server；设置页按钮确认后会调用现有脚本，提醒可能关闭其他 ChatGPT 窗口，准备成功后切换到 Codex 客户端后台回复通道。权威仓库状态见 [`.project-memory/evidence/repository.json`](.project-memory/evidence/repository.json)。

版本 `1.0.1` 的免费版和赞助版安装包已生成到 `out/`，`npm run verify:artifacts` 通过；包内版本号及 edition 标记均已核对。免费版 `out/free/TurtleMonitor-Free-Setup.exe`（103,615,789 字节，SHA-256 `5879E24BB45B34741DFC46751B8943097EFE94849690724B455F49804B1D15D3`）；赞助版 `out/sponsor/TurtleMonitor-Sponsor-Setup.exe`（103,657,456 字节，SHA-256 `102E2DF3F3ED9F98CF050EB389DC4F29CCFBF79C9EB60CCAD58D2064A7A2D52B`）。由于工作区根目录含 Electron Builder 无法读取的失效乱码目录项，最终构建在隔离的干净源码副本中完成，再复制回 `out/`；根目录直接打包仍会在该目录项处报 `ENOENT`。`npm test` 的 435/435 和此前源码构建结果来自提交 `6e63f3b`，本轮未重跑测试。字体运行时解析与 renderer chunk 大小警告仍存在。真实 Codex 消息发送、及时回执、最小化提交及系统前台不变尚未实机验收；也尚未实装运行新安装器，不能宣称桌面闭环或安装 smoke test 已通过。验证记录见 [`.project-memory/evidence/verification.md`](.project-memory/evidence/verification.md)。

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
- Codex Desktop 回复通道遵循最新用户设计约束：[项目交接 §7.24](.project-memory/handoff-2026-09-19.md)。客户端兼容推送要继续由 Codex 客户端发送，同时避免每条消息时打开/抢前台，并避免改走 App Server。Codex 连接设置页有“重启 Codex 并启用连接”按钮；它会结束所有名为 `ChatGPT` 的客户端进程（可能包括其他 ChatGPT 窗口），需先保存工作并明确确认。准备成功后会自动选择 Codex 客户端后台回复通道。静默客户端路径不可用时，保留草稿并明确报错，不要切换通道。
- Codex 桌面普通“发送”需在目标任务的本地会话记录中确认请求时间之后出现完全相同的用户消息才报告成功；排队操作需由客户端页面确认消息已进入目标对话。二者都不代表已收到回复；真实闭环证据见 [`.project-memory/evidence/verification.md`](.project-memory/evidence/verification.md)。
- 打包历史上容易丢图标、字体、皮肤和硬件读取器。源码构建通过不等于安装包通过。
- `README.md` 和 `BUILDING.md` 在某些 PowerShell 默认编码下会显示乱码；读取时显式使用 UTF-8，不要据此误改原文件。

## 推荐工作节奏

先查看 `git diff` 和受影响测试；先修复根因并增加回归测试，再做源码启动验证。UI 修改需要同时检查透明气泡层、宠物交互层和鼠标穿透。数据修改需要同时检查采集源、归一化、缺失原因、卡片摘要和详情页原始数据。

若需要继续完善本交接包，按 `project-memory` 的 update 流程，只更新语义变化涉及的合同、证据和变更记录，最后执行 snapshot/check。
