import test from 'node:test';
import assert from 'node:assert/strict';

import { OnboardingGuide } from '../src/renderer/onboarding-guide.js';
import {
  completeOnboardingStep,
  createDefaultOnboardingState,
} from '../src/shared/onboarding-model.js';

class TestElement {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
  }

  setAttribute() {}
  addEventListener() {}
  append(...nodes) { this.children.push(...nodes); }
  contains(target) { return this === target || this.children.some((child) => child.contains(target)); }
  getBoundingClientRect() { return { height: 176, left: 0, right: 310, top: 0, bottom: 176 }; }
}

test('does not auto-start from an anchor-mode change before persisted onboarding state loads', async () => {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  let resolveSettings;
  const savedState = ['charm-follow', 'charm-ring', 'charm-agent']
    .reduce((state, step) => completeOnboardingStep(state, step), createDefaultOnboardingState());
  let charmMode = false;
  globalThis.document = {
    body: new TestElement(),
    createElement: () => new TestElement(),
    addEventListener() {},
  };
  globalThis.window = { innerWidth: 1280, innerHeight: 720 };
  globalThis.requestAnimationFrame = (callback) => callback();

  try {
    const guide = new OnboardingGuide({
      settings: { get: () => new Promise((resolve) => { resolveSettings = resolve; }) },
      isCharmMode: () => charmMode,
    });
    const initializing = guide.initialize(0);

    // Startup applies saved anchorMode while the independent settings read is pending.
    charmMode = true;
    guide.onAnchorModeChanged();
    resolveSettings({ onboarding: savedState });
    await initializing;

    assert.equal(guide.active, false);
    assert.equal(guide.isVisible, false);
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete globalThis[key];
      else globalThis[key] = previous[key];
    }
  }
});
