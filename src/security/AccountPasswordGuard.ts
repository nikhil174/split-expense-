// Checking account passwords: lockout after too many wrong tries, and the
// one-time cases for accounts from before passwords.
import { MINUTE, PIN_LOCK_MS, PIN_MAX_FAILURES } from "../config/constants.ts";
import type { AppEnv } from "../config/env.ts";
import type { Untrusted } from "../domain/input.ts";
import { ApiError } from "../http/ApiError.ts";
import type { UserRepository } from "../repository/UserRepository.ts";
import type { UserRow } from "../repository/types.ts";
import type { PasswordHasher } from "./PasswordHasher.ts";
import { secretEquals } from "./crypto.ts";
import { goodPassword, PASSWORD_HINT, passwordOf } from "./passwords.ts";

type PasswordRow = Pick<UserRow, "id" | "pin_hash" | "pin_failures" | "pin_locked_until">;
// A sign-in's password fields (older app versions send the "pin" names).
export type SignInRequest = Untrusted<"password" | "pin" | "newPassword" | "newPin" | "createPassword" | "createPin">;

export class AccountPasswordGuard {
  private readonly env: AppEnv;
  private readonly users: UserRepository;
  private readonly hasher: PasswordHasher;
  constructor(env: AppEnv, users: UserRepository, hasher: PasswordHasher) { this.env = env; this.users = users; this.hasher = hasher; }

  // Checks a person's password against their account, counting failures and
  // locking the account for a while after too many. Throws when it's wrong;
  // returns when it is right (or was just created, for accounts from before
  // PINs, which choose a password now).
  async check(r: PasswordRow, pin: string, { create = false }: { create?: boolean } = {}): Promise<void> {
    const now = Date.now();
    if (r.pin_locked_until && r.pin_locked_until > now) {
      const mins = Math.ceil((r.pin_locked_until - now) / MINUTE);
      throw new ApiError(`Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, 429);
    }
    if (!r.pin_hash) {
      if (!create) throw new ApiError("Choose a password for your account.", 409, { code: "password_not_set" });
      if (!goodPassword(pin)) throw new ApiError(PASSWORD_HINT);
      await this.users.setPasswordIfUnset(r.id, await this.hasher.hash(pin));
      const saved = await this.users.passwordHash(r.id);
      // Someone else set it a moment earlier: theirs wins, so check against it.
      if (await this.hasher.matches(pin, saved?.pin_hash)) return;
      throw new ApiError("Incorrect password.", 401);
    }
    if (await this.hasher.matches(pin, r.pin_hash)) {
      if (r.pin_failures) await this.users.clearFailures(r.id);
      return;
    }
    const failures = Number(r.pin_failures || 0) + 1, locked = failures >= PIN_MAX_FAILURES;
    await this.users.setFailures(r.id, locked ? 0 : failures, locked ? now + PIN_LOCK_MS : null);
    if (locked) throw new ApiError("Too many wrong passwords. Try again in 15 minutes.", 429);
    const left = PIN_MAX_FAILURES - failures;
    throw new ApiError(`Incorrect password. ${left} ${left === 1 ? "try" : "tries"} left.`, 401);
  }

  // Checks a sign-in password, including the one-time cases for accounts from
  // before this version: the old administrator proves who they are with the old
  // admin PIN and then chooses a password; members without a PIN choose one.
  async checkSignIn(user: UserRow, b: SignInRequest): Promise<void> {
    const password = passwordOf(b);
    if (!user.pin_hash && user.id === "admin") {
      if (!this.env.ADMIN_PIN || !await secretEquals(password, String(this.env.ADMIN_PIN))) throw new ApiError("Incorrect password.", 401);
      const next = passwordOf(b, "newPassword");
      if (!goodPassword(next)) throw new ApiError("Choose a password for your account. You'll use it from now on instead of the admin PIN. " + PASSWORD_HINT, 409, { code: "choose_password" });
      await this.users.setAdminPasswordIfUnset(await this.hasher.hash(next));
      return;
    }
    // Accounts made with Google have no password until they add one in Profile;
    // only accounts from before PINs may choose one at sign-in.
    if (!user.pin_hash && !user.legacy) throw new ApiError("This account signs in with Google. Tap Continue with Google; you can add a password in your profile.", 409, { code: "use_google" });
    if (!password) throw new ApiError("Enter your password.");
    await this.check(user, password, { create: b?.createPassword === true || b?.createPin === true });
  }
}
