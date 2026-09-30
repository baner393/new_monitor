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

test('onboarding starts with the three core pet gestures incomplete', () => {
  const state = createDefaultOnboardingState();
  assert.equal(state.version, ONBOARDING_VERSION);
  assert.deepEqual(state.completedSteps, []);
  assert.equal(isOnboardingComplete(state), false);
});

test('onboarding records gestures once and in lesson order', () => {
  let state = createDefaultOnboardingState();
  state = completeOnboardingStep(state, 'pull-down');
  state = completeOnboardingStep(state, 'left-click');
  state = completeOnboardingStep(state, 'left-click');
  state = completeOnboardingStep(state, 'right-click');
  assert.deepEqual(state.completedSteps, ONBOARDING_STEPS);
  assert.equal(isOnboardingComplete(state), true);
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

