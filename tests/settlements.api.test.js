import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup, payAndConfirm } from "./helpers/d1.js";

async function fixture(t, names = ["Bea", "Cy"]) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Goa Trip", names);
  const expense = (who, body) => call(env, `/api/groups/${g.groupId}/expenses`, { method: "POST", cookie: g.cookies[who], body });
  // Payments here are confirmed by the receiver straight away; the
  // confirmation flow itself is tested in confirmations.api.test.js.
  const pay = (who, fromMemberId, toMemberId, amount) => payAndConfirm(env, g.groupId, g, g.cookies[who], { fromMemberId, toMemberId, amount });
  const mine = async who => (await call(env, `/api/groups/${g.groupId}/settlements/mine`, { cookie: g.cookies[who] })).data;
  const balances = async who => (await call(env, `/api/groups/${g.groupId}/balances`, { cookie: g.cookies[who] })).data.balances;
  return { raw, env, ...g, expense, pay, mine, balances };
}
const sumCents = balances => balances.reduce((s, b) => s + b.balanceCents, 0);
const owe = (m, toName) => m.youOwe.find(d => d.toName === toName)?.amountCents ?? 0;
const owed = (m, fromName) => m.owedToYou.find(d => d.fromName === fromName)?.amountCents ?? 0;

test("API: A pays ₹100 split with B → B owes A ₹50; partial then full repayment", async t => {
  const f = await fixture(t);
  const { ids } = f;
  assert.equal((await f.expense("Bea", { description: "Lunch", amount: "100", paidBy: ids.admin, splitMode: "equal", memberIds: [ids.admin, ids.Bea] })).status, 201);

  let bea = await f.mine("Bea");
  assert.equal(bea.model, "direct-expense-attribution");
  assert.equal(owe(bea, "Alex Admin"), 5000);
  assert.equal(bea.youOwe[0].canRecord, true);
  const admin = await f.mine("admin");
  assert.equal(owed(admin, "Bea"), 5000);
  assert.equal(admin.owedToYou[0].canRecord, true, "admin may record on behalf");

  // Payee cannot record "payment received" from the debtor's account.
  const cy = await f.mine("Cy");
  assert.deepEqual([cy.youOwe, cy.owedToYou], [[], []]);

  assert.equal((await f.pay("Bea", ids.Bea, ids.admin, "20")).status, 201);
  bea = await f.mine("Bea");
  assert.equal(owe(bea, "Alex Admin"), 3000);
  assert.equal(sumCents(await f.balances("Bea")), 0);

  assert.equal((await f.pay("Bea", ids.Bea, ids.admin, "30.00")).status, 201);
  bea = await f.mine("Bea");
  assert.deepEqual(bea.youOwe, []);
  assert.deepEqual((await f.balances("Bea")).map(b => b.balanceCents), [0, 0, 0]);

  const history = (await call(f.env, `/api/groups/${f.groupId}/settlements`, { cookie: f.cookies.Cy })).data.settlements;
  assert.deepEqual(history.map(h => [h.fromName, h.toName, h.amountCents, h.recordedByName]).sort(), [["Bea", "Alex Admin", 2000, "Bea"], ["Bea", "Alex Admin", 3000, "Bea"]]);
  assert.ok(history.every(h => Number.isInteger(h.createdAt)));
});

