CREATE TABLE IF NOT EXISTS script_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_script_templates_user_updated
  ON script_templates (telegram_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  source TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_favorites_user_updated
  ON ai_favorites (telegram_id, updated_at DESC);
