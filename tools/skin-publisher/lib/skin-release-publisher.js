import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const BUCKET = 'turtle-monitor-skins';
const DATABASE = 'license-monitor-db';

function sqlString(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function runWrangler(args, { cwd, runner = spawnSync } = {}) {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = runner(command, ['--no-install', 'wrangler', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(detail || `Wrangler exited with status ${result.status}`);
  }
  return String(result.stdout || '').trim();
}

export function releaseKeys(manifest) {
  const root = `skins/${manifest.id}/${manifest.version}`;
  return { manifestKey: `${root}/manifest.json`, previewKey: `${root}/preview.png`, packageKey: `${root}/${manifest.id}-${manifest.version}.skinpack` };
}

export function buildReleaseSql({ manifest, keys, packageSha256, packageBytes, now = new Date().toISOString() }) {
  return `INSERT INTO skin_releases
    (skin_id, version, display_name, author, description, release_notes, min_app_version, manifest_key, preview_key, package_key, package_sha256, package_bytes, status, published_at, created_at, updated_at)
    VALUES (${sqlString(manifest.id)}, ${sqlString(manifest.version)}, ${sqlString(manifest.displayName)}, ${sqlString(manifest.author)}, ${sqlString(manifest.description)}, ${sqlString(manifest.releaseNotes)}, ${sqlString(manifest.minAppVersion)}, ${sqlString(keys.manifestKey)}, ${sqlString(keys.previewKey)}, ${sqlString(keys.packageKey)}, ${sqlString(packageSha256)}, ${Number(packageBytes) || 0}, 'published', ${sqlString(now)}, ${sqlString(now)}, ${sqlString(now)})
    ON CONFLICT(skin_id, version) DO UPDATE SET
      display_name=excluded.display_name, author=excluded.author, description=excluded.description, release_notes=excluded.release_notes, min_app_version=excluded.min_app_version, manifest_key=excluded.manifest_key, preview_key=excluded.preview_key, package_key=excluded.package_key, package_sha256=excluded.package_sha256, package_bytes=excluded.package_bytes, status='published', published_at=excluded.published_at, updated_at=excluded.updated_at;`;
}

export function publishOnlineSkinRelease({ release, serviceDir, runner } = {}) {
  if (!release?.manifest || !release.packagePath) throw new Error('请先准备在线发布包。');
  if (!serviceDir || !fs.existsSync(path.join(serviceDir, 'wrangler.toml'))) throw new Error('找不到 subscription-service/wrangler.toml，请先完成 Wrangler 配置。');
  const manifest = release.manifest;
  const keys = releaseKeys(manifest);
  const previewPath = path.join(release.releaseDir, manifest.preview);
  if (!fs.existsSync(previewPath)) throw new Error(`缺少预览帧：${manifest.preview}`);
  const packageSha256 = release.packageSha256 || crypto.createHash('sha256').update(fs.readFileSync(release.packagePath)).digest('hex');
  const packageBytes = release.packageBytes || fs.statSync(release.packagePath).size;
  const put = (key, file, contentType) => runWrangler(['r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, '--remote', '--content-type', contentType], { cwd: serviceDir, runner });
  put(keys.manifestKey, path.join(release.releaseDir, 'manifest.json'), 'application/json');
  put(keys.previewKey, previewPath, 'image/png');
  put(keys.packageKey, release.packagePath, 'application/octet-stream');
  const sqlPath = path.join(os.tmpdir(), `turtle-monitor-skin-${manifest.id}-${manifest.version}.sql`);
  fs.writeFileSync(sqlPath, buildReleaseSql({ manifest, keys, packageSha256, packageBytes }), 'utf8');
  try {
    runWrangler(['d1', 'execute', DATABASE, '--remote', '--file', sqlPath], { cwd: serviceDir, runner });
  } finally {
    fs.rmSync(sqlPath, { force: true });
  }
  return { success: true, keys, packageSha256, packageBytes };
}