test("API: payer split only among B and C; payer's own share is never a debt", async t => {
  const f = await fixture(t);
  const { ids } = f;
  await f.expense("Bea", { description: "Cab", amount: 100, paidBy: ids.admin, memberIds: [ids.Bea, ids.Cy] });
  await f.expense("Bea", { description: "Snacks", amount: "1000", paidBy: ids.Bea, splitMode: "manual", allocations: [{ memberId: ids.Bea, amount: "500" }, { memberId: ids.Cy, amount: "300" }, { memberId: ids.admin, amount: "200" }] });
  const bea = await f.mine("Bea");
  // Bea owes admin 50, admin owes Bea 200 → admin owes Bea 150.
  assert.equal(owe(bea, "Alex Admin"), 0);
  assert.equal(owed(bea, "Alex Admin"), 15000);
  assert.equal(owed(bea, "Cy"), 30000);
  assert.equal(owe(await f.mine("Cy"), "Alex Admin"), 5000);
  const all = (await call(f.env, `/api/groups/${f.groupId}/debts`, { cookie: f.cookies.Cy })).data.debts;
  assert.ok(all.every(d => d.fromMemberId !== d.toMemberId));
  assert.equal(all.length, 3);
  // Cy sees the whole group but may only record their own outgoing payments.
  assert.deepEqual(all.filter(d => d.canRecord).map(d => [d.fromName, d.toName]).sort(), [["Cy", "Alex Admin"], ["Cy", "Bea"]]);
  const balances = await f.balances("Cy");
  assert.equal(sumCents(balances), 0);
  for (const b of balances) {
    const m = (await f.mine(Object.keys(ids).find(k => ids[k] === b.memberId)));
    assert.equal(b.balanceCents, m.totalOwedToYouCents - m.totalYouOweCents, b.name);
  }
});

test("API: opposite-direction debts net (A owes B ₹60, B owes A ₹40 → A owes B ₹20)", async t => {
  const f = await fixture(t);
  const { ids } = f;
  await f.expense("Bea", { description: "x", amount: "60", paidBy: ids.Bea, splitMode: "manual", allocations: [{ memberId: ids.Cy, amount: "60" }] });
  await f.expense("Cy", { description: "y", amount: "40", paidBy: ids.Cy, splitMode: "manual", allocations: [{ memberId: ids.Bea, amount: "40" }] });
  const cy = await f.mine("Cy");
  assert.deepEqual(cy.youOwe.map(d => [d.toName, d.amountCents]), [["Bea", 2000]]);
  assert.deepEqual(cy.owedToYou, []);
  // Cy cannot pay the gross ₹60, only the netted ₹20.
  assert.equal((await f.pay("Cy", ids.Cy, ids.Bea, "20.01")).status, 409);
  assert.equal((await f.pay("Cy", ids.Cy, ids.Bea, "20")).status, 201);
  assert.deepEqual((await f.mine("Cy")).youOwe, []);
});

test("API: rejects overpayment, self-payment, impersonation, bad amounts and no-debt payments", async t => {
  const f = await fixture(t);
  const { ids } = f;
  await f.expense("Bea", { description: "Dinner", amount: "90", paidBy: ids.Bea, memberIds: [ids.admin, ids.Bea, ids.Cy] });
  assert.equal((await f.pay("Cy", ids.Cy, ids.Bea, "30.01")).status, 409, "overpayment");
  assert.equal((await f.pay("Cy", ids.Cy, ids.Cy, "1")).status, 400, "self-payment");
  assert.equal((await f.pay("Bea", ids.Cy, ids.Bea, "1")).status, 403, "recording someone else's payment");
  assert.equal((await f.pay("Bea", ids.Bea, ids.Cy, "1")).status, 409, "no debt in that direction");
  for (const amount of ["0", "-5", "1.005", "abc", "1e2", true, null, [1]]) {
    assert.equal((await f.pay("Cy", ids.Cy, ids.Bea, amount)).status, 400, "amount " + JSON.stringify(amount));
  }
  assert.equal((await f.pay("Cy", ids.Cy, "", "1")).status, 400);
  assert.equal((await f.pay("Cy", ids.Cy, "not-a-member", "1")).status, 400);
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM appx_settlements").get().n, 0);
  // The admin may record a payment on a member's behalf.
  assert.equal((await f.pay("admin", ids.Cy, ids.Bea, "30")).status, 201);
  assert.deepEqual((await f.mine("Cy")).youOwe, []);
});

