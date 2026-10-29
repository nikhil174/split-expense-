import * as React from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LazyMotion } from "motion/react";
import { LogOut } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PersonAvatar, Segmented, TopProgress, Wordmark } from "@/components/app/bits";
import { AuthScreen } from "@/features/auth/AuthScreen";
import { GroupsScreen } from "@/features/groups/GroupsScreen";
import { GroupScreen } from "@/features/groups/GroupScreen";
import { PersonScreen } from "@/features/groups/PersonScreen";
import { AdminScreen } from "@/features/admin/AdminScreen";
import { keys, useMe } from "@/hooks/queries";
import { ApiError, post } from "@/lib/api";
import { navigate, useRoute } from "@/lib/route";

const loadMotionFeatures = () => import("@/lib/motion-features").then(m => m.default);

const queryClient = new QueryClient({
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
      <Toaster position="top-center" offset={14} toastOptions={{ classNames: { toast: "!rounded-2xl !border-border !bg-popover/95 !text-foreground !shadow-[0_8px_30px_oklch(0_0_0/18%)] backdrop-blur-xl", description: "!text-muted-foreground", success: "[&_[data-icon]]:!text-positive", error: "[&_[data-icon]]:!text-negative" } }} />
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
  const user = me.data?.admin || me.data?.member;
  if (!user) return <AuthScreen />;
  return <Shell user={user} isAdmin={!!me.data?.admin} />;
}

function Shell({ user, isAdmin }: { user: { id: string; name: string }; isAdmin: boolean }) {
  const route = useRoute();
  const qc = useQueryClient();
  const [signingOut, setSigningOut] = React.useState(false);
  // Members never see the admin view.
  React.useEffect(() => { if (route.name === "admin" && !isAdmin) navigate({ name: "home" }, { replace: true }); }, [route.name, isAdmin]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await Promise.allSettled([post("/api/admin/logout"), post("/api/logout")]);
      qc.clear();
      history.replaceState(null, "", "#/");
      await qc.invalidateQueries({ queryKey: keys.me });
    } finally { setSigningOut(false); }
  };

  const view = route.name === "admin" ? "admin" : "groups";
  const screenKey = route.name === "group" ? "group-" + route.groupId : route.name === "person" ? "person-" + route.groupId + route.memberId : route.name;
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-hairline bg-background/75 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-[60px] max-w-2xl items-center gap-3 px-5">
          <button type="button" onClick={() => navigate({ name: isAdmin && view === "admin" ? "admin" : "home" })} className="flex cursor-pointer items-baseline gap-1.5" aria-label="Home">
            <Wordmark />
          </button>
          <div className="flex flex-1 justify-end">
            {isAdmin && (
              <Segmented id="view-switch" className="w-[188px]" value={view} onChange={v => navigate({ name: v === "admin" ? "admin" : "home" })}
                options={[{ value: "groups", label: "My groups" }, { value: "admin", label: "Admin" }]} />
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="cursor-pointer rounded-full transition-transform active:scale-95" aria-label="Account"><PersonAvatar id={user.id} name={user.name} size="sm" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 rounded-xl">
              <DropdownMenuLabel className="font-normal">
                <p className="font-serif text-lg leading-tight">{user.name}</p>
                <p className="text-xs text-muted-foreground">{isAdmin ? "Administrator · also a member" : "Member"}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={e => { e.preventDefault(); signOut(); }} disabled={signingOut}><LogOut />{signingOut ? "Signing out…" : "Sign out"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <TopProgress />
      </header>
      <AnimatePresence mode="wait" initial={false}>
        <React.Fragment key={screenKey}>
          {route.name === "home" && <GroupsScreen name={user.name} />}
          {route.name === "admin" && isAdmin && <AdminScreen adminName={user.name} />}
          {route.name === "group" && <GroupScreen groupId={route.groupId} tab={route.tab} />}
          {route.name === "person" && <PersonScreen groupId={route.groupId} memberId={route.memberId} />}
        </React.Fragment>
      </AnimatePresence>
    </div>
  );
}
