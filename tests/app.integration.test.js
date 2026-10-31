import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./helpers/d1.js";

test("group creation and repeated expense split changes work end-to-end", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());

  // Anyone creates an account, then a group (they are its admin).
  const alex = await call(env, "/api/auth/signup", { method: "POST", body: { name: "Alex Admin", username: "alex", password: "alexpass1" } });
  assert.equal(alex.status, 201);
  const adminCookie = alex.cookie;
  assert.ok(adminCookie?.startsWith("split_user="));
  const ADMIN_ID = alex.data.id;

  const created = await call(env, "/api/groups", {
    method: "POST", cookie: adminCookie, body: { name: "Chennai Trip", pin: "2580" },
  });
  assert.equal(created.status, 201);
  const groupId = created.data.group.id;
  // Plain objects keyed by member so the assertion does not depend on UUID order.
  const splitsOf = expenseId => Object.fromEntries(
    raw.prepare("SELECT member_id, amount_cents FROM appx_splits WHERE expense_id=?").all(expenseId)
      .map(row => [row.member_id, row.amount_cents]));
  assert.equal(created.data.group.name, "Chennai Trip");

  // Sam has an account; the admin invites them by username and Sam accepts.
  const sam = await call(env, "/api/auth/signup", { method: "POST", body: { name: "Sam Member", username: "sam", password: "sampass13" } });
  assert.equal(sam.status, 201);
  const requested = { data: { requestId: sam.data.id } };
  assert.equal((await call(env, `/api/groups/${groupId}/members/invite`, { method: "POST", cookie: adminCookie, body: { login: "@Sam" } })).status, 200);
  assert.equal((await call(env, `/api/groups/${groupId}/expenses`, { cookie: sam.cookie })).status, 404, "not in the group until they accept");
  assert.equal((await call(env, `/api/groups/${groupId}/invitation/accept`, { method: "POST", cookie: sam.cookie, body: {} })).status, 400, "joining needs the group PIN");
  assert.equal((await call(env, `/api/groups/${groupId}/invitation/accept`, { method: "POST", cookie: sam.cookie, body: { pin: "2580" } })).status, 200);

  const memberLogin = await call(env, "/api/auth/signin", {
    method: "POST", body: { login: "sam", password: "sampass13" },
  });
  assert.equal(memberLogin.status, 200);
  const memberCookie = memberLogin.cookie;
  assert.ok(memberCookie?.startsWith("split_user="));
  // A new sign-in opens the group with its PIN again.
  assert.equal((await call(env, "/api/groups/" + groupId + "/expenses", { cookie: memberCookie })).status, 423);
  assert.equal((await call(env, "/api/groups/" + groupId + "/unlock", { method: "POST", cookie: memberCookie, body: { pin: "2580" } })).status, 200);

  // First split: ₹100 shared equally by admin and Sam.
  const first = await call(env, "/api/groups/" + groupId + "/expenses", {
    method: "POST", cookie: memberCookie,
    body: { description: "Lunch", amount: 100, paidBy: ADMIN_ID, memberIds: [ADMIN_ID, requested.data.requestId] },
  });
  assert.equal(first.status, 201);
  assert.deepEqual(splitsOf(first.data.id), { [ADMIN_ID]: 5000, [requested.data.requestId]: 5000 });

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
    body: { description: "Dinner", amount: 101, paidBy: ADMIN_ID, memberIds: [ADMIN_ID, requested.data.requestId] },
  });
  assert.equal(third.status, 201);
  assert.deepEqual(splitsOf(third.data.id), { [ADMIN_ID]: 5050, [requested.data.requestId]: 5050 });

  const expenses = await call(env, "/api/groups/" + groupId + "/expenses", { cookie: memberCookie });
  assert.equal(expenses.status, 200);
  assert.equal(expenses.data.expenses.length, 3);
  const balances = await call(env, "/api/groups/" + groupId + "/balances", { cookie: memberCookie });
  assert.equal(balances.status, 200);
  assert.equal(balances.data.balances.length, 2);
});