test("API: repeated partial payments aggregate; concurrent payments cannot overpay", async t => {
  const f = await fixture(t);
  const { ids } = f;
  await f.expense("Bea", { description: "Hotel", amount: "100.01", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy, ids.admin] });
  // 10001 / 3 → 3334, 3334, 3333 in the order given: Bea, Cy, admin.
  assert.equal(owe(await f.mine("Cy"), "Bea"), 3334);
  assert.equal(owe(await f.mine("admin"), "Bea"), 3333);
  for (const amount of ["10", "0.01", "3.33"]) assert.equal((await f.pay("Cy", ids.Cy, ids.Bea, amount)).status, 201);
  assert.equal(owe(await f.mine("Cy"), "Bea"), 3334 - 1334);
  const results = await Promise.all([f.pay("Cy", ids.Cy, ids.Bea, "15"), f.pay("Cy", ids.Cy, ids.Bea, "15")]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(owe(await f.mine("Cy"), "Bea"), 500);
  assert.equal(sumCents(await f.balances("Cy")), 0);
});

test("API: cross-group payments, history and debts are isolated", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const a = await setupGroup(env, "Group A", ["Bea", "Cy"]);
  const b = await setupGroup(env, "Group B", ["Dee"], { adminCookie: a.adminCookie });
  await call(env, `/api/groups/${a.groupId}/expenses`, { method: "POST", cookie: a.cookies.Bea, body: { description: "A", amount: "50", paidBy: a.ids.Bea, memberIds: [a.ids.Bea, a.ids.Cy] } });
  await call(env, `/api/groups/${b.groupId}/expenses`, { method: "POST", cookie: b.cookies.Dee, body: { description: "B", amount: "80", paidBy: b.ids.Dee, memberIds: [b.ids.Dee, "admin"] } });

  // Member of group A cannot read or write group B at all.
  for (const tail of ["", "/balances", "/settlements", "/settlements/mine", "/debts", "/expenses", "/dashboard"]) {
    assert.equal((await call(env, `/api/groups/${b.groupId}${tail}`, { cookie: a.cookies.Cy })).status, 404, tail);
  }
  assert.equal((await call(env, `/api/groups/${b.groupId}/settlements`, { method: "POST", cookie: a.cookies.Cy, body: { fromMemberId: a.ids.Cy, toMemberId: b.ids.Dee, amount: "1" } })).status, 404);
  // A group-B member id is not a valid counterparty inside group A, even for the admin.
  assert.equal((await call(env, `/api/groups/${a.groupId}/settlements`, { method: "POST", cookie: a.adminCookie, body: { fromMemberId: b.ids.Dee, toMemberId: a.ids.Bea, amount: "1" } })).status, 400);
  // Admin's group-B debt is not visible or payable in group A.
  assert.equal(owe(await (await call(env, `/api/groups/${a.groupId}/settlements/mine`, { cookie: a.adminCookie })).data, "Dee"), 0);
  assert.equal((await call(env, `/api/groups/${a.groupId}/settlements`, { method: "POST", cookie: a.adminCookie, body: { fromMemberId: "admin", toMemberId: b.ids.Dee, amount: "1" } })).status, 400);
  assert.equal((await call(env, `/api/groups/${b.groupId}/settlements`, { method: "POST", cookie: a.adminCookie, body: { fromMemberId: "admin", toMemberId: b.ids.Dee, amount: "40" } })).status, 201);
  assert.equal((await call(env, `/api/groups/${a.groupId}/settlements`, { method: "POST", cookie: a.cookies.Cy, body: { fromMemberId: a.ids.Cy, toMemberId: a.ids.Bea, amount: "25" } })).status, 201);

  const histA = (await call(env, `/api/groups/${a.groupId}/settlements`, { cookie: a.adminCookie })).data.settlements;
  const histB = (await call(env, `/api/groups/${b.groupId}/settlements`, { cookie: a.adminCookie })).data.settlements;
  assert.deepEqual(histA.map(h => [h.fromName, h.toName, h.amountCents]), [["Cy", "Bea", 2500]]);
  assert.deepEqual(histB.map(h => [h.fromName, h.toName, h.amountCents]), [["Alex Admin", "Dee", 4000]]);
});

