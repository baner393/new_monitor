export const SUBSCRIPTION_TIER = Object.freeze({
  FREE: 'free',
  SKINS: 'skins',
  CREATOR: 'creator',
});

export const SUBSCRIPTION_CAPABILITY = Object.freeze({
  CORE: 'core',
  SKIN_UPDATES: 'skin_updates',
  CREATOR_TOOLS: 'creator_tools',
  CUSTOM_SKIN_SWITCHING: 'custom_skin_switching',
  RETAIN_ACTIVE_CUSTOM_SKIN: 'retain_active_custom_skin',
});

export const SUBSCRIPTION_PRODUCTS = Object.freeze({
  skins_monthly: Object.freeze({ tier: SUBSCRIPTION_TIER.SKINS, months: 1, priceCny: 1 }),
  skins_yearly: Object.freeze({ tier: SUBSCRIPTION_TIER.SKINS, months: 12, priceCny: 9.8 }),
  creator_monthly: Object.freeze({ tier: SUBSCRIPTION_TIER.CREATOR, months: 1, priceCny: 4.2 }),
  creator_quarterly: Object.freeze({ tier: SUBSCRIPTION_TIER.CREATOR, months: 3, priceCny: 7.7 }),
  creator_yearly: Object.freeze({ tier: SUBSCRIPTION_TIER.CREATOR, months: 12, priceCny: 24.5 }),
});

const VALID_TIERS = new Set(Object.values(SUBSCRIPTION_TIER));
const ACTIVE_STATUSES = new Set(['active', 'grace']);

function finiteTimestamp(value) {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeTier(value) {
  const tier = String(value || '').trim().toLowerCase();
  return VALID_TIERS.has(tier) ? tier : SUBSCRIPTION_TIER.FREE;
}

function entitlementWindow(record = {}, nowMs) {
  const expiresAtMs = finiteTimestamp(record.expiresAtMs || record.expiresAt);
  const graceUntilMs = Math.max(
    expiresAtMs,
    finiteTimestamp(record.graceUntilMs || record.graceUntil),
  );
  const revoked = record.revoked === true || record.refunded === true;
  if (revoked) return { status: 'revoked', expiresAtMs, graceUntilMs, active: false };
  if (!expiresAtMs || nowMs <= expiresAtMs) {
    return { status: 'active', expiresAtMs, graceUntilMs, active: true };
  }
  if (graceUntilMs && nowMs <= graceUntilMs) {
    return { status: 'grace', expiresAtMs, graceUntilMs, active: true };
  }
  return { status: 'expired', expiresAtMs, graceUntilMs, active: false };
}

/**
 * Resolve stored subscription records into one renderer-safe capability snapshot.
 * Creator access includes skin updates. When creator access ends, locally-created
 * work remains intact and the last applied custom skin can keep rendering.
 */
export function resolveSubscriptionSnapshot(state = {}, nowMs = Date.now()) {
  const normalizedNow = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const records = Array.isArray(state.entitlements) ? state.entitlements : [];
  const evaluated = records.map((record) => {
    const window = entitlementWindow(record, normalizedNow);
    return {
      id: String(record.id || ''),
      tier: normalizeTier(record.tier),
      ...window,
    };
  });

  if (state.legacySponsor === true) {
    evaluated.push({
      id: 'legacy-sponsor-development',
      tier: SUBSCRIPTION_TIER.CREATOR,
      status: 'active',
      expiresAtMs: 0,
      graceUntilMs: 0,
      active: true,
    });
  }

  const creator = evaluated.find((entry) => entry.active && entry.tier === SUBSCRIPTION_TIER.CREATOR);
  const skins = evaluated.find((entry) => entry.active && entry.tier === SUBSCRIPTION_TIER.SKINS);
  const hadCreator = evaluated.some((entry) => entry.tier === SUBSCRIPTION_TIER.CREATOR);
  const tier = creator
    ? SUBSCRIPTION_TIER.CREATOR
    : skins
      ? SUBSCRIPTION_TIER.SKINS
      : SUBSCRIPTION_TIER.FREE;
  const status = creator?.status || skins?.status || 'free';
  const activeRecord = creator || skins || null;

  const capabilities = {
    [SUBSCRIPTION_CAPABILITY.CORE]: true,
    [SUBSCRIPTION_CAPABILITY.SKIN_UPDATES]: Boolean(creator || skins),
    [SUBSCRIPTION_CAPABILITY.CREATOR_TOOLS]: Boolean(creator),
    [SUBSCRIPTION_CAPABILITY.CUSTOM_SKIN_SWITCHING]: Boolean(creator),
    [SUBSCRIPTION_CAPABILITY.RETAIN_ACTIVE_CUSTOM_SKIN]: hadCreator,
  };

  return Object.freeze({
    schemaVersion: 1,
    tier,
    status,
    capabilities: Object.freeze(capabilities),
    expiresAtMs: activeRecord?.expiresAtMs || 0,
    graceUntilMs: activeRecord?.graceUntilMs || 0,
    deviceLimit: Math.max(1, Number(state.deviceLimit) || 2),
    activeDevices: Math.max(0, Number(state.activeDevices) || 0),
    skinTimePaused: Boolean(creator && skins),
  });
}

export function hasSubscriptionCapability(snapshot, capability) {
  return snapshot?.capabilities?.[capability] === true;
}

export function productForKey(productKey) {
  return SUBSCRIPTION_PRODUCTS[String(productKey || '')] || null;
}

export function subscriptionDurationLabel(productKey) {
  const product = productForKey(productKey);
  if (!product) return '';
  if (product.months === 1) return '1 个月';
  if (product.months === 3) return '1 个季度';
  if (product.months === 12) return '1 年';
  return `${product.months} 个月`;
}

export function isActiveSubscriptionStatus(status) {
  return ACTIVE_STATUSES.has(String(status || ''));
}
