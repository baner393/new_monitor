import * as asar from '@electron/asar';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const fail = (message) => failures.push(message);

function listFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function packageEntrySet(asarPath) {
  return new Set(asar.listPackage(asarPath).map((entry) => entry.replace(/^[/\\]+/, '').replace(/\\/g, '/')));
}

function extractFile(asarPath, relativePath) {
  // @electron/asar expects host-native separators when reading on Windows.
  return asar.extractFile(asarPath, relativePath.split('/').join(path.sep));
}

for (const edition of ['free', 'sponsor']) {
  const isSponsor = edition === 'sponsor';
  const output = path.join(root, 'out', edition);
  const unpacked = path.join(output, 'win-unpacked');
  const executable = path.join(unpacked, isSponsor ? 'TurtleMonitorSponsor.exe' : 'TurtleMonitorFree.exe');
  const installer = path.join(output, isSponsor ? 'TurtleMonitor-Sponsor-Setup.exe' : 'TurtleMonitor-Free-Setup.exe');
  const asarPath = path.join(unpacked, 'resources', 'app.asar');

  for (const required of [executable, installer, asarPath]) {
    if (!fs.existsSync(required) || fs.statSync(required).size === 0) fail(`${edition}: missing artifact ${path.relative(root, required)}`);
  }
  if (!fs.existsSync(asarPath)) continue;

  const entries = packageEntrySet(asarPath);
  for (const required of [
    '.vite/build/index.js',
    '.vite/build/preload.js',
    '.vite/build/edition.json',
    '.vite/renderer/main_window/index.html',
    'assets/icon.png',
  ]) {
    if (!entries.has(required)) fail(`${edition}: ASAR is missing ${required}`);
  }

  const marker = JSON.parse(extractFile(asarPath, '.vite/build/edition.json').toString('utf8'));
  if (marker.edition !== edition) fail(`${edition}: edition marker says ${marker.edition}`);

  const customPrefix = '.vite/build/src/custom/';
  const containsCustomFiles = [...entries].some((entry) => entry.startsWith(customPrefix));
  if (containsCustomFiles !== isSponsor) fail(`${edition}: sponsor custom files boundary is wrong`);

  const mainBundle = extractFile(asarPath, '.vite/build/index.js').toString('utf8');
  const sponsorChannelPresent = mainBundle.includes('skin-import-copy');
  if (sponsorChannelPresent !== isSponsor) fail(`${edition}: sponsor IPC boundary is wrong`);

  const publicRoot = path.join(root, 'public');
  for (const source of listFiles(publicRoot)) {
    const relative = path.relative(publicRoot, source).replace(/\\/g, '/');
    const packagedPath = `.vite/renderer/main_window/${relative}`;
    if (!entries.has(packagedPath)) {
      fail(`${edition}: renderer asset missing from ASAR: ${relative}`);
      continue;
    }
    const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const packagedHash = crypto.createHash('sha256').update(extractFile(asarPath, packagedPath)).digest('hex');
    if (sourceHash !== packagedHash) fail(`${edition}: renderer asset changed in package: ${relative}`);
  }

  console.log(`[Verify] ${edition} ASAR boundary and renderer assets passed`);
}

if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join('\n'));
  process.exit(1);
}
console.log('[Verify] Both installers passed artifact verification');
