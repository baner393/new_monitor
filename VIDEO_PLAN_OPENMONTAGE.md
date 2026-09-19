# Turtle Monitor 宣传视频 — OpenMontage Agent 执行计划

> 最后更新: 2026-08-18
> 定位: 基于 OpenMontage screen-demo 管线的 Agent 执行方案
> 前置条件: OpenMontage 已克隆到 `D:/all/OpenMontage`，依赖已安装

---

## 一、核心信息

### 1.1 视频概要

| 项目 | 内容 |
|:---|:---|
| 产品 | Turtle Monitor — Windows 桌面系统监控宠物 |
| 视频性质 | **预告片**（无下载链接，结尾"敬请期待"） |
| 核心受众 | 开发者 × ACG 用户交集 |
| 核心卖点 | ① Agent 绳子交互 ② 快速 Agent 使用 ③ 绳子物理 ④ 自定义皮肤 ⑤ 硬件监控 |
| 视频情绪 | 兴奋/展示感 |
| 输出平台 | B 站 3 分钟主片 + 抖音 30-40 秒精剪版 |

### 1.2 路径约定

| 项目 | 路径 |
|:---|:---|
| OpenMontage 根目录 | `D:/all/OpenMontage` |
| 素材来源 | `D:/all/video_material/new_monitor/` |
| Remotion 项目 | `D:/all/OpenMontage/remotion-composer` |
| 最终输出 | `D:/all/video_material/finished/` |
| 本计划文件 | `D:/all/lightframe/new_monitor/VIDEO_PLAN_OPENMONTAGE.md` |

### 1.3 启动方式

```bash
# Remotion Studio（可视化工作台）
bash --noprofile --norc -c 'cd /d/all/OpenMontage/remotion-composer && node node_modules/@remotion/cli/remotion-cli.js studio'

# 启动器（双击）
D:/all/remotion-studio.bat
D:/all/openmontage.bat
```

### 1.4 工作流程（人与 Agent 协作）

```
Agent 编辑 Remotion React 组件/素材
        ↓
Agent 启动 Remotion Studio（bash --noprofile --norc）
        ↓
浏览器自动打开 http://localhost:3000
        ↓
用户预览视频 → 在时间线上拖拽查看每一帧
        ↓
用户反馈修改意见 → Agent 调整代码 → Studio 热重载 → 实时预览
        ↓
循环直到满意 → Agent 渲染最终输出
```

**关键：** Agent 每次修改代码后，Studio 会自动热重载，用户无需重启。用户直接在浏览器中拖拽时间线审核每一帧，Agent 在后台改代码。

---

## 二、OpenMontage 工作方式

### 2.1 核心原则

OpenMontage 是 **Agent 指令驱动** 的视频制作系统。Agent 是智能体，负责：

```
读取管线定义 (YAML) → 读取 stage director skill (MD)
→ 调用 Python 工具 (tools/) → 自审 (meta/reviewer)
→ 检查点 (checkpoint) → 提交给用户确认
```

**关键规则：** 每一步必须先读 skill，再操作。不读 skill 直接调用工具是违规行为。

### 2.2 screen-demo 管线

选择 **`real_capture`** 模式（已有录屏素材），渲染引擎用 **Remotion**。

---

## 三、分镜脚本（修订版 — 2026-08-18）

> **修订说明：** 删除了原版"无意义等待画面"，用自定义画图功能替换，同时压缩了冗余时长。

