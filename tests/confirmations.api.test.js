import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup } from "./helpers/d1.js";

// Bea owes the admin ₹50 and Cy ₹20 (equal splits), so there is something to pay.
async function fixture(t) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Goa Trip", ["Bea", "Cy"]);
  const G = `/api/groups/${g.groupId}`;
  const as = who => g.cookies[who];
  const post = (who, path, body = {}) => call(env, G + path, { method: "POST", cookie: as(who), body });
  const get = (who, path) => call(env, G + path, { cookie: as(who) });
  await post("admin", "/expenses", { description: "Hotel", amount: "100", paidBy: g.ids.admin, memberIds: [g.ids.admin, g.ids.Bea] });
  await post("Cy", "/expenses", { description: "Cab", amount: "40", paidBy: g.ids.Cy, memberIds: [g.ids.Cy, g.ids.Bea] });
  const pay = (who, from, to, amount) => post(who, "/settlements", { fromMemberId: g.ids[from], toMemberId: g.ids[to], amount });
  const owes = async (who, to) => (await get(who, "/settlements/mine")).data.youOwe.find(d => d.toMemberId === g.ids[to])?.amountCents ?? 0;
  const net = async (who, other) => (await get(who, "/with/" + g.ids[other])).data.netCents;
  const pending = async who => (await call(env, "/api/payments/pending", { cookie: as(who) })).data;
  return { raw, env, g, G, post, get, pay, owes, net, pending };
}

test("a member's payment waits for the receiver and does not count until confirmed", async t => {
  const f = await fixture(t);
  const r = await f.pay("Bea", "Bea", "Cy", "20");
  assert.deepEqual([r.status, r.data.status], [201, "pending"]);
  // Nothing has moved yet: debts, the person view and the group-list balance are unchanged.
  assert.equal(await f.owes("Bea", "Cy"), 2000);
  assert.equal(await f.net("Cy", "Bea"), 2000);
  const groupBalance = async who => (await call(f.env, "/api/groups", { cookie: f.g.cookies[who] })).data.groups[0].myBalanceCents;
  assert.equal(await groupBalance("Cy"), 2000);
  // Cy sees it to confirm; Bea sees it as waiting.
  const cy = await f.pending("Cy"), bea = await f.pending("Bea");
  assert.deepEqual(cy.toConfirm.map(x => [x.fromName, x.amountCents, x.groupName]), [["Bea", 2000, "Goa Trip"]]);
  assert.deepEqual([cy.waiting.length, bea.toConfirm.length, bea.waiting.length], [0, 0, 1]);
  assert.equal((await f.pending("admin")).toConfirm.length, 0, "not someone else's to confirm");
  // The payments list says who can do what.
  const row = async who => (await f.get(who, "/settlements")).data.settlements.find(x => x.id === r.data.id);
  assert.deepEqual([(await row("Cy")).status, (await row("Cy")).canDecide, (await row("Cy")).canCancel], ["pending", true, false]);
  assert.deepEqual([(await row("Bea")).canDecide, (await row("Bea")).canCancel], [false, true]);

  // Only the receiver (or the admin) can confirm.
  assert.equal((await f.post("Bea", `/settlements/${r.data.id}/confirm`)).status, 403);
  assert.equal((await f.post("Cy", `/settlements/${r.data.id}/confirm`)).status, 200);
  assert.equal(await f.owes("Bea", "Cy"), 0);
  assert.equal(await groupBalance("Cy"), 0);
  assert.equal((await row("Cy")).status, "confirmed");
  assert.deepEqual((await f.pending("Cy")).toConfirm, []);
  // A decided payment cannot be decided again.
  assert.equal((await f.post("Cy", `/settlements/${r.data.id}/reject`)).status, 409);
});

test("the receiver can reject; the payer can cancel while it is pending", async t => {
  const f = await fixture(t);
  const a = await f.pay("Bea", "Bea", "Cy", "20");
  assert.equal((await f.post("admin", `/settlements/${a.data.id}/cancel`)).status, 200, "admin can cancel too");
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM appx_settlements").get().n, 0);

  const b = await f.pay("Bea", "Bea", "Cy", "20");
  assert.equal((await f.post("Cy", `/settlements/${b.data.id}/cancel`)).status, 403, "the receiver rejects instead");
  assert.equal((await f.post("Cy", `/settlements/${b.data.id}/reject`)).status, 200);
  assert.equal(await f.owes("Bea", "Cy"), 2000, "a rejected payment never counts");
  assert.equal((await f.post("Cy", `/settlements/${b.data.id}/confirm`)).status, 409);
  assert.equal((await f.post("Bea", `/settlements/${b.data.id}/cancel`)).status, 409);
  // Kept for the record.
  assert.equal((await f.get("Bea", "/settlements")).data.settlements.find(x => x.id === b.data.id).status, "rejected");

  const c = await f.pay("Bea", "Bea", "Cy", "5");
  assert.equal((await f.post("Bea", `/settlements/${c.data.id}/cancel`)).status, 200);
  assert.equal((await f.post("Bea", "/settlements/nope/cancel")).status, 404);
});

test("payments waiting for confirmation count against what can still be paid", async t => {
  const f = await fixture(t);
  assert.equal((await f.pay("Bea", "Bea", "admin", "30")).status, 201);
  const debt = (await f.get("Bea", "/settlements/mine")).data.youOwe.find(d => d.toMemberId === "admin");
  assert.deepEqual([debt.amountCents, debt.waitingCents], [5000, 3000]);
  const over = await f.pay("Bea", "Bea", "admin", "30");
  assert.equal(over.status, 409);
  assert.match(over.data.error, /₹30\.00 is already waiting for Alex Admin to confirm, so at most ₹20\.00 more/);
  assert.equal((await f.pay("Bea", "Bea", "admin", "20")).status, 201);
  assert.equal((await f.pay("Bea", "Bea", "admin", "0.01")).status, 409, "nothing left once both are counted");
});

