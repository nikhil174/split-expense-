import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./helpers/d1.js";

test("group creation and repeated expense split changes work end-to-end", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());

  // Admin signs in with both name and PIN, then creates a group.
  const adminLogin = await call(env, "/api/admin/login", {
    method: "POST", body: { name: "Alex Admin", pin: "test-pin-4821" },
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.cookie;
  assert.ok(adminCookie?.startsWith("split_admin="));

  const created = await call(env, "/api/admin/groups", {
    method: "POST", cookie: adminCookie, body: { name: "Chennai Trip" },
  });
  assert.equal(created.status, 201);
  const groupId = created.data.group.id;
  // Plain objects keyed by member so the assertion does not depend on UUID order.
  const splitsOf = expenseId => Object.fromEntries(
    raw.prepare("SELECT member_id, amount_cents FROM appx_splits WHERE expense_id=?").all(expenseId)
      .map(row => [row.member_id, row.amount_cents]));
  assert.equal(created.data.group.name, "Chennai Trip");

  // A second member requests access; the admin approves them.
  const requested = await call(env, "/api/access/request", {
    method: "POST", body: { name: "Sam Member", groupId },
  });
  assert.equal(requested.status, 201);
  const approved = await call(env, "/api/admin/requests/" + requested.data.requestId + "/approve", {
    method: "POST", cookie: adminCookie, body: {},
  });
  assert.equal(approved.status, 200);

  const memberLogin = await call(env, "/api/access/signin", {
    method: "POST", body: { name: "Sam Member", groupId },
  });
  assert.equal(memberLogin.status, 200);
  const memberCookie = memberLogin.cookie;
  assert.ok(memberCookie?.startsWith("split_session="));

  // First split: ₹100 shared equally by admin and Sam.
  const first = await call(env, "/api/groups/" + groupId + "/expenses", {
    method: "POST", cookie: memberCookie,
    body: { description: "Lunch", amount: 100, paidBy: "admin", memberIds: ["admin", requested.data.requestId] },
  });
  assert.equal(first.status, 201);
  assert.deepEqual(splitsOf(first.data.id), { admin: 5000, [requested.data.requestId]: 5000 });

  // Change the split on the next expense: only Sam is included.
  const second = await call(env, "/api/groups/" + groupId + "/expenses", {
    method: "POST", cookie: memberCookie,
    body: { description: "Taxi", amount: 90, paidBy: requested.data.requestId, memberIds: [requested.data.requestId] },
  });
  assert.equal(second.status, 201);
  assert.deepEqual(splitsOf(second.data.id), { [requested.data.requestId]: 9000 });

  // Switch back to both members and verify the exact split is recalculated.
  const third = await call(env, "/api/groups/" + groupId + "/expenses", {
    method: "POST", cookie: memberCookie,
    body: { description: "Dinner", amount: 101, paidBy: "admin", memberIds: ["admin", requested.data.requestId] },
  });
  assert.equal(third.status, 201);
  assert.deepEqual(splitsOf(third.data.id), { admin: 5050, [requested.data.requestId]: 5050 });

  const expenses = await call(env, "/api/groups/" + groupId + "/expenses", { cookie: memberCookie });
  assert.equal(expenses.status, 200);
  assert.equal(expenses.data.expenses.length, 3);
  const balances = await call(env, "/api/groups/" + groupId + "/balances", { cookie: memberCookie });
  assert.equal(balances.status, 200);
  assert.equal(balances.data.balances.length, 2);
});
