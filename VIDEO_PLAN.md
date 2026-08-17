# Turtle Monitor 宣传视频 — Agent 执行工程计划

> 最后更新: 2026-08-17
> 生成方式: grilling 流程，与用户确认后产出
> 阅读顺序: 先读本文档全部内容，再按流水线阶段依次执行

---

## 一、执行前必读

### 1.1 本计划的设计哲学

本文档不是一份"给人类看的创意脚本"，而是一份 **Agent 可执行的工程流水线**。每阶段包含：

```
┌─────────────┐
│  Skill 调用  │ ← 精确到先读哪个 skill 的哪个章节
├─────────────┤
│  输入/输出    │ ← 明确输入素材路径和产出文件
├─────────────┤
│  执行步骤     │ ← 可执行的 CLI 命令和代码
├─────────────┤
│  验证门禁     │ ← 不通过不能进入下一阶段
├─────────────┤
│  错误恢复     │ ← 验证失败时的排查和修复策略
└─────────────┘
```

### 1.2 前置检查清单（Pre-flight）

执行任何步骤前，先运行以下检查。**任何一项不通过则中止并报告。**

```bash
# 1. HyperFrames 环境检查
npx hyperframes doctor --json | jq -e '.ok' >/dev/null
# 失败 → 运行: npx hyperframes doctor 查看详情

# 2. FFmpeg 可用
ffmpeg -version >/dev/null 2>&1
ffprobe -version >/dev/null 2>&1
# 失败 → 检查系统 PATH

# 3. Node.js 版本
node --version | grep -E "^v2[2-9]"
# 失败 → 需要 Node.js >= 22

# 4. 项目目录存在
test -d "d:/all/lightframe/new_monitor"
# 失败 → 检查工作目录

# 5. 素材目录存在（用户录制的素材）
test -d "d:/all/video_material/new_monitor"
# 失败 → 检查 d:/all/video_material/new_monitor 是否存在

# 6. 输出目录可写
mkdir -p "d:/all/video_material/finished"
# 失败 → 检查权限

# 7. 已有素材存在
ls -la "d:/all/video_material/new_monitor/"
# 失败 → 确认素材已录制并分类存放
```

### 1.3 全局约定

| 约定 | 说明 |
|:---|:---|
| 项目根目录 | `d:/all/lightframe/new_monitor` |
| 视频项目目录 | `d:/all/lightframe/new_monitor/turtle-monitor-promo` |
| 素材来源目录 | `d:/all/video_material/new_monitor/`（⚠️ 用户录制的素材在此，不是项目内） |
| 视频项目素材目录 | `d:/all/lightframe/new_monitor/turtle-monitor-promo/assets/clips/`（从素材来源复制到此） |
| B 站版输出 | `d:/all/video_material/finished/turtle_monitor_promo_bilibili.mp4` |
| 抖音版输出 | `d:/all/video_material/finished/turtle_monitor_promo_douyin.mp4` |
| 封面输出 | `d:/all/video_material/finished/cover.png` |
| 中间产物 | `d:/all/video_material/finished/clips/`（抖音版中间素材） |
| 所有路径使用正斜杠 | Windows 兼容性 |
| 每阶段有验证门禁 | 不通过不进下一阶段 |

---

## 二、Skill 调用索引

执行任务前，**先读对应 Skill**，再动手。以下为本文档涉及的所有 Skill：

| 任务 | 先读 Skill | 读取章节 |
|:---|:---|:---|
| HyperFrames 项目初始化 | `/hyperframes` | § 2 — Route fresh creation |
| CLI 命令执行 | `/hyperframes-cli` | Development loop 全部 |
| 合成 HTML 编写 | `/hyperframes-core` | 全部 references（按需读取） |
| 动画编排 | `/hyperframes-animation` | Default: compose atomic rules → `rules-index.md` |
| 音频混音 | `/hyperframes-audio` | `references/presets.md` → How it fits together |
| BGM/音效获取 | `/media-use` | `resolve` → `references/resolve.md` |
| 节拍分析 | `/hyperframes-cli` | `beats` 命令文档 |
| 关键帧生成 | `/hyperframes-cli` | `keyframes` 命令文档 |
| 故事板审查 | `/hyperframes-core` | `references/review-loop.md` |
| 生产流水线 | `/hyperframes-core` | `references/production-loop.md` |
| 子合成 | `/hyperframes-core` | `references/sub-compositions.md` |
| 轨道与剪辑 | `/hyperframes-core` | `references/tracks-and-clips.md` |

---

## 三、STORYBOARD.md — 结构化脚本

在执行任何编码前，**先在视频项目目录下创建 `STORYBOARD.md`**。这是整个视频的"合约"，Agent 逐帧对比验证的依据。

### 3.1 创建 STORYBOARD.md

放在 `turtle-monitor-promo/STORYBOARD.md`：

