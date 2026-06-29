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

  files: [
    '.vite/**/*',
    '!node_modules/**/*',
    '!src/**/*',
  ],

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