// Migration 0013 (accounts) on data made by the app as it ran before it.
//
// The old Worker (frozen copy in tests/fixtures/legacy) builds a realistic
// database through its own API: an administrator, two groups, approved,
// removed, pending and pre-PIN members, the same person in two groups, equal
// and manual splits, confirmed, pending (with a screenshot) and rejected
// payments, UPI details and notifications. Everything the old app showed is
// recorded, the migration is applied, and the new Worker must show exactly
// the same balances, debts, expenses and payments, and let everyone in.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { D1Mock, applyMigrations, call } from "./helpers/d1.js";
import legacyWorker from "./fixtures/legacy/worker.js";

const OLD_ADMIN_PIN = "old-admin-pin-24680";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function legacyWorld(t) {
  const raw = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  t.after(() => raw.close());
  await applyMigrations(raw, f => f < "0013");
  const env = { "split-expense": new D1Mock(raw), ADMIN_PIN: OLD_ADMIN_PIN, SESSION_SECRET: "test-session-secret", ENVIRONMENT: "development", PIN_HASH_ITERATIONS: "1000" };
  const old = (path, opts = {}) => call(env, path, { ...opts, worker: legacyWorker });
  const ok = async (p, want = [200, 201]) => { const r = await p; assert.ok(want.includes(r.status), JSON.stringify(r.data)); return r; };

  const admin = (await ok(old("/api/admin/login", { method: "POST", body: { name: "Nikhil", pin: OLD_ADMIN_PIN } }))).cookie;
  const group = async name => (await ok(old("/api/admin/groups", { method: "POST", cookie: admin, body: { name } }))).data.group.id;
  const goa = await group("Goa Trip"), office = await group("Office");
  const join = async (gid, name, pin, approve = true) => {
    const id = (await ok(old("/api/access/request", { method: "POST", body: { name, groupId: gid, pin } }))).data.requestId;
    if (!approve) return { id };
    await ok(old(`/api/admin/requests/${id}/approve`, { method: "POST", cookie: admin, body: {} }));
    return { id, cookie: (await ok(old("/api/access/signin", { method: "POST", body: { name, groupId: gid, pin } }))).cookie };
  };
  const vicky = await join(goa, "Vicky", "1111"), jagan = await join(goa, "Jagan", "2222");
  const mosquito = await join(goa, "Cute Mosquito 🦟", "3333"), rahul = await join(goa, "Rahul", "4444");
  const oldTimer = await join(goa, "Old Timer", "5555");
  const pete = await join(goa, "Pending Pete", "6666", false);
  const vickyOffice = await join(office, "Vicky", "7777"), zed = await join(office, "Zed", "8888");
  // Old Timer joined before PINs existed.
  raw.prepare("UPDATE appx_access_requests SET pin_hash=NULL WHERE id=?").run(oldTimer.id);

  const spend = (gid, cookie, body) => ok(old(`/api/groups/${gid}/expenses`, { method: "POST", cookie, body }));
  await spend(goa, admin, { description: "Hotel", amount: "4500", paidBy: "admin", memberIds: ["admin", vicky.id, jagan.id, mosquito.id, rahul.id] });
  await spend(goa, vicky.cookie, { description: "Biryani", amount: "1000.01", paidBy: vicky.id, memberIds: [vicky.id, jagan.id, oldTimer.id] });
  await spend(goa, jagan.cookie, { description: "Scooters", amount: "1200", paidBy: jagan.id, splitMode: "manual", allocations: [{ memberId: jagan.id, amount: "200" }, { memberId: rahul.id, amount: "600" }, { memberId: mosquito.id, amount: "400" }] });
  await spend(office, zed.cookie, { description: "Team lunch", amount: "900", paidBy: zed.id, memberIds: ["admin", zed.id, vickyOffice.id] });
  // Payments: confirmed, pending with a screenshot, rejected.
  const pay = (gid, cookie, body) => ok(old(`/api/groups/${gid}/settlements`, { method: "POST", cookie, body }));
  const done = (await pay(goa, jagan.cookie, { fromMemberId: jagan.id, toMemberId: "admin", amount: "500" })).data.id;
  await ok(old(`/api/groups/${goa}/settlements/${done}/confirm`, { method: "POST", cookie: admin, body: {} }));
  const waiting = (await pay(goa, jagan.cookie, { fromMemberId: jagan.id, toMemberId: vicky.id, amount: "100", proof: "data:image/png;base64," + PNG })).data.id;
  const rejected = (await pay(goa, mosquito.cookie, { fromMemberId: mosquito.id, toMemberId: "admin", amount: "50" })).data.id;
  await ok(old(`/api/groups/${goa}/settlements/${rejected}/reject`, { method: "POST", cookie: admin, body: {} }));
  await ok(old("/api/payment-method", { method: "POST", cookie: vicky.cookie, body: { upiId: "vicky@okaxis", qr: "data:image/png;base64," + PNG } }));
  // Rahul leaves owing money: removed, history kept.
  await ok(old(`/api/admin/requests/${rahul.id}/remove`, { method: "POST", cookie: admin, body: {} }));

  // Everything the old app showed, per group (seen by the admin, who is in both).
  const snapshot = async (get, cookie) => {
    const out = {};
    for (const [name, gid] of [["goa", goa], ["office", office]]) {
      const read = async tail => (await get(`/api/groups/${gid}${tail}`, { cookie })).data;
      const exp = (await read("/expenses")).expenses.map(e => ({ id: e.id, description: e.description, amountCents: e.amountCents, paidBy: e.paidBy, paidByName: e.paidByName, splits: e.splits }));
      const pays = (await read("/settlements")).settlements.map(s => ({ id: s.id, from: s.fromMemberId, to: s.toMemberId, fromName: s.fromName, toName: s.toName, amountCents: s.amountCents, status: s.status, hasProof: s.hasProof }));
      out[name] = { balances: (await read("/balances")).balances, debts: (await read("/debts")).debts.map(d => [d.fromMemberId, d.toMemberId, d.amountCents, d.waitingCents]), expenses: exp, payments: pays, dashboard: await read("/dashboard"),
        active: (await read("")).members.map(m => m.id).sort() };
    }
    return out;
  };
  const before = await snapshot(old, admin);
  const notesBefore = raw.prepare("SELECT recipient_id,COUNT(*) AS n FROM appx_notifications GROUP BY recipient_id ORDER BY recipient_id").all();

  // ----- The migration, exactly as production runs it. -----
  for (const f of ["0013_accounts.sql", "0014_site_admin.sql"]) raw.exec(await readFile(new URL("../migrations/" + f, import.meta.url), "utf8"));
  const now = (path, opts = {}) => call(env, path, opts);
  return { raw, env, now, snapshot, before, notesBefore, goa, office, ids: { vicky: vicky.id, jagan: jagan.id, mosquito: mosquito.id, rahul: rahul.id, oldTimer: oldTimer.id, pete: pete.id, vickyOffice: vickyOffice.id, zed: zed.id }, waiting, rejected };
}

