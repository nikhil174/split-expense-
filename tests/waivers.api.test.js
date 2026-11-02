// "No need to pay": the lender lets someone off what they still owe them. It
// counts once a group admin approves it (at once when the lender is an admin),
// and then the whole group is told.
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup } from "./helpers/d1.js";

async function world(t) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Goa Trip", ["Bea", "Cy", "Dee"]);
  const G = `/api/groups/${g.groupId}`, { ids } = g;
  const as = who => g.cookies[who];
  const post = (who, path, body = {}) => call(env, G + path, { method: "POST", cookie: as(who), body });
  const get = (who, path) => call(env, G + path, { cookie: as(who) });
  // Bea paid the ₹90 cab for three: Cy and Dee each owe her ₹30.
  const cab = await post("Bea", "/expenses", { description: "Cab", amount: "90", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy, ids.Dee] });
  const owes = async (who, to = "Bea") => (await get(who, "/settlements/mine")).data.youOwe.find(d => d.toMemberId === ids[to])?.amountCents ?? 0;
  const pending = async who => (await call(env, "/api/payments/pending", { cookie: as(who) })).data;
  // What each person was told about waivers, newest first.
  const inbox = async who => (await call(env, "/api/notifications", { cookie: as(who) })).data.items.filter(n => n.kind.startsWith("waiver_"));
  const waive = (who, body) => post(who, "/settlements/waive", body);
  const row = async (who, id) => (await get(who, "/settlements")).data.settlements.find(x => x.id === id);
  return { raw, env, g, ids, post, get, owes, pending, inbox, waive, row, cabId: cab.data.id };
}

test("the lender lets someone off what's left; an admin approves; the whole group is told", async t => {
  const w = await world(t);
  const { ids } = w;
  const r = await w.waive("Bea", { fromMemberId: ids.Cy });
  assert.deepEqual([r.status, r.data.status, r.data.amountCents], [201, "pending", 3000], "defaults to everything still unpaid");
  assert.equal(await w.owes("Cy"), 3000, "doesn't count until an admin approves");
  // The admins are asked, Cy hears what's coming, nobody else yet.
  assert.deepEqual((await w.inbox("admin")).map(n => [n.kind, n.title]), [["waiver_admin_approval", "Bea wants to let Cy off ₹30.00"]]);
  assert.deepEqual((await w.inbox("Cy")).map(n => [n.kind, n.title, n.body]), [["waiver_pending", "Bea is letting you off ₹30.00", "You won't need to pay it once a group admin approves."]]);
  assert.deepEqual([(await w.inbox("Bea")).length, (await w.inbox("Dee")).length], [0, 0]);
  // It shows as a waiver everywhere, waiting for an admin.
  assert.deepEqual((await w.pending("admin")).toConfirm.map(x => [x.fromName, x.toName, x.kind, x.needsAdmin]), [["Cy", "Bea", "waiver", true]]);
  assert.deepEqual((await w.pending("Cy")).waiting.map(x => x.kind), ["waiver"]);
  assert.deepEqual((await w.pending("Bea")).waiting.map(x => x.kind), ["waiver"]);
  const bea = await w.row("Bea", r.data.id), cy = await w.row("Cy", r.data.id), admin = await w.row("admin", r.data.id);
  assert.deepEqual([bea.kind, bea.needsAdmin, bea.canDecide, bea.canCancel], ["waiver", true, false, true]);
  assert.deepEqual([cy.canDecide, cy.canCancel], [false, false], "the debtor can't cancel the lender's offer");
  assert.deepEqual([admin.canDecide, admin.canCancel], [true, true]);
  // Only an admin decides it; the debtor can't cancel it.
  const refused = await w.post("Bea", `/settlements/${r.data.id}/confirm`);
  assert.deepEqual([refused.status, refused.data.error], [403, "A group admin approves letting them off."]);
  assert.equal((await w.post("Cy", `/settlements/${r.data.id}/confirm`)).status, 403);
  const cancel = await w.post("Cy", `/settlements/${r.data.id}/cancel`);
  assert.deepEqual([cancel.status, cancel.data.error], [403, "Only the person who is owed or a group admin can cancel this."]);
  assert.equal((await w.post("admin", `/settlements/${r.data.id}/confirm`)).status, 200);
  assert.equal(await w.owes("Cy"), 0, "cleared");
  assert.equal(await w.owes("Dee"), 3000, "Dee still owes hers");
  // Everyone in the group hears it, in their own words; not the admin who approved it.
  assert.deepEqual((await w.inbox("Cy"))[0], { ...(await w.inbox("Cy"))[0], kind: "waiver_approved", title: "Bea let you off ₹30.00", body: "You don't need to pay it. It's cleared from what you owe Bea.", link: `#/g/${w.g.groupId}/p/${ids.Bea}` });
  assert.deepEqual([(await w.inbox("Bea"))[0].title, (await w.inbox("Bea"))[0].body], ["Alex Admin approved letting Cy off ₹30.00", "It's cleared from what Cy owes you."]);
  assert.deepEqual([(await w.inbox("Dee"))[0].title, (await w.inbox("Dee"))[0].body], ["Bea let Cy off ₹30.00, approved by Alex Admin", "Cy doesn't need to pay it back."]);
  assert.deepEqual((await w.inbox("admin")).map(n => n.kind), ["waiver_admin_approval"], "only asked, never told about their own approval");
  // Deciding again is refused.
  const again = await w.post("admin", `/settlements/${r.data.id}/reject`);
  assert.deepEqual([again.status, again.data.error], [409, "This request to let them off was already confirmed."]);
  // Bea's and Cy's views of what's between them show it as a waiver.
  const view = (await w.get("Bea", "/with/" + ids.Cy)).data;
  assert.deepEqual(view.items.filter(i => i.type === "payment").map(i => [i.kind, i.effectCents]), [["waiver", -3000]]);
  assert.equal(view.netCents, 0);
  const statement = (await w.get("Cy", `/members/${ids.Cy}/statement`)).data;
  const withBea = statement.pairs.find(p => p.id === ids.Bea);
  assert.deepEqual(withBea.items.filter(i => i.type === "payment").map(i => [i.kind, i.amountCents, i.status]), [["waiver", 3000, "counted"]]);
  assert.equal(withBea.netCents, 0);
  const summary = (await w.get("Cy", `/members/${ids.Cy}`)).data;
  assert.deepEqual(summary.payments.map(p => [p.kind, p.status]), [["waiver", "confirmed"]]);
});

