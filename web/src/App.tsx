import * as React from "react";
import { MutationCache, QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { GroupGate } from "@/features/groups/GroupGate";
import { GroupPinDialog, openGroupPin } from "@/components/app/secrets";
import { AnimatePresence, LazyMotion } from "motion/react";
import { Bell, Download, LogOut, UserRound, Wallet } from "lucide-react";
import { NotificationsScreen } from "@/features/notifications/NotificationsScreen";
import { PaymentMethodSheet } from "@/features/groups/UpiPayments";
import { useInstallApp } from "@/components/app/InstallApp";
import { forgetPushOnSignOut, syncPushOnSignIn } from "@/lib/push";
import { Toaster } from "@/components/ui/sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PersonAvatar, Segmented, TopProgress, Wordmark } from "@/components/app/bits";
import { AuthScreen } from "@/features/auth/AuthScreen";
import { GroupsScreen } from "@/features/groups/GroupsScreen";
import { GroupScreen } from "@/features/groups/GroupScreen";
import { PersonScreen } from "@/features/groups/PersonScreen";
import { ProfileScreen } from "@/features/profile/ProfileScreen";
import { SiteAdminScreen } from "@/features/admin/SiteAdminScreen";
import { keys, useMe, useNotifications } from "@/hooks/queries";
import { ApiError, post, type User } from "@/lib/api";
import { navigate, useRoute } from "@/lib/route";
import { cn } from "@/lib/utils";

const loadMotionFeatures = () => import("@/lib/motion-features").then(m => m.default);

const queryClient = new QueryClient({
  // An action in a group that's locked on this device (e.g. confirming a
  // payment from Home) asks for the group's PIN.
  mutationCache: new MutationCache({
    onError: err => { if (err instanceof ApiError && err.code === "group_locked") openGroupPin({ groupId: String(err.data.groupId), groupName: String(err.data.groupName) }); },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Don't hammer the API with retries for auth or validation errors.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

// A 401 anywhere means the session ended: drop back to sign-in.
queryClient.getQueryCache().subscribe(event => {
  const err = event.query.state.error;
  if (event.type === "updated" && err instanceof ApiError && err.status === 401 && event.query.queryKey[0] !== "me") {
    queryClient.invalidateQueries({ queryKey: keys.me });
  }
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={loadMotionFeatures} strict>
        <Root />
      </LazyMotion>
      <GroupPinDialog />
      <Toaster position="bottom-center" offset={{ bottom: 100 }} mobileOffset={{ bottom: 100, left: 16, right: 16 }} toastOptions={{ classNames: { toast: "!rounded-[20px] !border-0 !bg-[#141716]/95 !text-white !text-[14px] !shadow-[0_14px_36px_-10px_rgb(0_0_0/40%)] backdrop-blur-xl", description: "!text-white/70", success: "[&_[data-icon]]:!text-[#8fd6b8]", error: "[&_[data-icon]]:!text-[#f2a492]" } }} />
    </QueryClientProvider>
  );
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <span className="animate-pulse"><Wordmark large /></span>
    </div>
  );
}

function Root() {
  const me = useMe();
  if (me.isPending) return <Splash />;
  const user = me.data?.user;
  if (!user) return <AuthScreen />;
  return <Shell user={user} />;
}

function Shell({ user }: { user: User }) {
  const route = useRoute();
  const qc = useQueryClient();
  const [signingOut, setSigningOut] = React.useState(false);
  const install = useInstallApp();
  React.useEffect(() => { syncPushOnSignIn(); }, [user.id]);
  const [upiOpen, setUpiOpen] = React.useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await forgetPushOnSignOut();
      await post("/api/logout").catch(() => undefined);
      // Mark the session signed out right away so Root swaps to the sign-in
      // screen, then drop everything cached for the previous user.
      await qc.cancelQueries();
      qc.setQueryData(keys.me, { user: null });
      qc.removeQueries({ predicate: q => q.queryKey[0] !== "me" });
      navigate({ name: "home" }, { replace: true });
    } finally { setSigningOut(false); }
  };

  const screenKey = route.name === "group" ? "group-" + route.groupId : route.name === "person" ? "person-" + route.groupId + route.memberId : route.name;
  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="sticky top-0 z-30 bg-[#f7f7f5]/70 pt-[env(safe-area-inset-top)] backdrop-blur-2xl backdrop-saturate-150">
        <div className="mx-auto flex h-[58px] max-w-2xl items-center gap-2 px-4 min-[400px]:gap-3">
          <button type="button" onClick={() => navigate({ name: "home" })} className="flex cursor-pointer items-baseline gap-1.5" aria-label="Home">
            <Wordmark />
          </button>
          <div className="flex flex-1 justify-end">
            {/* Only the site owner has two separate views: their own account, and the Admin console. */}
            {user.siteAdmin && (
              <Segmented id="view-switch" className="w-[156px] min-[400px]:w-[172px]" value={route.name === "admin" ? "admin" : "general"} onChange={v => navigate({ name: v === "admin" ? "admin" : "home" })}
                options={[{ value: "general", label: "General" }, { value: "admin", label: "Admin" }]} />
            )}
          </div>
          <NotificationBell active={route.name === "notifications"} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="cursor-pointer rounded-full transition-transform active:scale-95" aria-label="Account"><PersonAvatar id={user.id} name={user.name} size="sm" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 rounded-[18px] border-white/80 bg-white/95 p-1.5 shadow-[0_16px_40px_-12px_rgb(16_40_32/25%)] backdrop-blur-xl">
              <DropdownMenuLabel className="font-normal">
                <p className="headline">{user.name}</p>
                <p className="text-xs text-muted-foreground">@{user.username}</p>
                <p className="mt-1.5 text-[11px] text-muted-foreground/70">Build {__BUILD__}</p>
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => navigate({ name: "profile" })}><UserRound />Your profile</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setUpiOpen(true)}><Wallet />Your UPI</DropdownMenuItem>
              {install.available && <DropdownMenuItem onSelect={() => install.start()}><Download />Install app</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={e => { e.preventDefault(); signOut(); }} disabled={signingOut}><LogOut />{signingOut ? "Signing out…" : "Sign out"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {install.dialog}
          <PaymentMethodSheet open={upiOpen} onOpenChange={setUpiOpen} />
        </div>
        <TopProgress />
      </header>
      <AnimatePresence mode="wait" initial={false}>
        <React.Fragment key={screenKey}>
          {route.name === "home" && <GroupsScreen user={user} />}
          {route.name === "profile" && <ProfileScreen user={user} />}
          {route.name === "admin" && <SiteAdminScreen user={user} />}
          {route.name === "group" && <GroupGate groupId={route.groupId}><GroupScreen groupId={route.groupId} tab={route.tab} expenseId={route.expenseId} /></GroupGate>}
          {route.name === "notifications" && <NotificationsScreen />}
          {route.name === "person" && <GroupGate groupId={route.groupId}><PersonScreen groupId={route.groupId} memberId={route.memberId} /></GroupGate>}
        </React.Fragment>
      </AnimatePresence>
    </div>
  );
}

// Bell next to the profile circle, with how many notifications are unread.
function NotificationBell({ active }: { active: boolean }) {
  const q = useNotifications();
  const unread = q.data?.unread || 0;
  return (
    <button type="button" onClick={() => navigate({ name: "notifications" })} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      className={cn("relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-full transition-transform active:scale-90 min-[400px]:size-9", active ? "bg-[#141716] text-white" : "bg-[#141716]/[0.05] text-foreground")}>
      <Bell className="size-[18px]" strokeWidth={2} />
      {unread > 0 && (
        <span className="tabular absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-negative px-1 text-[10.5px] leading-none font-semibold text-white ring-2 ring-[#f7f7f5]">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}
