-- Group-aware access requests and unique group names.
-- Migration 0003 intentionally clears app data first, so the unique index starts clean.
ALTER TABLE appx_access_requests ADD COLUMN group_id TEXT REFERENCES appx_groups(id);
CREATE UNIQUE INDEX IF NOT EXISTS appx_groups_unique_normalized_name
ON appx_groups(lower(trim(name)));
