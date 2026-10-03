import { createHash } from 'node:crypto';
import { findDefaultCursorHole, punchCursorPixels, resizeCursorFrame, validateCursorHole } from '../shared/cursor-hole-model.js';

// Independent implementation informed by Cursor-Palette's multi-size/frame model (MIT):
// https://github.com/DoomSalat/Cursor-Palette (LICENSE).
// Windows format: https://learn.microsoft.com/en-us/windows/win32/menurc/cursor-resource
// RIFF: https://learn.microsoft.com/en-us/windows/win32/multimedia/resource-interchange-file-format-services
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const fail = (message) => { throw new Error(`Unsupported cursor: ${message}`); };

function readCur(bytes) {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 2) fail('invalid CUR header');
  const count = bytes.readUInt16LE(4);
  if (!count || count > 128 || bytes.length < 6 + count * 16) fail('invalid image directory');
  const images = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16, width = bytes[o] || 256, height = bytes[o + 1] || 256;
    const size = bytes.readUInt32LE(o + 8), start = bytes.readUInt32LE(o + 12);
    if (!size || start < 6 + count * 16 || start + size > bytes.length) fail('invalid image bounds');
    const data = bytes.subarray(start, start + size);
    const hotspot = { x: bytes.readUInt16LE(o + 4), y: bytes.readUInt16LE(o + 6) };
    if (hotspot.x >= width || hotspot.y >= height) fail('invalid hotspot');
    images.push({ width, height, hotspot, bytes: data, encoding: data.subarray(0, 8).equals(PNG) ? 'png' : 'dib', directory: Buffer.from(bytes.subarray(o, o + 16)) });
  }
  return { images };
}

function riffChunks(bytes, start, end, depth = 0) {
  if (depth > 8) fail('RIFF nesting limit');
  const chunks = [];
  for (let o = start; o < end;) {
    if (o + 8 > end) fail('truncated RIFF chunk');
    const tag = bytes.toString('ascii', o, o + 4), size = bytes.readUInt32LE(o + 4), finish = o + 8 + size;
    if (finish > end || finish + (size & 1) > end) fail('RIFF chunk bounds');
    const data = bytes.subarray(o + 8, finish);
    const chunk = { tag, data };
    if (tag === 'LIST') {
      if (size < 4) fail('invalid LIST');
      chunk.listType = data.toString('ascii', 0, 4);
      chunk.children = riffChunks(bytes, o + 12, finish, depth + 1);
    }
    chunks.push(chunk); o = finish + (size & 1);
  }
  return chunks;
}

export function parseCursorAsset(input) {
  const bytes = Buffer.from(input);
  if (bytes.length > 32 * 1024 * 1024) fail('asset too large');
  const id = createHash('sha256').update(bytes).digest('hex');
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') return { format: 'cur', id, frames: [readCur(bytes)], steps: [{ frameIndex: 0, durationMs: 1000 }] };
  if (bytes.length < 12 || bytes.toString('ascii', 8, 12) !== 'ACON' || bytes.readUInt32LE(4) + 8 !== bytes.length) fail('invalid ANI header');
  const chunks = riffChunks(bytes, 12, bytes.length);
  const header = chunks.find(c => c.tag === 'anih')?.data;
  if (!header || header.length < 36 || header.readUInt32LE(0) !== 36 || !(header.readUInt32LE(32) & 1)) fail('unsupported ANI header');
  const frameCount = header.readUInt32LE(4), stepCount = header.readUInt32LE(8), defaultRate = header.readUInt32LE(28);
  if (!frameCount || frameCount > 256 || !stepCount || stepCount > 4096 || !defaultRate) fail('invalid ANI timeline');
  const icons = chunks.filter(c => c.tag === 'LIST' && c.listType === 'fram').flatMap(c => c.children.filter(i => i.tag === 'icon'));
  if (icons.length !== frameCount) fail('ANI frame count mismatch');
  const frames = icons.map(c => readCur(c.data));
  const seq = chunks.find(c => c.tag === 'seq ')?.data, rate = chunks.find(c => c.tag === 'rate')?.data;
  if ((seq && seq.length !== stepCount * 4) || (rate && rate.length !== stepCount * 4) || ((header.readUInt32LE(32) & 2) && !seq)) fail('invalid ANI timeline tables');
  const steps = Array.from({ length: stepCount }, (_, i) => {
    const frameIndex = seq ? seq.readUInt32LE(i * 4) : i % frameCount;
    const jiffies = rate ? rate.readUInt32LE(i * 4) : defaultRate;
    if (frameIndex >= frameCount || !jiffies) fail('invalid ANI step');
    return { frameIndex, durationMs: jiffies * 1000 / 60 };
  });
  return { format: 'ani', id, frames, steps, chunks };
}