```markdown
---
format: 1920x1080
duration: 180s
message: "Turtle Monitor — 你的桌面小管家，Agent 桌宠 + 硬件监控"
arc: "钩子 → 日常 → Agent 打断 → 快速解决 → 玩乐 → 皮肤 → 监控 → 赞助版 → 收尾"
audience: "开发者 × ACG 用户"
mode: "autonomous"
---

## Frame 1 — 开场钩子

- status: outline
- duration: 7s
- scene: 功能快节奏蒙太奇
- transition_in: cut

画面: Agent 弹出提示 → 审批点击 → 皮肤切换 → 绳子拖拽 → 监控面板 → 乌龟 happy
字幕: 无
BGM: lofi_main (卡点)
验证: 7 秒内包含全部 6 个功能镜头，每个 ≥1 帧

## Frame 2 — 日常守护

- status: outline
- duration: 13s
- scene: 用户在看视频，乌龟 idle 摇摆
- transition_in: crossfade

画面: 用户正在看视频/浏览网页，桌面角落乌龟 idle 摇摆，绳子自然下垂
字幕: "你的桌面上，有只小乌龟在默默守护"
BGM: lofi_main
验证: 乌龟 idle 动画循环播放，绳子自然下垂物理

## Frame 3 — Agent 打断

- status: outline
- duration: 15s
- scene: 乌龟弹出提示，绳子脉冲
- transition_in: cut

画面: 乌龟突然弹出提示，绳子从松弛变为绷紧/脉冲变色，Recordly 区域放大
字幕: "Agent 任务完成了——"
BGM: lofi_main → electronic (切换点在节拍上)
验证: 绳子脉冲动画 ≤2 秒内吸引注意，Recordly 放大区域正确

## Frame 4 — 审批操作

- status: outline
- duration: 25s
- scene: 一键审批 Agent 操作
- transition_in: cut

画面: 展开气泡 → 审批按钮 → 鼠标点击允许 → 任务继续
字幕: "点一下，放行"
BGM: electronic
验证: 审批操作完整展示，点击反馈清晰

## Frame 5 — 问答操作

- status: outline
- duration: 25s
- scene: 打字提问，Agent 秒回
- transition_in: cut

画面: 在气泡输入框打字 → 回车发送 → Agent 秒回答案
字幕: "问一句，搞定"
BGM: electronic
验证: 输入→发送→回复 完整流程，≤25 秒

## Frame 6 — 绳子交互

- status: outline
- duration: 25s
- scene: 拖拽、甩动、滑轮物理交互
- transition_in: crossfade

画面: 左键拖拽乌龟 → 绳子弹性拉伸 → 回弹 → 右键甩动 → 滑轮模式 → 物理碰撞
字幕: "当然，工作之余还能玩一玩"
BGM: lofi_main
验证: 展示全部 4 种交互方式，绳子物理效果明显

## Frame 7 — 自定义皮肤

- status: outline
- duration: 20s
- scene: 皮肤切换 + 自定义编辑
- transition_in: cut

画面: 乌龟→猫→蜘蛛侠 快速切换 → 像素画布 → 绘制/导入 → 保存 → 应用
字幕: "换个皮肤，换个心情"
BGM: lofi_main
验证: 皮肤切换 ≥3 款，自定义编辑 ≥5 秒

## Frame 8 — 硬件监控

- status: outline
- duration: 15s
- scene: 8 类传感器面板展示
- transition_in: crossfade

画面: 监控面板展开 → CPU/内存/GPU/存储/网络/散热/功耗/电池 → 资源条动效
字幕: "还能监控你的硬件，一清二楚"
BGM: lofi_main
验证: 15 秒内覆盖全部 8 类传感器

## Frame 9 — 赞助版

- status: outline
- duration: 15s
- scene: 赞助版功能展示
- transition_in: cut

画面: 自定义模式 → 像素画布 → 区域标记 → 表情编辑
字幕: "赞助版还有更多玩法"
BGM: lofi_main
验证: 展示 ≥3 个赞助版独有功能

## Frame 10 — 收尾

- status: outline
- duration: 20s
- scene: 敬请期待
- transition_in: crossfade

画面: 乌龟 happy 摆动 → 绳子自然下垂 → "Turtle Monitor" 标题 → "Coming Soon" → "敬请期待"
字幕: "Turtle Monitor — Coming Soon"
BGM: lofi_main (淡出)
验证: 封面帧清晰，文字完整，无下载链接
```

### 3.2 验证 STORYBOARD.md

```bash
# 使用 HyperFrames 解析验证
cd turtle-monitor-promo
npx hyperframes lint
# 确认无错误
```

---

## 四、节拍对齐流水线

这是解决"音乐和配音没有随节奏变化"的核心方案。

### 4.1 获取 BGM 并分析节拍

```bash
# 1. 使用 /media-use 获取 BGM 素材
# 先读: /media-use → resolve → references/resolve.md
node <SKILL_DIR>/scripts/resolve.mjs --type bgm --intent "lofi chill electronic background music for desktop pet showcase 180 seconds" --project .

# 2. 使用 HyperFrames beats 分析节拍
# 先读: /hyperframes-cli → beats 命令文档
npx hyperframes beats assets/bgm_lofi.mp3 --output assets/bgm_lofi_beats.json
# 输出: assets/bgm_lofi_beats.json 包含节拍时间戳数组

# 3. 对 Agent 段落的电子 BGM 同样分析
npx hyperframes beats assets/bgm_electronic.mp3 --output assets/bgm_electronic_beats.json
```

### 4.2 节拍映射 JSON 结构

```json
{
  "bgm_lofi": {
    "file": "assets/bgm_lofi.mp3",
    "bpm": 85,
    "beats": [0.0, 0.705, 1.411, 2.117, ...],
    "bars": [0.0, 2.823, 5.647, ...],
    "duration": 180.0
  },
  "bgm_electronic": {
    "file": "assets/bgm_electronic.mp3",
    "bpm": 128,
    "beats": [0.0, 0.469, 0.938, 1.406, ...],
    "bars": [0.0, 1.875, 3.75, ...],
    "duration": 60.0
  }
}
```

