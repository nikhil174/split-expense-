import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup, ADMIN } from "./helpers/d1.js";

// Inserts an approved member entry for the admin's own name directly, the way
// older data looks (before the admin's name was reserved).
function legacyDuplicateOfAdmin(raw, groupId, name = ADMIN.name) {
  const rid = "legacy-" + Math.random().toString(36).slice(2);
  raw.prepare("INSERT INTO appx_access_requests(id,display_name,status,requested_at,approved_at,expires_at,group_id) VALUES(?,?,'approved',1,1,?,?)").run(rid, name, Date.now() + 3600000, groupId);
  raw.prepare("INSERT INTO appx_group_members(group_id,member_id,name) VALUES(?,?,?)").run(groupId, rid, name);
  return rid;
}
const balancesOf = async (env, gid, cookie) => Object.fromEntries((await call(env, `/api/groups/${gid}/balances`, { cookie })).data.balances.map(b => [b.memberId, b.balanceCents]));

test("/api/me reports the admin and member sessions for the app to restore", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  assert.deepEqual((await call(env, "/api/me")).data, { admin: null, member: null });
  const g = await setupGroup(env, "Trip", ["Bea"]);
  assert.deepEqual((await call(env, "/api/me", { cookie: g.adminCookie })).data, { admin: { id: "admin", name: ADMIN.name }, member: null });
  assert.deepEqual((await call(env, "/api/me", { cookie: g.cookies.Bea })).data, { admin: null, member: { id: g.ids.Bea, name: "Bea" } });
});

test("the admin's name is reserved: no separate member request or passwordless sign-in", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Trip", []);
  for (const name of [ADMIN.name, "  alex   ADMIN "]) {
    const r = await call(env, "/api/access/request", { method: "POST", body: { name, groupId: g.groupId, pin: "1234" } });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /Admin login/);
  }
  legacyDuplicateOfAdmin(raw, g.groupId);
  const signin = await call(env, "/api/access/signin", { method: "POST", body: { name: ADMIN.name, groupId: g.groupId, pin: "1234" } });
  assert.equal(signin.status, 403, "nobody can become the admin's member entry without the PIN");
});

test("an admin session acts as the admin member even if a member cookie is also present", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Trip", ["Bea"]);
  const both = g.adminCookie + "; " + g.cookies.Bea;
  const res = await call(env, `/api/groups/${g.groupId}/settlements/mine`, { cookie: both });
  assert.equal(res.data.memberId, "admin");
  assert.equal(res.data.isAdmin, true);
});

