export const PANEL_DRAG_CONTEXT = Object.freeze({
  MONITOR: 'monitor',
  CODEX: 'codex',
});

export function resolvePanelDragContext({ monitorPanelOpen = false, codexConversationOpen = false } = {}) {
  if (monitorPanelOpen) return PANEL_DRAG_CONTEXT.MONITOR;
  if (codexConversationOpen) return PANEL_DRAG_CONTEXT.CODEX;
  return null;
}

export function resolvePanelDragSettledState(context) {
  return context === PANEL_DRAG_CONTEXT.MONITOR ? 'PANEL_OPEN' : 'IDLE';
}
