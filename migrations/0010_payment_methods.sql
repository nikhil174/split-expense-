-- How each person likes to be paid. One row per person per kind; only 'upi'
-- exists for now (other kinds can be added to the CHECK later). member_id is
-- the member's permanent id ('admin' for the administrator), so it applies in
-- every group they belong to. The QR image is stored as base64 with its type.
CREATE TABLE IF NOT EXISTS appx_payment_methods (
  member_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'upi' CHECK(kind IN ('upi')),
  upi_id TEXT,
  qr_mime TEXT CHECK(qr_mime IS NULL OR qr_mime IN ('image/png','image/jpeg','image/webp')),
  qr_base64 TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(member_id, kind)
);
