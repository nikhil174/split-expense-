// Writing in-app notifications. Each one is an INSERT statement to put in the
// same batch as the change it describes, and is also queued (the request's
// outbox) to be pushed to the person's phones after the response.
import { inrText } from "../domain/money.ts";
import type { ShareRow } from "../domain/split.ts";
import type { PushNote } from "../integration/push.ts";
import type { NewNotification, NotificationRepository } from "../repository/NotificationRepository.ts";
import type { Statement } from "../repository/Transaction.ts";

export type Actor = { id: string; name: string };

export class Notifier {
  private readonly repo: NotificationRepository;
  private readonly outbox: PushNote[];
  constructor(repo: NotificationRepository, outbox: PushNote[]) { this.repo = repo; this.outbox = outbox; }

  stmt(n: NewNotification): Statement {
    this.outbox.push(n as PushNote);
    return this.repo.insertStmt(n);
  }

  // Everyone in an expense (payer and split), told what it means for them.
  // Nobody is told about their own action.
  expenseStmts({ kind, gid, expenseId, actor, desc, cents, paidBy, splitRows, nameOf, alsoTell = [] }: {
    kind: "expense_added" | "expense_edited" | "expense_deleted"; gid: string; expenseId?: string; actor: Actor; desc: string; cents: number; paidBy: string;
    splitRows: ShareRow[]; nameOf: (id: string) => string; alsoTell?: string[];
  }): Statement[] {
    const verb = { expense_added: "added", expense_edited: "changed", expense_deleted: "deleted" }[kind];
    const people = new Set([paidBy, ...splitRows.map(r => r.memberId), ...alsoTell]);
    people.delete(actor.id);
    return [...people].map(to => {
      const share = splitRows.find(r => r.memberId === to)?.amountCents || 0;
      const effect = (paidBy === to ? cents : 0) - share;
      const body = kind === "expense_deleted" ? "It no longer counts in your balance."
        : `${paidBy === to ? "You" : nameOf(paidBy)} paid ${inrText(cents)} · ${effect > 0 ? `you get back ${inrText(effect)}` : effect < 0 ? `you owe ${inrText(-effect)}` : "you're not in the split"}`;
      // Opens that expense (expanded); a deleted one opens the group.
      const link = kind === "expense_deleted" || !expenseId ? `#/g/${gid}` : `#/g/${gid}/e/${expenseId}`;
      return this.stmt({ to, groupId: gid, kind, title: `${actor.name} ${verb} “${desc}”`, body, link, actor: actor.name });
    });
  }
}
