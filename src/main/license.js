/**
 * RSA License Verification Module
 * 
 * Verifies a signed license file against a public key.
 * Checks:
 *   1. Cryptographic signature validity (SHA256)
 *   2. Device ID match (os.hostname() + os.platform() + os.arch() SHA256 hash)
 *   3. Expiration date
 *
 * Exports: verifyLicense(publicKeyPath, licensePath) => { valid: boolean, reason?: string }
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';

/**
 * Compute the local device fingerprint.
 * Uses a simple SHA256 hash of hostname + platform + arch.
 * @returns {string} hex-encoded SHA256 digest
 */
function getDeviceId() {
  const raw = os.hostname() + os.platform() + os.arch();
  return crypto.createHash('SHA256').update(raw).digest('hex');
}

/**
 * Verify a license file.
 *
 * @param {string} publicKeyPath - Path to the RSA public key PEM file
 * @param {string} licensePath   - Path to the license JSON file
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifyLicense(publicKeyPath, licensePath) {
  // ── File existence checks ────────────────────────────────────
  if (!fs.existsSync(publicKeyPath)) {
    return { valid: false, reason: `Public key not found: ${publicKeyPath}` };
  }
  if (!fs.existsSync(licensePath)) {
    return { valid: false, reason: `License file not found: ${licensePath}` };
  }

  let license;
  try {
    const raw = fs.readFileSync(licensePath, 'utf-8');
    license = JSON.parse(raw);
  } catch (err) {
    return { valid: false, reason: `Failed to parse license file: ${err.message}` };
  }

  // ── Validate license structure ──────────────────────────────
  if (!license.data || !license.signature) {
    return { valid: false, reason: 'Invalid license format: missing data or signature' };
  }

  const { data, signature } = license;

  if (!data.deviceId || !data.expiresAt || !data.edition || !data.issuedAt) {
    return { valid: false, reason: 'Invalid license data: missing required fields' };
  }

  // ── Cryptographic signature verification ────────────────────
  let publicKey;
  try {
    publicKey = fs.readFileSync(publicKeyPath, 'utf-8');
  } catch (err) {
    return { valid: false, reason: `Failed to read public key: ${err.message}` };
  }

  const verifier = crypto.createVerify('SHA256');
  verifier.update(JSON.stringify(data));
  verifier.end();

  const isValid = verifier.verify(publicKey, signature, 'base64');
  if (!isValid) {
    return { valid: false, reason: 'Signature mismatch — license is not authentic' };
  }

  // ── Device ID check ─────────────────────────────────────────
  const localDeviceId = getDeviceId();
  if (data.deviceId !== localDeviceId) {
    return {
      valid: false,
      reason: `Device ID mismatch: license is for "${data.deviceId}", this device is "${localDeviceId}"`,
    };
  }

  // ── Expiration check ────────────────────────────────────────
  const expiresAt = new Date(data.expiresAt);
  if (isNaN(expiresAt.getTime())) {
    return { valid: false, reason: `Invalid expiresAt date: ${data.expiresAt}` };
  }
  if (expiresAt < new Date()) {
    return { valid: false, reason: `License expired on ${data.expiresAt}` };
  }

  // ── All checks passed ───────────────────────────────────────
  return { valid: true };
}

// ── Self-test when run directly ─────────────────────────────────
// Usage: node src/main/license.js <publicKeyPath> <licensePath>
const isMain = process.argv[1] && (
  process.argv[1].endsWith('license.js') || process.argv[1].endsWith('license.mjs')
);

if (isMain && process.argv.length >= 4) {
  const pubKeyPath = process.argv[2];
  const licPath = process.argv[3];
  const result = verifyLicense(pubKeyPath, licPath);
  console.log(JSON.stringify(result, null, 2));
}