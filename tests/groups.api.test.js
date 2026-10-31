// Groups for everyone: anyone creates a group and is its admin; admins invite
// people by username or email, approve, remove, and make others admin.
// Groups never see each other.
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup, signUp, GROUP_PIN, unlockGroup } from "./helpers/d1.js";

async function world(t) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Goa Trip", ["Bea", "Cy"]);
  const G = `/api/groups/${g.groupId}`;
  const post = (who, path, body = {}) => call(env, G + path, { method: "POST", cookie: g.cookies[who] ?? who, body });
  const detail = async who => (await call(env, G, { cookie: g.cookies[who] ?? who })).data;
  return { raw, env, g, G, post, detail };
}

test("anyone can create a group and is its only admin; groups are invisible to outsiders", async t => {
  const w = await world(t);
  const dee = await signUp(w.env, "Dee");
  assert.equal((await call(w.env, "/api/groups", { method: "POST", cookie: dee.cookie, body: { name: "Goa Trip" } })).status, 400, "a group needs a PIN");
  const mine = await call(w.env, "/api/groups", { method: "POST", cookie: dee.cookie, body: { name: "Goa Trip", pin: "4242" } });
  assert.equal(mine.status, 201, "group names need not be unique across people");
  assert.equal((await call(w.env, "/api/groups", { method: "POST", cookie: dee.cookie, body: { name: "x", pin: "4242" } })).status, 400);
  const d = (await call(w.env, `/api/groups/${mine.data.group.id}`, { cookie: dee.cookie })).data;
  assert.deepEqual([d.me.isAdmin, d.me.role, d.members.map(m => [m.name, m.role])], [true, "admin", [["Dee", "admin"]]]);
  assert.deepEqual((await call(w.env, "/api/groups", { cookie: dee.cookie })).data.groups.map(x => [x.name, x.role, x.memberCount]), [["Goa Trip", "admin", 1]]);
  // Dee sees nothing of the other "Goa Trip" and vice versa.
  for (const tail of ["", "/expenses", "/balances", "/settlements", "/payment-methods"]) {
    assert.equal((await call(w.env, w.G + tail, { cookie: dee.cookie })).status, 404, tail);
    assert.equal((await call(w.env, `/api/groups/${mine.data.group.id}${tail}`, { cookie: w.g.cookies.Bea })).status, 404, tail);
  }
  // The old public group list and admin area are gone; an old app is told to reload.
  for (const [path, cookie] of [["/api/groups/public"], ["/api/admin/requests", w.g.adminCookie]]) {
    const r = await call(w.env, path, { cookie });
    assert.deepEqual([r.status, r.data.code], [410, "app_updated"], path);
    assert.match(r.data.error, /Close and reopen the app/);
  }
});

