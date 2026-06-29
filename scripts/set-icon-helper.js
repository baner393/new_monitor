/**
 * Icon helper script: runs rcedit.exe to set the turtle icon on the built exe.
 * Called after electron-builder completes packaging.
 * Usage: node scripts/set-icon-helper.js <edition>
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const edition = process.argv[2] || 'free';
console.log(`[IconHelper] Setting icon for ${edition} edition...`);

const root = path.resolve(__dirname);
const exePath = path.join(root, '..', 'out', 'win-unpacked', 'Turtle Monitor.exe');
const icoPath = path.join(root, '..', 'icon.ico');

if (!fs.existsSync(exePath)) {
  console.error(`[IconHelper] EXE not found: ${exePath}`);
  process.exit(1);
}

const rcedit = path.join(root, '..', 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');

try {
  // Step 1: Set icon on the win-unpacked exe
  const cmd = `"${rcedit}" "${exePath}" --set-icon "${icoPath}"`;
  console.log(`[IconHelper] Running: rcedit --set-icon`);
  execSync(cmd, { stdio: 'pipe', timeout: 30000 });
  console.log(`[IconHelper] ✅ Icon set on Turtle Monitor.exe`);
  
  // Step 2: Rebuild NSIS installer from the patched win-unpacked
  console.log(`[IconHelper] Rebuilding NSIS installer with patched icon...`);
  const configPath = path.join(root, '..', 'electron-builder.config.js');
  const rebuildCmd = `npx electron-builder build --win --x64 --prepackaged "${path.join(root, '..', 'out', 'win-unpacked')}" --config "${configPath}"`;
  execSync(rebuildCmd, { stdio: 'inherit', timeout: 300000, cwd: path.join(root, '..') });
  console.log(`[IconHelper] ✅ NSIS installer rebuilt with turtle icon`);
} catch (err) {
  console.error(`[IconHelper] ❌ Failed: ${err.message}`);
  process.exit(1);
}