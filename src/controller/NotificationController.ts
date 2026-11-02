// /api/notifications and /api/push/* (phone notifications).
import { json } from "../http/responses.ts";
import type { Router } from "../http/Router.ts";
import type { Authed } from "./context.ts";

export class NotificationController {
  register(r: Router<Authed>) {
    r.get("/api/push/key", this.pushKey);
    r.post("/api/push/subscribe", this.subscribe);
    r.post("/api/push/unsubscribe", this.unsubscribe);
    r.get("/api/notifications", this.list);
    r.post("/api/notifications/read", this.markAllRead);
  }

  pushKey({ app }: Authed) { return json(app.notifications.pushKey()); }
  async subscribe({ http, app, user }: Authed) { return json(await app.notifications.subscribe(user, () => http.body())); }
  async unsubscribe({ http, app, user }: Authed) { return json(await app.notifications.unsubscribe(user, await http.body())); }
  async list({ app, user }: Authed) { return json(await app.notifications.list(user)); }
  async markAllRead({ app, user }: Authed) { return json(await app.notifications.markAllRead(user)); }
}