test("admins invite by username or email; the person joins only after accepting", async t => {
  const w = await world(t);
  const dee = await signUp(w.env, "Dee Dee", { email: "dee@example.com" });
  assert.equal((await w.post("Bea", "/members/invite", { login: dee.username })).status, 403, "members can't invite (yet)");
  const missing = await w.post("admin", "/members/invite", { login: "ghost" });
  assert.deepEqual([missing.status, /No one on Split It has the username “ghost”/.test(missing.data.error)], [404, true]);
  assert.match((await w.post("admin", "/members/invite", { login: "ghost@example.com" })).data.error, /email “ghost@example.com”/);
  assert.equal((await w.post("admin", "/members/invite", { login: w.g.usernames.Bea })).status, 409, "already in");
  const inv = await w.post("admin", "/members/invite", { login: "DEE@example.com" });
  assert.deepEqual([inv.status, inv.data.status], [200, "invited"]);
  assert.equal((await w.post("admin", "/members/invite", { login: dee.username })).status, 409, "already invited");
  // Invited is not in: no access, not selectable, but admins see it waiting.
  assert.equal((await call(w.env, w.G, { cookie: dee.cookie })).status, 404);
  assert.deepEqual((await w.detail("admin")).waiting.map(x => [x.name, x.status]), [["Dee Dee", "invited"]]);
  assert.deepEqual((await w.detail("Bea")).waiting, [], "only admins see who is waiting");
  const notes = (await call(w.env, "/api/notifications", { cookie: dee.cookie })).data.items;
  assert.deepEqual(notes.map(n => [n.kind, n.title]), [["group_invite", "Alex Admin invited you to “Goa Trip”"]]);
  const invitations = (await call(w.env, "/api/invitations", { cookie: dee.cookie })).data.invitations;
  assert.deepEqual(invitations.map(i => [i.groupName, i.invitedBy, i.memberCount]), [["Goa Trip", "Alex Admin", 3]]);
  // Someone else can't accept for Dee.
  assert.equal((await call(w.env, w.G + "/invitation/accept", { method: "POST", cookie: w.g.cookies.Bea, body: {} })).status, 404);
  assert.equal((await call(w.env, w.G + "/invitation/accept", { method: "POST", cookie: dee.cookie, body: {} })).status, 400, "needs the group PIN");
  assert.equal((await call(w.env, w.G + "/invitation/accept", { method: "POST", cookie: dee.cookie, body: { pin: "0000" } })).status, 401, "wrong group PIN");
  assert.equal((await call(w.env, w.G + "/invitation/accept", { method: "POST", cookie: dee.cookie, body: { pin: GROUP_PIN } })).status, 200);
  assert.deepEqual((await w.detail(dee.cookie)).members.map(m => m.name), ["Alex Admin", "Bea", "Cy", "Dee Dee"]);
  assert.equal((await call(w.env, "/api/notifications", { cookie: w.g.adminCookie })).data.items[0].title, "Dee Dee joined “Goa Trip”");
  // Declining, and the admin cancelling an invitation.
  const eve = await signUp(w.env, "Eve"), fay = await signUp(w.env, "Fay");
  await w.post("admin", "/members/invite", { login: eve.username });
  await w.post("admin", "/members/invite", { login: fay.username });
  assert.equal((await call(w.env, w.G + "/invitation/decline", { method: "POST", cookie: eve.cookie, body: {} })).status, 200);
  assert.equal((await w.post("admin", `/members/${fay.id}/cancel-invite`)).status, 200);
  assert.equal((await call(w.env, w.G + "/invitation/accept", { method: "POST", cookie: fay.cookie, body: {} })).status, 404);
  assert.deepEqual((await w.detail("admin")).waiting, []);
  // They can be invited again later.
  assert.equal((await w.post("admin", "/members/invite", { login: eve.username })).data.status, "invited");
});

test("admins make others admin; the last admin can't step down, be removed or leave", async t => {
  const w = await world(t);
  const { ids } = w.g;
  assert.equal((await w.post("Bea", `/members/${ids.Cy}/make-admin`)).status, 403);
  assert.equal((await w.post("admin", `/members/${ids.admin}/make-member`)).status, 409, "last admin");
  assert.equal((await w.post("admin", "/leave")).status, 409, "only admin, others still in");
  assert.equal((await w.post("admin", `/members/${ids.Bea}/make-admin`)).status, 200);
  const bea = await w.detail("Bea");
  assert.deepEqual([bea.me.isAdmin, bea.members.filter(m => m.role === "admin").map(m => m.name)], [true, ["Alex Admin", "Bea"]]);
  assert.equal((await call(w.env, "/api/notifications", { cookie: w.g.cookies.Bea })).data.items[0].kind, "made_admin");
  // Bea now has admin powers: edit anyone's expense, rename the group, remove the old admin.
  const e = await w.post("Cy", "/expenses", { description: "Cab", amount: "90", paidBy: ids.Cy, memberIds: [ids.Cy, ids.Bea] });
  assert.equal((await w.post("Bea", `/expenses/${e.data.id}/edit`, { description: "Cab home", amount: "90", paidBy: ids.Cy, memberIds: [ids.Cy, ids.Bea] })).status, 200);
  assert.equal((await w.post("Cy", "/rename", { name: "Goa 2026" })).status, 403);
  assert.equal((await w.post("Bea", "/rename", { name: "Goa 2026" })).status, 200);
  assert.equal((await w.post("Bea", `/members/${ids.admin}/make-member`)).status, 200);
  assert.equal((await w.post("admin", `/members/${ids.Cy}/remove`)).status, 403, "no longer an admin");
  assert.equal((await w.post("Bea", `/members/${ids.Bea}/remove`)).status, 409, "use Leave instead");
  // A member leaves; their history stays.
  assert.equal((await w.post("Cy", "/leave")).status, 200);
  assert.equal((await call(w.env, w.G, { cookie: w.g.cookies.Cy })).status, 404);
  assert.deepEqual((await w.detail("Bea")).members.map(m => m.name), ["Alex Admin", "Bea"]);
  assert.equal((await call(w.env, w.G + "/expenses", { cookie: w.g.cookies.Bea })).data.expenses[0].paidByName, "Cy");
});

