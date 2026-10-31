-- In-app notifications: something happened that involves you (an expense
-- you are in was added/changed/deleted, a payment to or from you, you were
-- approved, someone asked to join). recipient_id is the member's permanent id
-- ('admin' for the administrator). Text is written when the event happens.
CREATE TABLE IF NOT EXISTS appx_notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL,
  group_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  actor_name TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS appx_notifications_recipient_idx ON appx_notifications(recipient_id, created_at);
