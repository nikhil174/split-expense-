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
