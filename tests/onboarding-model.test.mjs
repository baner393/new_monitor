import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ONBOARDING_STEPS,
  ONBOARDING_VERSION,
  completeOnboardingStep,
  createDefaultOnboardingState,
  isOnboardingComplete,
  normalizeOnboardingState,
} from '../src/shared/onboarding-model.js';

test('onboarding starts with six steps across two mode sets, all incomplete', () => {
  const state = createDefaultOnboardingState();
  assert.equal(state.version, ONBOARDING_VERSION);
  assert.deepEqual(state.completedSteps, []);
  assert.equal(isOnboardingComplete(state, 'top'), false);
  assert.equal(isOnboardingComplete(state, 'cursor'), false);
  assert.equal(isOnboardingComplete(state), false);
});

test('charm lessons complete the cursor set without touching classic', () => {
  let state = createDefaultOnboardingState();
  for (const step of ['charm-follow', 'charm-ring', 'charm-agent']) {
    state = completeOnboardingStep(state, step);
  }
  assert.equal(isOnboardingComplete(state, 'cursor'), true);
  assert.equal(isOnboardingComplete(state, 'top'), false);
  // 不传 mode：任一组完成即算（向后兼容）
  assert.equal(isOnboardingComplete(state), true);
});

test('classic gestures record once and complete the top set in lesson order', () => {
  let state = createDefaultOnboardingState();
  state = completeOnboardingStep(state, 'pull-down');
  state = completeOnboardingStep(state, 'left-click');
  state = completeOnboardingStep(state, 'left-click');
  state = completeOnboardingStep(state, 'right-click');
  assert.deepEqual(state.completedSteps, ONBOARDING_STEPS.filter((s) => !s.startsWith('charm-')));
  assert.equal(isOnboardingComplete(state, 'top'), true);
  assert.equal(isOnboardingComplete(state, 'cursor'), false);
});

test('normalization drops unknown data and revives an older dismissed guide', () => {
  assert.deepEqual(normalizeOnboardingState({
    version: 0,
    completedSteps: ['left-click', 'unknown'],
    dismissed: true,
  }), {
    version: ONBOARDING_VERSION,
    completedSteps: ['left-click'],
    dismissed: false,
  });
});

