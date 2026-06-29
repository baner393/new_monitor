#!/usr/bin/env node
/**
 * Build script — sets VITE_EDITION and invokes Electron Forge package
 * Usage: node build-edition.mjs <free|sponsor>
 */
import { execSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const edition = process.argv[2] || 'free';

// Ensure valid edition
if (!['free', 'sponsor'].includes(edition)) {
  console.error(`Usage: node build-edition.mjs <free|sponsor>`);
  process.exit(1);
}

console.log(`[Build] Building ${edition} edition...`);
process.env.VITE_EDITION = edition;

// Run forge package — capture env properly
try {
  const output = execSync('npx electron-forge package', {
    cwd: __dirname,
    env: { ...process.env, VITE_EDITION: edition },
    stdio: 'inherit',
    timeout: 180000,
  });
  console.log(`[Build] ${edition} edition package complete`);
} catch (err) {
  // forge may still succeed despite exit code 1
  console.log(`[Build] Forge exit: ${err.status}`);
}

// Check output
const outDir = join(__dirname, 'out', 'turtle-monitor-win32-x64');
if (existsSync(outDir)) {
  const editionFile = join(outDir, 'EDITION.txt');
  const editionContent = existsSync(editionFile)
    ? require('fs').readFileSync(editionFile, 'utf-8').trim()
    : 'NOT FOUND';
  console.log(`[Build] EDITION.txt: ${editionContent}`);

  // Verify built code
  const buildJs = join(outDir, 'resources', 'app', '.vite', 'build', 'index.js');
  if (existsSync(buildJs)) {
    const content = require('fs').readFileSync(buildJs, 'utf-8');
    const sponsorKeywords = ['自定义模式', '像素画布', '标记区域', 'SkinImport', 'skin-save', 'canvas-fullscreen'];
    const found = sponsorKeywords.filter(k => content.includes(k));
    console.log(`[Build] Sponsor code found: ${found.length > 0 ? found.join(', ') : 'NONE'}`);
    console.log(`[Build] Bundle size: ${(require('fs').statSync(buildJs).size / 1024).toFixed(1)} KB`);
  }
}
