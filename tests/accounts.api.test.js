// Accounts: sign-up, sign-in (username or email + password), profile, password changes
// and linking a second account of the same person.
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup, signUp, joinGroup, MEMBER_PIN } from "./helpers/d1.js";

async function world(t) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  // Each sign-up from its own address, so the per-IP sign-up limit doesn't interfere.
  let ip = 0;
  const signup = body => call(env, "/api/auth/signup", { method: "POST", headers: { "CF-Connecting-IP": "198.51.100." + ++ip }, body: { password: "goodpass1", ...body } });
  const signin = (login, password, extra = {}) => call(env, "/api/auth/signin", { method: "POST", body: { login, password, ...extra } });
  const row = id => raw.prepare("SELECT * FROM appx_users WHERE id=?").get(id);
  return { raw, env, signup, signin, row };
}

test("sign-up checks every field; usernames and emails are unique, ignoring case", async t => {
  const w = await world(t);
  for (const [body, error] of [
    [{ name: "B", username: "bea" }, /name/],
    [{ name: "Bea", username: "be" }, /Usernames/],
    [{ name: "Bea", username: "9bea" }, /Usernames/],
    [{ name: "Bea", username: "bea!" }, /Usernames/],
    [{ name: "Bea", username: "bea", email: "not-an-email" }, /email/],
    [{ name: "Bea", username: "bea", password: "short1" }, /at least 8 characters/],
    [{ name: "Bea", username: "bea", password: "onlyletters" }, /letters and numbers/],
    [{ name: "Bea", username: "bea", password: "12345678" }, /letters and numbers/],
    [{ name: "Bea", username: "bea", password: "x1".repeat(65) }, /at least 8 characters/],
  ]) {
    const r = await w.signup(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.data.error, error);
  }
  const bea = await w.signup({ name: " Bea  Rao ", username: "@Bea.Rao", email: "Bea@Example.com" });
  assert.equal(bea.status, 201);
  assert.match(bea.setCookie, /^split_user=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800$/);
  const me = (await call(w.env, "/api/me", { cookie: bea.cookie })).data.user;
  assert.deepEqual(me, { id: bea.data.id, name: "Bea Rao", username: "bea.rao", email: "bea@example.com", legacy: false, hasPin: true, google: false, emailVerified: false });
  assert.equal((await w.signup({ name: "Other", username: "BEA.RAO" })).status, 409);
  const dupEmail = await w.signup({ name: "Other", username: "other", email: "BEA@example.com" });
  assert.deepEqual([dupEmail.status, /email/.test(dupEmail.data.error)], [409, true]);
  // The username check the forms use.
  const check = async u => (await call(w.env, "/api/auth/username?u=" + encodeURIComponent(u))).data;
  assert.deepEqual(await check("Bea.Rao"), { username: "bea.rao", valid: true, available: false });
  assert.deepEqual(await check("cy"), { username: "cy", valid: false, available: false });
  assert.deepEqual(await check("cyrus"), { username: "cyrus", valid: true, available: true });
  // Signed out, /api/me is empty and everything else needs a session.
  assert.deepEqual((await call(w.env, "/api/me")).data, { user: null });
  assert.equal((await call(w.env, "/api/groups")).status, 401);
});

