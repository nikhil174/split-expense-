import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup, signUp } from "./helpers/d1.js";

async function fixture(t) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Goa Trip", ["Bea", "Cy"]);
  // Setting up the group sent "wants to join" / "You're in" notes; start clean.
  raw.prepare("DELETE FROM appx_notifications").run();
  const G = `/api/groups/${g.groupId}`;
  const post = (who, path, body = {}) => call(env, G + path, { method: "POST", cookie: g.cookies[who], body });
  const inbox = async who => (await call(env, "/api/notifications", { cookie: g.cookies[who] })).data;
  const titles = async who => (await inbox(who)).items.map(n => n.title);
  return { raw, env, g, G, post, inbox, titles };
}

test("adding, changing and deleting an expense tells everyone in it, with what it means for them", async t => {
  const f = await fixture(t);
  const { ids } = f.g;
  const e = await f.post("Bea", "/expenses", { description: "Dinner", amount: "90", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy, ids.admin] });
  const cy = await f.inbox("Cy");
  assert.equal(cy.unread, 1);
  assert.deepEqual([cy.items[0].kind, cy.items[0].title, cy.items[0].body, cy.items[0].groupName, cy.items[0].link],
    ["expense_added", "Bea added “Dinner”", "Bea paid ₹90.00 · you owe ₹30.00", "Goa Trip", `#/g/${f.g.groupId}/e/${e.data.id}`]);
  assert.deepEqual(await f.titles("admin"), ["Bea added “Dinner”"]);
  assert.deepEqual(await f.titles("Bea"), [], "not told about their own action");

  // Cy is taken out of the split: Cy is told, and so is the admin (still in it).
  await f.post("Bea", `/expenses/${e.data.id}/edit`, { description: "Dinner", amount: "60", paidBy: ids.Bea, memberIds: [ids.Bea, ids.admin] });
  const cy2 = (await f.inbox("Cy")).items[0];
  assert.deepEqual([cy2.kind, cy2.title, cy2.body, cy2.link], ["expense_edited", "Bea changed “Dinner”", "Bea paid ₹60.00 · you're not in the split", `#/g/${f.g.groupId}/e/${e.data.id}`]);
  assert.equal((await f.inbox("admin")).items[0].body, "Bea paid ₹60.00 · you owe ₹30.00");

  // The admin deletes it: Bea (who paid) is told; Cy, no longer in it, is not.
  await f.post("admin", `/expenses/${e.data.id}/delete`);
  const bea = (await f.inbox("Bea")).items[0];
  assert.deepEqual([bea.kind, bea.title, bea.body, bea.link], ["expense_deleted", "Alex Admin deleted “Dinner”", "It no longer counts in your balance.", `#/g/${f.g.groupId}`]);
  assert.equal((await f.inbox("Cy")).items.length, 2);
});

test("payments: the receiver is asked to confirm; the payer hears confirmed, rejected or cancelled", async t => {
  const f = await fixture(t);
  const { ids } = f.g;
  await f.post("Bea", "/expenses", { description: "Cab", amount: "100", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy] });
  const pay = amount => f.post("Cy", "/settlements", { fromMemberId: ids.Cy, toMemberId: ids.Bea, amount });

  const a = await pay("20");
  const bea = (await f.inbox("Bea")).items[0];
  // Links: the approver goes to the group (approve card on top); the payer to what's between them.
  assert.deepEqual([bea.kind, bea.title, bea.body, bea.link], ["payment_pending", "Cy says they paid you ₹20.00", "Confirm it once you've received it.", `#/g/${f.g.groupId}`]);
  await f.post("Bea", `/settlements/${a.data.id}/confirm`);
  assert.deepEqual((await f.inbox("Cy")).items.map(n => [n.kind, n.title, n.link])[0], ["payment_confirmed", "Bea confirmed your payment of ₹20.00", `#/g/${f.g.groupId}/p/${ids.Bea}`]);

  const b = await pay("10");
  await f.post("Bea", `/settlements/${b.data.id}/reject`);
  assert.equal((await f.inbox("Cy")).items[0].title, "Bea said they didn't receive your ₹10.00");

  const c = await pay("5");
  await f.post("Cy", `/settlements/${c.data.id}/cancel`);
  assert.deepEqual([(await f.inbox("Bea")).items[0].kind, (await f.inbox("Bea")).items[0].title, (await f.inbox("Bea")).items[0].link], ["payment_cancelled", "Cy cancelled a payment of ₹5.00", `#/g/${f.g.groupId}/p/${ids.Cy}`]);

  // The admin records Cy paying Bea: both are told (Bea to confirm).
  await f.post("admin", "/settlements", { fromMemberId: ids.Cy, toMemberId: ids.Bea, amount: "5" });
  assert.equal((await f.inbox("Bea")).items[0].title, "Cy says they paid you ₹5.00");
  assert.equal((await f.inbox("Cy")).items[0].title, "Alex Admin recorded your payment of ₹5.00 to Bea");
});

test("joining: the admin hears when an invitation is accepted; invitees and approved people are told", async t => {
  const f = await fixture(t);
  const dee = await signUp(f.env, "Dee");
  await f.post("admin", "/members/invite", { login: dee.username });
  const invite = (await call(f.env, "/api/notifications", { cookie: dee.cookie })).data;
  assert.deepEqual([invite.unread, invite.items[0].kind, invite.items[0].title, invite.items[0].link], [1, "group_invite", "Alex Admin invited you to “Goa Trip”", "#/"]);
  await call(f.env, `/api/groups/${f.g.groupId}/invitation/accept`, { method: "POST", cookie: dee.cookie, body: {} });
  const admin = (await f.inbox("admin")).items[0];
  assert.deepEqual([admin.kind, admin.title, admin.link], ["member_joined", "Dee joined “Goa Trip”", `#/g/${f.g.groupId}`]);
});

test("each person sees only their own notifications; marking read clears the count", async t => {
  const f = await fixture(t);
  const { ids } = f.g;
  await f.post("Bea", "/expenses", { description: "Snacks", amount: "10", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy] });
  assert.equal((await f.inbox("admin")).items.filter(n => n.kind.startsWith("expense")).length, 0, "the admin is not in this expense");
  assert.equal((await f.inbox("Cy")).unread, 1);
  assert.equal((await call(f.env, "/api/notifications/read", { method: "POST", cookie: f.g.cookies.Cy, body: {} })).status, 200);
  const after = await f.inbox("Cy");
  assert.equal(after.unread, 0);
  assert.ok(after.items[0].readAt > 0, "kept, marked read");
  assert.equal((await call(f.env, "/api/notifications")).status, 401);
  // Deleting the group clears its notifications.
  assert.equal((await call(f.env, `/api/groups/${f.g.groupId}/delete`, { method: "POST", cookie: f.g.adminCookie, body: {} })).status, 200);
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM appx_notifications").get().n, 0);
});