| 段 | 时间 | 画面 | 解说 | 动效要求 |
|:---|:---|:---|:---|:---|
| 开场钩子 | 0:00-0:07 | 功能快节奏蒙太奇（Agent→审批→皮肤→绳子→自定义画图→监控→乌龟 happy） | 纯 BGM 卡点 | **Remotion 动画序列**：每个镜头 1 秒，带缩放/旋转/模糊入场过渡 |
| 日常守护 | 0:07-0:18 | 用户在看视频，乌龟 idle 摇摆 | "你的桌面上，有只小乌龟在默默守护" | 字幕带打字机动画 + 乌龟呼吸光晕 |
| Agent 打断 | 0:18-0:30 | 乌龟弹出提示，绳子脉冲，气泡展开 | "Agent 任务完成了——" | **绳子脉冲 GSAP 动画** + 气泡弹性展开 + 区域放大转场 |
| 审批操作 | 0:30-0:50 | 一键审批完整流程 | "点一下，放行" | 鼠标点击处加**涟漪扩散特效** + 按钮高亮脉冲 |
| 问答操作 | 0:50-1:10 | 打字提问秒回 | "问一句，搞定" | 打字机逐字动画 + 回复内容**渐显+滑动** |
| 绳子交互 | 1:10-1:30 | 拖拽、甩动、滑轮（12 秒，原 25 秒压缩） | "当然，工作之余还能玩一玩" | 绳子物理轨迹**粒子拖尾** + 慢动作回放 |
| 皮肤切换 | 1:30-1:42 | 皮肤快速切换（乌龟→猫→蜘蛛侠） | "换个皮肤，换个心情" | 卡片式**3D 翻转**切换 + 切换瞬间粒子散开 |
| **自定义画图** | **1:42-1:57** | **像素画布编辑 → 导入 PNG → 绘制 → 保存 → 应用生效** | "还能自己画" | **画布绘制过程加速回放** + 笔触发光轨迹 + 保存时"叮"音效 |
| 硬件监控 | 1:57-2:10 | 8 类传感器面板滚动展示 | "还能监控你的硬件" | 数据条**数值跳动动画** + 温度条渐变动画 |
| 赞助版 | 2:10-2:25 | 自定义模式、像素画布、表情编辑 | "赞助版还有更多玩法" | 功能卡片**逐个飞入** + 排列 |
| 收尾 | 2:25-2:40 | 乌龟 happy + "Coming Soon" | BGM 淡出 | 标题**发光渐显** + 乌龟呼吸放大动画 |

**重要节奏规则：**
- 每个场景**不超过 15 秒**（原 25 秒的画面压缩）
- 相邻场景之间的过渡/等待画面**保留但不允许超过 2 秒**（压缩等待时间，不是删除）
- 场景内部的停顿/加载/等待画面**压缩到原始时长的 30-50%**，保留节奏感但不拖沓
- 每个场景至少有 1 个**动效事件**（文字动画/转场特效/粒子效果）
- 自定义画图必须在视频中**完整展示**：从打开画布到应用生效

---

## 四、关键环境须知（Agent 必读）

### 4.1 Shell 兼容性

本环境使用 Git Bash，shell profile 中包含 `fnm` 引用但未安装。**所有命令必须通过以下方式执行：**

```bash
# ✅ 正确：使用干净 shell
bash --noprofile --norc -c '你的命令'

# ❌ 错误：直接运行（会报 fnm: command not found）
npx remotion studio
```

### 4.2 Python 路径

Python 3.12 安装在 `C:/Program Files\Python312\`，**不在系统 PATH 中**。所有 Python 命令必须使用完整路径：

```bash
# ✅ 正确
/C/Program\ Files/Python312/python.exe -c "print('hello')"

# ❌ 错误（找不到 python）
python -c "print('hello')"
```

### 4.3 Node.js / npm 路径

Node.js 在 PATH 中，`bash --noprofile --norc` 下也可用：

```bash
# ✅ 正确
bash --noprofile --norc -c 'node --version'
bash --noprofile --norc -c 'cd /d/all/OpenMontage/remotion-composer && node node_modules/@remotion/cli/remotion-cli.js studio'
```

### 4.4 工作流程

```
Agent 编辑 Remotion React 组件/素材
        ↓
Agent 启动 Remotion Studio（bash --noprofile --norc）
        ↓
浏览器自动打开 http://localhost:3000
        ↓
用户预览视频 → 在时间线上拖拽查看每一帧
        ↓
用户反馈修改意见 → Agent 调整代码 → Studio 热重载 → 实时预览
        ↓
循环直到满意 → Agent 渲染最终输出
```

---

## 五、执行流水线

### 阶段 0：Pre-flight（前置检查）

**先读 Skill:** `AGENT_GUIDE.md` → Rule Zero

```bash
# 1. 确认 OpenMontage 就绪
bash --noprofile --norc -c '/c/Program\ Files/Python312/python.exe --version'

# 2. 确认 Remotion 可用
bash --noprofile --norc -c 'cd /d/all/OpenMontage/remotion-composer && node -e "console.log(require(\"@remotion/cli/package.json\").version)"'

# 3. 确认素材存在
ls -la "D:/all/video_material/new_monitor/"

