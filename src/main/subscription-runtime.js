import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import {
  SUBSCRIPTION_CAPABILITY,
  SUBSCRIPTION_PRODUCTS,
  hasSubscriptionCapability,
  resolveSubscriptionSnapshot,
} from '../shared/subscription-model.js';
import { canonicalEntitlementPayload, verifyEntitlementEnvelope } from './entitlement-envelope.js';

const STATE_FILE = 'subscription-state.json';
const DEVICE_FILE = 'subscription-device.json';

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function safeJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function cleanServiceUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function publicDeviceId(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const der = key.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex');
}

export class SubscriptionRuntime {
  constructor({
    userDataPath,
    legacySponsor = false,
    appVersion = '0.0.0',
    config = {},
    protect = (value) => Buffer.from(value, 'utf8').toString('base64'),
    unprotect = (value) => Buffer.from(value, 'base64').toString('utf8'),
    fetchImpl = globalThis.fetch,
  }) {
    this.userDataPath = userDataPath;
    this.legacySponsor = Boolean(legacySponsor);
    this.appVersion = String(appVersion || '0.0.0');
    this.config = {
      serviceUrl: cleanServiceUrl(config.serviceUrl),
      entitlementPublicKey: String(config.entitlementPublicKey || '').trim(),
    };
    this.protect = protect;
    this.unprotect = unprotect;
    this.fetchImpl = fetchImpl;
    this.statePath = path.join(userDataPath, STATE_FILE);
    this.devicePath = path.join(userDataPath, DEVICE_FILE);
    this.device = null;
    this.entitlement = null;
    this.lastError = '';
  }

  initialize() {
    this.device = this.#loadOrCreateDevice();
    const stored = safeJson(this.statePath, {});
    if (stored.envelope && this.config.entitlementPublicKey) {
      const verified = verifyEntitlementEnvelope(stored.envelope, {
        publicKey: this.config.entitlementPublicKey,
        expectedDeviceId: this.device.id,
      });
      if (verified.valid) this.entitlement = verified.payload;
      else this.lastError = verified.reason;
    }
    return this.getStatus();
  }

  #loadOrCreateDevice() {
    const stored = safeJson(this.devicePath, null);
    if (stored?.publicKey && stored?.protectedPrivateKey) {
      try {
        const privateKey = this.unprotect(stored.protectedPrivateKey);
        const id = publicDeviceId(stored.publicKey);
        return { id, publicKey: stored.publicKey, privateKey };
      } catch {
        // Generate a replacement identity if secure local storage was reset.
      }
    }

    const pair = crypto.generateKeyPairSync('ed25519');
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
    const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const protectedPrivateKey = this.protect(privateKey);
    atomicWriteJson(this.devicePath, {
      schemaVersion: 1,
      publicKey,
      protectedPrivateKey,
      createdAt: new Date().toISOString(),
    });
    return { id: publicDeviceId(publicKey), publicKey, privateKey };
  }

  #stateForSnapshot() {
    return {
      legacySponsor: this.legacySponsor,
      deviceLimit: 2,
      activeDevices: Number(this.entitlement?.activeDevices || 0),
      entitlements: this.entitlement ? [{
        id: this.entitlement.entitlementId,
        tier: this.entitlement.tier,
        expiresAt: this.entitlement.expiresAt,
        graceUntil: this.entitlement.graceUntil,
        revoked: this.entitlement.revoked,
        refunded: this.entitlement.refunded,
      }] : [],
    };
  }

  getStatus(nowMs = Date.now()) {
    const snapshot = resolveSubscriptionSnapshot(this.#stateForSnapshot(), nowMs);
    return {
      ...snapshot,
      serviceConfigured: Boolean(this.config.serviceUrl && this.config.entitlementPublicKey),
      deviceId: this.device?.id || '',
      lastError: this.lastError,
      products: SUBSCRIPTION_PRODUCTS,
    };
  }

  has(capability, nowMs = Date.now()) {
    return hasSubscriptionCapability(this.getStatus(nowMs), capability);
  }

  hasCreatorAccess(nowMs = Date.now()) {
    return this.has(SUBSCRIPTION_CAPABILITY.CREATOR_TOOLS, nowMs);
  }

  #signedDeviceProof(purpose) {
    const payload = {
      schemaVersion: 1,
      purpose,
      deviceId: this.device.id,
      timestamp: new Date().toISOString(),
      nonce: crypto.randomBytes(18).toString('base64url'),
    };
    const signature = crypto.sign(
      null,
      Buffer.from(canonicalEntitlementPayload(payload), 'utf8'),
      this.device.privateKey,
    ).toString('base64');
    return { payload, signature, publicKey: this.device.publicKey };
  }

  async #post(route, body) {
    if (!this.config.serviceUrl || typeof this.fetchImpl !== 'function') {
      throw new Error('subscription_service_not_configured');
    }
    const response = await this.fetchImpl(`${this.config.serviceUrl}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `subscription_service_${response.status}`);
    return data;
  }

  async getSkinCatalog() {
    if (!this.config.serviceUrl || typeof this.fetchImpl !== 'function') throw new Error('subscription_service_not_configured');
    const response = await this.fetchImpl(`${this.config.serviceUrl}/api/v1/skins/catalog`, {
      headers: { accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.skins)) throw new Error(data.error || `skin_catalog_${response.status}`);
    return data;
  }

  async downloadSkinPackage(skinId, version) {
    const response = await this.fetchImpl(`${this.config.serviceUrl}/api/v1/skins/${encodeURIComponent(skinId)}/${encodeURIComponent(version)}/download`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceProof: this.#signedDeviceProof('skin_download') }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `skin_download_${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async beginCheckout(productKey) {
    if (!SUBSCRIPTION_PRODUCTS[productKey]) throw new Error('unknown_subscription_product');
    const result = await this.#post('/api/v1/checkouts', {
      productKey,
      appVersion: this.appVersion,
      deviceProof: this.#signedDeviceProof('checkout'),
    });
    if (!result.checkoutUrl || !result.checkoutId) throw new Error('invalid_checkout_response');
    return {
      checkoutUrl: result.checkoutUrl,
      checkoutId: result.checkoutId,
      bindingCode: String(result.bindingCode || ''),
      expiresAt: String(result.expiresAt || ''),
    };
  }

  async refresh() {
    try {
      const result = await this.#post('/api/v1/entitlements/refresh', {
        appVersion: this.appVersion,
        deviceProof: this.#signedDeviceProof('refresh'),
      });
      const verified = verifyEntitlementEnvelope(result.envelope, {
        publicKey: this.config.entitlementPublicKey,
        expectedDeviceId: this.device.id,
      });
      if (!verified.valid) throw new Error(verified.reason);
      this.entitlement = verified.payload;
      this.lastError = '';
      atomicWriteJson(this.statePath, {
        schemaVersion: 1,
        envelope: result.envelope,
        refreshedAt: new Date().toISOString(),
      });
      return this.getStatus();
    } catch (error) {
      this.lastError = String(error?.message || error);
      throw error;
    }
  }
}

export function loadSubscriptionConfig({ appPath, resourcesPath, isPackaged }) {
  const candidates = isPackaged
    ? [path.join(resourcesPath, 'subscription', 'config.json')]
    : [path.join(appPath, 'resources', 'subscription', 'config.json')];
  for (const candidate of candidates) {
    const config = safeJson(candidate, null);
    if (config) return config;
  }
  return {};
}
