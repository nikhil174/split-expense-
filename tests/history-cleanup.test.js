// The group history (expenses added/edited/deleted, payments cancelled) and
// the daily cleanup of expired rows.
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup } from "./helpers/d1.js";
import { cleanup } from "../src/index.js";

test("history keeps every expense change and cancelled payments, with names, and balances ignore it", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Goa Trip", ["Bea", "Cy"]);
  const { ids } = g, G = `/api/groups/${g.groupId}`;
  const add = await call(env, G + "/expenses", { method: "POST", cookie: g.cookies.Bea, body: { description: "Cab", amount: "90", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy] } });
  assert.equal(add.status, 201);
  const eid = add.data.id;
  const edit = await call(env, `${G}/expenses/${eid}/edit`, { method: "POST", cookie: g.cookies.Bea, body: { description: "Cab to airport", amount: "120", paidBy: ids.Bea, memberIds: [ids.Bea, ids.Cy, ids.admin] } });
  assert.equal(edit.status, 200);

  // One expense's history: added, then edited (before → after), newest first.
  const h = (await call(env, `${G}/history?expense=${eid}`, { cookie: g.cookies.Cy })).data.history;
  assert.deepEqual(h.map(x => [x.action, x.actorName]), [["edited", "Bea"], ["created", "Bea"]]);
  assert.deepEqual([h[0].before.description, h[0].before.amountCents, h[0].after.description, h[0].after.amountCents], ["Cab", 9000, "Cab to airport", 12000]);
  assert.deepEqual(h[0].before.splits.map(s => [s.name, s.amountCents]).sort(), [["Bea", 4500], ["Cy", 4500]]);
  assert.equal(h[0].after.splits.length, 3);
  assert.equal(h[0].after.paidByName, "Bea");

  // A payment recorded and then cancelled: gone from payments, kept in history.
  const pay = await call(env, G + "/settlements", { method: "POST", cookie: g.cookies.Cy, body: { fromMemberId: ids.Cy, toMemberId: ids.Bea, amount: "40" } });
  assert.equal((await call(env, `${G}/settlements/${pay.data.id}/cancel`, { method: "POST", cookie: g.cookies.Cy, body: {} })).status, 200);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM appx_settlements WHERE id=?").get(pay.data.id).n, 0);
  // Delete the expense too.
  assert.equal((await call(env, `${G}/expenses/${eid}/delete`, { method: "POST", cookie: g.adminCookie, body: {} })).status, 200);

  const all = (await call(env, `${G}/history`, { cookie: g.cookies.Bea })).data.history;
  assert.deepEqual(all.map(x => [x.entity, x.action, x.actorName]), [["expense", "deleted", "Alex Admin"], ["payment", "cancelled", "Cy"], ["expense", "edited", "Bea"], ["expense", "created", "Bea"]]);
  const cancelled = all[1];
  assert.deepEqual([cancelled.before.fromName, cancelled.before.toName, cancelled.before.amountCents], ["Cy", "Bea", 4000]);
  assert.equal(all[0].before.description, "Cab to airport");

  // Outsiders can't read it; deleting the group removes its history.
  const other = await setupGroup(env, "Other", ["Dee"]);
  assert.equal((await call(env, `${G}/history`, { cookie: other.cookies.Dee })).status, 404);
  assert.equal((await call(env, `${G}/delete`, { method: "POST", cookie: g.adminCookie, body: {} })).status, 200);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM appx_history WHERE group_id=?").get(g.groupId).n, 0);
});

test("daily cleanup removes only expired rows", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Trip", ["Bea"]);
  const now = Date.now(), DAY = 86400000;
  const n = table => raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const sessionsLive = n("appx_user_sessions");
  raw.prepare("INSERT INTO appx_user_sessions(token_hash,user_id,expires_at) VALUES('old',?,?)").run(g.ids.Bea, now - 1000);
  raw.prepare("INSERT INTO appx_group_unlocks(session_hash,group_id,until) VALUES('old',?,?)").run(g.groupId, now - 1000);
  raw.prepare("INSERT INTO appx_group_unlocks(session_hash,group_id,until) VALUES('live',?,?)").run(g.groupId, now + DAY);
  raw.prepare("INSERT INTO appx_rate_limits(bucket,window_start,count) VALUES('old',?,1),('live',?,1)").run(now - 2 * DAY, now);
  raw.prepare("INSERT INTO appx_email_tokens(token_hash,user_id,purpose,email,expires_at,used_at) VALUES('expired',?, 'reset','a@b.c',?,NULL),('used',?,'reset','a@b.c',?,?),('live',?,'reset','a@b.c',?,NULL)")
    .run(g.ids.Bea, now - 2 * DAY, g.ids.Bea, now + DAY, now - 2 * DAY, g.ids.Bea, now + DAY);
  raw.prepare("INSERT INTO appx_notifications(id,recipient_id,kind,title,created_at,read_at) VALUES('old-read',?,'x','t',?,?),('old-unread',?,'x','t',?,NULL),('new-read',?,'x','t',?,?)")
    .run(g.ids.Bea, now - 100 * DAY, now - 99 * DAY, g.ids.Bea, now - 100 * DAY, g.ids.Bea, now - DAY, now);
  const unlocksBefore = n("appx_group_unlocks"), notesBefore = n("appx_notifications");

  const r = await cleanup(env["split-expense"], now);
  assert.deepEqual(r, { sessions: 1, unlocks: 1, rateLimits: 1, emailLinks: 2, notifications: 1 });
  assert.equal(n("appx_user_sessions"), sessionsLive, "live sessions kept");
  assert.equal(n("appx_group_unlocks"), unlocksBefore - 1);
  assert.equal(raw.prepare("SELECT token_hash FROM appx_email_tokens").all().map(x => x.token_hash).join(), "live");
  assert.equal(n("appx_notifications"), notesBefore - 1, "unread and recent notifications kept");
  // Running it again finds nothing more.
  assert.deepEqual(await cleanup(env["split-expense"], now), { sessions: 0, unlocks: 0, rateLimits: 0, emailLinks: 0, notifications: 0 });
});
