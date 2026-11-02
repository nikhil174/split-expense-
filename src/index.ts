// Split It's Cloudflare Worker: the JSON API under /api/, the React app
// (static assets) for everything else, and a daily cleanup (cron).
//
// Layout (Spring-style layers; see docs/system-design.md):
//   app/          composition root (Container) and the request pipeline
//   controller/   HTTP routes → services
//   service/      business rules
//   repository/   all SQL (Cloudflare D1)
//   security/     passwords, sessions, rate limits, Google, group PINs
//   domain/       pure money / split / debt logic
//   integration/  email (Brevo) and phone push (Web Push)
//   http/, config/
import { housekeeping } from "./app/Container.ts";
import { handleApi } from "./app/SplitItApplication.ts";
import { databaseOf, type AppEnv } from "./config/env.ts";
import { RequestContext } from "./http/RequestContext.ts";
import { errorResponse, fail } from "./http/responses.ts";
import { pushEnabled, sendPushes } from "./integration/push.ts";

// Daily housekeeping (cron in wrangler.toml): removes rows that have
// expired and are never read again. Nothing about money or history is touched.
export function cleanup(db: D1Database, now = Date.now()) {
  return housekeeping(db).removeExpired(now);
}

export default {
  async scheduled(_event: ScheduledController, env: AppEnv, ctx?: ExecutionContext) {
    const done = cleanup(databaseOf(env)).then(r => console.log("cleanup", JSON.stringify(r))).catch(e => console.error("cleanup", String(e)));
    if (ctx?.waitUntil) ctx.waitUntil(done); else await done;
  },

  async fetch(req: Request, env: AppEnv, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": url.origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    if (url.pathname.startsWith("/api/")) {
      // Browsers send Origin on cross-site POSTs; refuse writes from other sites.
      const origin = req.headers.get("Origin");
      if (req.method !== "GET" && req.method !== "HEAD" && origin && origin !== url.origin) return fail("Cross-site request refused.", 403);
      const http = new RequestContext(req, env, url);
      try {
        const res = await handleApi(http);
        // Notifications written by this request also go to phones, after
        // the response (in tests, with no ctx, before it).
        if (http.outbox.length && res.status < 400 && pushEnabled(env)) {
          const sending = sendPushes(env, databaseOf(env), http.outbox).catch(e => console.error("push", String(e)));
          if (ctx?.waitUntil) ctx.waitUntil(sending); else await sending;
        }
        return res;
      } catch (e) {
        return errorResponse(e, { development: env.ENVIRONMENT === "development" });
      }
    }
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(req);
      // Hashed build files never change, so cache them for a year; the HTML
      // shell must always be revalidated so a new deploy shows up immediately.
      const headers = new Headers(res.headers);
      headers.set("cache-control", url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
    return new Response("Split It API is running. Configure the static assets binding.", { status: 200, headers: { "content-type": "text/plain" } });
  },
} satisfies ExportedHandler<AppEnv>;
