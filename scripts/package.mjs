import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edition = process.argv[2];
if (!['free', 'sponsor'].includes(edition)) {
  throw new Error('Usage: node scripts/package.mjs <free|sponsor>');
}

// Default to the npmmirror CDN for Electron + electron-builder binaries so
// `npm run dist` works out of the box in networks where github.com is flaky.
// Users can override either by exporting the env vars before running.
process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
process.env.ELECTRON_BUILDER_BINARIES_MIRROR = process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/';

function runNode(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      env: { ...process.env, VITE_EDITION: edition },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(script)} exited with ${signal || code}`));
    });
  });
}

const editionOutput = path.join(root, 'out', edition);
fs.rmSync(editionOutput, { recursive: true, force: true });
await runNode(path.join(root, 'scripts', 'verify-project.mjs'));
await runNode(path.join(root, 'scripts', 'build.mjs'));

const builderCli = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
if (!fs.existsSync(builderCli)) {
  throw new Error('electron-builder is not installed; run npm ci first');
}
await runNode(builderCli, ['--win', '--x64', '--config', 'electron-builder.config.js']);
console.log(`[Package] ${edition} installer complete`);
