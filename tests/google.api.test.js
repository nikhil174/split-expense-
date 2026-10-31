// Sign in with Google: the Worker checks Google's ID token (an RS256 JWT)
// against Google's published keys. Here a test key pair stands in for
// Google's, and fetch of Google's key URL is answered with its public key.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeEnv, call, signUp } from "./helpers/d1.js";

const CLIENT_ID = "1234-test.apps.googleusercontent.com";
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-kid-" + crypto.randomBytes(4).toString("hex");
const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };
const b64u = v => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
function idToken(claims = {}, { key = privateKey, kid = KID, alg = "RS256" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "g-123", email: "vicky@gmail.com", email_verified: true, name: "Vicky Rao", iat: now, exp: now + 3600, ...claims };
  const unsigned = b64u({ alg, kid, typ: "JWT" }) + "." + b64u(body);
  return unsigned + "." + crypto.sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url");
}

async function world(t, { configured = true } = {}) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  if (configured) env.GOOGLE_CLIENT_ID = CLIENT_ID;
  const realFetch = globalThis.fetch;
  let certFetches = 0;
  globalThis.fetch = async url => {
    if (String(url) === "https://www.googleapis.com/oauth2/v3/certs") { certFetches++; return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "cache-control": "public, max-age=20000" } }); }
    throw new Error("unexpected fetch " + url);
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const google = (credential, cookie) => call(env, cookie ? "/api/me/google" : "/api/auth/google", { method: "POST", cookie, body: { credential } });
  return { raw, env, google, certFetches: () => certFetches };
}

test("without GOOGLE_CLIENT_ID, Google sign-in is off and the button stays hidden", async t => {
  const w = await world(t, { configured: false });
  assert.deepEqual((await call(w.env, "/api/auth/config")).data, { googleClientId: null, emailEnabled: false });
  assert.equal((await w.google(idToken())).status, 503);
});

test("Continue with Google creates an account the first time and signs in to it after", async t => {
  const w = await world(t);
  assert.deepEqual((await call(w.env, "/api/auth/config")).data, { googleClientId: CLIENT_ID, emailEnabled: false });
  const first = await w.google(idToken());
  assert.deepEqual([first.status, first.data.created], [201, true]);
  const me = (await call(w.env, "/api/me", { cookie: first.cookie })).data.user;
  assert.deepEqual([me.name, me.username, me.email, me.google, me.hasPin, me.emailVerified], ["Vicky Rao", "vickyrao", "vicky@gmail.com", true, false, true], "Google emails count as confirmed");
  const again = await w.google(idToken());
  assert.deepEqual([again.status, again.data.id, again.data.created], [200, me.id, false]);
  // No password yet: signing in with the username points them to Google.
  const pw = await call(w.env, "/api/auth/signin", { method: "POST", body: { login: "vickyrao", password: "anything1" } });
  assert.deepEqual([pw.status, pw.data.code], [409, "use_google"]);
  // Another Google person with the same name gets a different username.
  const other = await w.google(idToken({ sub: "g-999", email: "vicky.r@gmail.com" }));
  assert.match((await call(w.env, "/api/me", { cookie: other.cookie })).data.user.username, /^vickyrao_\d{4}$/);
  // They can add a password, then sign in either way.
  assert.equal((await call(w.env, "/api/me/password", { method: "POST", cookie: first.cookie, body: { newPassword: "vicky2026" } })).status, 200);
  assert.equal((await call(w.env, "/api/auth/signin", { method: "POST", body: { login: "vickyrao", password: "vicky2026" } })).status, 200);
  assert.equal(w.certFetches(), 1, "Google's keys are cached");
});

test("forged, expired or wrong-audience tokens are refused", async t => {
  const w = await world(t);
  const { privateKey: otherKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const now = Math.floor(Date.now() / 1000);
  for (const [label, token] of [
    ["signed by someone else", idToken({}, { key: otherKey })],
    ["another app", idToken({ aud: "evil.apps.googleusercontent.com" })],
    ["expired", idToken({ exp: now - 3600 })],
    ["not from Google", idToken({ iss: "https://evil.example" })],
    ["unknown key", idToken({}, { kid: "nope" })],
    ["not RS256", idToken({}, { alg: "HS256" })],
    ["unverified email", idToken({ email_verified: false })],
    ["garbage", "not.a.jwt"],
    ["tampered", idToken().replace(/\.([^.]+)\./, (m, p) => "." + b64u({ ...JSON.parse(Buffer.from(p, "base64url")), sub: "g-admin" }) + ".")],
  ]) {
    const r = await w.google(token);
    assert.equal(r.status, 401, label);
    assert.equal(r.cookie, undefined, label);
  }
  assert.equal(w.raw.prepare("SELECT COUNT(*) AS n FROM appx_users").get().n, 0);
});

test("an email already on a password account isn't taken over; its owner connects Google in Profile", async t => {
  const w = await world(t);
  const vicky = await signUp(w.env, "Vicky", { email: "Vicky@Gmail.com" });
  const r = await w.google(idToken());
  assert.deepEqual([r.status, r.data.code], [409, "email_taken"]);
  assert.equal(r.cookie, undefined);
  // Signed in with her password, she connects Google; then Google signs her in.
  const connected = await w.google(idToken(), vicky.cookie);
  assert.equal(connected.status, 200);
  assert.equal(connected.data.user.google, true);
  const viaGoogle = await w.google(idToken());
  assert.deepEqual([viaGoogle.status, viaGoogle.data.id], [200, vicky.id]);
  // The same Google account can't be connected to a second Split It account.
  const other = await signUp(w.env, "Other");
  assert.equal((await w.google(idToken(), other.cookie)).status, 409);
  // Disconnecting needs a password (she has one), and then Google no longer signs her in.
  assert.equal((await call(w.env, "/api/me/google/disconnect", { method: "POST", cookie: vicky.cookie, body: {} })).status, 200);
  assert.equal((await w.google(idToken())).status, 409);
  // A Google-only account can't disconnect until it has a password.
  const g2 = await w.google(idToken({ sub: "g-777", email: "new@gmail.com", name: "New Person" }));
  assert.equal((await call(w.env, "/api/me/google/disconnect", { method: "POST", cookie: g2.cookie, body: {} })).status, 409);
});
