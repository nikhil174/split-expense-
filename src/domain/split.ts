// Splitting an expense into shares, in integer paise.

export type ShareRow = { memberId: string; amountCents: number };

// Equal split: the remainder paise go to the first members, one each.
export function allocateEqualSplit(totalCents: number, memberIds: unknown[]): ShareRow[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new TypeError("totalCents must be a non-negative safe integer");
  if (!Array.isArray(memberIds) || memberIds.length === 0) throw new TypeError("At least one split member is required");
  const unique = [...new Set(memberIds.map(String))];
  const base = Math.floor(totalCents / unique.length);
  const remainder = totalCents % unique.length;
  return unique.map((memberId, index) => ({ memberId, amountCents: base + (index < remainder ? 1 : 0) }));
}
export function membersInGroup<T extends { groupId: string }>(groupMembers: T[], groupId: string): T[] { return groupMembers.filter(member => member.groupId === groupId); }
export function expensesInGroup<T extends { groupId: string }>(expenses: T[], groupId: string): T[] { return expenses.filter(expense => expense.groupId === groupId); }

// Exact amounts per person, which must add up to the total.
export function allocateManualSplit(totalCents: number, allocations: { memberId?: unknown; amountCents?: unknown }[], allowedMemberIds: unknown[]): ShareRow[] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new TypeError("totalCents must be a positive safe integer");
  }
  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw new TypeError("At least one manual allocation is required");
  }
  if (!Array.isArray(allowedMemberIds)) {
    throw new TypeError("Allowed members must be an array");
  }

  const allowed = new Set(allowedMemberIds.map(String));
  const seen = new Set<string>();
  const rows = allocations.map(item => {
    const memberId = String(item?.memberId ?? "");
    const amountCents = item?.amountCents;
    if (!memberId || seen.has(memberId) || !allowed.has(memberId)) {
      throw new TypeError("Manual allocations must use unique members in this group");
    }
    if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents < 0) {
      throw new TypeError("Manual allocation cents must be a non-negative safe integer");
    }
    seen.add(memberId);
    return { memberId, amountCents };
  });

  if (rows.every(row => row.amountCents === 0)) {
    throw new TypeError("At least one manual allocation must be greater than zero");
  }
  if (rows.reduce((sum, row) => sum + row.amountCents, 0) !== totalCents) {
    throw new TypeError("Manual allocations must add up exactly to the expense total");
  }
  return rows;
}
