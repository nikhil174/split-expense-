import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup } from "./helpers/d1.js";
import { computePairwiseDebts, outstandingDebt, pairwiseActivity } from "../src/settlement-logic.js";
import { allocateEqualSplit } from "../src/split-logic.js";

async function fixture(t) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Goa Trip", ["Bea", "Cy"]);
  const G = `/api/groups/${g.groupId}`;
  const add = (who, body) => call(env, G + "/expenses", { method: "POST", cookie: g.cookies[who], body });
  const pay = (who, fromMemberId, toMemberId, amount) => call(env, G + "/settlements", { method: "POST", cookie: g.cookies[who], body: { fromMemberId, toMemberId, amount } });
  const get = (who, tail) => call(env, G + tail, { cookie: g.cookies[who] });
  return { raw, env, G, ...g, add, pay, get };
}

test("expense list shows splits and the viewer's lent/borrowed position", async t => {
  const f = await fixture(t);
  const { ids } = f;
  await f.add("Bea", { description: "Dinner", amount: "90", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy, ids.admin] });
  await f.add("Cy", { description: "Cab", amount: "40", paidBy: ids.Cy, splitMode: "manual", allocations: [{ memberId: ids.Cy, amount: "10" }, { memberId: ids.admin, amount: "30" }] });
  const bea = (await f.get("Bea", "/expenses")).data.expenses;
  const dinner = bea.find(e => e.description === "Dinner"), cab = bea.find(e => e.description === "Cab");
  assert.deepEqual([dinner.myShareCents, dinner.myEffectCents, dinner.paidByName, dinner.canDelete], [3000, 6000, "Bea", true]);
  assert.deepEqual(dinner.splits.map(s => [s.name, s.amountCents]).sort(), [["Alex Admin", 3000], ["Bea", 3000], ["Cy", 3000]]);
  assert.deepEqual([cab.myShareCents, cab.myEffectCents, cab.canDelete], [0, 0, false]);
  const admin = (await f.get("admin", "/expenses")).data.expenses.find(e => e.description === "Cab");
  assert.deepEqual([admin.myShareCents, admin.myEffectCents, admin.canDelete], [3000, -3000, true]);
});

test("person drill-down lists only shared items and its total matches the debt", async t => {
  const f = await fixture(t);
  const { ids } = f;
  await f.add("Bea", { description: "Dinner", amount: "90", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy, ids.admin] });
  await f.add("Cy", { description: "Cab", amount: "40", paidBy: ids.Cy, memberIds: [ids.Cy, ids.Bea] });
  await f.add("Cy", { description: "Not shared with Bea", amount: "50", paidBy: ids.Cy, memberIds: [ids.Cy, ids.admin] });
  assert.equal((await f.pay("Cy", ids.Cy, ids.Bea, "5")).status, 201);
  // Pin timestamps so ordering does not depend on same-millisecond inserts.
  for (const [d, at] of [["Dinner", 1000], ["Cab", 2000], ["Not shared with Bea", 2500]]) f.raw.prepare("UPDATE appx_expenses SET created_at=? WHERE description=?").run(at, d);
  f.raw.prepare("UPDATE appx_settlements SET created_at=3000").run();
  const view = (await f.get("Bea", "/with/" + ids.Cy)).data;
  // Cy owes Bea 30 for dinner, Bea owes Cy 20 for the cab, Cy paid 5 → Cy owes Bea 5.
  assert.equal(view.netCents, 500);
  assert.deepEqual(view.items.map(i => [i.type, i.description ?? null, i.effectCents, i.runningCents]).reverse(),
    [["expense", "Dinner", 3000, 3000], ["expense", "Cab", -2000, 1000], ["payment", null, -500, 500]]);
  const mine = (await f.get("Bea", "/settlements/mine")).data;
  assert.equal(mine.owedToYou.find(d => d.fromMemberId === ids.Cy).amountCents, view.netCents);
  const reverse = (await f.get("Cy", "/with/" + ids.Bea)).data;
  assert.equal(reverse.netCents, -500);
  assert.equal((await f.get("Bea", "/with/" + ids.Bea)).status, 404);
  assert.equal((await f.get("Bea", "/with/someone-else")).status, 404);
});

