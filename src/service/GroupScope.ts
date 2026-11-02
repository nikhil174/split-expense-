// A group as seen by one of its members: who they are in it, and the
// group's name and PIN (see GroupAccessService.open).
import type { CurrentUser, Role } from "../repository/types.ts";

export type GroupScope = { gid: string; user: CurrentUser; role: Role; isAdmin: boolean; name: string; pinHash: string | null };