test("a part of the debt; never more than what's left once pending payments count", async t => {
  const w = await world(t);
  const { ids } = w;
  // Cy says they paid ₹10 (waiting for Bea): at most ₹20 can be let off now.
  const paid = await w.post("Cy", "/settlements", { fromMemberId: ids.Cy, toMemberId: ids.Bea, amount: "10" });
  assert.equal(paid.status, 201);
  const tooMuch = await w.waive("Bea", { fromMemberId: ids.Cy, amount: "25" });
  assert.deepEqual([tooMuch.status, tooMuch.data.error], [409, "They owe you ₹20.00 that isn't already waiting for approval, so you can let them off at most that."]);
  const part = await w.waive("Bea", { fromMemberId: ids.Cy, amount: "5.50" });
  assert.deepEqual([part.status, part.data.amountCents], [201, 550]);
  // The rest by default; then nothing is left to let off or pay.
  const rest = await w.waive("Bea", { fromMemberId: ids.Cy });
  assert.deepEqual([rest.status, rest.data.amountCents], [201, 1450]);
  const none = await w.waive("Bea", { fromMemberId: ids.Cy });
  assert.deepEqual([none.status, none.data.error], [409, "Everything they owe you is already waiting for approval."]);
  assert.equal((await w.post("Cy", "/settlements", { fromMemberId: ids.Cy, toMemberId: ids.Bea, amount: "1" })).status, 409, "a waiting waiver counts against what can be paid");
  // All three counted: nothing owed.
  assert.equal((await w.post("Bea", `/settlements/${paid.data.id}/confirm`)).status, 200);
  for (const x of [part, rest]) assert.equal((await w.post("admin", `/settlements/${x.data.id}/confirm`)).status, 200);
  assert.equal(await w.owes("Cy"), 0);
});

test("rejected or cancelled: the lender and the debtor are told, and it's still owed", async t => {
  const w = await world(t);
  const { ids } = w;
  const a = await w.waive("Bea", { fromMemberId: ids.Cy });
  assert.equal((await w.post("admin", `/settlements/${a.data.id}/reject`)).status, 200);
  assert.deepEqual([(await w.inbox("Bea"))[0].kind, (await w.inbox("Bea"))[0].title, (await w.inbox("Bea"))[0].body], ["waiver_rejected", "Alex Admin didn't approve letting Cy off ₹30.00", "Cy still owes it."]);
  assert.deepEqual([(await w.inbox("Cy"))[0].title, (await w.inbox("Cy"))[0].body], ["Alex Admin didn't approve Bea letting you off ₹30.00", "You still owe it."]);
  assert.equal((await w.inbox("Dee")).length, 0, "the rest of the group only hears about approved ones");
  assert.equal(await w.owes("Cy"), 3000);
  // The lender withdraws it: Cy hears; the admin no longer needs to decide it.
  const b = await w.waive("Bea", { fromMemberId: ids.Cy });
  assert.equal((await w.post("Bea", `/settlements/${b.data.id}/cancel`)).status, 200);
  assert.deepEqual([(await w.inbox("Cy"))[0].kind, (await w.inbox("Cy"))[0].title], ["waiver_cancelled", "Bea is no longer letting you off ₹30.00"]);
  assert.equal((await w.pending("admin")).toConfirm.length, 0);
  // An admin cancels it: both hear.
  const c = await w.waive("Bea", { fromMemberId: ids.Cy });
  assert.equal((await w.post("admin", `/settlements/${c.data.id}/cancel`)).status, 200);
  assert.deepEqual([(await w.inbox("Bea"))[0].title, (await w.inbox("Cy"))[0].title], ["Alex Admin cancelled letting Cy off ₹30.00", "Bea is no longer letting you off ₹30.00"]);
  // The history keeps what was cancelled, and that it was a waiver.
  const logged = w.raw.prepare("SELECT before_json FROM appx_history WHERE entity='payment' AND entity_id=?").get(c.data.id);
  assert.equal(JSON.parse(logged.before_json).kind, "waiver");
  assert.equal(await w.owes("Cy"), 3000);
});

