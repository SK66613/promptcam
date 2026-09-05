CREATE TABLE IF NOT EXISTS legal_consents (
  telegram_id TEXT PRIMARY KEY,
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS support_sessions (
  telegram_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  pending INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_created
  ON support_tickets (status, created_at DESC);
