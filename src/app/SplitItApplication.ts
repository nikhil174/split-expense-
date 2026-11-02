// The API's request pipeline, in the order every request goes through it
// (like Spring's filter chain and dispatcher):
//   1. public routes (sign-up, sign-in, …), which work signed out;
//   2. old app versions are told to reload;
//   3. sign-in required from here on (401 otherwise);
//   4. the site owner's console;
//   5. signed-in routes (/api/me/*, /api/groups, friends, …);
//   6. group routes (/api/groups/:id/…): the caller must be in the group now
//      (404 otherwise), and must have opened it with its PIN on this device
//      (423 otherwise; opening it is the one route allowed before that);
//   7. anything else: 404.
import { ApiError, notFound } from "../http/ApiError.ts";
import type { RequestContext } from "../http/RequestContext.ts";
import { Router } from "../http/Router.ts";
import { json } from "../http/responses.ts";
import { AuthController } from "../controller/AuthController.ts";
import { ExpenseController } from "../controller/ExpenseController.ts";
import { FriendController } from "../controller/FriendController.ts";
import { GroupController } from "../controller/GroupController.ts";
import { InsightsController } from "../controller/InsightsController.ts";
import { InvitationController } from "../controller/InvitationController.ts";
import { MeController } from "../controller/MeController.ts";
import { MemberController } from "../controller/MemberController.ts";
import { NotificationController } from "../controller/NotificationController.ts";
import { PaymentMethodController } from "../controller/PaymentMethodController.ts";
import { SettlementController } from "../controller/SettlementController.ts";
import { SiteAdminController } from "../controller/SiteAdminController.ts";
import type { Authed, InGroup, Web } from "../controller/context.ts";
import { Container } from "./Container.ts";

const auth = new AuthController(), me = new MeController(), groups = new GroupController(), invitations = new InvitationController(), members = new MemberController();
const expenses = new ExpenseController(), settlements = new SettlementController(), insights = new InsightsController();
const paymentMethods = new PaymentMethodController(), friends = new FriendController(), notifications = new NotificationController();
const siteAdmin = new SiteAdminController();

// The route tables (built once).
const publicRoutes = new Router<Web>();
auth.register(publicRoutes);

const signedInRoutes = new Router<Authed>();
for (const c of [me, groups, invitations, insights, settlements, paymentMethods, notifications, friends]) c.register(signedInRoutes);

const groupRoutes = new Router<InGroup>();
for (const c of [groups, invitations, members, insights, expenses, settlements, paymentMethods]) c.registerInGroup(groupRoutes);

const GROUP_PATH = /^\/api\/groups\/([\w-]+)(?:\/(.*))?$/;
const OLD_APP_PATH = /^\/api\/(access\/|admin\/|groups\/public$)/;

export async function handleApi(http: RequestContext): Promise<Response> {
  const app = new Container(http);
  const web: Web = { http, app };
  const { method, path } = http;

  const open = await publicRoutes.dispatch(web, method, path);
  if (open) return open;
  // The app open on someone's phone may still be the version from before
  // accounts: tell it to reload instead of a confusing "sign in" error.
  if (OLD_APP_PATH.test(path)) return json({ error: "Split It was updated. Close and reopen the app (or refresh the page) to sign in.", code: "app_updated" }, 410);

  const user = await app.sessions.currentUser(http);
  if (!user) throw new ApiError("Sign in to continue.", 401);
  const authed: Authed = { ...web, user };
  if (path.startsWith("/api/site-admin/")) return siteAdmin.handle(authed);

  const mine = await signedInRoutes.dispatch(authed, method, path);
  if (mine) return mine;

  const g = GROUP_PATH.exec(path);
  if (!g) throw notFound();
  const scope = await app.groupAccess.open(user, g[1]);
  const tail = g[2] || "";
  // Opening the group with its PIN is the one thing allowed while it's locked.
  if (method === "POST" && tail === "unlock") return json(await app.groupAccess.unlock(scope, async () => (await http.body())?.pin));
  await app.groupAccess.requireUnlocked(scope);
  const inGroup: InGroup = { ...authed, scope };
  const res = await groupRoutes.dispatch(inGroup, method, tail);
  if (!res) throw notFound();
  return res;
}