### 4.3 场景切换点对齐

**规则：每个场景切换点必须对齐到最近的节拍。**

```bash
# 使用 keyframes 生成节拍同步关键帧
# 先读: /hyperframes-cli → keyframes 命令文档
npx hyperframes keyframes --scene-timings timings.json --beats assets/bgm_lofi_beats.json --output assets/keyframes.json
```

**手动对齐检查表：**

| 场景 | 原始时间 | 对齐到节拍 | 对齐后时间 |
|:---|:---:|:---:|:---:|
| 开场钩子 | 0:00 | 第 1 拍 | 0.000 |
| 日常守护 | 0:07 | 最接近的第 10 拍 | 7.055 |
| Agent 打断 | 0:20 | 最接近的第 28 拍 | 19.75 |
| 审批操作 | 0:35 | 最接近的第 50 拍 | 35.25 |
| 问答操作 | 1:00 | 最接近的第 85 拍 | 59.95 |
| 绳子交互 | 1:25 | 最接近的第 120 拍 | 84.60 |
| 自定义皮肤 | 1:50 | 最接近的第 156 拍 | 110.0 |
| 硬件监控 | 2:10 | 最接近的第 184 拍 | 129.7 |
| 赞助版 | 2:25 | 最接近的第 205 拍 | 144.5 |
| 收尾 | 2:40 | 最接近的第 226 拍 | 159.3 |

**注意：Agent 段落（Frame 3-5）的节拍使用电子 BGM 的节拍数组。**

### 4.4 验证节拍对齐

```bash
# 验证每个场景切换点是否在节拍上
# 脚本: 读取 timings.json 和 beats.json，检查每个 start 是否在 beats 的 tolerance 范围内
# tolerance: ±50ms

# 示例验证命令
node -e "
const beats = require('./assets/bgm_lofi_beats.json');
const scenes = require('./timings.json').scenes;
const tolerance = 0.05;
scenes.forEach(s => {
  const nearest = beats.beats.find(b => Math.abs(b - s.start) < tolerance);
  if (!nearest) console.error('❌ Scene', s.id, 'start', s.start, 'not aligned to any beat');
  else console.log('✅ Scene', s.id, 'aligned to beat at', nearest);
});
"
```

---

## 五、执行流水线

### 阶段 0：环境准备

**先读 Skill:** `/hyperframes-cli` → Development loop

```bash
# 确认一切就绪
npx hyperframes doctor --json | jq -e '.ok' >/dev/null
# 失败处理: npx hyperframes doctor 查看详情，按提示修复
```

**验证门禁：** `npx hyperframes doctor --json` 返回 `ok: true`

---

### 阶段 1：项目初始化 + STORYBOARD

**先读 Skill:** `/hyperframes` → § 2 Route fresh creation（匹配 `product-launch-video` 或 `general-video`）

```bash
# 1.1 初始化项目
cd d:/all/lightframe/new_monitor
npx hyperframes init turtle-monitor-promo --non-interactive --example blank
cd turtle-monitor-promo

# 1.2 创建 STORYBOARD.md（内容见 § 三）
# 写入 STORYBOARD.md 文件

# 1.3 创建素材目录结构
mkdir -p assets/clips assets/music assets/fonts
mkdir -p compositions/frames
```

**验证门禁：**
```bash
npx hyperframes lint
# 必须无错误
```

**错误恢复：**
- `lint` 报错 → 按错误信息修复，重新运行
- 项目结构问题 → 删除目录重新 `init`

---

### 阶段 2：素材收集与整理（Blocks & Assets）

**先读 Skill:** `/media-use` → resolve → `references/resolve.md`
**依赖:** 阶段 1 完成

#### 2.1 已有素材

用户已录制好分类视频素材，存放在 **`d:/all/video_material/new_monitor/`**。

**执行步骤：将素材复制到视频项目目录**

```bash
# 先读: /hyperframes-core → references/variables-and-media.md（素材路径规则）
# 创建本地素材目录
mkdir -p turtle-monitor-promo/assets/clips

# 从素材来源复制到视频项目
cp -r "d:/all/video_material/new_monitor/"* turtle-monitor-promo/assets/clips/
```

复制后 `assets/clips/` 目录结构应为：

```
assets/clips/
├── hook_montage.mp4     # 开场钩子蒙太奇
├── user_watching.mp4    # 用户在看视频
├── agent_popup.mp4      # Agent 弹出提示
├── approval_click.mp4   # 审批操作
├── qa_session.mp4       # 问答操作
├── rope_physics.mp4     # 绳子交互
├── skin_switch.mp4      # 皮肤切换
├── skin_edit.mp4        # 自定义编辑
├── monitor_panel.mp4    # 硬件监控
├── sponsor_features.mp4 # 赞助版功能
└── turtle_happy.mp4     # 乌龟 happy 收尾
```

#### 2.2 获取 BGM

```bash
# 先读: /media-use → resolve 章节
# 获取 lo-fi BGM（主旋律）
node <SKILL_DIR>/scripts/resolve.mjs --type bgm --intent "lofi chill electronic background music for desktop pet showcase 3 minutes" --project .

# 获取电子 BGM（Agent 段落）
node <SKILL_DIR>/scripts/resolve.mjs --type bgm --intent "electronic upbeat tech background music for AI agent interaction 1 minute" --project .
```

