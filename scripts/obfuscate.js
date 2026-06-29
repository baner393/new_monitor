const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// 项目根目录 (scripts/ 的父目录)
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'obfuscator.config.js');

const TARGET_DIRS = [
  '.vite/build',
  '.vite/renderer/main_window',
];

// 加载混淆配置
let obfuscatorConfig;
try {
  obfuscatorConfig = require(CONFIG_PATH);
} catch (err) {
  console.error(`[Obfuscate] Error: Cannot load config from ${CONFIG_PATH}:`, err.message);
  process.exit(1);
}

console.log('[Obfuscate] Starting...');

/**
 * 递归查找目录下所有 .js 文件，排除 node_modules 和 .map 文件
 */
function findJSFiles(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    // 跳过 node_modules
    if (entry.isDirectory() && entry.name === 'node_modules') continue;
    // 跳过 .map 文件
    if (entry.isFile() && entry.name.endsWith('.map')) continue;
    if (entry.isDirectory()) {
      results = results.concat(findJSFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

// 收集所有待混淆文件
let allFiles = [];
for (const relDir of TARGET_DIRS) {
  const absDir = path.join(ROOT, relDir);
  if (fs.existsSync(absDir)) {
    const files = findJSFiles(absDir);
    allFiles = allFiles.concat(files);
  } else {
    console.warn(`[Obfuscate] Warning: Directory not found: ${relDir}`);
  }
}

if (allFiles.length === 0) {
  console.log('[Obfuscate] No .js files found to obfuscate.');
  process.exit(0);
}

// 逐个混淆
let totalOriginalSize = 0;
let totalObfuscatedSize = 0;
let obfuscatedCount = 0;

for (const filePath of allFiles) {
  const originalCode = fs.readFileSync(filePath, 'utf-8');
  const originalSize = Buffer.byteLength(originalCode, 'utf-8');
  totalOriginalSize += originalSize;

  let obfuscatedCode;
  try {
    const result = JavaScriptObfuscator.obfuscate(originalCode, obfuscatorConfig);
    obfuscatedCode = result.getObfuscatedCode();
  } catch (err) {
    console.error(`[Obfuscate] Error obfuscating ${filePath}:`, err.message);
    continue;
  }

  fs.writeFileSync(filePath, obfuscatedCode, 'utf-8');
  const obfuscatedSize = Buffer.byteLength(obfuscatedCode, 'utf-8');
  totalObfuscatedSize += obfuscatedSize;

  const diff = obfuscatedSize - originalSize;
  const sign = diff >= 0 ? '+' : '';
  const relPath = path.relative(ROOT, filePath);
  console.log(
    `  ${relPath}  ${formatSize(originalSize)} → ${formatSize(obfuscatedSize)} (${sign}${formatSize(diff)})`
  );
  obfuscatedCount++;
}

console.log(
  `\n[Obfuscate] Done. Obfuscated ${obfuscatedCount} file(s). ` +
  `Total: ${formatSize(totalOriginalSize)} → ${formatSize(totalObfuscatedSize)} ` +
  `(${totalObfuscatedSize - totalOriginalSize >= 0 ? '+' : ''}${formatSize(totalObfuscatedSize - totalOriginalSize)})`
);

/**
 * 格式化字节数为可读字符串
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}