function writeCur(frame) {
  const header = Buffer.alloc(6 + frame.images.length * 16);
  header.writeUInt16LE(2, 2); header.writeUInt16LE(frame.images.length, 4);
  let offset = header.length;
  frame.images.forEach((image, i) => {
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > 256 || image.height > 256) fail('image exceeds CUR canvas limits');
    const o = 6 + i * 16;
    if (image.directory) image.directory.copy(header, o);
    header[o] = image.width % 256; header[o + 1] = image.height % 256;
    header.writeUInt16LE(image.hotspot.x, o + 4); header.writeUInt16LE(image.hotspot.y, o + 6);
    header.writeUInt32LE(image.bytes.length, o + 8); header.writeUInt32LE(offset, o + 12);
    offset += image.bytes.length;
  });
  return Buffer.concat([header, ...frame.images.map(i => i.bytes)]);
}

function writeChunk(chunk) {
  const data = chunk.children ? Buffer.concat([Buffer.from(chunk.listType), ...chunk.children.map(writeChunk)]) : chunk.data;
  const header = Buffer.alloc(8); header.write(chunk.tag, 0, 'ascii'); header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, ...(data.length & 1 ? [Buffer.alloc(1)] : [])]);
}

export function serializeCursorAsset(asset) {
  if (asset.format === 'cur') return writeCur(asset.frames[0]);
  let index = 0;
  const chunks = asset.chunks.map(chunk => chunk.tag === 'LIST' && chunk.listType === 'fram'
    ? { ...chunk, children: chunk.children.map(c => c.tag === 'icon' ? { ...c, data: writeCur(asset.frames[index++]) } : c) } : chunk);
  const data = Buffer.concat([Buffer.from('ACON'), ...chunks.map(writeChunk)]), header = Buffer.alloc(8);
  header.write('RIFF'); header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data]);
}

function decodeDib(image) {
  const b = image.bytes;
  if (b.length < 40) fail('DIB header');
  const headerSize = b.readUInt32LE(0), width = b.readInt32LE(4), storedHeight = b.readInt32LE(8), depth = b.readUInt16LE(14);
  if (headerSize < 40 || headerSize > b.length || width !== image.width || Math.abs(storedHeight) !== image.height * 2
    || b.readUInt16LE(12) !== 1 || ![1, 4, 8, 24, 32].includes(depth) || b.readUInt32LE(16) !== 0) fail('compressed or unsupported DIB');
  const count = depth <= 8 ? (b.readUInt32LE(32) || 2 ** depth) : 0;
  if (count > 256) fail('DIB palette');
  const start = headerSize + count * 4, stride = Math.ceil(width * depth / 32) * 4, maskStride = Math.ceil(width / 32) * 4;
  const maskStart = start + stride * image.height;
  if (maskStart + maskStride * image.height > b.length) fail('DIB pixel bounds');
  const pixels = new Uint8Array(width * image.height * 4);
  let hasAlpha = false;
  for (let y = 0; y < image.height; y++) {
    const sy = storedHeight > 0 ? image.height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, row = start + sy * stride;
      let p;
      if (depth <= 8) {
        const index = depth === 8 ? b[row + x] : depth === 4 ? (b[row + (x >> 1)] >> (x % 2 ? 0 : 4)) & 15 : (b[row + (x >> 3)] >> (7 - x % 8)) & 1;
        if (index >= count) fail('DIB palette index');
        p = headerSize + index * 4;
      } else p = row + x * (depth / 8);
      pixels.set([b[p + 2], b[p + 1], b[p], depth === 32 ? b[p + 3] : 255], o);
      hasAlpha ||= depth === 32 && b[p + 3] > 0;
    }
  }
  for (let y = 0; y < image.height; y++) {
    const sy = storedHeight > 0 ? image.height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const masked = (b[maskStart + sy * maskStride + (x >> 3)] >> (7 - x % 8)) & 1;
      if (!hasAlpha) pixels[o + 3] = masked ? 0 : 255;
      else if (masked) pixels[o + 3] = 0;
      if (depth === 1 && masked && pixels[o] !== 0) fail('monochrome invert cursor');
    }
  }
  return pixels;
}

