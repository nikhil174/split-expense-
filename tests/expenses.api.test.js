import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup } from "./helpers/d1.js";

async function fixture(t) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Flat 4B", ["Nikhil", "Vicky", "Jagan"]);
  const add = body => call(env, `/api/groups/${g.groupId}/expenses`, { method: "POST", cookie: g.cookies.Nikhil, body });
  const splitsOf = expenseId => Object.fromEntries(raw.prepare("SELECT member_id, amount_cents FROM appx_splits WHERE expense_id=?").all(expenseId).map(r => [r.member_id, r.amount_cents]));
  return { raw, env, ...g, add, splitsOf };
}

test("manual split ₹1,000 as ₹500/₹300/₹200 is stored exactly, matching the UI payload", async t => {
  const f = await fixture(t);
  const { ids } = f;
  const res = await f.add({ description: "Rent share", amount: "1000", paidBy: ids.Nikhil, splitMode: "manual",
    allocations: [{ memberId: ids.Nikhil, amount: "500" }, { memberId: ids.Vicky, amount: "300.00" }, { memberId: ids.Jagan, amount: "200" }] });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const row = f.raw.prepare("SELECT amount_cents, typeof(amount_cents) AS t FROM appx_expenses WHERE id=?").get(res.data.id);
  assert.deepEqual({ ...row }, { amount_cents: 100000, t: "integer" });
  assert.deepEqual(f.splitsOf(res.data.id), { [ids.Nikhil]: 50000, [ids.Vicky]: 30000, [ids.Jagan]: 20000 });
});

test("manual split rejects mismatched, fractional, duplicate, outsider, negative, empty and all-zero allocations", async t => {
  const f = await fixture(t);
  const { ids } = f;
  const manual = (amount, allocations) => f.add({ description: "Bad", amount, paidBy: ids.Nikhil, splitMode: "manual", allocations });
  const cases = [
    ["10", [{ memberId: ids.Nikhil, amount: "5.00" }, { memberId: ids.Vicky, amount: "4.99" }], /add up exactly/],
    ["10", [{ memberId: ids.Nikhil, amount: "5.00" }, { memberId: ids.Vicky, amount: "5.01" }], /add up exactly/],
    ["10", [{ memberId: ids.Nikhil, amount: "5.005" }, { memberId: ids.Vicky, amount: "4.995" }], /two decimal places/],
    ["10", [{ memberId: ids.Nikhil, amount: "5" }, { memberId: ids.Nikhil, amount: "5" }], /unique members/],
    ["10", [{ memberId: ids.Nikhil, amount: "5" }, { memberId: "outsider", amount: "5" }], /unique members/],
    ["10", [{ memberId: ids.Nikhil, amount: "15" }, { memberId: ids.Vicky, amount: "-5" }], /two decimal places/],
    ["10", [{ memberId: ids.Nikhil, amount: "abc" }, { memberId: ids.Vicky, amount: "10" }], /two decimal places/],
    ["10", [{ memberId: ids.Nikhil, amount: "" }, { memberId: ids.Vicky, amount: "10" }], /two decimal places/],
    ["10", [{ memberId: ids.Nikhil, amount: null }, { memberId: ids.Vicky, amount: "10" }], /valid amount/],
    ["10", [], /at least one manual amount/i],
    ["10", [{ memberId: ids.Nikhil, amount: "0" }, { memberId: ids.Vicky, amount: "0" }], /greater than zero/],
    ["10", "not-an-array", /at least one manual amount/i],
    ["10", [{ memberId: { id: ids.Nikhil }, amount: "10" }], /unique members/],
  ];
  for (const [amount, allocations, pattern] of cases) {
    const res = await manual(amount, allocations);
    assert.equal(res.status, 400, JSON.stringify(allocations));
    assert.match(res.data.error, pattern, JSON.stringify(allocations));
  }
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM appx_expenses").get().n, 0);
});

test("zero manual rows are accepted but not stored as splits", async t => {
  const f = await fixture(t);
  const { ids } = f;
  const res = await f.add({ description: "Tea", amount: "10", paidBy: ids.Vicky, splitMode: "manual", allocations: [{ memberId: ids.Nikhil, amount: "10" }, { memberId: ids.Jagan, amount: "0" }] });
  assert.equal(res.status, 201);
  assert.deepEqual(f.splitsOf(res.data.id), { [ids.Nikhil]: 1000 });
});

