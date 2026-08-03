import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('subscription center exposes the approved two-tier price ladder', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'renderer', 'subscription-panel.js'), 'utf8');
  for (const expected of [
    "{ key: 'skins_monthly', label: '月付', price: '¥1' }",
    "{ key: 'skins_yearly', label: '年付', price: '¥9', recommended: true }",
    "{ key: 'creator_monthly', label: '月付', price: '¥3' }",
    "{ key: 'creator_quarterly', label: '季度', price: '¥7' }",
    "{ key: 'creator_yearly', label: '年付', price: '¥19', recommended: true }",
  ]) assert.ok(source.includes(expected), expected);
});

test('subscription center promises retention without exposing infrastructure terms', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'renderer', 'subscription-panel.js'), 'utf8');
  assert.match(source, /已创作的宠物与作品不会因到期被删除/);
  assert.doesNotMatch(source, /Webhook|Cloudflare|D1|entitlementPublicKey/);
});

test('main renderer keeps the subscription center interactive and motion-stable', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'renderer', 'main.js'), 'utf8');
  assert.match(source, /onOpenSubscription\(openSubscriptionPanel\)/);
  assert.match(source, /settingsPanel\.isAnimating \|\| subscriptionPanel\.isOpen/);
  assert.match(source, /!subscriptionPanel\.isOpen/);
});