test("merging a duplicate member entry into the admin keeps every balance exact", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Chennai trip", ["Vicky", "Jagan"]);
  const dup = legacyDuplicateOfAdmin(raw, g.groupId);
  const G = `/api/groups/${g.groupId}`;
  const add = body => call(env, G + "/expenses", { method: "POST", cookie: g.adminCookie, body });
  const { ids } = g;
  // Expenses that involve both identities of the same person.
  assert.equal((await add({ description: "Biryani", amount: "750", paidBy: ids.Vicky, memberIds: [ids.Vicky, ids.Jagan, "admin", dup] })).status, 201);
  assert.equal((await add({ description: "Auto", amount: "400", paidBy: dup, memberIds: [dup, ids.Vicky] })).status, 201);
  assert.equal((await add({ description: "Fried rice", amount: "120", paidBy: "admin", memberIds: [dup, ids.Jagan] })).status, 201);
  // A "payment to myself" between the two entries and a real payment.
  raw.prepare("INSERT INTO appx_settlements(id,group_id,from_member_id,to_member_id,amount_cents,created_by,created_at) VALUES('self',?,?,'admin',3000,'admin',5)").run(g.groupId, dup);
  assert.equal((await call(env, G + "/settlements", { method: "POST", cookie: g.cookies.Vicky, body: { fromMemberId: ids.Vicky, toMemberId: dup, amount: "10" } })).status, 201);

  const before = await balancesOf(env, g.groupId, g.adminCookie);
  const preview = (await call(env, `/api/admin/requests/${dup}/merge-preview`, { cookie: g.adminCookie })).data;
  assert.deepEqual([preview.memberName, preview.expensesPaid, preview.shares, preview.payments, preview.paymentsWithAdmin, preview.groupName], [ADMIN.name, 1, 3, 2, 1, "Chennai trip"]);
  assert.equal(preview.memberBalanceCents, before[dup]);

  assert.equal((await call(env, `/api/admin/requests/${dup}/merge-into-admin`, { method: "POST", cookie: g.cookies.Vicky, body: {} })).status, 401, "members cannot merge");
  assert.equal((await call(env, `/api/admin/requests/${dup}/merge-into-admin`, { method: "POST", cookie: g.adminCookie, body: {} })).status, 200);

  const after = await balancesOf(env, g.groupId, g.adminCookie);
  assert.equal(after.admin, before.admin + before[dup], "admin balance is the sum of both entries");
  assert.equal(after[ids.Vicky], before[ids.Vicky]);
  assert.equal(after[ids.Jagan], before[ids.Jagan]);
  assert.ok(!(dup in after));
  assert.equal(Object.values(after).reduce((a, b) => a + b, 0), 0);

  // Biryani shares were combined into one admin row; Auto is now paid by the admin.
  const expenses = (await call(env, G + "/expenses", { cookie: g.adminCookie })).data.expenses;
  const biryani = expenses.find(e => e.description === "Biryani");
  assert.deepEqual(biryani.splits.filter(s => s.memberId === "admin").map(s => s.amountCents), [37500]);
  assert.equal(biryani.splits.reduce((s, x) => s + x.amountCents, 0), 75000);
  assert.equal(expenses.find(e => e.description === "Auto").paidBy, "admin");
  const history = (await call(env, G + "/settlements", { cookie: g.adminCookie })).data.settlements;
  assert.deepEqual(history.map(h => [h.fromMemberId, h.toMemberId, h.amountCents]), [[ids.Vicky, "admin", 1000]]);
  const members = (await call(env, G, { cookie: g.adminCookie })).data.members;
  assert.equal(members.filter(m => m.name === ADMIN.name).length, 1, "one person, one entry");
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM appx_access_requests WHERE id=?").get(dup).n, 0);
  // Debts recomputed from the merged ledger agree with balances.
  for (const who of ["admin", ids.Vicky, ids.Jagan]) {
    const cookie = who === "admin" ? g.adminCookie : g.cookies[Object.keys(ids).find(k => ids[k] === who)];
    const mine = (await call(env, G + "/settlements/mine", { cookie })).data;
    assert.equal(after[who], mine.totalOwedToYouCents - mine.totalYouOweCents, who);
  }
});

function rng(seed) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
for (let seed = 1; seed <= 15; seed++) {
  test(`property ${seed}: merge preserves zero-sum balances and everyone else's balance`, async t => {
    const { raw, env } = await makeEnv();
    t.after(() => raw.close());
    const g = await setupGroup(env, "Prop " + seed, ["P1", "P2"]);
    const dup = legacyDuplicateOfAdmin(raw, g.groupId);
    const people = ["admin", dup, g.ids.P1, g.ids.P2], rand = rng(seed), pick = a => a[Math.floor(rand() * a.length)];
    for (let i = 0; i < 6; i++) {
      const members = people.filter(() => rand() < 0.6);
      if (!members.length) members.push(pick(people));
      await call(env, `/api/groups/${g.groupId}/expenses`, { method: "POST", cookie: g.adminCookie, body: { description: "e" + i, amount: String(1 + Math.floor(rand() * 9999)), paidBy: pick(people), memberIds: members } });
    }
    const debts = (await call(env, `/api/groups/${g.groupId}/debts`, { cookie: g.adminCookie })).data.debts;
    for (const d of debts.slice(0, 3)) {
      await call(env, `/api/groups/${g.groupId}/settlements`, { method: "POST", cookie: g.adminCookie, body: { fromMemberId: d.fromMemberId, toMemberId: d.toMemberId, amount: (Math.max(1, Math.floor(d.amountCents / 2)) / 100).toFixed(2) } });
    }
    const before = await balancesOf(env, g.groupId, g.adminCookie);
    assert.equal((await call(env, `/api/admin/requests/${dup}/merge-into-admin`, { method: "POST", cookie: g.adminCookie, body: {} })).status, 200);
    const after = await balancesOf(env, g.groupId, g.adminCookie);
    assert.equal(after.admin, (before.admin || 0) + (before[dup] || 0));
    for (const p of [g.ids.P1, g.ids.P2]) assert.equal(after[p] || 0, before[p] || 0);
    assert.equal(Object.values(after).reduce((a, b) => a + b, 0), 0);
    const mismatched = raw.prepare("SELECT e.id FROM appx_expenses e LEFT JOIN appx_splits s ON s.expense_id=e.id GROUP BY e.id HAVING e.amount_cents<>COALESCE(SUM(s.amount_cents),0)").all();
    assert.deepEqual(mismatched, []);
  });
}
