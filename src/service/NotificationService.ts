// My notifications (the bell) and phones that receive them.
import type { AppNotification } from "../../shared/api-types.ts";
import type { Clock } from "../config/Clock.ts";
import { NOTIFICATION_KEEP_MS } from "../config/constants.ts";
import type { AppEnv } from "../config/env.ts";
import type { Untrusted } from "../domain/input.ts";
import { textField } from "../domain/text.ts";
import { ApiError } from "../http/ApiError.ts";
import { pushEnabled, validSubscription } from "../integration/push.ts";
import type { NotificationRepository } from "../repository/NotificationRepository.ts";
import type { PushSubscriptionRepository } from "../repository/PushSubscriptionRepository.ts";
import type { Transaction } from "../repository/Transaction.ts";
import type { CurrentUser } from "../repository/types.ts";

export class NotificationService {
  private readonly env: AppEnv;
  private readonly tx: Transaction;
  private readonly notifications: NotificationRepository;
  private readonly subscriptions: PushSubscriptionRepository;
  private readonly clock: Clock;
  constructor(deps: { clock: Clock; env: AppEnv; tx: Transaction; notifications: NotificationRepository; subscriptions: PushSubscriptionRepository }) {
    this.clock = deps.clock;
    this.env = deps.env; this.tx = deps.tx; this.notifications = deps.notifications; this.subscriptions = deps.subscriptions;
  }

  // Newest first, with how many are unread. Ones older than 90 days are
  // cleared as they are read.
  async list(u: CurrentUser): Promise<{ items: AppNotification[]; unread: number }> {
    await this.notifications.deleteOlderThan(u.id, this.clock.now() - NOTIFICATION_KEEP_MS);
    const [rows, unread] = await Promise.all([this.notifications.list(u.id), this.notifications.unreadCount(u.id)]);
    return { items: rows.results, unread: Number(unread?.n || 0) };
  }

  async markAllRead(u: CurrentUser) {
    await this.notifications.markAllRead(u.id, this.clock.now());
    return { ok: true, unread: 0 };
  }

  // The public key browsers subscribe with (null when push is not set up).
  pushKey() { return { publicKey: pushEnabled(this.env) ? this.env.VAPID_PUBLIC_KEY : null }; }

  // Saves this browser's subscription (body read only when push is set up).
  async subscribe(u: CurrentUser, body: () => Promise<unknown>) {
    if (!pushEnabled(this.env)) throw new ApiError("Phone notifications are not set up on this server yet.", 503);
    const sub = validSubscription(await body());
    if (!sub) throw new ApiError("That browser subscription is not valid.");
    await this.tx.run(this.subscriptions.saveStmts(u.id, sub, this.clock.now()));
    return { ok: true };
  }

  async unsubscribe(u: CurrentUser, b: Untrusted<"endpoint">) {
    await this.subscriptions.delete(textField(b?.endpoint), u.id);
    return { ok: true };
  }
}
