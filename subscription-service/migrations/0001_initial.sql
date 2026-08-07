CREATE TABLE IF NOT EXISTS checkout_sessions (
  checkout_id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_public_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  customer_id TEXT,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS checkout_sessions_binding_idx ON checkout_sessions(checkout_id, status);

CREATE TABLE IF NOT EXISTS used_device_proofs (
  nonce TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  out_trade_no TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  product_key TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  device_id TEXT,
  checkout_id TEXT,
  verified_at TEXT NOT NULL,
  raw_order_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_memberships (
  customer_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_public_key TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('skins', 'creator')),
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (customer_id, device_id, tier)
);

CREATE INDEX IF NOT EXISTS device_memberships_device_idx ON device_memberships(device_id, expires_at);
CREATE INDEX IF NOT EXISTS device_memberships_customer_idx ON device_memberships(customer_id, expires_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  event_type TEXT,
  out_trade_no TEXT,
  result TEXT NOT NULL,
  detail TEXT
);
