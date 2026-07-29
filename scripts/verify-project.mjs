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

const iconHeader = exists('build/icon.ico') ? fs.readFileSync(path.join(root, 'build/icon.ico')).subarray(0, 4) : Buffer.alloc(0);
if (!iconHeader.equals(Buffer.from([0, 0, 1, 0]))) fail('build/icon.ico is not a valid ICO resource');
const pngHeader = exists('assets/icon.png') ? fs.readFileSync(path.join(root, 'assets/icon.png')).subarray(0, 8) : Buffer.alloc(0);
if (!pngHeader.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail('assets/icon.png is not a valid PNG resource');

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

const ignoredDirectories = new Set(['.git', '.vite', 'node_modules', 'out']);
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
