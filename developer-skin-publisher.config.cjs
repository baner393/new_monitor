const path = require('path');
module.exports = {
  appId: 'com.turtlemonitor.skinpublisher', productName: 'Turtle Monitor Skin Publisher', executableName: 'TurtleMonitorSkinPublisher', asar: true,
  directories: { output: path.join('out', 'skin-publisher'), buildResources: 'build' }, files: ['tools/skin-publisher/**/*', 'package.json'], extraMetadata: { main: 'tools/skin-publisher/main.mjs' },
  win: { icon: path.join(__dirname, 'build', 'icon.ico'), target: [{ target: 'portable', arch: ['x64'] }] }, artifactName: 'TurtleMonitor-SkinPublisher.${ext}',
};
