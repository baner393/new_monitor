const { VitePlugin } = require('@electron-forge/plugin-vite');
const path = require('path');
const fs = require('fs');

// Edition-aware naming: output directories won't clash
const edition = process.env.VITE_EDITION || 'free';
const appName = edition === 'sponsor' ? 'turtle-monitor-sponsor' : 'turtle-monitor-free';
const setupExe = edition === 'sponsor' ? 'TurtleMonitor_Setup.exe' : 'TurtleMonitor_Free_Setup.exe';

module.exports = {
  packagerConfig: {
    name: appName,
    executableName: 'turtle-monitor',
    icon: './assets/icon',
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: appName,
        setupExe: setupExe,
        setupIcon: path.join(__dirname, 'assets', 'icon.ico'),
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
  hooks: {
    postPackage: async (forgeConfig, opts) => {
      // Read edition from env or .build-edition marker file
      const markerPath = path.join(__dirname, '.build-edition');
      const edition = process.env.VITE_EDITION
        || (require('fs').existsSync(markerPath) ? require('fs').readFileSync(markerPath, 'utf-8').trim() : 'free');
      const appDir = path.join(opts.outputPaths[0], 'resources', 'app');
      const appRoot = opts.outputPaths[0];

      // Copy fonts — both editions need them
      const fontDir = path.join(__dirname, 'public', 'assets', 'fonts');
      if (fs.existsSync(fontDir)) {
        const fontDest = path.join(appDir, 'assets', 'fonts');
        fs.cpSync(fontDir, fontDest, { recursive: true });
        console.log('[postPackage] Copied assets/fonts/ to', fontDest);
      }

      if (edition === 'free') {
        // Free edition: remove custom mode artifacts completely
        const customDest = path.join(appDir, 'src', 'custom');
        if (fs.existsSync(customDest)) {
          fs.rmSync(customDest, { recursive: true, force: true });
          console.log('[postPackage] Free edition — removed src/custom/');
        }
        // Write edition marker
        fs.writeFileSync(path.join(appRoot, 'EDITION.txt'), 'free');
        console.log('[postPackage] Free edition package complete');
      } else {
        // Sponsor edition: copy custom mode files
        const customDir = path.join(__dirname, 'src', 'custom');
        if (fs.existsSync(customDir)) {
          const customDest = path.join(appDir, 'src', 'custom');
          fs.cpSync(customDir, customDest, { recursive: true });
          console.log('[postPackage] Copied src/custom/ to', customDest);
        }
        // Write edition marker
        fs.writeFileSync(path.join(appRoot, 'EDITION.txt'), 'sponsor');
        console.log('[postPackage] Sponsor edition package complete');
      }
    },
  },
};
