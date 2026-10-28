export function allocateEqualSplit(totalCents, memberIds) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new TypeError("totalCents must be a non-negative safe integer");
  if (!Array.isArray(memberIds) || memberIds.length === 0) throw new TypeError("At least one split member is required");
  const unique = [...new Set(memberIds.map(String))];
  const base = Math.floor(totalCents / unique.length);
  const remainder = totalCents % unique.length;
  return unique.map((memberId, index) => ({ memberId, amountCents: base + (index < remainder ? 1 : 0) }));
}
export function membersInGroup(groupMembers, groupId) { return groupMembers.filter(member => member.groupId === groupId); }
export function expensesInGroup(expenses, groupId) { return expenses.filter(expense => expense.groupId === groupId); }
