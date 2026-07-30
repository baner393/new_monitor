import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const fail = (message) => failures.push(message);
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

const required = [
  'build/icon.ico',
  'assets/icon.png',
  'assets/uninstaller-icon.ico',
  'public/assets/fonts/Mojang-Regular.ttf',
  'public/assets/fonts/unifont-15.1.04.otf',
  'public/assets/skins/skins.json',
  'src/custom/index.html',
  'src/custom/preload.js',
  'src/renderer/dashboard-panel.js',
  'src/renderer/dashboard-model.js',
  'src/renderer/monitor-visuals.js',
  'src/shared/monitor-panel-config.js',
  'src/shared/monitor-config-draft.js',
  'native/HardwareSensorHost/HardwareSensorHost.csproj',
  'native/HardwareSensorHost/Program.cs',
  'resources/hardware-sensor/HardwareSensorHost.exe',
  'resources/hardware-sensor/LibreHardwareMonitorLib.dll',
  'resources/hardware-sensor/LICENSE.txt',
  'resources/hardware-sensor/THIRD-PARTY-LICENSES.txt',
  'resources/hardware-sensor/manifest.json',
];
for (const file of required) if (!exists(file)) fail(`Missing required file: ${file}`);

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const section of ['dependencies', 'devDependencies']) {
  for (const [name, version] of Object.entries(packageJson[section] || {})) {
    if (/^[~^*]|\bx\b/i.test(version)) fail(`${section}.${name} is not pinned: ${version}`);
  }
}
for (const script of ['start:free', 'start:sponsor', 'dist:free', 'dist:sponsor', 'verify:artifacts']) {
  if (!packageJson.scripts?.[script]) fail(`Missing npm script: ${script}`);
}
if (!packageJson.scripts?.['build:sensor-host']) fail('Missing npm script: build:sensor-host');

const iconHeader = exists('build/icon.ico') ? fs.readFileSync(path.join(root, 'build/icon.ico')).subarray(0, 4) : Buffer.alloc(0);
if (!iconHeader.equals(Buffer.from([0, 0, 1, 0]))) fail('build/icon.ico is not a valid ICO resource');
const pngHeader = exists('assets/icon.png') ? fs.readFileSync(path.join(root, 'assets/icon.png')).subarray(0, 8) : Buffer.alloc(0);
if (!pngHeader.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail('assets/icon.png is not a valid PNG resource');

const sensorHostHeader = exists('resources/hardware-sensor/HardwareSensorHost.exe')
  ? fs.readFileSync(path.join(root, 'resources/hardware-sensor/HardwareSensorHost.exe')).subarray(0, 2)
  : Buffer.alloc(0);
if (!sensorHostHeader.equals(Buffer.from('MZ'))) fail('HardwareSensorHost.exe is not a valid Windows executable');

if (exists('resources/hardware-sensor/manifest.json')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'resources/hardware-sensor/manifest.json'), 'utf8'));
  if (manifest.library !== 'LibreHardwareMonitorLib 0.9.6') fail(`Unexpected sensor library: ${manifest.library}`);
  for (const entry of manifest.files || []) {
    const file = path.join(root, 'resources', 'hardware-sensor', path.basename(entry.file));
    if (!fs.existsSync(file)) {
      fail(`Sensor host manifest file is missing: ${entry.file}`);
      continue;
    }
    const content = fs.readFileSync(file);
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    if (content.length !== entry.bytes || digest !== entry.sha256) {
      fail(`Sensor host manifest mismatch: ${entry.file}`);
    }
  }
}

if (!fs.readFileSync(path.join(root, 'electron-builder.config.js'), 'utf8').includes("from: 'resources/hardware-sensor'")) {
  fail('Electron Builder does not copy the hardware sensor host to extraResources');
}

if (exists('public/assets/skins/skins.json')) {
  const skinConfig = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/skins/skins.json'), 'utf8'));
  const ids = new Set();
  for (const skin of skinConfig.skins || []) {
    if (!skin.id || ids.has(skin.id)) fail(`Invalid or duplicate skin id: ${skin.id}`);
    ids.add(skin.id);
    for (const [state, assetPath] of Object.entries(skin.frames || {})) {
      const target = path.join(root, 'public', assetPath);
      if (!fs.existsSync(target)) fail(`Skin ${skin.id}/${state} points to missing file: ${assetPath}`);
    }
    if (skin.preview && !fs.existsSync(path.join(root, 'public', skin.preview))) {
      fail(`Skin ${skin.id} preview is missing: ${skin.preview}`);
    }
  }
  if (!ids.has(skinConfig.defaultSkin)) fail(`Default skin does not exist: ${skinConfig.defaultSkin}`);
}

const ignoredDirectories = new Set(['.git', '.vite', 'bin', 'node_modules', 'obj', 'out']);
const textExtensions = new Set(['.bat', '.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.txt']);
function walk(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(fullPath));
    else result.push(fullPath);
  }
  return result;
}

for (const file of walk(root)) {
  if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
  const content = fs.readFileSync(file, 'utf8');
  if (/[A-Z]:\\(?:Users|all|projects?|workspace)\\/i.test(content)) {
    fail(`Machine-specific absolute path in ${path.relative(root, file)}`);
  }
}

for (const obsolete of ['src/renderer/dist', 'build-edition.mjs', 'scripts/set-icon-helper.js']) {
  if (exists(obsolete)) fail(`Obsolete build artifact/tool is still present: ${obsolete}`);
}

try {
  if (exists('.git')) {
    const remote = execFileSync('git', [
      '-c', `safe.directory=${root.replace(/\\/g, '/')}`,
      'remote', 'get-url', 'origin',
    ], { cwd: root, encoding: 'utf8' }).trim();
    if (remote !== 'https://baner393@github.com/baner393/new_monitor.git') {
      fail(`Unexpected origin URL: ${remote}`);
    }
  }
} catch (error) {
  fail(`Could not verify Git origin: ${error.message}`);
}

if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join('\n'));
  process.exit(1);
}

const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'build/icon.ico'))).digest('hex');
console.log(`[Verify] Project checks passed; icon SHA256 ${digest}`);
