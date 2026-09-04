PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_usage_minute (
  telegram_id TEXT NOT NULL,
  minute_bucket INTEGER NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (telegram_id, minute_bucket)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_minute_updated
  ON ai_usage_minute (updated_at);
