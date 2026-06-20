const { VitePlugin } = require('@electron-forge/plugin-vite');

module.exports = {
  packagerConfig: {
    name: 'turtle-monitor',
    executableName: 'turtle-monitor',
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'turtle-monitor',
      },
    },
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.js',
          config: 'vite.main.config.js',
        },
        {
          entry: 'src/main/preload.js',
          config: 'vite.preload.config.js',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.js',
        },
      ],
    }),
  ],
};
