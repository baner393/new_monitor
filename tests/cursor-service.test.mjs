import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { CursorService } from '../src/main/cursor-service.js';
import { serializeCursorAsset } from '../src/main/cursor-assets.js';
import { cursorMountGeometry, cursorProfileKey } from '../src/shared/cursor-hole-model.js';
import { CURSOR_HOST_SOURCE } from '../src/main/cursor-native-host.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture({ installError = false, missing = false, recoveryAcknowledged = true, nativeSize = 32, multipleRoles = false,
  cursorScalingApi = true, format = 'cur', mixedFormats = false } = {}) {
  const dib = Buffer.alloc(40 + 32 * 32 * 4 + 4 * 32);
  dib.writeUInt32LE(40); dib.writeInt32LE(32, 4); dib.writeInt32LE(64, 8);
  dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14);
  for (let i = 40; i < 40 + 32 * 32 * 4; i += 4) dib.set([90, 110, 160, 255], i);
  const cur = serializeCursorAsset({ format: 'cur', frames: [{ images: [{ width: 32, height: 32, hotspot: { x: 1, y: 2 }, bytes: dib }] }] });
  const wrapAni = (cursor) => {
    const chunk = (tag, data) => {
      const header = Buffer.alloc(8); header.write(tag); header.writeUInt32LE(data.length, 4);
      return Buffer.concat([header, data, ...(data.length % 2 ? [Buffer.alloc(1)] : [])]);
    };
    const header = Buffer.alloc(36); header.writeUInt32LE(36); header.writeUInt32LE(1, 4);
    header.writeUInt32LE(1, 8); header.writeUInt32LE(6, 28); header.writeUInt32LE(1, 32);
    const frames = Buffer.concat([Buffer.from('fram'), chunk('icon', cursor)]);
    const data = Buffer.concat([Buffer.from('ACON'), chunk('anih', header), chunk('LIST', frames)]);
    const riff = Buffer.alloc(8); riff.write('RIFF'); riff.writeUInt32LE(data.length, 4);
    return Buffer.concat([riff, data]);
  };
  const asset = format === 'ani' ? wrapAni(cur) : cur;
  const files = new Map([['theme.cur', mixedFormats ? cur : asset]]), commands = [], children = [];
  if (mixedFormats) files.set('theme.ani', wrapAni(cur));
  const spawnProcess = () => {
    const child = new EventEmitter(); children.push(child);
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.send = (message) => child.stdout.write(JSON.stringify(message) + '\n');
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      const request = JSON.parse(String(chunk)); commands.push(request);
      queueMicrotask(() => {
        if (request.op === 'theme') {
          const roles = mixedFormats
            ? [{ role: 'IBeam', systemId: 32513, path: 'theme.cur', width: nativeSize, height: nativeSize },
              { role: 'Hand', systemId: 32649, path: 'theme.ani', width: 56, height: 56, hotspot: { x: 8, y: 12 } }]
            : [{ role: 'Arrow', systemId: 32512, path: missing ? 'missing.cur' : 'theme.cur', width: nativeSize, height: nativeSize },
              ...(multipleRoles ? [{ role: 'Hand', systemId: 32649, path: 'theme.cur', width: 56, height: 56, hotspot: { x: 8, y: 12 } }] : [])];
          child.send({ type: 'reply', requestId: request.requestId, result: { available: true, roles } });
        }
        else if (request.op === 'install' && installError) child.send({ type: 'reply', requestId: request.requestId, error: 'SetSystemCursor failed' });
        else child.send({ type: 'reply', requestId: request.requestId,
          result: request.op === 'install' ? { installed: request.roles.length > 0,
            roles: request.roles.map(role => ({ systemId: role.systemId, width: role.expectedWidth, height: role.expectedHeight,
              hotspot: { x: role.expectedHotspotX, y: role.expectedHotspotY }, creationScalingMode: role.creationScalingMode })) }
            : { restored: request.op !== 'restore' || children.length < 2 || recoveryAcknowledged } });
        if (request.op === 'stop') { child.send({ type: 'restored' }); child.emit('exit', 0); }
        done();
      });
    } });
    queueMicrotask(() => child.send({ type: 'ready', cursorScalingApi }));
    return child;
  };
  const service = new CursorService({ directory: '/temporary-cursors', platform: 'win32', spawnProcess,
    codec: { encodePng: () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) },
    io: { mkdir: async () => {}, writeFile: async (key, value) => files.set(key, value), readFile: async (key) => {
      if (!files.has(key)) throw Error('Asset missing'); return files.get(key);
    } }, timeoutMs: 1000 });
  return { service, commands, children, files, cur };
}

