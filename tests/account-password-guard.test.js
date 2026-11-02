// Password checks and lockout (src/security/AccountPasswordGuard.ts), with a
// fake clock and an in-memory account store instead of the database.
import test from "node:test";
import assert from "node:assert/strict";
import { AccountPasswordGuard } from "../src/security/AccountPasswordGuard.ts";
import { PasswordHasher } from "../src/security/PasswordHasher.ts";
import { ApiError } from "../src/http/ApiError.ts";

const env = { SESSION_SECRET: "test", PIN_HASH_ITERATIONS: "1000" };
const MINUTE = 60_000;

async function world() {
  let now = Date.UTC(2026, 0, 1);
  const clock = { now: () => now };
  const hasher = new PasswordHasher(env);
  const row = { id: "u1", pin_hash: await hasher.hash("right1234"), pin_failures: 0, pin_locked_until: null };
  // Just what the guard uses of the account store.
  const users = {
    setFailures: async (_id, failures, lockedUntil) => { row.pin_failures = failures; row.pin_locked_until = lockedUntil; },
    clearFailures: async () => { row.pin_failures = 0; row.pin_locked_until = null; },
  };
  return { guard: new AccountPasswordGuard(env, users, hasher, clock), row, advance: ms => { now += ms; } };
}
const refusal = async promise => { try { await promise; return null; } catch (e) { assert.ok(e instanceof ApiError); return [e.status, e.message]; } };

test("five wrong passwords lock the account for 15 minutes, by the injected clock", async () => {
  const w = await world();
  for (let left = 4; left >= 1; left--) assert.deepEqual(await refusal(w.guard.check(w.row, "wrong999")), [401, `Incorrect password. ${left} ${left === 1 ? "try" : "tries"} left.`]);
  assert.deepEqual(await refusal(w.guard.check(w.row, "wrong999")), [429, "Too many wrong passwords. Try again in 15 minutes."]);
  w.advance(5 * MINUTE);
  assert.deepEqual(await refusal(w.guard.check(w.row, "right1234")), [429, "Too many wrong passwords. Try again in 10 minutes."], "even the right password waits");
  w.advance(9 * MINUTE + 30_000);
  assert.deepEqual(await refusal(w.guard.check(w.row, "right1234")), [429, "Too many wrong passwords. Try again in 1 minute."]);
  w.advance(MINUTE);
  assert.equal(await refusal(w.guard.check(w.row, "right1234")), null, "unlocked after 15 minutes");
});

test("the right password clears earlier failures", async () => {
  const w = await world();
  await refusal(w.guard.check(w.row, "wrong999"));
  assert.equal(w.row.pin_failures, 1);
  assert.equal(await refusal(w.guard.check(w.row, "right1234")), null);
  assert.equal(w.row.pin_failures, 0);
});

test("an account without a password must choose one first", async () => {
  const w = await world();
  assert.deepEqual(await refusal(w.guard.check({ ...w.row, pin_hash: null }, "right1234")), [409, "Choose a password for your account."]);
});
