/**
 * charm-tray-model.js — 托盘菜单模板（纯数据，无 electron 依赖，可单测）
 *
 * 菜单结构与原生右键上下文菜单（main/index.js 'show-context-menu'）对齐：
 * 点击宠物的每一条菜单项，在托盘里都有一个不依赖鼠标点击宠物的镜像。
 * 挂饰模式全程 click-through 后，这里是设置/切皮/订阅/退出的保底入口。
 */

export const CHARM_TRAY_ITEM_IDS = [
  'toggle-visibility',
  'refresh',
  'open-settings',
  'open-skin-selector',
  'open-subscription',
  'open-onboarding',
  'open-custom-mode',
  'quit',
];

export function buildCharmTrayTemplate({ isVisible = true, creatorAccess = false } = {}) {
  return [
    { id: 'toggle-visibility', label: isVisible ? '隐藏挂饰' : '显示挂饰' },
    { type: 'separator' },
    { id: 'refresh', label: '刷新' },
    { id: 'open-settings', label: '设置' },
    { id: 'open-skin-selector', label: '切换皮肤' },
    { type: 'separator' },
    { id: 'open-subscription', label: '版本与订阅' },
    { id: 'open-onboarding', label: '帮助与新手指引' },
    ...(creatorAccess ? [{ id: 'open-custom-mode', label: '自定义模式' }] : []),
    { type: 'separator' },
    { id: 'quit', label: '退出' },
  ];
}
