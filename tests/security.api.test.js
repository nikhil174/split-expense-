import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { makeEnv, call, setupGroup, ADMIN } from "./helpers/d1.js";

test("every group route requires an active session and membership of that group", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const a = await setupGroup(env, "Group A", ["Bea"]);
  const b = await setupGroup(env, "Group B", ["Cy"], { adminCookie: a.adminCookie });
  const routes = [["GET", ""], ["GET", "/dashboard"], ["GET", "/expenses"], ["POST", "/expenses"], ["GET", "/balances"],
    ["GET", "/settlements"], ["GET", "/settlements/mine"], ["POST", "/settlements"], ["GET", "/debts"], ["POST", "/invites"]];
  for (const [method, tail] of routes) {
    const body = method === "POST" ? {} : undefined;
    assert.equal((await call(env, `/api/groups/${a.groupId}${tail}`, { method, body })).status, 401, "anonymous " + tail);
    assert.equal((await call(env, `/api/groups/${a.groupId}${tail}`, { method, body, cookie: "split_session=forged" })).status, 401, "forged " + tail);
    assert.equal((await call(env, `/api/groups/${a.groupId}${tail}`, { method, body, cookie: b.cookies.Cy })).status, 404, "other group " + tail);
  }
  const mine = await call(env, "/api/groups", { cookie: b.cookies.Cy });
  assert.deepEqual(mine.data.groups.map(g => g.name), ["Group B"]);
});

test("every admin route requires the admin session", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const a = await setupGroup(env, "Group A", ["Bea"]);
  const routes = [["GET", "/api/admin/requests"], ["GET", "/api/admin/dashboard"], ["GET", "/api/admin/expenses"], ["GET", "/api/admin/groups"],
    ["POST", "/api/admin/groups"], ["POST", `/api/admin/groups/${a.groupId}/delete`], ["POST", `/api/admin/requests/${a.ids.Bea}/approve`],
    ["POST", `/api/admin/requests/${a.ids.Bea}/revoke`], ["POST", `/api/admin/requests/${a.ids.Bea}/remove`], ["POST", `/api/admin/requests/${a.ids.Bea}/delete`], ["POST", "/api/admin/logout"]];
  for (const [method, path] of routes) {
    const body = method === "POST" ? {} : undefined;
    assert.equal((await call(env, path, { method, body })).status, 401, path);
    assert.equal((await call(env, path, { method, body, cookie: a.cookies.Bea.replace("split_session", "split_admin") })).status, 401, "member token as admin " + path);
  }
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM appx_groups").get().n, 1);
});

test("session cookies are HttpOnly, Secure and SameSite=Lax", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const login = await call(env, "/api/admin/login", { method: "POST", body: ADMIN });
  assert.match(login.setCookie, /^split_admin=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=10800$/);
  const g = await setupGroup(env, "Group A", [], { adminCookie: login.cookie });
  const req = await call(env, "/api/access/request", { method: "POST", body: { name: "Bea", groupId: g.groupId } });
  await call(env, `/api/admin/requests/${req.data.requestId}/approve`, { method: "POST", cookie: login.cookie, body: {} });
  const signin = await call(env, "/api/access/signin", { method: "POST", body: { name: "bea", groupId: g.groupId } });
  assert.match(signin.setCookie, /^split_session=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
});

test("admin login rejects a wrong PIN or name and is rate limited", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  assert.equal((await call(env, "/api/admin/login", { method: "POST", body: ADMIN })).status, 200);
  assert.equal((await call(env, "/api/admin/login", { method: "POST", body: { ...ADMIN, name: "Mallory" } })).status, 401);
  const statuses = [];
  for (let i = 0; i < 10; i++) statuses.push((await call(env, "/api/admin/login", { method: "POST", body: { ...ADMIN, pin: "0000" + i }, headers: { "CF-Connecting-IP": "203.0.113.9" } })).status);
  assert.deepEqual(statuses.slice(0, 9), Array(9).fill(401));
  assert.equal(statuses[9], 401);
  assert.equal((await call(env, "/api/admin/login", { method: "POST", body: ADMIN, headers: { "CF-Connecting-IP": "203.0.113.9" } })).status, 429);
  // A different client is not blocked by that IP's bucket.
  assert.equal((await call(env, "/api/admin/login", { method: "POST", body: ADMIN, headers: { "CF-Connecting-IP": "198.51.100.1" } })).status, 200);
});

test("member sign-in and access requests are rate limited per client", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Group A", []);
  const headers = { "CF-Connecting-IP": "203.0.113.7" };
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await call(env, "/api/access/request", { method: "POST", headers, body: { name: "Person " + i, groupId: g.groupId } })).status);
  assert.deepEqual(statuses, [...Array(10).fill(201), 429]);
  const signins = [];
  for (let i = 0; i < 21; i++) signins.push((await call(env, "/api/access/signin", { method: "POST", headers, body: { name: "Nobody", groupId: g.groupId } })).status);
  assert.deepEqual(signins, [...Array(20).fill(403), 429]);
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
  assert.equal((await call(env, `/api/groups/${g.groupId}/expenses`, { method: "POST", cookie: g.adminCookie, body: { description: "y", amount: "1", paidBy: "admin", memberIds: ["admin"] } })).status, 201);
});

test("no secrets or test credentials are shipped in client code or config", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const toml = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  for (const text of [html, toml]) {
    assert.ok(!/SESSION_SECRET\s*=|ADMIN_PIN\s*=/.test(text));
    assert.ok(!text.includes(ADMIN.pin));
  }
  assert.match(toml, /required = \["ADMIN_PIN", "SESSION_SECRET"\]/);
});
