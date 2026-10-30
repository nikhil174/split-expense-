-- Members sign in with name + group + a 4-digit PIN.
-- pin_hash holds "pbkdf2-sha256$<iterations>$<salt hex>$<hash hex>"; the PIN
-- itself is never stored. NULL means the member has not set a PIN yet (they
-- choose one on their next sign-in, or after the admin resets it).
-- pin_failures/pin_locked_until throttle guessing per member.
ALTER TABLE appx_access_requests ADD COLUMN pin_hash TEXT;
ALTER TABLE appx_access_requests ADD COLUMN pin_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appx_access_requests ADD COLUMN pin_locked_until INTEGER;