test("after the migration every balance, debt, expense and payment is exactly what the old app showed", async t => {
  const w = await legacyWorld(t);
  // The old administrator signs in once with the old admin PIN and picks a 4-digit PIN.
  const first = await w.now("/api/auth/legacy-signin", { method: "POST", body: { group: "goa trip", name: "nikhil", pin: OLD_ADMIN_PIN } });
  assert.deepEqual([first.status, first.data.code], [409, "choose_pin"]);
  const admin = await w.now("/api/auth/legacy-signin", { method: "POST", body: { group: "Goa Trip", name: "Nikhil", pin: OLD_ADMIN_PIN, newPin: "9090" } });
  assert.equal(admin.status, 200, JSON.stringify(admin.data));
  const me = (await w.now("/api/me", { cookie: admin.cookie })).data.user;
  assert.equal(me.id, "admin");
  assert.equal(me.name, "Nikhil");
  assert.match(me.username, /^nikhil_[0-9a-f]{6}$/);
  assert.equal(me.legacy, true);
  // The old administrator is the site owner (Admin tab, behind the admin key).
  assert.deepEqual([me.siteAdmin, me.adminUnlocked], [true, false]);
  assert.equal((await w.now("/api/site-admin/unlock", { method: "POST", cookie: admin.cookie, body: { key: OLD_ADMIN_PIN } })).status, 200);
  assert.equal((await w.now("/api/site-admin/overview", { cookie: admin.cookie })).data.groups, 2);

  const after = await w.snapshot(w.now, admin.cookie);
  assert.deepEqual(after, w.before);
  // Nothing was lost.
  assert.deepEqual(w.raw.prepare("SELECT recipient_id,COUNT(*) AS n FROM appx_notifications GROUP BY recipient_id ORDER BY recipient_id").all(), w.notesBefore);
  // The admin is an admin of both groups, and sees Pending Pete waiting.
  const goa = (await w.now(`/api/groups/${w.goa}`, { cookie: admin.cookie })).data;
  assert.equal(goa.me.isAdmin, true);
  assert.deepEqual(goa.waiting.map(x => [x.name, x.status]), [["Pending Pete", "pending"]]);
  assert.equal((await w.now("/api/groups", { cookie: admin.cookie })).data.groups.length, 2);

  // From now on the admin signs in like everyone else, with username + new PIN.
  assert.equal((await w.now("/api/auth/signin", { method: "POST", body: { login: me.username, pin: "9090" } })).status, 200);
  assert.equal((await w.now("/api/auth/signin", { method: "POST", body: { login: me.username, pin: OLD_ADMIN_PIN } })).status, 400, "the old admin PIN is done");
});

