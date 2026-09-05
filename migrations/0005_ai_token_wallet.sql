CREATE TABLE IF NOT EXISTS ai_token_wallets (
  telegram_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 20,
  lifetime_purchased INTEGER NOT NULL DEFAULT 0,
  lifetime_spent INTEGER NOT NULL DEFAULT 0,
  low_alert_sent INTEGER NOT NULL DEFAULT 0,
  empty_alert_sent INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_token_orders (
  id TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL,
  pack TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'XTR',
  invoice_payload TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  telegram_payment_charge_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ai_token_orders_user_created
  ON ai_token_orders (telegram_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_token_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  kind TEXT NOT NULL,
  feature TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  stars INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_token_ledger_user_created
  ON ai_token_ledger (telegram_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_token_live_minutes (
  telegram_id TEXT NOT NULL,
  minute_bucket INTEGER NOT NULL,
  feature TEXT NOT NULL,
  status TEXT NOT NULL,
  cost INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (telegram_id, minute_bucket, feature)
);

CREATE INDEX IF NOT EXISTS idx_ai_token_live_minutes_created
  ON ai_token_live_minutes (created_at DESC);