# 4. 确认输出目录可写
mkdir -p "D:/all/video_material/finished"

# 5. 运行工具注册表发现可用工具
bash --noprofile --norc -c '/c/Program\ Files/Python312/python.exe -c "from tools.tool_registry import ToolRegistry; r=ToolRegistry(); r.discover(); avail=r.get_available(); print(f\"可用工具: {len(avail)} 个\")"'
```

**验证门禁：** 所有检查通过。不通过则中止报告。

---

### 阶段 1：Idea（创意阶段）

**先读 Skill:**
1. `skills/pipelines/screen-demo/idea-director.md`（完整阅读）
2. `skills/meta/creative-intake.md`（创意输入）
3. `pipeline_defs/screen-demo.yaml` 的 idea 阶段定义

**产出：** `brief`（创意简报）+ `decision_log`（决策日志）

**操作步骤：**

```bash
# 1. 检查素材
bash --noprofile --norc -c 'cd /d/all/OpenMontage && python -c "
from tools.analysis.frame_sampler import FrameSampler
# 采样素材关键帧，理解内容
"'

# 2. 确定生产模式
# 选择: real_capture（已有录屏素材）
# 渲染引擎: remotion（需要叠加字幕和转场）

# 3. 编写 brief（创意简报）
# 包含:
#   - 标题: Turtle Monitor 宣传预告片
#   - 目标平台: B站 3min + 抖音 40s
#   - 核心卖点: Agent 绳子交互 > 快速 Agent 使用 > 绳子物理 > 自定义皮肤 > 硬件监控
#   - 素材来源: D:/all/video_material/new_monitor/
#   - 生产模式: real_capture
#   - 渲染引擎: remotion
#   - 分镜脚本: 见 § 三
```

**检查点：** 提交 brief 给用户确认。

---

### 阶段 2：Script（脚本阶段）

**先读 Skill:**
1. `skills/pipelines/screen-demo/script-director.md`
2. `skills/meta/reviewer.md`

**产出：** `script`（脚本，带时间戳标注）

**操作步骤：**

```bash
# 1. 转录音轨（如果有解说）
bash --noprofile --norc -c 'cd /d/all/OpenMontage && python -c "
from tools.analysis.transcriber import Transcriber
# 转录音频，获取时间戳
"'

# 2. 编写带时间戳的脚本
# 每段对应分镜脚本的一个场景
# 标注: 时间范围、画面内容、字幕文本、解说词

# 3. 确定字幕方案
# 风格: 无衬线字体 + 半透明底（用户确认）
```

**检查点：** 脚本准确性审查。

---

### 阶段 3：Scene Plan（场景规划阶段）

**先读 Skill:**
1. `skills/pipelines/screen-demo/scene-director.md`
2. `skills/creative/screen-recording.md`

**产出：** `scene_plan`（场景规划）

**操作步骤：**

```bash
# 1. 分析素材，确定每个场景的裁剪区域
# 例如: Agent 弹出提示时需要放大到气泡区域

# 2. 规划视觉引导
# - 开场钩子: 全屏快节奏蒙太奇
# - Agent 打断: 放大到乌龟区域，绳子脉冲
# - 审批操作: 聚焦气泡
# - 绳子交互: 全屏展示
# - 皮肤切换: 快速切换
# - 监控面板: 展示面板

# 3. 确定节奏
# 开场钩子: 7秒快节奏
# 正常段落: 13-25秒
# 收尾: 20秒
```

**检查点：** 场景规划合理性审查。

---

### 阶段 4：Assets（素材准备阶段）

**先读 Skill:**
1. `skills/pipelines/screen-demo/asset-director.md`
2. `skills/meta/animation-runtime-selector.md`

**产出：** `asset_manifest`（素材清单）

**操作步骤：**

```bash
# 1. 将素材从 D:/all/video_material/new_monitor/ 复制到项目
cp -r "D:/all/video_material/new_monitor/"* "D:/all/OpenMontage/remotion-composer/public/assets/clips/"

# 2. 生成字幕（如有解说）
# 使用 subtitle_gen 工具

# 3. 准备 BGM（多段变化策略）
# 从免费可商用音源获取 4-5 段不同风格/编曲的 BGM
# 同一音色/编曲连续使用不超过 30 秒（避免听觉疲劳）
# 具体编曲切换表见下面 Edit 阶段 § 3
# 或使用 OpenMontage 的 audio 工具获取

