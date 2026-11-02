// ----- Site owner console ("Admin" tab) -----
// Only the site owner's account (site_role 'admin'), and only after entering
// the admin key (the ADMIN_PIN secret) in this session. If no owner exists
// yet (a fresh install), the first account to enter the key becomes it.
// Everyone else gets 404, as if it didn't exist. It sees accounts and groups
// in summary, never anyone's expenses. There is deliberately no password
// reset here: the site owner never sets anyone's password (group PINs can be
// cleared).
import type { AdminGroup, AdminOverview, AdminUser } from "../../shared/api-types.ts";
import type { Clock } from "../config/Clock.ts";
import { ADMIN_UNLOCK_MS, DAY } from "../config/constants.ts";
import type { AppEnv } from "../config/env.ts";
import { ApiError, notFound } from "../http/ApiError.ts";
import type { GroupRepository } from "../repository/GroupRepository.ts";
import type { SessionRepository } from "../repository/SessionRepository.ts";
import type { SiteAdminRepository } from "../repository/SiteAdminRepository.ts";
import type { Transaction } from "../repository/Transaction.ts";
import type { UserRepository } from "../repository/UserRepository.ts";
import type { CurrentUser } from "../repository/types.ts";
import { secretEquals } from "../security/crypto.ts";

export const hidden = () => notFound("Not found.");

export class SiteAdminService {
  private readonly env: AppEnv;
  private readonly tx: Transaction;
  private readonly accounts: UserRepository;
  private readonly sessions: SessionRepository;
  private readonly groups: GroupRepository;
  private readonly stats: SiteAdminRepository;
  private readonly clock: Clock;
  constructor(deps: { clock: Clock; env: AppEnv; tx: Transaction; users: UserRepository; sessions: SessionRepository; groups: GroupRepository; stats: SiteAdminRepository }) {
    this.clock = deps.clock;
    this.env = deps.env; this.tx = deps.tx; this.accounts = deps.users; this.sessions = deps.sessions; this.groups = deps.groups; this.stats = deps.stats;
  }

  // Before the key is checked: is this person allowed to try at all?
  async mayTryKey(u: CurrentUser): Promise<void> {
    if (!u.siteAdmin && await this.accounts.siteOwnerExists()) throw hidden();
    if (!this.env.ADMIN_PIN) throw new ApiError("The admin key is not configured on the server.", 503);
  }

  // Opens the Admin tab in this session (for 12 hours) with the admin key.
  async unlock(u: CurrentUser, key: string) {
    if (!await secretEquals(key, String(this.env.ADMIN_PIN))) throw new ApiError("That's not the admin key.", 401);
    await this.tx.run([
      ...(u.siteAdmin ? [] : [this.accounts.claimSiteOwnerStmt(u.id)]),
      this.sessions.setAdminUntilStmt(u.tokenHash, this.clock.now() + ADMIN_UNLOCK_MS),
    ]);
    if (!(await this.accounts.siteRole(u.id))?.site_role) throw hidden();
    return { ok: true };
  }

  async lock(u: CurrentUser) {
    await this.sessions.clearAdminUntil(u.tokenHash);
    return { ok: true };
  }

  overview(): Promise<AdminOverview> { return this.stats.overview(this.clock.now() - 7 * DAY); }

  async users(q: string): Promise<{ users: AdminUser[] }> {
    const r = await this.stats.users(q, this.clock.now());
    return { users: r.results.map(x => ({ ...x, legacy: !!x.legacy, siteAdmin: !!x.siteAdmin, hasPin: !!x.hasPin, locked: !!x.locked })) };
  }

  async groupList(q: string): Promise<{ groups: AdminGroup[] }> {
    const r = await this.stats.groups(q);
    return { groups: r.results.map(x => ({ ...x, hasPin: !!x.hasPin })) };
  }

  // A group whose admins forgot its PIN: clear it, so they can open the group
  // and set a new one (Members → Group PIN).
  async resetGroupPin(gid: string) {
    const g = await this.groups.idAndName(gid);
    if (!g) throw notFound("Group not found.");
    await this.tx.run([this.groups.setPinStmt(g.id, null), this.sessions.deleteUnlocksForGroupStmt(g.id)]);
    return { ok: true, name: g.name };
  }
}
