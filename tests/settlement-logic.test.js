import test from "node:test";
import assert from "node:assert/strict";
import { allocateEqualSplit, allocateManualSplit } from "../src/split-logic.js";
import { computeBalances, computePairwiseDebts, debtsForMember, outstandingDebt, validateSettlement } from "../src/settlement-logic.js";

// Tiny in-memory ledger mirroring what the Worker aggregates from D1.
function ledger() {
  const expenses = [], settlements = [];
  return {
    expense(paidBy, amountCents, members) { expenses.push({ paidBy, amountCents, splits: allocateEqualSplit(amountCents, members) }); return this; },
    manual(paidBy, amountCents, allocations) {
      const splits = allocateManualSplit(amountCents, Object.entries(allocations).map(([memberId, c]) => ({ memberId, amountCents: c })), Object.keys(allocations));
      expenses.push({ paidBy, amountCents, splits });
      return this;
    },
    pay(fromMemberId, toMemberId, amountCents) { settlements.push({ fromMemberId, toMemberId, amountCents }); return this; },
    get rows() {
      return {
        paidTotals: expenses.map(e => ({ memberId: e.paidBy, amountCents: e.amountCents })),
        splitEdges: expenses.flatMap(e => e.splits.map(s => ({ payerId: e.paidBy, memberId: s.memberId, amountCents: s.amountCents }))),
        settlements,
      };
    },
    get debts() { return computePairwiseDebts(this.rows); },
    get balances() { return Object.fromEntries(computeBalances(this.rows)); },
  };
}
const sum = values => values.reduce((a, b) => a + b, 0);

test("1. A pays ₹100 split equally with B → B owes A ₹50, not ₹100", () => {
  const l = ledger().expense("A", 10000, ["A", "B"]);
  assert.deepEqual(l.debts, [{ fromMemberId: "B", toMemberId: "A", amountCents: 5000 }]);
});

test("2. A pays ₹100 split only among B and C → each owes A ₹50", () => {
  const l = ledger().expense("A", 10000, ["B", "C"]);
  assert.equal(outstandingDebt(l.debts, "B", "A"), 5000);
  assert.equal(outstandingDebt(l.debts, "C", "A"), 5000);
  assert.equal(l.debts.length, 2);
  assert.deepEqual(l.balances, { A: 10000, B: -5000, C: -5000 });
});

test("3. B repays A ₹20 → B's debt to A falls from ₹50 to ₹30", () => {
  const l = ledger().expense("A", 10000, ["A", "B"]).pay("B", "A", 2000);
  assert.equal(outstandingDebt(l.debts, "B", "A"), 3000);
  assert.deepEqual(l.balances, { A: 3000, B: -3000 });
});

test("4. full repayment clears the debt", () => {
  const l = ledger().expense("A", 10000, ["A", "B"]).pay("B", "A", 5000);
  assert.deepEqual(l.debts, []);
  assert.deepEqual(l.balances, { A: 0, B: 0 });
});

test("5. A owes B ₹60 and B owes A ₹40 → net A owes B ₹20", () => {
  const l = ledger().manual("B", 6000, { A: 6000 }).manual("A", 4000, { B: 4000 });
  assert.deepEqual(l.debts, [{ fromMemberId: "A", toMemberId: "B", amountCents: 2000 }]);
  assert.equal(outstandingDebt(l.debts, "B", "A"), 0);
});

test("6. overpayment is rejected", () => {
  const debts = ledger().expense("A", 10000, ["A", "B"]).debts;
  assert.throws(() => validateSettlement({ debts, fromMemberId: "B", toMemberId: "A", amountCents: 5001, actorId: "B" }), err => err.status === 409);
  assert.equal(validateSettlement({ debts, fromMemberId: "B", toMemberId: "A", amountCents: 5000, actorId: "B" }), 5000);
  // Paying in the wrong direction is also rejected: A owes B nothing.
  assert.throws(() => validateSettlement({ debts, fromMemberId: "A", toMemberId: "B", amountCents: 1, actorId: "A" }), err => err.status === 409);
});

test("7. self-settlement is rejected", () => {
  const debts = ledger().expense("A", 10000, ["A", "B"]).debts;
  assert.throws(() => validateSettlement({ debts, fromMemberId: "B", toMemberId: "B", amountCents: 100, actorId: "B" }), /cannot pay themselves/);
});

test("9. a normal member cannot record a payment from another member's account", () => {
  const debts = ledger().expense("A", 10000, ["A", "B", "C"]).debts;
  assert.throws(() => validateSettlement({ debts, fromMemberId: "B", toMemberId: "A", amountCents: 100, actorId: "C" }), err => err.status === 403);
  assert.equal(validateSettlement({ debts, fromMemberId: "B", toMemberId: "A", amountCents: 100, actorId: "admin", actorIsAdmin: true }), 100);
});

test("10. group balances remain zero-sum after settlement", () => {
  const l = ledger().expense("A", 10001, ["A", "B", "C"]).expense("B", 333, ["A", "C"]).pay("C", "A", 1000).pay("C", "B", 166);
  assert.equal(sum(Object.values(l.balances)), 0);
});

