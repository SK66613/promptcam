PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  language_code TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_orders (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  stars INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'XTR',
  invoice_payload TEXT NOT NULL UNIQUE,
  invoice_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  telegram_payment_charge_id TEXT,
  subscription_expiration_date INTEGER,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_orders_user_created
  ON billing_orders (telegram_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_orders_payload
  ON billing_orders (invoice_payload);

CREATE TABLE IF NOT EXISTS payments (
  telegram_payment_charge_id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  order_id TEXT,
  plan TEXT NOT NULL,
  stars INTEGER NOT NULL,
  currency TEXT NOT NULL,
  invoice_payload TEXT NOT NULL,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  is_first_recurring INTEGER NOT NULL DEFAULT 0,
  subscription_expiration_date INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id),
  FOREIGN KEY (order_id) REFERENCES billing_orders(id)
);

CREATE INDEX IF NOT EXISTS idx_payments_user_created
  ON payments (telegram_id, created_at DESC);

CREATE TABLE IF NOT EXISTS entitlements (
  telegram_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL,
  access_until INTEGER NOT NULL,
  source TEXT NOT NULL,
  telegram_payment_charge_id TEXT,
  recurring INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_entitlements_access_until
  ON entitlements (access_until);
