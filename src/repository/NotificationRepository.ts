// appx_notifications: in-app notifications (the bell).
import type { AppNotification } from "../../shared/api-types.ts";
import type { Clock } from "../config/Clock.ts";
import { newId } from "../security/crypto.ts";

export type NewNotification = { to: string; groupId?: string | null; kind: string; title: string; body?: string | null; link?: string | null; actor?: string | null };

export class NotificationRepository {
  private readonly db: D1Database;
  private readonly clock: Clock;
  constructor(db: D1Database, clock: Clock) { this.db = db; this.clock = clock; }

  insertStmt(n: NewNotification) {
    return this.db.prepare("INSERT INTO appx_notifications(id,recipient_id,group_id,kind,title,body,link,actor_name,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(newId(), n.to, n.groupId ?? null, n.kind, n.title, n.body ?? null, n.link ?? null, n.actor ?? null, this.clock.now());
  }
  deleteOlderThan(uid: string, before: number) { return this.db.prepare("DELETE FROM appx_notifications WHERE recipient_id=? AND created_at<?").bind(uid, before).run(); }
  list(uid: string) {
    return this.db.prepare("SELECT n.id,n.kind,n.title,n.body,n.link,n.actor_name AS actorName,n.created_at AS createdAt,n.read_at AS readAt,n.group_id AS groupId,g.name AS groupName FROM appx_notifications n LEFT JOIN appx_groups g ON g.id=n.group_id WHERE n.recipient_id=? ORDER BY n.created_at DESC LIMIT 100").bind(uid).all<AppNotification>();
  }
  unreadCount(uid: string) { return this.db.prepare("SELECT COUNT(*) AS n FROM appx_notifications WHERE recipient_id=? AND read_at IS NULL").bind(uid).first<{ n: number }>(); }
  markAllRead(uid: string, now: number) { return this.db.prepare("UPDATE appx_notifications SET read_at=? WHERE recipient_id=? AND read_at IS NULL").bind(now, uid).run(); }
}
