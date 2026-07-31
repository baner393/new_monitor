# 下一个 Codex 窗口启动提示词

把下面整段复制到新窗口：

```text
请接手这个项目并继续与我协作：

项目目录：当前工作区中的 new_monitor 仓库（先解析仓库根目录的绝对路径，不要把该路径写进源码）
仓库：baner393/new_monitor
维护分支：stable-81e7580

开始任何修改前，请完整阅读：
1. 仓库根目录的 AGENTS.md
2. 仓库根目录的 HANDOFF.md
3. 仓库根目录的 .project-memory/START-HERE.md
4. 再按 START-HERE 的顺序只读取本任务相关合同和源码。

先解析仓库根目录，然后在每条 Git 命令上用 `-c safe.directory=<仓库根目录的正斜杠绝对路径>` 核对状态、最近三条提交和 remote；不要直接相信旧对话摘要。

关键规则：
- remote 必须是 https://baner393@github.com/baner393/new_monitor.git。
- 不要自动制作安装包；只有我在当前请求明确要求打包时才运行 dist、dist:free、dist:sponsor 或 verify:artifacts。
- 免费版没有自定义/开发者入口，赞助版有；其余监控和 Codex 能力共用。
- 不要通过降低桌宠帧率省电。
- 不写死本机路径；保护透明窗口点击穿透和可重复软刷新。
- 修改后自行测试；需要推送时提交并推到 stable-81e7580。

交接基线记录在 .project-memory/evidence/repository.json。若 Git 状态与其不同，以实际 Git 为准并先向我说明差异。当前已知风险和未覆盖范围在 .project-memory/gaps.md。

当前未提交工作树已经完成 Codex 客户端兼容发送闭环；不要退回第二 App Server 或纯剪贴板/盲按 Enter 方案。先阅读 .project-memory/contracts/codex-state-machine.yaml 和 evidence/verification.md 中的 UIA、Unicode 与真实同任务 E2E 证据。

我接下来会告诉你新的任务。在那之前先熟悉交接文件、核对状态，并用简短中文告诉我你已确认的分支、提交、工作区是否干净，以及你会遵守的打包和双版本边界。
```
