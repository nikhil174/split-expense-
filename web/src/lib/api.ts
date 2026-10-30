// Typed client for the Worker API. Money fields ending in Cents are integer paise.

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...init });
  } catch {
    throw new ApiError("Network problem. Check your connection and try again.", 0);
  }
  let data: unknown = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError((data as { error?: string }).error || "Something went wrong. Please try again.", res.status, (data as { code?: string }).code);
  return data as T;
}
export const get = <T,>(path: string) => request<T>(path);
export const post = <T = { ok: true },>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export type Identity = { id: string; name: string };
export type Me = { admin: Identity | null; member: Identity | null };
export type GroupSummary = { id: string; name: string; myBalanceCents: number };
export type MemberStatus = "admin" | "approved" | "pending" | "removed" | "revoked" | "rejected";
export type Member = { id: string; name: string; status: MemberStatus };
export type GroupDetail = { group: { id: string; name: string }; members: Member[]; me: Identity & { isAdmin: boolean } };
export type Split = { memberId: string; name: string; amountCents: number };
export type Expense = {
  id: string; description: string; amountCents: number; createdAt: number; paidBy: string; paidByName: string;
  createdBy: string; createdByName: string; splitCount: number; splits: Split[];
  myShareCents: number; myEffectCents: number; canDelete: boolean; canEdit: boolean;
};
export type Debt = {
  fromMemberId: string; fromName: string; toMemberId: string; toName: string; amountCents: number;
  // Already sent and waiting for the receiver to confirm.
  waitingCents: number;
  canRecord: boolean; counterpartyActive: boolean;
};
export type Mine = {
  memberId: string; memberName: string; isAdmin: boolean; youOwe: Debt[]; owedToYou: Debt[];
  totalYouOweCents: number; totalOwedToYouCents: number;
};
export type Balance = { memberId: string; name: string; balanceCents: number };
export type Settlement = {
  id: string; fromMemberId: string; fromName: string; toMemberId: string; toName: string;
  amountCents: number; createdAt: number; recordedByName: string;
  // A payment counts only once the receiver confirms it.
  status: "pending" | "confirmed" | "rejected"; canDecide: boolean; canCancel: boolean;
};
export type PendingPayment = {
  id: string; groupId: string; groupName: string; fromMemberId: string; fromName: string; toMemberId: string; toName: string;
  amountCents: number; createdAt: number; incoming: boolean;
};
export type Spending = { memberId: string; name: string; paidCents: number; shareCents: number };
export type Dashboard = { totalSpentCents: number; expenseCount: number; spending: Spending[] };
export type ActivityItem =
  | { type: "expense"; id: string; description: string; paidBy: string; totalCents: number; shareCents: number; effectCents: number; runningCents: number; createdAt: number }
  | { type: "payment"; id: string; fromMemberId: string; toMemberId: string; amountCents: number; effectCents: number; runningCents: number; createdAt: number };
// One row per person per group: positive netCents means they owe me.
export type PersonBalance = { groupId: string; groupName: string; memberId: string; name: string; active: boolean; netCents: number };
export type PeopleBalances = { people: PersonBalance[]; owedToYouCents: number; youOweCents: number; netCents: number };
export type PersonView = { me: Identity; other: Identity & { active: boolean }; netCents: number; items: ActivityItem[] };

export type AccessRequest = {
  id: string; name: string; status: MemberStatus; requestedAt: number; expiresAt: number | null; groupId: string | null; groupName: string | null;
  hasPin?: boolean;
};
export type AdminGroup = { id: string; name: string; createdAt: number; memberCount: number };
export type AdminExpense = { id: string; description: string; amountCents: number; createdAt: number; groupId: string; groupName: string; paidBy: string };
export type AdminDashboard = {
  stats: { groups: number; members: number; pending: number; expenses: number; totalSpentCents: number };
  recent: Omit<AdminExpense, "id" | "groupId">[];
};
export type MergePreview = {
  memberName: string; adminName: string; groupName: string; expensesPaid: number; shares: number;
  payments: number; paymentsWithAdmin: number; memberBalanceCents: number; adminBalanceCents: number;
};