**如果 `/media-use` 不可用，备选方案：**
- 从 YouTube Audio Library 下载免费可商用 lo-fi 和电子曲目
- 使用 Fish Audio 生成（如有授权）

#### 2.3 节拍分析

```bash
# 先读: /hyperframes-cli → beats 命令
npx hyperframes beats assets/bgm_lofi.mp3 --output assets/bgm_lofi_beats.json
npx hyperframes beats assets/bgm_electronic.mp3 --output assets/bgm_electronic_beats.json
```

**验证门禁：**
```bash
# 所有素材文件存在
for f in hook_montage user_watching agent_popup approval_click qa_session rope_physics skin_switch skin_edit monitor_panel sponsor_features turtle_happy; do
  test -f "assets/clips/${f}.mp4" || echo "❌ Missing: ${f}.mp4"
done

# BGM 节拍文件存在且非空
test -s assets/bgm_lofi_beats.json || echo "❌ Missing beats file"
test -s assets/bgm_electronic_beats.json || echo "❌ Missing beats file"
```

**错误恢复：**
- 素材缺失 → 检查用户提供的素材目录，复制缺失文件
- 节拍分析失败 → 检查 BGM 文件格式，确认 FFmpeg 可用

---

### 阶段 3：帧构建（Frames）

**先读 Skill:** `/hyperframes-core` → `references/minimal-composition.md` + `references/composition-patterns.md`
**先读 Skill:** `/hyperframes-animation` → `rules-index.md`（选动画规则）
**依赖:** 阶段 2 完成（素材已就位）

#### 3.1 全局样式

`compositions/global.css`：

```css
/* 无衬线字体 + 半透明底 — 用户确认的字幕风格 */
.subtitle {
  font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 36px;
  color: #ffffff;
  background: rgba(0, 0, 0, 0.6);
  padding: 8px 24px;
  border-radius: 4px;
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  white-space: nowrap;
}

/* 场景容器 */
.scene {
  position: absolute;
  inset: 0;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
}
```

#### 3.2 每个场景作为一个子合成

每个 Frame 一个独立 HTML 文件，放在 `compositions/frames/` 目录。

**Frame 模板：**

```html
<template>
  <div data-composition-id="frame-01-hook"
       data-width="1920" data-height="1080"
       data-duration="7" data-start="0"
       data-fps="30">
    <style>
      /* 场景专属样式 */
      @import "../global.css";
    </style>
    <div class="scene">
      <!-- 视频素材 -->
      <video class="clip" data-track-index="0" data-start="0" data-duration="7"
             src="../../assets/clips/hook_montage.mp4"></video>
      <!-- 字幕（此场景无字幕） -->
    </div>
    <script>
      (() => {
        const id = 'frame-01-hook';
        const tl = gsap.timeline({ paused: true });
        // 开场动画：快速缩放淡入
        tl.fromTo('.scene', { scale: 1.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3 });
        window.__timelines[id] = tl;
      })();
    </script>
  </div>
</template>
```

**注意：** 每个子合成的 `data-composition-id` 必须与主合成 host slot 的 `data-composition-id` 完全一致，且 `window.__timelines["<id>"]` 的 key 也一致。

#### 3.3 帧清单

| 帧 ID | 文件名 | 素材 | 动画 | 字幕 |
|:---|:---|:---|:---|:---|
| `frame-01-hook` | `01-hook.html` | `hook_montage.mp4` | 缩放淡入 | 无 |
| `frame-02-daily` | `02-daily.html` | `user_watching.mp4` | 淡入 | "你的桌面上，有只小乌龟在默默守护" |
| `frame-03-agent` | `03-agent.html` | `agent_popup.mp4` | 绳子脉冲 GSAP | "Agent 任务完成了——" |
| `frame-04-approve` | `04-approve.html` | `approval_click.mp4` | 点击高亮脉冲 | "点一下，放行" |
| `frame-05-qa` | `05-qa.html` | `qa_session.mp4` | 打字动画 | "问一句，搞定" |
| `frame-06-rope` | `06-rope.html` | `rope_physics.mp4` | 弹性回弹 | "当然，工作之余还能玩一玩" |
| `frame-07-skin` | `07-skin.html` | `skin_switch.mp4` + `skin_edit.mp4` | 横向滑动切换 | "换个皮肤，换个心情" |
| `frame-08-monitor` | `08-monitor.html` | `monitor_panel.mp4` | 淡入 | "还能监控你的硬件，一清二楚" |
| `frame-09-sponsor` | `09-sponsor.html` | `sponsor_features.mp4` | 淡入 | "赞助版还有更多玩法" |
| `frame-10-end` | `10-end.html` | `turtle_happy.mp4` | 淡入 + 文字渐显 | "Turtle Monitor — Coming Soon" |

#### 3.4 帧构建顺序

**使用并行构建（各帧独立，可同时进行）：**

```bash
# 每帧一个子合成，并行生成
# 读取: /hyperframes-core → references/sub-compositions.md
# 读取: /hyperframes-animation → rules-index.md（选动画规则）

# 构建完成后，逐个验证
for f in compositions/frames/*.html; do
  echo "Checking $f"
  npx hyperframes lint "$f" || echo "⚠️ Lint issues in $f"
done
```

**验证门禁：**
```bash
# 所有 10 帧文件存在
for i in $(seq -w 1 10); do
  test -f "compositions/frames/${i}"*.html || echo "❌ Missing frame ${i}"
done

# 每帧 lint 通过
npx hyperframes lint
```

