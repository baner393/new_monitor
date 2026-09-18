/**
 * charm-tray.js — 系统托盘：挂饰模式全程穿透后的非点击保底入口。
 *
 * 模板数据来自 shared/charm-tray-model.js（纯函数，测试锁定结构），
 * 本模块只负责把 id 映射到处理器并维护 Tray 生命周期。
 * mainWindow 可能被 recreateMainWindow 重建，所有处理器都动态读全局
 * mainWindow，绝不缓存 webContents 引用。
 */
import { Menu, Tray } from 'electron';
import { buildCharmTrayTemplate } from '../shared/charm-tray-model.js';

export function createCharmTray({
  iconPath,
  tooltip = 'Turtle Monitor',
  handlers,
  isVisible,
  isCreatorAccess,
}) {
  const tray = new Tray(iconPath);
  tray.setToolTip(tooltip);

  const rebuild = () => {
    const template = buildCharmTrayTemplate({
      isVisible: isVisible ? isVisible() : true,
      creatorAccess: isCreatorAccess ? isCreatorAccess() : false,
    }).map((item) => {
      if (item.type === 'separator') return item;
      return {
        ...item,
        click: () => {
          if (typeof handlers === 'function') handlers(item.id);
          else handlers?.[item.id]?.();
        },
      };
    });
    tray.setContextMenu(Menu.buildFromTemplate(template));
  };

  rebuild();
  return { tray, rebuild };
}
