// Payments: /api/payments/pending and /api/groups/:id/settlements/*.
import { IMAGE_BODY_BYTES, RATE_LIMITS } from "../config/constants.ts";
import type { Router } from "../http/Router.ts";
import { imageResponse, json } from "../http/responses.ts";
import type { Authed, InGroup } from "./context.ts";

export class SettlementController {
  register(r: Router<Authed>) {
    r.get("/api/payments/pending", this.pendingForMe);
  }
  registerInGroup(r: Router<InGroup>) {
    r.get("settlements", this.list);
    r.get(/^(settlements\/mine|debts)$/, this.debts);
    r.post("settlements", this.record);
    r.post("settlements/waive", this.waive);
    r.post("settlements/ask-waiver", this.askWaiver);
    r.get(/^settlements\/([\w-]+)\/proof$/, this.proof);
    r.post(/^settlements\/([\w-]+)\/(confirm|reject|cancel)$/, this.decide);
  }

  // Payments waiting on me or that I'm waiting on, across all my groups.
  async pendingForMe({ app, user }: Authed) { return json(await app.settlements.pendingForMe(user)); }

  async list({ app, scope }: InGroup) { return json(await app.settlements.list(scope)); }

  // All debts in the group (debts), or mine (settlements/mine).
  async debts({ app, scope }: InGroup, [which]: string[]) {
    return json(await app.settlements.debts(scope, which === "debts" ? "all" : "mine"));
  }

  // Record a payment (it may carry a screenshot, so the body may be larger).
  async record({ http, app, user, scope }: InGroup) {
    await app.limiter.check("settlement", user.id, RATE_LIMITS.settlementWrite);
    return json(await app.settlements.record(scope, await http.body(IMAGE_BODY_BYTES)), 201);
  }

  // Let someone off what they still owe me ("no need to pay").
  async waive({ http, app, user, scope }: InGroup) {
    await app.limiter.check("settlement", user.id, RATE_LIMITS.settlementWrite);
    return json(await app.settlements.waive(scope, await http.body()), 201);
  }

  // Ask the person I owe to let me off ("no need to pay"); they decide.
  async askWaiver({ http, app, user, scope }: InGroup) {
    await app.limiter.check("settlement", user.id, RATE_LIMITS.settlementWrite);
    return json(await app.settlements.askWaiver(scope, await http.body()), 201);
  }

  // The screenshot attached to a payment, for people in the group.
  async proof({ app, scope }: InGroup, [sid]: string[]) {
    const r = await app.settlements.proof(scope, sid);
    return imageResponse(r.base64, r.mime, { "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" });
  }

  async decide({ app, scope }: InGroup, [sid, action]: string[]) {
    return json(await app.settlements.decide(scope, sid, action as "confirm" | "reject" | "cancel"));
  }
}
