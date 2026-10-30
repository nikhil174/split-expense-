// D1-compatible test double backed by node:sqlite, plus request helpers.
// Migrations are applied in the same order Wrangler uses (sorted file names),
// and foreign keys are enforced as they are in Cloudflare D1.
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import worker from "../../src/index.js";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

class D1Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args), success: true }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { changes: Number(r.changes) } }; }
}
export class D1Mock {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const results = statements.map(s => this.db.prepare(s.sql).run(...s.args));
      this.db.exec("COMMIT");
      return results.map(r => ({ success: true, meta: { changes: Number(r.changes) } }));
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

export async function migrationFiles() {
  return (await readdir(MIGRATIONS_DIR)).filter(f => f.endsWith(".sql")).sort();
}

export async function applyMigrations(raw) {
  for (const file of await migrationFiles()) raw.exec(await readFile(new URL(file, MIGRATIONS_DIR), "utf8"));
}

export const ADMIN = { name: "Alex Admin", pin: "test-pin-4821" };
// Every test member uses this PIN unless a test says otherwise.
export const MEMBER_PIN = "2468";

export async function makeEnv() {
  const raw = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  await applyMigrations(raw);
  return { raw, env: { "split-expense": new D1Mock(raw), ADMIN_PIN: ADMIN.pin, SESSION_SECRET: "test-session-secret", ENVIRONMENT: "development", PIN_HASH_ITERATIONS: "1000" } };
}

export async function call(env, path, { method = "GET", body, cookie, headers: extra = {} } = {}) {
  const headers = new Headers(extra);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const request = new Request("https://test.local" + path, {
    method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const response = await worker.fetch(request, env);
  const data = await response.json();
  const setCookie = response.headers.get("set-cookie");
  return { status: response.status, data, cookie: setCookie?.split(";")[0], setCookie };
}

// Builds a group with an admin plus the named members, all approved and
// signed in. Returns ids and cookies keyed by name ("admin" for the admin).
export async function setupGroup(env, groupName, memberNames, { adminCookie } = {}) {
  if (!adminCookie) {
    const login = await call(env, "/api/admin/login", { method: "POST", body: ADMIN });
    if (login.status !== 200) throw new Error("admin login failed: " + JSON.stringify(login.data));
    adminCookie = login.cookie;
  }
  const created = await call(env, "/api/admin/groups", { method: "POST", cookie: adminCookie, body: { name: groupName } });
  if (created.status !== 201) throw new Error("group create failed: " + JSON.stringify(created.data));
  const groupId = created.data.group.id;
  const ids = { admin: "admin" }, cookies = { admin: adminCookie };
  for (const name of memberNames) {
    const requested = await call(env, "/api/access/request", { method: "POST", body: { name, groupId, pin: MEMBER_PIN } });
    if (requested.status !== 201) throw new Error("request failed: " + JSON.stringify(requested.data));
    const approved = await call(env, "/api/admin/requests/" + requested.data.requestId + "/approve", { method: "POST", cookie: adminCookie, body: {} });
    if (approved.status !== 200) throw new Error("approve failed");
    const signin = await call(env, "/api/access/signin", { method: "POST", body: { name, groupId, pin: MEMBER_PIN } });
    if (signin.status !== 200) throw new Error("signin failed: " + JSON.stringify(signin.data));
    ids[name] = requested.data.requestId;
    cookies[name] = signin.cookie;
  }
  return { groupId, ids, cookies, adminCookie };
}
