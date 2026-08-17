# Proposal: 老板键 + Token 计数器

Status: Proposed 2026-08-15. Not scheduled for current iteration.

## 背景
- 市场调研(`.hermes/market_research.md`)建议这两项功能,但当前代码均**不存在**(grep bossKey/panic/token usage 无结果)。
- 本期(宣传视频)不实现,记入下期。

## 功能 1:老板键(一键隐藏)
- 触发:全局快捷键(如 Ctrl+Shift+H)瞬间隐藏桌宠窗口及所有面板/气泡。
- 再按恢复。
- 调研依据:B站"摸鱼神器"相关视频 712 万播放,"上班摸鱼"场景有巨大流量;一键隐藏本身可成为传播爆点。
- 实现要点:main 进程 globalShortcut 注册;隐藏时停所有 watcher/粒子;恢复时无损还原。

## 功能 2:Token 计数器
- 显示:"今天帮你点了 N 次确认 / 替你接管 M 次审批"。
- 调研依据:agentpet 的 Token 仪表盘受欢迎;codeburn(9.4k stars)验证 token 追踪需求;类似 Duolingo 连续天数,用户会截图分享。
- 实现要点:在 claude-monitor.js/codex-monitor.js 的 accept/decline/respond 路径累计计数;持久化到 userData;渲染端小气泡/角标展示。

## 决策记录
- "不加白名单自动放行":Claude Code 等 harness 本身已有完整三级权限,叠加白名单会语义打架。**已否决**。
- "不加负载→表情映射":表情保持 AI 任务状态单一信源,混入负载会让用户分不清表情含义。**已否决**。
- 老板键 + Token 计数器:与上述两项不同,是**新增**功能(非改动现有权限/表情语义),下期实现。

## 不在本期范围
本期(2026-08)只做 60s 宣传视频。SOP 见 `partitioned-zooming-hippo.md`(本地 Downloads 同名文件)。