test('cursor copies are prepared without modifying originals; live native size/hotspot determine the mount', async () => {
  const { service, commands, children, files, cur } = fixture();
  try {
    const [first, second] = await Promise.all([service.getTheme(), service.getTheme()]);
    assert.equal(first.roles[0].id, second.roles[0].id);
    assert.equal(children.length, 1); assert.equal(commands.filter((command) => command.op === 'theme').length, 1);
    const profile = { u: 0.5, v: 0.65, radius: 0.05 };
    await service.sync({ anchorMode: 'cursor', charmCursorProfiles: { [cursorProfileKey('Arrow', first.roles[0].id)]: profile } });
    assert.deepEqual(files.get('theme.cur'), cur);
    assert.equal(commands.find((command) => command.op === 'install').roles[0].systemId, 32512);
    service.getScaleFactor = () => 2;
    children[0].send({ type: 'state', state: { visible: true, role: 'Arrow', width: 64, height: 48, hotspot: { x: 2, y: 4 } } });
    assert.equal(service.state.active, true);
    const generated = service.installed.get('Arrow').renderedFrame;
    const ratioX = 64 / generated.width, ratioY = 48 / generated.height;
    assert.equal(service.state.width, 32 * ratioX / 2); assert.equal(service.state.height, 32 * ratioY / 2);
    assert.deepEqual(service.state.hotspot, { x: 1, y: 2 });
    assert.ok(Math.abs(service.state.hole.radius - 1.6 * Math.sqrt(ratioX * ratioY) / 2) < 1e-8);
    assert.ok(Math.abs(service.state.mountOffset.x - ((16 + 5.2 * 0.64) * ratioX - 2) / 2) < 1e-8);
    assert.ok(Math.abs(service.state.mountOffset.y - ((20.8 + 26 * 0.64) * ratioY - 4) / 2) < 1e-8);
    children[0].send({ type: 'state', state: { visible: true, role: null, width: 64, height: 48, hotspot: { x: 2, y: 4 } } });
    assert.equal(service.state.active, false); assert.equal(service.state.reason, 'unsupported');
    await service.sync({ anchorMode: 'top' });
    assert.equal(service.restored, true); assert.equal(commands.at(-1).op, 'restore');
  } finally { await service.stop(); }
  assert.equal(commands.at(-1).op, 'stop');
});

test('partial install failure forces restoration and never advertises an active attachment', async () => {
  const { service, commands } = fixture({ installError: true });
  try {
    await assert.rejects(service.sync({ anchorMode: 'cursor' }), /SetSystemCursor failed/);
    assert.deepEqual(commands.slice(-2).map((command) => command.op), ['install', 'restore']);
    assert.equal(service.restored, true); assert.equal(service.state.active, false);
    assert.equal(service.state.reason, 'native-error');
  } finally { await service.stop(); }
});

test('the rigid ring belongs to the native cursor and canvas padding never changes source geometry', async () => {
  const { service, children, commands } = fixture();
  try {
    const theme = await service.getTheme();
    const profile = { u: 0.5, v: 0.8, radius: 0.05 };
    await service.sync({ anchorMode: 'cursor', charmCursorProfiles: { [cursorProfileKey('Arrow', theme.roles[0].id)]: profile } });
    const installation = commands.find(command => command.op === 'install').roles[0];
    assert.ok(installation.expectedHeight > 32, 'whole ring requires canvas below the cursor');
    children[0].send({ type: 'state', state: { visible: true, role: 'Arrow', width: installation.expectedWidth,
      height: installation.expectedHeight, hotspot: { x: 1, y: 2 } } });
    assert.equal(service.state.ringEmbedded, true);
    assert.equal(service.state.width, 32);
    assert.equal(service.state.height, 32);
    assert.equal(service.state.hole.y, 25.6);
  } finally { await service.stop(); }
});

test('an OS cursor size absent from source variants is resized before piercing', async () => {
  const { service, commands, children } = fixture({ nativeSize: 56 });
  try {
    await service.sync({ anchorMode: 'cursor' });
    const installed = service.installed.get('Arrow');
    assert.equal(installed.sourceFrame.width, 56);
    assert.equal(installed.sourceFrame.height, 56);
    const expected = commands.find(command => command.op === 'install').roles[0];
    children[0].send({ type: 'state', state: { visible: true, role: 'Arrow', width: expected.expectedWidth,
      height: expected.expectedHeight, hotspot: { x: expected.expectedHotspotX, y: expected.expectedHotspotY } } });
    assert.equal(service.state.width, 56);
    assert.equal(service.state.ringEmbedded, true);
  } finally { await service.stop(); }
});

