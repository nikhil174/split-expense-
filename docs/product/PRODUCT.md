# Split It: product document

Split It is a free, ad-free app for sharing trip and group expenses among friends. It records who paid, works out who owes whom, and helps people settle up by UPI. It runs in the browser and installs on phones like an app.

This document describes the product: who it is for, what it does, and the rules it follows. How it is built is in the system design: [high-level design](../design/HLD.md) and [low-level design](../design/LLD.md).

## 1. Who it is for

**Users.** Friends who travel or live together a few times a year: a trip to Goa, a shared flat, an office outing. Mostly on phones, in India, paying each other by UPI.

**Their problems**

| Problem | What Split It does |
|---|---|
| "Who paid for what?" gets lost in chats | Every expense is recorded with who paid, the amount, the split, and optional receipt photos |
| Working out who owes whom is tedious and error-prone | Balances are worked out automatically, to the paisa |
| Someone says they paid, someone else says they didn't | A payment only counts once the person who received it confirms it |
| Shared phones and screenshots expose a group's money | Each group has a 4-digit PIN, asked once a day on each device |
| Paying back means asking for UPI details | Each person's UPI ID and QR code are one tap away |
| Sometimes a friend says "forget it, you don't need to pay" | "No need to pay" lets a lender let someone off; the group sees it |

**Principles**

- **Free and ad-free.** There are no paid features and no tracking. It runs on Cloudflare's free tier.
- **Correct money.** Amounts are whole paise. Nothing is rounded twice, and balances always add up.
- **Nothing counts without consent.** Payments and waivers count only once the other side, or an admin, agrees.
- **Transparent.** Everyone in a group sees the same numbers, and every change is in a permanent history.
- **Private.** Groups never see each other. Even the site owner can't read anyone's expenses.

## 2. Roles

| Role | Who | Can |
|---|---|---|
| Member | Anyone who joined a group | Add expenses, edit and delete the ones they paid for, record and confirm payments, suggest people to invite |
| Group admin | Whoever created the group, and anyone an admin promotes | Everything a member can do, plus: edit or delete any expense, invite and remove people, approve join requests, approve "they paid me" payments and waivers, make others admin, rename the group, change its PIN, delete the group |
| Site owner | Whoever holds the admin key | A hidden console showing counts, accounts and groups in summary, and a way to clear a forgotten group PIN. No access to expenses, payments or passwords |

A group can have several admins. Everyone can see who the admins are.

## 3. Features

### 3.1 Accounts

- **Sign up** with a name, a username (checked live) and a password: at least 8 characters, with letters and numbers. Email is optional.
- **Sign in** with a username or email plus the password, or with **Google** (when configured).
- **Forgot password** sends a reset link by email. The answer looks the same whether or not the account exists.
- **Confirm email** by a link.
- **Profile**: change the name, username, email or password. A new name shows everywhere, including past payments.
- **Link an old account**: merge a second account into this one, with all its groups and history.
- **Safety**: 5 wrong passwords lock the account for 15 minutes. A sign-in lasts 7 days.

### 3.2 Groups

- **Create** a group with a name and a 4-digit PIN. The creator becomes its admin.
- **Join** in any of these ways:
  - **by invite**: an admin invites a person by username or email, and they accept with the group PIN;
  - **by invite link or QR code**: anyone can share these; the person signs up or signs in, asks to join with the PIN, and an admin lets them in;
  - **by suggestion**: a member suggests a friend, and an admin approves.
- **Group PIN**: it is needed to join and to open the group, and is remembered for a day on each device. 5 wrong PINs in 15 minutes are refused.
- **Manage**: admins can rename the group, change its PIN, remove people, and make others admin. Anyone can leave a group. The site owner can clear a forgotten PIN.
- **Delete**: an admin can delete the group and everything in it.

### 3.3 Expenses

- **Add** an expense with a description, total, who paid, and the split. An emoji-style icon is chosen from the description (food, cab, hotel, groceries…).
  - **Equally** among the people ticked. Paise are shared out so the total is exact: ₹100 among 3 is ₹33.34 + ₹33.33 + ₹33.33.
  - **Exact amounts** per person, which must add up to the total.
- **Photos**: attach up to 3 photos (a receipt, a bill, proof). The phone shrinks them before uploading. Everyone in the group can open them full size.
- **Edit** (by the payer or an admin): anything can change, including the photos. People taken out of the split are told.
- **Delete** (by the payer or an admin). The expense stays in the history.
- **List**: newest first, with search by description or payer. Each row shows what it means for you: "you lent ₹50" or "you borrowed ₹25". Open a row to see the split, the photos and its edit history.

### 3.4 Balances

- **Direct debts.** Each person owes their share to whoever paid. Debts between two people are netted, so only the difference is shown. Debts are not "simplified" across people, so everyone can see exactly why they owe someone.
- **Home** shows "Owed to you" and "You owe" across all groups, and lists people with how much each owes you or you owe them.
- **Person view**: everything between you and one person (expenses, payments, waivers) with a running balance, and anything still waiting.
- Only **confirmed** payments and waivers count. Pending and rejected ones are shown but don't change balances.

### 3.5 Settling up

- **Pay by UPI**: each person can add a UPI ID and a QR code. Settle up shows them with a "Pay in a UPI app" button.
- **Record a payment** for all or part of what you owe. You can attach a screenshot as proof.
  - **"I paid them"**: the receiver confirms it ("Confirm" or "Not received"). Only then does it count.
  - **"They paid me"**: the lender records a payment they received. A group admin approves it, at once if the lender is an admin.
