-- Separate admin sessions: admin identities must not reference visitor access requests.
CREATE TABLE IF NOT EXISTS appx_admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS appx_admin_sessions_expiry_idx ON appx_admin_sessions(expires_at);
