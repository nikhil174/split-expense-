// Small cryptographic helpers (WebCrypto only, so they run in Workers).

export const hex = (b: ArrayBuffer | Uint8Array): string => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (s: string): Uint8Array => new Uint8Array((s.match(/../g) || []).map(x => parseInt(x, 16)));

export async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

// Compares two secrets without leaking where they differ.
export async function secretEquals(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex("cmp:" + given), sha256Hex("cmp:" + expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// A new random id (UUID v4).
export const newId = (): string => crypto.randomUUID();

// 16 random bytes, URL-safe: the secret part of an invite link (and, two of
// them, of an email link).
export const newUrlToken = (): string => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
