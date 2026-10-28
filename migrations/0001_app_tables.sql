-- Additive migration: all tables are prefixed appx_ to avoid altering existing tables.
CREATE TABLE IF NOT EXISTS appx_access_requests (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','revoked')),
  requested_at INTEGER NOT NULL,
  approved_at INTEGER,
  expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS appx_sessions (
  token_hash TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES appx_access_requests(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS appx_sessions_expiry_idx ON appx_sessions(expires_at);
CREATE TABLE IF NOT EXISTS appx_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS appx_group_members (
  group_id TEXT NOT NULL REFERENCES appx_groups(id),
  member_id TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY(group_id, member_id)
);
CREATE TABLE IF NOT EXISTS appx_expenses (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES appx_groups(id),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  paid_by TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS appx_splits (
  expense_id TEXT NOT NULL REFERENCES appx_expenses(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  PRIMARY KEY(expense_id, member_id)
);
CREATE TABLE IF NOT EXISTS appx_invites (
  code_hash TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES appx_groups(id),
  expires_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
