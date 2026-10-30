import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, setupGroup, MEMBER_PIN } from "./helpers/d1.js";

async function fixture(t) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const g = await setupGroup(env, "Goa Trip", ["Bea"]);
  const signin = (name, pin, extra = {}) => call(env, "/api/access/signin", { method: "POST", body: { name, groupId: g.groupId, pin, ...extra } });
  const request = (name, pin) => call(env, "/api/access/request", { method: "POST", body: { name, groupId: g.groupId, pin } });
  const admin = (path, body = {}) => call(env, path, { method: "POST", cookie: g.adminCookie, body });
  const row = id => raw.prepare("SELECT pin_hash,pin_failures,pin_locked_until FROM appx_access_requests WHERE id=?").get(id);
  return { raw, env, g, signin, request, admin, row };
}

test("access requests need a 4-digit PIN, stored only as a salted PBKDF2 hash", async t => {
  const f = await fixture(t);
  for (const pin of [undefined, "", "123", "12345", "12a4", " 1234 x"]) {
    const r = await f.request("Cy", pin);
    assert.equal(r.status, 400, String(pin));
    assert.match(r.data.error, /4-digit PIN/);
  }
  const cy = await f.request("Cy", "2468");
  assert.equal(cy.status, 201);
  const bea = f.row(f.g.ids.Bea), cyRow = f.row(cy.data.requestId);
  for (const h of [bea.pin_hash, cyRow.pin_hash]) assert.match(h, /^pbkdf2-sha256\$1000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  // Same PIN, different salt: the hashes differ and neither contains the PIN.
  assert.notEqual(bea.pin_hash, cyRow.pin_hash);
  assert.ok(!f.raw.prepare("SELECT group_concat(pin_hash) AS h FROM appx_access_requests").get().h.includes("2468$"));
});

test("production hashing uses 100,000 PBKDF2 iterations by default", async t => {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  delete env.PIN_HASH_ITERATIONS;
  const g = await setupGroup(env, "Trip", ["Bea"]);
  assert.match(raw.prepare("SELECT pin_hash FROM appx_access_requests WHERE id=?").get(g.ids.Bea).pin_hash, /^pbkdf2-sha256\$100000\$/);
});

test("sign-in needs the right PIN; wrong PINs count down and then lock the member", async t => {
  const f = await fixture(t);
  assert.equal((await f.signin("Bea", "")).status, 400);
  const wrong = await f.signin("Bea", "0000");
  assert.deepEqual([wrong.status, wrong.data.error], [401, "Incorrect PIN. 4 tries left."]);
  assert.equal(wrong.cookie, undefined, "no session on a wrong PIN");
  // A correct PIN resets the count.
  assert.equal((await f.signin("bea", MEMBER_PIN)).status, 200);
  assert.equal(f.row(f.g.ids.Bea).pin_failures, 0);
  for (let i = 0; i < 4; i++) assert.equal((await f.signin("Bea", "1111")).status, 401);
  const locked = await f.signin("Bea", "1111");
  assert.equal(locked.status, 429);
  assert.match(locked.data.error, /Try again in 15 minutes/);
  // While locked, even the right PIN is refused.
  assert.equal((await f.signin("Bea", MEMBER_PIN)).status, 429);
  // After the lock expires the right PIN works again.
  f.raw.prepare("UPDATE appx_access_requests SET pin_locked_until=? WHERE id=?").run(Date.now() - 1, f.g.ids.Bea);
  assert.equal((await f.signin("Bea", MEMBER_PIN)).status, 200);
});

test("members from before PINs choose one on their next sign-in", async t => {
  const f = await fixture(t);
  f.raw.prepare("UPDATE appx_access_requests SET pin_hash=NULL WHERE id=?").run(f.g.ids.Bea);
  const ask = await f.signin("Bea", "9753");
  assert.deepEqual([ask.status, ask.data.code], [409, "pin_not_set"]);
  assert.equal(f.row(f.g.ids.Bea).pin_hash, null, "nothing saved until they confirm");
  assert.equal((await f.signin("Bea", "9753", { createPin: true })).status, 200);
  assert.match(f.row(f.g.ids.Bea).pin_hash, /^pbkdf2-sha256\$/);
  // From then on that PIN is required, and createPin cannot overwrite it.
  assert.equal((await f.signin("Bea", "1111", { createPin: true })).status, 401);
  assert.equal((await f.signin("Bea", "9753")).status, 200);
});

test("asking for access again under someone's name needs their PIN", async t => {
  const f = await fixture(t);
  await f.admin(`/api/admin/requests/${f.g.ids.Bea}/revoke`);
  const takeover = await f.request("Bea", "0000");
  assert.equal(takeover.status, 401, "cannot re-request someone else's entry");
  assert.equal(f.raw.prepare("SELECT status FROM appx_access_requests WHERE id=?").get(f.g.ids.Bea).status, "revoked");
  const own = await f.request("Bea", MEMBER_PIN);
  assert.deepEqual([own.status, own.data.requestId], [200, f.g.ids.Bea]);
});

test("admin can reset a forgotten PIN: it clears the lock and signs the member out", async t => {
  const f = await fixture(t);
  const path = `/api/admin/requests/${f.g.ids.Bea}/reset-pin`;
  assert.equal((await call(f.env, path, { method: "POST", cookie: f.g.cookies.Bea, body: {} })).status, 401, "admin only");
  for (let i = 0; i < 5; i++) await f.signin("Bea", "1111");
  assert.ok(f.row(f.g.ids.Bea).pin_locked_until > Date.now());
  const list = async () => (await call(f.env, "/api/admin/requests", { cookie: f.g.adminCookie })).data.requests.find(r => r.id === f.g.ids.Bea);
  assert.equal((await list()).hasPin, true);
  assert.equal((await f.admin(path)).status, 200);
  assert.deepEqual({ ...f.row(f.g.ids.Bea) }, { pin_hash: null, pin_failures: 0, pin_locked_until: null });
  assert.equal((await list()).hasPin, false);
  assert.equal((await call(f.env, "/api/me", { cookie: f.g.cookies.Bea })).data.member, null, "existing session ended");
  assert.equal((await f.signin("Bea", "4321")).data.code, "pin_not_set");
  assert.equal((await f.signin("Bea", "4321", { createPin: true })).status, 200);
  assert.equal((await f.admin("/api/admin/requests/nope/reset-pin")).status, 404);
});

test("PIN hashes are peppered with SESSION_SECRET: a copied database alone does not verify", async t => {
  const f = await fixture(t);
  f.env.SESSION_SECRET = "a-different-secret";
  assert.equal((await f.signin("Bea", MEMBER_PIN)).status, 401);
});

test("approval does not expire: approved members sign in with their PIN, no new request to the admin", async t => {
  const f = await fixture(t);
  // Approving no longer sets an expiry.
  assert.equal(f.raw.prepare("SELECT expires_at FROM appx_access_requests WHERE id=?").get(f.g.ids.Bea).expires_at, null);
  // Members approved under the old 3-hour rule, long since lapsed, still get in.
  f.raw.prepare("UPDATE appx_access_requests SET expires_at=? WHERE id=?").run(Date.now() - 30 * 86400000, f.g.ids.Bea);
  assert.equal((await call(f.env, "/api/me", { cookie: f.g.cookies.Bea })).data.member?.name, "Bea", "existing session still valid");
  const again = await f.signin("Bea", MEMBER_PIN);
  assert.equal(again.status, 200);
  assert.equal(f.raw.prepare("SELECT status FROM appx_access_requests WHERE id=?").get(f.g.ids.Bea).status, "approved", "no re-approval request");
  const pending = (await call(f.env, "/api/admin/requests", { cookie: f.g.adminCookie })).data.requests.filter(r => r.status === "pending");
  assert.equal(pending.length, 0);
  // Asking for access again under an approved name just says to sign in.
  const dup = await f.request("Bea", MEMBER_PIN);
  assert.equal(dup.status, 409);
  assert.match(dup.data.error, /Sign in with your PIN/);
  // Revoking still locks them out immediately, sessions included.
  await f.admin(`/api/admin/requests/${f.g.ids.Bea}/revoke`);
  assert.equal((await call(f.env, "/api/me", { cookie: again.cookie })).data.member, null);
  assert.equal((await f.signin("Bea", MEMBER_PIN)).status, 403);
});
