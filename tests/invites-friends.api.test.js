// Invite links / QR (ask to join; an admin approves; the group PIN is still
// needed) and friends (request, accept, suggest a friend for a group).
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup, signUp, GROUP_PIN, unlockGroup } from "./helpers/d1.js";

async function world(t) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Goa Trip", ["Bea", "Cy"]);
  const G = `/api/groups/${g.groupId}`;
  const as = who => g.cookies[who] ?? who;
  const get = (who, path) => call(env, path, { cookie: as(who) });
  const post = (who, path, body = {}) => call(env, path, { method: "POST", cookie: as(who), body });
  return { raw, env, g, G, get, post };
}

test("everyone in the group sees its invite link; admins replace it or turn it off", async t => {
  const w = await world(t);
  const link = (await w.get("Bea", w.G + "/invite-link")).data;
  assert.match(link.code, /^[\w-]{22}$/);
  assert.equal(link.canManage, false);
  assert.equal((await w.get("admin", w.G + "/invite-link")).data.code, link.code, "one link for everyone");
  assert.equal((await w.post("Bea", w.G + "/invite-link/reset")).status, 403);
  const fresh = (await w.post("admin", w.G + "/invite-link/reset")).data.code;
  assert.notEqual(fresh, link.code);
  const dee = await signUp(w.env, "Dee");
  assert.equal((await w.get(dee.cookie, "/api/join/" + link.code)).status, 404, "the old link stops working");
  assert.equal((await w.get(dee.cookie, "/api/join/" + fresh)).status, 200);
  assert.deepEqual((await w.post("admin", w.G + "/invite-link/off")).data, { code: null, canManage: true });
  assert.equal((await w.get(dee.cookie, "/api/join/" + fresh)).status, 404);
  assert.equal((await w.get("Bea", w.G + "/invite-link")).data.code, null, "members can't turn it back on");
  assert.match((await w.get("admin", w.G + "/invite-link")).data.code, /^[\w-]{22}$/, "an admin opening it makes a new one");
  // Outsiders and signed-out people can't read it.
  assert.equal((await w.get(dee.cookie, w.G + "/invite-link")).status, 404);
  assert.equal((await call(w.env, "/api/join/" + fresh)).status, 401);
});

test("opening an invite link: ask to join with the group PIN; an admin lets you in", async t => {
  const w = await world(t);
  const code = (await w.get("Bea", w.G + "/invite-link")).data.code;
  const dee = await signUp(w.env, "Dee");
  assert.deepEqual((await w.get(dee.cookie, "/api/join/" + code)).data, { groupId: w.g.groupId, groupName: "Goa Trip", memberCount: 3, hasPin: true, status: null });
  assert.equal((await w.post(dee.cookie, "/api/join/" + code)).status, 400, "needs the group PIN");
  assert.equal((await w.post(dee.cookie, "/api/join/" + code, { pin: "0000" })).status, 401);
  const asked = await w.post(dee.cookie, "/api/join/" + code, { pin: GROUP_PIN });
  assert.deepEqual([asked.status, asked.data.status], [200, "pending"]);
  assert.equal((await w.post(dee.cookie, "/api/join/" + code, { pin: GROUP_PIN })).status, 409, "already asked");
  assert.equal((await w.get(dee.cookie, "/api/join/" + code)).data.status, "pending");
  // Not in yet; admins see the request and are told.
  assert.equal((await w.get(dee.cookie, w.G)).status, 404);
  const waiting = (await w.get("admin", w.G)).data.waiting;
  assert.deepEqual(waiting.map(x => [x.name, x.status]), [["Dee", "pending"]]);
  assert.equal((await w.get("admin", "/api/notifications")).data.items[0].title, "Dee asked to join “Goa Trip”");
  assert.equal((await w.post("Bea", `${w.G}/members/${dee.id}/approve`)).status, 403);
  assert.equal((await w.post("admin", `${w.G}/members/${dee.id}/approve`)).status, 200);
  // In, and the PIN they entered already opened the group on that device.
  assert.equal((await w.get(dee.cookie, w.G + "/expenses")).status, 200);
  assert.deepEqual((await w.get(dee.cookie, "/api/join/" + code)).data.status, "active");
  assert.equal((await w.post(dee.cookie, "/api/join/" + code, {})).data.status, "active", "already in");
  // Someone already invited joins straight away through the link.
  const eve = await signUp(w.env, "Eve");
  await w.post("admin", w.G + "/members/invite", { login: eve.username });
  assert.equal((await w.post(eve.cookie, "/api/join/" + code, { pin: GROUP_PIN })).data.status, "active");
  // Garbage codes.
  for (const bad of ["nope", "x".repeat(22)]) assert.equal((await w.get(dee.cookie, "/api/join/" + bad)).status, 404);
});

