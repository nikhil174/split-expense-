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

## Money and debt model
- All money is stored and computed in integer paise (`*_cents` columns). Amounts are parsed from rupee strings/numbers with at most two decimals (`src/money.js`); exponents, hex, booleans and fractional paise are rejected.
- **Equal split** divides paise exactly; leftover paise go to the first members, so shares differ by at most one paise.
- **Manual split** must add up exactly to the total; duplicates, non-members, negatives, fractional paise and all-zero allocations are rejected server-side.
- **Debts use direct expense attribution** (`src/settlement-logic.js`): for each expense, every split member other than the payer owes their own share to the payer. Edges are summed per pair, repayments are subtracted from the same pair, and opposite directions are netted. The UI shows "You need to pay X" / "X needs to pay you" from this model only; no net-settlement plan is shown.
- Net balance = paid − own shares + repayments made − repayments received. It always equals (owed to you − you owe) over the pairwise debts, and group balances sum to zero.
- Repayments: a normal member can only record a payment from their own account, to an active member, for at most the exact outstanding amount (re-checked atomically inside the INSERT). The admin can record any payment, including to/from removed members, so those debts can still be cleared.

## Group screen (mobile-first, Splitwise-style)
- Header shows your overall position in the group ("You are owed ₹X" / "You owe ₹X" / settled) with **+ Add expense** and **Settle up**, both opening bottom sheets.
- **Expenses** tab: a table (date, expense, amount, and what it means for you: "you lent" / "you borrowed" / "not involved"). Tap a row to see the split breakdown, who added it, and a delete button (for the person who added it, or the admin). Includes search.
- **Balances** tab: you and each person (tap for a drill-down), overall group balances, and who owes whom.
- **Person drill-down** (`GET /api/groups/:id/with/:memberId`): every shared expense and payment between you and that person, with the effect of each and a running balance that ends at the current debt. From here you can pay them, or the screen shows that you are waiting for them to record their payment.
- **Payments** tab: repayment history table. **Insights** tab: who spent the most, plus the member list.
- The group list shows your balance in each group.

## Membership policy (as implemented)
- Members who are approved (even if their 3-hour window lapsed) or pending re-approval stay selectable as payer/split members; acting in the app still requires an active session.
- Revoked, removed or deleted members are not selectable for new expenses or member-recorded payments. Their `appx_group_members` row is kept so historical expenses, splits, settlements and balances still show their name.
- Low-friction tradeoff: member sign-in is passwordless (group + approved name), so anyone who knows an approved member's name can sign in as them while their approval is active. Admin approval and the 3-hour expiry are the only guards. Adding a per-member PIN would close this; ask the owner before changing it.

## Security controls
- `HttpOnly; Secure; SameSite=Lax` cookies; cross-site writes (foreign `Origin`) are refused; JSON bodies are capped at 16 KB; split lists are capped at 100 members.
- D1-backed fixed-window rate limits (migration `0006`): admin login 10/15 min per IP and 50/hour overall, member sign-in 20/15 min per IP, access requests 10/hour per IP, expenses 60/10 min and settlements 30/10 min per member. If the table is missing, limits fail open and log an error.
- The admin PIN is compared in constant time. Use a long PIN: the rate limits slow down guessing but cannot stop it.

## Migrations
Wrangler applies files in name order and tracks them by name only. `0003_reset_app_data.sql` used to delete all app data; it is now a no-op so it can never wipe a database that had not run it yet. Do **not** rename migration files that may already be applied.

Before applying remotely, check what is pending:

```bash
npx wrangler d1 migrations list split_expense_db --remote
npx wrangler d1 migrations apply split_expense_db --remote
```

## Cloudflare deployment
1. Set production secrets (never commit them): `npx wrangler secret put ADMIN_PIN` and `npx wrangler secret put SESSION_SECRET` (long random value). Rotate them if old values were exposed. Deploys fail with "required secrets have not been set" until both exist.
2. Back up D1 (`npx wrangler d1 export split_expense_db --remote --output backup.sql`), list pending migrations, then apply them.
3. `npx wrangler deploy`, then do read-only checks on the live URL (`GET /api/groups/public`, then load the page and look for the "Your debts" section).

The D1 binding is named `split-expense` (see `wrangler.toml`).

## Tests
- `npm test` runs the unit, property, migration and API tests (`node --test`, Node 22+). API tests run the real Worker against an in-memory SQLite D1 double with every migration applied and foreign keys enforced.
- `npm run test:e2e` runs a Playwright browser test on a Pixel 7 viewport against a **local** `wrangler dev`. Start it with `npx wrangler d1 migrations apply split_expense_db --local` then `npx wrangler dev --local`, with a throwaway `ADMIN_PIN` in `.dev.vars`, and pass `E2E_ADMIN_PIN`. You need Playwright installed. The test refuses to run against a deployed Worker.
