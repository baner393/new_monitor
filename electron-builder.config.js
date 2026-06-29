const edition = process.env.VITE_EDITION || 'free';

/**
 * @type {import('electron-builder').Configuration}
 */
const config = {
  appId: 'com.turtlemonitor.app',
  productName: 'Turtle Monitor',
  copyright: 'Copyright © 2025 Turtle Monitor',

  directories: {
    output: 'out',
    buildResources: 'assets',
  },

  // Free: 排除 src/（不含自定义模式代码）
  // Sponsor: 包含 src/custom/（自定义模式）
  files: edition === 'sponsor'
    ? ['.vite/**/*', '!node_modules/**/*', 'src/custom/**/*']
    : ['.vite/**/*', '!node_modules/**/*', '!src/**/*'],

  win: {
    icon: 'assets/icon.png',
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
  },

  nsis: {
    oneClick: false,
    allowToDir: true,
    perMachine: false,
    installerIcon: 'assets/icon.ico',
    uninstallerIcon: 'assets/icon.ico',
    installerHeaderIcon: 'assets/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Turtle Monitor',
    artifactName: 'TurtleMonitor_' + edition + '_Setup.${ext}',
  },
};

module.exports = config;