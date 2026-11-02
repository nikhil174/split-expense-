// Golden-master harness: runs one long scripted tour of the whole API
// (tests/golden/scenario.js) against a Worker, with a fixed clock and fixed
// "random" numbers, and records everything observable: every response
// (status, important headers, body), every email and phone notification the
// Worker sends, and the database's contents at the end.
//
// The recording in tests/golden/transcript.json was made from the Worker
// before it was restructured; tests/golden.api.test.js checks that the
// current Worker still produces exactly the same. When behaviour changes on
// purpose, re-record with `npm run golden:record` and review the diff.
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { D1Mock, applyMigrations } from "../helpers/d1.js";
import { scenario } from "./scenario.js";

const START = Date.UTC(2026, 9, 1, 6, 30); // 1 Oct 2026, 12:00 IST
const b64u = buf => Buffer.from(buf).toString("base64url");

// Deterministic stand-ins for the clock and randomness, restored afterwards.
function freezeWorld() {
  const real = { now: Date.now, uuid: globalThis.crypto.randomUUID, rv: globalThis.crypto.getRandomValues, random: Math.random, fetch: globalThis.fetch, log: console.log, error: console.error };
  let clock = START, uuids = 0, bytes = 0, seed = 42;
  Date.now = () => clock;
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, writable: true, value: () => `00000000-0000-4000-8000-${String(++uuids).padStart(12, "0")}` });
  Object.defineProperty(globalThis.crypto, "getRandomValues", { configurable: true, writable: true, value: arr => {
    const view = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < view.length; i++) view[i] = (++bytes * 131 + 7) & 0xff;
    return arr;
  } });
  Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const logs = [];
  console.log = (...a) => logs.push(["log", a.map(String).join(" ")]);
  console.error = (...a) => { const m = a.map(String).join(" "); if (!m.startsWith("(node:")) logs.push(["error", m]); };
  return {
    logs,
    tick: (ms = 1000) => { clock += ms; },
    restore() {
      Date.now = real.now; Math.random = real.random; globalThis.fetch = real.fetch; console.log = real.log; console.error = real.error;
      delete globalThis.crypto.randomUUID; delete globalThis.crypto.getRandomValues;
      if (globalThis.crypto.randomUUID !== real.uuid) Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, writable: true, value: real.uuid });
      if (globalThis.crypto.getRandomValues !== real.rv) Object.defineProperty(globalThis.crypto, "getRandomValues", { configurable: true, writable: true, value: real.rv });
    },
  };
}

// A phone that turned notifications on: its push subscription and the key to
// read what is sent to it.
// Its keys are derived from the endpoint, so every run stores the same ones.
function phone(endpoint) {
  const seed = crypto.createHash("sha256").update("phone:" + endpoint).digest();
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(seed);
  const auth = crypto.createHash("sha256").update("auth:" + endpoint).digest().subarray(0, 16);
  return { ecdh, auth, sub: { endpoint, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } } };
}
function decryptPush(body, { ecdh, auth }) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), cipher = body.subarray(21 + idlen);
  const shared = ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, -1).toString());
}

// Google's signing key, stood in for by a test key pair.
function googleIssuer(clientId) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "golden-kid", alg: "RS256", use: "sig" };
  const enc = v => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
  return {
    jwk,
    token(claims = {}) {
      const now = Math.floor(Date.now() / 1000);
      const body = { iss: "https://accounts.google.com", aud: clientId, sub: "g-1", email: "g@example.com", email_verified: true, name: "G User", iat: now, exp: now + 3600, ...claims };
      const unsigned = enc({ alg: "RS256", kid: "golden-kid", typ: "JWT" }) + "." + enc(body);
      return unsigned + "." + crypto.sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url");
    },
  };
}

