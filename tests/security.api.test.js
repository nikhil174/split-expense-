import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { makeEnv, call, setupGroup, OLD_ADMIN_PIN } from "./helpers/d1.js";

test("every group route requires an active session and membership of that group", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const a = await setupGroup(env, "Group A", ["Bea"]);
  const b = await setupGroup(env, "Group B", ["Cy"], { adminCookie: a.adminCookie });
  const routes = [["GET", ""], ["GET", "/dashboard"], ["GET", "/expenses"], ["POST", "/expenses"], ["GET", "/balances"],
    ["GET", "/settlements"], ["GET", "/settlements/mine"], ["POST", "/settlements"], ["GET", "/debts"], ["POST", "/members/invite"],
    ["POST", "/rename"], ["POST", "/delete"], ["POST", "/leave"], ["POST", "/members/x/remove"]];
  for (const [method, tail] of routes) {
    const body = method === "POST" ? {} : undefined;
    assert.equal((await call(env, `/api/groups/${a.groupId}${tail}`, { method, body })).status, 401, "anonymous " + tail);
    assert.equal((await call(env, `/api/groups/${a.groupId}${tail}`, { method, body, cookie: "split_user=forged" })).status, 401, "forged " + tail);
    assert.equal((await call(env, `/api/groups/${a.groupId}${tail}`, { method, body, cookie: b.cookies.Cy })).status, 404, "other group " + tail);
  }
  const mine = await call(env, "/api/groups", { cookie: b.cookies.Cy });
  assert.deepEqual(mine.data.groups.map(g => g.name), ["Group B"]);
});

test("every group-admin route needs an admin of that group", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const a = await setupGroup(env, "Group A", ["Bea", "Cy"]);
  const b = await setupGroup(env, "Group B", ["Zed"]);
  const routes = ["/members/invite", "/rename", "/delete", `/members/${a.ids.Cy}/remove`, `/members/${a.ids.Cy}/make-admin`,
    `/members/${a.ids.admin}/make-member`, `/members/${a.ids.Cy}/approve`, `/members/${a.ids.Cy}/reject`, `/members/${a.ids.Cy}/cancel-invite`];
  for (const tail of routes) {
    assert.equal((await call(env, `/api/groups/${a.groupId}${tail}`, { method: "POST", cookie: a.cookies.Bea, body: { login: "zed", name: "Hacked" } })).status, 403, "member " + tail);
    // Being admin of another group gives nothing here.
    assert.equal((await call(env, `/api/groups/${a.groupId}${tail}`, { method: "POST", cookie: b.adminCookie, body: { login: "zed", name: "Hacked" } })).status, 404, "other group's admin " + tail);
  }
  assert.equal(raw.prepare("SELECT name FROM appx_groups WHERE id=?").get(a.groupId).name, "Group A");
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM appx_group_members WHERE group_id=? AND status='active'").get(a.groupId).n, 3);
  // The old global admin and access routes are gone for everyone (an old app is told to reload).
  for (const path of ["/api/admin/login", "/api/admin/requests", "/api/admin/groups", "/api/access/request", "/api/access/signin"]) {
    assert.equal((await call(env, path, { method: "POST", cookie: a.adminCookie, body: { name: "Alex Admin", pin: OLD_ADMIN_PIN } })).status, 410, path);
  }
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM appx_groups").get().n, 2, "nothing was created");
});

test("session cookies are HttpOnly, Secure and SameSite=Lax", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const up = await call(env, "/api/auth/signup", { method: "POST", body: { name: "Bea", username: "bea", pin: "1234" } });
  const signin = await call(env, "/api/auth/signin", { method: "POST", body: { login: "bea", pin: "1234" } });
  for (const c of [up.setCookie, signin.setCookie]) assert.match(c, /^split_user=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/);
  const out = await call(env, "/api/logout", { method: "POST", cookie: signin.cookie, body: {} });
  assert.match(out.setCookie, /^split_user=; .*Max-Age=0$/);
});

