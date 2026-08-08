import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  PRODUCTS,
  addMonths,
  afdianSignatureSource,
  buildPlanMap,
  canonicalize,
  createCheckoutId,
  md5Hex,
  signEntitlement,
  verifyDeviceProof,
} from '../src/core.js';
import { verifyEntitlementEnvelope } from '../../src/main/entitlement-envelope.js';

test('plan mapping uses only the approved five Afdian plans', () => {
  const env = {};
  for (const [key, product] of Object.entries(PRODUCTS)) env[product.env] = `plan-${key}`;
  const plans = buildPlanMap(env);
  assert.equal(plans.size, 5);
  assert.deepEqual(plans.get('plan-creator_yearly'), {
    key: 'creator_yearly', tier: 'creator', months: 12, priceCents: 2450, env: 'AFDIAN_PLAN_CREATOR_YEARLY',
  });
});

test('checkout IDs are URL-safe and a calendar month does not overflow', () => {
  const id = createCheckoutId((bytes) => bytes.fill(255));
  assert.match(id, /^tm_[A-Za-z0-9_-]+$/);
  assert.equal(addMonths('2026-01-31T12:00:00.000Z', 1), '2026-02-28T12:00:00.000Z');
});

test('device proof is tied to the public key, purpose, freshness, and canonical payload', async () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const publicDer = pair.publicKey.export({ type: 'spki', format: 'der' });
  const deviceId = crypto.createHash('sha256').update(publicDer).digest('hex');
  const payload = {
    schemaVersion: 1,
    purpose: 'refresh',
    deviceId,
    timestamp: new Date().toISOString(),
    nonce: 'proof-nonce',
  };
  const signature = crypto.sign(null, Buffer.from(canonicalize(payload)), pair.privateKey).toString('base64');
  const proof = { payload, signature, publicKey };
  assert.equal((await verifyDeviceProof(proof, 'refresh')).deviceId, deviceId);
  await assert.rejects(() => verifyDeviceProof(proof, 'checkout'), /invalid_device_proof/);
});

test('server entitlement signature is accepted by the Electron verifier', async () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const payload = {
    schemaVersion: 1,
    entitlementId: 'member:device:creator',
    deviceId: 'device',
    tier: 'creator',
    issuedAt: new Date().toISOString(),
    expiresAt: '2099-01-01T00:00:00.000Z',
    graceUntil: '2099-01-15T00:00:00.000Z',
  };
  const envelope = await signEntitlement(payload, privateKey);
  assert.equal(verifyEntitlementEnvelope(envelope, { publicKey, expectedDeviceId: 'device' }).valid, true);
});

test('Afdian signature source preserves the documented key order', async () => {
  const source = afdianSignatureSource({ token: 'token', params: '{"page":1}', timestamp: 123, userId: 'creator' });
  assert.equal(source, 'tokenparams{"page":1}ts123user_idcreator');
  assert.equal(await md5Hex(source), '6137b61e15d1c6a5d17136ff14c68118');
});
