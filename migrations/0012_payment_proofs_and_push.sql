-- A screenshot attached to a payment (e.g. the UPI success screen) so the
-- receiver can check it before approving. Kept apart from appx_settlements so
-- listing payments never loads images.
CREATE TABLE IF NOT EXISTS appx_payment_proofs (
  settlement_id TEXT PRIMARY KEY,
  mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
  base64 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- Phones/browsers that asked for push notifications. One row per browser
-- (its push endpoint); member_id is who is signed in there now.
CREATE TABLE IF NOT EXISTS appx_push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS appx_push_subscriptions_member_idx ON appx_push_subscriptions(member_id);
