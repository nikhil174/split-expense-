// Building responses, and the one place errors become responses.
import { ApiError } from "./ApiError.ts";

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

export const fail = (message: string, status = 400): Response => json({ error: message }, status);

// An image stored as base64 (UPI QR, payment screenshot).
export function imageResponse(base64: string, mime: string, headers: Record<string, string>): Response {
  return new Response(Uint8Array.from(atob(base64), c => c.charCodeAt(0)), { headers: { "content-type": mime, ...headers } });
}

// The error handler: an ApiError is answered as such; anything else is a
// server error (details only in development).
export function errorResponse(e: unknown, { development }: { development: boolean }): Response {
  if (e instanceof ApiError) return json({ error: e.message, ...e.extra }, e.status);
  console.error("API error:", String(e));
  return json({ error: "Server error. Check Worker logs.", detail: development ? String(e) : undefined }, 500);
}
