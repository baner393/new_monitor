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
  const sensorRoot = path.join(unpacked, 'resources', 'hardware-sensor');

  for (const required of [executable, installer, asarPath]) {
    if (!fs.existsSync(required) || fs.statSync(required).size === 0) fail(`${edition}: missing artifact ${path.relative(root, required)}`);
  }
  if (!fs.existsSync(asarPath)) continue;

  const sensorManifestPath = path.join(sensorRoot, 'manifest.json');
  if (!fs.existsSync(sensorManifestPath)) {
    fail(`${edition}: hardware sensor manifest is missing outside ASAR`);
  } else {
    const sensorManifest = JSON.parse(fs.readFileSync(sensorManifestPath, 'utf8'));
    for (const entry of sensorManifest.files || []) {
      const target = path.join(sensorRoot, path.basename(entry.file));
      if (!fs.existsSync(target)) {
        fail(`${edition}: hardware sensor file is missing: ${entry.file}`);
        continue;
      }
      const content = fs.readFileSync(target);
      const digest = crypto.createHash('sha256').update(content).digest('hex');
      if (content.length !== entry.bytes || digest !== entry.sha256) {
        fail(`${edition}: hardware sensor file changed: ${entry.file}`);
      }
    }
  }

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