test("people waiting to join are approved or turned away by a group admin", async t => {
  const w = await world(t);
  const dee = await signUp(w.env, "Dee");
  // A join request (the shape later added by invite links and QR codes).
  w.raw.prepare("INSERT INTO appx_group_members(group_id,member_id,name,role,status) VALUES(?,?,?,'member','pending')").run(w.g.groupId, dee.id, "Dee");
  assert.equal((await call(w.env, w.G, { cookie: dee.cookie })).status, 404);
  assert.equal((await w.post("Bea", `/members/${dee.id}/approve`)).status, 403);
  assert.equal((await w.post("admin", `/members/${w.g.ids.Bea}/approve`)).status, 409, "not waiting");
  assert.equal((await w.post("admin", `/members/${dee.id}/approve`)).status, 200);
  // In, but opening it still needs the group's PIN.
  assert.equal((await call(w.env, w.G, { cookie: dee.cookie })).status, 423);
  await unlockGroup(w.env, w.g.groupId, dee.cookie);
  assert.equal((await call(w.env, w.G, { cookie: dee.cookie })).status, 200);
  assert.equal((await call(w.env, "/api/notifications", { cookie: dee.cookie })).data.items[0].title, "You're in “Goa Trip”");
  // Inviting someone who asked to join lets them straight in.
  const eve = await signUp(w.env, "Eve");
  w.raw.prepare("INSERT INTO appx_group_members(group_id,member_id,name,role,status) VALUES(?,?,?,'member','pending')").run(w.g.groupId, eve.id, "Eve");
  assert.equal((await w.post("admin", "/members/invite", { login: eve.username })).data.status, "active");
  // Rejecting.
  const fay = await signUp(w.env, "Fay");
  w.raw.prepare("INSERT INTO appx_group_members(group_id,member_id,name,role,status) VALUES(?,?,?,'member','pending')").run(w.g.groupId, fay.id, "Fay");
  assert.equal((await w.post("admin", `/members/${fay.id}/reject`)).status, 200);
  assert.equal((await call(w.env, w.G, { cookie: fay.cookie })).status, 404);
});

