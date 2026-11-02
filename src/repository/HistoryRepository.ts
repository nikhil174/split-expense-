// appx_history: the permanent log of changes to expenses and payments.
import type { Clock } from "../config/Clock.ts";
import { newId } from "../security/crypto.ts";
import type { HistoryRow } from "./types.ts";

export type HistoryEntryInput = {
  gid: string; entity: "expense" | "payment"; entityId: string; action: "created" | "edited" | "deleted" | "cancelled";
  actor: string; before?: unknown; after?: unknown;
};

export class HistoryRepository {
  private readonly db: D1Database;
  private readonly clock: Clock;
  constructor(db: D1Database, clock: Clock) { this.db = db; this.clock = clock; }

  // An entry, as a statement to put in the same batch as the change itself.
  insertStmt({ gid, entity, entityId, action, actor, before = null, after = null }: HistoryEntryInput) {
    return this.db.prepare("INSERT INTO appx_history(id,group_id,entity,entity_id,action,actor_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(newId(), gid, entity, entityId, action, actor, before && JSON.stringify(before), after && JSON.stringify(after), this.clock.now());
  }
  async forExpense(gid: string, eid: string): Promise<HistoryRow[]> {
    return (await this.db.prepare("SELECT * FROM appx_history WHERE group_id=? AND entity='expense' AND entity_id=? ORDER BY created_at DESC, rowid DESC LIMIT 100").bind(gid, eid).all<HistoryRow>()).results;
  }
  async forGroup(gid: string): Promise<HistoryRow[]> {
    return (await this.db.prepare("SELECT * FROM appx_history WHERE group_id=? ORDER BY created_at DESC, rowid DESC LIMIT 200").bind(gid).all<HistoryRow>()).results;
  }
}