**错误恢复：**
- 缺少帧文件 → 检查模板，确认文件已创建
- lint 报错 → 按错误信息修正 HTML/GSAP 代码
- 动画不生效 → 检查 `window.__timelines` 注册是否正确

---

### 阶段 4：音频处理（Audio）

**先读 Skill:** `/hyperframes-audio` → `references/presets.md`（症状到修复对照表）
**依赖:** 阶段 2 完成（BGM 已就位），阶段 3 完成（帧时间线确定）

#### 4.1 生成 BGM 切换方案

```
Frame 1-2 (0:00-0:20): lo-fi
Frame 3-5 (0:20-1:25): electronic（在节拍点切换）
Frame 6-10 (1:25-3:00): lo-fi（在节拍点切换回）
```

#### 4.2 BGM 分段处理

```bash
# 使用 FFmpeg 裁剪 BGM 分段
# lo-fi 主旋律
ffmpeg -i assets/bgm_lofi.mp3 -t 20 assets/bgm_lofi_part1.mp3
ffmpeg -i assets/bgm_lofi.mp3 -ss 85 -t 95 assets/bgm_lofi_part2.mp3

# electronic（Agent 段落）
ffmpeg -i assets/bgm_electronic.mp3 -t 65 assets/bgm_electronic_part.mp3
```

#### 4.3 构建音频混合

```bash
# 使用 FFmpeg 合并音频轨道
# 方法：concat 三个分段
ffmpeg -i assets/bgm_lofi_part1.mp3 -i assets/bgm_electronic_part.mp3 -i assets/bgm_lofi_part2.mp3 \
  -filter_complex "[0][1][2]concat=n=3:v=0:a=1[bgm]" \
  -map "[bgm]" assets/bgm_merged.mp3
```

**验证门禁：**
```bash
# 检查 BGM 总时长 ≈ 180 秒
ffprobe -v error -show_format assets/bgm_merged.mp3 | grep duration
# 接近 180 秒，误差 ±5 秒

# 检查切换点
# 在 20 秒和 85 秒附近应有明显的风格变化
```

**错误恢复：**
- 时长不匹配 → 调整 FFmpeg 裁剪参数
- 切换点不自然 → 使用交叉淡入过渡

---

### 阶段 5：时长同步（Duration Sync）

**先读 Skill:** `/hyperframes-core` → `references/production-loop.md` → Duration sync 章节
**依赖:** 阶段 4 完成（BGM 时长确定）

#### 5.1 生成最终时间线

根据节拍对齐结果和 BGM 时长，确定每个场景的精确时间：

```json
{
  "scenes": [
    { "id": "frame-01-hook", "start": 0.000, "duration": 7.055 },
    { "id": "frame-02-daily", "start": 7.055, "duration": 12.695 },
    { "id": "frame-03-agent", "start": 19.750, "duration": 15.500 },
    { "id": "frame-04-approve", "start": 35.250, "duration": 24.700 },
    { "id": "frame-05-qa", "start": 59.950, "duration": 24.650 },
    { "id": "frame-06-rope", "start": 84.600, "duration": 25.400 },
    { "id": "frame-07-skin", "start": 110.000, "duration": 19.700 },
    { "id": "frame-08-monitor", "start": 129.700, "duration": 14.800 },
    { "id": "frame-09-sponsor", "start": 144.500, "duration": 14.800 },
    { "id": "frame-10-end", "start": 159.300, "duration": 20.700 }
  ]
}
```

**验证门禁：**
```bash
# 总时长 = 最后一帧 start + duration
# 验证总时长 ≈ 180 秒
node -e "
const timings = require('./timings.json');
const last = timings.scenes[timings.scenes.length - 1];
const total = last.start + last.duration;
console.log('Total duration:', total, 'seconds');
if (Math.abs(total - 180) > 10) console.error('❌ Duration mismatch');
else console.log('✅ Duration OK');
"
```

**错误恢复：**
- 总时长偏差过大 → 调整部分场景的 duration 值
- 确保在 `data-duration` 中更新为精确值

---

### 阶段 6：合成装配（Assembly）

**先读 Skill:** `/hyperframes-core` → `references/sub-compositions.md` + `references/tracks-and-clips.md`
**依赖:** 阶段 3 完成（帧已构建），阶段 5 完成（时间线已确定）

#### 6.1 主合成 `index.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Turtle Monitor Promo</title>
  <style>
    /* 全局样式 */
    @import "compositions/global.css";
  </style>
