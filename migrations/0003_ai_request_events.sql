CREATE TABLE IF NOT EXISTS ai_request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  rhythm TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  total_ms INTEGER NOT NULL DEFAULT 0,
  provider_ms INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_ai_request_events_user_created
  ON ai_request_events (telegram_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_request_events_created
  ON ai_request_events (created_at DESC);
