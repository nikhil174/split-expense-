// The site owner's "Admin" tab: a role on one account, opened with the admin
// key. Hidden from everyone else; separate from the owner's own groups.
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup, signUp, OLD_ADMIN_PIN } from "./helpers/d1.js";

const post = (env, path, cookie, body = {}) => call(env, path, { method: "POST", cookie, body });

test("the first account to enter the admin key becomes the site owner; nobody else can, or even sees it", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const owner = await signUp(env, "Nikhil"), other = await signUp(env, "Mallory");
  assert.equal((await call(env, "/api/site-admin/overview", { cookie: owner.cookie })).status, 404);
  assert.equal((await post(env, "/api/site-admin/unlock", owner.cookie, { key: "wrong" })).status, 401);
  assert.equal((await post(env, "/api/site-admin/unlock", owner.cookie, { key: OLD_ADMIN_PIN })).status, 200);
  assert.deepEqual((await call(env, "/api/me", { cookie: owner.cookie })).data.user.siteAdmin, true);
  // There is one owner: the right key does nothing for anyone else.
  assert.equal((await post(env, "/api/site-admin/unlock", other.cookie, { key: OLD_ADMIN_PIN })).status, 404);
  const me = (await call(env, "/api/me", { cookie: other.cookie })).data.user;
  assert.ok(!("siteAdmin" in me) && !("adminUnlocked" in me), "others aren't told the Admin tab exists");
  for (const path of ["/api/site-admin/overview", "/api/site-admin/users", "/api/site-admin/groups"]) {
    assert.equal((await call(env, path, { cookie: other.cookie })).status, 404, path);
    assert.equal((await call(env, path)).status, 401, path);
  }
  assert.equal((await post(env, `/api/site-admin/users/${owner.id}/reset-pin`, other.cookie)).status, 404);
  // Unlock is rate limited.
  const tries = [];
  for (let i = 0; i < 11; i++) tries.push((await post(env, "/api/site-admin/unlock", owner.cookie, { key: "nope" + i })).status);
  assert.equal(tries.at(-1), 429);
});

test("the Admin tab needs the key in each session; it shows accounts and groups but not the owner's own view", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Goa Trip", ["Bea", "Cy"]);
  await post(env, `/api/groups/${g.groupId}/expenses`, g.cookies.Bea, { description: "Hotel", amount: "300", paidBy: g.ids.Bea, memberIds: [g.ids.Bea, g.ids.Cy] });
  const owner = await signUp(env, "Owner Person", { email: "owner@x.in" });
  assert.equal((await post(env, "/api/site-admin/unlock", owner.cookie, { key: OLD_ADMIN_PIN })).status, 200);
  // A new session starts locked.
  const again = (await call(env, "/api/auth/signin", { method: "POST", body: { login: owner.username, pin: "2468" } })).cookie;
  const locked = await call(env, "/api/site-admin/overview", { cookie: again });
  assert.deepEqual([locked.status, locked.data.code], [403, "admin_locked"]);
  assert.deepEqual((await call(env, "/api/me", { cookie: again })).data.user.adminUnlocked, false);

  const overview = (await call(env, "/api/site-admin/overview", { cookie: owner.cookie })).data;
  assert.deepEqual([overview.users, overview.groups, overview.expenses, overview.totalSpentCents], [4, 1, 1, 30000]);
  const users = (await call(env, "/api/site-admin/users?q=BEA", { cookie: owner.cookie })).data.users;
  assert.deepEqual(users.map(u => [u.name, u.groupCount, u.siteAdmin]), [["Bea", 1, false]]);
  assert.equal((await call(env, "/api/site-admin/users?q=owner@x", { cookie: owner.cookie })).data.users[0].siteAdmin, true);
  assert.equal((await call(env, "/api/site-admin/users?q=%25", { cookie: owner.cookie })).data.users.length, 0, "% is matched literally");
  const groups = (await call(env, "/api/site-admin/groups", { cookie: owner.cookie })).data.groups;
  assert.deepEqual(groups.map(x => [x.name, x.memberCount, x.admins, x.expenseCount, x.totalCents]), [["Goa Trip", 3, "Alex Admin", 1, 30000]]);
  assert.ok(!("expenses" in groups[0]), "no expense details");
  // The owner's General view is an ordinary account: no access to that group.
  assert.deepEqual((await call(env, "/api/groups", { cookie: owner.cookie })).data.groups, []);
  assert.equal((await call(env, `/api/groups/${g.groupId}/expenses`, { cookie: owner.cookie })).status, 404);

  // A forgotten PIN: a temporary one, shown once; the person is signed out.
  const reset = await post(env, `/api/site-admin/users/${g.ids.Bea}/reset-pin`, owner.cookie);
  assert.equal(reset.status, 200);
  assert.match(reset.data.temporaryPin, /^\d{4}$/);
  assert.equal((await call(env, "/api/me", { cookie: g.cookies.Bea })).data.user, null);
  assert.equal((await call(env, "/api/auth/signin", { method: "POST", body: { login: g.usernames.Bea, pin: reset.data.temporaryPin } })).status, 200);
  // Locking ends it for this session.
  assert.equal((await post(env, "/api/site-admin/lock", owner.cookie)).status, 200);
  assert.equal((await call(env, "/api/site-admin/users", { cookie: owner.cookie })).status, 403);
});