test("existing members sign in with their group, name and PIN, keep their UPI, payments and notifications", async t => {
  const w = await legacyWorld(t);
  const legacy = (group, name, pin, extra = {}) => w.now("/api/auth/legacy-signin", { method: "POST", body: { group, name, pin, ...extra } });
  assert.equal((await legacy("Goa Trip", "Vicky", "9999")).status, 401, "wrong PIN");
  const vicky = await legacy("Goa Trip", "Vicky", "1111");
  assert.equal(vicky.status, 200);
  const me = (await w.now("/api/me", { cookie: vicky.cookie })).data.user;
  assert.deepEqual([me.id, me.name, me.legacy, me.hasPin], [w.ids.vicky, "Vicky", true, true]);
  assert.match(me.username, /^vicky_[0-9a-f]{6}$/);
  // Her UPI details and notifications are still hers.
  assert.equal((await w.now("/api/payment-method", { cookie: vicky.cookie })).data.method.upiId, "vicky@okaxis");
  assert.ok((await w.now("/api/notifications", { cookie: vicky.cookie })).data.items.length > 0);
  // The payment waiting for her (with its screenshot) can still be confirmed.
  const pending = (await w.now("/api/payments/pending", { cookie: vicky.cookie })).data.toConfirm;
  assert.deepEqual(pending.map(p => [p.id, p.amountCents, p.hasProof]), [[w.waiting, 10000, true]]);
  assert.equal((await w.now(`/api/groups/${w.goa}/settlements/${w.waiting}/proof`, { cookie: vicky.cookie, raw: true })).status, 200);
  assert.equal((await w.now(`/api/groups/${w.goa}/settlements/${w.waiting}/confirm`, { method: "POST", cookie: vicky.cookie, body: {} })).status, 200);
  // She chooses a username; the one-time group sign-in ends and the username works.
  assert.equal((await w.now("/api/me/profile", { method: "POST", cookie: vicky.cookie, body: { username: "vicky" } })).status, 200);
  assert.equal((await legacy("Goa Trip", "Vicky", "1111")).status, 404);
  assert.equal((await w.now("/api/auth/signin", { method: "POST", body: { login: "@Vicky", pin: "1111" } })).status, 200);

  // A name that can't be a username gets "user_…".
  const mosquito = await legacy("Goa Trip", "cute mosquito 🦟", "3333");
  assert.equal(mosquito.status, 200);
  assert.match((await w.now("/api/me", { cookie: mosquito.cookie })).data.user.username, /^user_[0-9a-f]{6}$/);
  // Members from before PINs create one, as before.
  const oldTimer = await legacy("Goa Trip", "Old Timer", "1212");
  assert.deepEqual([oldTimer.status, oldTimer.data.code], [409, "pin_not_set"]);
  assert.equal((await legacy("Goa Trip", "Old Timer", "1212", { createPin: true })).status, 200);
  assert.equal((await legacy("Goa Trip", "Old Timer", "1212")).status, 200);
  // Removed members are out; people still waiting can't get in until approved.
  assert.equal((await legacy("Goa Trip", "Rahul", "4444")).status, 404);
  const pete = await legacy("Goa Trip", "Pending Pete", "6666");
  assert.equal(pete.status, 200);
  assert.equal((await w.now(`/api/groups/${w.goa}`, { cookie: pete.cookie })).status, 404);
  assert.deepEqual((await w.now("/api/groups", { cookie: pete.cookie })).data.groups, []);
  // Every username is unique.
  assert.equal(w.raw.prepare("SELECT COUNT(DISTINCT username) AS n FROM appx_users").get().n, w.raw.prepare("SELECT COUNT(*) AS n FROM appx_users").get().n);
});

