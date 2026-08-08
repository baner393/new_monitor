import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  SUBSCRIPTION_CAPABILITY,
  SUBSCRIPTION_TIER,
  hasSubscriptionCapability,
  productForKey,
  resolveSubscriptionSnapshot,
} from '../src/shared/subscription-model.js';
import {
  canonicalEntitlementPayload,
  verifyEntitlementEnvelope,
} from '../src/main/entitlement-envelope.js';

const NOW = Date.parse('2026-08-03T12:00:00.000Z');

test('free state exposes only the core capability', () => {
  const snapshot = resolveSubscriptionSnapshot({}, NOW);
  assert.equal(snapshot.tier, SUBSCRIPTION_TIER.FREE);
  assert.equal(hasSubscriptionCapability(snapshot, SUBSCRIPTION_CAPABILITY.CORE), true);
  assert.equal(hasSubscriptionCapability(snapshot, SUBSCRIPTION_CAPABILITY.SKIN_UPDATES), false);
  assert.equal(hasSubscriptionCapability(snapshot, SUBSCRIPTION_CAPABILITY.CREATOR_TOOLS), false);
});

test('skin membership grants skin updates but not creator tools', () => {
  const snapshot = resolveSubscriptionSnapshot({
    entitlements: [{ id: 'skin-1', tier: 'skins', expiresAt: '2026-09-03T12:00:00.000Z' }],
  }, NOW);
  assert.equal(snapshot.tier, SUBSCRIPTION_TIER.SKINS);
  assert.equal(snapshot.capabilities.skin_updates, true);
  assert.equal(snapshot.capabilities.creator_tools, false);
});

test('creator membership includes skin updates and pauses overlapping skin time', () => {
  const snapshot = resolveSubscriptionSnapshot({
    entitlements: [
      { id: 'skin-1', tier: 'skins', expiresAt: '2026-09-03T12:00:00.000Z' },
      { id: 'creator-1', tier: 'creator', expiresAt: '2026-08-10T12:00:00.000Z' },
    ],
  }, NOW);
  assert.equal(snapshot.tier, SUBSCRIPTION_TIER.CREATOR);
  assert.equal(snapshot.capabilities.skin_updates, true);
  assert.equal(snapshot.capabilities.creator_tools, true);
  assert.equal(snapshot.skinTimePaused, true);
});

test('expired creator keeps the active custom skin but locks creator tools', () => {
  const snapshot = resolveSubscriptionSnapshot({
    entitlements: [{
      id: 'creator-old',
      tier: 'creator',
      expiresAt: '2026-07-01T00:00:00.000Z',
      graceUntil: '2026-07-15T00:00:00.000Z',
    }],
  }, NOW);
  assert.equal(snapshot.tier, SUBSCRIPTION_TIER.FREE);
  assert.equal(snapshot.capabilities.creator_tools, false);
  assert.equal(snapshot.capabilities.custom_skin_switching, false);
  assert.equal(snapshot.capabilities.retain_active_custom_skin, true);
});

test('refunded entitlement does not receive a grace period', () => {
  const snapshot = resolveSubscriptionSnapshot({
    entitlements: [{
      id: 'creator-refund',
      tier: 'creator',
      expiresAt: '2027-01-01T00:00:00.000Z',
      graceUntil: '2027-02-01T00:00:00.000Z',
      refunded: true,
    }],
  }, NOW);
  assert.equal(snapshot.tier, SUBSCRIPTION_TIER.FREE);
  assert.equal(snapshot.capabilities.creator_tools, false);
  assert.equal(snapshot.capabilities.retain_active_custom_skin, true);
});

test('legacy sponsor build remains available during migration', () => {
  const snapshot = resolveSubscriptionSnapshot({ legacySponsor: true }, NOW);
  assert.equal(snapshot.tier, SUBSCRIPTION_TIER.CREATOR);
  assert.equal(snapshot.capabilities.creator_tools, true);
});

test('published products match the approved price ladder', () => {
  assert.deepEqual(productForKey('skins_monthly'), { tier: 'skins', months: 1, priceCny: 1 });
  assert.deepEqual(productForKey('skins_yearly'), { tier: 'skins', months: 12, priceCny: 9.8 });
  assert.deepEqual(productForKey('creator_monthly'), { tier: 'creator', months: 1, priceCny: 4.2 });
  assert.deepEqual(productForKey('creator_quarterly'), { tier: 'creator', months: 3, priceCny: 7.7 });
  assert.deepEqual(productForKey('creator_yearly'), { tier: 'creator', months: 12, priceCny: 24.5 });
});

test('Ed25519 entitlement envelope is canonical, device-bound and time-bound', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const payload = {
    tier: 'creator',
    schemaVersion: 1,
    entitlementId: 'ent-1',
    deviceId: 'device-a',
    issuedAt: '2026-08-03T11:00:00.000Z',
    expiresAt: '2026-08-10T12:00:00.000Z',
    graceUntil: '2026-08-24T12:00:00.000Z',
  };
  const signature = crypto.sign(
    null,
    Buffer.from(canonicalEntitlementPayload(payload), 'utf8'),
    privateKey,
  ).toString('base64');
  const envelope = { payload, signature };

  assert.equal(verifyEntitlementEnvelope(envelope, {
    publicKey,
    expectedDeviceId: 'device-a',
    nowMs: NOW,
  }).valid, true);
  assert.equal(verifyEntitlementEnvelope(envelope, {
    publicKey,
    expectedDeviceId: 'device-b',
    nowMs: NOW,
  }).reason, 'device_mismatch');

  const tampered = { payload: { ...payload, tier: 'skins' }, signature };
  assert.equal(verifyEntitlementEnvelope(tampered, {
    publicKey,
    expectedDeviceId: 'device-a',
    nowMs: NOW,
  }).reason, 'signature_mismatch');
});
