-- Photos attached to an expense (a receipt, a bill, proof of what was bought),
-- at most a few per expense. Kept apart from appx_expenses so listing
-- expenses never loads images. Deleting the expense deletes its photos.
CREATE TABLE IF NOT EXISTS appx_expense_photos (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES appx_expenses(id) ON DELETE CASCADE,
  mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
  base64 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- Order among photos added together (they share created_at).
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS appx_expense_photos_expense_idx ON appx_expense_photos(expense_id, created_at, position);
