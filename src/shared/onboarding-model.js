/**
 * onboarding-model.js — 新手指引状态（纯数据，无依赖，可单测）
 *
 * v2：经典（顶边悬挂）与挂饰（跟随鼠标）各有一套三课指引。
 * 完成状态按步骤记录在统一列表；「完成」按当前模式的步骤组判定——
 * 挂饰是默认形态，新用户只学挂饰三课；经典老用户切到挂饰时补学挂饰课。
 * 旧版本（v1）跳过过的用户在新版本会重新看到指引（含新课程）。
 */

export const ONBOARDING_VERSION = 2;

export const CLASSIC_ONBOARDING_STEPS = Object.freeze(['left-click', 'pull-down', 'right-click']);
export const CHARM_ONBOARDING_STEPS = Object.freeze(['charm-follow', 'charm-ring', 'charm-agent']);
export const ONBOARDING_STEPS = Object.freeze([...CLASSIC_ONBOARDING_STEPS, ...CHARM_ONBOARDING_STEPS]);

export const ONBOARDING_STEP_SETS = Object.freeze({
  top: CLASSIC_ONBOARDING_STEPS,
  cursor: CHARM_ONBOARDING_STEPS,
});

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
    Array.isArray(source.completedSteps) ? source.completedSteps : [],
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

/**
 * 按 anchorMode 判定完成：'top' 查经典组，'cursor' 查挂饰组；
 * 不传 mode 时任一组完成即算（向后兼容旧调用点）。
 */
export function isOnboardingComplete(value, anchorMode = null) {
  const state = normalizeOnboardingState(value);
  const steps = anchorMode && ONBOARDING_STEP_SETS[anchorMode] ? ONBOARDING_STEP_SETS[anchorMode] : null;
  if (!steps) {
    return ONBOARDING_STEP_SETS.top.every((step) => state.completedSteps.includes(step))
      || ONBOARDING_STEP_SETS.cursor.every((step) => state.completedSteps.includes(step));
  }
  return steps.every((step) => state.completedSteps.includes(step));
}