test("passwords are stored only as salted PBKDF2 hashes (100,000 iterations by default)", async t => {
  const w = await world(t);
  const a = await w.signup({ name: "Bea", username: "bea" }), b = await w.signup({ name: "Cy", username: "cy1" });
  const [ha, hb] = [w.row(a.data.id).pin_hash, w.row(b.data.id).pin_hash];
  for (const h of [ha, hb]) assert.match(h, /^pbkdf2-sha256\$1000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.notEqual(ha, hb, "same password, different salt");
  assert.ok(!w.raw.prepare("SELECT group_concat(pin_hash) AS h FROM appx_users").get().h.includes("goodpass1"));
  delete w.env.PIN_HASH_ITERATIONS;
  const c = await w.signup({ name: "Dee", username: "dee" });
  assert.match(w.row(c.data.id).pin_hash, /^pbkdf2-sha256\$100000\$/);
});

test("sign in with username, @username or email + password; wrong passwords count down, then lock", async t => {
  const w = await world(t);
  const bea = await w.signup({ name: "Bea", username: "bea", email: "bea@example.com" });
  for (const login of ["bea", "@BEA", " Bea@Example.com "]) assert.equal((await w.signin(login, "goodpass1")).status, 200, login);
  assert.equal((await w.signin("nobody", "goodpass1")).status, 404);
  assert.equal((await w.signin("bea", "")).status, 400);
  const wrong = await w.signin("bea", "0000");
  assert.deepEqual([wrong.status, wrong.data.error, wrong.cookie], [401, "Incorrect password. 4 tries left.", undefined]);
  assert.equal((await w.signin("bea", "goodpass1")).status, 200, "a right PIN resets the count");
  for (let i = 0; i < 4; i++) assert.equal((await w.signin("bea", "wrongpass9")).status, 401);
  const locked = await w.signin("bea", "wrongpass9");
  assert.equal(locked.status, 429);
  assert.equal((await w.signin("bea", "goodpass1")).status, 429, "even the right PIN while locked");
  w.raw.prepare("UPDATE appx_users SET pin_locked_until=? WHERE id=?").run(Date.now() - 1, bea.data.id);
  assert.equal((await w.signin("bea", "goodpass1")).status, 200);
  // Signing out ends that session only.
  const s1 = await w.signin("bea", "goodpass1"), s2 = await w.signin("bea", "goodpass1");
  assert.equal((await call(w.env, "/api/logout", { method: "POST", cookie: s1.cookie, body: {} })).status, 200);
  assert.equal((await call(w.env, "/api/me", { cookie: s1.cookie })).data.user, null);
  assert.equal((await call(w.env, "/api/me", { cookie: s2.cookie })).data.user.username, "bea");
  // Expired sessions don't work.
  w.raw.prepare("UPDATE appx_user_sessions SET expires_at=?").run(Date.now() - 1);
  assert.equal((await call(w.env, "/api/me", { cookie: s2.cookie })).data.user, null);
});

test("profile: change name (everywhere), username and email; password changes need the current one", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Goa", ["Bea", "Cy"]);
  const other = await setupGroup(env, "Office", [], { adminCookie: g.adminCookie });
  await joinGroup(env, other.groupId, g.adminCookie, { username: g.usernames.Bea, cookie: g.cookies.Bea });
  await call(env, `/api/groups/${g.groupId}/expenses`, { method: "POST", cookie: g.cookies.Bea, body: { description: "Lunch", amount: "100", paidBy: g.ids.Bea, memberIds: [g.ids.Bea, g.ids.Cy] } });
  const profile = body => call(env, "/api/me/profile", { method: "POST", cookie: g.cookies.Bea, body });
  assert.equal((await profile({ username: g.usernames.Cy })).status, 409);
  assert.equal((await profile({ username: "x" })).status, 400);
  assert.equal((await profile({ email: "nope" })).status, 400);
  const r = await profile({ name: "Bea Rao", username: "bearao", email: "bea@x.in" });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.user.name, r.data.user.username, r.data.user.email], ["Bea Rao", "bearao", "bea@x.in"]);
  // The new name shows in both groups and on past expenses.
  for (const gid of [g.groupId, other.groupId]) assert.ok((await call(env, `/api/groups/${gid}`, { cookie: g.cookies.Bea })).data.members.some(m => m.name === "Bea Rao"));
  assert.equal((await call(env, `/api/groups/${g.groupId}/expenses`, { cookie: g.cookies.Cy })).data.expenses[0].paidByName, "Bea Rao");
  assert.equal((await profile({ email: "" })).data.user.email, null, "email can be removed");
  // Password change.
  const pw = body => call(env, "/api/me/password", { method: "POST", cookie: g.cookies.Bea, body });
  assert.equal((await pw({ currentPassword: "wrongpass1", newPassword: "newpass99" })).status, 401);
  assert.equal((await pw({ currentPassword: MEMBER_PIN, newPassword: "1357" })).status, 400, "too weak");
  assert.equal((await pw({ currentPassword: MEMBER_PIN, newPassword: "newpass99" })).status, 200);
  assert.equal((await call(env, "/api/auth/signin", { method: "POST", body: { login: "bearao", password: "newpass99" } })).status, 200);
  assert.equal((await call(env, "/api/auth/signin", { method: "POST", body: { login: "bearao", password: MEMBER_PIN } })).status, 401);
});

// Two accounts of one person in the same group (e.g. from before accounts).
const balancesOf = async (env, gid, cookie) => Object.fromEntries((await call(env, `/api/groups/${gid}/balances`, { cookie })).data.balances.map(b => [b.memberId, b.balanceCents]));
async function twoAccounts(t) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Chennai trip", ["Vicky", "Jagan"]);
  const dup = await signUp(env, "Vicky Phone", { pin: "phone9876" });
  await joinGroup(env, g.groupId, g.adminCookie, dup);
  return { raw, env, g, dup };
}

