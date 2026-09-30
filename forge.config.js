const { VitePlugin } = require('@electron-forge/plugin-vite');

module.exports = {
  // Forge is the development launcher only. Release packaging is handled by
  // electron-builder so there is one deterministic packaging path.
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/index.js', config: 'vite.main.config.js' },
        { entry: 'src/main/preload.js', config: 'vite.preload.config.js' },
      ],
      renderer: [
        { name: 'main_window', config: 'vite.renderer.config.js' },
      ],
    }),
  ],
};
