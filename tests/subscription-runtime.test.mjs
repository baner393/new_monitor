import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { canonicalEntitlementPayload } from '../src/main/entitlement-envelope.js';
import { SubscriptionRuntime } from '../src/main/subscription-runtime.js';

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'turtle-subscription-'));
}

test('device identity persists and private material is protected at rest', () => {
  const directory = temporaryDirectory();
  const protect = (value) => `protected:${Buffer.from(value).toString('base64')}`;
  const unprotect = (value) => Buffer.from(value.slice('protected:'.length), 'base64').toString();
  const first = new SubscriptionRuntime({ userDataPath: directory, protect, unprotect });
  const firstStatus = first.initialize();
  const stored = fs.readFileSync(path.join(directory, 'subscription-device.json'), 'utf8');
  assert.equal(stored.includes('PRIVATE KEY'), false);

  const second = new SubscriptionRuntime({ userDataPath: directory, protect, unprotect });
  assert.equal(second.initialize().deviceId, firstStatus.deviceId);
});

test('checkout request is device-signed and uses only an approved product', async () => {
  const calls = [];
  const runtime = new SubscriptionRuntime({
    userDataPath: temporaryDirectory(),
    config: { serviceUrl: 'https://subscriptions.example', entitlementPublicKey: 'configured-later' },
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ checkoutUrl: 'https://afdian.com/order/test', checkoutId: 'c-1' }) };
    },
  });
  runtime.initialize();
  const result = await runtime.beginCheckout('creator_yearly');
  assert.equal(result.checkoutId, 'c-1');
  assert.equal(calls[0].url, 'https://subscriptions.example/api/v1/checkouts');
  assert.equal(calls[0].body.productKey, 'creator_yearly');
  assert.equal(calls[0].body.deviceProof.payload.purpose, 'checkout');
  assert.ok(calls[0].body.deviceProof.signature);
  await assert.rejects(() => runtime.beginCheckout('creator_lifetime'), /unknown_subscription_product/);
});

test('refresh accepts only a signed envelope for the current device', async () => {
  const signing = crypto.generateKeyPairSync('ed25519');
  const publicKey = signing.publicKey.export({ type: 'spki', format: 'pem' });
  let runtime;
  const fetchImpl = async () => {
    const status = runtime.getStatus();
    const payload = {
      schemaVersion: 1,
      entitlementId: 'ent-creator',
      deviceId: status.deviceId,
      tier: 'creator',
      issuedAt: '2026-08-03T00:00:00.000Z',
      expiresAt: '2099-08-03T00:00:00.000Z',
      graceUntil: '2099-08-17T00:00:00.000Z',
    };
    return {
      ok: true,
      json: async () => ({
        envelope: {
          payload,
          signature: crypto.sign(
            null,
            Buffer.from(canonicalEntitlementPayload(payload), 'utf8'),
            signing.privateKey,
          ).toString('base64'),
        },
      }),
    };
  };
  runtime = new SubscriptionRuntime({
    userDataPath: temporaryDirectory(),
    config: { serviceUrl: 'https://subscriptions.example', entitlementPublicKey: publicKey },
    fetchImpl,
  });
  runtime.initialize();
  const status = await runtime.refresh();
  assert.equal(status.tier, 'creator');
  assert.equal(status.capabilities.creator_tools, true);
});
