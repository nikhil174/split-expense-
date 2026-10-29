// Debt model: direct expense attribution.
//
// For every expense, each split member other than the payer owes their own
// allocated share to the person who paid that expense. The payer's own share
// is not a debt. Edges are aggregated per (debtor, creditor) pair, recorded
// repayments are subtracted from the same directed pair, and opposite
// directions are netted so only the difference is shown.
//
// Net balance for a member (positive = the group owes them):
//   paid − own allocated shares + repayments made − repayments received
// With exact splits this always equals (Σ owed to them) − (Σ they owe) over
// the pairwise debts above, and balances across a group sum to zero.
//
// All amounts are integer paise. Inputs are aggregated ledger rows:
//   paidTotals:  [{ memberId, amountCents }]                  expenses paid
//   splitEdges:  [{ payerId, memberId, amountCents }]         split shares
//   settlements: [{ fromMemberId, toMemberId, amountCents }]  repayments

function assertCents(value) {
  if (!Number.isSafeInteger(value)) throw new TypeError("Ledger amounts must be integer paise");
  return value;
}

function addTo(map, key, cents) {
  map.set(key, (map.get(key) || 0) + cents);
}

function addEdge(edges, from, to, cents) {
  if (!edges.has(from)) edges.set(from, new Map());
  addTo(edges.get(from), to, cents);
}

function edgeValue(edges, from, to) {
  return edges.get(from)?.get(to) || 0;
}

export function computeBalances({ paidTotals = [], splitEdges = [], settlements = [] }) {
  const balances = new Map();
  for (const row of paidTotals) addTo(balances, String(row.memberId), assertCents(row.amountCents));
  for (const row of splitEdges) addTo(balances, String(row.memberId), -assertCents(row.amountCents));
  for (const row of settlements) {
    addTo(balances, String(row.fromMemberId), assertCents(row.amountCents));
    addTo(balances, String(row.toMemberId), -row.amountCents);
  }
  return balances;
}

// Returns netted debts [{ fromMemberId, toMemberId, amountCents }] where
// amountCents > 0 means fromMemberId still owes toMemberId that amount.
export function computePairwiseDebts({ splitEdges = [], settlements = [] }) {
  // gross.get(debtor).get(creditor) = shares owed minus repayments made.
  const gross = new Map();
  for (const row of splitEdges) {
    const payer = String(row.payerId), member = String(row.memberId);
    if (payer === member) continue; // the payer's own share is not a debt
    addEdge(gross, member, payer, assertCents(row.amountCents));
  }
  for (const row of settlements) {
    addEdge(gross, String(row.fromMemberId), String(row.toMemberId), -assertCents(row.amountCents));
  }

  const members = new Set();
  for (const [from, targets] of gross) {
    members.add(from);
    for (const to of targets.keys()) members.add(to);
  }
  const ordered = [...members].sort();
  const debts = [];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i], b = ordered[j];
      const net = edgeValue(gross, a, b) - edgeValue(gross, b, a);
      if (net > 0) debts.push({ fromMemberId: a, toMemberId: b, amountCents: net });
      else if (net < 0) debts.push({ fromMemberId: b, toMemberId: a, amountCents: -net });
    }
  }
  return debts.sort((x, y) => y.amountCents - x.amountCents
    || x.fromMemberId.localeCompare(y.fromMemberId)
    || x.toMemberId.localeCompare(y.toMemberId));
}

// Exact amount `fromMemberId` currently owes `toMemberId` (0 if none).
export function outstandingDebt(debts, fromMemberId, toMemberId) {
  const debt = debts.find(d => d.fromMemberId === fromMemberId && d.toMemberId === toMemberId);
  return debt ? debt.amountCents : 0;
}

export function debtsForMember(debts, memberId) {
  const youOwe = debts.filter(d => d.fromMemberId === memberId);
  const owedToYou = debts.filter(d => d.toMemberId === memberId);
  return {
    youOwe,
    owedToYou,
    totalYouOweCents: youOwe.reduce((sum, d) => sum + d.amountCents, 0),
    totalOwedToYouCents: owedToYou.reduce((sum, d) => sum + d.amountCents, 0),
  };
}

// Validates a proposed repayment against the current ledger. Throws a
// SettlementError with an HTTP-ish status; returns the cents on success.
export class SettlementError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function validateSettlement({ debts, fromMemberId, toMemberId, amountCents, actorId, actorIsAdmin = false }) {
  if (!fromMemberId || !toMemberId) throw new SettlementError("Choose who is paying and who is being paid.");
  if (fromMemberId === toMemberId) throw new SettlementError("A member cannot pay themselves.");
  if (!actorIsAdmin && fromMemberId !== actorId) {
    throw new SettlementError("You can only record a payment made by your own account.", 403);
  }
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new SettlementError("Enter a valid payment amount.");
  const due = outstandingDebt(debts, fromMemberId, toMemberId);
  if (due === 0) throw new SettlementError("There is no outstanding debt from this member to that recipient.", 409);
  if (amountCents > due) throw new SettlementError("Payment exceeds the amount currently owed (₹" + (due / 100).toFixed(2) + ").", 409);
  return amountCents;
}

// Person-to-person drill-down between `me` and `other`, in the same direct
// attribution model. Positive amounts mean `other` owes `me` more.
//   shares:      [{ expenseId, description, paidBy, memberId, amountCents, totalCents, createdAt }]
//                split rows (amountCents is that member's share)
//   settlements: [{ id, fromMemberId, toMemberId, amountCents, createdAt }]
// Returns { netCents, items } with items newest first, each carrying the
// running balance after it. netCents always equals the netted pairwise debt.
export function pairwiseActivity({ shares = [], settlements = [], me, other }) {
  const items = [];
  for (const row of shares) {
    const cents = assertCents(row.amountCents);
    if (cents === 0) continue;
    if (row.paidBy === me && row.memberId === other) {
      items.push({ type: "expense", id: row.expenseId, description: row.description, paidBy: me, totalCents: row.totalCents, shareCents: cents, effectCents: cents, createdAt: row.createdAt });
    } else if (row.paidBy === other && row.memberId === me) {
      items.push({ type: "expense", id: row.expenseId, description: row.description, paidBy: other, totalCents: row.totalCents, shareCents: cents, effectCents: -cents, createdAt: row.createdAt });
    }
  }
  for (const s of settlements) {
    const cents = assertCents(s.amountCents);
    if (s.fromMemberId === me && s.toMemberId === other) items.push({ type: "payment", id: s.id, fromMemberId: me, toMemberId: other, amountCents: cents, effectCents: cents, createdAt: s.createdAt });
    else if (s.fromMemberId === other && s.toMemberId === me) items.push({ type: "payment", id: s.id, fromMemberId: other, toMemberId: me, amountCents: cents, effectCents: -cents, createdAt: s.createdAt });
  }
  items.sort((a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id)));
  let running = 0;
  for (const item of items) { running += item.effectCents; item.runningCents = running; }
  return { netCents: running, items: items.reverse() };
}
