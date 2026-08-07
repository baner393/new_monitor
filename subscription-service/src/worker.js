import {
  PRODUCTS,
  addMonths,
  afdianSignatureSource,
  buildPlanMap,
  createCheckoutId,
  formatAmountCents,
  laterIso,
  md5Hex,
  signEntitlement,
  verifyDeviceProof,
} from './core.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const GRACE_DAYS = 14;
const CHECKOUT_TTL_MS = 30 * 60 * 1000;
const DEVICE_LIMIT = 2;
const SKIN_CATALOG_CACHE_SECONDS = 300;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function error(code, status = 400) {
  return json({ error: code }, status);
}

function responseFromObject(object, { contentType, cacheControl, downloadName = '' } = {}) {
  if (!object) return error('skin_package_not_found', 404);
  const headers = new Headers();
  headers.set('content-type', contentType || object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('cache-control', cacheControl || 'private, max-age=300');
  if (downloadName) headers.set('content-disposition', `attachment; filename="${downloadName}"`);
  object.writeHttpMetadata(headers);
  return new Response(object.body, { headers });
}

async function requestJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('content_type_must_be_json');
  return request.json();
}

function requireConfig(env, names) {
  for (const name of names) {
    if (!String(env[name] || '').trim()) throw new Error(`missing_service_config:${name}`);
  }
}

async function recordWebhook(env, { eventType = '', orderNo = '', result, detail = '' }) {
  await env.DB.prepare(
    'INSERT INTO webhook_events (received_at, event_type, out_trade_no, result, detail) VALUES (?, ?, ?, ?, ?)',
  ).bind(new Date().toISOString(), eventType, orderNo, result, String(detail).slice(0, 1000)).run();
}

async function consumeDeviceProof(env, proof, purpose) {
  const device = await verifyDeviceProof(proof, purpose);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  await env.DB.prepare('DELETE FROM used_device_proofs WHERE expires_at < ?').bind(now.toISOString()).run();
  const result = await env.DB.prepare(
    'INSERT OR IGNORE INTO used_device_proofs (nonce, expires_at) VALUES (?, ?)',
  ).bind(device.payload.nonce, expiresAt).run();
  if (!result.meta?.changes) throw new Error('replayed_device_proof');
  return device;
}

function planUrl(env, productKey) {
  const key = `AFDIAN_PLAN_URL_${productKey.toUpperCase()}`;
  return String(env[key] || '').trim();
}

async function afdianQueryOrder(env, orderNo) {
  requireConfig(env, ['AFDIAN_USER_ID', 'AFDIAN_API_TOKEN']);
  const params = JSON.stringify({ out_trade_no: orderNo });
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = await md5Hex(afdianSignatureSource({
    token: env.AFDIAN_API_TOKEN,
    params,
    timestamp,
    userId: env.AFDIAN_USER_ID,
  }));
  const response = await fetch('https://afdian.com/api/open/query-order', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: env.AFDIAN_USER_ID, params, ts: timestamp, sign }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ec !== 200) throw new Error(`afdian_query_failed:${body?.ec || response.status}`);
  const list = Array.isArray(body?.data?.list) ? body.data.list : [];
  const direct = body?.data?.order && typeof body.data.order === 'object' ? [body.data.order] : [];
  const order = [...direct, ...list].find((candidate) => candidate?.out_trade_no === orderNo);
  if (!order) throw new Error('afdian_order_not_found');
  return order;
}

async function selectedMembership(env, deviceId, nowIso) {
  const memberships = await env.DB.prepare(
    `SELECT customer_id, device_id, device_public_key, tier, expires_at
     FROM device_memberships
     WHERE device_id = ? AND expires_at >= ?
     ORDER BY CASE tier WHEN 'creator' THEN 0 ELSE 1 END, expires_at DESC`,
  ).bind(deviceId, nowIso).all();
  return memberships.results?.[0] || null;
}

async function membershipSnapshot(env, deviceId) {
  const now = new Date();
  const membership = await selectedMembership(env, deviceId, now.toISOString());
  if (!membership) return null;
  const activeDevices = await env.DB.prepare(
    `SELECT COUNT(DISTINCT device_id) AS count
     FROM device_memberships
     WHERE customer_id = ? AND expires_at >= ?`,
  ).bind(membership.customer_id, now.toISOString()).first();
  return { ...membership, activeDevices: Number(activeDevices?.count || 0) };
}

