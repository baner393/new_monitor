/**
 * ring-items.js — 环形菜单 8 项定义（纯数据，无依赖，可单测）
 *
 * 顺序即扇区顺序，扇区 0 = 12 点。视觉规格见 mockup（设计文档 §1.5）：
 * 像素 SVG 图标、退出不在环里（持键误松手退出是硬伤，退出留在托盘与设置）。
 * custom 仅 creator 可用（act 时由主进程 hasCreatorAccess 拒绝）。
 */

export const RING_ACTIONS = [
  { id: 'panel', label: '监控面板', iconKey: 'monitor' },
  { id: 'settings', label: '设置', iconKey: 'gear' },
  { id: 'skin', label: '切换皮肤', iconKey: 'palette' },
  { id: 'hide', label: '隐藏挂饰', iconKey: 'eyeOff' },
  { id: 'sub', label: '版本与订阅', iconKey: 'tag' },
  { id: 'mode', label: '经典/挂饰', iconKey: 'toggle' },
  { id: 'help', label: '帮助与指南', iconKey: 'book' },
  { id: 'custom', label: '自定义模式', iconKey: 'brush', creatorOnly: true },
];
