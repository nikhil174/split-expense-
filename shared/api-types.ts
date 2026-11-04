// The JSON the API answers with, shared by the Worker (src/) and the React
// app (web/), so the two can't drift apart: the services declare they return
// these shapes, and the app reads them. Money fields ending in Cents are
// integer paise.

export type Identity = { id: string; name: string };
// The signed-in account. legacy: from before accounts (auto username, may
// still sign in with group + name) until they choose a username.
// hasPin: has a password (accounts once had 4-digit PINs); google: Google sign-in connected.
export type User = Identity & { username: string; email: string | null; legacy: boolean; hasPin: boolean; google: boolean; emailVerified: boolean;
  // Only for the site owner: the Admin tab, and whether this session entered the admin key.
  siteAdmin?: boolean; adminUnlocked?: boolean };
export type AdminOverview = { users: number; groups: number; expenses: number; totalSpentCents: number; newUsersThisWeek: number };
export type AdminUser = { id: string; name: string; username: string; email: string | null; createdAt: number; legacy: boolean; siteAdmin: boolean; hasPin: boolean; locked: boolean; groupCount: number };
export type AdminGroup = { id: string; name: string; createdAt: number; memberCount: number; admins: string | null; expenseCount: number; totalCents: number; lastActivity: number | null; hasPin: boolean };
export type Me = { user: User | null };
export type Role = "admin" | "member";
// hasPin: the group has a 4-digit PIN; unlocked: opened with it on this device (lasts a day).
export type GroupSummary = { id: string; name: string; myBalanceCents: number; role: Role; memberCount: number; hasPin: boolean; unlocked: boolean };
// active: in the group; pending: asked to join; invited: not answered yet.
export type MemberStatus = "active" | "pending" | "invited" | "suggested" | "removed";
// friend: where I stand with them ("requested": I asked; "asked_you": they asked me).
export type FriendState = "friend" | "requested" | "asked_you" | null;
export type Member = { id: string; name: string; username: string | null; role: Role; status: MemberStatus; friend: FriendState; invitedBy: string | null };
export type Friend = { id: string; name: string; username: string; since: number };
export type Friends = { friends: Friend[]; incoming: Friend[]; outgoing: Friend[] };
export type JoinInfo = { groupId: string; groupName: string; memberCount: number; hasPin: boolean; status: MemberStatus | null };
export type GroupDetail = { group: { id: string; name: string; hasPin: boolean }; members: Member[]; waiting: Member[]; me: Identity & { isAdmin: boolean; role: Role } };
export type Invitation = { groupId: string; groupName: string; invitedBy: string; memberCount: number; hasPin: boolean };
export type Split = { memberId: string; name: string; amountCents: number };
// One entry in a group's history (GET /api/groups/:id/history).
export type HistorySnapshot = {
  description?: string; amountCents: number; paidBy?: string; paidByName?: string;
  splits?: { memberId: string; name: string; amountCents: number }[];
  fromMemberId?: string; fromName?: string; toMemberId?: string; toName?: string; createdBy?: string; createdByName?: string; createdAt?: number;
};
export type HistoryEntry = {
  id: string; entity: "expense" | "payment"; entityId: string; action: "created" | "edited" | "deleted" | "cancelled";
  actorId: string; actorName: string; createdAt: number; before: HistorySnapshot | null; after: HistorySnapshot | null;
};
export type Expense = {
  id: string; description: string; amountCents: number; amount: number; createdAt: number; paidBy: string; paidByName: string;
  createdBy: string; createdByName: string; splitCount: number; splits: Split[];
  // Photos attached to it (receipts); each is GET /api/groups/:id/expenses/:expenseId/photos/:photoId.
  photoIds: string[];
  myShareCents: number; myEffectCents: number; canDelete: boolean; canEdit: boolean;
};
export type Debt = {
  fromMemberId: string; fromName: string; toMemberId: string; toName: string; amountCents: number; amount: number;
  // Already sent and waiting for the receiver to confirm.
  waitingCents: number;
  canRecord: boolean; counterpartyActive: boolean;
};
// Who owes whom in a group (GET /api/groups/:id/debts).
export type Debts = { model: "direct-expense-attribution"; debts: Debt[] };
// Mine only (GET /api/groups/:id/settlements/mine).
export type Mine = Debts & {
  memberId: string; memberName: string; isAdmin: boolean; youOwe: Debt[]; owedToYou: Debt[];
  totalYouOweCents: number; totalOwedToYouCents: number;
};
export type Balance = { memberId: string; name: string; balanceCents: number; balance: number };
// "payment": money paid back; "waiver": the lender let the debtor off (no
// money moved). Both clear the debt once confirmed.
export type PaymentKind = "payment" | "waiver";
export type Settlement = {
  id: string; fromMemberId: string; fromName: string; toMemberId: string; toName: string;
  amountCents: number; amount: number; createdAt: number; createdBy: string; recordedByName: string; decidedAt: number | null;
  // A payment counts only once the receiver confirms it.
  status: "pending" | "confirmed" | "rejected"; kind: PaymentKind; canDecide: boolean; canCancel: boolean; hasProof: boolean;
  // Recorded by the receiver ("they paid me"): a group admin approves it.
  needsAdmin: boolean;
};
// One member's whole picture in a group (GET /api/groups/:id/members/:memberId).
export type MemberSummary = {
  member: { id: string; name: string; active: boolean; isMe: boolean };
  paidCents: number; shareCents: number; balanceCents: number;
  owes: { memberId: string; name: string; amountCents: number }[];
  owedBy: { memberId: string; name: string; amountCents: number }[];
  expenses: { id: string; description: string; amountCents: number; paidBy: string; paidByName: string; createdAt: number; shareCents: number; splitCount: number; effectCents: number }[];
  payments: { id: string; fromMemberId: string; fromName: string; toMemberId: string; toName: string; amountCents: number; createdAt: number; status: "pending" | "confirmed"; kind: PaymentKind }[];
};
// How a person likes to be paid (UPI only for now).
export type PaymentMethod = { kind: "upi"; upiId: string | null; hasQr: boolean; updatedAt: number | null };
export type GroupPaymentMethod = PaymentMethod & { memberId: string; name: string; isMe: boolean };
export type AppNotification = {
  id: string; kind: string; title: string; body: string | null; link: string | null; actorName: string | null;
  createdAt: number; readAt: number | null; groupId: string | null; groupName: string | null;
};
export type PendingPayment = {
  id: string; groupId: string; groupName: string; fromMemberId: string; fromName: string; toMemberId: string; toName: string;
  amountCents: number; kind: PaymentKind; createdAt: number; incoming: boolean; hasProof: boolean;
  // "They paid me", recorded by the receiver: a group admin approves it.
  needsAdmin: boolean;
};
export type Spending = { memberId: string; name: string; paidCents: number; shareCents: number; paid: number; share: number };
export type Dashboard = { totalSpentCents: number; totalSpent: number; expenseCount: number; spending: Spending[] };
export type ActivityItem =
  | { type: "expense"; id: string; description: string; paidBy: string; totalCents: number; shareCents: number; effectCents: number; runningCents: number; createdAt: number }
  | { type: "payment"; id: string; fromMemberId: string; toMemberId: string; amountCents: number; effectCents: number; runningCents: number; createdAt: number; kind?: PaymentKind };
