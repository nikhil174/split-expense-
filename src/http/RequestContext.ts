// One API request: the raw request, its URL, the environment, and what it
// produces besides the response (notifications to push to phones).
import { MAX_BODY_BYTES } from "../config/constants.ts";
import { databaseOf, type AppEnv } from "../config/env.ts";
import type { PushNote } from "../integration/push.ts";
import { sha256Hex } from "../security/crypto.ts";
import { ApiError } from "./ApiError.ts";

export class RequestContext {
  readonly req: Request;
  readonly url: URL;
  readonly env: AppEnv;
  readonly db: D1Database;
  readonly method: string;
  readonly path: string;
  // Every notification written during this request; sent to phones once the
  // response is on its way (see index.ts).
  readonly outbox: PushNote[] = [];

  constructor(req: Request, env: AppEnv, url = new URL(req.url)) {
    this.req = req;
    this.url = url;
    this.env = env;
    this.db = databaseOf(env);
    this.method = req.method;
    this.path = url.pathname;
  }

  // The JSON body, read only when a handler needs it (so the size limit
  // applies only then); null when empty or not JSON.
  async body(maxBytes = MAX_BODY_BYTES): Promise<any> {
    if (Number(this.req.headers.get("content-length") || 0) > maxBytes) throw new ApiError("Request body is too large.", 413);
    const text = await this.req.text();
    if (new TextEncoder().encode(text).length > maxBytes) throw new ApiError("Request body is too large.", 413);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  query(name: string): string | null { return this.url.searchParams.get(name); }

  cookie(name: string): string {
    const c = this.req.headers.get("Cookie") || "";
    const m = c.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  // The caller's IP, hashed: the key for per-device rate limits.
  async clientKey(): Promise<string> {
    return (await sha256Hex("ip:" + (this.req.headers.get("CF-Connecting-IP") || "unknown"))).slice(0, 32);
  }
}

export function setCookie(name: string, value: string, maxAgeSeconds: number): string {
  return name + "=" + encodeURIComponent(value) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAgeSeconds;
}