# 4. 确认素材清单
# 每个素材文件存在、格式正确、时长匹配
```

**素材来源目录结构：**

所有素材位于 `D:/all/video_material/new_monitor/`，按以下目录组织：

| 目录/文件 | 内容 | 说明 |
|:---|:---|:---|
| `material/序列 01.mp4` | 完整功能演示 | 最完整的演示素材，但缺少双状态切换、干净皮肤切换、自定义皮肤演示 |
| `5state/` | `blink/happy/hover/pain/pull.mp4` | 乌龟 5 种聊天状态 |
| `4chatstate/` | `comment/work-and-complete/work-and-error.mp4` | 4 种交互状态 |
| `creat-and-swichskin/1.58.mp4` | 自定义皮肤 + 切换皮肤 | **文件名 1.58 是时间分界线**：1:58 之前是自定义创建皮肤，之后是切换皮肤 |
| `turtle_promo/02_clips/` | 已分类剪辑片段 | 含 `skin_draw.mp4`（自定义画图）、`skin_switch.mp4`（皮肤切换）等 |
| `turtle_promo/05_final/` | 历史最终输出 | 横版/竖版视频，可作为参考对照 |
| `export-001.mp4` | 完整录屏导出 | 原始录制 |
| `recording-*.mp4` | 原始录制文件 | 未裁剪 |

**素材清单：**

| 文件名 | 用途 | 时长 |
|:---|:---|:---:|
| `hook_montage.mp4` | 开场钩子蒙太奇 | 7s |
| `user_watching.mp4` | 用户在看视频 | 11s |
| `agent_popup.mp4` | Agent 弹出提示 | 12s |
| `approval_click.mp4` | 审批操作 | 20s |
| `qa_session.mp4` | 问答操作 | 20s |
| `rope_physics.mp4` | 绳子交互（压缩版） | 12s |
| `skin_switch.mp4` | 皮肤切换 | 12s |
| `custom_drawing.mp4` | **自定义画图（新增！）** | 15s |
| `monitor_panel.mp4` | 硬件监控 | 13s |
| `sponsor_features.mp4` | 赞助版功能 | 15s |
| `turtle_happy.mp4` | 乌龟 happy 收尾 | 15s |

**检查点：** 所有素材文件存在、格式正确。

---

### 阶段 5：Edit（剪辑决策阶段）

**先读 Skill:**
1. `skills/pipelines/screen-demo/edit-director.md`

**产出：** `edit_decisions`（剪辑决策）

**操作步骤：**

```bash
# 1. 确定剪辑策略
# - 开场钩子: 快节奏蒙太奇，每个镜头 1 秒
# - Agent 段落: 保持原速，展示完整流程
# - 绳子交互: 慢动作突出物理效果
# - 皮肤切换: 快速切换展示
# - 收尾: 缓慢淡出

# 2. 确定转场
# 开场→日常: crossfade (0.5s)
# 日常→Agent: cut（快速切换）
# Agent→审批: cut
# 审批→问答: cut
# 问答→绳子: crossfade (0.5s)
# 绳子→皮肤: cut
# 皮肤→监控: crossfade (0.5s)
# 监控→赞助版: cut
# 赞助版→收尾: crossfade (1s)

# 3. 确定 BGM 切换点（多段变化，避免同一音色持续超过 30 秒）
# 0:00-0:07 开头钩子 → 强节奏电子鼓点（卡点蒙太奇）
# 0:07-0:18 日常守护 → 轻 lo-fi（人声/钢琴主旋律）
# 0:18-0:30 Agent 打断 → 电子合成器（音色突变，吸引注意）
# 0:30-1:10 审批+问答 → 轻 lo-fi 回归（与日常段落不同编曲）
# 1:10-1:30 绳子交互 → 电子鼓点+贝斯（节奏感强）
# 1:30-1:42 皮肤切换 → 电子琶音（快速、明亮）
# 1:42-1:57 自定义画图 → 轻快 lo-fi（钢琴+轻鼓）
# 1:57-2:10 硬件监控 → 科技感电子（氛围感）
# 2:10-2:25 赞助版 → 同科技感电子（延续）
# 2:25-2:40 收尾 → lo-fi 淡出（钢琴独奏）

