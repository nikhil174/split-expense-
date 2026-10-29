import * as React from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LazyMotion } from "motion/react";
import { LogOut } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PersonAvatar, Segmented, TopProgress } from "@/components/app/bits";
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
      <Toaster position="top-center" richColors closeButton toastOptions={{ className: "rounded-2xl" }} />
    </QueryClientProvider>
  );
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="size-10 animate-pulse rounded-xl bg-primary/80" />
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
      <header className="sticky top-0 z-30 border-b bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex h-[60px] max-w-2xl items-center gap-3 px-4">
          <button type="button" onClick={() => navigate({ name: isAdmin && view === "admin" ? "admin" : "home" })} className="flex cursor-pointer items-center gap-2" aria-label="Home">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-md shadow-primary/30">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round"><path d="M6 16 18 8M11 8h7v7" /></svg>
            </span>
            <span className="hidden font-bold tracking-tight sm:block">Split Expense</span>
          </button>
          <div className="flex-1">
            {isAdmin && (
              <Segmented id="view-switch" className="mx-auto max-w-56" value={view} onChange={v => navigate({ name: v === "admin" ? "admin" : "home" })}
                options={[{ value: "groups", label: "My groups" }, { value: "admin", label: "Admin" }]} />
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account"><PersonAvatar id={user.id} name={user.name} size="sm" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <p className="font-semibold">{user.name}</p>
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
