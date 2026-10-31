-- Invite links and friends.
-- appx_groups.invite_code: the code in the group's invite link / QR
-- (#/join/<code>). Opening it lets a signed-in person ask to join; a group
-- admin still approves, and the group PIN is still needed. Admins can
-- replace it (old links stop working) or turn it off (NULL).
ALTER TABLE appx_groups ADD COLUMN invite_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS appx_groups_invite_code_idx ON appx_groups(invite_code) WHERE invite_code IS NOT NULL;
-- Friends: one row per pair (user_a < user_b), pending until the other
-- person accepts.
CREATE TABLE IF NOT EXISTS appx_friendships (
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_a, user_b)
);
CREATE INDEX IF NOT EXISTS appx_friendships_b_idx ON appx_friendships(user_b);
