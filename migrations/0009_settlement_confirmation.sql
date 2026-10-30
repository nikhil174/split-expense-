-- A payment counts only once the person who received it confirms it.
-- Existing payments were all accepted under the old rules, so they start as
-- 'confirmed'. 'pending' payments wait for the receiver; 'rejected' ones are
-- kept for the record but never count.
ALTER TABLE appx_settlements ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('pending','confirmed','rejected'));
ALTER TABLE appx_settlements ADD COLUMN decided_by TEXT;
ALTER TABLE appx_settlements ADD COLUMN decided_at INTEGER;
CREATE INDEX IF NOT EXISTS appx_settlements_status_idx ON appx_settlements(group_id, status);