# 规则：同一 BGM 音色/编曲连续使用不超过 30 秒
# 规则：段落切换时必须有音色/节奏/风格的明显变化
```

**验证门禁：** 所有剪辑决策引用有效的素材文件。

---

### 阶段 6：Compose（合成渲染阶段）

**先读 Skill:**
1. `skills/pipelines/screen-demo/compose-director.md`
2. `skills/core/hyperframes.md`（如果使用 hyperframes）
3. `skills/meta/checkpoint-protocol.md`

**产出：** `render_report` + `final_review`

**操作步骤：**

```bash
# 1. 构建 Remotion 合成
# 编辑 remotion-composer/src/ 中的 React 组件
# 每个场景作为一个 Composition

# 2. 使用 video_compose 工具渲染
bash --noprofile --norc -c 'cd /d/all/OpenMontage && python -c "
from tools.video.video_compose import VideoCompose
composer = VideoCompose()
# 配置渲染参数
result = composer.execute(
    render_runtime=\"remotion\",
    edit_decisions=\"...\",
    asset_manifest=\"...\",
    output_path=\"D:/all/video_material/finished/turtle_monitor_promo_bilibili.mp4/"
)
"'

# 3. 音频混合
bash --noprofile --norc -c 'cd /d/all/OpenMontage && python -c "
from tools.audio.audio_mixer import AudioMixer
mixer = AudioMixer()
# BGM + 解说 混合
"'

# 4. 如果使用 Remotion 原生渲染:
bash --noprofile --norc -c 'cd /d/all/OpenMontage/remotion-composer && node node_modules/@remotion/cli/remotion-cli.js render src/index.tsx Explainer "D:/all/video_material/finished/turtle_monitor_promo_bilibili.mp4"'
```

### 4. 动效与视觉增强策略（解决"只有寡淡字幕"问题）

**核心原则：** 每个信息点都必须伴随动效，不能只有静态文字。

**文字动效规则（使用 Remotion 动画组件）：**

| 动效类型 | 适用场景 | 实现方式 |
|:---|:---|:---|
| 打字机效果 | 解说字幕逐字出现 | `@remotion/player` + `useCurrentFrame()` 控制字符截取 |
| 弹性弹入 | 功能标题弹出 | GSAP `easeOutBack` 缓动，从 scale(0.8) → scale(1) |
| 底部滑入 | 说明文字出现 | CSS `translateY(40px) → translateY(0)`，opacity 0→1 |
| 发光渐显 | 收尾标题 "Coming Soon" | 文字发光 + 呼吸动画，`text-shadow` 脉动 |
| 粒子散开 | 皮肤切换瞬间 | 小方块粒子从中心向四周扩散消失 |
| 涟漪扩散 | 鼠标点击位置 | 圆形从点击点向外扩散，opacity 1→0 |
| 数值跳动 | 监控数据展示 | 数字快速滚动到目标值 |
| 3D 翻转 | 卡片式切换 | `rotateY(0) → rotateY(90) → rotateY(0)` 中间切换内容 |
| 拖尾/轨迹 | 绳子物理展示 | 绳子路径上残留半透明轨迹，逐渐消失 |

**使用 Remotion 的 `@remotion/transitions` 包实现场景过渡：**

```bash
# 场景过渡方案
# 开场→日常: crossfade (0.5s)
# 日常→Agent: slide（从左向右滑入）
# Agent→审批: cut（快速切换）
# 审批→问答: slide（从上向下）
# 问答→绳子: crossfade (0.5s)
# 绳子→皮肤: wipe（从右向左擦除）
# 皮肤→画图: slide（从下向上）
# 画图→监控: crossfade (0.5s)
# 监控→赞助版: slide
# 赞助版→收尾: fade（1s 慢速淡出）
```

**渲染验证：**
```bash
ffprobe -v error -show_format "D:/all/video_material/finished/turtle_monitor_promo_bilibili.mp4"
# 确认: 时长 ≈ 180s, 视频流存在, 音频流存在
```

**检查点：** 渲染结果预览 + 用户确认。

---

### 阶段 7：Publish（发布阶段）

**先读 Skill:**
1. `skills/pipelines/screen-demo/publish-director.md`

**产出：** `publish_log`（发布日志）

**操作步骤：**

```bash
# 1. 渲染封面
ffmpeg -i "D:/all/video_material/finished/turtle_monitor_promo_bilibili.mp4" -ss 170 -vframes 1 "D:/all/video_material/finished/cover.png"

