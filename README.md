# Split It

Mobile-first expense sharing for a group, hosted on Cloudflare Workers + D1.

## Architecture and access model
- Public endpoint lists existing groups; visitors choose a group and submit their name, that group ID and a 4-digit PIN.
- Group names are globally unique (case-insensitive, surrounding whitespace ignored), enforced by a D1 unique index.
- Only the separate admin session can create groups or review membership requests.
- Approving a request makes the visitor a member of the requested group. Approval does not expire: it lasts until the admin revokes or removes them, so there is no re-approval at sign-in.
- Admin identity/session (`split_admin`) and regular member session (`split_session`) are separate. The admin can request membership in their own group and approve that request, then use the normal expense UI.
- Members cannot create groups, directly add members, or bypass approval using invite codes.
- The admin signs in with a PIN configured as the Worker secret `ADMIN_PIN`.
- Approved members sign in with group + name + their 4-digit PIN for a server-side session lasting up to 3 hours; after that they enter their PIN again.
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
- **Payments need the receiver's confirmation** (migration `0009`, `appx_settlements.status`). A recorded payment is `pending` and does not count in any balance or debt until the person who received it confirms it (`POST /api/groups/:id/settlements/:sid/confirm`); they can also reject it (`…/reject`, kept for the record, never counts), and the payer can cancel it while pending (`…/cancel`). It counts immediately only when the recorder is the receiver, or the admin records a payment to someone removed from the group (who can no longer confirm). Pending payments are reserved against the debt, so they can never add up to more than is owed, and confirming re-checks the amount still fits (expenses may have changed). Home and each group show payments waiting for you (`GET /api/payments/pending`); payments made before `0009` stay confirmed.

## Frontend
- React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui (Radix primitives), in `web/`. Built by Vite into `dist/`, which the Worker serves.
- `wrangler.toml` has `[build] command = "npm run build"`, so `wrangler dev` and `wrangler deploy` (including Cloudflare's Git-triggered deploys) build the app first.
- Data: TanStack Query. Every write refreshes the affected screens, and a progress bar under the top bar shows while requests are in flight. Buttons show a spinner and are disabled until the request finishes.
- Look: "Quiet", light only. Near-white paper, white cards with hairlines and a whisper of shadow, ink for actions, neutral monograms and category tiles, and one restrained emerald (money owed to you) / muted rust (money you owe). Outfit (bundled) at light weights; large balances with smaller paise.
- Feel: fluid page and tab transitions, springy pill indicators, count-up amounts (animation features load after first paint), a floating bottom tab bar and ink "Add expense" button in groups, vaul bottom sheets, dark pill toasts, press-scale feedback, a short vibration on Android when a save succeeds.
- Freshness: the Worker serves the HTML with `Cache-Control: no-cache` and hashed `/assets/*` as immutable, so a new deploy shows up on the next open. The account menu and the sign-in screen show "Build <commit> · <time>" so you can confirm which version is live.
- Installable app (PWA): `web/public/manifest.webmanifest`, icons in `web/public/icons/`, and a small service worker (`web/public/sw.js`) that always fetches pages fresh and only falls back to the last loaded page when offline (API calls are never cached). "Install the app" on the sign-in screen and "Install app" in the account menu open Chrome's install dialog on Android, and show the Share → Add to Home Screen steps on iPhone (Safari or Chrome). Both are hidden inside the installed app.
- Navigation uses hash routes (`#/`, `#/admin`, `#/g/:id`, `#/g/:id/p/:memberId`), so the Android back button works.
- Group screen: hero with your position, **Add expense** / **Settle up**, tabs for Expenses (table, tap a row for the split, search, delete), Balances (you and each person → drill-down, group balances, who owes whom), Payments (table) and Insights.
- Person drill-down (`GET /api/groups/:id/with/:memberId`): every shared expense and payment between you and that person with a running balance that ends at the current debt.

## One admin, two views
- The administrator is one person. An admin session always acts as the `admin` member in every group, and the top bar switches between **My groups** (normal-user view) and **Admin** (dashboard, requests, groups, all expenses).
- The admin's saved name is reserved: nobody can request access or sign in as a member with it.
- Older data may contain a separate member entry for the admin (same person, two identities). The Admin view flags it, and **Review merge → Merge into me** folds it into the admin: expenses paid, shares (added together on the same expense) and payments move over, payments between the two entries are dropped, and everyone else's balance is unchanged (`GET /api/admin/requests/:id/merge-preview`, `POST /api/admin/requests/:id/merge-into-admin`).

## Membership policy (as implemented)
- Approved members, and members waiting for approval, are selectable as payer/split members; acting in the app still requires an active session.
- Revoked, removed or deleted members are not selectable for new expenses or member-recorded payments. Their `appx_group_members` row is kept so historical expenses, splits, settlements and balances still show their name.
## Member PINs (migration `0007`)
- Every member has a 4-digit PIN, chosen when they request access and required at sign-in. Only a hash is stored (`appx_access_requests.pin_hash`): PBKDF2-SHA256, 100,000 iterations, a random 16-byte salt per member, with `SESSION_SECRET` mixed in as a pepper so a copy of the database alone cannot be brute-forced. The iteration count is stored with each hash.
- **Rotating `SESSION_SECRET` invalidates every member PIN** (members then need an admin PIN reset).
- 5 wrong PINs in a row lock that member for 15 minutes (on top of the per-IP sign-in limit). Someone who knows a member's name can trigger this lock, but cannot sign in.
- Members from before PINs have no hash yet: their next sign-in asks them to choose and confirm one. Until they do, anyone who knows their name could set it first; the Admin view shows "no PIN yet" for them, and **Reset PIN** fixes a wrong one.
- Asking for access again under an existing name requires that name's PIN, so nobody can take over someone else's entry.
- **Reset PIN** (Admin → member menu, `POST /api/admin/requests/:id/reset-pin`) clears the PIN and lock and signs the member out; they choose a new PIN on their next sign-in.

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
- `npm run build` type-checks and builds the web app; `npm run dev:web` runs Vite with the API proxied to a local `wrangler dev` on port 8787.
- `npm run test:e2e` runs a Playwright browser test on a Pixel 7 viewport against a **local** `wrangler dev`. Start it with `npx wrangler d1 migrations apply split_expense_db --local` then `npx wrangler dev --local`, with a throwaway `ADMIN_PIN` in `.dev.vars`, and pass `E2E_ADMIN_PIN`. You need Playwright installed. The test refuses to run against a deployed Worker.
