// One person's statement (the data behind "Share as Excel"): their expenses
// with share and cumulative share, and what's between them and each other
// member, with payments' status.
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup, payAndConfirm, signUp } from "./helpers/d1.js";

test("a person's statement: expenses with cumulative share, and each pair with payments and their status", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Goa Trip", ["Bea", "Cy"]);
  const { ids } = g, G = `/api/groups/${g.groupId}`;
  const add = (who, body) => call(env, G + "/expenses", { method: "POST", cookie: g.cookies[who], body });
  await add("admin", { description: "Hotel", amount: "300", paidBy: ids.admin, memberIds: [ids.admin, ids.Bea, ids.Cy] });
  await add("Bea", { description: "Cab", amount: "90", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy] });
  await add("Cy", { description: "Dinner", amount: "60", paidBy: ids.Cy, memberIds: [ids.admin, ids.Cy] });
  await payAndConfirm(env, g.groupId, g, g.cookies.Cy, { fromMemberId: ids.Cy, toMemberId: ids.Bea, amount: "45" });
  await call(env, G + "/settlements", { method: "POST", cookie: g.cookies.Bea, body: { fromMemberId: ids.Bea, toMemberId: ids.admin, amount: "50" } });
  const rej = await call(env, G + "/settlements", { method: "POST", cookie: g.cookies.Cy, body: { fromMemberId: ids.Cy, toMemberId: ids.admin, amount: "20" } });
  await call(env, `${G}/settlements/${rej.data.id}/reject`, { method: "POST", cookie: g.adminCookie, body: {} });

  // Anyone in the group can export anyone's statement (Cy exports Bea's).
  const r = await call(env, `${G}/members/${ids.Bea}/statement`, { cookie: g.cookies.Cy });
  assert.equal(r.status, 200);
  const s = r.data;
  assert.deepEqual([s.group.name, s.person.name], ["Goa Trip", "Bea"]);
  assert.deepEqual(s.expenses.map(e => [e.description, e.totalCents, e.paidByName, e.shareCents, e.cumulativeShareCents]),
    [["Hotel", 30000, "Alex Admin", 10000, 10000], ["Cab", 9000, "Bea", 4500, 14500]], "only Bea's, oldest first, Dinner left out");
  // Paid 90, share 145, received 45 back: owes 100 overall.
  assert.deepEqual(s.totals, { paidCents: 9000, shareCents: 14500, balanceCents: -10000 });
  const pair = name => s.pairs.find(p => p.name === name);
  assert.deepEqual(s.pairs.map(p => p.name).sort(), ["Alex Admin", "Cy"]);
  // With the admin: Hotel (owes 100); a payment of 50 waiting for approval doesn't count yet.
  const a = pair("Alex Admin");
  assert.equal(a.netCents, -10000);
  assert.deepEqual(a.items.map(i => [i.type, i.description ?? i.fromName + "→" + i.toName, i.effectCents, i.runningCents, i.status]),
    [["expense", "Hotel", -10000, -10000, "counted"], ["payment", "Bea→Alex Admin", 0, -10000, "pending"]]);
  // With Cy: Cab (Cy owes 45), then Cy paid it back: settled. Cy's rejected payment to the admin isn't here.
  const c = pair("Cy");
  assert.equal(c.netCents, 0);
  assert.deepEqual(c.items.map(i => [i.type, i.effectCents, i.runningCents, i.status]), [["expense", 4500, 4500, "counted"], ["payment", -4500, 0, "counted"]]);
  // The admin's own statement shows the rejected payment with Cy, not counted.
  const adminWithCy = (await call(env, `${G}/members/${ids.admin}/statement`, { cookie: g.adminCookie })).data.pairs.find(p => p.name === "Cy");
  // Hotel: Cy owes the admin 100; Dinner: the admin owes Cy 30; the rejected 20 doesn't count.
  assert.deepEqual(adminWithCy.items.map(i => [i.type, i.status, i.effectCents, i.runningCents]),
    [["expense", "counted", 10000, 10000], ["expense", "counted", -3000, 7000], ["payment", "rejected", 0, 7000]]);
  assert.equal(adminWithCy.netCents, 7000);
  // Outsiders and unknown people.
  const out = await signUp(env, "Outsider");
  assert.equal((await call(env, `${G}/members/${ids.Bea}/statement`, { cookie: out.cookie })).status, 404);
  assert.equal((await call(env, `${G}/members/nobody/statement`, { cookie: g.cookies.Bea })).status, 404);
});