test("drill-down is scoped to the group and requires membership", async t => {
  const f = await fixture(t);
  const other = await setupGroup(f.env, "Other group", ["Zed"], { adminCookie: f.adminCookie });
  assert.equal((await call(f.env, `/api/groups/${other.groupId}/with/${other.ids.Zed}`, { cookie: f.cookies.Bea })).status, 404);
  assert.equal((await f.get("Bea", "/with/" + other.ids.Zed)).status, 404);
  assert.equal((await call(f.env, f.G + "/with/" + f.ids.Cy)).status, 401);
});

test("group list shows my net balance per group", async t => {
  const f = await fixture(t);
  const { ids } = f;
  await f.add("Bea", { description: "Dinner", amount: "100", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy] });
  await f.pay("Cy", ids.Cy, ids.Bea, "20");
  const list = async who => (await call(f.env, "/api/groups", { cookie: f.cookies[who] })).data.groups[0].myBalanceCents;
  assert.deepEqual([await list("Bea"), await list("Cy"), await list("admin")], [3000, -3000, 0]);
});

test("only the creator or admin can delete an expense; balances update", async t => {
  const f = await fixture(t);
  const { ids } = f;
  const e = await f.add("Bea", { description: "Dinner", amount: "100", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy] });
  assert.equal((await call(f.env, `${f.G}/expenses/${e.data.id}/delete`, { method: "POST", cookie: f.cookies.Cy, body: {} })).status, 403);
  const other = await setupGroup(f.env, "Other group", ["Zed"], { adminCookie: f.adminCookie });
  assert.equal((await call(f.env, `/api/groups/${other.groupId}/expenses/${e.data.id}/delete`, { method: "POST", cookie: f.adminCookie, body: {} })).status, 404, "cannot delete via another group");
  assert.equal((await call(f.env, `${f.G}/expenses/${e.data.id}/delete`, { method: "POST", cookie: f.cookies.Bea, body: {} })).status, 200);
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM appx_splits").get().n, 0);
  assert.deepEqual((await f.get("Cy", "/settlements/mine")).data.youOwe, []);
});

function rng(seed) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
for (let seed = 1; seed <= 100; seed++) {
  test(`property ${seed}: drill-down net equals the netted pairwise debt`, () => {
    const rand = rng(seed), people = ["A", "B", "C", "D"], pick = a => a[Math.floor(rand() * a.length)];
    const shares = [], settlements = [];
    for (let i = 0; i < 1 + Math.floor(rand() * 8); i++) {
      const paidBy = pick(people), members = people.filter(() => rand() < 0.6);
      if (!members.length) members.push(pick(people));
      const total = 1 + Math.floor(rand() * 100000);
      for (const s of allocateEqualSplit(total, members)) shares.push({ expenseId: "e" + i, description: "e" + i, paidBy, memberId: s.memberId, amountCents: s.amountCents, totalCents: total, createdAt: i });
    }
    for (let i = 0; i < 4; i++) {
      const from = pick(people), to = pick(people.filter(p => p !== from));
      settlements.push({ id: "s" + i, fromMemberId: from, toMemberId: to, amountCents: 1 + Math.floor(rand() * 2000), createdAt: 100 + i });
    }
    const debts = computePairwiseDebts({ splitEdges: shares.map(s => ({ payerId: s.paidBy, memberId: s.memberId, amountCents: s.amountCents })), settlements });
    for (const me of people) for (const other of people) {
      if (me === other) continue;
      const { netCents, items } = pairwiseActivity({ shares, settlements, me, other });
      assert.equal(netCents, outstandingDebt(debts, other, me) - outstandingDebt(debts, me, other));
      assert.equal(items[0]?.runningCents ?? 0, netCents);
    }
  });
}

