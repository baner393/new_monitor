# Turtle Monitor - Electron 版

> 🐢 像素风乌龟 GPU 监控桌面宠物（Electron + PixiJS）

---

## 快速开始（给下一个 Agent）

```
1. 读 HANDOVER.md 了解完整背景和架构
2. 读 TECH_SPEC.md 了解技术细节
3. 读 MIGRATION_PLAN.md 了解执行步骤
4. 读 DECISIONS.md 了解决策理由
5. 从阶段 0 开始执行
```

## 项目结构

```
new_monitor/
├── HANDOVER.md          # 总交接文档（必读）
├── TECH_SPEC.md         # 技术规格（参数、代码片段）
├── MIGRATION_PLAN.md    # 分阶段迁移计划
├── DECISIONS.md         # 决策记录
└── README.md            # 本文件
```

## 技术栈

- **Electron** - 桌面应用框架
- **PixiJS v7** - 2D 渲染引擎
- **Vite** - 构建工具
- **nvidia-smi** - GPU 数据采集

## 核心特性

- ✅ 透明无边框窗口 + 置顶
- ✅ 像素风乌龟精灵 + 物理模拟（钟摆、绳子）
- ✅ 左键拖拽 + 弹簧回弹 + 面板展开
- ✅ 右键拖拽 + 滑轮惯性
- ✅ GPU 实时监控面板
- ✅ MC 风格设置面板
- ✅ 基础音效

## 旧项目参考

- 代码：`D:\all\lightframe\Monitor\turtle_monitor\main.py`（~2000 行）
- 精灵：`D:\all\lightframe\Monitor\turtle_monitor\sprite_data.py`
- 字体：`C:\Users\ban\AppData\Local\Microsoft\Windows\Fonts\Mojang-Regular.ttf`
