-- Accounts: one account per person, in any number of groups, with admins per
-- group instead of one global administrator.
--
-- Existing data keeps working unchanged:
--  * every existing member becomes an account with the SAME id, name and PIN,
--    so expenses, splits, payments, UPI details and notifications (all stored
--    by that id) stay attached to the right person;
--  * the administrator becomes the account with id 'admin', admin of every
--    group they were in; their first sign-in uses the old admin PIN once to
--    choose a new 4-digit PIN;
--  * each existing account gets a username of its name plus a random part
--    (e.g. vicky_3fa2c1) that the person can change, and is marked legacy so
--    they can still sign in with their group and name the first time.
-- Nothing is deleted. The old tables (appx_access_requests, appx_sessions,
-- appx_admin_sessions) are left in place and no longer used.

CREATE TABLE IF NOT EXISTS appx_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  google_sub TEXT,
  pin_hash TEXT,
  pin_failures INTEGER NOT NULL DEFAULT 0,
  pin_locked_until INTEGER,
  legacy INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS appx_users_username_idx ON appx_users(username);
CREATE UNIQUE INDEX IF NOT EXISTS appx_users_email_idx ON appx_users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS appx_users_google_idx ON appx_users(google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS appx_user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS appx_user_sessions_user_idx ON appx_user_sessions(user_id);

-- Membership: role in the group and where the person stands.
--   active   in the group
--   pending  asked to join, waiting for a group admin
--   invited  invited by an admin, waiting for the person to accept
--   removed  no longer in the group (row kept so history keeps their name)
ALTER TABLE appx_group_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE appx_group_members ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE appx_group_members ADD COLUMN joined_at INTEGER;
ALTER TABLE appx_group_members ADD COLUMN invited_by TEXT;
CREATE INDEX IF NOT EXISTS appx_group_members_member_idx ON appx_group_members(member_id, status);
ALTER TABLE appx_groups ADD COLUMN created_by TEXT;

-- Different people may now have groups with the same name.
DROP INDEX IF EXISTS appx_groups_unique_normalized_name;

-- Existing members become accounts (same id, name and PIN).
INSERT OR IGNORE INTO appx_users(id,username,display_name,pin_hash,pin_failures,pin_locked_until,legacy,created_at)
SELECT id,
  CASE WHEN trim(display_name) GLOB '[A-Za-z]*' AND trim(display_name) NOT GLOB '*[^A-Za-z0-9 ]*'
       THEN substr(lower(replace(trim(display_name),' ','')),1,20) ELSE 'user' END
  || '_' || lower(substr(replace(id,'-',''),1,6)),
  display_name, pin_hash, pin_failures, pin_locked_until, 1, requested_at
FROM appx_access_requests;

-- The administrator becomes the account 'admin' (no PIN yet: chosen at first sign-in).
INSERT OR IGNORE INTO appx_users(id,username,display_name,legacy,created_at)
SELECT 'admin',
  CASE WHEN trim(setting_value) GLOB '[A-Za-z]*' AND trim(setting_value) NOT GLOB '*[^A-Za-z0-9 ]*'
       THEN substr(lower(replace(trim(setting_value),' ','')),1,20) ELSE 'user' END
  || '_' || lower(hex(randomblob(3))),
  setting_value, 1, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM appx_settings WHERE setting_key='admin_name';

-- The administrator is an admin of every group they were in.
UPDATE appx_group_members SET role='admin' WHERE member_id='admin';

-- Removed, revoked or rejected members stay in the group's history only.
UPDATE appx_group_members SET status='removed'
WHERE member_id<>'admin' AND NOT EXISTS (
  SELECT 1 FROM appx_access_requests a WHERE a.id=appx_group_members.member_id AND a.group_id=appx_group_members.group_id AND a.status IN ('approved','pending'));

-- Asked to (re)join and not approved yet: waiting for a group admin.
UPDATE appx_group_members SET status='pending'
WHERE EXISTS (SELECT 1 FROM appx_access_requests a WHERE a.id=appx_group_members.member_id AND a.group_id=appx_group_members.group_id AND a.status='pending');
INSERT OR IGNORE INTO appx_group_members(group_id,member_id,name,role,status)
SELECT group_id,id,display_name,'member','pending' FROM appx_access_requests
WHERE status='pending' AND group_id IS NOT NULL AND group_id IN (SELECT id FROM appx_groups);

UPDATE appx_groups SET created_by='admin' WHERE created_by IS NULL AND EXISTS (SELECT 1 FROM appx_users WHERE id='admin');
