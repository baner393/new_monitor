export const ONBOARDING_VERSION = 1;

export const ONBOARDING_STEPS = Object.freeze([
  'left-click',
  'pull-down',
  'right-click',
]);

export function createDefaultOnboardingState() {
  return {
    version: ONBOARDING_VERSION,
    completedSteps: [],
    dismissed: false,
  };
}

export function normalizeOnboardingState(value) {
  const source = value && typeof value === 'object' ? value : {};
  const completed = new Set(
    Array.isArray(source.completedSteps)
      ? source.completedSteps.filter((step) => ONBOARDING_STEPS.includes(step))
      : [],
  );
  const previousVersion = Number.isInteger(source.version) ? source.version : 0;

  return {
    version: ONBOARDING_VERSION,
    completedSteps: ONBOARDING_STEPS.filter((step) => completed.has(step)),
    // A newer guide may add one small lesson. It should still be discoverable
    // when the previous guide version was skipped.
    dismissed: previousVersion >= ONBOARDING_VERSION && source.dismissed === true,
  };
}

export function completeOnboardingStep(value, step) {
  const state = normalizeOnboardingState(value);
  if (!ONBOARDING_STEPS.includes(step) || state.completedSteps.includes(step)) return state;
  return {
    ...state,
    completedSteps: ONBOARDING_STEPS.filter((item) => (
      item === step || state.completedSteps.includes(item)
    )),
    dismissed: false,
  };
}

export function isOnboardingComplete(value) {
  const state = normalizeOnboardingState(value);
  return ONBOARDING_STEPS.every((step) => state.completedSteps.includes(step));
}

