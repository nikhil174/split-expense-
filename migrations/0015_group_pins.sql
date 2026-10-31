-- Group PINs: each group can have a 4-digit PIN (hashed like passwords),
-- needed to join it and to open it. Opening it is remembered for one day per
-- signed-in device (session): appx_group_unlocks. Existing groups have no PIN
-- until one of their admins sets it.
ALTER TABLE appx_groups ADD COLUMN pin_hash TEXT;
CREATE TABLE IF NOT EXISTS appx_group_unlocks (
  session_hash TEXT NOT NULL,
  group_id TEXT NOT NULL,
  until INTEGER NOT NULL,
  PRIMARY KEY(session_hash, group_id)
);
CREATE INDEX IF NOT EXISTS appx_group_unlocks_group_idx ON appx_group_unlocks(group_id);
