// The composition root (what Spring's dependency injection does): builds the
// repositories, security components and services for one request, each
// given what it depends on through its constructor. Built per request
// because the environment (secrets, feature switches) is read per request.
import type { RequestContext } from "../http/RequestContext.ts";
import { AccountMergeRepository } from "../repository/AccountMergeRepository.ts";
import { EmailTokenRepository } from "../repository/EmailTokenRepository.ts";
import { ExpenseRepository } from "../repository/ExpenseRepository.ts";
import { FriendshipRepository } from "../repository/FriendshipRepository.ts";
import { GroupRepository } from "../repository/GroupRepository.ts";
import { HistoryRepository } from "../repository/HistoryRepository.ts";
import { HousekeepingRepository } from "../repository/HousekeepingRepository.ts";
import { NotificationRepository } from "../repository/NotificationRepository.ts";
import { PaymentMethodRepository } from "../repository/PaymentMethodRepository.ts";
import { PushSubscriptionRepository } from "../repository/PushSubscriptionRepository.ts";
import { RateLimitRepository } from "../repository/RateLimitRepository.ts";
import { SessionRepository } from "../repository/SessionRepository.ts";
import { SettlementRepository } from "../repository/SettlementRepository.ts";
import { SiteAdminRepository } from "../repository/SiteAdminRepository.ts";
import { D1Transaction } from "../repository/Transaction.ts";
import { UserRepository } from "../repository/UserRepository.ts";
import { AccountPasswordGuard } from "../security/AccountPasswordGuard.ts";
import { GroupPinGuard } from "../security/GroupPinGuard.ts";
import { PasswordHasher } from "../security/PasswordHasher.ts";
import { RateLimiter } from "../security/RateLimiter.ts";
import { SessionManager } from "../security/SessionManager.ts";
import { AccountService } from "../service/AccountService.ts";
import { AuthService } from "../service/AuthService.ts";
import { EmailLinkService } from "../service/EmailLinkService.ts";
import { ExpenseService } from "../service/ExpenseService.ts";
import { FriendService } from "../service/FriendService.ts";
import { GroupService } from "../service/GroupService.ts";
import { InsightsService } from "../service/InsightsService.ts";
import { MembershipService } from "../service/MembershipService.ts";
import { NotificationService } from "../service/NotificationService.ts";
import { Notifier } from "../service/Notifier.ts";
import { PaymentMethodService } from "../service/PaymentMethodService.ts";
import { SettlementService } from "../service/SettlementService.ts";
import { SiteAdminService } from "../service/SiteAdminService.ts";

export class Container {
  // Repositories
  readonly users: UserRepository;
  readonly sessionRepo: SessionRepository;
  readonly groupRepo: GroupRepository;
  // Security
  readonly limiter: RateLimiter;
  readonly sessions: SessionManager;
  readonly groupPins: GroupPinGuard;
  // Services
  readonly auth: AuthService;
  readonly account: AccountService;
  readonly groups: GroupService;
  readonly members: MembershipService;
  readonly expenses: ExpenseService;
  readonly settlements: SettlementService;
  readonly insights: InsightsService;
  readonly paymentMethods: PaymentMethodService;
  readonly friends: FriendService;
  readonly notifications: NotificationService;
  readonly siteAdmin: SiteAdminService;

  constructor(ctx: RequestContext) {
    const { env, db } = ctx;
    const tx = new D1Transaction(db);
    const users = this.users = new UserRepository(db);
    const sessions = this.sessionRepo = new SessionRepository(db);
    const groups = this.groupRepo = new GroupRepository(db);
    const expenses = new ExpenseRepository(db);
    const settlements = new SettlementRepository(db);
    const history = new HistoryRepository(db);
    const friendships = new FriendshipRepository(db);
    const tokens = new EmailTokenRepository(db);
    const notificationRepo = new NotificationRepository(db);

    const hasher = new PasswordHasher(env);
    this.limiter = new RateLimiter(new RateLimitRepository(db));
    this.sessions = new SessionManager(sessions, tx);
    const passwords = new AccountPasswordGuard(env, users, hasher);
    const pins = this.groupPins = new GroupPinGuard(hasher, this.limiter, sessions);

    const notify = new Notifier(notificationRepo, ctx.outbox);
    const emailLinks = new EmailLinkService(env, tx, tokens);
    this.auth = new AuthService({ env, tx, users, sessions, tokens, hasher, passwords, emailLinks });
    this.account = new AccountService({ env, tx, users, groups, merges: new AccountMergeRepository(db), hasher, passwords, emailLinks });
    this.groups = new GroupService({ tx, groups, friendships, sessions, hasher, pins, notify });
    this.members = new MembershipService({ tx, groups, users, friendships, notify });
    this.expenses = new ExpenseService({ tx, expenses, groups, history, notify });
    this.settlements = new SettlementService({ tx, settlements, expenses, groups, history, notify });
    this.insights = new InsightsService({ groups, expenses, settlements });
    this.paymentMethods = new PaymentMethodService({ methods: new PaymentMethodRepository(db), groups });
    this.friends = new FriendService({ tx, friendships, users, notify });
    this.notifications = new NotificationService({ env, tx, notifications: notificationRepo, subscriptions: new PushSubscriptionRepository(db) });
    this.siteAdmin = new SiteAdminService({ env, tx, users, sessions, groups, stats: new SiteAdminRepository(db) });
  }
}

// The daily job's only dependency.
export const housekeeping = (db: D1Database) => new HousekeepingRepository(db);
