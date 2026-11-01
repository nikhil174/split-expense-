-- History, integrity guards and removal of the pre-accounts tables.
--
-- 1. appx_history: a permanent log of changes to expenses and payments, so a
--    cancelled payment or an edited/deleted expense leaves a trace (who, when,
--    what it was before and after). Payments and expenses themselves keep
--    working exactly as before: balances never read this table.
-- 2. Triggers that refuse to store a person id that has no account, in group
--    memberships, expenses, splits and payments (the database now enforces
--    what the code already did). Existing rows are not touched or checked.
-- 3. A trigger keeping each membership's copy of a person's name in step with
--    their account name.
-- 4. The tables of the old sign-in (before accounts, migration 0013) are
--    dropped. Their people were copied into appx_users by 0013, and nothing
--    has read them since.

CREATE TABLE IF NOT EXISTS appx_history (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  entity TEXT NOT NULL CHECK(entity IN ('expense','payment')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('created','edited','deleted','cancelled')),
  actor_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS appx_history_entity_idx ON appx_history(group_id, entity, entity_id, created_at);
CREATE INDEX IF NOT EXISTS appx_history_group_idx ON appx_history(group_id, created_at);

-- Person ids must belong to an account.
CREATE TRIGGER IF NOT EXISTS appx_group_members_user_ins BEFORE INSERT ON appx_group_members
WHEN NOT EXISTS (SELECT 1 FROM appx_users WHERE id = NEW.member_id)
BEGIN SELECT RAISE(ABORT, 'unknown account in group membership'); END;
CREATE TRIGGER IF NOT EXISTS appx_group_members_user_upd BEFORE UPDATE OF member_id ON appx_group_members
WHEN NOT EXISTS (SELECT 1 FROM appx_users WHERE id = NEW.member_id)
BEGIN SELECT RAISE(ABORT, 'unknown account in group membership'); END;

CREATE TRIGGER IF NOT EXISTS appx_expenses_user_ins BEFORE INSERT ON appx_expenses
WHEN NOT EXISTS (SELECT 1 FROM appx_users WHERE id = NEW.paid_by)
BEGIN SELECT RAISE(ABORT, 'unknown account paid for expense'); END;
CREATE TRIGGER IF NOT EXISTS appx_expenses_user_upd BEFORE UPDATE OF paid_by ON appx_expenses
WHEN NOT EXISTS (SELECT 1 FROM appx_users WHERE id = NEW.paid_by)
BEGIN SELECT RAISE(ABORT, 'unknown account paid for expense'); END;

CREATE TRIGGER IF NOT EXISTS appx_splits_user_ins BEFORE INSERT ON appx_splits
WHEN NOT EXISTS (SELECT 1 FROM appx_users WHERE id = NEW.member_id)
BEGIN SELECT RAISE(ABORT, 'unknown account in split'); END;
CREATE TRIGGER IF NOT EXISTS appx_splits_user_upd BEFORE UPDATE OF member_id ON appx_splits
WHEN NOT EXISTS (SELECT 1 FROM appx_users WHERE id = NEW.member_id)
BEGIN SELECT RAISE(ABORT, 'unknown account in split'); END;

CREATE TRIGGER IF NOT EXISTS appx_settlements_user_ins BEFORE INSERT ON appx_settlements
WHEN NOT EXISTS (SELECT 1 FROM appx_users WHERE id = NEW.from_member_id)
  OR NOT EXISTS (SELECT 1 FROM appx_users WHERE id = NEW.to_member_id)
BEGIN SELECT RAISE(ABORT, 'unknown account in payment'); END;
CREATE TRIGGER IF NOT EXISTS appx_settlements_user_upd BEFORE UPDATE OF from_member_id, to_member_id ON appx_settlements
WHEN NOT EXISTS (SELECT 1 FROM appx_users WHERE id = NEW.from_member_id)
  OR NOT EXISTS (SELECT 1 FROM appx_users WHERE id = NEW.to_member_id)
BEGIN SELECT RAISE(ABORT, 'unknown account in payment'); END;

-- A person's name in every group follows their account name.
CREATE TRIGGER IF NOT EXISTS appx_users_name_sync AFTER UPDATE OF display_name ON appx_users
WHEN NEW.display_name IS NOT OLD.display_name
BEGIN UPDATE appx_group_members SET name = NEW.display_name WHERE member_id = NEW.id AND name IS NOT NEW.display_name; END;

-- The old sign-in's tables (sessions first: they point at access requests).
DROP TABLE IF EXISTS appx_sessions;
DROP TABLE IF EXISTS appx_admin_sessions;
DROP TABLE IF EXISTS appx_access_requests;
DROP TABLE IF EXISTS appx_invites;