test("friends: ask by username or email, accept or decline, remove; asking back accepts", async t => {
  const w = await world(t);
  const dee = await signUp(w.env, "Dee", { email: "dee@x.in" });
  const list = async who => (await w.get(who, "/api/friends")).data;
  assert.equal((await w.post("Bea", "/api/friends/request", { login: "ghost" })).status, 404);
  assert.equal((await w.post("Bea", "/api/friends/request", { login: w.g.usernames.Bea })).status, 409, "not yourself");
  assert.equal((await w.post("Bea", "/api/friends/request", { login: "DEE@x.in" })).data.status, "requested");
  assert.equal((await w.post("Bea", "/api/friends/request", { login: dee.username })).status, 409, "already asked");
  assert.deepEqual((await list("Bea")).outgoing.map(x => x.name), ["Dee"]);
  assert.deepEqual((await list(dee.cookie)).incoming.map(x => x.name), ["Bea"]);
  assert.equal((await w.get(dee.cookie, "/api/notifications")).data.items[0].kind, "friend_request");
  assert.equal((await w.post("Bea", `/api/friends/${dee.id}/accept`)).status, 409, "can't accept your own request");
  assert.equal((await w.post(dee.cookie, `/api/friends/${w.g.ids.Bea}/accept`)).status, 200);
  assert.deepEqual([(await list("Bea")).friends.map(x => x.name), (await list(dee.cookie)).friends.map(x => x.name)], [["Dee"], ["Bea"]]);
  assert.equal((await w.get("Bea", "/api/notifications")).data.items[0].kind, "friend_accepted");
  assert.equal((await w.post("Bea", "/api/friends/request", { userId: dee.id })).status, 409, "already friends");
  // Declining, and asking back to accept.
  assert.equal((await w.post("Cy", "/api/friends/request", { userId: dee.id })).status, 200);
  assert.equal((await w.post(dee.cookie, `/api/friends/${w.g.ids.Cy}/decline`)).status, 200);
  assert.deepEqual((await list("Cy")).outgoing, []);
  await w.post("Cy", "/api/friends/request", { userId: dee.id });
  assert.equal((await w.post(dee.cookie, "/api/friends/request", { login: w.g.usernames.Cy })).data.status, "friends");
  // Removing.
  assert.equal((await w.post("Bea", `/api/friends/${dee.id}/remove`)).status, 200);
  assert.deepEqual((await list(dee.cookie)).friends.map(x => x.name), ["Cy"]);
  assert.equal((await w.post("Bea", `/api/friends/${dee.id}/remove`)).status, 404);
});

test("in a group: who is my friend; members suggest friends, an admin approves, then the friend accepts", async t => {
  const w = await world(t);
  const dee = await signUp(w.env, "Dee");
  // Bea is friends with Cy (accepted) and has asked the admin.
  await w.post("Bea", "/api/friends/request", { userId: w.g.ids.Cy });
  await w.post("Cy", `/api/friends/${w.g.ids.Bea}/accept`);
  await w.post("Bea", "/api/friends/request", { userId: w.g.ids.admin });
  const members = (await w.get("Bea", w.G)).data.members;
  assert.deepEqual(members.map(m => [m.name, m.friend]), [["Alex Admin", "requested"], ["Bea", null], ["Cy", "friend"]]);
  assert.equal((await w.get("admin", w.G)).data.members.find(m => m.name === "Bea").friend, "asked_you");
  // Bea (not an admin) can't add a stranger, but can suggest a friend.
  assert.equal((await w.post("Bea", w.G + "/members/invite", { login: dee.username })).status, 403);
  await w.post("Bea", "/api/friends/request", { userId: dee.id });
  await w.post(dee.cookie, `/api/friends/${w.g.ids.Bea}/accept`);
  const s = await w.post("Bea", w.G + "/members/invite", { login: dee.username });
  assert.deepEqual([s.status, s.data.status], [200, "suggested"]);
  assert.equal((await w.post("Cy", w.G + "/members/invite", { login: dee.username })).status, 403, "Cy isn't Dee's friend");
  assert.equal((await w.post("Bea", w.G + "/members/invite", { login: dee.username })).status, 409, "already suggested");
  // Dee isn't invited yet; the admin sees who suggested them.
  assert.deepEqual((await w.get(dee.cookie, "/api/invitations")).data.invitations, []);
  const waiting = (await w.get("admin", w.G)).data.waiting;
  assert.deepEqual(waiting.map(x => [x.name, x.status, x.invitedBy]), [["Dee", "suggested", "Bea"]]);
  assert.equal((await w.get("admin", "/api/notifications")).data.items[0].title, "Bea wants to add Dee to “Goa Trip”");
  // The admin approves: Dee is invited, and joins by accepting with the PIN.
  assert.equal((await w.post("admin", `${w.G}/members/${dee.id}/approve`)).data.status, "invited");
  assert.deepEqual((await w.get(dee.cookie, "/api/invitations")).data.invitations.map(i => i.invitedBy), ["Bea"]);
  assert.equal((await w.post(dee.cookie, w.G + "/invitation/accept", { pin: GROUP_PIN })).status, 200);
  assert.ok((await w.get(dee.cookie, w.G)).data.members.some(m => m.name === "Dee"));
  // A rejected suggestion.
  const fay = await signUp(w.env, "Fay");
  await w.post("Bea", "/api/friends/request", { userId: fay.id });
  await w.post(fay.cookie, `/api/friends/${w.g.ids.Bea}/accept`);
  await w.post("Bea", w.G + "/members/invite", { login: fay.username });
  assert.equal((await w.post("admin", `${w.G}/members/${fay.id}/reject`)).data.status, "removed");
  assert.deepEqual((await w.get(fay.cookie, "/api/invitations")).data.invitations, []);
  assert.ok(unlockGroup);
});

test("linking two accounts carries the friends over", async t => {
  const w = await world(t);
  const phone = await signUp(w.env, "Bea Phone", { pin: "phone1234" });
  await w.post(phone.cookie, "/api/friends/request", { userId: w.g.ids.Cy });
  await w.post("Cy", `/api/friends/${phone.id}/accept`);
  await w.post(phone.cookie, "/api/friends/request", { userId: w.g.ids.Bea });
  assert.equal((await w.post("Bea", "/api/me/link", { login: phone.username, password: "phone1234" })).status, 200);
  const bea = (await w.get("Bea", "/api/friends")).data;
  assert.deepEqual([bea.friends.map(x => x.name), bea.incoming, bea.outgoing], [["Cy"], [], []]);
  assert.equal(w.raw.prepare("SELECT COUNT(*) AS n FROM appx_friendships WHERE user_a=? OR user_b=?").get(phone.id, phone.id).n, 0);
});
