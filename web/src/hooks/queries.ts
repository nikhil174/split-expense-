import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  get, post, type AccessRequest, type AdminDashboard, type AdminExpense, type AdminGroup, type Balance, type Dashboard,
  type Debt, type Expense, type GroupDetail, type GroupSummary, type Me, type MergePreview, type Mine, type PeopleBalances, type PersonView, type Settlement,
} from "@/lib/api";

export const keys = {
  me: ["me"] as const,
  groups: ["groups"] as const,
  people: ["people-balances"] as const,
  group: (id: string) => ["group", id] as const,
  admin: ["admin"] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => get<Me>("/api/me"), staleTime: 60_000 });
export const useGroups = (enabled = true) =>
  useQuery({ queryKey: keys.groups, queryFn: () => get<{ groups: GroupSummary[] }>("/api/groups").then(d => d.groups), enabled });

export const usePeopleBalances = () => useQuery({ queryKey: keys.people, queryFn: () => get<PeopleBalances>("/api/balances") });

// Every group-scoped query shares the ["group", id] prefix, so one
// invalidation after a write refreshes the whole screen.
const groupQuery = <T,>(id: string, part: string, path: string) => ({
  queryKey: [...keys.group(id), part] as const,
  queryFn: () => get<T>(`/api/groups/${encodeURIComponent(id)}${path}`),
});
export const useGroup = (id: string) => useQuery(groupQuery<GroupDetail>(id, "detail", ""));
export const useExpenses = (id: string) => useQuery({ ...groupQuery<{ expenses: Expense[] }>(id, "expenses", "/expenses"), select: d => d.expenses });
export const useBalances = (id: string) => useQuery({ ...groupQuery<{ balances: Balance[] }>(id, "balances", "/balances"), select: d => d.balances });
export const useSettlements = (id: string) => useQuery({ ...groupQuery<{ settlements: Settlement[] }>(id, "settlements", "/settlements"), select: d => d.settlements });
export const useMine = (id: string) => useQuery(groupQuery<Mine>(id, "mine", "/settlements/mine"));
export const useDebts = (id: string) => useQuery({ ...groupQuery<{ debts: Debt[] }>(id, "debts", "/debts"), select: d => d.debts });
export const useDashboard = (id: string) => useQuery(groupQuery<Dashboard>(id, "dashboard", "/dashboard"));
export const usePerson = (id: string, memberId: string) => useQuery(groupQuery<PersonView>(id, "person-" + memberId, "/with/" + encodeURIComponent(memberId)));

export function refreshGroup(qc: QueryClient, groupId: string) {
  return Promise.all([qc.invalidateQueries({ queryKey: keys.group(groupId) }), qc.invalidateQueries({ queryKey: keys.groups }), qc.invalidateQueries({ queryKey: keys.people }), qc.invalidateQueries({ queryKey: keys.admin })]);
}

export type NewExpense =
  | { description: string; amount: string; paidBy: string; splitMode: "equal"; memberIds: string[] }
  | { description: string; amount: string; paidBy: string; splitMode: "manual"; allocations: { memberId: string; amount: string }[] };

export function useAddExpense(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewExpense) => post<{ id: string }>(`/api/groups/${groupId}/expenses`, body),
    onSuccess: () => refreshGroup(qc, groupId),
  });
}
export function useDeleteExpense(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) => post(`/api/groups/${groupId}/expenses/${expenseId}/delete`),
    onSuccess: () => refreshGroup(qc, groupId),
    onError: (e: Error) => toast.error(e.message),
  });
}
export function useRecordPayment(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { fromMemberId: string; toMemberId: string; amount: string }) => post(`/api/groups/${groupId}/settlements`, body),
    onSuccess: () => refreshGroup(qc, groupId),
  });
}

// ----- Admin -----
// Admin data changes from other people's actions (new requests, expenses), so
// refetch on every tab switch instead of trusting a cached copy.
const adminQuery = <T,>(part: string, path: string) => ({ queryKey: [...keys.admin, part] as const, queryFn: () => get<T>(path), staleTime: 0 });
export const useAdminDashboard = () => useQuery(adminQuery<AdminDashboard>("dashboard", "/api/admin/dashboard"));
export const useAdminRequests = () => useQuery({ ...adminQuery<{ requests: AccessRequest[] }>("requests", "/api/admin/requests"), select: d => d.requests, refetchInterval: 30_000 });
export const useAdminGroups = () => useQuery({ ...adminQuery<{ groups: AdminGroup[] }>("groups", "/api/admin/groups"), select: d => d.groups });
export const useAdminExpenses = () => useQuery({ ...adminQuery<{ expenses: AdminExpense[] }>("expenses", "/api/admin/expenses"), select: d => d.expenses });
export const useMergePreview = (requestId: string | null) =>
  useQuery({ ...adminQuery<MergePreview>("merge-" + requestId, `/api/admin/requests/${requestId}/merge-preview`), enabled: !!requestId, staleTime: 0 });

// Admin writes touch many screens; refresh everything that could have changed.
export function useAdminAction<V>(fn: (v: V) => Promise<unknown>, success?: (v: V) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (_d, v) => {
      if (success) toast.success(success(v));
      await Promise.all([qc.invalidateQueries({ queryKey: keys.admin }), qc.invalidateQueries({ queryKey: keys.groups }), qc.invalidateQueries({ queryKey: ["group"] })]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
