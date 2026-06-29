import { build } from 'vite';
import path from 'path';
import fs from 'fs';

process.env.VITE_EDITION = 'sponsor';

const projectDir = '/mnt/d/all/lightframe/new_monitor';

// Clear old build
const buildDir = path.join(projectDir, '.vite', 'build');
if (fs.existsSync(buildDir)) {
  fs.rmSync(buildDir, { recursive: true, force: true });
  console.log('cleared build cache');
}

// Build main process
await build({
  configFile: path.join(projectDir, 'vite.main.config.js'),
  root: projectDir,
  build: {
    outDir: '.vite/build',
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(projectDir, 'src/main/index.js'),
    },
    minify: true,
  },
});

const size = fs.statSync(path.join(projectDir, '.vite/build/index.js')).size;
console.log(`Done. Size: ${size} bytes`);

// Check for sponsor code
const content = fs.readFileSync(path.join(projectDir, '.vite/build/index.js'), 'utf-8');
const sponsorChecks = ['自定义模式', '像素画布', '标记区域', 'SkinImport', 'skin-save', 'canvas-fullscreen'];
const found = sponsorChecks.filter(c => content.includes(c));
console.log(`Sponsor code present: ${found.length > 0 ? found.join(', ') : 'NONE'}`);
