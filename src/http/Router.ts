// A small ordered router, like Spring's @RequestMapping table: the first
// route whose method and path pattern match handles the request. Patterns
// are regular expressions on the path; their groups are the path variables.
// Routes are tried in the order they were added, so order expresses
// precedence where patterns overlap.

export type Handler<C> = (ctx: C, params: string[]) => Promise<Response> | Response;
type Route<C> = { method: string; pattern: RegExp; handler: Handler<C> };

export class Router<C> {
  private readonly routes: Route<C>[] = [];

  // method "*" matches any method (the handler decides).
  on(method: string, pattern: string | RegExp, handler: Handler<C>): this {
    const regex = typeof pattern === "string" ? new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") : pattern;
    this.routes.push({ method, pattern: regex, handler });
    return this;
  }
  get(pattern: string | RegExp, handler: Handler<C>) { return this.on("GET", pattern, handler); }
  post(pattern: string | RegExp, handler: Handler<C>) { return this.on("POST", pattern, handler); }
  any(pattern: string | RegExp, handler: Handler<C>) { return this.on("*", pattern, handler); }

  // The matching route's response, or null when no route matches.
  async dispatch(ctx: C, method: string, path: string): Promise<Response | null> {
    for (const r of this.routes) {
      if (r.method !== "*" && r.method !== method) continue;
      const m = r.pattern.exec(path);
      if (m) return r.handler(ctx, m.slice(1));
    }
    return null;
  }
}
