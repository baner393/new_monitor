# 小龟值班订阅服务

Cloudflare Worker + D1 service for Afdian order verification and device-bound membership grants.

## Before deployment

1. Install Wrangler: `npm install --global wrangler`.
2. Log in: `wrangler login`.
3. Copy `wrangler.toml.example` to `wrangler.toml`; set the D1 database ID, five Afdian plan IDs, and five plan URLs.
4. Create D1: `wrangler d1 create license-monitor-db`.
5. Apply the schema: `wrangler d1 execute license-monitor-db --remote --file migrations/0001_initial.sql`.
6. Set secrets. Never place these in `wrangler.toml`:

```text
wrangler secret put AFDIAN_USER_ID
wrangler secret put AFDIAN_API_TOKEN
wrangler secret put ENTITLEMENT_PRIVATE_KEY
```

7. Deploy: `wrangler deploy`.
8. Add `licensemonitor.b100.top` as the Worker's Custom Domain.
9. Set the Afdian Webhook URL to `https://licensemonitor.b100.top/api/v1/afdian/webhook`.

## Current purchase binding

Afdian's documented Webhook provides the buyer's user ID but cannot associate an arbitrary browser checkout with an Electron device. `POST /api/v1/checkouts` therefore creates a single-use binding code. The client displays this code; the buyer pastes it into the Afdian order remark before paying. The Webhook verifies the order through Afdian's open API, matches its remark to the checkout, and then issues the membership.

The code has a 30-minute lifetime. A later OAuth2 integration can replace the one-time remark without changing entitlement or order storage.
