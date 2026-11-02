// Normalizing what people type: names, usernames, emails and logins.

// Trimmed, with runs of spaces collapsed ("  Goa   Trip " → "Goa Trip").
export const cleanName = (value: unknown): string => String(value ?? "").trim().replace(/\s+/g, " ");

// Usernames are stored lowercase without a leading "@" ("@Vicky" → "vicky").
export const normUsername = (value: unknown): string => String(value ?? "").trim().replace(/^@/, "").toLowerCase();

export const normEmail = (value: unknown): string => String(value ?? "").trim().toLowerCase();

// A string field from a request body, or "" for anything else.
export const textField = (value: unknown): string => typeof value === "string" ? value : "";

// Whether a typed login is an email (has "@", not as a "@username" prefix).
export const isEmailLogin = (login: string): boolean => login.includes("@") && !login.startsWith("@");

// "email" or "username", for messages about a login that matched nobody.
export const loginKind = (login: string): "email" | "username" => isEmailLogin(login) ? "email" : "username";