test("linking a second account moves everything into this one and keeps every balance exact", async t => {
  const { raw, env, g, dup } = await twoAccounts(t);
  const G = `/api/groups/${g.groupId}`, V = g.ids.Vicky;
  const add = body => call(env, G + "/expenses", { method: "POST", cookie: g.adminCookie, body });
  assert.equal((await add({ description: "Biryani", amount: "750", paidBy: g.ids.Jagan, memberIds: [V, g.ids.Jagan, g.ids.admin, dup.id] })).status, 201);
  assert.equal((await add({ description: "Auto", amount: "400", paidBy: dup.id, memberIds: [dup.id, g.ids.admin] })).status, 201);
  // A "payment to myself" between the two accounts and a real one.
  raw.prepare("INSERT INTO appx_settlements(id,group_id,from_member_id,to_member_id,amount_cents,created_by,created_at) VALUES('self',?,?,?,3000,?,5)").run(g.groupId, V, dup.id, V);
  assert.equal((await call(env, G + "/settlements", { method: "POST", cookie: g.adminCookie, body: { fromMemberId: g.ids.admin, toMemberId: dup.id, amount: "10" } })).status, 201);
  await call(env, "/api/payment-method", { method: "POST", cookie: dup.cookie, body: { upiId: "vicky@okaxis" } });
  const before = await balancesOf(env, g.groupId, g.adminCookie);

  const link = body => call(env, "/api/me/link", { method: "POST", cookie: g.cookies.Vicky, body });
  assert.equal((await link({ login: dup.username, password: "wrong0000" })).status, 401);
  assert.equal((await link({ login: g.usernames.Vicky, password: MEMBER_PIN })).status, 409, "not yourself");
  assert.equal((await link({ login: "nobody", password: "phone9876" })).status, 404);
  assert.equal((await link({ login: dup.username, password: "phone9876" })).status, 200);

  const after = await balancesOf(env, g.groupId, g.adminCookie);
  assert.equal(after[V], before[V] + before[dup.id]);
  for (const id of [g.ids.admin, g.ids.Jagan]) assert.equal(after[id], before[id]);
  assert.ok(!(dup.id in after));
  assert.equal(Object.values(after).reduce((a, b) => a + b, 0), 0);
  const biryani = (await call(env, G + "/expenses", { cookie: g.adminCookie })).data.expenses.find(e => e.description === "Biryani");
  assert.deepEqual(biryani.splits.filter(s => s.memberId === V).map(s => s.amountCents), [37500]);
  assert.equal(biryani.splits.reduce((s, x) => s + x.amountCents, 0), 75000);
  // The other account is gone, its session too; its UPI moved over.
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM appx_users WHERE id=?").get(dup.id).n, 0);
  assert.equal((await call(env, "/api/me", { cookie: dup.cookie })).data.user, null);
  assert.equal((await call(env, "/api/payment-method", { cookie: g.cookies.Vicky })).data.method.upiId, "vicky@okaxis");
  assert.equal((await call(env, G, { cookie: g.adminCookie })).data.members.filter(m => m.id === V).length, 1);
});

function rng(seed) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
for (let seed = 1; seed <= 15; seed++) {
  test(`property ${seed}: linking preserves zero-sum balances and everyone else's balance`, async t => {
    const { raw, env, g, dup } = await twoAccounts(t);
    const V = g.ids.Vicky, people = [V, dup.id, g.ids.admin, g.ids.Jagan], rand = rng(seed), pick = a => a[Math.floor(rand() * a.length)];
    for (let i = 0; i < 6; i++) {
      const members = people.filter(() => rand() < 0.6);
      if (!members.length) members.push(pick(people));
      await call(env, `/api/groups/${g.groupId}/expenses`, { method: "POST", cookie: g.adminCookie, body: { description: "e" + i, amount: String(1 + Math.floor(rand() * 9999)), paidBy: pick(people), memberIds: members } });
    }
    const debts = (await call(env, `/api/groups/${g.groupId}/debts`, { cookie: g.adminCookie })).data.debts;
    for (const d of debts.slice(0, 3)) {
      await call(env, `/api/groups/${g.groupId}/settlements`, { method: "POST", cookie: g.adminCookie, body: { fromMemberId: d.fromMemberId, toMemberId: d.toMemberId, amount: (Math.max(1, Math.floor(d.amountCents / 2)) / 100).toFixed(2) } });
    }
    const before = await balancesOf(env, g.groupId, g.adminCookie);
    assert.equal((await call(env, "/api/me/link", { method: "POST", cookie: g.cookies.Vicky, body: { login: dup.username, password: "phone9876" } })).status, 200);
    const after = await balancesOf(env, g.groupId, g.adminCookie);
    assert.equal(after[V] || 0, (before[V] || 0) + (before[dup.id] || 0));
    for (const p of [g.ids.admin, g.ids.Jagan]) assert.equal(after[p] || 0, before[p] || 0);
    assert.equal(Object.values(after).reduce((a, b) => a + b, 0), 0);
    const mismatched = raw.prepare("SELECT e.id FROM appx_expenses e LEFT JOIN appx_splits s ON s.expense_id=e.id GROUP BY e.id HAVING e.amount_cents<>COALESCE(SUM(s.amount_cents),0)").all();
    assert.deepEqual(mismatched, []);
  });
}
