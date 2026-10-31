-- Email links: confirming an email address, and resetting a forgotten
-- password (sent only to a confirmed address). Only a hash of each link's
-- token is stored; links expire and work once.
ALTER TABLE appx_users ADD COLUMN email_verified_at INTEGER;
-- Emails that came from Google sign-in are already verified by Google.
UPDATE appx_users SET email_verified_at=created_at WHERE google_sub IS NOT NULL AND email IS NOT NULL;
CREATE TABLE IF NOT EXISTS appx_email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS appx_email_tokens_user_idx ON appx_email_tokens(user_id, purpose);
