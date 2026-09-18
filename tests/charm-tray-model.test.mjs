import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARM_TRAY_ITEM_IDS,
  buildCharmTrayTemplate,
} from '../src/shared/charm-tray-model.js';

function visibleIds(template) {
  return template.filter((item) => item.id).map((item) => item.id);
}

test('template contains every tray item id exactly once', () => {
  const ids = visibleIds(buildCharmTrayTemplate({ creatorAccess: true }));
  assert.deepEqual(ids, CHARM_TRAY_ITEM_IDS);
  assert.equal(new Set(ids).size, ids.length);
});

test('creator-only entry appears only with creator access', () => {
  assert.equal(visibleIds(buildCharmTrayTemplate({ creatorAccess: false })).includes('open-custom-mode'), false);
  assert.equal(visibleIds(buildCharmTrayTemplate({ creatorAccess: true })).includes('open-custom-mode'), true);
});

test('visibility label toggles between hide and show', () => {
  const shown = buildCharmTrayTemplate({ isVisible: true })[0];
  const hidden = buildCharmTrayTemplate({ isVisible: false })[0];
  assert.equal(shown.id, 'toggle-visibility');
  assert.equal(shown.label, '隐藏挂饰');
  assert.equal(hidden.label, '显示挂饰');
});

test('template separates action groups with four separators', () => {
  const template = buildCharmTrayTemplate({ creatorAccess: false });
  assert.equal(template.filter((item) => item.type === 'separator').length, 4);
});

test('mode radio items reflect the current anchor mode', () => {
  const template = buildCharmTrayTemplate({ anchorMode: 'cursor' });
  const radios = template.filter((item) => item.type === 'radio');
  assert.deepEqual(radios.map((r) => r.id), ['mode-top', 'mode-cursor']);
  assert.equal(radios[0].checked, false);
  assert.equal(radios[1].checked, true);
});

test('every non-separator item carries an id and a label', () => {
  for (const item of buildCharmTrayTemplate({ creatorAccess: true })) {
    if (item.type === 'separator') continue;
    assert.ok(item.id, 'missing id');
    assert.ok(item.label, 'missing label');
  }
});
