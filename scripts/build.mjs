/**
 * Build script for Turtle Monitor
 * 
 * Runs Vite builds for main, preload, and renderer,
 * then copies additional assets (fonts, custom mode files).
 * 
 * Usage:
 *   node scripts/build.mjs               # free edition (default)
 *   VITE_EDITION=sponsor node scripts/build.mjs    # sponsor edition
 */

import { build } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const edition = process.env.VITE_EDITION || 'free';
console.log(`[Build] Edition: ${edition}`);

async function run() {
  // 1. Build main process
  console.log('[Build] Building main process...');
  await build({
    configFile: path.join(root, 'vite.main.config.js'),
    build: {
      outDir: path.join(root, '.vite', 'build'),
      ssr: path.join(root, 'src', 'main', 'index.js'),
      emptyOutDir: true,
    },
  });

  // 2. Build preload
  console.log('[Build] Building preload...');
  await build({
    configFile: path.join(root, 'vite.preload.config.js'),
    build: {
      outDir: path.join(root, '.vite', 'build'),
      ssr: path.join(root, 'src', 'main', 'preload.js'),
      emptyOutDir: false, // don't clear main output
    },
  });

  // 3. Build renderer
  console.log('[Build] Building renderer...');
  await build({
    configFile: path.join(root, 'vite.renderer.config.js'),
  });

  // 4. Copy font files to renderer output
  const fontSrc = path.join(root, 'public', 'assets', 'fonts');
  const fontDest = path.join(root, '.vite', 'renderer', 'main_window', 'assets', 'fonts');
  if (fs.existsSync(fontSrc)) {
    fs.cpSync(fontSrc, fontDest, { recursive: true });
    console.log('[Build] Copied fonts to', fontDest);
  }

  // 5. Sponsor edition: copy custom mode files
  if (edition === 'sponsor') {
    const customDir = path.join(root, 'src', 'custom');
    const customDest = path.join(root, '.vite', 'build', 'src', 'custom');
    if (fs.existsSync(customDir)) {
      fs.cpSync(customDir, customDest, { recursive: true });
      console.log('[Build] Copied custom mode to', customDest);
    }
  }

  console.log(`[Build] ✅ ${edition} edition build complete`);
}

run().catch(err => {
  console.error('[Build] Failed:', err);
  process.exit(1);
});