test("the same person's two old memberships become one account by linking, with balances unchanged", async t => {
  const w = await legacyWorld(t);
  const vicky = await w.now("/api/auth/legacy-signin", { method: "POST", body: { group: "Goa Trip", name: "Vicky", pin: "1111" } });
  const admin = await w.now("/api/auth/legacy-signin", { method: "POST", body: { group: "Office", name: "Nikhil", pin: OLD_ADMIN_PIN, newPin: "9090" } });
  const officeBalances = async () => Object.fromEntries((await w.now(`/api/groups/${w.office}/balances`, { cookie: admin.cookie })).data.balances.map(b => [b.name, b.balanceCents]));
  const before = await officeBalances();
  assert.equal((await w.now("/api/me/link", { method: "POST", cookie: vicky.cookie, body: { group: "Office", name: "Vicky", pin: "0000" } })).status, 401, "needs that account's PIN");
  const linked = await w.now("/api/me/link", { method: "POST", cookie: vicky.cookie, body: { group: "Office", name: "Vicky", pin: "7777" } });
  assert.equal(linked.status, 200, JSON.stringify(linked.data));
  // One Vicky now sees both groups; Office balances are unchanged.
  assert.deepEqual((await w.now("/api/groups", { cookie: vicky.cookie })).data.groups.map(g => g.name).sort(), ["Goa Trip", "Office"]);
  assert.deepEqual(await officeBalances(), before);
  assert.equal(w.raw.prepare("SELECT COUNT(*) AS n FROM appx_users WHERE id=?").get(w.ids.vickyOffice).n, 0);
  const office = (await w.now(`/api/groups/${w.office}/expenses`, { cookie: vicky.cookie })).data.expenses[0];
  assert.deepEqual(office.splits.find(s => s.name === "Vicky").memberId, w.ids.vicky);
});

test("the migration keeps working for a database with no administrator yet and no members", async t => {
  const raw = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  t.after(() => raw.close());
  await applyMigrations(raw);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM appx_users").get().n, 0);
  const cols = raw.prepare("PRAGMA table_info(appx_group_members)").all().map(c => c.name);
  for (const c of ["role", "status", "joined_at", "invited_by"]) assert.ok(cols.includes(c), c);
});