export function decodeCursorAsset(bytes, { decodePng } = {}) {
  const asset = parseCursorAsset(bytes);
  for (const frame of asset.frames) for (const image of frame.images) {
    if (image.encoding === 'dib') image.pixels = decodeDib(image);
    else {
      if (!decodePng) fail('PNG decoder unavailable');
      const decoded = decodePng(image.bytes);
      if (decoded.width !== image.width || decoded.height !== image.height || decoded.pixels?.length !== image.width * image.height * 4) fail('PNG dimensions');
      image.pixels = new Uint8Array(decoded.pixels);
    }
  }
  return asset;
}

export function cursorAssetMetadata(asset, { role, label = role, displaySize = 32, encodePng, targetWidth, targetHeight = targetWidth, targetHotspot } = {}) {
  const sourceFrames = targetWidth === undefined ? asset.frames : asset.frames.map(frame => {
    const source = [...frame.images].sort((a, b) => Math.abs(a.width - targetWidth) - Math.abs(b.width - targetWidth))[0];
    const image = resizeCursorFrame(source, targetWidth, targetHeight);
    return { images: [targetHotspot ? { ...image, hotspot: { ...targetHotspot } } : image] };
  });
  const allImages = sourceFrames.flatMap(f => f.images);
  const defaultProfile = findDefaultCursorHole(allImages);
  const frames = sourceFrames.map(frame => {
    const image = [...frame.images].sort((a, b) => Math.abs(a.width - displaySize) - Math.abs(b.width - displaySize))[0];
    const png = targetWidth === undefined && image.encoding === 'png' ? image.bytes : encodePng(image);
    return { width: image.width, height: image.height, hotspot: image.hotspot, dataUrl: `data:image/png;base64,${Buffer.from(png).toString('base64')}`, alpha: Array.from(image.pixels.filter((_, i) => i % 4 === 3)) };
  });
  // UI validation also checks every source resolution, not only the displayed one.
  const masks = allImages.map(i => ({ width: i.width, height: i.height, hotspot: i.hotspot, alpha: Array.from(i.pixels.filter((_, p) => p % 4 === 3)) }));
  return { role, id: asset.id, label, frames, masks, steps: asset.steps, displaySize, supported: !!defaultProfile, defaultProfile };
}

export function buildPunchedCursor(asset, profile, { encodePng, targetWidth, targetHeight = targetWidth, targetHotspot } = {}) {
  if (targetWidth !== undefined && (!Number.isInteger(targetWidth) || !Number.isInteger(targetHeight) || targetWidth < 1 || targetHeight < 1 || targetWidth > 256 || targetHeight > 256)) fail('invalid target dimensions');
  const sourceFrames = targetWidth === undefined ? asset.frames : asset.frames.map(frame => {
    const source = [...frame.images].sort((a, b) => Math.abs(a.width - targetWidth) - Math.abs(b.width - targetWidth))[0];
    const image = resizeCursorFrame(source, targetWidth, targetHeight);
    return { images: [targetHotspot ? { ...image, hotspot: { ...targetHotspot } } : image] };
  });
  const validation = validateCursorHole(sourceFrames.flatMap(f => f.images), profile);
  if (!validation.valid) throw new Error(validation.reason);
  if (!encodePng) fail('PNG encoder unavailable');
  const frames = sourceFrames.map(frame => ({ images: frame.images.map(image => {
    const punched = punchCursorPixels(image, profile);
    return { ...punched, bytes: Buffer.from(encodePng(punched)), encoding: 'png' };
  }) }));
  return serializeCursorAsset({ ...asset, frames });
}
