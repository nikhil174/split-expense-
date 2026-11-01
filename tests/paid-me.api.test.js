// "They paid me": the person who lent records a payment made to them; it
// counts only once a group admin approves it (immediately if they're an admin).
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup } from "./helpers/d1.js";

async function world(t) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Goa Trip", ["Bea", "Cy"]);
  const G = `/api/groups/${g.groupId}`, { ids } = g;
  const as = who => g.cookies[who];
  const post = (who, path, body = {}) => call(env, G + path, { method: "POST", cookie: as(who), body });
  const get = (who, path) => call(env, G + path, { cookie: as(who) });
  // Bea paid the cab; Cy owes Bea ₹45. The admin made Bea and Cy a second admin later in one test.
  await post("Bea", "/expenses", { description: "Cab", amount: "90", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy] });
  const owes = async () => (await get("Cy", "/settlements/mine")).data.youOwe.find(d => d.toMemberId === ids.Bea)?.amountCents ?? 0;
  const pending = async who => (await call(env, "/api/payments/pending", { cookie: as(who) })).data;
  const inbox = async who => (await call(env, "/api/notifications", { cookie: as(who) })).data.items;
  return { raw, env, g, ids, post, get, owes, pending, inbox };
}

test("the lender records 'they paid me'; it waits for a group admin, who approves it", async t => {
  const w = await world(t);
  const { ids } = w;
  // Settle up offers it to Bea now ("Cy pays you").
  const mine = (await w.get("Bea", "/settlements/mine")).data;
  assert.equal(mine.owedToYou.find(d => d.fromMemberId === ids.Cy).canRecord, true);
  const r = await w.post("Bea", "/settlements", { fromMemberId: ids.Cy, toMemberId: ids.Bea, amount: "45" });
  assert.deepEqual([r.status, r.data.status], [201, "pending"]);
  assert.equal(await w.owes(), 4500, "doesn't count yet");
  // Admins are asked; Cy is told it was recorded.
  assert.equal((await w.inbox("admin"))[0].title, "Bea says Cy paid them ₹45.00");
  assert.match((await w.inbox("Cy"))[0].body, /once a group admin approves/);
  // Who sees it where: the admin decides; Bea and Cy see it waiting.
  assert.deepEqual((await w.pending("admin")).toConfirm.map(x => [x.fromName, x.toName, x.needsAdmin]), [["Cy", "Bea", true]]);
  assert.deepEqual([(await w.pending("Bea")).toConfirm.length, (await w.pending("Bea")).waiting.length], [0, 1]);
  assert.deepEqual([(await w.pending("Cy")).toConfirm.length, (await w.pending("Cy")).waiting.length], [0, 1]);
  const row = async who => (await w.get(who, "/settlements")).data.settlements.find(x => x.id === r.data.id);
  assert.deepEqual([(await row("Bea")).needsAdmin, (await row("Bea")).canDecide, (await row("Bea")).canCancel], [true, false, true]);
  assert.deepEqual([(await row("Cy")).canDecide, (await row("admin")).canDecide], [false, true]);
  // Neither Bea (who recorded it) nor Cy can approve it; an admin does.
  assert.equal((await w.post("Bea", `/settlements/${r.data.id}/confirm`)).status, 403);
  assert.equal((await w.post("Cy", `/settlements/${r.data.id}/confirm`)).status, 403);
  assert.equal((await w.post("admin", `/settlements/${r.data.id}/confirm`)).status, 200);
  assert.equal(await w.owes(), 0, "settled");
  assert.equal((await w.inbox("Bea"))[0].title, "Alex Admin approved the ₹45.00 from Cy");
  assert.equal((await w.inbox("Cy"))[0].title, "Your payment of ₹45.00 to Bea is approved");
});

test("an admin can reject it; the lender can cancel it; a lender who is an admin records it straight away", async t => {
  const w = await world(t);
  const { ids } = w;
  const a = await w.post("Bea", "/settlements", { fromMemberId: ids.Cy, toMemberId: ids.Bea, amount: "20" });
  assert.equal((await w.post("admin", `/settlements/${a.data.id}/reject`)).status, 200);
  assert.equal((await w.inbox("Bea"))[0].title, "Alex Admin didn't approve the ₹20.00 from Cy");
  assert.equal((await w.inbox("Cy"))[0].title, "Alex Admin didn't approve your payment of ₹20.00 to Bea", "the payer is told too");
  assert.equal(await w.owes(), 4500);
  const b = await w.post("Bea", "/settlements", { fromMemberId: ids.Cy, toMemberId: ids.Bea, amount: "20" });
  assert.equal((await w.post("Bea", `/settlements/${b.data.id}/cancel`)).status, 200, "the lender cancels their own request");
  assert.equal((await w.inbox("Cy"))[0].title, "Bea cancelled the payment of ₹20.00 recorded for you");
  // The payer cancels it: the lender is told.
  const b2 = await w.post("Bea", "/settlements", { fromMemberId: ids.Cy, toMemberId: ids.Bea, amount: "20" });
  assert.equal((await w.post("Cy", `/settlements/${b2.data.id}/cancel`)).status, 200);
  assert.equal((await w.inbox("Bea"))[0].title, "Cy cancelled the ₹20.00 you recorded from them");
  // An admin cancels it: both are told.
  const b3 = await w.post("Bea", "/settlements", { fromMemberId: ids.Cy, toMemberId: ids.Bea, amount: "20" });
  assert.equal((await w.post("admin", `/settlements/${b3.data.id}/cancel`)).status, 200);
  assert.deepEqual([(await w.inbox("Bea"))[0].title, (await w.inbox("Cy"))[0].title], ["Alex Admin cancelled the ₹20.00 recorded from Cy", "Alex Admin cancelled the payment of ₹20.00 recorded for you"]);
  // Bea becomes an admin: now her "they paid me" counts at once.
  await w.post("admin", `/members/${ids.Bea}/make-admin`);
  const c = await w.post("Bea", "/settlements", { fromMemberId: ids.Cy, toMemberId: ids.Bea, amount: "45" });
  assert.deepEqual([c.status, c.data.status], [201, "confirmed"]);
  assert.equal(await w.owes(), 0);
  // Still no recording payments between two other people.
  assert.equal((await w.post("Cy", "/settlements", { fromMemberId: ids.admin, toMemberId: ids.Bea, amount: "1" })).status, 403);
});
