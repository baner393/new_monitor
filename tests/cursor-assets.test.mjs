import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { buildPunchedCursor, decodeCursorAsset, parseCursorAsset, serializeCursorAsset } from '../src/main/cursor-assets.js';
import { cursorMountGeometry, findDefaultCursorHole, normalizeCursorProfiles, punchCursorPixels, resizeCursorFrame, validateCursorHole } from '../src/shared/cursor-hole-model.js';

function cursor(width = 32) {
  const stride = Math.ceil(width / 32) * 4;
  const dib = Buffer.alloc(40 + width * width * 4 + stride * width);
  dib.writeUInt32LE(40); dib.writeInt32LE(width, 4); dib.writeInt32LE(width * 2, 8);
  dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14);
  for (let i = 40; i < 40 + width * width * 4; i += 4) dib.set([50, 80, 140, 255], i);
  return serializeCursorAsset({ format: 'cur', frames: [{ images: [{ width, height: width, hotspot: { x: 1, y: 2 }, bytes: dib }] }] });
}
function chunk(tag, data) {
  const header = Buffer.alloc(8); header.write(tag); header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, ...(data.length % 2 ? [Buffer.alloc(1)] : [])]);
}
function ani() {
  const header = Buffer.alloc(36); header.writeUInt32LE(36); header.writeUInt32LE(2, 4); header.writeUInt32LE(3, 8); header.writeUInt32LE(6, 28); header.writeUInt32LE(3, 32);
  const seq = Buffer.alloc(12); [1, 0, 1].forEach((v, i) => seq.writeUInt32LE(v, i * 4));
  const rate = Buffer.alloc(12); [3, 6, 9].forEach((v, i) => rate.writeUInt32LE(v, i * 4));
  const data = Buffer.concat([Buffer.from('ACON'), chunk('anih', header), chunk('rate', rate), chunk('seq ', seq), chunk('LIST', Buffer.concat([Buffer.from('fram'), chunk('icon', cursor()), chunk('icon', cursor(16))])), chunk('JUNK', Buffer.from('abc'))]);
  const riff = Buffer.alloc(8); riff.write('RIFF'); riff.writeUInt32LE(data.length, 4);
  return Buffer.concat([riff, data]);
}

test('CUR DIB decode preserves directory, size and hotspot on roundtrip', () => {
  const bytes = cursor();
  const asset = decodeCursorAsset(bytes);
  assert.deepEqual(asset.frames[0].images[0].hotspot, { x: 1, y: 2 });
  assert.deepEqual([...asset.frames[0].images[0].pixels.slice(0, 4)], [140, 80, 50, 255]);
  assert.deepEqual(serializeCursorAsset(asset), bytes);
});

test('ANI roundtrip preserves sequence, durations, hotspots and unknown chunks', () => {
  const bytes = ani(), asset = decodeCursorAsset(bytes);
  assert.deepEqual(asset.steps, [{ frameIndex: 1, durationMs: 50 }, { frameIndex: 0, durationMs: 100 }, { frameIndex: 1, durationMs: 150 }]);
  assert.deepEqual(serializeCursorAsset(asset), bytes);
  const profile = { u: 0.5, v: 0.5, radius: 0.1 };
  let calls = 0;
  const punched = buildPunchedCursor(asset, profile, { encodePng(frame) {
    calls++;
    assert.ok(frame.pixels.some((a, i) => i % 4 === 3 && a === 0));
    // Use a DIB container for this encoder stub; integration uses Electron PNG encoding.
    return parseCursorAsset(cursor(frame.width)).frames[0].images[0].bytes;
  } });
  assert.equal(calls, 2);
  assert.deepEqual(parseCursorAsset(punched).steps, asset.steps);
});

test('malformed cursor directories, RIFF bounds, timelines and compressed DIB are rejected', () => {
  assert.throws(() => parseCursorAsset(Buffer.alloc(2)));
  const cur = cursor(); cur.writeUInt32LE(0xffffffff, 18);
  assert.throws(() => parseCursorAsset(cur), /bounds/);
  const animation = ani(); animation.writeUInt32LE(0xffffffff, 16);
  assert.throws(() => parseCursorAsset(animation));
  const compressed = cursor(); compressed.writeUInt32LE(1, 22 + 16);
  assert.throws(() => decodeCursorAsset(compressed), /unsupported DIB/);
});

