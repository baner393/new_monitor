const path = require('path');

const edition = process.env.VITE_EDITION || 'free';
if (!['free', 'sponsor'].includes(edition)) {
  throw new Error(`Invalid VITE_EDITION: ${edition}`);
}

const isSponsor = edition === 'sponsor';

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: isSponsor ? 'com.turtlemonitor.sponsor' : 'com.turtlemonitor.app',
  productName: isSponsor ? 'Turtle Monitor Sponsor' : 'Turtle Monitor',
  executableName: isSponsor ? 'TurtleMonitorSponsor' : 'TurtleMonitorFree',
  copyright: 'Copyright © 2025-2026 Turtle Monitor',
  asar: true,
  directories: {
    output: path.join('out', edition),
    buildResources: 'build',
  },
  files: [
    '.vite/**/*',
    'assets/icon.png',
    'package.json',
    // 键盘钩子（Ctrl+Alt+A）的 napi 原生包：vite external 后运行时 require。
    // .node 二进制由 electron-builder smartUnpack 自动落到 app.asar.unpacked；
    // 只带 win32-x64 prebuild（其余平台二进制占掉绝大部分体积）。
    'node_modules/uiohook-napi/dist/**/*',
    'node_modules/uiohook-napi/package.json',
    'node_modules/uiohook-napi/prebuilds/win32-x64/**/*',
    'node_modules/node-gyp-build/**/*',
  ],
  extraResources: [
    {
      from: 'src/main/codex-hooks.mjs',
      to: 'codex-hooks.mjs',
    },
    {
      from: 'resources/hardware-sensor',
      to: 'hardware-sensor',
      filter: ['**/*'],
    },
    {
      from: 'resources/subscription',
      to: 'subscription',
      filter: ['config.json'],
    },
  ],
  win: {
    icon: path.join(__dirname, 'build', 'icon.ico'),
    target: [{ target: 'nsis', arch: ['x64'] }],
    signAndEditExecutable: true,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    installerIcon: path.join(__dirname, 'build', 'icon.ico'),
    uninstallerIcon: path.join(__dirname, 'assets', 'uninstaller-icon.ico'),
    installerHeaderIcon: path.join(__dirname, 'build', 'icon.ico'),
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: isSponsor ? 'Turtle Monitor Sponsor' : 'Turtle Monitor',
    artifactName: isSponsor
      ? 'TurtleMonitor-Sponsor-Setup.${ext}'
      : 'TurtleMonitor-Free-Setup.${ext}',
  },
};
