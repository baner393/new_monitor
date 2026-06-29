const edition = process.env.VITE_EDITION || 'free';
const path = require('path');
const __root = __dirname;

/**
 * @type {import('electron-builder').Configuration}
 */
const config = {
  appId: 'com.turtlemonitor.app',
  productName: 'Turtle Monitor',
  copyright: 'Copyright © 2025 Turtle Monitor',

  directories: {
    output: 'out',
  },

  // Free: 排除 src/（不含自定义模式代码）
  // Sponsor: 包含 .vite/build/src/custom/（由 build.mjs 复制）
  files: edition === 'sponsor'
    ? ['.vite/**/*', '!node_modules/**/*', 'assets/*.png', 'assets/*.ico']
    : ['.vite/**/*', '!node_modules/**/*', '!src/**/*', 'assets/*.png', 'assets/*.ico'],

  win: {
    icon: path.join(__root, 'icon.ico'),
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    sign: false,
    signAndEditExecutable: false,
    certificateFile: null,
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    installerIcon: path.join(__root, 'assets', 'icon.ico'),
    uninstallerIcon: path.join(__root, 'assets', 'uninstaller-icon.ico'),
    installerHeaderIcon: path.join(__root, 'assets', 'icon.ico'),
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Turtle Monitor',
    artifactName: 'TurtleMonitor_' + edition + '_Setup.${ext}',
  },
};

module.exports = config;