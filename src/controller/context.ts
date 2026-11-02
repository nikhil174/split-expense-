// What a controller method receives, by how far the request got:
// Web (anyone), Authed (signed in), InGroup (a member who opened the group).
import type { Container } from "../app/Container.ts";
import type { RequestContext } from "../http/RequestContext.ts";
import type { CurrentUser } from "../repository/types.ts";
import type { GroupScope } from "../service/GroupService.ts";

export type Web = { http: RequestContext; app: Container };
export type Authed = Web & { user: CurrentUser };
export type InGroup = Authed & { scope: GroupScope };
