// /api/groups/:id/expenses and the group's history.
import { RATE_LIMITS } from "../config/constants.ts";
import type { Router } from "../http/Router.ts";
import { json } from "../http/responses.ts";
import type { InGroup } from "./context.ts";

export class ExpenseController {
  registerInGroup(r: Router<InGroup>) {
    r.post("expenses", this.add);
    r.post(/^expenses\/([\w-]+)\/edit$/, this.edit);
    r.get("history", this.history);
    r.get("expenses", this.list);
    r.post(/^expenses\/([\w-]+)\/delete$/, this.delete);
  }

  async add({ http, app, user, scope }: InGroup) {
    await app.limiter.check("expense", user.id, RATE_LIMITS.expenseWrite);
    return json(await app.expenses.add(scope, await http.body()), 201);
  }

  async edit({ http, app, user, scope }: InGroup, [eid]: string[]) {
    await app.limiter.check("expense", user.id, RATE_LIMITS.expenseWrite);
    return json(await app.expenses.edit(scope, eid, () => http.body()));
  }

  async list({ app, scope }: InGroup) { return json(await app.expenses.list(scope)); }

  async delete({ app, user, scope }: InGroup, [eid]: string[]) {
    await app.limiter.check("expense", user.id, RATE_LIMITS.expenseWrite);
    return json(await app.expenses.delete(scope, eid));
  }

  // Everything that changed in the group; ?expense=<id> for one expense.
  async history({ http, app, scope }: InGroup) { return json(await app.expenses.history(scope, http.query("expense"))); }
}