test("11. rounding: ₹100.01 split three ways keeps every paise and debts match shares", () => {
  const l = ledger().expense("A", 10001, ["A", "B", "C"]);
  const shares = allocateEqualSplit(10001, ["A", "B", "C"]).map(s => s.amountCents);
  assert.deepEqual(shares, [3334, 3334, 3333]);
  assert.equal(outstandingDebt(l.debts, "B", "A") + outstandingDebt(l.debts, "C", "A"), 10001 - 3334);
  assert.equal(sum(Object.values(l.balances)), 0);
});

test("14. repeated partial payments aggregate correctly", () => {
  const l = ledger().expense("A", 30000, ["A", "B", "C"]);
  for (const cents of [1000, 2500, 1, 499]) l.pay("B", "A", cents);
  assert.equal(outstandingDebt(l.debts, "B", "A"), 10000 - 4000);
  l.pay("B", "A", 6000);
  assert.equal(outstandingDebt(l.debts, "B", "A"), 0);
  assert.equal(outstandingDebt(l.debts, "C", "A"), 10000);
});

test("15. payer's own split is excluded from person-to-person debt", () => {
  const l = ledger().manual("A", 100000, { A: 50000, B: 30000, C: 20000 });
  assert.deepEqual(l.debts, [
    { fromMemberId: "B", toMemberId: "A", amountCents: 30000 },
    { fromMemberId: "C", toMemberId: "A", amountCents: 20000 },
  ]);
  assert.ok(!l.debts.some(d => d.fromMemberId === d.toMemberId));
});

test("multiple expenses across payers aggregate on each directed pair", () => {
  const l = ledger().expense("A", 10000, ["A", "B"]).expense("A", 4000, ["A", "B"]).expense("B", 3000, ["A", "B"]);
  // B owes A 5000 + 2000, A owes B 1500 → net B owes A 5500.
  assert.deepEqual(l.debts, [{ fromMemberId: "B", toMemberId: "A", amountCents: 5500 }]);
});

test("after settlement, debtor payable and creditor receivable fall by the same amount", () => {
  const before = ledger().expense("A", 9000, ["A", "B", "C"]);
  const after = ledger().expense("A", 9000, ["A", "B", "C"]).pay("B", "A", 1200);
  const b0 = debtsForMember(before.debts, "B"), a0 = debtsForMember(before.debts, "A");
  const b1 = debtsForMember(after.debts, "B"), a1 = debtsForMember(after.debts, "A");
  assert.equal(b0.totalYouOweCents - b1.totalYouOweCents, 1200);
  assert.equal(a0.totalOwedToYouCents - a1.totalOwedToYouCents, 1200);
  assert.deepEqual(a1.owedToYou.map(d => [d.fromMemberId, d.amountCents]), [["C", 3000], ["B", 1800]]);
  assert.deepEqual(a1.youOwe, []);
});

test("member IDs containing separators cannot collide", () => {
  const l = ledger().expense("a|b", 1000, ["a|b", "c"]).expense("a", 1000, ["a", "b|c"]);
  assert.equal(outstandingDebt(l.debts, "c", "a|b"), 500);
  assert.equal(outstandingDebt(l.debts, "b|c", "a"), 500);
  assert.equal(l.debts.length, 2);
});

test("ledger rejects non-integer cents", () => {
  assert.throws(() => computePairwiseDebts({ splitEdges: [{ payerId: "A", memberId: "B", amountCents: 1.5 }] }), TypeError);
  assert.throws(() => computeBalances({ paidTotals: [{ memberId: "A", amountCents: "100" }] }), TypeError);
});

// Seeded PRNG so failures are reproducible.
function rng(seed) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32; }

for (let seed = 1; seed <= 200; seed++) {
  test(`property ${seed}: balances = receivables − payables, zero-sum, after random valid settlements`, () => {
    const rand = rng(seed), pick = arr => arr[Math.floor(rand() * arr.length)];
    const people = ["A", "B", "C", "D", "E"].slice(0, 2 + Math.floor(rand() * 4));
    const l = ledger();
    for (let i = 0; i < 1 + Math.floor(rand() * 8); i++) {
      const members = people.filter(() => rand() < 0.7);
      if (!members.length) members.push(pick(people));
      l.expense(pick(people), 1 + Math.floor(rand() * 500000), members);
    }
    for (let i = 0; i < Math.floor(rand() * 6); i++) {
      const debts = l.debts;
      if (!debts.length) break;
      const d = pick(debts);
      const cents = rand() < 0.3 ? d.amountCents : 1 + Math.floor(rand() * d.amountCents);
      validateSettlement({ debts, fromMemberId: d.fromMemberId, toMemberId: d.toMemberId, amountCents: cents, actorId: d.fromMemberId });
      l.pay(d.fromMemberId, d.toMemberId, cents);
      assert.equal(outstandingDebt(l.debts, d.fromMemberId, d.toMemberId), d.amountCents - cents);
    }
    const balances = l.balances, debts = l.debts;
    assert.equal(sum(Object.values(balances)), 0);
    for (const person of people) {
      const mine = debtsForMember(debts, person);
      assert.equal(balances[person] ?? 0, mine.totalOwedToYouCents - mine.totalYouOweCents, person);
    }
    for (const d of debts) {
      assert.ok(Number.isSafeInteger(d.amountCents) && d.amountCents > 0);
      assert.equal(outstandingDebt(debts, d.toMemberId, d.fromMemberId), 0, "only one direction survives netting");
    }
  });
}
