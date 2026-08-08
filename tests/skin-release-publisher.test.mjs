import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReleaseSql, releaseKeys } from '../tools/skin-publisher/lib/skin-release-publisher.js';

const manifest = {
  id: 'official_turtle', version: '1.2.3', displayName: "Official Turtle's Day",
  author: 'Turtle Monitor', description: 'A release', releaseNotes: 'First release', minAppVersion: '1.0.0',
};

test('skin release keys stay version-scoped and use the configured package layout', () => {
  assert.deepEqual(releaseKeys(manifest), {
    manifestKey: 'skins/official_turtle/1.2.3/manifest.json',
    previewKey: 'skins/official_turtle/1.2.3/preview.png',
    packageKey: 'skins/official_turtle/1.2.3/official_turtle-1.2.3.skinpack',
  });
});

test('skin release SQL publishes idempotently and escapes metadata', () => {
  const sql = buildReleaseSql({
    manifest, keys: releaseKeys(manifest), packageSha256: 'a'.repeat(64), packageBytes: 123,
    now: '2026-08-08T00:00:00.000Z',
  });
  assert.match(sql, /INSERT INTO skin_releases/);
  assert.match(sql, /ON CONFLICT\(skin_id, version\) DO UPDATE/);
  assert.match(sql, /Official Turtle''s Day/);
  assert.match(sql, /status='published'/);
});