</head>
<body>
  <div data-composition-id="turtle-monitor-promo"
       data-width="1920" data-height="1080"
       data-duration="180" data-start="0"
       data-fps="30">

    <!-- 场景 1: 开场钩子 -->
    <div class="scene" data-composition-src="compositions/frames/01-hook.html"
         data-track-index="0" data-start="0.000" data-duration="7.055"></div>

    <!-- 场景 2: 日常守护 -->
    <div class="scene" data-composition-src="compositions/frames/02-daily.html"
         data-track-index="0" data-start="7.055" data-duration="12.695"></div>

    <!-- 场景 3: Agent 打断 -->
    <div class="scene" data-composition-src="compositions/frames/03-agent.html"
         data-track-index="0" data-start="19.750" data-duration="15.500"></div>

    <!-- 场景 4: 审批操作 -->
    <div class="scene" data-composition-src="compositions/frames/04-approve.html"
         data-track-index="0" data-start="35.250" data-duration="24.700"></div>

    <!-- 场景 5: 问答操作 -->
    <div class="scene" data-composition-src="compositions/frames/05-qa.html"
         data-track-index="0" data-start="59.950" data-duration="24.650"></div>

    <!-- 场景 6: 绳子交互 -->
    <div class="scene" data-composition-src="compositions/frames/06-rope.html"
         data-track-index="0" data-start="84.600" data-duration="25.400"></div>

    <!-- 场景 7: 自定义皮肤 -->
    <div class="scene" data-composition-src="compositions/frames/07-skin.html"
         data-track-index="0" data-start="110.000" data-duration="19.700"></div>

    <!-- 场景 8: 硬件监控 -->
    <div class="scene" data-composition-src="compositions/frames/08-monitor.html"
         data-track-index="0" data-start="129.700" data-duration="14.800"></div>

    <!-- 场景 9: 赞助版 -->
    <div class="scene" data-composition-src="compositions/frames/09-sponsor.html"
         data-track-index="0" data-start="144.500" data-duration="14.800"></div>

    <!-- 场景 10: 收尾 -->
    <div class="scene" data-composition-src="compositions/frames/10-end.html"
         data-track-index="0" data-start="159.300" data-duration="20.700"></div>

    <!-- BGM 音轨 -->
    <audio data-track-index="audio" data-start="0" data-duration="180"
           data-volume="0.15" src="assets/bgm_merged.mp3"></audio>
  </div>

  <script>
    // 主合成 timeline
    const id = 'turtle-monitor-promo';
    const tl = gsap.timeline({ paused: true });
    window.__timelines[id] = tl;
  </script>
</body>
</html>
```

**验证门禁：**
```bash
# lint 检查
npx hyperframes lint

# 快照检查 — 在每个场景中点采样
npx hyperframes snapshot --at 3.5,13,27,47,72,97,120,137,152,170

# 肉眼检查每个快照：画面内容是否正确？字幕是否匹配？
```

**错误恢复：**
- 合成空白 → 检查 `data-composition-src` 路径和 `data-composition-id` 匹配
- 画面错位 → 检查 `data-start` 和 `data-duration` 是否与时间线一致
- 素材不显示 → 检查 `src` 路径，确认视频文件存在
- 检查 `data-composition-id` 是否 **完全一致**（host 的 = template 内的 = `window.__timelines` 的 key）

---

### 阶段 7：过渡效果（Transitions）

**先读 Skill:** `/hyperframes-animation` → `transitions/overview.md` + `transitions/catalog.md`
**依赖:** 阶段 6 完成（主合成已装配）

#### 7.1 过渡方案

| 场景过渡 | 过渡类型 | 说明 |
|:---|:---|:---|
| 开场→日常 | `crossfade` | 0.5 秒交叉淡入淡出 |
| 日常→Agent | `cut` | 快速切换，配合 Agent 打断节奏 |
| Agent→审批 | `cut` | 保持节奏 |
| 审批→问答 | `cut` | 保持节奏 |
| 问答→绳子 | `crossfade` | 0.5 秒，从"工作"过渡到"玩乐" |
| 绳子→皮肤 | `cut` | 快节奏切换 |
| 皮肤→监控 | `crossfade` | 0.5 秒 |
| 监控→赞助版 | `cut` | 功能切换 |
| 赞助版→收尾 | `crossfade` | 1 秒，温柔收束 |

**验证门禁：**
```bash
npx hyperframes check
```

---

### 阶段 8：字幕（Captions）

**先读 Skill:** `/hyperframes-audio` 或 `/media-use` → `scripts/transcribe.mjs`
**依赖:** 阶段 6 完成

#### 8.1 字幕叠加

每个场景的字幕已在各帧的 HTML 中实现（`<div class="subtitle">`）。字幕样式已在 `global.css` 中定义。

**验证门禁：**
```bash
# 使用 snapshot 检查每个场景的字幕
npx hyperframes snapshot --at 13,27,47,72,97,120,137,152,170

# 检查每个快照中字幕是否：
# 1. 可见
# 2. 文字正确
# 3. 位置合理（底部，不遮挡重要内容）
```

**错误恢复：**
- 字幕错位 → 调整 CSS 定位
- 字幕文字错误 → 对照 STORYBOARD.md 逐帧核对
- 字幕缺失 → 检查对应帧的 HTML 中是否有 `.subtitle` 元素

---

### 阶段 9：验证（Verify）

**先读 Skill:** `/hyperframes-cli` → `lint` + `check` + `snapshot` 命令文档
**依赖:** 阶段 6-8 全部完成

#### 9.1 验证流水线

```bash
# 1. Lint 检查
echo "=== LINT ==="
npx hyperframes lint --strict
if [ $? -ne 0 ]; then
  echo "❌ Lint failed. Fix errors before proceeding."
  exit 1
fi

# 2. Check（包含 lint + 运行时检查）
echo "=== CHECK ==="
npx hyperframes check
if [ $? -ne 0 ]; then
  echo "❌ Check failed. Fix errors before proceeding."
  exit 1
fi

# 3. 快照验证
echo "=== SNAPSHOT ==="
npx hyperframes snapshot --at 3.5,13,27,47,72,97,120,137,152,170 --snapshots

