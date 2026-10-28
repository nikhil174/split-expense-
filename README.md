# Split Expense

Mobile-first expense sharing for a group, hosted on Cloudflare Workers + D1.

## Access model
- Visitors submit only their name.
- Every request starts as pending and requires the admin's approval.
- The admin signs in with a PIN configured as the Worker secret `ADMIN_PIN`.
- Approved visitors can activate a passwordless, server-side session lasting up to 3 hours.
- The admin can reject pending requests or revoke approved access.
- Group APIs verify the active session and group membership.
- Invite codes expire after 7 days.

## Cloudflare setup

This repository does not deploy automatically and has not changed the existing Worker or database.

1. In Cloudflare, open the existing Worker `split-expense` and its D1 database `split_expense_db`.
2. Back up the D1 database and confirm the database ID and current schema.
3. Replace `REPLACE_WITH_EXISTING_D1_DATABASE_ID` in `wrangler.toml` with the actual database ID.
4. Verify the D1 binding is named `DB` in the new config. If the existing Worker uses a different binding name, align it before deployment.
5. Configure strong secrets:
   - `npx wrangler secret put ADMIN_PIN`
   - `npx wrangler secret put SESSION_SECRET` (use a long random value)
6. Install dependencies with `npm install`.
7. Apply migrations only after reviewing the schema and backup:
   - `npx wrangler d1 migrations apply split_expense_db --remote`
8. Deploy only after testing in a staging Worker:
   - `npm run deploy`

## Data safety notes
The SQL migrations add new `appx_*` tables and do not modify or delete existing tables. The current application code stores its new group/expense data in those tables; it does not automatically import legacy records. Review existing production routes and bindings before replacing any deployed Worker code.

## Local development
- `npm install`
- `npx wrangler dev`

## Current status
Source files are committed to GitHub. Live deployment, secret configuration, D1 migration execution, and end-to-end testing against the existing database remain to be done.
