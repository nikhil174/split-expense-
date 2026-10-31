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

// only: a predicate on file names, to apply some migrations (e.g. the ones
// before a given version, to build a database as it was then).
export async function applyMigrations(raw, only = () => true) {
  for (const file of (await migrationFiles()).filter(only)) raw.exec(await readFile(new URL(file, MIGRATIONS_DIR), "utf8"));
}

export const ADMIN = { name: "Alex Admin", pin: "4821" };
// The old administrator PIN (an env secret), used once by the migrated admin account.
export const OLD_ADMIN_PIN = "test-pin-4821";
// Every test member uses this PIN unless a test says otherwise.
export const MEMBER_PIN = "2468";

export async function makeEnv() {
  const raw = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  await applyMigrations(raw);
  return { raw, env: { "split-expense": new D1Mock(raw), ADMIN_PIN: OLD_ADMIN_PIN, SESSION_SECRET: "test-session-secret", ENVIRONMENT: "development", PIN_HASH_ITERATIONS: "1000" } };
}

// worker: another Worker to call (the frozen pre-accounts one in tests/fixtures).
export async function call(env, path, { method = "GET", body, cookie, headers: extra = {}, raw = false, worker: target = worker } = {}) {
  const headers = new Headers(extra);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const request = new Request("https://test.local" + path, {
    method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const response = await target.fetch(request, env);
  // raw: hand back the Response itself (for non-JSON bodies such as images).
  if (raw) return { status: response.status, response };
  const data = await response.json();
  const setCookie = response.headers.get("set-cookie");
  return { status: response.status, data, cookie: setCookie?.split(";")[0], setCookie };
}

// Records a payment and, if it is waiting for the receiver, has the receiver
// confirm it, so it counts like a completed payment. Returns the record call.
export async function payAndConfirm(env, groupId, g, cookie, body) {
  const res = await call(env, `/api/groups/${groupId}/settlements`, { method: "POST", cookie, body });
  if (res.status === 201 && res.data.status === "pending") {
    const receiver = Object.keys(g.ids).find(name => g.ids[name] === body.toMemberId);
    const ok = await call(env, `/api/groups/${groupId}/settlements/${res.data.id}/confirm`, { method: "POST", cookie: g.cookies[receiver], body: {} });
    if (ok.status !== 200) throw new Error("confirm failed: " + JSON.stringify(ok.data));
  }
  return res;
}

// Creates an account (username from the name, made unique) and returns its
// id, username and session cookie.
export async function signUp(env, name, { pin = MEMBER_PIN, email, username } = {}) {
  let base = username || name.toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
  if (!/^[a-z]/.test(base)) base = "u" + base;
  if (base.length < 3) base = base.padEnd(3, "x");
  for (let n = 0; n < 50; n++) {
    const u = n ? base + n : base;
    const r = await call(env, "/api/auth/signup", { method: "POST", body: { name, username: u, pin, email } });
    if (r.status === 201) return { id: r.data.id, username: u, cookie: r.cookie };
    if (r.status !== 409 || username) throw new Error("signup failed: " + JSON.stringify(r.data));
  }
  throw new Error("no free username for " + name);
}

// Adds an existing account to a group: the admin invites, the person accepts.
export async function joinGroup(env, groupId, adminCookie, who) {
  const inv = await call(env, `/api/groups/${groupId}/members/invite`, { method: "POST", cookie: adminCookie, body: { login: who.username } });
  if (inv.status !== 200) throw new Error("invite failed: " + JSON.stringify(inv.data));
  const ok = await call(env, `/api/groups/${groupId}/invitation/accept`, { method: "POST", cookie: who.cookie, body: {} });
  if (ok.status !== 200) throw new Error("accept failed: " + JSON.stringify(ok.data));
}

// Builds a group whose admin ("admin": Alex Admin) created it, plus the named
// members, each a new account that was invited and accepted. Returns ids and
// cookies keyed by name ("admin" for the group's admin).
export async function setupGroup(env, groupName, memberNames, { adminCookie } = {}) {
  let admin;
  if (adminCookie) admin = { cookie: adminCookie, id: (await call(env, "/api/me", { cookie: adminCookie })).data.user.id };
  else admin = await signUp(env, ADMIN.name, { pin: ADMIN.pin });
  const created = await call(env, "/api/groups", { method: "POST", cookie: admin.cookie, body: { name: groupName } });
  if (created.status !== 201) throw new Error("group create failed: " + JSON.stringify(created.data));
  const groupId = created.data.group.id;
  const ids = { admin: admin.id }, cookies = { admin: admin.cookie }, usernames = {};
  for (const name of memberNames) {
    const who = await signUp(env, name);
    await joinGroup(env, groupId, admin.cookie, who);
    ids[name] = who.id; cookies[name] = who.cookie; usernames[name] = who.username;
  }
  return { groupId, ids, cookies, usernames, adminCookie: admin.cookie };
}
