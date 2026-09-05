CREATE TABLE IF NOT EXISTS subscription_controls (
  telegram_id TEXT PRIMARY KEY,
  telegram_payment_charge_id TEXT NOT NULL,
  is_canceled INTEGER NOT NULL DEFAULT 0,
  last_state TEXT NOT NULL DEFAULT 'active',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscription_controls_charge
  ON subscription_controls (telegram_payment_charge_id);
