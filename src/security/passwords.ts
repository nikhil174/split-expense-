// The password policy and reading passwords from request bodies.
import { textField } from "../domain/text.ts";

// New passwords: 8–128 characters with at least one letter and one number.
export const PASSWORD_HINT = "Use at least 8 characters, with letters and numbers.";
export const goodPassword = (p: unknown): p is string => typeof p === "string" && p.length >= 8 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p);

// A password field from a request body ("password", "newPassword",
// "currentPassword"), also accepting the older PIN names ("pin", "newPin"…).
export const passwordOf = (b: any, key = "password"): string => textField(b?.[key] ?? b?.[key.replace("assword", "in")]).slice(0, 200);
