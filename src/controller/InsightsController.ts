// Balances and summaries: /api/balances (Home) and a group's balances,
// dashboard, member summary, pair views and statement.
import type { Router } from "../http/Router.ts";
import { json } from "../http/responses.ts";
import type { Authed, InGroup } from "./context.ts";

export class InsightsController {
  register(r: Router<Authed>) {
    r.get("/api/balances", this.home);
  }
  registerInGroup(r: Router<InGroup>) {
    r.get("dashboard", this.dashboard);
    r.get(/^members\/([\w-]+)\/statement$/, this.statement);
    r.get(/^members\/([\w-]+)$/, this.member);
    r.get(/^with\/([\w-]+)$/, this.withMe);
    r.get(/^pair\/([\w-]+)\/([\w-]+)$/, this.pair);
    r.get("balances", this.balances);
  }

  // Everyone I owe or who owes me, across all my groups.
  async home({ app, user }: Authed) { return json(await app.insights.home(user)); }

  async dashboard({ app, scope }: InGroup) { return json(await app.insights.dashboard(scope)); }
  async balances({ app, scope }: InGroup) { return json(await app.insights.balances(scope)); }
  async member({ app, scope }: InGroup, [mid]: string[]) { return json(await app.insights.member(scope, mid)); }
  // Me and one other person.
  async withMe({ app, scope }: InGroup, [other]: string[]) { return json(await app.insights.pair(scope, scope.user.id, other, true)); }
  // Any two members (anyone in the group may look).
  async pair({ app, scope }: InGroup, [a, b]: string[]) { return json(await app.insights.pair(scope, a, b, false)); }
  // The data behind "Share as Excel".
  async statement({ app, scope }: InGroup, [mid]: string[]) { return json(await app.insights.statement(scope, mid)); }
}