export async function runScenario(worker) {
  const world = freezeWorld();
  const raw = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  try {
    await applyMigrations(raw);
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = privateKey.export({ format: "jwk" });
    const vapidPublic = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]));
    const google = googleIssuer("golden.apps.googleusercontent.com");
    const env = {
      "split-expense": new D1Mock(raw), ADMIN_PIN: "old-admin-key-77", SESSION_SECRET: "golden-secret", ENVIRONMENT: "development", PIN_HASH_ITERATIONS: "1000",
      GOOGLE_CLIENT_ID: "golden.apps.googleusercontent.com", BREVO_API_KEY: "brevo-key", EMAIL_FROM: "splitit@example.com",
      VAPID_PUBLIC_KEY: vapidPublic, VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: "mailto:golden@example.com",
    };
    const phones = new Map();
    const out = [];
    let pushReply = 201;
    // Everything the Worker sends out: emails (Brevo), Google's keys, pushes.
    globalThis.fetch = async (url, init = {}) => {
      url = String(url);
      if (url === "https://www.googleapis.com/oauth2/v3/certs") { out.push({ fetch: "google-certs" }); return new Response(JSON.stringify({ keys: [google.jwk] }), { headers: { "cache-control": "public, max-age=20000" } }); }
      if (url === "https://api.brevo.com/v3/smtp/email") { const m = JSON.parse(init.body); out.push({ email: { to: m.to, sender: m.sender, subject: m.subject, text: m.textContent, html: m.htmlContent, key: init.headers["api-key"] } }); return new Response("{}", { status: 201 }); }
      const p = phones.get(url);
      if (p) {
        const h = init.headers;
        out.push({ push: { to: url, payload: decryptPush(Buffer.from(init.body), p), ttl: h.TTL, encoding: h["Content-Encoding"], urgency: h.Urgency, vapid: /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/.test(h.Authorization) }, status: pushReply });
        return new Response(null, { status: pushReply });
      }
      throw new Error("unexpected fetch " + url);
    };

    const jar = {};
    const transcript = [];
    // One request, recorded. as: whose cookie to send (and keep a new one);
    // keepAs: store a new session cookie under another name.
    async function call(label, method, path, { as, keepAs, body, headers = {}, rawBody, ip = "10.0.0.1", origin, binary } = {}) {
      world.tick(1000);
      const h = new Headers(headers);
      if (as && jar[as]) h.set("cookie", "split_user=" + jar[as]);
      if (ip) h.set("CF-Connecting-IP", ip);
      if (origin) h.set("Origin", origin);
      let payload;
      if (rawBody !== undefined) payload = rawBody;
      else if (body !== undefined) { h.set("content-type", "application/json"); payload = JSON.stringify(body); }
      const res = await worker.fetch(new Request("https://split.test" + path, { method, headers: h, body: payload }), env);
      const type = res.headers.get("content-type") || "";
      let data;
      if (type.startsWith("application/json")) data = await res.json();
      else if (type.startsWith("image/") || binary) { const buf = Buffer.from(await res.arrayBuffer()); data = { bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") }; }
      else data = await res.text();
      const setCookie = res.headers.get("set-cookie");
      const cookie = setCookie?.match(/^split_user=([^;]*)/)?.[1];
      if (cookie !== undefined && (keepAs || as)) jar[keepAs || as] = decodeURIComponent(cookie);
      const keep = ["content-type", "cache-control", "content-disposition", "x-content-type-options", "access-control-allow-origin", "access-control-allow-methods"];
      const shown = Object.fromEntries(keep.filter(k => res.headers.has(k)).map(k => [k, res.headers.get(k)]));
      if (setCookie) shown["set-cookie"] = setCookie;
      // Phone notifications go out in parallel, so their order isn't
      // behaviour: keep emails in order, then the pushes sorted.
      const sent = out.splice(0);
      const pushes = sent.filter(x => x.push).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
      sent.splice(0, sent.length, ...sent.filter(x => !x.push), ...pushes);
      transcript.push({ n: transcript.length + 1, label, method, path, status: res.status, headers: shown, body: data, ...(sent.length ? { sent } : {}) });
      return { status: res.status, data, sent };
    }
    const ctx = {
      call, raw, env, jar, tick: world.tick, google, vapidPublic,
      phone(endpoint) { const p = phone(endpoint); phones.set(endpoint, p); return p.sub; },
      setPushReply(s) { pushReply = s; },
      // Runs the Worker's daily job, as the cron trigger does.
      async cron(label) {
        world.tick(1000);
        await worker.scheduled({ cron: "17 3 * * *", scheduledTime: Date.now() }, env, undefined);
        transcript.push({ n: transcript.length + 1, label, cron: true, logs: world.logs.splice(0) });
      },
      // The link in the newest email of this kind sent to this address.
      lastEmailToken(kind, to) {
        for (let i = transcript.length - 1; i >= 0; i--) for (const s of transcript[i].sent || []) {
          const m = s.email && s.email.to[0].email === to && new RegExp(`/#/${kind}/([\\w-]+)`).exec(s.email.text);
          if (m) return m[1];
        }
        return null;
      },
    };
    await scenario(ctx);
    // The database at the end, every table, rows in a fixed order.
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'appx_%' ORDER BY name").all().map(r => r.name);
    const db = {};
    for (const t of tables) {
      const cols = raw.prepare(`PRAGMA table_info(${t})`).all().length;
      db[t] = raw.prepare(`SELECT * FROM ${t} ORDER BY ${Array.from({ length: cols }, (_, i) => i + 1).join(",")}`).all().map(r => ({ ...r }));
    }
    const logs = world.logs.splice(0);
    return normalize({ transcript, db, logs }, { vapidPublic });
  } finally {
    raw.close();
    world.restore();
  }
}

// The only things that legitimately differ between runs: keys made fresh for
// each run (VAPID public key).
function normalize(value, { vapidPublic }) {
  const walk = v => {
    if (typeof v === "string") return v.split(vapidPublic).join("<vapid-public-key>");
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return JSON.parse(JSON.stringify(walk(value)));
}