test("API: removed members keep history, cannot be chosen by members, and the admin can still settle with them", async t => {
  const f = await fixture(t);
  const { ids } = f;
  await f.expense("Cy", { description: "Tickets", amount: "60", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy] });
  await f.expense("Cy", { description: "Fuel", amount: "40", paidBy: ids.Cy, memberIds: [ids.Bea, ids.Cy, ids.admin] });
  assert.equal((await call(f.env, `/api/admin/requests/${ids.Bea}/remove`, { method: "POST", cookie: f.adminCookie, body: {} })).status, 200);

  // Bea's session is gone; she no longer appears as a selectable member.
  assert.equal((await call(f.env, `/api/groups/${f.groupId}`, { cookie: f.cookies.Bea })).status, 401);
  const group = (await call(f.env, `/api/groups/${f.groupId}`, { cookie: f.cookies.Cy })).data;
  assert.deepEqual(group.members.map(m => m.name).sort(), ["Alex Admin", "Cy"]);
  assert.equal((await f.expense("Cy", { description: "New", amount: "10", paidBy: ids.Bea, memberIds: [ids.Cy] })).status, 400);
  assert.equal((await f.expense("Cy", { description: "New", amount: "10", paidBy: ids.Cy, memberIds: [ids.Bea, ids.Cy] })).status, 400);

  // History still names her and balances still sum to zero.
  const expenses = (await call(f.env, `/api/groups/${f.groupId}/expenses`, { cookie: f.cookies.Cy })).data.expenses;
  assert.deepEqual(expenses.map(e => e.paidByName).sort(), ["Bea", "Cy"]);
  const balances = await f.balances("Cy");
  assert.equal(sumCents(balances), 0);
  assert.ok(balances.some(b => b.name === "Bea"));

  // Cy owes Bea 30 − 13.34 = 16.66 but cannot record paying a removed member…
  const cy = await f.mine("Cy");
  assert.equal(owe(cy, "Bea"), 1666);
  assert.equal(cy.youOwe[0].canRecord, false);
  assert.equal(cy.youOwe[0].counterpartyActive, false);
  assert.equal((await f.pay("Cy", ids.Cy, ids.Bea, "16.66")).status, 409);
  // …the admin can, so the debt is not stuck forever.
  assert.equal((await f.pay("admin", ids.Cy, ids.Bea, "16.66")).status, 201);

  // Deleting the revoked access record still keeps the historical name.
  assert.equal((await call(f.env, `/api/admin/requests/${ids.Bea}/delete`, { method: "POST", cookie: f.adminCookie, body: {} })).status, 200);
  const after = (await call(f.env, `/api/groups/${f.groupId}/settlements`, { cookie: f.cookies.Cy })).data.settlements;
  assert.deepEqual(after.map(h => [h.fromName, h.toName]), [["Cy", "Bea"]]);
  assert.equal(sumCents(await f.balances("Cy")), 0);
});

test("API: deleting a group with settlements and access requests succeeds (foreign keys on)", async t => {
  const f = await fixture(t);
  const { ids } = f;
  await f.expense("Bea", { description: "Lunch", amount: "100", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy] });
  await f.pay("Cy", ids.Cy, ids.Bea, "10");
  assert.equal(f.raw.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  const deleted = await call(f.env, `/api/admin/groups/${f.groupId}/delete`, { method: "POST", cookie: f.adminCookie, body: {} });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
  for (const table of ["appx_groups", "appx_expenses", "appx_splits", "appx_settlements", "appx_access_requests", "appx_sessions"]) {
    assert.equal(f.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
});
