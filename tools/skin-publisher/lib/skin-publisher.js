import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

export const REQUIRED_SKIN_FRAMES = Object.freeze(['idle']);
const IMAGE_EXTENSION = '.png';

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function safeSkinId(value) {
  const skinId = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(skinId) ? skinId : '';
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function relativeFramePath(skinId, fileName) {
  return `assets/skins/${skinId}/${fileName}`;
}

export function inspectSkinSource({ sourceDir, skinId }) {
  const normalizedId = safeSkinId(skinId);
  const errors = [];
  if (!normalizedId) errors.push('皮肤 ID 只能包含字母、数字、下划线或连字符，长度不超过 64。');
  if (!sourceDir || !fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    errors.push('请选择存在的皮肤文件夹。');
  }
  if (errors.length) return { valid: false, skinId: normalizedId, errors, frames: {}, files: [] };

  const files = fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === IMAGE_EXTENSION)
    .map((entry) => entry.name)
    .sort();
  const frames = {};
  for (const fileName of files) {
    const frameName = path.basename(fileName, IMAGE_EXTENSION);
    if (/^[A-Za-z0-9_-]+$/.test(frameName)) frames[frameName] = fileName;
  }
  for (const frame of REQUIRED_SKIN_FRAMES) {
    if (!frames[frame]) errors.push(`缺少必需状态帧：${frame}.png`);
  }
  return { valid: errors.length === 0, skinId: normalizedId, errors, frames, files };
}

export function buildSkinManifest({ sourceDir, skinId, displayName, author = '', description = '', version, minAppVersion = '1.0.0', releaseNotes = '' }) {
  const inspection = inspectSkinSource({ sourceDir, skinId });
  if (!inspection.valid) throw new Error(inspection.errors.join(' '));
  const normalizedVersion = String(version || '').trim();
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(normalizedVersion)) {
    throw new Error('版本号应为 1.0.0 形式。');
  }
  const files = inspection.files.map((fileName) => ({
    path: fileName,
    sha256: sha256(path.join(sourceDir, fileName)),
    bytes: fs.statSync(path.join(sourceDir, fileName)).size,
  }));
  return {
    schemaVersion: 1,
    id: inspection.skinId,
    displayName: String(displayName || inspection.skinId).trim() || inspection.skinId,
    author: String(author || '').trim(),
    description: String(description || '').trim(),
    version: normalizedVersion,
    minAppVersion: String(minAppVersion || '1.0.0').trim(),
    releaseNotes: String(releaseNotes || '').trim(),
    frames: inspection.frames,
    preview: inspection.frames.idle,
    files,
  };
}

export function writeBuiltInSkin({ sourceDir, skinsBasePath, metadata }) {
  const manifest = buildSkinManifest({ sourceDir, ...metadata });
  const targetDir = path.join(skinsBasePath, manifest.id);
  const skinsJsonPath = path.join(skinsBasePath, 'skins.json');
  const config = readJson(skinsJsonPath, { skins: [], defaultSkin: 'turtle' });
  const entry = {
    id: manifest.id,
    name: manifest.id,
    displayName: manifest.displayName,
    author: manifest.author,
    description: manifest.description,
    frames: Object.fromEntries(Object.entries(manifest.frames).map(([frame, fileName]) => [frame, relativeFramePath(manifest.id, fileName)])),
    preview: relativeFramePath(manifest.id, manifest.preview),
    scale: Number(metadata.scale) || 1,
    baseSize: Number(metadata.baseSize) || 48,
  };
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of manifest.files) fs.copyFileSync(path.join(sourceDir, file.path), path.join(targetDir, file.path));
  const index = (config.skins || []).findIndex((skin) => skin.id === manifest.id);
  if (index >= 0) config.skins[index] = entry;
  else config.skins = [...(config.skins || []), entry];
  fs.writeFileSync(skinsJsonPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { manifest, targetDir, skinsJsonPath, replaced: index >= 0 };
}

export function prepareOnlineSkinRelease({ sourceDir, outputDir, metadata }) {
  const manifest = buildSkinManifest({ sourceDir, ...metadata });
  const releaseDir = path.join(outputDir, manifest.id, manifest.version);
  fs.rmSync(releaseDir, { recursive: true, force: true });
  fs.mkdirSync(releaseDir, { recursive: true });
  for (const file of manifest.files) fs.copyFileSync(path.join(sourceDir, file.path), path.join(releaseDir, file.path));
  fs.writeFileSync(path.join(releaseDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const skinpack = zlib.gzipSync(Buffer.from(JSON.stringify({ schemaVersion: 1, manifest, files: Object.fromEntries(manifest.files.map((file) => [file.path, fs.readFileSync(path.join(sourceDir, file.path)).toString('base64')])) }), 'utf8'));
  const packagePath = path.join(releaseDir, `${manifest.id}-${manifest.version}.skinpack`);
  fs.writeFileSync(packagePath, skinpack);
  return { manifest, releaseDir, packagePath, packageSha256: sha256(packagePath), packageBytes: skinpack.length };
}
