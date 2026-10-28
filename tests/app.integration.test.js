import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";

class D1Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() { return this.db.prepare(this.sql).run(...this.args); }
}
class D1Mock {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const results = statements.map(s => this.db.prepare(s.sql).run(...s.args));
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
async function makeEnv() {
  const raw = new DatabaseSync(":memory:");
  for (const path of [
    "migrations/0001_app_tables.sql",
    "migrations/0002_admin_sessions.sql",
    "migrations/0003_app_settings.sql",
  ]) raw.exec(await readFile(new URL("../" + path, import.meta.url), "utf8"));
  return { raw, env: { "split-expense": new D1Mock(raw), ADMIN_PIN: "test-pin-4821", SESSION_SECRET: "test-session-secret", ENVIRONMENT: "development" } };
}
async function call(env, path, { method = "GET", body, cookie } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const request = new Request("https://test.local" + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await worker.fetch(request, env);
  const data = await response.json();
  const setCookie = response.headers.get("set-cookie");
  return { status: response.status, data, cookie: setCookie?.split(";")[0] };
}
test("group creation and repeated expense split changes work end-to-end", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());

  // Admin signs in with both name and PIN, then creates a group.
  const adminLogin = await call(env, "/api/admin/login", {
    method: "POST", body: { name: "Alex Admin", pin: "test-pin-4821" },
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.cookie;
  assert.ok(adminCookie?.startsWith("split_admin="));

  const created = await call(env, "/api/admin/groups", {
    method: "POST", cookie: adminCookie, body: { name: "Chennai Trip" },
  });
  assert.equal(created.status, 201);
  const groupId = created.data.group.id;
  assert.equal(created.data.group.name, "Chennai Trip");

  // A second member requests access; the admin approves them.
  const requested = await call(env, "/api/access/request", {
    method: "POST", body: { name: "Sam Member", groupId },
  });
  assert.equal(requested.status, 201);
  const approved = await call(env, "/api/admin/requests/" + requested.data.requestId + "/approve", {
    method: "POST", cookie: adminCookie, body: {},
  });
  assert.equal(approved.status, 200);

  const memberLogin = await call(env, "/api/access/signin", {
    method: "POST", body: { name: "Sam Member", groupId },
  });
  assert.equal(memberLogin.status, 200);
  const memberCookie = memberLogin.cookie;
  assert.ok(memberCookie?.startsWith("split_session="));

  // First split: ₹100 shared equally by admin and Sam.
  const first = await call(env, "/api/groups/" + groupId + "/expenses", {
    method: "POST", cookie: memberCookie,
    body: { description: "Lunch", amount: 100, paidBy: "admin", memberIds: ["admin", requested.data.requestId] },
  });
  assert.equal(first.status, 201);
  let splits = raw.prepare("SELECT member_id, amount_cents FROM appx_splits WHERE expense_id=? ORDER BY member_id").all(first.data.id);
  assert.deepEqual(splits, [
    { member_id: requested.data.requestId, amount_cents: 5000 },
    { member_id: "admin", amount_cents: 5000 },
  ]);

  // Change the split on the next expense: only Sam is included.
  const second = await call(env, "/api/groups/" + groupId + "/expenses", {
    method: "POST", cookie: memberCookie,
    body: { description: "Taxi", amount: 90, paidBy: requested.data.requestId, memberIds: [requested.data.requestId] },
  });
  assert.equal(second.status, 201);
  splits = raw.prepare("SELECT member_id, amount_cents FROM appx_splits WHERE expense_id=?").all(second.data.id);
  assert.deepEqual(splits, [{ member_id: requested.data.requestId, amount_cents: 9000 }]);

  // Switch back to both members and verify the exact split is recalculated.
  const third = await call(env, "/api/groups/" + groupId + "/expenses", {
    method: "POST", cookie: memberCookie,
    body: { description: "Dinner", amount: 101, paidBy: "admin", memberIds: ["admin", requested.data.requestId] },
  });
  assert.equal(third.status, 201);
  splits = raw.prepare("SELECT member_id, amount_cents FROM appx_splits WHERE expense_id=? ORDER BY member_id").all(third.data.id);
  assert.deepEqual(splits, [
    { member_id: requested.data.requestId, amount_cents: 5050 },
    { member_id: "admin", amount_cents: 5050 },
  ]);

  const expenses = await call(env, "/api/groups/" + groupId + "/expenses", { cookie: memberCookie });
  assert.equal(expenses.status, 200);
  assert.equal(expenses.data.expenses.length, 3);
  const balances = await call(env, "/api/groups/" + groupId + "/balances", { cookie: memberCookie });
  assert.equal(balances.status, 200);
  assert.equal(balances.data.balances.length, 2);
});
