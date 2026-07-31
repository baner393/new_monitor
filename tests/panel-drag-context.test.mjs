import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PANEL_DRAG_CONTEXT,
  resolvePanelDragContext,
  resolvePanelDragSettledState,
} from '../src/renderer/panel-drag-context.js';

test('all Codex follow panels participate in attached-panel stable movement', () => {
  assert.equal(resolvePanelDragContext({ codexFollowPanelOpen: true }), PANEL_DRAG_CONTEXT.CODEX);
  assert.equal(resolvePanelDragSettledState(PANEL_DRAG_CONTEXT.CODEX), 'IDLE');
});

test('the monitor panel keeps precedence and returns to its open state', () => {
  const context = resolvePanelDragContext({ monitorPanelOpen: true, codexFollowPanelOpen: true });
  assert.equal(context, PANEL_DRAG_CONTEXT.MONITOR);
  assert.equal(resolvePanelDragSettledState(context), 'PANEL_OPEN');
  assert.equal(resolvePanelDragContext(), null);
});
