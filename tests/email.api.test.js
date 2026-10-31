// Email links: confirming an email, and resetting a forgotten password (only
// to a confirmed email). Brevo is replaced by a fake that records emails.
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call, signUp, setupGroup, MEMBER_PIN } from "./helpers/d1.js";

async function world(t, { configured = true } = {}) {
  const { raw, env } = await makeEnv();
  t.after(() => raw.close());
  if (configured) Object.assign(env, { BREVO_API_KEY: "test-brevo-key", EMAIL_FROM: "splitit@example.com" });
  const sent = [], realFetch = globalThis.fetch;
  let reply = 201;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://api.brevo.com/v3/smtp/email") { sent.push({ headers: init.headers, ...JSON.parse(init.body) }); return new Response("{}", { status: reply }); }
    throw new Error("unexpected fetch " + url);
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const linkIn = (mail, kind) => new RegExp(`https://test\\.local/#/${kind}/([\\w-]+)`).exec(mail.htmlContent)?.[1];
  const confirm = async mail => call(env, "/api/auth/verify-email", { method: "POST", body: { token: linkIn(mail, "verify-email") } });
  return { raw, env, sent, linkIn, confirm, setReply: s => { reply = s; } };
}

test("signing up with an email sends a confirm link; confirming marks it confirmed", async t => {
  const w = await world(t);
  const bea = await signUp(w.env, "Bea", { email: "Bea@Mail.com" });
  assert.equal(w.sent.length, 1);
  const mail = w.sent[0];
  assert.deepEqual([mail.to[0].email, mail.sender.email, mail.subject, mail.headers["api-key"]], ["bea@mail.com", "splitit@example.com", "Confirm your email for Split It", "test-brevo-key"]);
  assert.match(mail.textContent, /Confirm my email: https:\/\/test\.local\/#\/verify-email\//);
  assert.equal((await call(w.env, "/api/me", { cookie: bea.cookie })).data.user.emailVerified, false);
  const ok = await w.confirm(mail);
  assert.deepEqual([ok.status, ok.data.email], [200, "bea@mail.com"]);
  assert.equal((await call(w.env, "/api/me", { cookie: bea.cookie })).data.user.emailVerified, true);
  assert.equal((await w.confirm(mail)).status, 410, "works once");
  assert.equal((await call(w.env, "/api/auth/verify-email", { method: "POST", body: { token: "nope" } })).status, 410);
  // Only a hash of the token is stored.
  assert.ok(!w.raw.prepare("SELECT group_concat(token_hash) AS h FROM appx_email_tokens").get().h.includes(w.linkIn(mail, "verify-email")));
});

test("changing the email un-confirms it and sends a new link; old links stop working", async t => {
  const w = await world(t);
  const bea = await signUp(w.env, "Bea", { email: "bea@mail.com" });
  const first = w.sent[0];
  assert.equal((await call(w.env, "/api/me/profile", { method: "POST", cookie: bea.cookie, body: { email: "bea@new.com" } })).status, 200);
  assert.equal(w.sent.length, 2);
  assert.equal(w.sent[1].to[0].email, "bea@new.com");
  assert.equal((await w.confirm(first)).status, 410, "the link for the old email no longer works");
  assert.equal((await w.confirm(w.sent[1])).status, 200);
  // Resend from Profile: refused when already confirmed; rate limited.
  assert.equal((await call(w.env, "/api/me/email/verify", { method: "POST", cookie: bea.cookie, body: {} })).data.alreadyVerified, true);
  const cy = await signUp(w.env, "Cy", { email: "cy@mail.com" });
  const resends = [];
  for (let i = 0; i < 4; i++) resends.push((await call(w.env, "/api/me/email/verify", { method: "POST", cookie: cy.cookie, body: {} })).status);
  assert.deepEqual(resends, [200, 200, 200, 429]);
  // A failing email service is reported when resending.
  const dee = await signUp(w.env, "Dee", { email: "dee@mail.com" });
  w.setReply(500);
  assert.equal((await call(w.env, "/api/me/email/verify", { method: "POST", cookie: dee.cookie, body: {} })).status, 502);
});

test("forgot password: a link only to a confirmed email; it sets a new password and signs out everywhere", async t => {
  const w = await world(t);
  const g = await setupGroup(w.env, "Goa", ["Bea"]);
  await call(w.env, "/api/me/profile", { method: "POST", cookie: g.cookies.Bea, body: { email: "bea@mail.com" } });
  const forgot = login => call(w.env, "/api/auth/forgot", { method: "POST", body: { login } });
  // Not confirmed yet, unknown account, or no email: the same answer, and no email.
  w.sent.length = 0;
  for (const login of [g.usernames.Bea, "nobody", g.usernames.admin]) {
    const r = await forgot(login);
    assert.deepEqual([r.status, /If that account has a confirmed email/.test(r.data.message)], [200, true], login);
  }
  assert.equal(w.sent.length, 0);
  // Once confirmed, a reset link goes out (by username or email).
  await call(w.env, "/api/me/email/verify", { method: "POST", cookie: g.cookies.Bea, body: {} });
  await w.confirm(w.sent.at(-1));
  w.sent.length = 0;
  await forgot("BEA@mail.com");
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].subject, "Reset your Split It password");
  const token = w.linkIn(w.sent[0], "reset");
  assert.deepEqual((await call(w.env, "/api/auth/reset/" + token)).data, { ok: true, username: g.usernames.Bea, name: "Bea" });
  // A newer link replaces it.
  await forgot(g.usernames.Bea);
  assert.equal((await call(w.env, "/api/auth/reset/" + token)).status, 410, "replaced by the newer link");
  const fresh = w.linkIn(w.sent[1], "reset");
  assert.equal((await call(w.env, "/api/auth/reset", { method: "POST", body: { token: fresh, password: "weak" } })).status, 400);
  const done = await call(w.env, "/api/auth/reset", { method: "POST", body: { token: fresh, password: "brandnew99" } });
  assert.equal(done.status, 200);
  assert.ok(done.cookie?.startsWith("split_user="), "signed in with the new password");
  assert.equal((await call(w.env, "/api/me", { cookie: g.cookies.Bea })).data.user, null, "other devices are signed out");
  assert.equal((await call(w.env, "/api/auth/signin", { method: "POST", body: { login: g.usernames.Bea, password: MEMBER_PIN } })).status, 401);
  assert.equal((await call(w.env, "/api/auth/signin", { method: "POST", body: { login: g.usernames.Bea, password: "brandnew99" } })).status, 200);
  assert.equal((await call(w.env, "/api/auth/reset", { method: "POST", body: { token: fresh, password: "another99" } })).status, 410, "works once");
  // Expired links don't work.
  await forgot(g.usernames.Bea);
  const late = w.linkIn(w.sent.at(-1), "reset");
  w.raw.prepare("UPDATE appx_email_tokens SET expires_at=? WHERE purpose='reset'").run(Date.now() - 1);
  assert.equal((await call(w.env, "/api/auth/reset", { method: "POST", body: { token: late, password: "another99" } })).status, 410);
  // At most 3 reset emails per account per hour (the answer stays the same).
  w.sent.length = 0;
  for (let i = 0; i < 4; i++) assert.equal((await forgot(g.usernames.Bea)).status, 200);
  assert.ok(w.sent.length <= 3);
});

test("without Brevo set up, email links are off and nothing else changes", async t => {
  const w = await world(t, { configured: false });
  assert.deepEqual((await call(w.env, "/api/auth/config")).data, { googleClientId: null, emailEnabled: false });
  const bea = await signUp(w.env, "Bea", { email: "bea@mail.com" });
  assert.equal(w.sent.length, 0);
  assert.equal((await call(w.env, "/api/auth/forgot", { method: "POST", body: { login: "bea" } })).status, 503);
  assert.equal((await call(w.env, "/api/me/email/verify", { method: "POST", cookie: bea.cookie, body: {} })).status, 503);
});
