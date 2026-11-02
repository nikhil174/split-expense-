// Secrets (account passwords and group PINs) are stored only as a salted
// PBKDF2-SHA256 hash. SESSION_SECRET is mixed in as a pepper, so a copy of the
// database alone is not enough to brute-force them (rotating SESSION_SECRET
// therefore invalidates every password and group PIN). The iteration count is
// stored with each hash, so it can be raised later without breaking old ones.
// Account passwords live in appx_users.pin_hash: people from before passwords
// keep their 4-digit PIN as their password.
import { PIN_ITERATIONS } from "../config/constants.ts";
import type { AppEnv } from "../config/env.ts";
import { fromHex, hex } from "./crypto.ts";

export class PasswordHasher {
  private readonly env: AppEnv;
  constructor(env: AppEnv) { this.env = env; }

  private async derive(secret: string, salt: Uint8Array, iterations: number): Promise<string> {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret + "\u0000" + (this.env.SESSION_SECRET || "")), "PBKDF2", false, ["deriveBits"]);
    return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
  }

  async hash(secret: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iterations = Number(this.env.PIN_HASH_ITERATIONS) || PIN_ITERATIONS;
    return `pbkdf2-sha256$${iterations}$${hex(salt)}$${await this.derive(secret, salt, iterations)}`;
  }

  async matches(secret: string, stored: string | null | undefined): Promise<boolean> {
    const [scheme, iterations, salt, expected] = String(stored || "").split("$");
    if (scheme !== "pbkdf2-sha256" || !expected || !(Number(iterations) > 0)) return false;
    const actual = await this.derive(secret, fromHex(salt), Number(iterations));
    let diff = actual.length ^ expected.length;
    for (let i = 0; i < Math.min(actual.length, expected.length); i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  }
}
