import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOverviewHeight, layoutOverviewCards } from '../src/renderer/panel-layout.js';

test('overview cards refill the grid in reading order without hidden-item gaps', () => {
  const cards = [
    { key: 'cpu', height: 104 },
    { key: 'gpu', height: 104 },
    { key: 'network', height: 126 },
    { key: 'hardware', height: 144 },
  ];

  const layout = layoutOverviewCards(cards);

  assert.deepEqual(layout.map(({ key, x, y }) => ({ key, x, y })), [
    { key: 'cpu', x: 20, y: 66 },
    { key: 'gpu', x: 358, y: 66 },
    { key: 'network', x: 20, y: 178 },
    { key: 'hardware', x: 358, y: 178 },
  ]);
});

test('a single overview card is centered instead of leaving an empty column', () => {
  const [card] = layoutOverviewCards([{ key: 'system', height: 144 }]);

  assert.equal(card.x, 189);
  assert.equal(card.y, 66);
  assert.equal(card.width, 322);
});

test('mixed-height rows reserve enough space for the tallest card', () => {
  const layout = layoutOverviewCards([
    { key: 'network', height: 126 },
    { key: 'system', height: 144 },
    { key: 'cpu', height: 104 },
  ]);

  assert.equal(layout[2].y, 218);
  assert.deepEqual(layoutOverviewCards([]), []);
});

test('overview height follows its visible rows and stays within panel bounds', () => {
  const single = layoutOverviewCards([{ key: 'memory', height: 104 }]);
  const full = layoutOverviewCards([
    { key: 'cpu', height: 104 }, { key: 'memory', height: 104 },
    { key: 'gpu', height: 104 }, { key: 'disk', height: 104 },
    { key: 'network', height: 126 }, { key: 'storage', height: 126 },
    { key: 'system', height: 144 }, { key: 'hardware', height: 144 },
  ]);

  assert.equal(calculateOverviewHeight([]), 170);
  assert.equal(calculateOverviewHeight(single), 190);
  assert.equal(calculateOverviewHeight(full), 588);
});
