/**
 * ring-items.js — 环形菜单项定义（纯数据，无依赖，可单测）
 *
 * 顺序即扇区顺序，扇区 0 = 12 点。视觉规格源自 mockup（设计文档 §1.5），
 * 09-19 经用户要求新增第 9 项 agent「任务对话」：挂饰模式下点卡片/右键
 * 宠物的原入口不可达，任务对话需要圆盘直达。退出不在环里（持键误松手
 * 退出是硬伤，退出留在托盘与设置）。custom 仅 creator 可用（act 时由
 * 主进程 hasCreatorAccess 拒绝）。
 */

export const RING_ACTIONS = [
  { id: 'panel', label: '监控面板', iconKey: 'monitor' },
  { id: 'settings', label: '设置', iconKey: 'gear' },
  { id: 'skin', label: '切换皮肤', iconKey: 'palette' },
  { id: 'hide', label: '隐藏挂饰', iconKey: 'eyeOff' },
  { id: 'agent', label: '任务对话', iconKey: 'chat' },
  { id: 'sub', label: '版本与订阅', iconKey: 'tag' },
  { id: 'mode', label: '经典/挂饰', iconKey: 'toggle' },
  { id: 'help', label: '帮助与指南', iconKey: 'book' },
  { id: 'custom', label: '自定义模式', iconKey: 'brush', creatorOnly: true },
];
