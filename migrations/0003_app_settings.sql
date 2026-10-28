-- Settings used by the admin profile and other app-level configuration.
CREATE TABLE IF NOT EXISTS appx_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL
);
