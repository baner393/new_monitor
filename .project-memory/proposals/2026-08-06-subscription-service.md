# Subscription service proposal

Status: Confirmed in the uncommitted working tree and deployed at the public custom domain.

Evidence: `subscription-service/src/worker.js`, `subscription-service/migrations/0001_initial.sql`, `subscription-service/tests/core.test.mjs`, `tests/subscription-runtime.test.mjs`, `npm test`, and `npm run verify`.

## Proposed contract additions

- A Cloudflare Worker + D1 service exists under `subscription-service/`. It exposes `POST /api/v1/checkouts`, `POST /api/v1/entitlements/refresh`, and `POST /api/v1/afdian/webhook`; `GET /health` returns a service health response.
- The Worker verifies every Afdian Webhook candidate through the Afdian open order-query API before recording an order or granting access. It validates successful status, the configured plan ID, exact expected payment amount, one-time checkout binding, and a two-device limit.
- The Worker verifies device-signed checkout/refresh proofs, prevents nonce replay for five minutes, stores only the device public key, and signs device-bound Ed25519 entitlement envelopes compatible with `src/main/entitlement-envelope.js`.
- Client checkout results now carry a `bindingCode`. The subscription panel instructs the purchaser to paste that code into the Afdian order remark. This is implemented behavior, not OAuth2: an automatic association between arbitrary Afdian browser payment and Electron device remains Unknown until OAuth2 is implemented.
- The five product keys and prices remain authoritative in `src/shared/subscription-model.js`; deployment maps five Afdian plan IDs and plan URLs through Worker environment variables. Secrets are excluded from Git.

## Deployment state

- Confirmed: D1 database `license-monitor-db` exists with the initial five-table schema.
- Confirmed: Worker `license-monitor` is deployed at `https://licensemonitor.b100.top`; `GET /health` returns `{\"ok\":true,\"service\":\"license-monitor\"}`.
- Confirmed: the five Afdian plan IDs and `https://ifdian.net/item/<plan_id>` URLs are configured as Worker variables; the three private secrets were uploaded outside Git.
- Confirmed: client `resources/subscription/config.json` points to the service and contains the matching Ed25519 public key.
- Confirmed: the subscription panel presents the checkout binding code in a dedicated copyable block and explains the required Afdian order remark step.
- Unknown: a real non-creator buyer order has completed the full webhook-to-entitlement refresh path.
- Confirmed: R2 bucket `turtle-monitor-skins` is bound to the Worker. Migration `0002_skin_library.sql` adds `skin_releases`; the Worker exposes public catalog and preview endpoints plus device-proof-protected package downloads.
- Confirmed: the desktop client fetches the catalog, downloads `.skinpack` releases only with `skins` or `creator` entitlement, verifies the package and each declared PNG SHA-256, then atomically installs the skin in user data.
- Confirmed: the developer publisher can validate skin sources, update the built-in skin index, and create a gzip-compressed `.skinpack` staging artifact.
- Not implemented: an operator publish command to upload the staging artifact and preview to R2 and insert/update the corresponding `skin_releases` row; the catalog is therefore empty until that command exists or an operator performs the equivalent steps manually.

## Promotion notes

Before closing the remaining gaps, publish one official skin and capture catalog, access-denial, and entitled-install evidence without recording credentials. Separately capture a verified end-to-end checkout/refresh result with a non-creator buyer.
