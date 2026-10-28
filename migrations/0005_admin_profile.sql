-- Persist the single administrator profile independently of short-lived admin sessions.
CREATE TABLE IF NOT EXISTS appx_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL
);