test('replacing a supported mount does not hide the pet during preparation', async () => {
  const { service, children } = fixture();
  try {
    const theme = await service.getTheme();
    await service.sync({ anchorMode: 'cursor' });
    children[0].send({ type: 'state', state: { visible: true, role: 'Arrow' } });
    const states = []; service.onState = state => states.push(state);
    await service.sync({ anchorMode: 'cursor', charmCursorProfiles: {
      [cursorProfileKey('Arrow', theme.roles[0].id)]: { u: 0.5, v: 0.6, radius: 0.05 },
    } });
    assert.ok(states.length > 0);
    assert.ok(states.every(state => state.active), 'preparation is not an unsupported cursor or process exit');
    children[0].send({ type: 'state', state: { visible: true, role: null } });
    assert.equal(service.state.active, false, 'unknown cursors still hide immediately');
  } finally { await service.stop(); }
});

test('role changes use each installed bitmap hotspot and padding for the moving contact', async () => {
  const { service, children } = fixture({ multipleRoles: true });
  try {
    const theme = await service.getTheme();
    await service.sync({ anchorMode: 'cursor', charmCursorProfiles: {
      [cursorProfileKey('Arrow', theme.roles[0].id)]: { u: 0.1, v: 0.6, radius: 0.05 },
      [cursorProfileKey('Hand', theme.roles[1].id)]: { u: 0.7, v: 0.7, radius: 0.07 },
    } });
    for (const [role, expected] of [['Arrow', { x: 3.864, y: 25.52 }], ['Hand', { x: 35.2768, y: 47.584 }]]) {
      const rendered = service.installed.get(role).renderedFrame;
      children[0].send({ type: 'state', state: { visible: true, role, ...rendered } });
      assert.equal(service.state.role, role);
      assert.ok(Math.abs(service.state.ringCenterOffset.x - expected.x) < 1e-8);
      assert.ok(Math.abs(service.state.ringCenterOffset.y - expected.y) < 1e-8);
      assert.ok(Math.abs(service.state.mountOffset.y + service.state.ringGeometry.centerFromAnchor.y - expected.y) < 1e-8);
    }
  } finally { await service.stop(); }
});

test('active Win32 bitmap scaling and hotspot changes determine the actual ring offset', async () => {
  const { service, children } = fixture();
  try {
    await service.sync({ anchorMode: 'cursor' });
    const record = service.installed.get('Arrow'), rendered = record.renderedFrame;
    children[0].send({ type: 'state', state: { visible: true, role: 'Arrow', width: rendered.width * 2,
      height: rendered.height * 1.5, hotspot: { x: 11, y: 17 } } });
    const scaled = { ...service.state };
    children[0].send({ type: 'state', state: { visible: true, role: 'Arrow', ...rendered } });
    const original = service.state;
    assert.ok(Math.abs(scaled.ringCenterOffset.x - ((original.ringCenterOffset.x + rendered.hotspot.x) * 2 - 11)) < 1e-8);
    assert.ok(Math.abs(scaled.ringCenterOffset.y - ((original.ringCenterOffset.y + rendered.hotspot.y) * 1.5 - 17)) < 1e-8);
    assert.ok(Math.abs(scaled.ringGeometry.radiusX - original.ringGeometry.radiusX * 2) < 1e-8);
    assert.ok(Math.abs(scaled.ringGeometry.radiusY - original.ringGeometry.radiusY * 1.5) < 1e-8);
    assert.ok(Math.abs(scaled.ringGeometry.shear - original.ringGeometry.shear * 2 / 1.5) < 1e-8);
  } finally { await service.stop(); }
});

