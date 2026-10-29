-- Track partial and full repayments between members in each group.
CREATE TABLE IF NOT EXISTS appx_settlements (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES appx_groups(id),
  from_member_id TEXT NOT NULL,
  to_member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS appx_settlements_group_idx ON appx_settlements(group_id, created_at);
