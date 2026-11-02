// Group PINs: needed to join a group and to open it; opening is remembered
// for a day on that signed-in device (session).
import { GROUP_PIN_TRIES, GROUP_UNLOCK_MS, PIN_RE } from "../config/constants.ts";
import { textField } from "../domain/text.ts";
import { ApiError } from "../http/ApiError.ts";
import type { SessionRepository } from "../repository/SessionRepository.ts";
import type { CurrentUser } from "../repository/types.ts";
import type { PasswordHasher } from "./PasswordHasher.ts";
import type { RateLimiter } from "./RateLimiter.ts";

export class GroupPinGuard {
  private readonly hasher: PasswordHasher;
  private readonly limiter: RateLimiter;
  private readonly sessions: SessionRepository;
  constructor(hasher: PasswordHasher, limiter: RateLimiter, sessions: SessionRepository) { this.hasher = hasher; this.limiter = limiter; this.sessions = sessions; }

  // Checks a group's PIN for this person (5 tries per 15 minutes per group);
  // throws when it's wrong. Only wrong PINs count towards the limit.
  async check(u: CurrentUser, gid: string, pinHash: string, pin: unknown): Promise<void> {
    const failures = await this.limiter.count("group-pin", u.id + ":" + gid, GROUP_PIN_TRIES);
    if (failures >= GROUP_PIN_TRIES.limit) throw new ApiError("Too many wrong group PINs. Try again in 15 minutes.", 429);
    if (!PIN_RE.test(textField(pin))) throw new ApiError("Enter the group's 4-digit PIN.", 400, { code: "group_pin_required" });
    if (await this.hasher.matches(textField(pin), pinHash)) return;
    await this.limiter.limited("group-pin", u.id + ":" + gid, GROUP_PIN_TRIES);
    throw new ApiError("That's not the group's PIN. Ask a group admin for it.", 401);
  }

  // Remembers that this device opened the group (for a day).
  unlockStmt(u: CurrentUser, gid: string) { return this.sessions.unlockStmt(u.tokenHash, gid, Date.now() + GROUP_UNLOCK_MS); }

  async isUnlocked(u: CurrentUser, gid: string): Promise<boolean> {
    return !!(await this.sessions.isUnlocked(u.tokenHash, gid, Date.now()));
  }
}
