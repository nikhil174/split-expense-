// ----- Sign in with Google -----
// The app gets an ID token (a JWT signed by Google) from Google Identity
// Services. We check its RS256 signature against Google's published keys
// and its claims: issued by Google, for our client id (GOOGLE_CLIENT_ID),
// not expired, with a verified email. No client secret is involved.
import { systemClock, type Clock } from "../config/Clock.ts";
import type { AppEnv } from "../config/env.ts";
import { cleanName, normEmail } from "../domain/text.ts";
import { ApiError } from "../http/ApiError.ts";

const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";
type GoogleKey = { kid: string; n: string; e: string };
// Google's keys, cached across requests in this Worker instance.
let googleKeys: { at: number; maxAge: number; keys: GoogleKey[] } = { at: 0, maxAge: 0, keys: [] };

async function googleKey(kid: string, clock: Clock): Promise<GoogleKey | null> {
  const fresh = clock.now() - googleKeys.at < googleKeys.maxAge * 1000;
  if (!fresh || !googleKeys.keys.some(k => k.kid === kid)) {
    const res = await fetch(GOOGLE_CERTS);
    if (!res.ok) throw new ApiError("Couldn't reach Google. Try again.", 502);
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1] || 3600);
    googleKeys = { at: clock.now(), maxAge: Math.min(maxAge, 6 * 3600), keys: ((await res.json()) as { keys?: GoogleKey[] }).keys || [] };
  }
  return googleKeys.keys.find(k => k.kid === kid) || null;
}
const b64uBytes = (part: string) => Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4)), c => c.charCodeAt(0));

export type GoogleIdentity = { sub: string; email: string; name: string };
// The parts of the token we read (untrusted until the signature checks out).
type TokenHeader = { alg?: unknown; kid?: unknown };
type TokenClaims = { iss?: unknown; aud?: unknown; exp?: unknown; sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown; given_name?: unknown };
const GOOGLE_ISSUERS: readonly unknown[] = ["accounts.google.com", "https://accounts.google.com"];

export async function verifyGoogleToken(token: unknown, env: AppEnv, clock: Clock = systemClock): Promise<GoogleIdentity> {
  const bad = () => new ApiError("Google sign-in didn't work. Try again.", 401);
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !env.GOOGLE_CLIENT_ID) throw bad();
  let header: TokenHeader, claims: TokenClaims;
  try { [header, claims] = parts.slice(0, 2).map(x => JSON.parse(new TextDecoder().decode(b64uBytes(x)))); } catch { throw bad(); }
  if (header?.alg !== "RS256" || !header.kid) throw bad();
  const jwk = await googleKey(header.kid as string, clock);
  if (!jwk) throw bad();
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  let valid = false;
  try { valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64uBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1])); } catch { valid = false; }
  if (!valid) throw bad();
  const now = clock.now() / 1000;
  if (!GOOGLE_ISSUERS.includes(claims.iss) || claims.aud !== env.GOOGLE_CLIENT_ID || !(Number(claims.exp) > now - 60) || !claims.sub) throw bad();
  if (!claims.email || claims.email_verified !== true) throw new ApiError("Your Google account's email isn't verified.", 401);
  return { sub: String(claims.sub), email: normEmail(claims.email), name: cleanName(claims.name || claims.given_name || (claims.email as string).split("@")[0]).slice(0, 60) };
}