test('cursor scaling mode keeps native geometry aligned with the Windows monitor-rendered size', async () => {
  const { service, children, commands } = fixture();
  try {
    service.getScaleFactor = () => 1.5;
    const theme = await service.getTheme();
    assert.equal(theme.roles[0].displaySize, 32,
      'CUR preview uses bitmap dimensions because Windows scales its final system shape');
    await service.sync({ anchorMode: 'cursor' });
    const install = commands.find(command => command.op === 'install');
    assert.ok(install.roles.every(role => role.expectedWidth > 0 && role.expectedHeight > 0));
    assert.ok(install.roles.every(role => role.creationScalingMode === 'none'));
    assert.match(CURSOR_HOST_SOURCE, /SetThreadCursorCreationScaling\(dpiMode\)/,
      'the native LoadImage path applies the per-role scaling mode');
    const generated = service.installed.get('Arrow').renderedFrame;
    // DXGI observes CUR system shapes at bitmap dimensions times monitor scale,
    // even though cursor creation scaling was set to NONE.
    children[0].send({ type: 'state', state: { visible: true, role: 'Arrow', width: generated.width,
      height: generated.height, hotspot: generated.hotspot, creationScalingMode: 'none' } });
    assert.equal(service.state.nativeCursorScaling, 'system-default');
    assert.equal(service.state.cursorCreationScalingMode, 'none');
    assert.equal(service.state.cursorCreationDpi, null);
    const geometry = service.installed.get('Arrow');
    const { anchor, canvas } = cursorMountGeometry(geometry.sourceFrame, geometry.profile);
    const expectedX = anchor.x + canvas.origin.x - generated.hotspot.x;
    const expectedY = anchor.y + canvas.origin.y - generated.hotspot.y;
    assert.ok(Math.abs(service.state.mountOffset.x - expectedX) < 1e-8);
    assert.ok(Math.abs(service.state.mountOffset.y - expectedY) < 1e-8);
    assert.equal(service.state.width, theme.roles[0].displaySize,
      'CUR preview and desktop cursor use the same raw bitmap size in renderer DIP');

    // Also guard the reported geometry transform when an older/default-created
    // cursor reaches a monitor at a different DPI (the pre-fix failure case).
    children[0].send({ type: 'state', state: { visible: true, role: 'Arrow', width: generated.width,
      height: generated.height, hotspot: generated.hotspot, creationDpi: 96 } });
    assert.equal(service.state.nativeCursorScaling, 'dpi-relative');
    assert.equal(service.state.cursorCreationDpi, 96);
    assert.ok(Math.abs(service.state.mountOffset.x - (anchor.x + canvas.origin.x - generated.hotspot.x)) < 1e-8);
  } finally { await service.stop(); }
});

test('ANI with default creation scaling matches its baseline geometry at 150 percent DPI', async () => {
  const { service, children, commands } = fixture({ format: 'ani' });
  try {
    service.getScaleFactor = () => 1.5;
    const theme = await service.getTheme();
    assert.ok(Math.abs(theme.roles[0].displaySize - 32 / 1.5) < 1e-8,
      'ANI preview converts its raw physical bitmap size to renderer DIP');
    await service.sync({ anchorMode: 'cursor' });
    const record = service.installed.get('Arrow'), generated = record.renderedFrame;
    assert.equal(record.format, 'ani');
    const install = commands.find(command => command.op === 'install');
    assert.ok(install.roles.every(role => role.creationScalingMode === 'default'));
    children[0].send({ type: 'state', state: { visible: true, role: 'Arrow', width: generated.width,
      height: generated.height, hotspot: generated.hotspot, creationScalingMode: 'default' } });
    assert.equal(service.state.nativeCursorScaling, 'default');
    assert.equal(service.state.cursorCreationScalingMode, 'default');
    assert.equal(service.state.width, record.sourceFrame.width / 1.5);
    assert.equal(service.state.width, theme.roles[0].displaySize,
      'ANI preview and desktop cursor use the same raw bitmap size in renderer DIP');
    const { anchor, canvas } = cursorMountGeometry(record.sourceFrame, record.profile);
    assert.ok(Math.abs(service.state.mountOffset.x - (anchor.x + canvas.origin.x - generated.hotspot.x) / 1.5) < 1e-8,
      'ANI rope offset uses raw physical pixels converted to renderer DIP');
  } finally { await service.stop(); }
});

