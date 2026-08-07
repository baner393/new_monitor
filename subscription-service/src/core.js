import { createHash } from 'node:crypto';

const encoder = new TextEncoder();

export const PRODUCTS = Object.freeze({
  skins_monthly: Object.freeze({ tier: 'skins', months: 1, priceCents: 100, env: 'AFDIAN_PLAN_SKINS_MONTHLY' }),
  skins_yearly: Object.freeze({ tier: 'skins', months: 12, priceCents: 900, env: 'AFDIAN_PLAN_SKINS_YEARLY' }),
  creator_monthly: Object.freeze({ tier: 'creator', months: 1, priceCents: 300, env: 'AFDIAN_PLAN_CREATOR_MONTHLY' }),
  creator_quarterly: Object.freeze({ tier: 'creator', months: 3, priceCents: 700, env: 'AFDIAN_PLAN_CREATOR_QUARTERLY' }),
  creator_yearly: Object.freeze({ tier: 'creator', months: 12, priceCents: 1900, env: 'AFDIAN_PLAN_CREATOR_YEARLY' }),
});

export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function bytesToBase64(value) {
  let binary = '';
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function pemToBytes(pem) {
  const body = String(pem || '').replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
  if (!body) throw new Error('invalid_pem');
  return base64ToBytes(body);
}

export function addMonths(iso, months) {
  const date = new Date(iso);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + Number(months));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return date.toISOString();
}

export function laterIso(...values) {
  const valid = values.filter((value) => Number.isFinite(Date.parse(value || '')));
  return valid.sort((left, right) => Date.parse(right) - Date.parse(left))[0] || new Date(0).toISOString();
}

export function buildPlanMap(env) {
  const map = new Map();
  for (const [key, product] of Object.entries(PRODUCTS)) {
    const planId = String(env[product.env] || '').trim();
    if (planId) map.set(planId, { key, ...product });
  }
  return map;
}

export function createCheckoutId(random = crypto.getRandomValues.bind(crypto)) {
  const bytes = new Uint8Array(18);
  random(bytes);
  return `tm_${bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

export function formatAmountCents(value) {
  return Math.round(Number(value) * 100);
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyDeviceProof(proof, purpose, nowMs = Date.now()) {
  if (!proof?.payload || !proof?.signature || !proof?.publicKey) throw new Error('invalid_device_proof');
  const payload = proof.payload;
  if (payload.schemaVersion !== 1 || payload.purpose !== purpose || !payload.deviceId || !payload.timestamp || !payload.nonce) {
    throw new Error('invalid_device_proof');
  }
  const timestamp = Date.parse(payload.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(nowMs - timestamp) > 5 * 60 * 1000) throw new Error('expired_device_proof');
  const publicKeyBytes = pemToBytes(proof.publicKey);
  const deviceId = await sha256Hex(publicKeyBytes);
  if (deviceId !== payload.deviceId) throw new Error('device_identity_mismatch');
  const publicKey = await crypto.subtle.importKey('spki', publicKeyBytes, { name: 'Ed25519' }, false, ['verify']);
  const valid = await crypto.subtle.verify('Ed25519', publicKey, base64ToBytes(proof.signature), encoder.encode(canonicalize(payload)));
  if (!valid) throw new Error('invalid_device_signature');
  return { deviceId, publicKey: proof.publicKey, payload };
}

export async function signEntitlement(payload, privateKeyPem) {
  const privateKey = await crypto.subtle.importKey('pkcs8', pemToBytes(privateKeyPem), { name: 'Ed25519' }, false, ['sign']);
  const signature = await crypto.subtle.sign('Ed25519', privateKey, encoder.encode(canonicalize(payload)));
  return { payload, signature: bytesToBase64(signature) };
}

export async function md5Hex(value) {
  return createHash('md5').update(value).digest('hex');
}

export function afdianSignatureSource({ token, params, timestamp, userId }) {
  return `${token}params${params}ts${timestamp}user_id${userId}`;
}