test("balances list everyone I owe or who owes me across groups, matching group totals", async t => {
  const f = await fixture(t);
  const { ids } = f;
  // In one group the admin is owed by Bea but owes Cy: gross amounts, not just the net.
  await f.add("admin", { description: "Hotel", amount: "90", paidBy: ids.admin, memberIds: [ids.admin, ids.Bea] });
  await f.add("Cy", { description: "Cab", amount: "40", paidBy: ids.Cy, memberIds: [ids.Cy, ids.admin] });
  await f.add("Bea", { description: "Snacks", amount: "10", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy] });
  const other = await setupGroup(f.env, "Office", ["Zed"], { adminCookie: f.adminCookie });
  await call(f.env, `/api/groups/${other.groupId}/expenses`, { method: "POST", cookie: other.cookies.Zed, body: { description: "Lunch", amount: "30", paidBy: other.ids.Zed, memberIds: [other.ids.Zed, "admin"] } });
  const paid = await call(f.env, `/api/groups/${other.groupId}/settlements`, { method: "POST", cookie: f.adminCookie, body: { fromMemberId: "admin", toMemberId: other.ids.Zed, amount: "5" } });
  assert.equal(paid.status, 201);

  const b = (await call(f.env, "/api/balances", { cookie: f.adminCookie })).data;
  assert.deepEqual(b.people.map(x => [x.groupName, x.name, x.netCents, x.active]), [
    ["Goa Trip", "Bea", 4500, true],
    ["Goa Trip", "Cy", -2000, true],
    ["Office", "Zed", -1000, true],
  ]);
  assert.deepEqual([b.owedToYouCents, b.youOweCents, b.netCents], [4500, 3000, 1500]);
  // Each row matches that group's own debts and person drill-down.
  for (const x of b.people) {
    const view = (await call(f.env, `/api/groups/${x.groupId}/with/${x.memberId}`, { cookie: f.adminCookie })).data;
    assert.equal(view.netCents, x.netCents);
  }
  // The net agrees with the per-group balances shown on the group list.
  const groups = (await call(f.env, "/api/groups", { cookie: f.adminCookie })).data.groups;
  assert.equal(groups.reduce((s, g) => s + g.myBalanceCents, 0), b.netCents);

  // A member sees only their own group and counterparties; settled pairs drop out.
  const bea = (await call(f.env, "/api/balances", { cookie: f.cookies.Bea })).data;
  assert.deepEqual(bea.people.map(x => [x.name, x.netCents]), [["Alex Admin", -4500], ["Cy", 500]]);
  assert.equal((await call(f.env, "/api/balances")).status, 401);
});

test("creator or admin can edit an expense: amount, payer and who is in the split; balances follow", async t => {
  const f = await fixture(t);
  const { ids } = f;
  const e = await f.add("Bea", { description: "Dinner", amount: "90", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy, ids.admin] });
  const edit = (who, body, eid = e.data.id) => call(f.env, `${f.G}/expenses/${eid}/edit`, { method: "POST", cookie: f.cookies[who] ?? f.adminCookie, body });
  const net = async (who, other) => (await f.get(who, "/with/" + other)).data.netCents;
  assert.equal(await net("Bea", ids.Cy), 3000);

  // Cy did not add it, so Cy cannot edit it.
  assert.equal((await edit("Cy", { description: "Dinner", amount: "1", paidBy: ids.Cy, memberIds: [ids.Cy] })).status, 403);
  // Remove Cy from the split and change the amount.
  const r = await edit("Bea", { description: "Dinner (no Cy)", amount: "100", paidBy: ids.Bea, memberIds: [ids.Bea, ids.admin] });
  assert.equal(r.status, 200);
  const x = (await f.get("Bea", "/expenses")).data.expenses.find(y => y.id === e.data.id);
  assert.deepEqual([x.description, x.amountCents, x.splits.map(s => [s.name, s.amountCents]).sort(), x.canEdit], ["Dinner (no Cy)", 10000, [["Alex Admin", 5000], ["Bea", 5000]], true]);
  assert.equal(await net("Bea", ids.Cy), 0);
  assert.equal(await net("Bea", ids.admin), 5000);
  // The admin can edit anyone's expense, including switching to exact amounts and a new payer.
  assert.equal((await edit("admin", { description: "Dinner", amount: "100", paidBy: ids.Cy, splitMode: "manual", allocations: [{ memberId: ids.Bea, amount: "70" }, { memberId: ids.Cy, amount: "30" }] })).status, 200);
  assert.equal(await net("Bea", ids.Cy), -7000);
  assert.equal(await net("Bea", ids.admin), 0);
  // Edits are validated exactly like new expenses and touch nothing on failure.
  assert.equal((await edit("Bea", { description: "Dinner", amount: "100", paidBy: ids.Bea, splitMode: "manual", allocations: [{ memberId: ids.Bea, amount: "60" }] })).status, 400);
  assert.equal((await edit("Bea", { description: "Dinner", amount: "100", paidBy: ids.Bea, memberIds: [] })).status, 400);
  assert.equal(await net("Bea", ids.Cy), -7000);
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM appx_splits").get().n, 2);
  // Unknown expense, or one from another group, is not found.
  assert.equal((await edit("Bea", { description: "x", amount: "1", paidBy: ids.Bea, memberIds: [ids.Bea] }, "nope")).status, 404);
  const other = await setupGroup(f.env, "Other group", ["Zed"], { adminCookie: f.adminCookie });
  assert.equal((await call(f.env, `/api/groups/${other.groupId}/expenses/${e.data.id}/edit`, { method: "POST", cookie: f.adminCookie, body: { description: "x", amount: "1", paidBy: "admin", memberIds: ["admin"] } })).status, 404);
});

