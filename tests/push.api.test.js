import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeEnv, call, setupGroup } from "./helpers/d1.js";

const b64u = buf => Buffer.from(buf).toString("base64url");

// A VAPID key pair, as `web-push generate-vapid-keys` would make.
function vapidKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  return { publicKeyObject: publicKey, VAPID_PUBLIC_KEY: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")])), VAPID_PRIVATE_KEY: jwk.d };
}
// A browser's push subscription (its own key pair and auth secret).
function browser(endpoint = "https://fcm.googleapis.com/fcm/send/abc123") {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, sub: { endpoint, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } } };
}
// What the browser does with a push body (RFC 8291 / RFC 8188), using Node's crypto.
function decrypt(body, { ecdh, auth }) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), cipher = body.subarray(21 + idlen);
  const shared = ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, "single final record");
  return JSON.parse(plain.subarray(0, -1).toString());
}

async function fixture(t, { push = true } = {}) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  const keys = vapidKeys();
  if (push) Object.assign(env, { VAPID_PUBLIC_KEY: keys.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: keys.VAPID_PRIVATE_KEY, VAPID_SUBJECT: "mailto:test@example.com" });
  const g = await setupGroup(env, "Goa Trip", ["Bea", "Cy"]);
  // Capture what the Worker sends to push services.
  const sent = [], realFetch = globalThis.fetch;
  let reply = 201;
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), init }); return new Response(null, { status: reply }); };
  t.after(() => { globalThis.fetch = realFetch; });
  const subscribe = (who, sub) => call(env, "/api/push/subscribe", { method: "POST", cookie: g.cookies[who], body: sub });
  const addExpense = () => call(env, `/api/groups/${g.groupId}/expenses`, { method: "POST", cookie: g.cookies.Bea, body: { description: "Dinner", amount: "90", paidBy: g.ids.Bea, memberIds: [g.ids.Bea, g.ids.Cy] } });
  return { raw, env, g, keys, sent, subscribe, addExpense, setReply: s => { reply = s; } };
}

test("a notification reaches the phone: encrypted for that browser and signed with VAPID", async t => {
  const f = await fixture(t);
  assert.equal((await call(f.env, "/api/push/key", { cookie: f.g.cookies.Cy })).data.publicKey, f.keys.VAPID_PUBLIC_KEY);
  const phone = browser();
  assert.equal((await f.subscribe("Cy", phone.sub)).status, 200);
  assert.equal((await f.addExpense()).status, 201);
  assert.equal(f.sent.length, 1, "only Cy's phone (Bea added it)");
  const { url, init } = f.sent[0];
  assert.equal(url, phone.sub.endpoint);
  assert.equal(init.headers["Content-Encoding"], "aes128gcm");
  assert.equal(init.headers.TTL, "86400");
  // The browser can decrypt it and read the same text as the bell.
  assert.deepEqual(decrypt(Buffer.from(init.body), phone), { title: "Bea added “Dinner”", body: "Bea paid ₹90.00 · you owe ₹45.00", link: `#/g/${f.g.groupId}`, tag: "expense_added" });
  // The VAPID header is a valid ES256 JWT for that push service, signed by our key.
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(init.headers.Authorization);
  assert.equal(k, f.keys.VAPID_PUBLIC_KEY);
  const [h, c, sig] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(c, "base64url"));
  assert.deepEqual([JSON.parse(Buffer.from(h, "base64url")).alg, claims.aud, claims.sub], ["ES256", "https://fcm.googleapis.com", "mailto:test@example.com"]);
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600);
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: f.keys.publicKeyObject, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
});

test("devices the push service says are gone are forgotten; unsubscribe stops pushes", async t => {
  const f = await fixture(t);
  const a = browser("https://fcm.googleapis.com/fcm/send/one"), b = browser("https://web.push.apple.com/QGx2");
  await f.subscribe("Cy", a.sub);
  await f.subscribe("Cy", b.sub);
  f.setReply(410);
  await f.addExpense();
  assert.equal(f.sent.length, 2, "both of Cy's devices");
  assert.equal(f.raw.prepare("SELECT COUNT(*) AS n FROM appx_push_subscriptions").get().n, 0, "gone devices removed");
  f.setReply(201);
  await f.subscribe("Cy", a.sub);
  await call(f.env, "/api/push/unsubscribe", { method: "POST", cookie: f.g.cookies.Cy, body: { endpoint: a.sub.endpoint } });
  f.sent.length = 0;
  await f.addExpense();
  assert.equal(f.sent.length, 0);
});

test("only real push services and valid keys are accepted; a device follows whoever signs in on it", async t => {
  const f = await fixture(t);
  const ok = browser();
  for (const bad of [
    { ...ok.sub, endpoint: "https://evil.example.com/push" },
    { ...ok.sub, endpoint: "http://fcm.googleapis.com/fcm/send/x" },
    { ...ok.sub, keys: { ...ok.sub.keys, p256dh: "AAAA" } },
    { ...ok.sub, keys: { ...ok.sub.keys, auth: b64u(crypto.randomBytes(8)) } },
  ]) assert.equal((await f.subscribe("Cy", bad)).status, 400);
  // The same browser, now signed in as Bea, notifies Bea instead of Cy.
  await f.subscribe("Cy", ok.sub);
  await f.subscribe("Bea", ok.sub);
  assert.deepEqual(f.raw.prepare("SELECT member_id FROM appx_push_subscriptions").all().map(r => r.member_id), [f.g.ids.Bea]);
  assert.equal((await call(f.env, "/api/push/subscribe", { method: "POST", body: ok.sub })).status, 401);
});

test("without VAPID secrets push is off: no key, subscribing is refused, nothing is sent", async t => {
  const f = await fixture(t, { push: false });
  assert.equal((await call(f.env, "/api/push/key", { cookie: f.g.cookies.Cy })).data.publicKey, null);
  assert.equal((await f.subscribe("Cy", browser().sub)).status, 503);
  await f.addExpense();
  assert.equal(f.sent.length, 0);
});