- **No need to pay (waivers)**: let someone off what they owe, all of it or part.
  - **The lender offers** ("No need to pay? Let them off"): a group admin approves it, at once if the lender is an admin.
  - **The debtor asks** ("Can't pay? Ask them to let you off"): the lender says yes or no; a group admin can also decide.
  - The debtor can never approve their own, even as an admin. Once it counts, **everyone in the group is told**.
- **Cancel** while waiting: the person who recorded it, the payer, or an admin. The debtor can't cancel the lender's offer to let them off, but can withdraw their own request.
- **Never overpay**: a payment or waiver can't be more than what is still owed, counting what is already waiting. Confirming re-checks this, because expenses may have changed since.
- **Payments tab**: every payment and waiver in the group, filtered to all, yours or others, with its status.

### 3.6 Insights

- **Dashboard**: total spent, number of expenses, and for each person what they paid and what their share was.
- **People**: each person's summary: what they paid, their share, their balance, and their payments.
- **Share as Excel**: one person's statement, built on the phone. It has a Summary sheet (every expense, cumulative share, totals, where they stand with each person) and one sheet per other member (expense by expense, payments marked paid back, waiting or rejected, "let off" totals, and a running balance).

### 3.7 History

Every expense added, edited (before and after) or deleted, and every cancelled payment, is kept permanently. A group's history is under Payments, and each expense shows its own when opened.

### 3.8 Notifications

- An **in-app bell** with unread count, and **phone push** notifications once enabled.
- Tapping a notification opens the right place: the expense, the person, or the group.
- Nobody is notified about their own action.

| Event | Who hears |
|---|---|
| Expense added, edited, deleted | Everyone in it (payer and split), plus anyone removed from it |
| Payment recorded | The receiver (to confirm), and the payer if someone else recorded it |
| "They paid me" recorded | The group's admins (to approve), and the payer |
| Payment confirmed, rejected, cancelled | The other side (and both sides when an admin decided) |
| Lender lets someone off | The admins (to approve) and the debtor |
| Debtor asks to be let off | The lender and the group's admins (to decide) |
| Waiver approved | Everyone in the group, each in their own words |
| Waiver rejected, cancelled, withdrawn | The lender and the debtor |
| Invites, join requests, suggestions, new members, made admin, removed | The people concerned and the group's admins |
| Friend requests and acceptances | The other person |

### 3.9 Friends

Add friends from a group's member list, or by username. They accept on the Friends screen. Friends are quick to invite to new groups.

### 3.10 The app on phones

- **Installable**: "Add to Home screen" on Android and iPhone, with install steps on the sign-in screen.
- **Fast**: the app shell is cached, and data loads from the phone first, then refreshes.
- **Always current**: a new version is picked up on its own. The app reloads when you return to it, or shows an Update button.
- Works from small phones (375 px) to desktop, with nothing cut off.

## 4. Rules and limits

| Rule | Value |
|---|---|
| Currency | ₹ only, stored as whole paise |
| Split | Up to 100 people per expense |
| Photos | Up to 3 per expense; PNG, JPEG or WebP; at most 300 KB each after shrinking |
| Payment screenshot, UPI QR | One image each, same image rules |
| Lists | Newest 300 expenses, 200 payments, 200 history entries, 100 notifications |
| Group PIN | 4 digits; remembered for 1 day per device; 5 wrong tries per 15 minutes |
| Password | 8+ characters with letters and numbers; 5 wrong tries lock it for 15 minutes |
| Sign-in | Lasts 7 days |
| Writes | Rate-limited per person: 60 expenses, 30 payments, 40 invites per 10 minutes |
| Old read notifications | Deleted after 90 days |

## 5. Main journeys

1. **A trip.** Nikhil creates "Goa Trip" with a PIN and shares the invite link in the trip chat. Friends sign up, ask to join, and he lets them in.
2. **Spending.** Whoever pays adds the expense on the spot, splits it, and snaps the bill. Everyone in the split gets a notification.
3. **Checking.** Anyone opens Balances or Home to see who owes whom. They can tap a person to see why.
4. **Paying back.** Vicky owes Nikhil ₹829.94. She opens Settle up, pays by UPI from the QR, records it with a screenshot, and Nikhil taps Confirm. It now counts.
5. **Cash handed over.** Nikhil was paid in cash and records "Jagan paid me". An admin approves it.
6. **Letting someone off.** Arsha owes ₹64 that isn't worth chasing. Nikhil taps "No need to pay", an admin approves, and the group is told.
7. **Wrapping up.** At the end, someone shares their Excel statement to double-check everything.

## 6. Not in scope

- Paying inside the app: people pay with their own UPI app.
- Currencies other than ₹, and currency conversion.
- "Simplify debts" across people (on purpose: direct debts are easier to trust).
- Recurring expenses, budgets, analytics, ads, and app-store apps.

## 7. Possible next steps

- Move photos and screenshots to object storage (R2) as usage grows.
- An admin audit view built on the history.
- Recurring expenses (rent, subscriptions).
- Reminders to people who owe for a long time.
- Other currencies for trips abroad.

## 8. Glossary

| Term | Meaning |
|---|---|
| Split | Who shares an expense, and how much each person's share is |
| Debt | What one person owes another after netting both directions |
| Confirmed | A payment or waiver that counts in balances |
| Pending | Recorded, waiting for the receiver or an admin |
| "They paid me" | A payment recorded by the person who received it; an admin approves |
| Waiver / "No need to pay" | Letting someone off what they owe, offered by the lender or asked for by the debtor |
| Group PIN | A 4-digit code to join and open a group |