test("admin can rename a member and a group; names update everywhere and the member signs in with the new name", async t => {
  const f = await fixture(t);
  const { ids } = f;
  await f.add("Cy", { description: "Cab", amount: "40", paidBy: ids.Cy, memberIds: [ids.Cy, ids.Bea] });
  const rename = (who, rid, name) => call(f.env, `/api/admin/requests/${rid}/rename`, { method: "POST", cookie: who, body: { name } });

  // Only the admin can rename.
  assert.equal((await rename(f.cookies.Cy, ids.Cy, "Cyrus")).status, 401);
  // Name rules: length, not the admin's, unique in the group.
  assert.equal((await rename(f.adminCookie, ids.Cy, "C")).status, 400);
  assert.equal((await rename(f.adminCookie, ids.Cy, "alex admin")).status, 409);
  assert.equal((await rename(f.adminCookie, ids.Cy, "BEA")).status, 409);
  assert.equal((await rename(f.adminCookie, "nope", "Cyrus")).status, 404);
  // Changing only the case of your own name is fine.
  assert.equal((await rename(f.adminCookie, ids.Cy, "cy")).status, 200);

  const r = await rename(f.adminCookie, ids.Cy, "  Cyrus  ");
  assert.deepEqual([r.status, r.data.name], [200, "Cyrus"]);
  // Past expenses, members and debts show the new name.
  const cab = (await f.get("Bea", "/expenses")).data.expenses[0];
  assert.deepEqual([cab.paidByName, cab.splits.map(s => s.name).sort()], ["Cyrus", ["Bea", "Cyrus"]]);
  assert.ok((await f.get("Bea", "")).data.members.some(m => m.id === ids.Cy && m.name === "Cyrus"));
  assert.equal((await f.get("Bea", "/with/" + ids.Cy)).data.other.name, "Cyrus");
  // Cy's current session keeps working and shows the new name; signing in uses it too.
  assert.equal((await call(f.env, "/api/me", { cookie: f.cookies.Cy })).data.member.name, "Cyrus");
  assert.equal((await call(f.env, "/api/access/signin", { method: "POST", body: { name: "Cyrus", groupId: f.groupId } })).status, 200);
  assert.equal((await call(f.env, "/api/access/signin", { method: "POST", body: { name: "Cy", groupId: f.groupId } })).status, 403);

  // Group rename: admin only, unique, and members see it.
  const other = await setupGroup(f.env, "Office", [], { adminCookie: f.adminCookie });
  const renameGroup = (who, gid, name) => call(f.env, `/api/admin/groups/${gid}/rename`, { method: "POST", cookie: who, body: { name } });
  assert.equal((await renameGroup(f.cookies.Bea, f.groupId, "Goa 2026")).status, 401);
  assert.equal((await renameGroup(f.adminCookie, f.groupId, "office")).status, 409);
  assert.equal((await renameGroup(f.adminCookie, "nope", "Goa 2026")).status, 404);
  assert.equal((await renameGroup(f.adminCookie, f.groupId, "Goa 2026")).status, 200);
  assert.equal((await f.get("Bea", "")).data.group.name, "Goa 2026");
  assert.equal((await call(f.env, "/api/groups", { cookie: f.cookies.Bea })).data.groups[0].name, "Goa 2026");
  assert.ok(other.groupId);
});