async function issueEnvelope(env, deviceId) {
  requireConfig(env, ['ENTITLEMENT_PRIVATE_KEY']);
  const membership = await membershipSnapshot(env, deviceId);
  const now = new Date();
  const issuedAt = now.toISOString();
  if (!membership) {
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    return signEntitlement({
      schemaVersion: 1,
      entitlementId: `free-${deviceId.slice(0, 24)}`,
      deviceId,
      tier: 'free',
      issuedAt,
      expiresAt,
      graceUntil: expiresAt,
      activeDevices: 0,
    }, env.ENTITLEMENT_PRIVATE_KEY);
  }
  const graceUntil = new Date(Date.parse(membership.expires_at) + GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return signEntitlement({
    schemaVersion: 1,
    entitlementId: `${membership.customer_id}:${membership.device_id}:${membership.tier}`,
    deviceId,
    tier: membership.tier,
    issuedAt,
    expiresAt: membership.expires_at,
    graceUntil,
    activeDevices: membership.activeDevices,
  }, env.ENTITLEMENT_PRIVATE_KEY);
}

async function extendMembership(env, { customerId, deviceId, publicKey, product, nowIso }) {
  const current = await env.DB.prepare(
    'SELECT expires_at FROM device_memberships WHERE customer_id = ? AND device_id = ? AND tier = ?',
  ).bind(customerId, deviceId, product.tier).first();
  const creator = await env.DB.prepare(
    'SELECT expires_at FROM device_memberships WHERE customer_id = ? AND device_id = ? AND tier = ?',
  ).bind(customerId, deviceId, 'creator').first();
  const base = product.tier === 'skins'
    ? laterIso(nowIso, current?.expires_at, creator?.expires_at)
    : laterIso(nowIso, current?.expires_at);
  const expiresAt = addMonths(base, product.months);
  const statements = [
    env.DB.prepare(
      `INSERT INTO device_memberships (customer_id, device_id, device_public_key, tier, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(customer_id, device_id, tier) DO UPDATE SET
       device_public_key = excluded.device_public_key,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
    ).bind(customerId, deviceId, publicKey, product.tier, expiresAt, nowIso),
  ];
  if (product.tier === 'creator') {
    const skins = await env.DB.prepare(
      'SELECT expires_at FROM device_memberships WHERE customer_id = ? AND device_id = ? AND tier = ?',
    ).bind(customerId, deviceId, 'skins').first();
    if (skins?.expires_at && Date.parse(skins.expires_at) > Date.parse(nowIso)) {
      statements.push(env.DB.prepare(
        'UPDATE device_memberships SET expires_at = ?, updated_at = ? WHERE customer_id = ? AND device_id = ? AND tier = ?',
      ).bind(addMonths(skins.expires_at, product.months), nowIso, customerId, deviceId, 'skins'));
    }
  }
  await env.DB.batch(statements);
  return expiresAt;
}

async function handleCheckout(request, env) {
  const body = await requestJson(request);
  const product = PRODUCTS[String(body?.productKey || '')];
  if (!product) return error('unknown_subscription_product');
  const url = planUrl(env, body.productKey);
  if (!url) return error('checkout_url_not_configured', 503);
  const device = await consumeDeviceProof(env, body.deviceProof, 'checkout');
  const now = new Date();
  const checkoutId = createCheckoutId();
  const expiresAt = new Date(now.getTime() + CHECKOUT_TTL_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO checkout_sessions (checkout_id, product_key, device_id, device_public_key, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(checkoutId, body.productKey, device.deviceId, device.publicKey, now.toISOString(), expiresAt).run();
  return json({ checkoutUrl: url, checkoutId, bindingCode: checkoutId, expiresAt });
}

async function handleRefresh(request, env) {
  const body = await requestJson(request);
  const device = await consumeDeviceProof(env, body.deviceProof, 'refresh');
  return json({ envelope: await issueEnvelope(env, device.deviceId) });
}

async function handleSkinCatalog(env) {
  const releases = await env.DB.prepare(
    `SELECT skin_id, version, display_name, author, description, release_notes,
            min_app_version, preview_key, package_sha256, package_bytes, published_at
     FROM skin_releases WHERE status = 'published' ORDER BY published_at DESC`,
  ).all();
  const skins = (releases.results || []).map((release) => ({
    id: release.skin_id,
    version: release.version,
    displayName: release.display_name,
    author: release.author,
    description: release.description,
    releaseNotes: release.release_notes,
    minAppVersion: release.min_app_version,
    previewUrl: `${String(env.SERVICE_ORIGIN || '').replace(/\/$/, '')}/api/v1/skins/${encodeURIComponent(release.skin_id)}/${encodeURIComponent(release.version)}/preview`,
    packageSha256: release.package_sha256,
    packageBytes: Number(release.package_bytes || 0),
    publishedAt: release.published_at,
    requiresSkinUpdates: true,
  }));
  return new Response(JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), skins }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${SKIN_CATALOG_CACHE_SECONDS}` },
  });
}

async function skinRelease(env, skinId, version) {
  return env.DB.prepare(
    `SELECT * FROM skin_releases WHERE skin_id = ? AND version = ? AND status = 'published'`,
  ).bind(skinId, version).first();
}

async function handleSkinPreview(env, skinId, version) {
  const release = await skinRelease(env, skinId, version);
  if (!release) return error('skin_release_not_found', 404);
  return responseFromObject(await env.SKINS_BUCKET.get(release.preview_key), {
    contentType: 'image/png', cacheControl: 'public, max-age=86400, immutable',
  });
}