test('one mixed-format installation preserves per-role DPI mode and active geometry', async () => {
  const { service, children, commands } = fixture({ mixedFormats: true });
  try {
    service.getScaleFactor = () => 1.5;
    const theme = await service.getTheme();
    const profiles = Object.fromEntries(theme.roles.map(role => [cursorProfileKey(role.role, role.id),
      { u: role.role === 'IBeam' ? 0.55 : 0.72, v: 0.68, radius: 0.05 }]));
    await service.sync({ anchorMode: 'cursor', charmCursorProfiles: profiles });

    const install = commands.find(command => command.op === 'install');
    const requestByRole = new Map(install.roles.map(request => [request.systemId, request]));
    assert.equal(service.installed.get('IBeam').format, 'cur');
    assert.equal(service.installed.get('Hand').format, 'ani');
    assert.equal(requestByRole.get(32513).creationScalingMode, 'none');
    assert.equal(requestByRole.get(32649).creationScalingMode, 'default');

    for (const [role, systemId, mode, effectiveScale, effectiveMode] of [
      ['IBeam', 32513, 'none', 1.5, 'system-default'],
      ['Hand', 32649, 'default', 1, 'default'],
    ]) {
      const record = service.installed.get(role), generated = record.renderedFrame;
      children[0].send({ type: 'state', state: { visible: true, role, width: generated.width,
        height: generated.height, hotspot: generated.hotspot, creationScalingMode: mode } });
      assert.equal(service.state.role, role);
      assert.equal(service.state.cursorCreationScalingMode, mode);
      assert.equal(service.state.nativeCursorScaling, effectiveMode);
      assert.equal(service.state.width, record.sourceFrame.width * effectiveScale / 1.5);
      assert.equal(service.state.width, theme.roles.find(item => item.role === role).displaySize);

      const { anchor, canvas } = cursorMountGeometry(record.sourceFrame, record.profile);
      const expected = (anchor.x + canvas.origin.x - generated.hotspot.x) * effectiveScale / 1.5;
      assert.ok(Math.abs(service.state.mountOffset.x - expected) < 1e-8,
        `${role} mount uses the active role's own format/DPI geometry`);
    }
  } finally { await service.stop(); }
});

test('ambiguous system cursor handles are not assigned the first matching role', () => {
  assert.match(CURSOR_HOST_SOURCE, /matchingRoles\.Count==1\?matchingRoles\[0\]:null/);
  assert.match(CURSOR_HOST_SOURCE, /if\(matchingRoles\.Count>1\)state\["ambiguousRoles"\]=matchingRoles/);
});