test('hole requires common opaque area across every frame and protects hotspot', () => {
  const images = decodeCursorAsset(cursor()).frames[0].images;
  const profile = { u: 0.5, v: 0.5, radius: 0.1 };
  assert.equal(validateCursorHole(images, profile).valid, true);
  const missing = { ...images[0], pixels: new Uint8Array(images[0].pixels) };
  missing.pixels[(16 * 32 + 16) * 4 + 3] = 0;
  assert.equal(validateCursorHole([...images, missing], profile).valid, false);
  assert.equal(validateCursorHole(images, { ...profile, u: 0.04, v: 0.08 }).valid, false);
  assert.ok(findDefaultCursorHole(images));
  assert.equal(findDefaultCursorHole([{ ...missing, pixels: new Uint8Array(32 * 32 * 4) }]), null);
  const punched = punchCursorPixels(images[0], profile);
  const origin = cursorMountGeometry(images[0], profile).canvas.origin;
  assert.equal(punched.pixels[((18 + origin.y) * punched.width + 16 + origin.x) * 4 + 3], 0);
  assert.ok(punched.pixels[((16 + origin.y) * punched.width + 16 + origin.x) * 4 + 3] > 0);
  assert.equal(images[0].pixels[(14 * 32 + 16) * 4 + 3], 255);
  assert.deepEqual(cursorMountGeometry(images[0], profile).mountOffset, { x: 15, y: 14 });
});

test('profile normalization refuses malformed IDs, nonfinite values and prototype keys', () => {
  const key = `Arrow:${'a'.repeat(64)}`, profile = { u: 0.5, v: 0.6, radius: 0.05 };
  assert.deepEqual(normalizeCursorProfiles({ [key]: profile, invalid: profile, [`Hand:${'b'.repeat(64)}`]: { ...profile, radius: NaN } }), { [key]: profile });
});

test('rigid ring has a foreground arc over the cursor, an occluded rear arc and a complete padded lower loop', () => {
  const frame = decodeCursorAsset(cursor()).frames[0].images[0];
  const profile = { u: 0.5, v: 0.5, radius: 0.1 };
  const output = punchCursorPixels(frame, profile);
  const geometry = cursorMountGeometry(frame, profile);
  assert.ok(output.height > frame.height, 'complete lower loop needs a larger native canvas');
  const pixel = (x, y) => [...output.pixels.slice(((y + geometry.canvas.origin.y) * output.width + x + geometry.canvas.origin.x) * 4, ((y + geometry.canvas.origin.y) * output.width + x + geometry.canvas.origin.x) * 4 + 4)];
  assert.notDeepEqual(pixel(30, 30), [140, 80, 50, 255], 'front strand crosses opaque cursor art');
  assert.deepEqual(pixel(6, 30), [140, 80, 50, 255], 'rear strand is hidden by cursor art');
  assert.ok(output.pixels.some((a, i) => i % 4 === 3 && i >= frame.height * output.width * 4 && a > 0), 'lower loop is baked into native cursor');
  assert.deepEqual(output.hotspot, { x: frame.hotspot.x + geometry.canvas.origin.x, y: frame.hotspot.y + geometry.canvas.origin.y });
  assert.equal(output.width % 2, 0);
  assert.equal(output.height % 2, 0);
  assert.deepEqual(pixel(1, 2), [140, 80, 50, 255], 'click hotspot pixel remains original');
});

test('oversized mounted canvas is rejected and native target rebuild preserves animation and hotspot', () => {
  const frame = decodeCursorAsset(cursor(128)).frames[0].images[0];
  assert.match(validateCursorHole([frame], { u: 0.5, v: 0.7, radius: 0.2 }).reason, /画布上限/);
  assert.throws(() => serializeCursorAsset({ format: 'cur', frames: [{ images: [{ ...frame, width: 257 }] }] }), /canvas limits/);
  const resized = resizeCursorFrame(frame, 48);
  assert.deepEqual(resized.hotspot, { x: 0, y: 0 });
  const asset = decodeCursorAsset(ani());
  const output = buildPunchedCursor(asset, { u: 0.5, v: 0.5, radius: 0.1 }, { targetWidth: 48, encodePng(frame) { return parseCursorAsset(cursor(frame.width)).frames[0].images[0].bytes; } });
  const decoded = parseCursorAsset(output);
  assert.deepEqual(decoded.steps, asset.steps);
  assert.ok(decoded.frames.every(f => f.images.length === 1 && f.images[0].width > 48));
});

for (const [kind, suffix, frameCount, hotspots] of [['ani', 'cursor', 8, [2, 1, 0, 0, 0]], ['cur', 'pointer', 1, [4, 2, 1, 1, 0]]]) {
  const path = `D:/all/lightframe/Minecraft Enchanted Diamond Sword Animated Cursor--${suffix}--SweezyCursors.${kind}`;
  test(`user diamond sword ${kind} preserves every size, hotspot and animation step`, { skip: !existsSync(path) }, () => {
    const asset = parseCursorAsset(readFileSync(path)), roundtrip = parseCursorAsset(serializeCursorAsset(asset));
    assert.equal(asset.frames.length, frameCount);
    for (const frame of asset.frames) {
      assert.deepEqual(frame.images.map(i => i.width), [128, 64, 48, 32, 16]);
      assert.deepEqual(frame.images.map(i => i.hotspot.x), hotspots);
    }
    assert.deepEqual(roundtrip.steps, asset.steps);
    assert.deepEqual(roundtrip.frames.map(f => f.images.map(i => i.hotspot)), asset.frames.map(f => f.images.map(i => i.hotspot)));
  });
}
