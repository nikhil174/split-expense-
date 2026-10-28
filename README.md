# Split Expense

Mobile-first expense sharing for a group, hosted on Cloudflare Workers + D1.

## Architecture and access model
- Public endpoint lists existing groups; visitors choose a group and submit their name plus that group ID.
- Group names are globally unique (case-insensitive, surrounding whitespace ignored), enforced by a D1 unique index.
- Only the separate admin session can create groups or review membership requests.
- Approving a request both activates the visitor's 3-hour access and adds them to the requested group.
- Admin identity/session (`split_admin`) and regular member session (`split_session`) are separate. The admin can request membership in their own group and approve that request, then use the normal expense UI.
- Members cannot create groups, directly add members, or bypass approval using invite codes.
- The admin signs in with a PIN configured as the Worker secret `ADMIN_PIN`.
- Approved visitors can activate a passwordless, server-side session lasting up to 3 hours.
- The admin can reject pending requests or revoke approved access.
- Group, expense, balance, and member reads verify both the active member session and group membership.
- Group access is request/approval based; no invite-code bypass.

## Current implementation notes
- Public: `GET /api/groups/public`, `POST /api/access/request`, `GET /api/access/status`, `POST /api/access/enter`.
- Admin-only: `POST /api/admin/login`, `GET /api/admin/groups`, `POST /api/admin/groups`, `GET /api/admin/requests`, and approve/reject/revoke request actions.
- Member-only: group, expense, and balance endpoints. A member request is scoped to one selected group.
- Migration `0004_group_access_and_unique_names.sql` adds the group reference and case-insensitive unique group-name index.

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


<!-- Build trigger: verify Cloudflare Git integration is active. -->

<!-- Build trigger after compatibility-date correction: 2026-10-28 -->
