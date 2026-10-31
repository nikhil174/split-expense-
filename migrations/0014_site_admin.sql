-- Site owner ("Admin" tab): an account role separate from group admins.
-- The old administrator's account ('admin') is the site owner. Opening the
-- Admin tab also needs the admin key (the ADMIN_PIN secret), once per
-- session; admin_until records until when this session has it unlocked.
ALTER TABLE appx_users ADD COLUMN site_role TEXT;
ALTER TABLE appx_user_sessions ADD COLUMN admin_until INTEGER;
UPDATE appx_users SET site_role='admin' WHERE id='admin';