test("a group's PIN is asked when opening it, remembered for a day on that device, and can be changed by an admin", async t => {
  const w = await world(t);
  const { ids } = w.g;
  // A new sign-in (another device) finds the group locked; nothing inside is readable or writable.
  const phone = (await call(w.env, "/api/auth/signin", { method: "POST", body: { login: w.g.usernames.Bea, password: "secret2468" } })).cookie;
  const locked = await call(w.env, w.G + "/expenses", { cookie: phone });
  assert.deepEqual([locked.status, locked.data.code, locked.data.groupName], [423, "group_locked", "Goa Trip"]);
  for (const [method, tail] of [["GET", ""], ["GET", "/balances"], ["GET", "/settlements"], ["POST", "/expenses"], ["POST", "/settlements"], ["POST", "/leave"]]) {
    assert.equal((await call(w.env, w.G + tail, { method, cookie: phone, body: method === "POST" ? {} : undefined })).status, 423, tail);
  }
  assert.deepEqual((await call(w.env, "/api/groups", { cookie: phone })).data.groups.map(x => [x.name, x.hasPin, x.unlocked]), [["Goa Trip", true, false]]);
  // Wrong PINs, then a lock-out for that group.
  assert.equal((await call(w.env, w.G + "/unlock", { method: "POST", cookie: phone, body: { pin: "12" } })).status, 400);
  for (let i = 0; i < 4; i++) assert.equal((await call(w.env, w.G + "/unlock", { method: "POST", cookie: phone, body: { pin: "0000" } })).status, 401);
  await unlockGroup(w.env, w.g.groupId, phone);
  assert.equal((await call(w.env, w.G + "/expenses", { cookie: phone })).status, 200);
  assert.equal((await call(w.env, w.G + "/unlock", { method: "POST", cookie: phone, body: { pin: "0000" } })).status, 401, "the 5th wrong PIN");
  assert.equal((await call(w.env, w.G + "/unlock", { method: "POST", cookie: phone, body: { pin: "1357" } })).status, 429, "then 15 minutes, even with the right PIN");
  assert.equal((await call(w.env, "/api/groups", { cookie: phone })).data.groups[0].unlocked, true);
  // Remembered for a day, then asked again.
  w.raw.prepare("UPDATE appx_group_unlocks SET until=? WHERE group_id=?").run(Date.now() - 1, w.g.groupId);
  assert.equal((await call(w.env, w.G, { cookie: phone })).status, 423);
  assert.equal((await call(w.env, w.G, { cookie: w.g.adminCookie })).status, 423, "for everyone, admins too");
  await unlockGroup(w.env, w.g.groupId, w.g.adminCookie);
  // Only admins change it; everyone else then needs the new PIN, and is told.
  assert.equal((await call(w.env, w.G + "/pin", { method: "POST", cookie: w.g.cookies.Cy, body: { pin: "9999" } })).status, 423, "locked for Cy right now");
  await unlockGroup(w.env, w.g.groupId, w.g.cookies.Cy);
  assert.equal((await call(w.env, w.G + "/pin", { method: "POST", cookie: w.g.cookies.Cy, body: { pin: "9999" } })).status, 403);
  assert.equal((await call(w.env, w.G + "/pin", { method: "POST", cookie: w.g.adminCookie, body: { pin: "99" } })).status, 400);
  assert.equal((await call(w.env, w.G + "/pin", { method: "POST", cookie: w.g.adminCookie, body: { pin: "9999" } })).status, 200);
  assert.equal((await call(w.env, w.G, { cookie: w.g.adminCookie })).status, 200, "the admin who changed it stays in");
  assert.equal((await call(w.env, w.G, { cookie: w.g.cookies.Cy })).status, 423);
  assert.equal((await call(w.env, "/api/notifications", { cookie: w.g.cookies.Cy })).data.items[0].kind, "group_pin");
  assert.equal((await call(w.env, w.G + "/unlock", { method: "POST", cookie: w.g.cookies.Cy, body: { pin: GROUP_PIN } })).status, 401, "the old PIN no longer works");
  await unlockGroup(w.env, w.g.groupId, w.g.cookies.Cy, "9999");
  // Signing out forgets what this device had open.
  await call(w.env, "/api/logout", { method: "POST", cookie: w.g.cookies.Cy, body: {} });
  assert.equal(w.raw.prepare("SELECT COUNT(*) AS n FROM appx_group_unlocks WHERE group_id=? AND session_hash NOT IN (SELECT token_hash FROM appx_user_sessions)").get(w.g.groupId).n, 0);
  assert.ok(ids.Cy);
});

test("groups from before group PINs open freely until an admin sets one", async t => {
  const w = await world(t);
  w.raw.prepare("UPDATE appx_groups SET pin_hash=NULL WHERE id=?").run(w.g.groupId);
  const phone = (await call(w.env, "/api/auth/signin", { method: "POST", body: { login: w.g.usernames.Bea, password: "secret2468" } })).cookie;
  assert.equal((await call(w.env, w.G, { cookie: phone })).status, 200);
  assert.deepEqual((await call(w.env, w.G, { cookie: w.g.adminCookie })).data.group.hasPin, false);
  assert.equal((await call(w.env, w.G + "/pin", { method: "POST", cookie: w.g.adminCookie, body: { pin: "2468" } })).status, 200);
  assert.equal((await call(w.env, w.G, { cookie: phone })).status, 423);
  assert.equal((await call(w.env, "/api/notifications", { cookie: phone })).data.items[0].title, "Alex Admin set the PIN of “Goa Trip”");
});