test('zero cursor-scaling API returns cannot report support or install a cursor', () => {
  const loadStart = CURSOR_HOST_SOURCE.indexOf('static IntPtr LoadImageWithDpiMode');
  const probeStart = CURSOR_HOST_SOURCE.indexOf('static bool CursorScalingApiAvailable', loadStart);
  const stateStart = CURSOR_HOST_SOURCE.indexOf('static Dictionary<string,object> Info', probeStart);
  const load = CURSOR_HOST_SOURCE.slice(loadStart, probeStart);
  const probe = CURSOR_HOST_SOURCE.slice(probeStart, stateStart);
  assert.match(load, /if\(previous==0\)throw new Exception\("SetThreadCursorCreationScaling failed/);
  assert.match(load, /if\(restored==0\)[\s\S]*throw new Exception\("SetThreadCursorCreationScaling failed while restoring/);
  assert.ok(load.indexOf('scalingSupported=true') > load.indexOf('if(restored==0)'),
    'the helper marks scaling support only after a nonzero restoration result');
  assert.match(probe, /if\(previous==0\)return false/);
  assert.match(probe, /if\(SetThreadCursorCreationScaling\(previous\)==0\)[\s\S]*throw new Exception/);
});

test('missing or unsupported assets do not masquerade as punched native cursors', async () => {
  const { service } = fixture({ missing: true });
  try {
    const theme = await service.getTheme(); assert.equal(theme.roles[0].supported, false);
    await service.sync({ anchorMode: 'cursor' });
    assert.equal(service.installed.size, 0); assert.equal(service.restored, true); assert.equal(service.state.active, false);
  } finally { await service.stop(); }
});

test('cursor attachment is disabled when Windows cannot guarantee cursor scaling semantics', async () => {
  const { service, commands } = fixture({ cursorScalingApi: false });
  try {
    await service.sync({ anchorMode: 'cursor' });
    assert.equal(service.state.active, false);
    assert.equal(service.state.reason, 'unsupported-scaling');
    assert.equal(commands.some(command => command.op === 'install'), false);
  } finally { await service.stop(); }
});

test('unexpected helper death starts a recovery helper and forces a fresh theme reload', async () => {
  const { service, children, commands } = fixture();
  try {
    await service.sync({ anchorMode: 'cursor' });
    children[0].emit('exit', 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(children.length, 2);
    assert.deepEqual(commands.slice(-2).map(command => command.op), ['restore', 'install']);
    assert.equal(service.restored, false); assert.equal(service.installed.size, 1);
    children[1].emit('exit', 1);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(children.length, 3, 'a second failure still requires safe restoration');
    assert.equal(commands.at(-1).op, 'restore', 'a repeatedly failing mount is not reinstalled');
    assert.equal(service.restored, true);
    children[2].emit('exit', 1);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(children.length, 3, 'no installed pointers means no further recovery loop');
    assert.match(CURSOR_HOST_SOURCE, /Restore\(op=="restore"\)/, 'a fresh helper must execute SPI even when it did not install copies');
  } finally { await service.stop(); }
});

test('non-Windows startup never spawns a native cursor helper', async () => {
  const { service, children } = fixture(); service.platform = 'linux';
  await service.sync({ anchorMode: 'cursor' });
  assert.equal(children.length, 0); assert.equal(service.state.reason, 'platform');
  await service.stop();
});

test('emergency recovery requires an explicit restoration acknowledgment', async () => {
  const { service, children } = fixture({ recoveryAcknowledged: false });
  try {
    await service.sync({ anchorMode: 'cursor' }); children[0].emit('exit', 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(service.restored, false);
    assert.equal(service.state.reason, 'native-error');
    assert.match(service.state.error, /not acknowledged/);
  } finally { service.restored = true; await service.stop(); }
});

test('native cursor metadata IPC rejects every renderer except the main window', async () => {
  const source = readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8');
  const start = source.indexOf("ipcMain.handle('cursor-mount-theme-get'");
  const end = source.indexOf("ipcMain.handle('monitor-settings-get'", start);
  const callbacks = new Map(), sender = {}, other = {}; let reads = 0;
  const context = { ipcMain: { handle: (channel, callback) => callbacks.set(channel, callback) },
    mainWindow: { isDestroyed: () => false, webContents: sender },
    cursorService: { getTheme: async () => { reads++; return { available: true, roles: [] }; }, state: { active: true } } };
  vm.runInNewContext(source.slice(start, end), context);
  assert.equal((await callbacks.get('cursor-mount-theme-get')({ sender: other })).available, false);
  assert.equal(callbacks.get('cursor-mount-state-get')({ sender: other }).active, false);
  assert.equal(reads, 0);
  assert.equal((await callbacks.get('cursor-mount-theme-get')({ sender })).available, true);
  assert.equal(callbacks.get('cursor-mount-state-get')({ sender }).active, true);
  assert.equal(reads, 1);
});

test('CUR and ANI previews use their respective final native DPI sizes without resampling frames', async () => {
  const { service } = fixture();
  try {
    service.getScaleFactor = () => 1.5;
    const first = await service.getTheme();
    assert.equal(first.roles[0].displaySize, 32);
    assert.equal(first.roles[0].frames[0].width, 32);
    service.getScaleFactor = () => 2;
    const second = await service.getTheme();
    assert.equal(second.roles[0].displaySize, 32); assert.equal(second.roles[0].frames[0].width, 32);
  } finally { await service.stop(); }
  const { service: aniService } = fixture({ format: 'ani' });
  try {
    aniService.getScaleFactor = () => 1.5;
    const theme = await aniService.getTheme();
    assert.ok(Math.abs(theme.roles[0].displaySize - 32 / 1.5) < 1e-8);
    assert.equal(theme.roles[0].frames[0].width, 32);
  } finally { await aniService.stop(); }
});

test('hiding or closing the charm restores cursors without changing persistent anchor mode', () => {
  const source = readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('function syncEffectiveCursorSettings()');
  const end = source.indexOf('\nfunction saveSettings()', start);
  const calls = [], context = { currentSettings: { anchorMode: 'cursor', charmCursorProfiles: {} }, mainWindow: null,
    cursorService: { sync: (settings) => { calls.push(settings); return Promise.resolve(); } }, console };
  vm.runInNewContext(source.slice(start, end), context);
  context.syncEffectiveCursorSettings(); assert.equal(calls.at(-1).anchorMode, 'top');
  context.mainWindow = { isDestroyed: () => false, isVisible: () => false };
  context.syncEffectiveCursorSettings(); assert.equal(calls.at(-1).anchorMode, 'top');
  context.mainWindow.isVisible = () => true;
  context.syncEffectiveCursorSettings(); assert.equal(calls.at(-1).anchorMode, 'cursor');
  context.mainWindow.isDestroyed = () => true;
  context.syncEffectiveCursorSettings(); assert.equal(calls.at(-1).anchorMode, 'top');
  assert.equal(context.currentSettings.anchorMode, 'cursor');
});
