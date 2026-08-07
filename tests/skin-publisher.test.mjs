import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';

import { inspectSkinSource, prepareOnlineSkinRelease, writeBuiltInSkin } from '../src/main/skin-publisher.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'turtle-skin-publisher-'));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'idle.png'), Buffer.from('idle'));
  fs.writeFileSync(path.join(source, 'happy.png'), Buffer.from('happy'));
  return { root, source };
}

test('skin publisher requires a safe id and idle frame', () => {
  const { source } = fixture();
  assert.equal(inspectSkinSource({ sourceDir: source, skinId: '../escape' }).valid, false);
  fs.unlinkSync(path.join(source, 'idle.png'));
  assert.match(inspectSkinSource({ sourceDir: source, skinId: 'demo' }).errors.join(' '), /idle/);
});

test('skin publisher writes built-in skin and prepares a versioned online release', () => {
  const { root, source } = fixture();
  const skins = path.join(root, 'skins');
  fs.mkdirSync(skins);
  fs.writeFileSync(path.join(skins, 'skins.json'), '{"skins":[],"defaultSkin":"turtle"}');
  const metadata = { skinId: 'demo', displayName: 'Demo', version: '1.2.3' };
  const written = writeBuiltInSkin({ sourceDir: source, skinsBasePath: skins, metadata });
  assert.equal(written.replaced, false);
  assert.equal(fs.existsSync(path.join(skins, 'demo', 'idle.png')), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(skins, 'skins.json'))).skins[0].id, 'demo');
  const released = prepareOnlineSkinRelease({ sourceDir: source, outputDir: path.join(root, 'releases'), metadata });
  assert.equal(released.manifest.version, '1.2.3');
  assert.equal(fs.existsSync(path.join(released.releaseDir, 'manifest.json')), true);
});
