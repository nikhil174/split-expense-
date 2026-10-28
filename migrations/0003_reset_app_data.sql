-- One-time reset of Split Expense app data. Schema and tables are preserved.
DELETE FROM appx_splits;
DELETE FROM appx_expenses;
DELETE FROM appx_invites;
DELETE FROM appx_group_members;
DELETE FROM appx_groups;
DELETE FROM appx_sessions;
DELETE FROM appx_admin_sessions;
DELETE FROM appx_access_requests;
