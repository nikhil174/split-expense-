// Limits, lifetimes and formats used across the backend.

export const MINUTE = 60 * 1000;
export const DAY = 24 * 60 * MINUTE;

// Signed-in sessions last 7 days; then the password is asked again.
export const SESSION_MS = 7 * DAY;
export const SESSION_COOKIE = "split_user";
// The site owner's Admin tab stays open this long after the admin key.
export const ADMIN_UNLOCK_MS = 12 * 60 * MINUTE;
// Each group's PIN is asked again after a day on a device.
export const GROUP_UNLOCK_MS = DAY;
export const GROUP_PIN_TRIES = { limit: 5, windowMs: 15 * MINUTE };
// Account passwords: 5 wrong tries lock the account for 15 minutes.
export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MS = 15 * MINUTE;
// The maximum PBKDF2 iterations Workers allows.
export const PIN_ITERATIONS = 100000;
// Email links: confirm an email (24 h), reset a password (30 min).
export const EMAIL_LINK_MS: Record<"verify" | "reset", number> = { verify: 24 * 60 * MINUTE, reset: 30 * MINUTE };
// Notifications are kept 90 days.
export const NOTIFICATION_KEEP_MS = 90 * DAY;

export const MAX_BODY_BYTES = 16 * 1024;
// Requests that may carry an image (UPI QR, payment screenshot).
export const IMAGE_BODY_BYTES = 512 * 1024;
export const QR_MAX_BYTES = 300 * 1024;
export const MAX_SPLIT_MEMBERS = 100;

export type RateLimit = { limit: number; windowMs: number };
export const RATE_LIMITS = {
  signin: { limit: 20, windowMs: 15 * MINUTE },
  adminKey: { limit: 10, windowMs: 15 * MINUTE },
  signup: { limit: 10, windowMs: 60 * MINUTE },
  link: { limit: 10, windowMs: 60 * MINUTE },
  invite: { limit: 40, windowMs: 10 * MINUTE },
  groupWrite: { limit: 20, windowMs: 10 * MINUTE },
  expenseWrite: { limit: 60, windowMs: 10 * MINUTE },
  settlementWrite: { limit: 30, windowMs: 10 * MINUTE },
  paymentMethodWrite: { limit: 20, windowMs: 10 * MINUTE },
  // Per account, per hour: "forgot password" emails and "confirm email" re-sends.
  emailPerAccount: { limit: 3, windowMs: 60 * MINUTE },
} satisfies Record<string, RateLimit>;

// Usernames: 3–30 characters, lowercase letters, digits, "_" and ".",
// starting with a letter. Stored lowercase; "@vicky" and "Vicky" mean "vicky".
export const USERNAME_RE = /^[a-z][a-z0-9_.]{2,29}$/;
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,}$/;
export const PIN_RE = /^\d{4}$/;
export const UPI_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

// Shown for people no longer known in a group.
export const FORMER_MEMBER = "Former member";
