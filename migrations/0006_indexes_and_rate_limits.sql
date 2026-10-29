-- Group-scoped indexes for the hot read paths, plus a small fixed-window rate
-- limit table. Additive only: no existing rows are modified.
CREATE INDEX IF NOT EXISTS appx_expenses_group_created_idx ON appx_expenses(group_id, created_at);
CREATE INDEX IF NOT EXISTS appx_group_members_member_idx ON appx_group_members(member_id);
CREATE INDEX IF NOT EXISTS appx_access_requests_group_name_idx ON appx_access_requests(group_id, lower(display_name));
CREATE INDEX IF NOT EXISTS appx_sessions_request_idx ON appx_sessions(request_id);
CREATE INDEX IF NOT EXISTS appx_settlements_pair_idx ON appx_settlements(group_id, from_member_id, to_member_id);

CREATE TABLE IF NOT EXISTS appx_rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS appx_rate_limits_window_idx ON appx_rate_limits(window_start);
