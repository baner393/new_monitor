import crypto from 'crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalEntitlementPayload(payload) {
  return canonicalize(payload);
}

export function verifyEntitlementEnvelope(envelope, {
  publicKey,
  expectedDeviceId = '',
  nowMs = Date.now(),
} = {}) {
  if (!envelope || typeof envelope !== 'object') {
    return { valid: false, reason: 'invalid_envelope' };
  }
  if (!envelope.payload || typeof envelope.payload !== 'object' || !envelope.signature) {
    return { valid: false, reason: 'missing_payload_or_signature' };
  }
  if (!publicKey) return { valid: false, reason: 'missing_public_key' };

  const payload = envelope.payload;
  if (Number(payload.schemaVersion) !== 1 || !payload.entitlementId || !payload.deviceId || !payload.tier) {
    return { valid: false, reason: 'invalid_payload' };
  }
  if (expectedDeviceId && payload.deviceId !== expectedDeviceId) {
    return { valid: false, reason: 'device_mismatch' };
  }

  let signatureValid = false;
  try {
    signatureValid = crypto.verify(
      null,
      Buffer.from(canonicalEntitlementPayload(payload), 'utf8'),
      publicKey,
      Buffer.from(String(envelope.signature), 'base64'),
    );
  } catch {
    return { valid: false, reason: 'signature_error' };
  }
  if (!signatureValid) return { valid: false, reason: 'signature_mismatch' };

  const issuedAtMs = Date.parse(payload.issuedAt || '');
  const graceUntilMs = Date.parse(payload.graceUntil || payload.expiresAt || '');
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(graceUntilMs)) {
    return { valid: false, reason: 'invalid_time_window' };
  }
  if (issuedAtMs > Number(nowMs) + 5 * 60 * 1000) {
    return { valid: false, reason: 'issued_in_future' };
  }
  if (graceUntilMs < Number(nowMs)) {
    return { valid: false, reason: 'grace_expired' };
  }
  return { valid: true, payload };
}
