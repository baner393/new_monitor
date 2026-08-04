const CAPTURE_STATES = new Set([
  'PULLING',
  'PULLEY_DRAG',
  'PANEL_OPEN',
  'EXPANDING',
  'COLLAPSING',
  'HAPPY',
  'CODEX_CONFIG_OPENING',
  'CODEX_CONFIG_OPEN',
  'CODEX_CONFIG_CLOSING',
]);

/**
 * Resolve the full-screen transparent window's input mode from one snapshot.
 * `true` means clicks pass through to the desktop; `false` means Monitor owns
 * input. Keeping this decision pure prevents delayed close callbacks from
 * overriding a different surface that is still open.
 */
export function resolveMousePassthrough({
  state,
  capturesOutsideClicks = false,
  settingsOpen = false,
  settingsAnimating = false,
  subscriptionOpen = false,
  skinSelectorOpen = false,
  overSprite = false,
  overCompanion = false,
  overOnboarding = false,
} = {}) {
  if (CAPTURE_STATES.has(state)
    || capturesOutsideClicks
    || settingsOpen
    || settingsAnimating
    || subscriptionOpen
    || skinSelectorOpen) {
    return false;
  }

  return !(overSprite || overCompanion || overOnboarding);
}