async function handleSkinDownload(request, env, skinId, version) {
  const release = await skinRelease(env, skinId, version);
  if (!release) return error('skin_release_not_found', 404);
  const body = await requestJson(request);
  const device = await consumeDeviceProof(env, body.deviceProof, 'skin_download');
  const membership = await membershipSnapshot(env, device.deviceId);
  if (!membership || !['skins', 'creator'].includes(membership.tier)) return error('skin_updates_membership_required', 403);
  return responseFromObject(await env.SKINS_BUCKET.get(release.package_key), {
    contentType: 'application/octet-stream', cacheControl: 'private, max-age=300',
    downloadName: `${skinId}-${version}.skinpack`,
  });
}

async function handleWebhook(request, env) {
  let event;
  try {
    event = await request.json();
  } catch {
    await recordWebhook(env, { result: 'invalid_json' });
    return json({ ec: 200, em: '' });
  }
  const eventType = String(event?.data?.type || '');
  const candidate = event?.data?.order || {};
  const orderNo = String(candidate.out_trade_no || '');
  try {
    if (event?.ec !== 200 || eventType !== 'order' || !orderNo) throw new Error('unsupported_webhook');
    const existing = await env.DB.prepare('SELECT out_trade_no FROM orders WHERE out_trade_no = ?').bind(orderNo).first();
    if (existing) {
      await recordWebhook(env, { eventType, orderNo, result: 'duplicate' });
      return json({ ec: 200, em: '' });
    }
    const order = await afdianQueryOrder(env, orderNo);
    if (Number(order.status) !== 2) throw new Error('order_not_paid');
    const product = buildPlanMap(env).get(String(order.plan_id || ''));
    if (!product) throw new Error('unrecognized_plan');
    if (formatAmountCents(order.total_amount) !== product.priceCents) throw new Error('amount_mismatch');
    const checkoutId = String(order.remark || '').trim();
    const checkout = await env.DB.prepare(
      `SELECT checkout_id, product_key, device_id, device_public_key, status, expires_at
       FROM checkout_sessions WHERE checkout_id = ?`,
    ).bind(checkoutId).first();
    if (!checkout || checkout.status !== 'open' || Date.parse(checkout.expires_at) < Date.now()) throw new Error('unmatched_checkout');
    if (checkout.product_key !== product.key) throw new Error('checkout_product_mismatch');
    const nowIso = new Date().toISOString();
    const existingDevice = await env.DB.prepare(
      'SELECT 1 AS present FROM device_memberships WHERE customer_id = ? AND device_id = ? LIMIT 1',
    ).bind(order.user_id, checkout.device_id).first();
    const devices = await env.DB.prepare(
      `SELECT COUNT(DISTINCT device_id) AS count FROM device_memberships
       WHERE customer_id = ? AND expires_at >= ?`,
    ).bind(order.user_id, nowIso).first();
    if (!existingDevice && Number(devices?.count || 0) >= DEVICE_LIMIT) throw new Error('device_limit_reached');
    const expiresAt = await extendMembership(env, {
      customerId: String(order.user_id),
      deviceId: checkout.device_id,
      publicKey: checkout.device_public_key,
      product,
      nowIso,
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO orders (out_trade_no, customer_id, plan_id, product_key, amount_cents, device_id, checkout_id, verified_at, raw_order_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(orderNo, order.user_id, order.plan_id, product.key, product.priceCents, checkout.device_id, checkout.checkout_id, nowIso, JSON.stringify(order)),
      env.DB.prepare(
        `UPDATE checkout_sessions SET status = 'claimed', customer_id = ?, claimed_at = ? WHERE checkout_id = ?`,
      ).bind(order.user_id, nowIso, checkout.checkout_id),
    ]);
    await recordWebhook(env, { eventType, orderNo, result: 'granted', detail: expiresAt });
  } catch (caught) {
    await recordWebhook(env, { eventType, orderNo, result: 'ignored', detail: caught?.message || caught });
  }
  return json({ ec: 200, em: '' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'license-monitor', skinLibrary: 1 });
      if (request.method === 'POST' && url.pathname === '/api/v1/checkouts') return await handleCheckout(request, env);
      if (request.method === 'POST' && url.pathname === '/api/v1/entitlements/refresh') return await handleRefresh(request, env);
      if (request.method === 'GET' && url.pathname === '/api/v1/skins/catalog') return await handleSkinCatalog(env);
      const skinRoute = url.pathname.match(/^\/api\/v1\/skins\/([^/]+)\/([^/]+)\/(preview|download)$/);
      if (skinRoute) {
        const [, encodedSkinId, encodedVersion, operation] = skinRoute;
        const skinId = decodeURIComponent(encodedSkinId);
        const version = decodeURIComponent(encodedVersion);
        if (operation === 'preview' && request.method === 'GET') return await handleSkinPreview(env, skinId, version);
        if (operation === 'download' && request.method === 'POST') return await handleSkinDownload(request, env, skinId, version);
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/afdian/webhook') return await handleWebhook(request, env);
      return error('not_found', 404);
    } catch (caught) {
      console.error('[license-monitor]', caught);
      return error(String(caught?.message || 'internal_error'), 500);
    }
  },
};