# 2. 制作抖音精剪版（40秒）
# 提取关键片段 + 文字叠加
# 使用 FFmpeg 或 OpenMontage 的 video_trimmer

# 抖音版特殊要求：
# 1. 双层字幕：上层为功能说明（大号粗体），下层为详细描述（小号字体）
#    例如：上层 "一键审批 ✅"  下层 "点一下，放行"
# 2. 字幕入场/退场动画：每段文字从底部滑入，停留 3 秒后滑出
# 3. 纯 BGM 卡点，无解说
# 4. 每段 5-6 秒，共 6-7 段
# 5. 文字样式：无衬线字体，白色，半透明黑底，上層字号 48，下層字号 28

# 3. 准备发布材料
# - B 站视频: turtle_monitor_promo_bilibili.mp4
# - 抖音视频: turtle_monitor_promo_douyin.mp4
# - 封面: cover.png
# - 标题: 待定
# - 简介: 待定
# - 标签: #桌宠 #桌面美化 #开发者工具 #开源 #TurtleMonitor
```

---

## 六、与原始 VIDEO_PLAN.md 的差异

| 维度 | 原计划 (VIDEO_PLAN.md) | 新计划 (本文件) |
|:---|:---|:---|
| **框架** | 纯 HyperFrames | **OpenMontage + Remotion** |
| **工作方式** | 手动执行 CLI 命令 | **Agent 读 skill → 调工具 → 自审** |
| **管线** | 自己编排 11 个阶段 | **OpenMontage screen-demo 8 阶段** |
| **工具调用** | 拼凑 CLI 命令 | **通过 Python ToolRegistry 统一调用** |
| **检查点** | 自己写验证脚本 | **内置 checkpoint 机制** |
| **Agent 集成** | 无 | **内置 Claude/Codex/Cursor 配置** |
| **Remotion 工作台** | 无 | **`npx remotion studio` 可视化 GUI** |
| **BGM 获取** | 手动下载 | **OpenMontage audio 工具** |
| **字幕生成** | 手动编写 | **OpenMontage subtitle_gen 工具** |

---

## 七、启动提示词

以下提示词可在新会话中启动执行：

```
请执行 Turtle Monitor 宣传视频制作任务，
使用 OpenMontage screen-demo 管线。

## ⚠️ 隔离声明（重要）

本任务独立于任何其他正在进行的视频制作任务。严格隔离：
- 素材来源：D:/all/video_material/new_monitor/（只读，不修改）
- 工作目录：D:/all/OpenMontage/remotion-composer/（独占使用）
- 中间产物：D:/all/OpenMontage/remotion-composer/out/（本任务独占）
- 最终输出：D:/all/video_material/finished/，文件名加 _openmontage 后缀
- 不要读取、修改或依赖 D:/all/lightframe/new_monitor/ 下的任何文件
- 不要与任何其他视频任务共享素材、中间文件或输出目录

## 第一步：阅读理解

1. 完整阅读 D:/all/OpenMontage/AGENT_GUIDE.md
2. 完整阅读 D:/all/lightframe/new_monitor/VIDEO_PLAN_OPENMONTAGE.md
3. 按计划要求，每阶段先读对应的 stage director skill

## 第二步：执行流水线

严格执行计划的 § 五 的 8 个阶段：
0. Pre-flight → 1. Idea → 2. Script → 3. Scene Plan
→ 4. Assets → 5. Edit → 6. Compose → 7. Publish

## 硬性规则

- 每阶段必须先读 skill，再操作
- 每阶段完成后必须通过检查点
- 渲染前必须用 Remotion Studio 预览并等待确认
- 启动 Remotion Studio 时使用 `bash --noprofile --norc` 避免 fnm 报错
- Studio 启动后告知用户打开浏览器访问 http://localhost:3000 审核
- 用户审核时不要关闭 Studio，修改代码后 Studio 会自动热重载
- 用户审核满意后再渲染最终输出
- 输出文件放到 D:/all/video_material/finished/，文件名加 _openmontage 后缀
- 中文交流
- 有阻塞先查 skill 再问
```

---

*本文档基于 OpenMontage screen-demo 管线 v2.1 编写*