test("a lender who is a group admin lets someone off at once; everyone else is told", async t => {
  const w = await world(t);
  const { ids } = w;
  await w.post("admin", "/expenses", { description: "Dinner", amount: "60", paidBy: ids.admin, memberIds: [ids.admin, ids.Dee] });
  const r = await w.waive("admin", { fromMemberId: ids.Dee });
  assert.deepEqual([r.status, r.data.status, r.data.amountCents], [201, "confirmed", 3000]);
  assert.equal(await w.owes("Dee", "admin"), 0);
  assert.equal(await w.owes("Dee", "Bea"), 3000, "only what Dee owed the admin");
  assert.deepEqual((await w.inbox("Dee"))[0].title, "Alex Admin let you off ₹30.00");
  for (const who of ["Bea", "Cy"]) assert.deepEqual([(await w.inbox(who))[0].title, (await w.inbox(who))[0].body], ["Alex Admin let Dee off ₹30.00", "Dee doesn't need to pay it back."]);
  assert.equal((await w.inbox("admin")).length, 0);
});

test("only what's owed to me, by someone in the group, for a valid amount", async t => {
  const w = await world(t);
  const { ids } = w;
  const cases = [
    [{ fromMemberId: ids.Dee }, "Cy", 409, "They don't owe you anything."],
    [{ fromMemberId: ids.Bea }, "Bea", 400, "You can't let yourself off."],
    [{}, "Bea", 400, "Choose who you're letting off."],
    [{ fromMemberId: "someone-else" }, "Bea", 400, "They must belong to this group."],
    [{ fromMemberId: ids.Cy, amount: "0" }, "Bea", 400, null],
    [{ fromMemberId: ids.Cy, amount: "abc" }, "Bea", 400, null],
    [{ fromMemberId: ids.Cy, amount: "1.234" }, "Bea", 400, null],
  ];
  for (const [body, who, status, error] of cases) {
    const r = await w.waive(who, body);
    assert.equal(r.status, status, JSON.stringify(body));
    if (error) assert.equal(r.data.error, error);
  }
  assert.equal((await call(w.env, `/api/groups/${w.g.groupId}/settlements/waive`, { method: "POST", body: { fromMemberId: ids.Cy } })).status, 401);
  assert.equal(w.raw.prepare("SELECT COUNT(*) AS n FROM appx_settlements").get().n, 0, "nothing was recorded");
});

test("approving re-checks the debt, because expenses may have changed since it was asked", async t => {
  const w = await world(t);
  const { ids } = w;
  const r = await w.waive("Bea", { fromMemberId: ids.Cy });
  assert.equal((await w.post("Bea", `/expenses/${w.cabId}/delete`)).status, 200);
  const late = await w.post("admin", `/settlements/${r.data.id}/confirm`);
  assert.deepEqual([late.status, late.data.error], [409, "This is now more than they owe, because expenses changed since it was asked. Reject it and ask again."]);
  assert.equal((await w.post("admin", `/settlements/${r.data.id}/reject`)).status, 200);
});

test("a debtor who is a group admin can't approve or cancel being let off; another admin decides", async t => {
  const w = await world(t);
  const { ids } = w;
  assert.equal((await w.post("admin", `/members/${ids.Cy}/make-admin`)).status, 200);
  const r = await w.waive("Bea", { fromMemberId: ids.Cy });
  // Cy hears it as the debtor, not as an admin asked to approve it.
  assert.deepEqual((await w.inbox("Cy")).map(n => n.kind), ["waiver_pending"]);
  assert.deepEqual([(await w.pending("Cy")).toConfirm.length, (await w.pending("Cy")).waiting.map(x => x.kind)], [0, ["waiver"]]);
  const row = await w.row("Cy", r.data.id);
  assert.deepEqual([row.canDecide, row.canCancel], [false, false]);
  const confirm = await w.post("Cy", `/settlements/${r.data.id}/confirm`);
  assert.deepEqual([confirm.status, confirm.data.error], [403, "Another group admin approves letting you off."]);
  assert.equal((await w.post("Cy", `/settlements/${r.data.id}/reject`)).status, 403);
  assert.equal((await w.post("Cy", `/settlements/${r.data.id}/cancel`)).status, 403);
  assert.equal(await w.owes("Cy"), 3000);
  assert.equal((await w.post("admin", `/settlements/${r.data.id}/confirm`)).status, 200);
  assert.equal(await w.owes("Cy"), 0);
});