test("expense amount is validated strictly server-side", async t => {
  const f = await fixture(t);
  const { ids } = f;
  for (const amount of ["0", 0, "-1", "10.005", 10.005, "1e3", "0x10", true, [5], null, "", "₹10", "100000000.01"]) {
    const res = await f.add({ description: "x", amount, paidBy: ids.Nikhil, memberIds: [ids.Nikhil] });
    assert.equal(res.status, 400, JSON.stringify(amount));
  }
  for (const [amount, cents] of [[0.29, 29], ["0.29", 29], [19.99, 1999], ["100000000", 10000000000]]) {
    const res = await f.add({ description: "ok", amount, paidBy: ids.Nikhil, memberIds: [ids.Nikhil, ids.Vicky] });
    assert.equal(res.status, 201, JSON.stringify(amount));
    assert.equal(f.raw.prepare("SELECT amount_cents FROM appx_expenses WHERE id=?").get(res.data.id).amount_cents, cents);
  }
});

test("equal split preserves every paise, deduplicates members and differs by at most one paise", async t => {
  const f = await fixture(t);
  const { ids } = f;
  const res = await f.add({ description: "Dinner", amount: "100.01", paidBy: ids.Jagan, splitMode: "equal", memberIds: [ids.Nikhil, ids.Vicky, ids.Jagan, ids.Vicky] });
  assert.equal(res.status, 201);
  const shares = Object.values(f.splitsOf(res.data.id));
  assert.equal(shares.length, 3);
  assert.equal(shares.reduce((a, b) => a + b, 0), 10001);
  assert.ok(Math.max(...shares) - Math.min(...shares) <= 1);
  // 1 paise among three people stores one 1-paise split, not two zero rows.
  const tiny = await f.add({ description: "Mint", amount: "0.01", paidBy: ids.Jagan, memberIds: [ids.Nikhil, ids.Vicky, ids.Jagan] });
  assert.deepEqual(Object.values(f.splitsOf(tiny.data.id)), [1]);
});

test("equal split rejects empty, non-string, outsider and cross-group members and unknown modes", async t => {
  const f = await fixture(t);
  const { ids } = f;
  const other = await setupGroup(f.env, "Other", ["Zed"], { adminCookie: f.adminCookie });
  for (const body of [
    { memberIds: [] }, { memberIds: "x" }, { memberIds: [123] }, { memberIds: [ids.Nikhil, "outsider"] },
    { memberIds: [other.ids.Zed] }, { memberIds: [ids.Nikhil], splitMode: "percent" },
    { memberIds: [ids.Nikhil], paidBy: other.ids.Zed }, { memberIds: [ids.Nikhil], paidBy: "" },
  ]) {
    const res = await f.add({ description: "x", amount: "10", paidBy: ids.Nikhil, ...body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  for (const description of ["", "   ", "x".repeat(161)]) {
    assert.equal((await f.add({ description, amount: "10", paidBy: ids.Nikhil, memberIds: [ids.Nikhil] })).status, 400);
  }
});

test("every stored expense's splits sum exactly to its total", async t => {
  const f = await fixture(t);
  const { ids } = f;
  const people = [ids.Nikhil, ids.Vicky, ids.Jagan, ids.admin];
  for (let i = 1; i <= 40; i++) {
    const members = people.filter((_, j) => (i >> j) & 1);
    if (!members.length) continue;
    const amount = (i * 137.37 % 9999).toFixed(2);
    assert.equal((await f.add({ description: "e" + i, amount, paidBy: people[i % 4], memberIds: members })).status, 201);
  }
  const mismatched = f.raw.prepare("SELECT e.id FROM appx_expenses e LEFT JOIN appx_splits s ON s.expense_id=e.id GROUP BY e.id HAVING e.amount_cents<>COALESCE(SUM(s.amount_cents),0)").all();
  assert.deepEqual(mismatched, []);
  const balances = (await call(f.env, `/api/groups/${f.groupId}/balances`, { cookie: f.cookies.Vicky })).data.balances;
  assert.equal(balances.reduce((s, b) => s + b.balanceCents, 0), 0);
});
