CREATE TABLE IF NOT EXISTS bot_payment_hubs (
  telegram_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  view TEXT NOT NULL DEFAULT 'main',
  updated_at INTEGER NOT NULL
);
