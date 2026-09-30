import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateOverviewHeight,
  layoutDashboardCards,
  layoutOverviewCards,
} from '../src/renderer/panel-layout.js';

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

test('dashboard layout gives storage a full row and centers the final half card', () => {
  const layout = layoutDashboardCards([
    { key: 'cpu', height: 104 },
    { key: 'memory', height: 104 },
    { key: 'storage', height: 132, span: 2 },
    { key: 'battery', height: 104 },
  ]);
  assert.deepEqual(layout.map(({ key, x, y, width }) => ({ key, x, y, width })), [
    { key: 'cpu', x: 20, y: 66, width: 322 },
    { key: 'memory', x: 358, y: 66, width: 322 },
    { key: 'storage', x: 20, y: 178, width: 660 },
    { key: 'battery', x: 189, y: 318, width: 322 },
  ]);
});

test('dashboard layout centers an incomplete half row before a full-width card', () => {
  const placements = layoutDashboardCards([
    { key: 'network', height: 100 },
    { key: 'storage', height: 140, span: 2 },
  ]);
  assert.equal(placements[0].x, (700 - placements[0].width) / 2);
  assert.equal(placements[1].width, 660);
});