test("sign-in, the old group sign-in and sign-up are rate limited per client", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const headers = { "CF-Connecting-IP": "203.0.113.7" };
  const signups = [];
  for (let i = 0; i < 11; i++) signups.push((await call(env, "/api/auth/signup", { method: "POST", headers, body: { name: "Person " + i, username: "person" + i, pin: "1234" } })).status);
  assert.deepEqual(signups, [...Array(10).fill(201), 429]);
  const signins = [];
  for (let i = 0; i < 11; i++) signins.push((await call(env, "/api/auth/signin", { method: "POST", headers, body: { login: "nobody", pin: "1234" } })).status);
  for (let i = 0; i < 10; i++) signins.push((await call(env, "/api/auth/legacy-signin", { method: "POST", headers, body: { group: "G", name: "Nobody", pin: "1234" } })).status);
  assert.deepEqual(signins, [...Array(20).fill(404), 429]);
  // A different client is not blocked by that IP's bucket.
  assert.equal((await call(env, "/api/auth/signin", { method: "POST", headers: { "CF-Connecting-IP": "198.51.100.1" }, body: { login: "person1", pin: "1234" } })).status, 200);
});

test("cross-site writes and oversized bodies are refused", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Group A", ["Bea"]);
  const crossSite = await call(env, `/api/groups/${g.groupId}/expenses`, { method: "POST", cookie: g.cookies.Bea, headers: { Origin: "https://evil.example" }, body: { description: "x", amount: "1", paidBy: g.ids.Bea, memberIds: [g.ids.Bea] } });
  assert.equal(crossSite.status, 403);
  const sameSite = await call(env, `/api/groups/${g.groupId}/expenses`, { method: "POST", cookie: g.cookies.Bea, headers: { Origin: "https://test.local" }, body: { description: "x", amount: "1", paidBy: g.ids.Bea, memberIds: [g.ids.Bea] } });
  assert.equal(sameSite.status, 201);
  const huge = await call(env, `/api/groups/${g.groupId}/expenses`, { method: "POST", cookie: g.cookies.Bea, body: { description: "x".repeat(20000) } });
  assert.equal(huge.status, 413);
  const tooManyMembers = await call(env, `/api/groups/${g.groupId}/expenses`, { method: "POST", cookie: g.cookies.Bea, body: { description: "x", amount: "1", paidBy: g.ids.Bea, memberIds: Array(101).fill(g.ids.Bea) } });
  assert.equal(tooManyMembers.status, 400);
});

test("expense and settlement writes are rate limited per member", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Group A", ["Bea"]);
  let last;
  for (let i = 0; i < 61; i++) last = await call(env, `/api/groups/${g.groupId}/expenses`, { method: "POST", cookie: g.cookies.Bea, body: { description: "x" + i, amount: "1", paidBy: g.ids.Bea, memberIds: [g.ids.Bea] } });
  assert.equal(last.status, 429);
  // The admin's own bucket is separate.
  assert.equal((await call(env, `/api/groups/${g.groupId}/expenses`, { method: "POST", cookie: g.adminCookie, body: { description: "y", amount: "1", paidBy: g.ids.admin, memberIds: [g.ids.admin] } })).status, 201);
});

test("no secrets or test credentials are shipped in client code or config", async () => {
  const web = new URL("../web/", import.meta.url);
  const files = (await readdir(web, { recursive: true })).filter(f => /\.(tsx?|html|css)$/.test(f));
  assert.ok(files.length > 10, "frontend sources found");
  const sources = await Promise.all(files.map(f => readFile(new URL(f, web), "utf8")));
  const toml = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  for (const text of [...sources, toml]) {
    assert.ok(!/SESSION_SECRET\s*=|ADMIN_PIN\s*=/.test(text));
    assert.ok(!text.includes(OLD_ADMIN_PIN));
  }
  assert.match(toml, /required = \["ADMIN_PIN", "SESSION_SECRET"\]/);
});
