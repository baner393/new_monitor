import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('expression generator is loaded before the custom-mode controller', async () => {
  const html = await source('src/custom/index.html');
  const generator = html.indexOf('<script src="expression-generator.js"></script>');
  const controller = html.indexOf('<script src="custom.js"></script>');
  assert.ok(generator >= 0 && controller > generator);
});

test('small preview is review-only and precise marking uses the guided canvas', async () => {
  const html = await source('src/custom/index.html');
  assert.doesNotMatch(html, /id="selectEyesBtn"|id="selectMouthBtn"/);
  assert.match(html, /id="fullscreenMarkBtn"/);
  assert.match(html, /小图仅用于检查结果/);
});

test('freehand canvas can enter both generation and state-editing workflows', async () => {
  const [html, js] = await Promise.all([
    source('src/custom/index.html'),
    source('src/custom/custom.js'),
  ]);
  assert.match(html, /id="canvasUseAsBaseBtn"/);
  assert.match(html, /id="canvasImportBtn"/);
  assert.match(html, /id="canvasImportInput"/);
  assert.match(html, /id="canvasTargetExpression"/);
  assert.match(html, /id="canvasSendToExpressionBtn"/);
  assert.match(js, /canvasUseAsBaseBtn/);
  assert.match(js, /canvasSendToExpressionBtn/);
  assert.match(js, /loadConverterFile\(file\)/);
  assert.match(js, /loadCanvasPng\(file\)/);
  assert.match(js, /imageToGrid\(image, targetSize\)/);
  assert.match(js, /exprData\[expressionId\]/);
});

test('expression editor starts with an actionable state and can load the active skin', async () => {
  const [html, js] = await Promise.all([
    source('src/custom/index.html'),
    source('src/custom/custom.js'),
  ]);
  assert.match(html, /id="loadActiveSkinBtn"/);
  assert.match(js, /selectExpression\('idle'\)/);
  assert.match(js, /skinGetCurrent/);
  assert.match(js, /loadSkinFramesIntoExpressionEditor/);
  assert.match(js, /skinGetFrames/);
});

test('skin-library entries can enter the editable expression workflow', async () => {
  const [js, preload, main] = await Promise.all([
    source('src/custom/custom.js'),
    source('src/custom/preload.js'),
    source('src/main/index.js'),
  ]);
  assert.match(js, /data-edit-skin/);
  assert.match(js, /已导入皮肤库并打开表情编辑/);
  assert.match(preload, /skinGetFrames/);
  assert.match(main, /skin-get-frames/);
});

test('guided marker returns exact target-grid coordinates', async () => {
  const js = await source('src/custom/canvas-region.js');
  assert.match(js, /coordinateSpace\s*=\s*'target'/);
  assert.match(js, /result\.resolution\s*=\s*gridSize/);
});
