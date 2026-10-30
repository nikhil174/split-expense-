-- Member names are unique within a group (case-insensitive), so signing in by
-- name always finds exactly one person. Names are only labels: every expense,
-- split, payment and session refers to the member's permanent id, so a rename
-- never touches history. Replaces the plain index from 0006.
-- If this fails with "UNIQUE constraint failed", two entries in a group share a
-- name; find them with:
--   SELECT group_id, lower(display_name) AS name, COUNT(*) FROM appx_access_requests
--   GROUP BY group_id, lower(display_name) HAVING COUNT(*) > 1;
-- rename one of each pair, then apply again.
CREATE UNIQUE INDEX IF NOT EXISTS appx_access_requests_unique_group_name ON appx_access_requests(group_id, lower(display_name));
DROP INDEX IF EXISTS appx_access_requests_group_name_idx;