# 4. 时间线验证
echo "=== TIMELINE ==="
npx hyperframes preview --selection --json | jq '.duration'
# 确认总时长 ≈ 180 秒
```

#### 9.2 验证门禁清单

| 检查项 | 命令 | 通过条件 |
|:---|:---|:---|
| Lint 无错误 | `npx hyperframes lint` | exit code 0 |
| Check 通过 | `npx hyperframes check` | exit code 0 |
| 所有帧存在 | `ls compositions/frames/*.html` | 10 个文件 |
| 素材存在 | `ls assets/clips/*.mp4` | 11 个文件 |
| 总时长 ≈ 180s | `ffprobe` | 175-185 秒 |
| 字幕对照 | 肉眼检查快照 | 每帧字幕与 STORYBOARD.md 一致 |
| 无空白帧 | 肉眼检查快照 | 每帧都有内容 |
| BGM 有声音 | `ffprobe` | 音频流存在 |

**失败处理：**
- 任何检查失败 → 阅读错误信息，定位问题帧，修复后重新运行该阶段
- 快照显示空白 → 检查 `data-composition-id` 匹配、`src` 路径、视频文件
- 字幕错位 → 检查帧 HTML 中字幕元素的位置和样式

---

### 阶段 10：渲染输出（Deliver）

**先读 Skill:** `/hyperframes-cli` → `render` 命令 + `references/production-loop.md` → Deliver 章节
**依赖:** 阶段 9 验证通过

#### 10.1 渲染 B 站版

```bash
# 先预览确认
npx hyperframes preview
# 等待用户确认后渲染

# 确保输出目录存在
mkdir -p "d:/all/video_material/finished"

# 高质量渲染到输出目录
npx hyperframes render --quality high --output "d:/all/video_material/finished/turtle_monitor_promo_bilibili.mp4"

# 验证输出
test -s "d:/all/video_material/finished/turtle_monitor_promo_bilibili.mp4" || echo "❌ Render output empty"
ffprobe -v error -show_format "d:/all/video_material/finished/turtle_monitor_promo_bilibili.mp4"
```

#### 10.2 渲染封面帧

```bash
# 从收尾帧提取封面
ffmpeg -i "d:/all/video_material/finished/turtle_monitor_promo_bilibili.mp4" -ss 170 -vframes 1 "d:/all/video_material/finished/cover.png"
```

---

### 阶段 11：抖音精剪版

**依赖:** 阶段 10 完成（B 站版已渲染）

#### 11.1 提取片段

```bash
# 确保输出目录存在
mkdir -p "d:/all/video_material/finished/clips"

# 从 B 站版中提取 6 个片段
# 时间点与 STORYBOARD.md 一致

# 片段 1: 开场钩子 (0:00-0:07)
ffmpeg -i "d:/all/video_material/finished/turtle_monitor_promo_bilibili.mp4" -ss 0 -t 7 -c copy "d:/all/video_material/finished/clips/clip_hook.mp4"

# 片段 2: Agent 弹出 (0:20-0:26)
ffmpeg -i "d:/all/video_material/finished/turtle_monitor_promo_bilibili.mp4" -ss 19.750 -t 6 -c copy "d:/all/video_material/finished/clips/clip_agent.mp4"

# 片段 3: 审批操作 (0:35-0:41)
ffmpeg -i "d:/all/video_material/finished/turtle_monitor_promo_bilibili.mp4" -ss 35.250 -t 6 -c copy "d:/all/video_material/finished/clips/clip_approve.mp4"

# 片段 4: 绳子交互 (1:25-1:31)
ffmpeg -i "d:/all/video_material/finished/turtle_monitor_promo_bilibili.mp4" -ss 84.600 -t 6 -c copy "d:/all/video_material/finished/clips/clip_rope.mp4"

# 片段 5: 皮肤切换 (1:50-1:56)
ffmpeg -i "d:/all/video_material/finished/turtle_monitor_promo_bilibili.mp4" -ss 110.000 -t 6 -c copy "d:/all/video_material/finished/clips/clip_skin.mp4"

# 片段 6: 收尾 (2:40-2:44)
ffmpeg -i "d:/all/video_material/finished/turtle_monitor_promo_bilibili.mp4" -ss 159.300 -t 4 -c copy "d:/all/video_material/finished/clips/clip_end.mp4"
```

#### 11.2 文字叠加

使用 FFmpeg drawtext 滤镜叠加文字：

```bash
# 对每个片段叠加文字
ffmpeg -i "d:/all/video_material/finished/clips/clip_agent.mp4" \
  -vf "drawtext=text='任务完成 🔔':fontsize=48:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=10:x=(w-text_w)/2:y=h-text_h-80" \
  -c:a copy "d:/all/video_material/finished/clips/clip_agent_text.mp4"

# 其他片段类似
```

#### 11.3 合并抖音版

```bash
# 创建文件列表
for f in "d:/all/video_material/finished/clips/clip_"*"_text.mp4"; do echo "file '$f'" >> "d:/all/video_material/finished/clips/concat_list.txt"; done

# 合并
ffmpeg -f concat -safe 0 -i "d:/all/video_material/finished/clips/concat_list.txt" -c copy "d:/all/video_material/finished/turtle_monitor_promo_douyin.mp4"
```

**验证门禁：**
```bash
test -s "d:/all/video_material/finished/turtle_monitor_promo_douyin.mp4" || echo "❌ Douyin output empty"
ffprobe -v error -show_format "d:/all/video_material/finished/turtle_monitor_promo_douyin.mp4"
# 确认时长 30-40 秒
```

---

## 六、验证门禁总表

| 阶段 | 门禁 | 失败处理 |
|:---|:---|:---|
| 0: 环境准备 | `npx hyperframes doctor --json` → ok | 按 doctor 提示修复 |
| 1: 项目初始化 | `npx hyperframes lint` → 无错误 | 修复 lint 错误 |
| 2: 素材收集 | 所有素材文件存在，节拍文件非空 | 检查素材路径，重新分析节拍 |
| 3: 帧构建 | 10 帧文件存在，每帧 lint 通过 | 补缺失帧，修复 lint 错误 |
| 4: 音频处理 | BGM 总时长 ≈ 180s，切换点正常 | 调整 FFmpeg 参数 |
| 5: 时长同步 | 总时长 175-185s | 调整场景 duration |
| 6: 合成装配 | lint 通过，每个场景中点快照有内容 | 检查 ID 匹配、路径、素材 |
| 7: 过渡效果 | `npx hyperframes check` 通过 | 修复过渡动画 |
| 8: 字幕 | 快照显示字幕正确 | 对照 STORYBOARD.md 修复 |
| 9: 验证 | lint + check + snapshot 全部通过 | 定位问题帧修复 |
| 10: 渲染 | 输出文件存在且非空 | 重新渲染 |
| 11: 抖音版 | 输出文件存在，时长 30-40s | 重新裁剪合并 |

---

## 七、错误恢复速查表

| 症状 | 可能原因 | 修复 |
|:---|:---|:---|
| 画面空白 | `data-composition-id` 不匹配 | 确认 host slot 的 ID = template 内的 ID = `window.__timelines` 的 key |
| 素材不显示 | 路径错误 | 检查 `src` 路径，确认视频文件存在 |
| 字幕错位 | CSS 定位错误 | 检查 `.subtitle` 的 position 和 bottom 值 |
| 动画不生效 | timeline 未注册 | 检查 `window.__timelines[id] = tl` |
| 节拍对不上 | 未对齐到节拍 | 重新运行 beat alignment |
| 合成总时长不对 | `data-duration` 未更新 | 在 `timings.json` 中更新并同步到 `index.html` |
| lint 报错 | 见错误信息 | 按提示修复 |
| check 报错 | 运行时错误 | 用 `check --verbose` 查看详情 |
| 渲染输出太大 | 码率过高 | 使用 `--quality balanced` 或指定码率 |
| 帧快照空白 | 子合成装载失败 | 检查 `data-composition-src` 路径和 `data-composition-id` |

---

## 八、产物文件树

```
turtle-monitor-promo/
├── STORYBOARD.md                    # 结构化脚本（§ 三）
├── timings.json                     # 场景时间线（§ 5.1）
├── index.html                       # 主合成（§ 6.1）
├── compositions/
│   ├── global.css                   # 全局样式
│   └── frames/
│       ├── 01-hook.html
│       ├── 02-daily.html
│       ├── 03-agent.html
│       ├── 04-approve.html
│       ├── 05-qa.html
│       ├── 06-rope.html
│       ├── 07-skin.html
│       ├── 08-monitor.html
│       ├── 09-sponsor.html
│       └── 10-end.html
├── assets/
│   ├── clips/                       # 用户录制的视频素材
│   ├── music/                       # BGM 源文件
│   ├── bgm_lofi_beats.json          # Lo-fi 节拍分析
│   ├── bgm_electronic_beats.json    # 电子节拍分析
│   ├── keyframes.json               # 节拍同步关键帧
│   └── bgm_merged.mp3               # 合并后的 BGM
└── out/
    └── (中间产物，最终输出不在本项目内)

## 最终输出产物

素材来源和最终输出都在 `d:/all/video_material/`：

```
d:/all/video_material/
├── new_monitor/                          # 📥 用户录制的素材（只读来源）
│   ├── hook_montage.mp4
│   ├── user_watching.mp4
│   ├── agent_popup.mp4
│   ├── ... (其他素材)
│
└── finished/                             # 📤 最终输出
    ├── turtle_monitor_promo_bilibili.mp4    # B 站版主视频
    ├── turtle_monitor_promo_douyin.mp4      # 抖音精剪版
    ├── cover.png                            # B 站封面
    └── clips/                               # 抖音版中间素材
        ├── clip_hook.mp4
        ├── clip_agent.mp4
        ├── clip_approve.mp4
        ├── clip_rope.mp4
        ├── clip_skin.mp4
        ├── clip_end.mp4
        ├── clip_hook_text.mp4
        ├── clip_agent_text.mp4
        ├── clip_approve_text.mp4
        ├── clip_rope_text.mp4
        ├── clip_skin_text.mp4
        ├── clip_end_text.mp4
        └── concat_list.txt
```

---

## 九、执行顺序总结

```
阶段 0: 环境准备
    ↓
阶段 1: 项目初始化 + STORYBOARD.md
    ↓
阶段 2: 素材收集 + BGM 获取 + 节拍分析
    ↓
阶段 3: 帧构建（10 帧并行）
    ↓
阶段 4: 音频处理
    ↓
阶段 5: 时长同步
    ↓
阶段 6: 合成装配
    ↓
阶段 7: 过渡效果
    ↓
阶段 8: 字幕验证
    ↓
阶段 9: 全面验证（lint + check + snapshot）
    ↓
阶段 10: 渲染 B 站版 + 封面
    ↓
阶段 11: 抖音精剪版
    ↓
✅ 交付
```

每阶段完成后必须通过验证门禁才能进入下一阶段。验证失败时，按错误恢复速查表定位并修复。

---

*本文档由 grilling 流程产出，与用户确认后生成。*