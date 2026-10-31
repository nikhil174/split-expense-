// Web Push: sends a notification to every phone/browser a person turned
// notifications on for. Uses only WebCrypto (works in Cloudflare Workers):
//  - VAPID (RFC 8292): an ES256-signed JWT proving the push comes from us,
//    with keys from the Worker secrets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
//    (base64url; generate once with `npx web-push generate-vapid-keys`) and
//    VAPID_SUBJECT (e.g. "mailto:you@example.com").
//  - Message encryption (RFC 8291, aes128gcm): only that browser can read
//    the title/body; the push service just relays bytes.
// Without the secrets, push is simply off and nothing is sent.

const enc = new TextEncoder();
export const b64u = {
  encode: bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  decode: str => Uint8Array.from(atob(String(str).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(str).length + 3) % 4)), c => c.charCodeAt(0)),
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

// Only real push services: the Worker never sends to an arbitrary URL.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|[a-z0-9.-]*\.push\.apple\.com|[a-z0-9.-]*\.notify\.windows\.com)$/i;
export function validSubscription(sub) {
  try {
    const url = new URL(String(sub?.endpoint || ""));
    if (url.protocol !== "https:" || !PUSH_HOSTS.test(url.hostname) || url.href.length > 1000) return null;
    const p256dh = b64u.decode(sub?.keys?.p256dh), auth = b64u.decode(sub?.keys?.auth);
    if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
    return { endpoint: url.href, p256dh: b64u.encode(p256dh), auth: b64u.encode(auth) };
  } catch { return null; }
}

export const pushEnabled = env => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

// RFC 8291 + RFC 8188: one aes128gcm record for this browser's keys.
export async function encryptPayload(payload, p256dhB64, authB64) {
  const uaPublic = b64u.decode(p256dhB64), authSecret = b64u.decode(authB64);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plain = concat(enc.encode(payload), new Uint8Array([2])); // 0x02: last (only) record
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  return concat(header, asPublic, cipher);
}

// RFC 8292: "vapid t=<ES256 JWT>, k=<public key>" for one push service.
let signingKey = null;
export async function vapidAuthorization(endpoint, env, now = Date.now()) {
  if (!signingKey || signingKey.pub !== env.VAPID_PUBLIC_KEY) {
    const pub = b64u.decode(env.VAPID_PUBLIC_KEY);
    const jwk = { kty: "EC", crv: "P-256", d: env.VAPID_PRIVATE_KEY, x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), ext: true };
    signingKey = { pub: env.VAPID_PUBLIC_KEY, key: await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]) };
  }
  const part = obj => b64u.encode(enc.encode(JSON.stringify(obj)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:admin@example.com" })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey.key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64u.encode(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// Sends each notification in `notes` to all of its recipient's devices.
// Devices the push service says are gone (404/410) are forgotten.
export async function sendPushes(env, db, notes) {
  if (!pushEnabled(env) || !notes.length) return;
  const to = [...new Set(notes.map(n => n.to))];
  const subs = (await db.prepare("SELECT endpoint,member_id,p256dh,auth FROM appx_push_subscriptions WHERE member_id IN (" + to.map(() => "?").join(",") + ")").bind(...to).all()).results;
  const gone = [];
  await Promise.all(notes.flatMap(n => subs.filter(s => s.member_id === n.to).map(async s => {
    try {
      const payload = JSON.stringify({ title: n.title, body: n.body || "", link: n.link || "#/", tag: n.kind });
      const res = await fetch(s.endpoint, {
        method: "POST",
        headers: { Authorization: await vapidAuthorization(s.endpoint, env), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "normal" },
        body: await encryptPayload(payload, s.p256dh, s.auth),
      });
      if (res.status === 404 || res.status === 410) gone.push(s.endpoint);
      else if (!res.ok) console.error("push failed", res.status, new URL(s.endpoint).host);
    } catch (e) { console.error("push error", String(e)); }
  })));
  if (gone.length) await db.batch(gone.map(e => db.prepare("DELETE FROM appx_push_subscriptions WHERE endpoint=?").bind(e)));
}
