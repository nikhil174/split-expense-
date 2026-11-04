// /api/groups/:id/expenses and the group's history.
import { EXPENSE_BODY_BYTES, RATE_LIMITS } from "../config/constants.ts";
import type { Router } from "../http/Router.ts";
import { imageResponse, json } from "../http/responses.ts";
import type { InGroup } from "./context.ts";

export class ExpenseController {
  registerInGroup(r: Router<InGroup>) {
    r.post("expenses", this.add);
    r.post(/^expenses\/([\w-]+)\/edit$/, this.edit);
    r.get("history", this.history);
    r.get("expenses", this.list);
    r.post(/^expenses\/([\w-]+)\/delete$/, this.delete);
    r.get(/^expenses\/([\w-]+)\/photos\/([\w-]+)$/, this.photo);
  }

  async add({ http, app, user, scope }: InGroup) {
    await app.limiter.check("expense", user.id, RATE_LIMITS.expenseWrite);
    // It may carry photos (receipts), so the body may be larger.
    return json(await app.expenses.add(scope, await http.body(EXPENSE_BODY_BYTES)), 201);
  }

  async edit({ http, app, user, scope }: InGroup, [eid]: string[]) {
    await app.limiter.check("expense", user.id, RATE_LIMITS.expenseWrite);
    return json(await app.expenses.edit(scope, eid, () => http.body(EXPENSE_BODY_BYTES)));
  }

  async list({ app, scope }: InGroup) { return json(await app.expenses.list(scope)); }

  async delete({ app, user, scope }: InGroup, [eid]: string[]) {
    await app.limiter.check("expense", user.id, RATE_LIMITS.expenseWrite);
    return json(await app.expenses.delete(scope, eid));
  }

  // A photo attached to an expense, for people in the group.
  async photo({ app, scope }: InGroup, [eid, pid]: string[]) {
    const p = await app.expenses.photo(scope, eid, pid);
    return imageResponse(p.base64, p.mime, { "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" });
  }

  // Everything that changed in the group; ?expense=<id> for one expense.
  async history({ http, app, scope }: InGroup) { return json(await app.expenses.history(scope, http.query("expense"))); }
}
