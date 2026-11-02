-- "Let them off": a lender says someone doesn't need to pay what they still
-- owe. It is stored as a settlement from the debtor to the lender with kind
-- 'waiver' (no money moved), so it clears the debt through the same ledger
-- as payments once a group admin confirms it. Existing rows are payments.
ALTER TABLE appx_settlements ADD COLUMN kind TEXT NOT NULL DEFAULT 'payment' CHECK(kind IN ('payment','waiver'));
