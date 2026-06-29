#!/usr/bin/env node
/**
 * CLI License Signing Tool
 * Usage: node scripts/sign-license.js <deviceId> [outputPath]
 *
 * Reads keys/private.pem, signs a license JSON with SHA256,
 * writes { data: { deviceId, expiresAt, edition, issuedAt }, signature: "base64" }
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// ── CLI Args ────────────────────────────────────────────────────
const deviceId = process.argv[2];
const outputPath = process.argv[3] || path.join(process.cwd(), 'license.json');

if (!deviceId) {
  console.error('Usage: node scripts/sign-license.js <deviceId> [outputPath]');
  process.exit(1);
}

// ── Read private key ────────────────────────────────────────────
const privateKeyPath = path.join(projectRoot, 'keys', 'private.pem');
if (!fs.existsSync(privateKeyPath)) {
  console.error(`[sign-license] Private key not found at: ${privateKeyPath}`);
  process.exit(1);
}
const privateKey = fs.readFileSync(privateKeyPath, 'utf-8');

// ── Generate License Data ───────────────────────────────────────
const now = new Date();
const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year

const licenseData = {
  deviceId,
  expiresAt: expiresAt.toISOString(),
  edition: 'sponsor',
  issuedAt: now.toISOString(),
};

// ── Sign ────────────────────────────────────────────────────────
const signer = crypto.createSign('SHA256');
signer.update(JSON.stringify(licenseData));
signer.end();
const signature = signer.sign(privateKey, 'base64');

// ── Output ──────────────────────────────────────────────────────
const output = {
  data: licenseData,
  signature,
};

const absOutputPath = path.resolve(outputPath);
const outputDir = path.dirname(absOutputPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(absOutputPath, JSON.stringify(output, null, 2), 'utf-8');
console.log(`[sign-license] License written to: ${absOutputPath}`);
console.log(`[sign-license] Device ID: ${deviceId}`);
console.log(`[sign-license] Expires: ${licenseData.expiresAt}`);