// One row per person per group: positive netCents means they owe me.
// waitingOutCents: I sent them, awaiting their approval; waitingInCents: they sent me, awaiting mine.
export type PersonBalance = { groupId: string; groupName: string; memberId: string; name: string; active: boolean; netCents: number; waitingOutCents: number; waitingInCents: number };
export type PeopleBalances = { people: PersonBalance[]; owedToYouCents: number; youOweCents: number; netCents: number };
export type PersonView = { me: Identity; other: Identity & { active: boolean }; netCents: number; items: ActivityItem[] };
// One person's statement (GET /api/groups/:id/members/:memberId/statement),
// behind "Share as Excel".
export type StatementItem = {
  type: "expense" | "payment"; id: string; createdAt: number;
  description?: string; paidBy?: string; paidByName?: string; totalCents?: number; shareCents?: number;
  fromMemberId?: string; fromName?: string; toMemberId?: string; toName?: string; amountCents?: number; kind?: PaymentKind;
  // How it moved the balance between the two (0 for payments not counted), and the balance after it.
  effectCents: number; runningCents: number;
  // Expenses and confirmed payments are "counted"; other payments keep their status.
  status: "counted" | "confirmed" | "pending" | "rejected";
};
export type Statement = {
  group: { id: string; name: string };
  person: { id: string; name: string; username: string | null; active: boolean };
  generatedAt: number;
  totals: { paidCents: number; shareCents: number; balanceCents: number };
  expenses: { id: string; createdAt: number; description: string; totalCents: number; paidBy: string; paidByName: string; shareCents: number; splitCount: number; cumulativeShareCents: number }[];
  pairs: { id: string; name: string; active: boolean; netCents: number; items: StatementItem[] }[];
};