test("confirming checks the payment still fits what is owed", async t => {
  const f = await fixture(t);
  const r = await f.pay("Bea", "Bea", "Cy", "20");
  // The cab is deleted, so Bea no longer owes Cy anything.
  const cab = (await f.get("Cy", "/expenses")).data.expenses.find(x => x.description === "Cab");
  assert.equal((await f.post("Cy", `/expenses/${cab.id}/delete`)).status, 200);
  const c = await f.post("Cy", `/settlements/${r.data.id}/confirm`);
  assert.equal(c.status, 409);
  assert.match(c.data.error, /Reject it/);
  assert.equal((await f.post("Cy", `/settlements/${r.data.id}/reject`)).status, 200);
});

test("payments recorded by the receiver, or to someone who cannot confirm, count straight away", async t => {
  const f = await fixture(t);
  // The admin records Bea paying the admin: the receiver is the recorder.
  const toAdmin = await f.pay("admin", "Bea", "admin", "10");
  assert.deepEqual([toAdmin.status, toAdmin.data.status], [201, "confirmed"]);
  assert.equal(await f.owes("Bea", "admin"), 4000);
  // The admin records Bea paying Cy: Cy still has to confirm.
  const between = await f.pay("admin", "Bea", "Cy", "10");
  assert.equal(between.data.status, "pending");
  // Once Cy is removed from the group nobody can confirm, so the admin's record counts.
  await f.post("Cy", `/settlements/${between.data.id}/cancel`).then(r => assert.equal(r.status, 403));
  await f.post("admin", `/settlements/${between.data.id}/cancel`);
  await call(f.env, `/api/admin/requests/${f.g.ids.Cy}/remove`, { method: "POST", cookie: f.g.adminCookie, body: {} });
  const removed = await f.pay("admin", "Bea", "Cy", "10");
  assert.deepEqual([removed.status, removed.data.status], [201, "confirmed"]);
});

test("confirm/reject/cancel are scoped to the group and need a session", async t => {
  const f = await fixture(t);
  const r = await f.pay("Bea", "Bea", "Cy", "20");
  const other = await setupGroup(f.env, "Office", ["Zed"], { adminCookie: f.g.adminCookie });
  assert.equal((await call(f.env, `/api/groups/${other.groupId}/settlements/${r.data.id}/confirm`, { method: "POST", cookie: f.g.adminCookie, body: {} })).status, 404);
  assert.equal((await call(f.env, `${f.G}/settlements/${r.data.id}/confirm`, { method: "POST", body: {} })).status, 401);
  assert.equal((await call(f.env, "/api/payments/pending")).status, 401);
});

test("a payment can carry a screenshot for the receiver; balances show what is awaiting approval", async t => {
  const f = await fixture(t);
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const bad = await f.post("Bea", "/settlements", { fromMemberId: f.g.ids.Bea, toMemberId: f.g.ids.Cy, amount: "5", proof: "data:image/jpeg;base64," + PNG });
  assert.equal(bad.status, 400, "the bytes must match the type");
  const r = await f.post("Bea", "/settlements", { fromMemberId: f.g.ids.Bea, toMemberId: f.g.ids.Cy, amount: "20", proof: "data:image/png;base64," + PNG });
  assert.equal(r.status, 201);
  // Cy sees it waiting, with the screenshot, and can open it.
  const waiting = (await call(f.env, "/api/payments/pending", { cookie: f.g.cookies.Cy })).data.toConfirm[0];
  assert.deepEqual([waiting.amountCents, waiting.hasProof], [2000, true]);
  assert.equal((await f.get("Cy", "/settlements")).data.settlements.find(x => x.id === r.data.id).hasProof, true);
  const img = await call(f.env, `${f.G}/settlements/${r.data.id}/proof`, { cookie: f.g.cookies.Cy, raw: true });
  assert.deepEqual([img.status, img.response.headers.get("content-type"), img.response.headers.get("x-content-type-options")], [200, "image/png", "nosniff"]);
  // Not from another group, nor signed out.
  const other = await setupGroup(f.env, "Office", ["Zed"], { adminCookie: f.g.adminCookie });
  assert.equal((await call(f.env, `/api/groups/${other.groupId}/settlements/${r.data.id}/proof`, { cookie: f.g.adminCookie, raw: true })).status, 404);
  assert.equal((await call(f.env, `${f.G}/settlements/${r.data.id}/proof`, { raw: true })).status, 401);
  // Both sides see the amount awaiting approval next to the person.
  const bea = (await call(f.env, "/api/balances", { cookie: f.g.cookies.Bea })).data.people.find(p => p.memberId === f.g.ids.Cy);
  const cy = (await call(f.env, "/api/balances", { cookie: f.g.cookies.Cy })).data.people.find(p => p.memberId === f.g.ids.Bea);
  assert.deepEqual([bea.netCents, bea.waitingOutCents, bea.waitingInCents], [-2000, 2000, 0]);
  assert.deepEqual([cy.netCents, cy.waitingOutCents, cy.waitingInCents], [2000, 0, 2000]);
  // Cancelling removes the screenshot too.
  await f.post("Bea", `/settlements/${r.data.id}/cancel`);
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM appx_payment_proofs").get().n, 0);
});
