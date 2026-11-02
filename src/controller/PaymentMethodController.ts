// UPI details: /api/payment-method (mine) and, in a group, everyone's.
import { IMAGE_BODY_BYTES, RATE_LIMITS } from "../config/constants.ts";
import type { Router } from "../http/Router.ts";
import { imageResponse, json } from "../http/responses.ts";
import type { Authed, InGroup } from "./context.ts";

export class PaymentMethodController {
  register(r: Router<Authed>) {
    r.get("/api/payment-method", this.mine);
    r.post("/api/payment-method", this.save);
    r.get("/api/payment-method/qr", this.myQr);
    r.post("/api/payment-method/delete", this.remove);
  }
  registerInGroup(r: Router<InGroup>) {
    r.get("payment-methods", this.inGroup);
    r.get(/^members\/([\w-]+)\/qr$/, this.memberQr);
  }

  async mine({ app, user }: Authed) { return json(await app.paymentMethods.mine(user)); }

  // The body may carry a QR image, so it may be larger.
  async save({ http, app, user }: Authed) {
    await app.limiter.check("paymethod", user.id, RATE_LIMITS.paymentMethodWrite);
    return json(await app.paymentMethods.save(user, await http.body(IMAGE_BODY_BYTES)));
  }

  async myQr({ app, user }: Authed) {
    const r = await app.paymentMethods.myQr(user);
    return imageResponse(r.base64, r.mime, { "cache-control": "private, no-cache", "x-content-type-options": "nosniff" });
  }

  async remove({ app, user }: Authed) { return json(await app.paymentMethods.remove(user)); }

  async inGroup({ app, scope }: InGroup) { return json(await app.paymentMethods.inGroup(scope)); }

  async memberQr({ app, scope }: InGroup, [mid]: string[]) {
    const r = await app.paymentMethods.memberQr(scope, mid);
    return imageResponse(r.base64, r.mime, { "cache-control": "private, no-cache", "x-content-type-options": "nosniff", "content-disposition": "inline" });
  }
}
